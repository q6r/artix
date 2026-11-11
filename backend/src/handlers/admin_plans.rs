//! Admin CRUD for billing plans (stored in the `plans` collection). Reading
//! needs `billing.read`; mutating needs `billing.manage`.

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::Deserialize;

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{Plan, PlanAdminView},
    permissions::perm,
    state::AppState,
};

fn default_true() -> bool {
    true
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<PlanAdminView>>> {
    auth.require(perm::BILLING_READ)?;
    let mut cursor = state
        .db
        .plans()
        .find(doc! {})
        .sort(doc! { "sort": 1, "price_cents": 1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.admin_view());
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreatePlanReq {
    pub slug: String,
    pub name: String,
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
    pub price_cents: i64,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub sort: i32,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreatePlanReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::BILLING_MANAGE)?;
    let slug = req.slug.trim().to_lowercase();
    if slug.is_empty() || slug.len() > 40 || slug == "custom" {
        return Err(AppError::Validation("invalid slug".into()));
    }
    if state
        .db
        .plans()
        .find_one(doc! { "slug": &slug })
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("slug already exists".into()));
    }
    let now = Utc::now();
    let plan = Plan {
        id: None,
        slug,
        name: req.name.trim().to_string(),
        vcpu: req.vcpu,
        ram_gb: req.ram_gb,
        disk_gb: req.disk_gb,
        price_cents: req.price_cents,
        active: req.active,
        sort: req.sort,
        created_at: now,
        updated_at: now,
    };
    let res = state.db.plans().insert_one(&plan).await?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "id": res.inserted_id.as_object_id().map(|o| o.to_hex()),
    })))
}

#[derive(Deserialize)]
pub struct PatchPlanReq {
    pub name: Option<String>,
    pub vcpu: Option<u16>,
    pub ram_gb: Option<u32>,
    pub disk_gb: Option<u32>,
    pub price_cents: Option<i64>,
    pub active: Option<bool>,
    pub sort: Option<i32>,
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<PatchPlanReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::BILLING_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let mut set = doc! { "updated_at": bson::DateTime::from_chrono(Utc::now()) };
    if let Some(v) = req.name {
        set.insert("name", v.trim());
    }
    if let Some(v) = req.vcpu {
        set.insert("vcpu", v as i32);
    }
    if let Some(v) = req.ram_gb {
        set.insert("ram_gb", v as i64);
    }
    if let Some(v) = req.disk_gb {
        set.insert("disk_gb", v as i64);
    }
    if let Some(v) = req.price_cents {
        set.insert("price_cents", v);
    }
    if let Some(v) = req.active {
        set.insert("active", v);
    }
    if let Some(v) = req.sort {
        set.insert("sort", v);
    }
    let res = state
        .db
        .plans()
        .update_one(doc! { "_id": oid }, doc! { "$set": set })
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::BILLING_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state.db.plans().delete_one(doc! { "_id": oid }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
