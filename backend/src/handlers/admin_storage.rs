//! Admin storage monitoring: per-storage committed (sold) vs sellable capacity.

use axum::{extract::State, Json};

use crate::{authn::AuthUser, error::AppResult, permissions::perm, state::AppState, storage::StorageReport};

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<StorageReport>>> {
    auth.require(perm::NODES_READ)?;
    Ok(Json(crate::storage::report(&state).await?))
}
