//! Billing endpoints: subscriptions, invoices, PIX payment, plan catalog, plus
//! admin read/settlement. Every customer route is ownership-checked (IDOR-safe);
//! admin routes require an explicit `billing.*` permission.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    billing::{self, NewSubscription},
    db::Collections,
    error::{AppError, AppResult},
    models::{Invoice, InvoicePublic, InvoiceStatus, Subscription, SubscriptionPublic},
    permissions::cap,
    permissions::perm,
    state::AppState,
};

use super::admin::Pagination;

// ----------------------------- Plans (public) -----------------------------

#[derive(Serialize)]
pub struct PlanView {
    pub id: String,
    pub name: String,
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
    pub price_cents: i64,
    pub currency: String,
}

#[derive(Serialize)]
pub struct CustomView {
    pub vcpu_cents: i64,
    pub ram_cents: i64,
    pub disk_cents: i64,
    pub vcpu_min: u16,
    pub vcpu_max: u16,
    pub ram_min: u32,
    pub ram_max: u32,
    pub disk_min: u32,
    pub disk_max: u32,
}

#[derive(Serialize)]
pub struct ContainerPlanView {
    pub id: String,
    pub name: String,
    pub ram_mb: i64,
    pub price_cents: i64,
    pub currency: String,
}

#[derive(Serialize)]
pub struct PlansResponse {
    pub plans: Vec<PlanView>,
    pub custom: CustomView,
    pub currency: String,
    /// Container hosting plans (free tier first).
    pub container_plans: Vec<ContainerPlanView>,
}

pub async fn list_plans(State(state): State<AppState>) -> Json<PlansResponse> {
    let currency = state.cfg.billing_currency.clone();
    // Active plans from the DB, ordered by `sort` then price.
    let mut plans: Vec<PlanView> = Vec::new();
    if let Ok(mut cursor) = state
        .db
        .plans()
        .find(doc! { "active": true })
        .sort(doc! { "sort": 1, "price_cents": 1 })
        .await
    {
        while cursor.advance().await.unwrap_or(false) {
            if let Ok(p) = cursor.deserialize_current() {
                plans.push(PlanView {
                    id: p.slug,
                    name: p.name,
                    vcpu: p.vcpu,
                    ram_gb: p.ram_gb,
                    disk_gb: p.disk_gb,
                    price_cents: p.price_cents,
                    currency: currency.clone(),
                });
            }
        }
    }
    let container_plans = billing::CONTAINER_PLANS
        .iter()
        .map(|p| ContainerPlanView {
            id: p.id.to_string(),
            name: p.name.to_string(),
            ram_mb: p.ram_mb,
            price_cents: p.price_cents,
            currency: currency.clone(),
        })
        .collect();
    let c = &billing::CUSTOM;
    Json(PlansResponse {
        plans,
        custom: CustomView {
            vcpu_cents: c.vcpu_cents,
            ram_cents: c.ram_cents,
            disk_cents: c.disk_cents,
            vcpu_min: c.vcpu_min,
            vcpu_max: c.vcpu_max,
            ram_min: c.ram_min,
            ram_max: c.ram_max,
            disk_min: c.disk_min,
            disk_max: c.disk_max,
        },
        currency,
        container_plans,
    })
}

// ----------------------------- Subscriptions -----------------------------

#[derive(Deserialize)]
pub struct CreateSubscriptionReq {
    pub plan: String,
    pub name: String,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub ssh_key: Option<String>,
    // Required when `plan == "custom"`.
    #[serde(default)]
    pub vcpu: Option<u16>,
    #[serde(default)]
    pub ram_gb: Option<u32>,
    #[serde(default)]
    pub disk_gb: Option<u32>,
    /// Payment method: "crypto" (default) | "pix".
    #[serde(default)]
    pub method: Option<String>,
}

#[derive(Serialize)]
pub struct CheckoutResponse {
    pub subscription: SubscriptionPublic,
    pub invoice: InvoicePublic,
}

pub async fn create_subscription(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateSubscriptionReq>,
) -> AppResult<Json<CheckoutResponse>> {
    auth.scope(cap::BILLING)?;
    let (sub, invoice) = billing::create_subscription(
        &state,
        &auth.user,
        NewSubscription {
            plan: req.plan,
            name: req.name,
            os: req.os,
            ssh_key: req.ssh_key,
            vcpu: req.vcpu,
            ram_gb: req.ram_gb,
            disk_gb: req.disk_gb,
            method: req.method,
        },
    )
    .await?;
    Ok(Json(CheckoutResponse {
        subscription: sub.public(),
        invoice: invoice.public(),
    }))
}

pub async fn list_subscriptions(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<SubscriptionPublic>>> {
    auth.scope(cap::BILLING)?;
    let mut cursor = state
        .db
        .subscriptions()
        .find(doc! { "user_id": auth.user_id })
        .sort(doc! { "created_at": -1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

async fn owned_subscription(
    state: &AppState,
    auth: &AuthUser,
    id: &str,
) -> AppResult<Subscription> {
    let oid = ObjectId::parse_str(id).map_err(|_| AppError::NotFound)?;
    state
        .db
        .subscriptions()
        .find_one(doc! { "_id": oid, "user_id": auth.user_id })
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn get_subscription(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<SubscriptionPublic>> {
    auth.scope(cap::BILLING)?;
    Ok(Json(owned_subscription(&state, &auth, &id).await?.public()))
}

#[derive(Deserialize)]
pub struct CancelReq {
    /// Default true: keep the VPS until the paid period ends.
    #[serde(default = "default_true")]
    pub at_period_end: bool,
}

fn default_true() -> bool {
    true
}

pub async fn cancel_subscription(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<CancelReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::BILLING)?;
    let sub = owned_subscription(&state, &auth, &id).await?;
    billing::cancel_subscription(&state, &sub, req.at_period_end).await?;
    Ok(Json(
        serde_json::json!({ "ok": true, "at_period_end": req.at_period_end }),
    ))
}

// ----------------------------- Invoices -----------------------------

pub async fn list_invoices(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<InvoicePublic>>> {
    auth.scope(cap::BILLING)?;
    let mut cursor = state
        .db
        .invoices()
        .find(doc! { "user_id": auth.user_id })
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

async fn owned_invoice(state: &AppState, auth: &AuthUser, id: &str) -> AppResult<Invoice> {
    let oid = ObjectId::parse_str(id).map_err(|_| AppError::NotFound)?;
    state
        .db
        .invoices()
        .find_one(doc! { "_id": oid, "user_id": auth.user_id })
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn get_invoice(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<InvoicePublic>> {
    auth.scope(cap::BILLING)?;
    Ok(Json(owned_invoice(&state, &auth, &id).await?.public()))
}

/// (Re)issue a PIX charge for an open/expired invoice and return the payload.
pub async fn pay_invoice(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<InvoicePublic>> {
    auth.scope(cap::BILLING)?;
    let mut invoice = owned_invoice(&state, &auth, &id).await?;
    match invoice.status {
        InvoiceStatus::Paid => return Err(AppError::Conflict("invoice already paid".into())),
        InvoiceStatus::Void | InvoiceStatus::Uncollectible => {
            return Err(AppError::Conflict("invoice not payable".into()))
        }
        _ => {}
    }

    // Reopen an expired invoice before attaching a fresh charge.
    if invoice.status == InvoiceStatus::Expired {
        invoice.status = InvoiceStatus::Open;
        state
            .db
            .invoices()
            .update_one(
                doc! { "_id": invoice.id },
                doc! { "$set": { "status": "open" }},
            )
            .await?;
    }

    match invoice.provider.as_deref() {
        Some("crypto") => billing::attach_crypto_charge(&state, &auth.user, &mut invoice).await?,
        Some("stripe") => billing::attach_stripe_charge(&state, &auth.user, &mut invoice).await?,
        _ => billing::attach_charge(&state, &auth.user, &mut invoice).await?,
    }
    Ok(Json(invoice.public()))
}

// ----------------------------- Admin -----------------------------

pub async fn admin_list_subscriptions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<SubscriptionPublic>>> {
    auth.require(perm::BILLING_READ)?;
    let mut cursor = state
        .db
        .subscriptions()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

pub async fn admin_list_invoices(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<InvoicePublic>>> {
    auth.require(perm::BILLING_READ)?;
    let mut cursor = state
        .db
        .invoices()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

/// Manually settle an invoice (e.g. reconciled out-of-band). Same effect as a
/// `payment.paid` webhook: activates the subscription and provisions/resumes.
pub async fn admin_mark_paid(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::BILLING_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let invoice = state
        .db
        .invoices()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;
    billing::mark_invoice_paid(&state, &invoice).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
