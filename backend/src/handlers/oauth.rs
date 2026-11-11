//! OAuth HTTP flow for Discord and GitHub.

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::{Duration, Utc};
use serde::Deserialize;

use crate::{
    auth::token,
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    handlers::auth::{issue_session, public_user, TokenResponse},
    handlers::{client_ip, user_agent},
    models::{OAuthAccount, OAuthExchange, User, UserStatus},
    oauth::{self, Provider},
    state::AppState,
};

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

fn provider_or_404(p: &str) -> AppResult<Provider> {
    Provider::parse(p).ok_or(AppError::NotFound)
}

/// GET /oauth/:provider/start -> redirect to the provider.
pub async fn start(
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> AppResult<Redirect> {
    let provider = provider_or_404(&provider)?;
    let st = oauth::OAuthState {
        nonce: oauth::new_nonce(),
        provider: provider.as_str().into(),
        intent: "login".into(),
        uid: None,
        exp: Utc::now().timestamp() + 600,
    };
    let signed = oauth::sign_state(&state.cfg.auth_token_secret, &st);
    let url = oauth::authorize_url(&state, provider, &signed, false)?;
    Ok(Redirect::to(&url))
}

/// POST /oauth/:provider/link -> returns the authorize URL (intent=link).
pub async fn link(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let provider = provider_or_404(&provider)?;
    let st = oauth::OAuthState {
        nonce: oauth::new_nonce(),
        provider: provider.as_str().into(),
        intent: "link".into(),
        uid: Some(auth.user_id.to_hex()),
        exp: Utc::now().timestamp() + 600,
    };
    let signed = oauth::sign_state(&state.cfg.auth_token_secret, &st);
    // Link requests the `repo` scope (GitHub) so we can deploy from repos.
    let url = oauth::authorize_url(&state, provider, &signed, true)?;
    Ok(Json(serde_json::json!({ "authorize_url": url })))
}

/// DELETE /oauth/:provider/unlink
pub async fn unlink(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let provider = provider_or_404(&provider)?;

    // Never let a user remove their last way to sign in.
    let count = state
        .db
        .oauth_accounts()
        .count_documents(doc! { "user_id": auth.user_id })
        .await?;
    if auth.user.password_hash.is_none() && count <= 1 {
        return Err(AppError::Conflict(
            "set a password before unlinking your last provider".into(),
        ));
    }

    state
        .db
        .oauth_accounts()
        .delete_one(doc! { "user_id": auth.user_id, "provider": provider.as_str() })
        .await?;
    // Drop the stored GitHub token so a stale credential isn't retained.
    if provider.as_str() == "github" {
        // First (while the token is still valid) delete every auto-deploy webhook
        // this user registered, and clear the containers' auto-deploy fields.
        if let Ok(token) = crate::handlers::account::github_token(&state, &auth) {
            let mut targets: Vec<(ObjectId, String, i64)> = Vec::new();
            if let Ok(mut cur) = state
                .db
                .servers()
                .find(doc! { "type": 1, "user_id": auth.user_id })
                .await
            {
                while cur.advance().await.unwrap_or(false) {
                    if let Ok(s) = cur.deserialize_current() {
                        if let (Some(sid), Some(c)) = (s.id, s.container.as_ref()) {
                            if let (Some(hid), Some(repo)) =
                                (c.github_hook_id, c.github_repo.clone())
                            {
                                targets.push((sid, repo, hid));
                            }
                        }
                    }
                }
            }
            for (sid, repo, hid) in targets {
                crate::handlers::containers::disable_auto_deploy(
                    &state,
                    sid,
                    Some((&repo, hid, &token)),
                )
                .await;
            }
        }
        let _ = state
            .db
            .users()
            .update_one(
                doc! { "_id": auth.user_id },
                doc! { "$unset": { "github_access_token": "", "github_username": "" } },
            )
            .await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /oauth/:provider/callback
pub async fn callback(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<CallbackQuery>,
) -> Response {
    match callback_inner(&state, &provider, q).await {
        Ok(url) => Redirect::to(&url).into_response(),
        Err(_) => {
            let url = format!("{}/login?error=oauth", state.cfg.public_app_url);
            Redirect::to(&url).into_response()
        }
    }
}

async fn callback_inner(
    state: &AppState,
    provider_str: &str,
    q: CallbackQuery,
) -> AppResult<String> {
    let provider = provider_or_404(provider_str)?;
    if q.error.is_some() {
        return Err(AppError::Unauthorized);
    }
    let code = q.code.ok_or(AppError::Unauthorized)?;
    let raw_state = q.state.ok_or(AppError::Unauthorized)?;

    let st = oauth::verify_state(
        &state.cfg.auth_token_secret,
        &raw_state,
        Utc::now().timestamp(),
    )
    .ok_or(AppError::Unauthorized)?;
    if st.provider != provider.as_str() {
        return Err(AppError::Unauthorized);
    }

    let info = oauth::complete(state, provider, &code).await?;

    let (user_id, is_link) = resolve_user(state, provider, &info, &st).await?;

    // Keep the profile picture fresh from the provider on every login.
    if !is_link {
        if let Some(avatar) = &info.avatar_url {
            let _ = state
                .db
                .users()
                .update_one(
                    doc! { "_id": user_id },
                    doc! { "$set": { "avatar_url": avatar } },
                )
                .await;
        }
    }

    if is_link {
        return Ok(format!(
            "{}/dashboard?linked={}",
            state.cfg.public_app_url,
            provider.as_str()
        ));
    }

    // Don't put the refresh token in the URL (logs/history/Referer leak).
    // Instead hand the browser a single-use, 60s exchange code that the frontend
    // swaps for a session server-to-server.
    let raw = token::generate_url_token();
    let now = Utc::now();
    state
        .db
        .oauth_exchanges()
        .insert_one(&OAuthExchange {
            id: None,
            code_hash: token::hash_url_token(&raw),
            user_id,
            created_at: now,
            expires_at: now + Duration::seconds(60),
            used_at: None,
        })
        .await?;
    Ok(format!(
        "{}/oauth/callback?code={}",
        state.cfg.public_app_url, raw
    ))
}

#[derive(Deserialize)]
pub struct ExchangeReq {
    pub code: String,
}

/// POST /oauth/exchange — swap a single-use OAuth code for a session.
pub async fn exchange(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ExchangeReq>,
) -> AppResult<Json<TokenResponse>> {
    let now = Utc::now();
    let code_hash = token::hash_url_token(req.code.trim());
    let ex = state
        .db
        .oauth_exchanges()
        .find_one(doc! { "code_hash": &code_hash, "used_at": null })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if ex.expires_at <= now {
        return Err(AppError::Unauthorized);
    }
    // Atomic single-use: only the request that flips `used_at` proceeds (closes
    // the race where two requests redeem the same code).
    let claimed = state
        .db
        .oauth_exchanges()
        .update_one(
            doc! { "_id": ex.id, "used_at": null },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    if claimed.matched_count == 0 {
        return Err(AppError::Unauthorized);
    }

    let user = state
        .db
        .users()
        .find_one(doc! { "_id": ex.user_id })
        .await?
        .ok_or(AppError::Unauthorized)?;
    if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
        return Err(AppError::Forbidden);
    }

    let (access, refresh) = issue_session(
        &state,
        ex.user_id,
        client_ip(&headers),
        user_agent(&headers),
    )
    .await?;
    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &user).await?,
    }))
}

/// Returns (user_id, is_link_flow).
async fn resolve_user(
    state: &AppState,
    provider: Provider,
    info: &oauth::OAuthUserInfo,
    st: &oauth::OAuthState,
) -> AppResult<(ObjectId, bool)> {
    // 1) Already linked? -> log in as that user.
    if let Some(acc) = state
        .db
        .oauth_accounts()
        .find_one(
            doc! { "provider": provider.as_str(), "provider_user_id": &info.provider_user_id },
        )
        .await?
    {
        if st.intent == "link" {
            // Linking a provider identity that belongs to a different user.
            let uid = st.uid.as_deref().and_then(|u| ObjectId::parse_str(u).ok());
            if uid != Some(acc.user_id) {
                return Err(AppError::Conflict(
                    "provider already linked to another account".into(),
                ));
            }
            // Re-linking refreshes an expired / newly repo-scoped token.
            store_github_token(state, acc.user_id, provider, info).await?;
            return Ok((acc.user_id, true));
        }
        return Ok((acc.user_id, false));
    }

    // 2) Link flow: attach to the authenticated user.
    if st.intent == "link" {
        let uid = st
            .uid
            .as_deref()
            .and_then(|u| ObjectId::parse_str(u).ok())
            .ok_or(AppError::Unauthorized)?;
        if state
            .db
            .users()
            .find_one(doc! { "_id": uid })
            .await?
            .is_none()
        {
            return Err(AppError::Unauthorized);
        }
        create_link(state, uid, provider, info).await?;
        store_github_token(state, uid, provider, info).await?;
        return Ok((uid, true));
    }

    // 3) Login/register. Require a provider-verified email to be safe.
    let email = match (&info.email, info.email_verified) {
        (Some(e), true) => e.clone(),
        _ => return Err(AppError::Validation("verified email required".into())),
    };

    // 3a) Existing local account with this email. Only auto-link when that
    // account is ALREADY email-verified — never silently take over an
    // unverified shell (e.g. one created by an abandoned login-code request).
    if let Some(u) = state.db.users().find_one(doc! { "email": &email }).await? {
        if !u.email_verified {
            return Err(AppError::Conflict(
                "an account with this email exists — sign in and link the provider".into(),
            ));
        }
        let uid = u.id.ok_or_else(|| AppError::Internal("user id".into()))?;
        create_link(state, uid, provider, info).await?;
        crate::email::send_security_alert(
            state,
            &u.email,
            &format!(
                "Sua conta foi vinculada ao login via {}.",
                provider.as_str()
            ),
        )
        .await;
        return Ok((uid, false));
    }

    // 3b) Brand new user.
    let now = Utc::now();
    let user = User {
        id: None,
        email: email.clone(),
        email_verified: true,
        password_hash: None,
        display_name: info.display_name.clone(),
        avatar_url: info.avatar_url.clone(),
        status: UserStatus::Active,
        role_ids: Vec::new(),
        created_at: now,
        updated_at: now,
        banned_reason: None,
        failed_login_attempts: 0,
        locked_until: None,
        github_access_token: None,
        github_username: None,
        free_ram_claimed: false,
        bonus_ram_mb: None,
        bonus_ram_expires_at: None,
    };
    let inserted = state.db.users().insert_one(&user).await?;
    let uid = inserted
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert id".into()))?;
    create_link(state, uid, provider, info).await?;
    Ok((uid, false))
}

/// After a GitHub *link*, store the (sealed) access token + username so we can
/// list repos and deploy. No-op for other providers / login flows.
async fn store_github_token(
    state: &AppState,
    user_id: ObjectId,
    provider: Provider,
    info: &oauth::OAuthUserInfo,
) -> AppResult<()> {
    if provider.as_str() != "github" {
        return Ok(());
    }
    let enc = crate::secretbox::seal(&state.cfg.auth_token_secret, info.access_token.as_bytes())?;
    state
        .db
        .users()
        .update_one(
            doc! { "_id": user_id },
            doc! { "$set": {
                "github_access_token": enc,
                "github_username": info.username.clone(),
            }},
        )
        .await?;
    Ok(())
}

async fn create_link(
    state: &AppState,
    user_id: ObjectId,
    provider: Provider,
    info: &oauth::OAuthUserInfo,
) -> AppResult<()> {
    let acc = OAuthAccount {
        id: None,
        user_id,
        provider: provider.as_str().into(),
        provider_user_id: info.provider_user_id.clone(),
        email: info.email.clone(),
        created_at: Utc::now(),
    };
    state
        .db
        .oauth_accounts()
        .insert_one(&acc)
        .await
        .map_err(|e| {
            if e.to_string().contains("E11000") {
                AppError::Conflict("provider already linked".into())
            } else {
                AppError::Db(e)
            }
        })?;
    Ok(())
}
