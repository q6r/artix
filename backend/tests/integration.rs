//! Integration tests that prove the security protections end-to-end.
//!
//! They require a MongoDB. Set `MONGO_TEST_URI` to run them; otherwise each
//! test no-ops (so `cargo test` stays green without a DB). In CI:
//!
//! ```bash
//! MONGO_TEST_URI=mongodb://localhost:27017 cargo test
//! ```

use std::sync::atomic::{AtomicU64, Ordering};

use artixcloud_api::{
    build_router,
    config::{AppEnv, Config},
    db,
    db::Collections,
    seed,
    state::AppState,
};
use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use bson::{doc, oid::ObjectId};
use serde_json::{json, Value};
use tower::ServiceExt;

fn test_config(uri: String, db_name: String, auth_rate: u32) -> Config {
    Config {
        env: AppEnv::Development,
        host: "127.0.0.1".into(),
        port: 0,
        cors_origins: vec![],
        public_app_url: "http://app.test".into(),
        public_api_url: "http://api.test".into(),
        mongo_uri: uri,
        mongo_db: db_name,
        auth_token_secret: b"integration-secret-key-32-bytes-minimum!".to_vec(),
        auth_refresh_pepper: b"integration-pepper-key-32-bytes-minimum!".to_vec(),
        access_ttl_secs: 900,
        refresh_ttl_secs: 2_592_000,
        email_token_ttl_secs: 86_400,
        login_code_ttl_secs: 600,
        resend_api_key: String::new(),
        email_from: "test@artix".into(),
        discord_client_id: String::new(),
        discord_client_secret: String::new(),
        github_client_id: String::new(),
        github_client_secret: String::new(),
        rate_limit_per_min: 10_000,
        auth_rate_limit_per_min: auth_rate,
        max_failed_logins: 8,
        lockout_minutes: 15,
        proxmox_api_url: String::new(),
        proxmox_token_id: String::new(),
        proxmox_token_secret: String::new(),
        proxmox_node: "pve".into(),
        proxmox_template_vmid: 9000,
        proxmox_storage: "local-lvm".into(),
        proxmox_bridge: "vmbr0".into(),
        proxmox_insecure: false,
        pagci_api_url: String::new(),
        pagci_api_token: String::new(),
        pagci_wallet_id: String::new(),
        pagci_wallet_name: "artix".into(),
        pagci_webhook_secret: String::new(),
        billing_currency: "BRL".into(),
        billing_grace_days: 3,
        billing_renew_lead_days: 3,
        billing_pix_ttl_secs: 86_400,
        billing_worker_enabled: false,
    }
}

/// Returns `(state, router)` or `None` when no test DB is configured.
async fn setup(auth_rate: u32) -> Option<(AppState, Router)> {
    let uri = std::env::var("MONGO_TEST_URI").ok()?;
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::SeqCst);
    let cfg = test_config(
        uri,
        format!("artix_it_{}_{}", std::process::id(), n),
        auth_rate,
    );
    let database = db::connect(&cfg).await.ok()?;
    db::ensure_indexes(&database).await.ok()?;
    let state = AppState::new(cfg, database);
    seed(&state).await.ok()?;
    let app = build_router(state.clone());
    Some((state, app))
}

async fn req(
    app: &Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(t) = bearer {
        b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let request = match body {
        Some(j) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(j.to_string()))
            .unwrap(),
        None => b.body(Body::empty()).unwrap(),
    };
    let res = app.clone().oneshot(request).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, v)
}

fn register_body(email: &str) -> Value {
    json!({ "email": email, "password": "supersecret123", "display_name": "Test User" })
}

#[tokio::test]
async fn register_login_and_wrong_password() {
    let Some((_state, app)) = setup(1000).await else {
        return;
    };
    let email = "reg@test.com";

    let (s, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body(email)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["access_token"].is_string());
    assert!(v["refresh_token"].is_string());

    let (s, _) = req(
        &app,
        "POST",
        "/auth/login",
        None,
        Some(json!({ "email": email, "password": "supersecret123" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = req(
        &app,
        "POST",
        "/auth/login",
        None,
        Some(json!({ "email": email, "password": "WRONG" })),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refresh_rotation_and_reuse_detection() {
    let Some((_state, app)) = setup(1000).await else {
        return;
    };
    let (_, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("rot@test.com")),
    )
    .await;
    let rt1 = v["refresh_token"].as_str().unwrap().to_string();

    // Rotate: rt1 -> rt2
    let (s, v) = req(
        &app,
        "POST",
        "/auth/refresh",
        None,
        Some(json!({ "refresh_token": rt1 })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let rt2 = v["refresh_token"].as_str().unwrap().to_string();
    assert_ne!(rt1, rt2);

    // Reuse old token -> rejected (theft response).
    let (s, _) = req(
        &app,
        "POST",
        "/auth/refresh",
        None,
        Some(json!({ "refresh_token": rt1 })),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // And the whole session is now revoked: even the valid rt2 fails.
    let (s, _) = req(
        &app,
        "POST",
        "/auth/refresh",
        None,
        Some(json!({ "refresh_token": rt2 })),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_requires_auth_and_logout_revokes() {
    let Some((_state, app)) = setup(1000).await else {
        return;
    };
    let (_, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("me@test.com")),
    )
    .await;
    let access = v["access_token"].as_str().unwrap().to_string();

    let (s, _) = req(&app, "GET", "/auth/me", None, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let (s, _) = req(&app, "GET", "/auth/me", Some(&access), None).await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = req(&app, "POST", "/auth/logout", Some(&access), None).await;
    assert_eq!(s, StatusCode::OK);

    // Session revoked -> the access token no longer works (instant revocation).
    let (s, _) = req(&app, "GET", "/auth/me", Some(&access), None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn idor_cannot_revoke_other_users_session() {
    let Some((_state, app)) = setup(1000).await else {
        return;
    };
    let (_, a) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("a@test.com")),
    )
    .await;
    let (_, b) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("b@test.com")),
    )
    .await;
    let access_a = a["access_token"].as_str().unwrap().to_string();
    let rt_a = a["refresh_token"].as_str().unwrap();
    let rt_b = b["refresh_token"].as_str().unwrap();
    let sid_a = rt_a.split('.').next().unwrap();
    let sid_b = rt_b.split('.').next().unwrap();

    // A tries to revoke B's session -> 404 (ownership baked into the query).
    let (s, _) = req(
        &app,
        "DELETE",
        &format!("/sessions/{sid_b}"),
        Some(&access_a),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // A can revoke its own.
    let (s, _) = req(
        &app,
        "DELETE",
        &format!("/sessions/{sid_a}"),
        Some(&access_a),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn normal_user_blocked_from_admin() {
    let Some((_state, app)) = setup(1000).await else {
        return;
    };
    let (_, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("plain@test.com")),
    )
    .await;
    let access = v["access_token"].as_str().unwrap().to_string();

    // Authenticated but without `users.read` -> 403, not 401.
    let (s, _) = req(&app, "GET", "/admin/users", Some(&access), None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_with_permission_allowed() {
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let (_, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("admin@test.com")),
    )
    .await;
    let access = v["access_token"].as_str().unwrap().to_string();
    let uid = ObjectId::parse_str(v["user"]["id"].as_str().unwrap()).unwrap();

    // Grant super_admin (which holds `*`).
    let role = state
        .db
        .roles()
        .find_one(doc! { "name": "super_admin" })
        .await
        .unwrap()
        .unwrap();
    state
        .db
        .users()
        .update_one(
            doc! { "_id": uid },
            doc! { "$addToSet": { "role_ids": role.id.unwrap() } },
        )
        .await
        .unwrap();

    // Same token now resolves admin permissions per-request.
    let (s, body) = req(&app, "GET", "/admin/users", Some(&access), None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn webhook_payment_settles_invoice_and_subscription() {
    use artixcloud_api::billing;
    use artixcloud_api::models::{
        Invoice, InvoiceStatus, Server, ServerSpecs, ServerState, Subscription, SubscriptionStatus,
    };
    use chrono::Utc;

    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let (_, v) = req(
        &app,
        "POST",
        "/auth/register",
        None,
        Some(register_body("pay@test.com")),
    )
    .await;
    let uid = ObjectId::parse_str(v["user"]["id"].as_str().unwrap()).unwrap();
    let now = Utc::now();

    // A pending-payment VPS + subscription + an open invoice with a PagCI id.
    let server_id = state
        .db
        .servers()
        .insert_one(&Server {
            id: None,
            user_id: uid,
            org_id: None,
            name: "vps-1".into(),
            node: "pve".into(),
            vmid: None,
            plan: "cloud2".into(),
            os: "Ubuntu 24.04".into(),
            state: ServerState::PendingPayment,
            ip: None,
            cloud_init_ssh_key: None,
            specs: ServerSpecs {
                vcpu: 2,
                ram_gb: 4,
                disk_gb: 50,
            },
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap()
        .inserted_id
        .as_object_id();

    let sub_id = state
        .db
        .subscriptions()
        .insert_one(&Subscription {
            id: None,
            user_id: uid,
            server_id,
            plan: "cloud2".into(),
            status: SubscriptionStatus::PendingPayment,
            price_cents: 3990,
            currency: "BRL".into(),
            interval: "monthly".into(),
            current_period_start: None,
            current_period_end: None,
            cancel_at_period_end: false,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap()
        .inserted_id
        .as_object_id()
        .unwrap();

    state
        .db
        .invoices()
        .insert_one(&Invoice {
            id: None,
            user_id: uid,
            subscription_id: sub_id,
            number: "INV-TEST-0001".into(),
            amount_cents: 3990,
            currency: "BRL".into(),
            status: InvoiceStatus::Open,
            period_start: now,
            period_end: now + chrono::Duration::days(30),
            due_date: now + chrono::Duration::days(3),
            payment_id: Some("pay_test_001".into()),
            pix_code: Some("000201...".into()),
            pix_qr_image: None,
            paid_at: None,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();

    // Simulate a verified `payment.paid` webhook.
    billing::handle_payment_event(&state, "payment.paid", "pay_test_001")
        .await
        .unwrap();

    // Invoice is paid, subscription is active for the period.
    let inv = state
        .db
        .invoices()
        .find_one(doc! { "payment_id": "pay_test_001" })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(inv.status, InvoiceStatus::Paid);
    assert!(inv.paid_at.is_some());

    let sub = state
        .db
        .subscriptions()
        .find_one(doc! { "_id": sub_id })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert!(sub.current_period_end.is_some());

    // No Proxmox configured in tests, so provisioning fails -> server marked error
    // (settlement must not be blocked by provisioning).
    let srv = state
        .db
        .servers()
        .find_one(doc! { "_id": server_id })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(srv.state, ServerState::Error);

    // Idempotency: replaying the event keeps the invoice paid (no double-charge).
    billing::handle_payment_event(&state, "payment.paid", "pay_test_001")
        .await
        .unwrap();
    let inv2 = state
        .db
        .invoices()
        .find_one(doc! { "payment_id": "pay_test_001" })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(inv2.status, InvoiceStatus::Paid);
}

#[tokio::test]
async fn auth_rate_limit_returns_429() {
    let Some((_state, app)) = setup(5).await else {
        return;
    };
    let mut last = StatusCode::OK;
    for _ in 0..6 {
        let (s, _) = req(
            &app,
            "POST",
            "/auth/login",
            None,
            Some(json!({ "email": "nobody@test.com", "password": "x" })),
        )
        .await;
        last = s;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
}
