//! Dedicated IP add-on: a customer buys a dedicated IP for a VPS (R$25/mo,
//! reusing the billing rails); an admin then manually routes/assigns the IP.

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    billing,
    db::Collections,
    error::{AppError, AppResult},
    models::{DedicatedIpPublic, InvoicePublic, UserRef},
    permissions::perm,
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

/// GET /servers/:id/dedicated-ip — the dedicated IP order for this VPS (or null).
pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Option<DedicatedIpPublic>>> {
    let server_id = owned_server(&state, &auth, &id).await?;
    let dip = state
        .db
        .dedicated_ips()
        .find_one(doc! { "server_id": server_id, "status": { "$ne": "cancelled" } })
        .await?;
    Ok(Json(dip.map(|d| d.public())))
}

#[derive(Deserialize)]
pub struct BuyReq {
    #[serde(default)]
    pub method: Option<String>,
}

/// POST /servers/:id/dedicated-ip — buy a dedicated IP. Returns the invoice to pay.
pub async fn buy(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<BuyReq>,
) -> AppResult<Json<InvoicePublic>> {
    let server_id = owned_server(&state, &auth, &id).await?;
    let (_dip, invoice) =
        billing::create_dedicated_ip(&state, &auth.user, server_id, req.method).await?;
    Ok(Json(invoice.public()))
}

// ----------------------------- Admin -----------------------------

#[derive(Serialize)]
pub struct DedicatedIpAdminView {
    #[serde(flatten)]
    pub ip: DedicatedIpPublic,
    pub owner: Option<UserRef>,
    pub server_name: Option<String>,
}

/// GET /admin/dedicated-ips — every dedicated IP order with owner + VPS name.
pub async fn admin_list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<DedicatedIpAdminView>>> {
    auth.require(perm::NODES_READ)?;
    let mut cur = state
        .db
        .dedicated_ips()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .await?;
    let mut out = Vec::new();
    while cur.advance().await? {
        let d = cur.deserialize_current()?;
        let owner = state
            .db
            .users()
            .find_one(doc! { "_id": d.user_id })
            .await?
            .map(|u| UserRef::of(&u));
        let server_name = state
            .db
            .servers()
            .find_one(doc! { "_id": d.server_id })
            .await?
            .map(|s| s.name);
        out.push(DedicatedIpAdminView { ip: d.public(), owner, server_name });
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct AssignReq {
    pub ip_address: String,
}

/// PATCH /admin/dedicated-ips/:id — route (assign) the IP to the customer.
pub async fn admin_assign(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<AssignReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let ip = req.ip_address.trim().to_string();
    if ip.parse::<std::net::IpAddr>().is_err() {
        return Err(AppError::Validation("invalid IP address".into()));
    }
    let now = bson::DateTime::from_chrono(Utc::now());
    let res = state
        .db
        .dedicated_ips()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "ip_address": &ip, "status": "active", "assigned_at": now, "updated_at": now }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    if let Ok(Some(dip)) = state.db.dedicated_ips().find_one(doc! { "_id": oid }).await {
        crate::notify::notify(
            &state,
            dip.user_id,
            "dedicated_ip",
            "IP dedicado encaminhado",
            format!("Seu IP dedicado {ip} já está disponível."),
            Some(format!("/dashboard/servers/{}", dip.server_id.to_hex())),
        )
        .await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
