//! Minimal fixed-window per-IP rate limiter as Axum middleware.

use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::HeaderMap,
    middleware::Next,
    response::Response,
};

use crate::{error::AppError, handlers::client_ip, state::AppState};

const WINDOW: Duration = Duration::from_secs(60);

fn check(state: &AppState, scope: &str, ip: &str, limit: u32) -> bool {
    let key = format!("{scope}:{ip}");
    let now = Instant::now();
    let mut map = state.rate.lock().unwrap();

    // Opportunistic cleanup to bound memory.
    if map.len() > 50_000 {
        map.retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
    }

    let entry = map.entry(key).or_insert((now, 0));
    if now.duration_since(entry.0) >= WINDOW {
        *entry = (now, 0);
    }
    entry.1 += 1;
    entry.1 <= limit
}

/// Tighter limit for auth endpoints (brute-force / credential-stuffing).
pub async fn auth_limiter(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = client_ip(&headers);
    if !check(&state, "auth", &ip, state.cfg.auth_rate_limit_per_min) {
        return Err(AppError::RateLimited);
    }
    Ok(next.run(req).await)
}

/// Global limit for everything else.
pub async fn global_limiter(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = client_ip(&headers);
    if !check(&state, "global", &ip, state.cfg.rate_limit_per_min) {
        return Err(AppError::RateLimited);
    }
    Ok(next.run(req).await)
}
