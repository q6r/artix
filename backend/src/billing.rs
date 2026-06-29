//! Subscription billing (one recurring plan per VPS), settled with PIX via
//! PagCI. PIX is one-shot, so recurrence lives here: each period we issue a new
//! invoice + PIX charge; payment is confirmed by a signed webhook; unpaid past
//! the grace window suspends the VM.
//!
//! This module owns the plan price catalog and all money-moving state
//! transitions so handlers, the webhook and the worker share one code path.

use std::time::Duration as StdDuration;

use bson::{doc, oid::ObjectId};
use chrono::{DateTime, Datelike, Duration, Months, Utc};

use crate::{
    db::Collections,
    email,
    error::{AppError, AppResult},
    handlers::servers,
    models::{
        Invoice, InvoiceStatus, Plan, Server, ServerSpecs, ServerState, Subscription,
        SubscriptionStatus, User,
    },
    pagci::ChargeRequest,
    proxmox::PowerAction,
    state::AppState,
};

/// Billing plan: hardware specs + monthly price (single source of truth, also
/// used by direct Proxmox provisioning).
pub struct PlanDef {
    pub id: &'static str,
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
    pub price_cents: i64,
}

/// Defaults seeded into the `plans` collection on first run. After that, plans
/// are managed by admins in the DB.
pub const DEFAULT_PLANS: &[PlanDef] = &[
    PlanDef { id: "cloud2", vcpu: 2, ram_gb: 4, disk_gb: 50, price_cents: 3990 },
    PlanDef { id: "cloud4", vcpu: 4, ram_gb: 8, disk_gb: 100, price_cents: 6990 },
    PlanDef { id: "cloud8", vcpu: 8, ram_gb: 16, disk_gb: 200, price_cents: 12990 },
    PlanDef { id: "cloud16", vcpu: 8, ram_gb: 32, disk_gb: 400, price_cents: 22990 },
];

/// Look up a plan by slug from the DB.
pub async fn find_plan(state: &AppState, slug: &str) -> AppResult<Option<Plan>> {
    Ok(state.db.plans().find_one(doc! { "slug": slug }).await?)
}

pub async fn plan_specs(state: &AppState, slug: &str) -> AppResult<Option<ServerSpecs>> {
    Ok(find_plan(state, slug).await?.map(|p| ServerSpecs {
        vcpu: p.vcpu,
        ram_gb: p.ram_gb,
        disk_gb: p.disk_gb,
    }))
}

/// Per-unit monthly pricing + bounds for the "custom" plan (centavos).
pub struct CustomRates {
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

pub const CUSTOM: CustomRates = CustomRates {
    vcpu_cents: 1000,
    ram_cents: 500,
    disk_cents: 20,
    vcpu_min: 1,
    vcpu_max: 16,
    ram_min: 1,
    ram_max: 128,
    disk_min: 20,
    disk_max: 2000,
};

pub fn custom_price(vcpu: u16, ram_gb: u32, disk_gb: u32) -> i64 {
    vcpu as i64 * CUSTOM.vcpu_cents
        + ram_gb as i64 * CUSTOM.ram_cents
        + disk_gb as i64 * CUSTOM.disk_cents
}

/// Resolve `(plan_id, specs, price_cents)` from a request — a fixed plan, or a
/// validated custom configuration.
async fn resolve_specs(
    state: &AppState,
    req: &NewSubscription,
) -> AppResult<(String, ServerSpecs, i64)> {
    if req.plan == "custom" {
        let vcpu = req.vcpu.ok_or_else(|| AppError::Validation("vcpu required".into()))?;
        let ram_gb = req.ram_gb.ok_or_else(|| AppError::Validation("ram required".into()))?;
        let disk_gb = req.disk_gb.ok_or_else(|| AppError::Validation("disk required".into()))?;
        if vcpu < CUSTOM.vcpu_min
            || vcpu > CUSTOM.vcpu_max
            || ram_gb < CUSTOM.ram_min
            || ram_gb > CUSTOM.ram_max
            || disk_gb < CUSTOM.disk_min
            || disk_gb > CUSTOM.disk_max
        {
            return Err(AppError::Validation("custom specs out of range".into()));
        }
        Ok((
            "custom".into(),
            ServerSpecs { vcpu, ram_gb, disk_gb },
            custom_price(vcpu, ram_gb, disk_gb),
        ))
    } else {
        let plan = find_plan(state, &req.plan)
            .await?
            .ok_or_else(|| AppError::Validation("unknown plan".into()))?;
        Ok((
            plan.slug.clone(),
            ServerSpecs {
                vcpu: plan.vcpu,
                ram_gb: plan.ram_gb,
                disk_gb: plan.disk_gb,
            },
            plan.price_cents,
        ))
    }
}

/// Add `n` months, clamping the day to the target month's length.
fn add_months(dt: DateTime<Utc>, n: u32) -> DateTime<Utc> {
    dt.checked_add_months(Months::new(n)).unwrap_or(dt)
}

fn invoice_number(now: DateTime<Utc>, oid: &ObjectId) -> String {
    let hex = oid.to_hex();
    let tail = hex.get(18..24).unwrap_or("000000").to_uppercase();
    format!("INV-{:02}{:02}-{}", now.year() % 100, now.month(), tail)
}

/// Input for creating a subscription + its VPS.
pub struct NewSubscription {
    pub plan: String,
    pub name: String,
    pub os: Option<String>,
    pub ssh_key: Option<String>,
    /// Payment method: "crypto" (default) | "pix".
    pub method: Option<String>,
    /// Required when `plan == "custom"`.
    pub vcpu: Option<u16>,
    pub ram_gb: Option<u32>,
    pub disk_gb: Option<u32>,
}

/// Create a subscription and its (not-yet-provisioned) server, then issue the
/// first invoice with a PIX charge. The VM is provisioned only once paid.
pub async fn create_subscription(
    state: &AppState,
    user: &User,
    req: NewSubscription,
) -> AppResult<(Subscription, Invoice)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 63 {
        return Err(AppError::Validation("invalid server name".into()));
    }
    let method = req.method.clone().unwrap_or_else(|| "crypto".into());
    match method.as_str() {
        "crypto" if state.crypto.is_none() => {
            return Err(AppError::Unavailable("crypto billing unavailable".into()))
        }
        "pix" if state.pagci.is_none() => {
            return Err(AppError::Unavailable("pix billing unavailable".into()))
        }
        "stripe" if state.stripe.is_none() => {
            return Err(AppError::Unavailable("stripe billing unavailable".into()))
        }
        "crypto" | "pix" | "stripe" => {}
        _ => return Err(AppError::Validation("unknown payment method".into())),
    }
    let (plan_id, specs, price_cents) = resolve_specs(state, &req).await?;
    let user_id = user.id.ok_or(AppError::Unauthorized)?;
    let now = Utc::now();
    let node = state
        .proxmox
        .as_ref()
        .map(|p| p.node.clone())
        .unwrap_or_default();

    // 1) Server record, pending payment (no VM yet).
    let server = Server {
        id: None,
        user_id,
        org_id: None,
        name,
        node,
        vmid: None,
        plan: plan_id.clone(),
        os: req.os.clone().unwrap_or_else(|| "Ubuntu 24.04".into()),
        state: ServerState::PendingPayment,
        ip: None,
        cloud_init_ssh_key: req.ssh_key.clone(),
        root_password: None, // set at provision time (after payment)
        ssh_host: None,
        ssh_port: None,
        specs,
        expires_at: None, // billing-driven; subscription controls the lifecycle
        created_at: now,
        updated_at: now,
    };
    let server_id = state
        .db
        .servers()
        .insert_one(&server)
        .await?
        .inserted_id
        .as_object_id();

    // 2) Subscription, pending payment.
    let subscription = Subscription {
        id: None,
        user_id,
        server_id,
        plan: plan_id,
        status: SubscriptionStatus::PendingPayment,
        price_cents,
        currency: state.cfg.billing_currency.clone(),
        interval: "monthly".into(),
        provider: Some(method.clone()),
        current_period_start: None,
        current_period_end: None,
        cancel_at_period_end: false,
        created_at: now,
        updated_at: now,
    };
    let mut subscription = subscription;
    subscription.id = state
        .db
        .subscriptions()
        .insert_one(&subscription)
        .await?
        .inserted_id
        .as_object_id();

    // 3) First invoice for the opening period.
    let period_start = now;
    let period_end = add_months(now, 1);
    let invoice = build_invoice(state, user_id, subscription.id.unwrap(), price_cents, period_start, period_end, now);
    let invoice = persist_and_charge(state, user, invoice, &method).await?;

    Ok((subscription, invoice))
}

fn build_invoice(
    state: &AppState,
    user_id: ObjectId,
    subscription_id: ObjectId,
    amount_cents: i64,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Invoice {
    let oid = ObjectId::new();
    Invoice {
        id: Some(oid),
        user_id,
        subscription_id,
        number: invoice_number(now, &oid),
        amount_cents,
        currency: state.cfg.billing_currency.clone(),
        status: InvoiceStatus::Open,
        period_start,
        period_end,
        due_date: now + Duration::days(state.cfg.billing_grace_days),
        payment_id: None,
        pix_code: None,
        pix_qr_image: None,
        provider: None,
        crypto_address: None,
        crypto_amount_ltc: None,
        crypto_expires_at: None,
        stripe_url: None,
        paid_at: None,
        created_at: now,
        updated_at: now,
    }
}

/// Insert the invoice and attach a fresh PIX charge to it.
async fn persist_and_charge(
    state: &AppState,
    user: &User,
    mut invoice: Invoice,
    method: &str,
) -> AppResult<Invoice> {
    invoice.provider = Some(method.to_string());
    state.db.invoices().insert_one(&invoice).await?;
    match method {
        "crypto" => attach_crypto_charge(state, user, &mut invoice).await?,
        "pix" => attach_charge(state, user, &mut invoice).await?,
        "stripe" => attach_stripe_charge(state, user, &mut invoice).await?,
        _ => return Err(AppError::Validation("unsupported payment method".into())),
    }
    Ok(invoice)
}

/// Create a Stripe Checkout Session for the invoice and store the hosted URL.
pub async fn attach_stripe_charge(
    state: &AppState,
    user: &User,
    invoice: &mut Invoice,
) -> AppResult<()> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("stripe billing unavailable".into()))?;
    let session = stripe
        .create_checkout_session(
            invoice.amount_cents,
            &invoice.currency,
            &format!("ArtixCloud {}", invoice.number),
            &invoice.id.unwrap_or_default().to_hex(),
        )
        .await?;
    let now = Utc::now();
    invoice.payment_id = Some(session.id.clone());
    invoice.stripe_url = Some(session.url.clone());
    invoice.provider = Some("stripe".into());
    invoice.updated_at = now;
    state
        .db
        .invoices()
        .update_one(
            doc! { "_id": invoice.id },
            doc! { "$set": {
                "payment_id": &session.id,
                "stripe_url": &session.url,
                "provider": "stripe",
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;
    email::send_invoice(state, user, invoice).await;
    Ok(())
}

/// Create an LTC charge for the invoice and store the deposit address + amount.
pub async fn attach_crypto_charge(
    state: &AppState,
    user: &User,
    invoice: &mut Invoice,
) -> AppResult<()> {
    let crypto = state
        .crypto
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("crypto billing unavailable".into()))?;
    let charge = crypto
        .create_payment(
            invoice.amount_cents,
            &format!("ArtixCloud {}", invoice.number),
            &user.id.unwrap_or_default().to_hex(),
            &user.email,
            30,
        )
        .await?;

    let now = Utc::now();
    let expires = charge
        .expires_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    invoice.payment_id = Some(charge.payment_id.clone());
    invoice.crypto_address = Some(charge.address.clone());
    invoice.crypto_amount_ltc = Some(charge.amount_ltc);
    invoice.crypto_expires_at = expires;
    invoice.provider = Some("crypto".into());
    invoice.updated_at = now;

    let mut set = doc! {
        "payment_id": &charge.payment_id,
        "crypto_address": &charge.address,
        "crypto_amount_ltc": charge.amount_ltc,
        "provider": "crypto",
        "updated_at": bson::DateTime::from_chrono(now),
    };
    if let Some(e) = expires {
        set.insert("crypto_expires_at", bson::DateTime::from_chrono(e));
    }
    state
        .db
        .invoices()
        .update_one(doc! { "_id": invoice.id }, doc! { "$set": set })
        .await?;

    email::send_invoice(state, user, invoice).await;
    Ok(())
}

/// Poll pending crypto invoices and settle the ones that have been paid.
pub async fn run_crypto_poll(state: &AppState) -> AppResult<()> {
    let Some(crypto) = state.crypto.as_ref() else {
        return Ok(());
    };
    let mut cursor = state
        .db
        .invoices()
        .find(doc! { "status": "open", "provider": "crypto", "payment_id": { "$ne": null } })
        .await?;
    let mut pending = Vec::new();
    while cursor.advance().await? {
        pending.push(cursor.deserialize_current()?);
    }
    for inv in pending {
        let Some(pid) = inv.payment_id.as_ref() else { continue };
        match crypto.payment_status(pid).await {
            Ok(s) if s == "paid" => {
                if let Err(e) = mark_invoice_paid(state, &inv).await {
                    tracing::error!(error = %e, inv = ?inv.id, "crypto settle failed");
                }
            }
            Ok(s) if s == "expired" => {
                let _ = state
                    .db
                    .invoices()
                    .update_one(
                        doc! { "_id": inv.id, "status": "open" },
                        doc! { "$set": { "status": "expired", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
                    )
                    .await;
            }
            _ => {}
        }
    }
    Ok(())
}

/// Background task: confirm crypto payments quickly (LTC confirms in minutes).
pub fn spawn_crypto_poller(state: AppState) {
    if state.crypto.is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(StdDuration::from_secs(25));
        loop {
            tick.tick().await;
            if let Err(e) = run_crypto_poll(&state).await {
                tracing::error!(error = %e, "crypto poll failed");
            }
        }
    });
    tracing::info!("crypto payment poller started");
}

/// Create a PIX charge with PagCI and store the payment id + PIX payload on the
/// invoice. Used for the first invoice, renewals, and "pay again" after expiry.
pub async fn attach_charge(
    state: &AppState,
    user: &User,
    invoice: &mut Invoice,
) -> AppResult<()> {
    let pagci = state
        .pagci
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("billing unavailable".into()))?;

    let webhook_url = format!("{}/webhooks/pagci", state.cfg.public_api_url);
    let charge = pagci
        .create_charge(ChargeRequest {
            amount_cents: invoice.amount_cents,
            customer_name: &user.display_name,
            customer_email: &user.email,
            description: &format!("ArtixCloud {} — {}", invoice.number, invoice.currency),
            webhook_url: Some(&webhook_url),
        })
        .await?;

    let now = Utc::now();
    invoice.payment_id = Some(charge.id.clone());
    invoice.pix_code = charge.liquidator.pix_qr.clone();
    invoice.pix_qr_image = charge.qr_code.clone();
    invoice.updated_at = now;

    state
        .db
        .invoices()
        .update_one(
            doc! { "_id": invoice.id },
            doc! { "$set": {
                "payment_id": &charge.id,
                "pix_code": charge.liquidator.pix_qr,
                "pix_qr_image": charge.qr_code,
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;

    email::send_invoice(state, user, invoice).await;
    Ok(())
}

/// Settle a paid invoice: mark it paid, (re)activate the subscription for the
/// invoice's period, and provision or resume the VPS. Idempotent.
pub async fn mark_invoice_paid(state: &AppState, invoice: &Invoice) -> AppResult<()> {
    if invoice.status == InvoiceStatus::Paid {
        return Ok(());
    }
    let now = Utc::now();
    state
        .db
        .invoices()
        .update_one(
            doc! { "_id": invoice.id, "status": "open" },
            doc! { "$set": {
                "status": "paid",
                "paid_at": bson::DateTime::from_chrono(now),
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;

    // Activate the subscription for this billing period.
    state
        .db
        .subscriptions()
        .update_one(
            doc! { "_id": invoice.subscription_id },
            doc! { "$set": {
                "status": "active",
                "current_period_start": bson::DateTime::from_chrono(invoice.period_start),
                "current_period_end": bson::DateTime::from_chrono(invoice.period_end),
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;

    let sub = state
        .db
        .subscriptions()
        .find_one(doc! { "_id": invoice.subscription_id })
        .await?;
    let Some(sub) = sub else { return Ok(()) };
    let Some(server_id) = sub.server_id else { return Ok(()) };
    let Some(server) = state.db.servers().find_one(doc! { "_id": server_id }).await? else {
        return Ok(());
    };

    match server.state {
        ServerState::PendingPayment => {
            // First payment → provision the VM now.
            if let Err(e) = servers::provision(state, &server).await {
                tracing::error!(error = %e, ?server_id, "provision after payment failed");
                let _ = state
                    .db
                    .servers()
                    .update_one(doc! { "_id": server_id }, doc! { "$set": { "state": "error" }})
                    .await;
            }
        }
        ServerState::Suspended | ServerState::Stopped => {
            // Renewal paid → bring it back online.
            let _ = servers::set_power(state, &server, PowerAction::Start).await;
            let _ = state
                .db
                .servers()
                .update_one(
                    doc! { "_id": server_id },
                    doc! { "$set": { "state": "running", "updated_at": bson::DateTime::from_chrono(now) }},
                )
                .await;
        }
        _ => {}
    }

    if let Some(user) = state.db.users().find_one(doc! { "_id": sub.user_id }).await? {
        email::send_payment_confirmed(state, &user, invoice).await;
    }

    // Push to any socket watching this invoice (replaces client polling).
    let invoice_id = invoice.id.unwrap_or_default().to_hex();
    crate::ws::publish(
        state,
        format!("invoice:{invoice_id}"),
        "paid",
        serde_json::to_value(invoice.public()).unwrap_or_default(),
    );
    Ok(())
}

/// Handle a PagCI payment webhook event for a given payment id.
pub async fn handle_payment_event(state: &AppState, event: &str, payment_id: &str) -> AppResult<()> {
    let invoice = state
        .db
        .invoices()
        .find_one(doc! { "payment_id": payment_id })
        .await?;
    let Some(invoice) = invoice else {
        tracing::warn!(%payment_id, %event, "webhook for unknown payment");
        return Ok(());
    };

    match event {
        "payment.paid" => mark_invoice_paid(state, &invoice).await?,
        "payment.expired" | "payment.failed" | "payment.cancelled"
            if invoice.status == InvoiceStatus::Open =>
        {
            state
                .db
                .invoices()
                .update_one(
                    doc! { "_id": invoice.id, "status": "open" },
                    doc! { "$set": {
                        "status": "expired",
                        "updated_at": bson::DateTime::from_chrono(Utc::now()),
                    }},
                )
                .await?;
        }
        _ => {}
    }
    Ok(())
}

/// Cancel a subscription. With `at_period_end`, it keeps running until the paid
/// period ends; otherwise it is suspended immediately.
pub async fn cancel_subscription(
    state: &AppState,
    sub: &Subscription,
    at_period_end: bool,
) -> AppResult<()> {
    let now = Utc::now();
    if at_period_end {
        state
            .db
            .subscriptions()
            .update_one(
                doc! { "_id": sub.id },
                doc! { "$set": { "cancel_at_period_end": true, "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await?;
    } else {
        state
            .db
            .subscriptions()
            .update_one(
                doc! { "_id": sub.id },
                doc! { "$set": { "status": "cancelled", "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await?;
        suspend_server_of(state, sub, ServerState::Stopped).await;
    }
    Ok(())
}

async fn suspend_server_of(state: &AppState, sub: &Subscription, new_state: ServerState) {
    let Some(server_id) = sub.server_id else { return };
    let Ok(Some(server)) = state.db.servers().find_one(doc! { "_id": server_id }).await else {
        return;
    };
    let _ = servers::set_power(state, &server, PowerAction::Stop).await;
    let label = match new_state {
        ServerState::Suspended => "suspended",
        _ => "stopped",
    };
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": server_id },
            doc! { "$set": { "state": label, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await;
}

/// One pass of the recurring billing cycle: issue renewals coming due and
/// suspend subscriptions whose invoices went unpaid past grace. Idempotent and
/// best-effort — safe to run on a timer.
pub async fn run_due_cycle(state: &AppState) -> AppResult<()> {
    // Renewals run if either payment provider is configured.
    if state.pagci.is_none() && state.crypto.is_none() {
        return Ok(());
    }
    let now = Utc::now();
    let lead = now + Duration::days(state.cfg.billing_renew_lead_days);

    // 1) Renewals: active subs nearing period end with no open invoice yet.
    let mut cursor = state
        .db
        .subscriptions()
        .find(doc! {
            "status": "active",
            "cancel_at_period_end": false,
            "current_period_end": { "$lte": bson::DateTime::from_chrono(lead) },
        })
        .await?;
    while cursor.advance().await? {
        let sub = cursor.deserialize_current()?;
        if let Err(e) = issue_renewal(state, &sub, now).await {
            tracing::error!(error = %e, sub = ?sub.id, "renewal failed");
        }
    }

    // 2) End cancel-at-period-end subscriptions whose period elapsed.
    let mut cur = state
        .db
        .subscriptions()
        .find(doc! {
            "status": "active",
            "cancel_at_period_end": true,
            "current_period_end": { "$lte": bson::DateTime::from_chrono(now) },
        })
        .await?;
    while cur.advance().await? {
        let sub = cur.deserialize_current()?;
        let _ = state
            .db
            .subscriptions()
            .update_one(
                doc! { "_id": sub.id },
                doc! { "$set": { "status": "cancelled", "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await;
        suspend_server_of(state, &sub, ServerState::Stopped).await;
    }

    // 3) Suspend subscriptions with an invoice unpaid past its due date.
    let mut overdue = state
        .db
        .invoices()
        .find(doc! {
            "status": "open",
            "due_date": { "$lt": bson::DateTime::from_chrono(now) },
        })
        .await?;
    while overdue.advance().await? {
        let inv = overdue.deserialize_current()?;
        if let Err(e) = suspend_for_nonpayment(state, &inv).await {
            tracing::error!(error = %e, inv = ?inv.id, "suspend failed");
        }
    }
    Ok(())
}

/// Suspend (power off) any VPS that expired more than the grace period ago.
/// Lifetime VPS (`expires_at` null) are skipped. After `expires_at` the customer
/// keeps the VPS for `expiry_grace_days` days; only then is it suspended.
/// Idempotent — safe to run on a timer.
pub async fn run_expiry_cycle(state: &AppState) -> AppResult<()> {
    let now = Utc::now();
    let cutoff = now - Duration::days(state.cfg.expiry_grace_days);
    let mut cursor = state
        .db
        .servers()
        .find(doc! {
            "expires_at": { "$ne": null, "$lt": bson::DateTime::from_chrono(cutoff) },
            "state": { "$in": ["running", "stopped", "provisioning"] },
        })
        .await?;
    while cursor.advance().await? {
        let server = cursor.deserialize_current()?;
        if let (Some(px), Some(vmid)) = (state.proxmox.as_ref(), server.vmid) {
            let _ = px.power(vmid, crate::proxmox::PowerAction::Stop).await;
        }
        let _ = state
            .db
            .servers()
            .update_one(
                doc! { "_id": server.id },
                doc! { "$set": { "state": "suspended", "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await;
        tracing::info!(server = ?server.id, "suspended expired VPS");
    }
    Ok(())
}

async fn issue_renewal(state: &AppState, sub: &Subscription, now: DateTime<Utc>) -> AppResult<()> {
    // Admin-managed expiry overrides billing: never auto-invoice a VPS that has a
    // manual vencimento — its lifecycle is driven by run_expiry_cycle, not renewals.
    if let Some(sid) = sub.server_id {
        if let Some(server) = state.db.servers().find_one(doc! { "_id": sid }).await? {
            if server.expires_at.is_some() {
                return Ok(());
            }
        }
    }

    // Skip if a future-period open invoice already exists.
    let existing = state
        .db
        .invoices()
        .find_one(doc! {
            "subscription_id": sub.id,
            "status": "open",
            "period_start": { "$gte": bson::DateTime::from_chrono(sub.current_period_end.unwrap_or(now)) },
        })
        .await?;
    if existing.is_some() {
        return Ok(());
    }
    let Some(user) = state.db.users().find_one(doc! { "_id": sub.user_id }).await? else {
        return Ok(());
    };
    let period_start = sub.current_period_end.unwrap_or(now);
    let period_end = add_months(period_start, 1);
    let invoice = build_invoice(state, sub.user_id, sub.id.unwrap(), sub.price_cents, period_start, period_end, now);
    let method = sub.provider.clone().unwrap_or_else(|| "crypto".into());
    persist_and_charge(state, &user, invoice, &method).await?;
    Ok(())
}

async fn suspend_for_nonpayment(state: &AppState, invoice: &Invoice) -> AppResult<()> {
    let Some(sub) = state
        .db
        .subscriptions()
        .find_one(doc! { "_id": invoice.subscription_id })
        .await?
    else {
        return Ok(());
    };
    // Only act on active/past-due/pending subs (ignore cancelled/suspended).
    if !matches!(sub.status, SubscriptionStatus::Active | SubscriptionStatus::PastDue | SubscriptionStatus::PendingPayment) {
        return Ok(());
    }

    // A never-paid initial checkout (pending_payment) is an abandoned cart, not
    // a lapsed active subscription: cancel it and drop the placeholder VPS (never
    // provisioned) instead of "suspending". Keeps abandoned checkouts from
    // lingering forever as a pending "subscription" / "next invoice".
    if matches!(sub.status, SubscriptionStatus::PendingPayment) {
        let now = Utc::now();
        if let Some(sid) = sub.server_id {
            let _ = state
                .db
                .servers()
                .delete_one(doc! { "_id": sid, "state": "pending_payment" })
                .await;
        }
        let _ = state
            .db
            .invoices()
            .update_one(
                doc! { "_id": invoice.id },
                doc! { "$set": { "status": "void", "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await;
        let _ = state
            .db
            .subscriptions()
            .update_one(
                doc! { "_id": sub.id },
                doc! { "$set": { "status": "cancelled", "updated_at": bson::DateTime::from_chrono(now) }},
            )
            .await;
        return Ok(());
    }

    state
        .db
        .subscriptions()
        .update_one(
            doc! { "_id": sub.id },
            doc! { "$set": { "status": "suspended", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    suspend_server_of(state, &sub, ServerState::Suspended).await;
    if let Some(user) = state.db.users().find_one(doc! { "_id": sub.user_id }).await? {
        email::send_subscription_suspended(state, &user, &sub).await;
    }
    Ok(())
}

/// Spawn the in-process billing worker (opt-in via `BILLING_WORKER_ENABLED`).
pub fn spawn_worker(state: AppState) {
    // Runs for VPS expiry enforcement even without a payment provider; the
    // billing half (run_due_cycle) self-gates on `pagci`.
    if !state.cfg.billing_worker_enabled {
        return;
    }
    tokio::spawn(async move {
        // Hourly is plenty: renewals use a multi-day lead and grace window.
        let mut tick = tokio::time::interval(StdDuration::from_secs(3600));
        loop {
            tick.tick().await;
            if let Err(e) = run_expiry_cycle(&state).await {
                tracing::error!(error = %e, "expiry cycle failed");
            }
            if let Err(e) = run_due_cycle(&state).await {
                tracing::error!(error = %e, "billing cycle failed");
            }
        }
    });
    tracing::info!("billing worker started");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_plans_present() {
        assert!(DEFAULT_PLANS.iter().any(|p| p.id == "cloud4" && p.price_cents == 6990));
    }

    #[test]
    fn invoice_number_format() {
        let oid = ObjectId::parse_str("65f0000000000000aabbccdd").unwrap();
        // 2026-06 → "INV-2606-..."
        let dt = DateTime::parse_from_rfc3339("2026-06-24T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let n = invoice_number(dt, &oid);
        assert!(n.starts_with("INV-2606-"), "got {n}");
    }
}
