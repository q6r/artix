//! Dashboard notifications: list recent + unread count, and mark all read.

use axum::{extract::State, Json};
use bson::doc;
use serde::Serialize;

use crate::{
    authn::AuthUser, db::Collections, error::AppResult, models::NotificationPublic, state::AppState,
};

#[derive(Serialize)]
pub struct NotificationsResponse {
    pub items: Vec<NotificationPublic>,
    pub unread: u64,
}

/// GET /notifications — the caller's 30 most recent notifications + unread count.
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<NotificationsResponse>> {
    let mut cursor = state
        .db
        .notifications()
        .find(doc! { "user_id": auth.user_id })
        .sort(doc! { "created_at": -1 })
        .limit(30)
        .await?;
    let mut items = Vec::new();
    while cursor.advance().await? {
        items.push(cursor.deserialize_current()?.public());
    }
    let unread = state
        .db
        .notifications()
        .count_documents(doc! { "user_id": auth.user_id, "read": false })
        .await?;
    Ok(Json(NotificationsResponse { items, unread }))
}

/// POST /notifications/read — mark every notification of the caller as read.
pub async fn mark_read(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    state
        .db
        .notifications()
        .update_many(
            doc! { "user_id": auth.user_id, "read": false },
            doc! { "$set": { "read": true }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
