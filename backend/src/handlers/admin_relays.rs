//! Admin relay management: list the configured frp relays (with live usage) and
//! enable/disable each one. Gated on the `relays.*` permissions.

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;

use crate::{
    authn::AuthUser,
    error::{AppError, AppResult},
    frp::RelayInfo,
    permissions::perm,
    state::AppState,
};

fn frp(state: &AppState) -> AppResult<&crate::frp::Frp> {
    state
        .frp
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("relays not configured".into()))
}

pub async fn list(State(state): State<AppState>, auth: AuthUser) -> AppResult<Json<Vec<RelayInfo>>> {
    auth.require(perm::RELAYS_READ)?;
    Ok(Json(frp(&state)?.admin_list(&state).await?))
}

#[derive(Deserialize)]
pub struct ToggleReq {
    pub enabled: bool,
}

pub async fn set_enabled(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(name): Path<String>,
    Json(req): Json<ToggleReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::RELAYS_MANAGE)?;
    frp(&state)?.set_enabled(&state, &name, req.enabled).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
