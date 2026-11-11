//! Session management for the authenticated user. Strict ownership checks make
//! these endpoints IDOR-proof: a user can only see/revoke their OWN sessions.

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize)]
pub struct SessionView {
    pub id: String,
    pub ip: String,
    pub user_agent: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub current: bool,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<SessionView>>> {
    let mut cursor = state
        .db
        .sessions()
        .find(doc! { "user_id": auth.user_id, "revoked": false })
        .await?;

    let mut out = Vec::new();
    while cursor.advance().await? {
        let s = cursor.deserialize_current()?;
        let id = s.id.unwrap_or_default();
        out.push(SessionView {
            id: id.to_hex(),
            ip: s.ip,
            user_agent: s.user_agent,
            created_at: s.created_at,
            last_used_at: s.last_used_at,
            current: id == auth.session_id,
        });
    }
    Ok(Json(out))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let sid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state
        .db
        .sessions()
        // Ownership baked into the filter -> cannot revoke someone else's session.
        .update_one(
            doc! { "_id": sid, "user_id": auth.user_id },
            doc! { "$set": { "revoked": true, "revoked_reason": "user_revoked" }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
