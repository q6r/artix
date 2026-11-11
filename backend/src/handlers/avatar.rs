//! Avatar proxy. We never persist the image bytes nor expose the provider's
//! (potentially short-lived) CDN URL to the client. Instead we keep the source
//! URL on the user (refreshed on every OAuth login) and stream it through here
//! with cache headers, so the browser caches it and the URL can't go stale in
//! the client.

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bson::{doc, oid::ObjectId};

use crate::{db::Collections, state::AppState};

/// Hosts we are willing to fetch avatars from. Avatar URLs only ever come from
/// our OAuth providers, so allow-listing their CDNs makes this proxy SSRF-proof
/// (no internal IPs / metadata service / arbitrary hosts).
const ALLOWED_AVATAR_HOSTS: &[&str] = &["cdn.discordapp.com", "avatars.githubusercontent.com"];

const MAX_AVATAR_BYTES: usize = 4 * 1024 * 1024; // 4 MB

fn allowed(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) => {
            u.scheme() == "https"
                && u.host_str()
                    .is_some_and(|h| ALLOWED_AVATAR_HOSTS.contains(&h))
        }
        Err(_) => false,
    }
}

/// GET /avatar/:id — public; returns the user's profile picture or 404.
pub async fn avatar(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(oid) = ObjectId::parse_str(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let url = match state.db.users().find_one(doc! { "_id": oid }).await {
        Ok(Some(u)) => match u.avatar_url {
            Some(u) => u,
            None => return StatusCode::NOT_FOUND.into_response(),
        },
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    // SSRF guard: only fetch https URLs on the known provider CDNs.
    if !allowed(&url) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let res = match state
        .http
        .get(&url)
        .header(reqwest::header::USER_AGENT, "ArtixCloud")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    // Only echo image content types; anything else is treated as not-found.
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    if !content_type.starts_with("image/") {
        return StatusCode::NOT_FOUND.into_response();
    }

    match res.bytes().await {
        Ok(bytes) if bytes.len() <= MAX_AVATAR_BYTES => (
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "public, max-age=21600".to_string()),
            ],
            bytes,
        )
            .into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
