//! Integration tests that prove the security protections end-to-end.
//!
//! They require a MongoDB. Set `MONGO_TEST_URI` to run them; otherwise each
//! test no-ops (so `cargo test` stays green without a DB). Users sign in through
//! the real passwordless flow (`request-code`, then `verify-code`). In CI:
//!
//! ```bash
//! MONGO_TEST_URI=mongodb://localhost:27017 cargo test
//! ```

use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use artixcloud_api::{
    auth::token, build_router, config::Config, db, db::Collections, seed, state::AppState,
};
use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use bson::{doc, oid::ObjectId};
use serde_json::{json, Value};
use tower::ServiceExt;

/// The configuration the tests run with. It goes through the real loader, so a new
/// setting gets its default here instead of breaking a hand-written `Config { .. }`.
/// Only what a test needs to control is set; no integration is configured.
fn test_config(uri: String, db_name: String, auth_rate: u32) -> Config {
    let vars: HashMap<&str, String> = HashMap::from([
        ("API_HOST", "127.0.0.1".to_string()),
        ("API_PORT", "0".to_string()),
        ("PUBLIC_APP_URL", "http://app.test".to_string()),
        ("PUBLIC_API_URL", "http://api.test".to_string()),
        ("MONGO_URI", uri),
        ("MONGO_DB", db_name),
        (
            "AUTH_TOKEN_SECRET",
            "integration-secret-key-32-bytes-minimum!".to_string(),
        ),
        (
            "AUTH_REFRESH_PEPPER",
            "integration-pepper-key-32-bytes-minimum!".to_string(),
        ),
        ("EMAIL_FROM", "test@artix".to_string()),
        ("RATE_LIMIT_PER_MINUTE", "10000".to_string()),
        ("AUTH_RATE_LIMIT_PER_MINUTE", auth_rate.to_string()),
    ]);
    let cfg =
        Config::from_lookup(|key| vars.get(key).cloned()).expect("a valid test configuration");
    // No browser origin is allowed in the tests (the loader would default to localhost).
    Config {
        cors_origins: vec![],
        ..cfg
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

/// The code the tests sign in with (see [`swap_in_known_code`]).
const KNOWN_CODE: &str = "123456";

/// A test cannot read the emailed login code (no email is delivered), so it replaces the stored hash
/// of the random code with the hash of a known one. After that the code can be "read from the email".
async fn swap_in_known_code(state: &AppState, user_id: ObjectId) {
    let swapped = state
        .db
        .email_tokens()
        .update_one(
            doc! { "user_id": user_id, "kind": "login_code", "used_at": null },
            doc! { "$set": {
                "token_hash": token::hash_refresh(KNOWN_CODE, &state.cfg.auth_refresh_pepper),
            } },
        )
        .await
        .unwrap();
    assert_eq!(
        swapped.modified_count, 1,
        "request-code stores exactly one unused login code"
    );
}

/// A signed-in user.
struct SignedIn {
    access: String,
    refresh: String,
    user_id: ObjectId,
}

/// Signs `email` in through the real passwordless flow: `POST /auth/request-code` creates the account,
/// then `POST /auth/verify-code` trades the code for a session.
async fn sign_in(state: &AppState, app: &Router, email: &str) -> SignedIn {
    let (s, _) = req(
        app,
        "POST",
        "/auth/request-code",
        None,
        Some(json!({ "email": email, "display_name": "Test User" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "request-code");
    let user = state
        .db
        .users()
        .find_one(doc! { "email": email })
        .await
        .unwrap()
        .expect("request-code creates the account");
    swap_in_known_code(state, user.id.unwrap()).await;

    let (s, v) = req(
        app,
        "POST",
        "/auth/verify-code",
        None,
        Some(json!({ "email": email, "code": KNOWN_CODE })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "verify-code");
    SignedIn {
        access: v["access_token"].as_str().unwrap().to_string(),
        refresh: v["refresh_token"].as_str().unwrap().to_string(),
        user_id: ObjectId::parse_str(v["user"]["id"].as_str().unwrap()).unwrap(),
    }
}

#[tokio::test]
async fn sign_in_with_an_emailed_code() {
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let email = "reg@test.com";

    // Asking for a code creates the account and always answers `ok`.
    let (s, v) = req(
        &app,
        "POST",
        "/auth/request-code",
        None,
        Some(json!({ "email": email })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["ok"], json!(true));
    let user = state
        .db
        .users()
        .find_one(doc! { "email": email })
        .await
        .unwrap()
        .expect("the account was created");
    assert!(!user.email_verified);
    swap_in_known_code(&state, user.id.unwrap()).await;

    // A wrong code is refused and signs nobody in.
    let (s, v) = req(
        &app,
        "POST",
        "/auth/verify-code",
        None,
        Some(json!({ "email": email, "code": "000000" })),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert!(v["access_token"].is_null());

    // The right code signs in and proves the email address.
    let verify = json!({ "email": email, "code": KNOWN_CODE });
    let (s, v) = req(
        &app,
        "POST",
        "/auth/verify-code",
        None,
        Some(verify.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["access_token"].is_string());
    assert!(v["refresh_token"].is_string());
    let user = state
        .db
        .users()
        .find_one(doc! { "email": email })
        .await
        .unwrap()
        .unwrap();
    assert!(user.email_verified);

    // A code works once.
    let (s, _) = req(&app, "POST", "/auth/verify-code", None, Some(verify)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refresh_rotation_and_reuse_detection() {
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let rt1 = sign_in(&state, &app, "rot@test.com").await.refresh;

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
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let access = sign_in(&state, &app, "me@test.com").await.access;

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
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let a = sign_in(&state, &app, "a@test.com").await;
    let b = sign_in(&state, &app, "b@test.com").await;
    let access_a = a.access.clone();
    // A refresh token is `<session id>.<secret>`.
    let sid_a = a.refresh.split('.').next().unwrap();
    let sid_b = b.refresh.split('.').next().unwrap();

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
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let access = sign_in(&state, &app, "plain@test.com").await.access;

    // Authenticated but without `users.read` -> 403, not 401.
    let (s, _) = req(&app, "GET", "/admin/users", Some(&access), None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_with_permission_allowed() {
    let Some((state, app)) = setup(1000).await else {
        return;
    };
    let admin = sign_in(&state, &app, "admin@test.com").await;
    let (access, uid) = (admin.access, admin.user_id);

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
    let uid = sign_in(&state, &app, "pay@test.com").await.user_id;
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
            storage: None,
            root_password: None,
            ssh_host: None,
            ssh_port: None,
            specs: ServerSpecs {
                vcpu: 2,
                ram_gb: 4,
                disk_gb: 50,
            },
            server_type: 0,
            container: None,
            expires_at: None,
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
            provider: Some("pix".into()),
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
            provider: Some("pix".into()),
            crypto_address: None,
            crypto_amount_ltc: None,
            crypto_expires_at: None,
            stripe_url: None,
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
    // Guessing login codes for one account over and over: the first five tries in a minute are
    // answered, the sixth is refused before the handler looks at the code.
    let mut statuses = Vec::new();
    for _ in 0..6 {
        let (s, _) = req(
            &app,
            "POST",
            "/auth/verify-code",
            None,
            Some(json!({ "email": "nobody@test.com", "code": "000000" })),
        )
        .await;
        statuses.push(s);
    }
    assert_eq!(statuses[..5], [StatusCode::UNAUTHORIZED; 5]);
    assert_eq!(statuses[5], StatusCode::TOO_MANY_REQUESTS);
}
