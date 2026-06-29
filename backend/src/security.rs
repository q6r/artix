//! Security event log + admin audit log helpers. Best-effort: a logging failure
//! must never break the request, but is itself logged.

use axum::http::HeaderMap;
use bson::{oid::ObjectId, Document};
use chrono::Utc;

use crate::{
    db::Collections,
    handlers::{client_ip, user_agent},
    models::{AuditLog, SecurityEvent},
    state::AppState,
};

pub async fn log_event(
    state: &AppState,
    user_id: Option<ObjectId>,
    kind: &str,
    headers: &HeaderMap,
    metadata: Document,
) {
    let ev = SecurityEvent {
        id: None,
        user_id,
        kind: kind.to_string(),
        ip: client_ip(headers),
        user_agent: user_agent(headers),
        metadata,
        created_at: Utc::now(),
    };
    if let Err(e) = state.db.security_events().insert_one(&ev).await {
        tracing::error!(error = %e, "failed to write security event");
    }
}

pub async fn audit(
    state: &AppState,
    actor_id: ObjectId,
    action: &str,
    target_id: Option<ObjectId>,
    headers: &HeaderMap,
    metadata: Document,
) {
    let log = AuditLog {
        id: None,
        actor_id,
        action: action.to_string(),
        target_id,
        metadata,
        ip: client_ip(headers),
        created_at: Utc::now(),
    };
    if let Err(e) = state.db.audit_logs().insert_one(&log).await {
        tracing::error!(error = %e, "failed to write audit log");
    }
}
