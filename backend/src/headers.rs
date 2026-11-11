//! Security response headers. The proxy may also set these; doing it in-app
//! guarantees they're present even if the proxy config drifts.

use axum::{
    extract::{Request, State},
    http::{HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

pub async fn security_headers(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();

    let set = |h: &mut axum::http::HeaderMap, name: &'static str, val: &'static str| {
        h.insert(HeaderName::from_static(name), HeaderValue::from_static(val));
    };

    set(h, "x-content-type-options", "nosniff");
    set(h, "x-frame-options", "DENY");
    set(h, "referrer-policy", "no-referrer");
    set(h, "cross-origin-opener-policy", "same-origin");
    set(h, "cross-origin-resource-policy", "same-site");
    // This is a JSON API, so the strictest CSP is appropriate.
    set(
        h,
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'",
    );
    set(
        h,
        "permissions-policy",
        "geolocation=(), microphone=(), camera=()",
    );

    if state.cfg.env.is_production() {
        set(
            h,
            "strict-transport-security",
            "max-age=63072000; includeSubDomains; preload",
        );
    }
    res
}
