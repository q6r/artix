pub mod admin;
pub mod admin_plans;
pub mod admin_relays;
pub mod admin_storage;
pub mod admin_servers;
pub mod announcements;
pub mod auth;
pub mod avatar;
pub mod backup;
pub mod billing;
pub mod containers;
pub mod dedicated_ip;
pub mod dev;
pub mod health;
pub mod keys;
pub mod notifications;
pub mod upgrade;
pub mod oauth;
pub mod orgs;
pub mod servers;
pub mod sessions;
pub mod term;
pub mod vm_agent;
pub mod tickets;
pub mod webhooks;

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Best-effort client IP for rate-limit/audit keying. Prefers Cloudflare's
/// `CF-Connecting-IP` — the edge sets it and strips any client-supplied copy, so
/// (unlike the first `X-Forwarded-For` element) a client can't spoof it to rotate
/// rate-limit buckets. Falls back to XFF/`x-real-ip` when not behind Cloudflare.
pub fn client_ip(headers: &HeaderMap) -> String {
    if let Some(ip) = headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return ip.to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
        })
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
