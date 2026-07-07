//! API key management for developers. A user mints keys scoped to (a subset
//! of) their own permissions; the full secret is shown exactly once.

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::token,
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{ApiKey, ApiKeyPublic},
    permissions::cap,
    state::AppState,
};

#[derive(Deserialize)]
pub struct CreateKeyReq {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub expires_in_days: Option<i64>,
}

#[derive(Serialize)]
pub struct CreateKeyResponse {
    /// Shown ONCE. Store it now — it cannot be retrieved again.
    pub key: String,
    #[serde(flatten)]
    pub meta: ApiKeyPublic,
}

fn validate_scopes(scopes: &[String]) -> AppResult<()> {
    if scopes.is_empty() {
        return Err(AppError::Validation(
            "select at least one permission for the key".into(),
        ));
    }
    for s in scopes {
        if !cap::is_valid(s) {
            return Err(AppError::Validation(format!("unknown permission: {s}")));
        }
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateKeyReq>,
) -> AppResult<Json<CreateKeyResponse>> {
    auth.require_session()?; // an API key cannot mint more keys
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::Validation("invalid key name".into()));
    }
    validate_scopes(&req.scopes)?;

    let secret = token::generate_url_token();
    let key = format!("ak_{secret}");
    let hash = token::hash_refresh(&key, &state.cfg.auth_refresh_pepper);
    let prefix = format!("{}…", &key[..key.len().min(14)]);
    let now = Utc::now();

    let api_key = ApiKey {
        id: None,
        user_id: auth.user_id,
        name,
        prefix,
        key_hash: hash,
        scopes: req.scopes,
        created_at: now,
        last_used_at: None,
        expires_at: req.expires_in_days.map(|d| now + Duration::days(d)),
        revoked: false,
    };
    let inserted = state.db.api_keys().insert_one(&api_key).await?;
    let mut saved = api_key;
    saved.id = inserted.inserted_id.as_object_id();

    Ok(Json(CreateKeyResponse {
        key,
        meta: saved.public(),
    }))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ApiKeyPublic>>> {
    let mut cursor = state
        .db
        .api_keys()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require_session()?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state
        .db
        .api_keys()
        .update_one(
            doc! { "_id": oid, "user_id": auth.user_id },
            doc! { "$set": { "revoked": true }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
