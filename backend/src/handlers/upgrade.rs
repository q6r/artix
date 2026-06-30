//! Paid RAM/disk upgrades for a VPS. The user buys more resources; once the
//! invoice is paid the new specs are applied to the live VM automatically.

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use serde::Deserialize;

use crate::{
    authn::AuthUser,
    billing,
    db::Collections,
    error::{AppError, AppResult},
    models::InvoicePublic,
    state::AppState,
};

async fn owned_server(state: &AppState, auth: &AuthUser, id: &str) -> AppResult<ObjectId> {
    let oid = ObjectId::parse_str(id).map_err(|_| AppError::NotFound)?;
    if state
        .db
        .servers()
        .find_one(doc! { "_id": oid, "user_id": auth.user_id })
        .await?
        .is_none()
    {
        return Err(AppError::NotFound);
    }
    Ok(oid)
}

#[derive(Deserialize)]
pub struct UpgradeReq {
    #[serde(default)]
    pub add_ram_gb: u32,
    #[serde(default)]
    pub add_disk_gb: u32,
    #[serde(default)]
    pub method: Option<String>,
}

/// POST /servers/:id/upgrade — buy a RAM/disk upgrade. Returns the invoice to pay.
pub async fn buy(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpgradeReq>,
) -> AppResult<Json<InvoicePublic>> {
    let server_id = owned_server(&state, &auth, &id).await?;
    let (_up, invoice) = billing::create_upgrade(
        &state,
        &auth.user,
        server_id,
        req.add_ram_gb,
        req.add_disk_gb,
        req.method,
    )
    .await?;
    Ok(Json(invoice.public()))
}
