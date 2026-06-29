//! Authentication endpoints: register, login, refresh (with rotation + reuse
//! detection), logout, logout-all, me, email verification, password reset and
//! change.

use axum::{extract::State, http::HeaderMap, Json};
use bson::{doc, oid::ObjectId};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{password, token},
    authn::{resolve_permissions, AuthUser},
    db::Collections,
    email,
    error::{AppError, AppResult},
    models::{EmailToken, EmailTokenKind, Session, User, UserPublic, UserStatus},
    state::AppState,
};

use super::{client_ip, user_agent};

// ----------------------------- DTOs -----------------------------

#[derive(Deserialize)]
pub struct RegisterReq {
    pub email: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

/// Passwordless: ask for a login code by email. Creates the account on first
/// use (registration and login are the same flow).
#[derive(Deserialize)]
pub struct RequestCodeReq {
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Passwordless: verify the emailed code and start a session.
#[derive(Deserialize)]
pub struct VerifyCodeReq {
    pub email: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct RefreshReq {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct VerifyEmailReq {
    pub token: String,
}

#[derive(Deserialize)]
pub struct ForgotReq {
    pub email: String,
}

#[derive(Deserialize)]
pub struct ResetReq {
    pub token: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordReq {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub user: UserPublic,
}

// ----------------------------- Validation -----------------------------

pub(crate) fn validate_email(email: &str) -> AppResult<String> {
    let e = email.trim().to_lowercase();
    if e.len() < 3 || e.len() > 254 || !e.contains('@') || e.starts_with('@') || e.ends_with('@') {
        return Err(AppError::Validation("invalid email".into()));
    }
    Ok(e)
}

fn validate_password(p: &str) -> AppResult<()> {
    if p.len() < 8 || p.len() > 128 {
        return Err(AppError::Validation(
            "password must be 8-128 characters".into(),
        ));
    }
    Ok(())
}

// --------------------- Brute-force lockout (shared) ---------------------

/// Reject if the account is currently locked out. Shared by every credential
/// verification flow (login code, backup code, password).
pub(crate) fn check_lock(user: &User, now: chrono::DateTime<Utc>) -> AppResult<()> {
    if let Some(until) = user.locked_until {
        if until > now {
            return Err(AppError::Locked);
        }
    }
    Ok(())
}

/// Record a failed credential attempt; lock the account after the configured
/// number of failures (the counter resets when the lock is applied).
pub(crate) async fn register_failure(state: &AppState, user: &User) {
    let now = Utc::now();
    let attempts = user.failed_login_attempts + 1;
    let mut set = doc! { "updated_at": bson::DateTime::from_chrono(now) };
    if attempts >= state.cfg.max_failed_logins {
        set.insert(
            "locked_until",
            bson::DateTime::from_chrono(now + Duration::minutes(state.cfg.lockout_minutes)),
        );
        set.insert("failed_login_attempts", 0i32);
    } else {
        set.insert("failed_login_attempts", attempts as i32);
    }
    let _ = state
        .db
        .users()
        .update_one(doc! { "_id": user.id }, doc! { "$set": set })
        .await;
}

/// Clear the failure counter + lock after a successful sign-in.
pub(crate) async fn clear_failures(state: &AppState, user_id: ObjectId) {
    let _ = state
        .db
        .users()
        .update_one(
            doc! { "_id": user_id },
            doc! { "$set": { "failed_login_attempts": 0i32 }, "$unset": { "locked_until": "" } },
        )
        .await;
}

// ----------------------------- Session helpers -----------------------------

/// Creates a session and returns (access_token, client_refresh_token).
/// The client refresh token is `"<session_id>.<secret>"`; only the hash of the
/// secret is persisted.
pub(crate) async fn issue_session(
    state: &AppState,
    user_id: ObjectId,
    ip: String,
    ua: String,
) -> AppResult<(String, String)> {
    let sid = ObjectId::new();
    let now = Utc::now();
    let rs = token::generate_refresh(&state.cfg.auth_refresh_pepper);

    let session = Session {
        id: Some(sid),
        user_id,
        refresh_hash: rs.hash,
        token_version: 1,
        user_agent: ua,
        ip,
        created_at: now,
        last_used_at: now,
        expires_at: now + Duration::seconds(state.cfg.refresh_ttl_secs),
        revoked: false,
        revoked_reason: None,
    };
    state.db.sessions().insert_one(&session).await?;

    let access = sign_access(state, &user_id, &sid, 1);
    let client_refresh = format!("{}.{}", sid.to_hex(), rs.raw);
    Ok((access, client_refresh))
}

fn sign_access(state: &AppState, user_id: &ObjectId, sid: &ObjectId, ver: u32) -> String {
    let now = Utc::now().timestamp();
    let claims = token::AccessClaims {
        sub: user_id.to_hex(),
        sid: sid.to_hex(),
        ver,
        iat: now,
        exp: now + state.cfg.access_ttl_secs,
        typ: "access".into(),
    };
    token::sign_access(&claims, &state.cfg.auth_token_secret)
}

pub(crate) async fn public_user(state: &AppState, user: &User) -> AppResult<UserPublic> {
    let permissions = resolve_permissions(state, user).await?;
    let id = user.id.unwrap_or_default().to_hex();
    Ok(UserPublic {
        // Expose our cached proxy path, never the provider's (expiring) CDN URL.
        avatar_url: user.avatar_url.as_ref().map(|_| format!("/api/avatar/{id}")),
        id,
        email: user.email.clone(),
        email_verified: user.email_verified,
        display_name: user.display_name.clone(),
        status: user.status,
        permissions,
    })
}

// ----------------------------- Handlers -----------------------------

pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterReq>,
) -> AppResult<Json<TokenResponse>> {
    let email = validate_email(&req.email)?;
    validate_password(&req.password)?;
    let display_name = req.display_name.trim().to_string();
    if display_name.is_empty() || display_name.len() > 80 {
        return Err(AppError::Validation("invalid display name".into()));
    }

    if state
        .db
        .users()
        .find_one(doc! { "email": &email })
        .await?
        .is_some()
    {
        // Generic conflict; we still avoid leaking which step failed elsewhere.
        return Err(AppError::Conflict("email already registered".into()));
    }

    let now = Utc::now();
    let user = User {
        id: None,
        email: email.clone(),
        email_verified: false,
        password_hash: Some(
            password::hash_password(&req.password).map_err(|_| AppError::Internal("hash".into()))?,
        ),
        display_name,
        avatar_url: None,
        status: UserStatus::Unverified,
        role_ids: Vec::new(),
        created_at: now,
        updated_at: now,
        banned_reason: None,
        failed_login_attempts: 0,
        locked_until: None,
    };
    let inserted = state.db.users().insert_one(&user).await?;
    let user_id = inserted
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert id".into()))?;

    // Email verification token.
    let raw = token::generate_url_token();
    state
        .db
        .email_tokens()
        .insert_one(&EmailToken {
            id: None,
            user_id,
            kind: EmailTokenKind::Verification,
            token_hash: token::hash_url_token(&raw),
            new_email: None,
            created_at: now,
            expires_at: now + Duration::seconds(state.cfg.email_token_ttl_secs),
            used_at: None,
        })
        .await?;
    email::send_verification(&state, &email, &raw).await;

    let (access, refresh) =
        issue_session(&state, user_id, client_ip(&headers), user_agent(&headers)).await?;

    let mut created = user;
    created.id = Some(user_id);
    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &created).await?,
    }))
}

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginReq>,
) -> AppResult<Json<TokenResponse>> {
    let email = validate_email(&req.email)?;
    let now = Utc::now();
    let user_opt = state.db.users().find_one(doc! { "email": &email }).await?;

    // Lockout: block before even checking the password.
    if let Some(u) = &user_opt {
        if u.locked_until.map(|t| t > now).unwrap_or(false) {
            crate::security::log_event(&state, u.id, "login_blocked", &headers, doc! {}).await;
            return Err(AppError::Locked);
        }
    }

    // Constant-ish timing: always run a verify (dummy for unknown users) to
    // avoid user enumeration via response time.
    let dummy = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000";
    let ok = match &user_opt {
        Some(u) => match &u.password_hash {
            Some(h) => password::verify_password(&req.password, h).unwrap_or(false),
            None => {
                let _ = password::verify_password(&req.password, dummy);
                false
            }
        },
        None => {
            let _ = password::verify_password(&req.password, dummy);
            false
        }
    };

    if !ok {
        if let Some(u) = &user_opt {
            let attempts = u.failed_login_attempts + 1;
            let mut set = doc! { "failed_login_attempts": attempts as i32 };
            let lock = attempts >= state.cfg.max_failed_logins;
            if lock {
                set.insert(
                    "locked_until",
                    bson::DateTime::from_chrono(now + Duration::minutes(state.cfg.lockout_minutes)),
                );
                set.insert("failed_login_attempts", 0i32);
            }
            let _ = state
                .db
                .users()
                .update_one(doc! { "_id": u.id }, doc! { "$set": set })
                .await;
            crate::security::log_event(
                &state,
                u.id,
                if lock { "account_locked" } else { "login_failed" },
                &headers,
                doc! {},
            )
            .await;
            if lock {
                email::send_security_alert(
                    &state,
                    &u.email,
                    "Sua conta foi temporariamente bloqueada após várias tentativas de login.",
                )
                .await;
            }
        }
        return Err(AppError::InvalidCredentials);
    }

    let user = user_opt.expect("ok implies a user is present");

    // Reset counters on a successful login.
    if user.failed_login_attempts != 0 || user.locked_until.is_some() {
        let _ = state
            .db
            .users()
            .update_one(
                doc! { "_id": user.id },
                doc! { "$set": { "failed_login_attempts": 0i32 }, "$unset": { "locked_until": "" } },
            )
            .await;
    }

    if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
        return Err(AppError::Forbidden);
    }

    let user_id = user.id.ok_or_else(|| AppError::Internal("user id".into()))?;
    let (access, refresh) =
        issue_session(&state, user_id, client_ip(&headers), user_agent(&headers)).await?;

    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &user).await?,
    }))
}

// ----------------------------- Passwordless (email code) -----------------------------

/// Step 1 of passwordless auth. Sends a 6-digit code to the email. If no
/// account exists yet, one is created (registration == login). Always returns
/// `{ ok: true }` to avoid leaking which emails are registered.
pub async fn request_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RequestCodeReq>,
) -> AppResult<Json<serde_json::Value>> {
    let email = validate_email(&req.email)?;
    let now = Utc::now();

    // Find or create a passwordless user.
    let user = match state.db.users().find_one(doc! { "email": &email }).await? {
        Some(u) => u,
        None => {
            let display_name = req
                .display_name
                .as_deref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && s.len() <= 80)
                .unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_string());
            let mut user = User {
                id: None,
                email: email.clone(),
                email_verified: false,
                password_hash: None,
                display_name,
                avatar_url: None,
                status: UserStatus::Unverified,
                role_ids: Vec::new(),
                created_at: now,
                updated_at: now,
                banned_reason: None,
                failed_login_attempts: 0,
                locked_until: None,
            };
            let inserted = state.db.users().insert_one(&user).await?;
            user.id = inserted.inserted_id.as_object_id();
            crate::security::log_event(&state, user.id, "user_registered", &headers, doc! {}).await;
            user
        }
    };

    // Silently ignore banned/suspended accounts (still return ok).
    if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }

    let user_id = user.id.ok_or_else(|| AppError::Internal("user id".into()))?;

    // Anti email-bomb: if a code was just sent, don't send another (the existing
    // one is still valid). Returns ok so we don't leak the throttle either.
    let recent = state
        .db
        .email_tokens()
        .find_one(doc! {
            "user_id": user_id,
            "kind": "login_code",
            "used_at": null,
            "created_at": { "$gt": bson::DateTime::from_chrono(now - Duration::seconds(45)) },
        })
        .await?;
    if recent.is_some() {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }

    // Invalidate any previous unused codes for this user.
    let _ = state
        .db
        .email_tokens()
        .update_many(
            doc! { "user_id": user_id, "kind": "login_code", "used_at": null },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await;

    let code = token::generate_login_code();
    state
        .db
        .email_tokens()
        .insert_one(&EmailToken {
            id: None,
            user_id,
            kind: EmailTokenKind::LoginCode,
            token_hash: token::hash_refresh(&code, &state.cfg.auth_refresh_pepper),
            new_email: None,
            created_at: now,
            // Short-lived (minutes) — NOT the 24h email-link TTL.
            expires_at: now + Duration::seconds(state.cfg.login_code_ttl_secs),
            used_at: None,
        })
        .await?;
    email::send_login_code(&state, &email, &code).await;

    // No backup-code hint here — that would let an unauthenticated caller probe
    // which accounts have backup codes. The UI always offers "try another way".
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Step 2 of passwordless auth. Verifies the emailed code, marks the email as
/// verified (first successful code activates the account) and issues a session.
pub async fn verify_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<VerifyCodeReq>,
) -> AppResult<Json<TokenResponse>> {
    let email = validate_email(&req.email)?;
    let code = req.code.trim();
    if code.len() < 4 || code.len() > 10 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::InvalidCredentials);
    }
    let now = Utc::now();

    let user = state
        .db
        .users()
        .find_one(doc! { "email": &email })
        .await?
        .ok_or(AppError::InvalidCredentials)?;

    if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
        return Err(AppError::Forbidden);
    }
    check_lock(&user, now)?;
    let user_id = user.id.ok_or_else(|| AppError::Internal("user id".into()))?;

    let hash = token::hash_refresh(code, &state.cfg.auth_refresh_pepper);
    let tok = state
        .db
        .email_tokens()
        .find_one(doc! {
            "user_id": user_id,
            "kind": "login_code",
            "token_hash": &hash,
            "used_at": null,
        })
        .await?;

    let tok = match tok {
        Some(t) if t.expires_at > now => t,
        _ => {
            // Count the failure toward lockout (bounds brute force).
            register_failure(&state, &user).await;
            crate::security::log_event(
                &state,
                Some(user_id),
                "login_code_failed",
                &headers,
                doc! {},
            )
            .await;
            return Err(AppError::InvalidCredentials);
        }
    };
    clear_failures(&state, user_id).await;

    // Consume the code (single-use).
    state
        .db
        .email_tokens()
        .update_one(
            doc! { "_id": tok.id },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;

    // A successful code proves email ownership -> verify + activate.
    state
        .db
        .users()
        .update_one(
            doc! { "_id": user_id },
            doc! { "$set": {
                "email_verified": true,
                "status": "active",
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;

    let (access, refresh) =
        issue_session(&state, user_id, client_ip(&headers), user_agent(&headers)).await?;

    let mut u = user;
    u.email_verified = true;
    u.status = UserStatus::Active;

    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &u).await?,
    }))
}

pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RefreshReq>,
) -> AppResult<Json<TokenResponse>> {
    let (sid_hex, secret) = req
        .refresh_token
        .split_once('.')
        .ok_or(AppError::Unauthorized)?;
    let sid = ObjectId::parse_str(sid_hex).map_err(|_| AppError::Unauthorized)?;
    let presented = token::hash_refresh(secret, &state.cfg.auth_refresh_pepper);

    let session = state
        .db
        .sessions()
        .find_one(doc! { "_id": sid })
        .await?
        .ok_or(AppError::Unauthorized)?;

    if session.revoked || session.expires_at <= Utc::now() {
        return Err(AppError::Unauthorized);
    }

    // Reuse detection: a valid session but a stale refresh hash means the token
    // was already rotated -> likely theft. Revoke the whole session.
    if session.refresh_hash != presented {
        state
            .db
            .sessions()
            .update_one(
                doc! { "_id": sid },
                doc! { "$set": { "revoked": true, "revoked_reason": "refresh_reuse" }},
            )
            .await?;
        crate::security::log_event(
            &state,
            Some(session.user_id),
            "refresh_reuse",
            &headers,
            doc! { "session": sid },
        )
        .await;
        return Err(AppError::Unauthorized);
    }

    // Rotate.
    let new_version = session.token_version + 1;
    let rs = token::generate_refresh(&state.cfg.auth_refresh_pepper);
    let now = Utc::now();
    state
        .db
        .sessions()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": {
                "refresh_hash": &rs.hash,
                "token_version": new_version,
                "last_used_at": bson::DateTime::from_chrono(now),
                "ip": client_ip(&headers),
                "user_agent": user_agent(&headers),
            }},
        )
        .await?;

    let user = state
        .db
        .users()
        .find_one(doc! { "_id": session.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
        return Err(AppError::Forbidden);
    }

    let access = sign_access(&state, &session.user_id, &sid, new_version);
    let client_refresh = format!("{}.{}", sid.to_hex(), rs.raw);

    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: client_refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &user).await?,
    }))
}

pub async fn logout(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .sessions()
        .update_one(
            doc! { "_id": auth.session_id },
            doc! { "$set": { "revoked": true, "revoked_reason": "logout" }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn logout_all(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .sessions()
        .update_many(
            doc! { "user_id": auth.user_id, "revoked": false },
            doc! { "$set": { "revoked": true, "revoked_reason": "logout_all" }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn me(auth: AuthUser) -> Json<UserPublic> {
    Json(auth.public())
}

#[derive(Deserialize)]
pub struct UpdateProfileReq {
    pub display_name: String,
}

/// Update the caller's own profile (display name).
pub async fn update_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateProfileReq>,
) -> AppResult<Json<UserPublic>> {
    let name = req.display_name.trim().to_string();
    if name.is_empty() || name.len() > 80 {
        return Err(AppError::Validation("invalid display name".into()));
    }
    state
        .db
        .users()
        .update_one(
            doc! { "_id": auth.user_id },
            doc! { "$set": { "display_name": &name, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    let mut public = auth.public();
    public.display_name = name;
    Ok(Json(public))
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(req): Json<VerifyEmailReq>,
) -> AppResult<Json<serde_json::Value>> {
    let hash = token::hash_url_token(&req.token);
    let now = Utc::now();
    let tok = state
        .db
        .email_tokens()
        .find_one(doc! { "token_hash": &hash, "kind": "verification", "used_at": null })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if tok.expires_at <= now {
        return Err(AppError::Unauthorized);
    }

    state
        .db
        .email_tokens()
        .update_one(
            doc! { "_id": tok.id },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    state
        .db
        .users()
        .update_one(
            doc! { "_id": tok.user_id },
            doc! { "$set": { "email_verified": true, "status": "active", "updated_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn resend_verification(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    if auth.user.email_verified {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    let now = Utc::now();
    let raw = token::generate_url_token();
    state
        .db
        .email_tokens()
        .insert_one(&EmailToken {
            id: None,
            user_id: auth.user_id,
            kind: EmailTokenKind::Verification,
            token_hash: token::hash_url_token(&raw),
            new_email: None,
            created_at: now,
            expires_at: now + Duration::seconds(state.cfg.email_token_ttl_secs),
            used_at: None,
        })
        .await?;
    email::send_verification(&state, &auth.user.email, &raw).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Json(req): Json<ForgotReq>,
) -> AppResult<Json<serde_json::Value>> {
    let email = validate_email(&req.email)?;
    // Always return ok to prevent user enumeration.
    if let Some(user) = state.db.users().find_one(doc! { "email": &email }).await? {
        if user.password_hash.is_some() {
            let now = Utc::now();
            let raw = token::generate_url_token();
            let user_id = user.id.unwrap_or_default();
            state
                .db
                .email_tokens()
                .insert_one(&EmailToken {
                    id: None,
                    user_id,
                    kind: EmailTokenKind::PasswordReset,
                    token_hash: token::hash_url_token(&raw),
                    new_email: None,
                    created_at: now,
                    expires_at: now + Duration::seconds(state.cfg.email_token_ttl_secs),
                    used_at: None,
                })
                .await?;
            email::send_password_reset(&state, &email, &raw).await;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Json(req): Json<ResetReq>,
) -> AppResult<Json<serde_json::Value>> {
    validate_password(&req.new_password)?;
    let hash = token::hash_url_token(&req.token);
    let now = Utc::now();
    let tok = state
        .db
        .email_tokens()
        .find_one(doc! { "token_hash": &hash, "kind": "password_reset", "used_at": null })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if tok.expires_at <= now {
        return Err(AppError::Unauthorized);
    }

    let new_hash =
        password::hash_password(&req.new_password).map_err(|_| AppError::Internal("hash".into()))?;

    state
        .db
        .email_tokens()
        .update_one(
            doc! { "_id": tok.id },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    state
        .db
        .users()
        .update_one(
            doc! { "_id": tok.user_id },
            doc! { "$set": { "password_hash": new_hash, "updated_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    // Invalidate every session: a password reset means possible compromise.
    state
        .db
        .sessions()
        .update_many(
            doc! { "user_id": tok.user_id, "revoked": false },
            doc! { "$set": { "revoked": true, "revoked_reason": "password_reset" }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn change_password(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChangePasswordReq>,
) -> AppResult<Json<serde_json::Value>> {
    validate_password(&req.new_password)?;
    let current = auth
        .user
        .password_hash
        .as_deref()
        .ok_or(AppError::Forbidden)?;
    if !password::verify_password(&req.current_password, current).unwrap_or(false) {
        return Err(AppError::InvalidCredentials);
    }

    let new_hash =
        password::hash_password(&req.new_password).map_err(|_| AppError::Internal("hash".into()))?;
    let now = Utc::now();
    state
        .db
        .users()
        .update_one(
            doc! { "_id": auth.user_id },
            doc! { "$set": { "password_hash": new_hash, "updated_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    // Revoke all OTHER sessions; keep the current one alive.
    state
        .db
        .sessions()
        .update_many(
            doc! { "user_id": auth.user_id, "_id": { "$ne": auth.session_id }, "revoked": false },
            doc! { "$set": { "revoked": true, "revoked_reason": "password_change" }},
        )
        .await?;
    email::send_security_alert(&state, &auth.user.email, "Sua senha foi alterada.").await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ChangeEmailReq {
    pub new_email: String,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct ConfirmEmailChangeReq {
    pub token: String,
}

pub async fn change_email(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ChangeEmailReq>,
) -> AppResult<Json<serde_json::Value>> {
    let new_email = validate_email(&req.new_email)?;
    if new_email == auth.user.email {
        return Err(AppError::Validation("email unchanged".into()));
    }
    // Require the current password if the account has one.
    if let Some(h) = auth.user.password_hash.as_deref() {
        let pw = req
            .password
            .as_deref()
            .ok_or_else(|| AppError::Validation("password required".into()))?;
        if !password::verify_password(pw, h).unwrap_or(false) {
            return Err(AppError::InvalidCredentials);
        }
    }
    if state.db.users().find_one(doc! { "email": &new_email }).await?.is_some() {
        return Err(AppError::Conflict("email already in use".into()));
    }

    let now = Utc::now();
    let raw = token::generate_url_token();
    state
        .db
        .email_tokens()
        .insert_one(&EmailToken {
            id: None,
            user_id: auth.user_id,
            kind: EmailTokenKind::EmailChange,
            token_hash: token::hash_url_token(&raw),
            new_email: Some(new_email.clone()),
            created_at: now,
            expires_at: now + Duration::seconds(state.cfg.email_token_ttl_secs),
            used_at: None,
        })
        .await?;
    // Verification link goes to the NEW address (must prove ownership).
    email::send_email_change(&state, &new_email, &raw).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn confirm_email_change(
    State(state): State<AppState>,
    Json(req): Json<ConfirmEmailChangeReq>,
) -> AppResult<Json<serde_json::Value>> {
    let hash = token::hash_url_token(&req.token);
    let now = Utc::now();
    let tok = state
        .db
        .email_tokens()
        .find_one(doc! { "token_hash": &hash, "kind": "email_change", "used_at": null })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if tok.expires_at <= now {
        return Err(AppError::Unauthorized);
    }
    let new_email = tok
        .new_email
        .clone()
        .ok_or_else(|| AppError::Internal("missing target email".into()))?;
    // Race guard: target may have been taken between request and confirm.
    if state.db.users().find_one(doc! { "email": &new_email }).await?.is_some() {
        return Err(AppError::Conflict("email already in use".into()));
    }

    state
        .db
        .email_tokens()
        .update_one(
            doc! { "_id": tok.id },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    let old = state.db.users().find_one(doc! { "_id": tok.user_id }).await?;
    state
        .db
        .users()
        .update_one(
            doc! { "_id": tok.user_id },
            doc! { "$set": { "email": &new_email, "email_verified": true, "updated_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    if let Some(u) = old {
        email::send_security_alert(&state, &u.email, "O e-mail da sua conta foi alterado.").await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
