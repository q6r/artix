//! Thin client for the PagCI PIX payment API.
//!
//! Auth is a Bearer token (`PAGCI_API_TOKEN`). We create one-shot PIX charges
//! (`POST /payments`) into our "artix" wallet and learn the result via signed
//! webhooks (`payment.paid` / `payment.expired` / …). PIX has no native
//! recurrence, so subscription renewal is driven by our own billing worker.
//!
//! Disabled (returns `None` from `from_config`) when `PAGCI_API_URL`/token/wallet
//! are unset, so the app runs fine without billing configured.

use std::time::Duration;

use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::{config::Config, error::AppError, error::AppResult};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct PagCiClient {
    http: reqwest::Client,
    base: String,
    token: String,
    wallet_id: String,
    wallet_name: String,
}

/// What we need back from `POST /payments`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ChargeResult {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub status: String,
    /// QR image data (only present when `qr: true` was requested).
    #[serde(default)]
    pub qr_code: Option<String>,
    #[serde(default)]
    pub liquidator: Liquidator,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Liquidator {
    /// PIX copy-paste (BR Code) payload the customer pays.
    #[serde(default)]
    pub pix_qr: Option<String>,
}

pub struct ChargeRequest<'a> {
    pub amount_cents: i64,
    pub customer_name: &'a str,
    pub customer_email: &'a str,
    pub description: &'a str,
    /// Per-charge webhook override (so we always receive callbacks).
    pub webhook_url: Option<&'a str>,
}

impl PagCiClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if cfg.pagci_api_url.is_empty()
            || cfg.pagci_api_token.is_empty()
            || cfg.pagci_wallet_id.is_empty()
        {
            return None;
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .ok()?;
        Some(Self {
            http,
            base: cfg.pagci_api_url.trim_end_matches('/').to_string(),
            token: cfg.pagci_api_token.clone(),
            wallet_id: cfg.pagci_wallet_id.clone(),
            wallet_name: cfg.pagci_wallet_name.clone(),
        })
    }

    /// Create a PIX charge into the artix wallet. Returns the payment id and the
    /// copy-paste / QR payload to show the customer.
    pub async fn create_charge(&self, req: ChargeRequest<'_>) -> AppResult<ChargeResult> {
        let mut body = serde_json::json!({
            "kind": "pix_charge",
            "qr": true,
            "owner": { "wallet_id": self.wallet_id, "name": self.wallet_name },
            "customer": { "name": req.customer_name, "email": req.customer_email },
            "recipients": [ { "wallet_id": self.wallet_id, "amount": req.amount_cents } ],
            "items": [ { "name": req.description, "amount": req.amount_cents, "quantity": 1 } ],
        });
        if let Some(url) = req.webhook_url {
            body["config"] = serde_json::json!({ "overwrite_webhook_url": url });
        }

        let res = self
            .http
            .post(format!("{}/payments", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("pagci request: {e}")))?;

        if !res.status().is_success() {
            let status = res.status();
            let txt = res.text().await.unwrap_or_default();
            tracing::error!(%status, body = %txt, "pagci create_charge failed");
            return Err(AppError::Unavailable("payment provider error".into()));
        }
        res.json::<ChargeResult>()
            .await
            .map_err(|e| AppError::Internal(format!("pagci decode: {e}")))
    }

    /// Fetch a payment's current status (reconciliation / fallback to webhooks).
    pub async fn get_payment(&self, id: &str) -> AppResult<ChargeResult> {
        let res = self
            .http
            .get(format!("{}/payments/{}", self.base, id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("pagci request: {e}")))?;
        if !res.status().is_success() {
            return Err(AppError::Unavailable("payment provider error".into()));
        }
        res.json::<ChargeResult>()
            .await
            .map_err(|e| AppError::Internal(format!("pagci decode: {e}")))
    }
}

/// Verify a PagCI webhook signature.
///
/// Header: `X-Webhook-Signature: t={unix_ts},v1={hex}`.
/// `v1 == hex(HMAC_SHA256(secret, "{t}.{raw_body}"))`. Reject stale timestamps
/// (replay window) and compare in constant time.
pub fn verify_webhook(
    secret: &[u8],
    signature_header: &str,
    raw_body: &[u8],
    now_unix: i64,
    tolerance_secs: i64,
) -> bool {
    if secret.is_empty() {
        return false;
    }
    let mut ts: Option<i64> = None;
    let mut v1: Option<&str> = None;
    for part in signature_header.split(',') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix("t=") {
            ts = v.parse::<i64>().ok();
        } else if let Some(v) = part.strip_prefix("v1=") {
            v1 = Some(v);
        }
    }
    let (ts, v1) = match (ts, v1) {
        (Some(t), Some(v)) => (t, v),
        _ => return false,
    };
    if (now_unix - ts).abs() > tolerance_secs {
        return false;
    }

    let mut mac = match HmacSha256::new_from_slice(secret) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(ts.to_string().as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    let expected = hex::encode(mac.finalize().into_bytes());

    // Constant-time comparison.
    let provided = v1.as_bytes();
    expected.as_bytes().ct_eq(provided).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &[u8], ts: i64, body: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(secret).unwrap();
        mac.update(ts.to_string().as_bytes());
        mac.update(b".");
        mac.update(body);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn webhook_signature_roundtrip() {
        let secret = b"whsec_test_value";
        let body = br#"{"event":"payment.paid","data":{"id":"pay_1"}}"#;
        let ts = 1_900_000_000i64;
        let header = format!("t={ts},v1={}", sign(secret, ts, body));

        assert!(verify_webhook(secret, &header, body, ts, 300));
        // tampered body
        assert!(!verify_webhook(secret, &header, b"{}", ts, 300));
        // stale timestamp
        assert!(!verify_webhook(secret, &header, body, ts + 1000, 300));
        // wrong secret
        assert!(!verify_webhook(b"other", &header, body, ts, 300));
        // malformed header
        assert!(!verify_webhook(secret, "garbage", body, ts, 300));
    }
}
