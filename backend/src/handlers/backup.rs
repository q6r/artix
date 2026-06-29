//! Backup codes: single-use 8-char alphanumeric codes a user can use to sign in
//! when they can't receive the email code. Six are issued at a time; they are
//! stored hashed (pepper) and never shown again after generation.

use axum::{extract::State, http::HeaderMap, Json};
use bson::doc;
use chrono::Utc;
use serde::Deserialize;

use crate::{
    auth::token,
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::BackupCode,
    state::AppState,
};

use super::auth::{issue_session, public_user, validate_email, TokenResponse};
use super::{client_ip, user_agent};

const CODE_COUNT: usize = 6;

/// (Re)generate the user's backup codes, returning the plaintext ONCE.
pub async fn generate(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    // Regenerating replaces any existing set.
    let _ = state
        .db
        .backup_codes()
        .delete_many(doc! { "user_id": auth.user_id })
        .await;

    let now = Utc::now();
    let mut codes = Vec::with_capacity(CODE_COUNT);
    let mut docs = Vec::with_capacity(CODE_COUNT);
    for _ in 0..CODE_COUNT {
        let code = token::generate_backup_code();
        docs.push(BackupCode {
            id: None,
            user_id: auth.user_id,
            code_hash: token::hash_refresh(&code, &state.cfg.auth_refresh_pepper),
            created_at: now,
            used_at: None,
        });
        codes.push(code);
    }
    state.db.backup_codes().insert_many(&docs).await?;

    crate::email::send_security_alert(
        &state,
        &auth.user.email,
        "Novos códigos de backup foram gerados para sua conta.",
    )
    .await;

    Ok(Json(serde_json::json!({ "codes": codes })))
}

/// How many unused backup codes remain (no codes are ever returned here).
pub async fn status(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let remaining = state
        .db
        .backup_codes()
        .count_documents(doc! { "user_id": auth.user_id, "used_at": null })
        .await?;
    Ok(Json(serde_json::json!({ "enabled": remaining > 0, "remaining": remaining })))
}

/// Disable backup codes entirely.
pub async fn disable(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .backup_codes()
        .delete_many(doc! { "user_id": auth.user_id })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct VerifyBackupReq {
    pub email: String,
    pub code: String,
}

/// Sign in with a backup code (alternative to the emailed code). Single-use.
pub async fn verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<VerifyBackupReq>,
) -> AppResult<Json<TokenResponse>> {
    let email = validate_email(&req.email)?;
    let code: String = req
        .code
        .trim()
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if code.len() != 8 {
        return Err(AppError::InvalidCredentials);
    }
    let now = Utc::now();

    let user = state
        .db
        .users()
        .find_one(doc! { "email": &email })
        .await?
        .ok_or(AppError::InvalidCredentials)?;
    if matches!(
        user.status,
        crate::models::UserStatus::Banned | crate::models::UserStatus::Suspended
    ) {
        return Err(AppError::Forbidden);
    }
    super::auth::check_lock(&user, now)?;
    let user_id = user.id.ok_or_else(|| AppError::Internal("user id".into()))?;

    let hash = token::hash_refresh(&code, &state.cfg.auth_refresh_pepper);
    let entry = state
        .db
        .backup_codes()
        .find_one(doc! { "user_id": user_id, "code_hash": &hash, "used_at": null })
        .await?;
    let Some(entry) = entry else {
        super::auth::register_failure(&state, &user).await;
        crate::security::log_event(&state, Some(user_id), "backup_code_failed", &headers, doc! {})
            .await;
        return Err(AppError::InvalidCredentials);
    };
    super::auth::clear_failures(&state, user_id).await;

    // Consume the code (single-use).
    state
        .db
        .backup_codes()
        .update_one(
            doc! { "_id": entry.id },
            doc! { "$set": { "used_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;

    let (access, refresh) =
        issue_session(&state, user_id, client_ip(&headers), user_agent(&headers)).await?;

    Ok(Json(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.cfg.access_ttl_secs,
        user: public_user(&state, &user).await?,
    }))
}
