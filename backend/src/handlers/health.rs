use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::{db::Collections, state::AppState};

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// Readiness includes a DB round-trip.
pub async fn ready(State(state): State<AppState>) -> Json<Value> {
    let ok = state.db.users().estimated_document_count().await.is_ok();
    Json(json!({ "status": if ok { "ready" } else { "degraded" }, "db": ok }))
}
