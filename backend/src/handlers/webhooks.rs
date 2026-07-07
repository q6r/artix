//! Inbound webhooks. Unauthenticated by session — instead each request is
//! verified by the provider's HMAC signature over the raw body.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::{
    billing,
    db::Collections,
    error::{AppError, AppResult},
    pagci,
    state::AppState,
};

/// `POST /webhooks/stripe`. Verifies the `Stripe-Signature` HMAC, then settles
/// the matching invoice on `checkout.session.completed`.
pub async fn stripe(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<Value>> {
    let stripe = state
        .stripe
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("stripe not configured".into()))?;
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !stripe.verify_webhook(&body, sig) {
        return Err(AppError::Unauthorized);
    }
    let v: Value = serde_json::from_slice(&body).map_err(|_| AppError::Validation("bad json".into()))?;
    let event_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    if matches!(
        event_type,
        "checkout.session.completed" | "checkout.session.async_payment_succeeded"
    ) {
        let obj = v.pointer("/data/object");
        let paid = obj
            .and_then(|o| o.get("payment_status"))
            .and_then(|p| p.as_str())
            == Some("paid");
        let invoice_id = obj
            .and_then(|o| o.pointer("/metadata/invoice_id"))
            .and_then(|x| x.as_str())
            .or_else(|| obj.and_then(|o| o.get("client_reference_id")).and_then(|x| x.as_str()));
        if paid {
            if let Some(iid) = invoice_id {
                if let Ok(oid) = ObjectId::parse_str(iid) {
                    if let Some(inv) = state.db.invoices().find_one(doc! { "_id": oid }).await? {
                        billing::mark_invoice_paid(&state, &inv).await?;
                    }
                }
            }
        }
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize, Default)]
struct PaymentData {
    #[serde(default)]
    id: String,
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    event: String,
    #[serde(default)]
    resource_type: String,
    #[serde(default)]
    data: PaymentData,
}

/// `POST /webhooks/pagci`. Verifies `X-Webhook-Signature` (HMAC-SHA256 over the
/// raw body), then settles the matching invoice. Replay-protected by timestamp.
pub async fn pagci(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<Value>> {
    let signature = headers
        .get("x-webhook-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let now = Utc::now().timestamp();
    if !pagci::verify_webhook(
        state.cfg.pagci_webhook_secret.as_bytes(),
        signature,
        &body,
        now,
        300,
    ) {
        return Err(AppError::Unauthorized);
    }

    let env: Envelope =
        serde_json::from_slice(&body).map_err(|_| AppError::Validation("invalid payload".into()))?;

    if env.resource_type == "payment" && !env.data.id.is_empty() {
        billing::handle_payment_event(&state, &env.event, &env.data.id).await?;
    }
    Ok(Json(json!({ "received": true })))
}

/// Constant-time check of `X-Hub-Signature-256: sha256=<hex>` over the raw body.
fn verify_github_sig(secret: &[u8], body: &[u8], header: &str) -> bool {
    let hex_sig = match header.strip_prefix("sha256=") {
        Some(h) => h,
        None => return false,
    };
    let mut mac = match Hmac::<Sha256>::new_from_slice(secret) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());
    expected.as_bytes().ct_eq(hex_sig.as_bytes()).unwrap_u8() == 1
}

/// `POST /webhooks/github/:id` — GitHub push → auto-redeploy the container.
pub async fn github(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<Value>> {
    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if event == "ping" {
        return Ok(Json(json!({ "ok": true })));
    }
    if event != "push" {
        return Ok(Json(json!({ "ignored": event })));
    }

    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid, "type": 1 })
        .await?
        .ok_or(AppError::NotFound)?;
    let (sealed, repo, tracked_ref) = match server.container.as_ref() {
        Some(c) => match (
            c.webhook_secret.as_ref(),
            c.github_repo.as_ref(),
            c.github_ref.as_ref(),
            c.github_hook_id,
        ) {
            (Some(s), Some(r), Some(g), Some(_)) => (s.clone(), r.clone(), g.clone()),
            _ => return Ok(Json(json!({ "ok": true, "auto": false }))),
        },
        None => return Ok(Json(json!({ "ok": true, "auto": false }))),
    };

    // Verify the signature with the per-container secret.
    let sig = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let secret = crate::secretbox::open(&state.cfg.auth_token_secret, &sealed)
        .map_err(|_| AppError::Unauthorized)?;
    if !verify_github_sig(&secret, &body, sig) {
        return Err(AppError::Unauthorized);
    }

    // Only redeploy on a push to the tracked ref (ignore other branches/deletes).
    let v: Value = serde_json::from_slice(&body).map_err(|_| AppError::Validation("bad json".into()))?;
    let pushed = v.get("ref").and_then(|x| x.as_str()).unwrap_or("");
    let short = pushed
        .strip_prefix("refs/heads/")
        .or_else(|| pushed.strip_prefix("refs/tags/"))
        .unwrap_or(pushed);
    if short != tracked_ref {
        return Ok(Json(json!({ "ok": true, "skipped_ref": short })));
    }
    if v.get("deleted").and_then(|x| x.as_bool()) == Some(true) {
        return Ok(Json(json!({ "ok": true, "deleted": true })));
    }

    // Redeploy as the OWNER using their stored token.
    let owner_id = server.user_id;
    let owner = match state.db.users().find_one(doc! { "_id": owner_id }).await? {
        Some(u) => u,
        None => return Ok(Json(json!({ "ok": true }))),
    };
    let token = match owner
        .github_access_token
        .as_deref()
        .and_then(|s| crate::secretbox::open(&state.cfg.auth_token_secret, s).ok())
        .and_then(|b| String::from_utf8(b).ok())
    {
        Some(t) => t,
        None => {
            // Owner unlinked GitHub → disable auto-deploy (can't delete remote hook).
            crate::handlers::containers::disable_auto_deploy(&state, oid, None).await;
            return Ok(Json(json!({ "ok": true, "auto_disabled": true })));
        }
    };
    let name = owner.display_name.clone();
    // Respond fast; run the (slow) build in the background.
    let st = state.clone();
    tokio::spawn(async move {
        let _ = crate::handlers::containers::run_github_deploy(
            &st,
            &server,
            &token,
            &repo,
            Some(&tracked_ref),
            owner_id,
            &name,
            "auto",
            false,
        )
        .await;
    });
    Ok(Json(json!({ "ok": true, "queued": true })))
}
