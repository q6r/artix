//! In-app notifications (the dashboard bell). Each notification is persisted and
//! pushed live to the owner's `user:<id>` socket topic.

use bson::{doc, oid::ObjectId};
use chrono::Utc;

use crate::{db::Collections, models::Notification, state::AppState};

/// Create a notification for `user_id` and push it live (best-effort).
pub async fn notify(
    state: &AppState,
    user_id: ObjectId,
    kind: &str,
    title: impl Into<String>,
    body: impl Into<String>,
    link: Option<String>,
) {
    let mut n = Notification {
        id: None,
        user_id,
        kind: kind.to_string(),
        title: title.into(),
        body: body.into(),
        read: false,
        link,
        created_at: Utc::now(),
    };
    match state.db.notifications().insert_one(&n).await {
        Ok(res) => n.id = res.inserted_id.as_object_id(),
        Err(e) => {
            tracing::warn!(error = %e, "notification insert failed");
            return;
        }
    }
    let unread = state
        .db
        .notifications()
        .count_documents(doc! { "user_id": user_id, "read": false })
        .await
        .unwrap_or(0);
    crate::ws::publish(
        state,
        format!("user:{}", user_id.to_hex()),
        "notification",
        serde_json::json!({ "notification": n.public(), "unread": unread }),
    );
}
