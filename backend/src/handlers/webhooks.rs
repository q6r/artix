//! Inbound webhooks. Unauthenticated by session — instead each request is
//! verified by the provider's HMAC signature over the raw body.

use axum::{body::Bytes, extract::State, http::HeaderMap, Json};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

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
