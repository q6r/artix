//! Stripe card payments via hosted Checkout Sessions.
//!
//! We create a Checkout Session for an invoice (returns a hosted URL the
//! customer is redirected to), and confirm payment via the
//! `checkout.session.completed` webhook (HMAC-verified). Disabled (returns
//! `None`) unless `STRIPE_ENABLED=true` and a secret key is set.

use std::time::Duration;

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::{
    config::Config,
    error::{AppError, AppResult},
};

#[derive(Clone)]
pub struct StripeClient {
    http: reqwest::Client,
    secret: String,
    webhook_secret: String,
    app_url: String,
}

pub struct StripeCheckout {
    pub id: String,
    pub url: String,
}

impl StripeClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if !cfg.stripe_enabled || cfg.stripe_secret_key.is_empty() {
            return None;
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .ok()?;
        Some(Self {
            http,
            secret: cfg.stripe_secret_key.clone(),
            webhook_secret: cfg.stripe_webhook_secret.clone(),
            app_url: cfg.public_app_url.trim_end_matches('/').to_string(),
        })
    }

    /// Create a hosted Checkout Session for the invoice. Returns `(id, url)`.
    pub async fn create_checkout_session(
        &self,
        amount_cents: i64,
        currency: &str,
        name: &str,
        invoice_id: &str,
    ) -> AppResult<StripeCheckout> {
        let success = format!("{}/dashboard/billing/{}?paid=1", self.app_url, invoice_id);
        let cancel = format!("{}/dashboard/billing/{}", self.app_url, invoice_id);
        let form = [
            ("mode", "payment".to_string()),
            ("success_url", success),
            ("cancel_url", cancel),
            ("client_reference_id", invoice_id.to_string()),
            ("metadata[invoice_id]", invoice_id.to_string()),
            ("payment_intent_data[metadata][invoice_id]", invoice_id.to_string()),
            ("line_items[0][quantity]", "1".to_string()),
            ("line_items[0][price_data][currency]", currency.to_lowercase()),
            ("line_items[0][price_data][unit_amount]", amount_cents.to_string()),
            ("line_items[0][price_data][product_data][name]", name.to_string()),
        ];
        let res = self
            .http
            .post("https://api.stripe.com/v1/checkout/sessions")
            .bearer_auth(&self.secret)
            .form(&form)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("stripe request: {e}")))?;
        let status = res.status();
        let v: Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("stripe decode: {e}")))?;
        if !status.is_success() {
            let msg = v
                .pointer("/error/message")
                .and_then(|m| m.as_str())
                .unwrap_or("stripe error");
            return Err(AppError::Internal(format!("stripe status {status}: {msg}")));
        }
        Ok(StripeCheckout {
            id: v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
            url: v.get("url").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
        })
    }

    /// Verify the `Stripe-Signature` header (`t=…,v1=…`) over the raw body.
    pub fn verify_webhook(&self, payload: &[u8], sig_header: &str) -> bool {
        if self.webhook_secret.is_empty() {
            return false;
        }
        let mut t = "";
        let mut sigs: Vec<&str> = Vec::new();
        for part in sig_header.split(',') {
            if let Some((k, val)) = part.split_once('=') {
                match k {
                    "t" => t = val,
                    "v1" => sigs.push(val),
                    _ => {}
                }
            }
        }
        if t.is_empty() || sigs.is_empty() {
            return false;
        }
        // Replay protection: reject events whose timestamp is outside a 5-minute
        // tolerance (Stripe's recommended default).
        match t.parse::<i64>() {
            Ok(ts) if (Utc::now().timestamp() - ts).abs() <= 300 => {}
            _ => return false,
        }
        let mut mac = match Hmac::<Sha256>::new_from_slice(self.webhook_secret.as_bytes()) {
            Ok(m) => m,
            Err(_) => return false,
        };
        mac.update(t.as_bytes());
        mac.update(b".");
        mac.update(payload);
        let expected = mac.finalize().into_bytes();
        // Constant-time comparison of the decoded signature bytes.
        sigs.iter().any(|s| {
            hex::decode(s).ok().is_some_and(|provided| {
                provided.len() == expected.len() && provided.ct_eq(&expected).unwrap_u8() == 1
            })
        })
    }
}
