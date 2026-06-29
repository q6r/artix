pub mod admin;
pub mod admin_plans;
pub mod admin_relays;
pub mod admin_servers;
pub mod announcements;
pub mod auth;
pub mod avatar;
pub mod backup;
pub mod billing;
pub mod dedicated_ip;
pub mod dev;
pub mod health;
pub mod keys;
pub mod notifications;
pub mod oauth;
pub mod orgs;
pub mod servers;
pub mod sessions;
pub mod vm_agent;
pub mod tickets;
pub mod webhooks;

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Best-effort client IP (trusts the reverse proxy's `x-forwarded-for`).
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn user_agent(headers: &HeaderMap) -> String {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string()
}

/// Placeholder for routes that are wired but not yet implemented.
pub fn not_implemented() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": { "code": "not_implemented", "message": "Not implemented yet" }})),
    )
        .into_response()
}
