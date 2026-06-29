//! Crypto (Litecoin) payments via the eupa/pagay API.
//!
//! Auth is an `X-API-Key` header. We create a payment for an invoice (returns a
//! deposit address + LTC amount), then confirm it by polling the payment status
//! (`paid`). Disabled (returns `None` from `from_config`) when the API key /
//! wallet are not set, so the app runs fine without crypto billing.

use std::time::Duration;

use serde_json::{json, Value};

use crate::{
    config::Config,
    error::{AppError, AppResult},
};

#[derive(Clone)]
pub struct CryptoClient {
    http: reqwest::Client,
    base: String,
    api_key: String,
    wallet_id: String,
    fee_to_customer: bool,
}

/// A freshly created LTC charge for an invoice.
#[derive(Debug, Clone)]
pub struct CryptoCharge {
    pub payment_id: String,
    pub address: String,
    pub amount_ltc: f64,
    pub amount_brl: i64,
    pub expires_at: Option<String>,
    pub status: String,
}

impl CryptoClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if cfg.eupa_api_key.is_empty() || cfg.eupa_wallet_id.is_empty() {
            return None;
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .ok()?;
        Some(Self {
            http,
            base: cfg.eupa_api_url.trim_end_matches('/').to_string(),
            api_key: cfg.eupa_api_key.clone(),
            wallet_id: cfg.eupa_wallet_id.clone(),
            fee_to_customer: cfg.eupa_fee_to_customer,
        })
    }

    async fn send(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> AppResult<Value> {
        let mut rb = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .header("X-API-Key", &self.api_key);
        if let Some(b) = body {
            rb = rb.json(&b);
        }
        let res = rb
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("crypto request: {e}")))?;
        let status = res.status();
        let v: Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("crypto decode: {e}")))?;
        if !status.is_success() {
            let msg = v
                .get("error")
                .or_else(|| v.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("crypto error");
            return Err(AppError::Internal(format!("crypto status {status}: {msg}")));
        }
        Ok(v)
    }

    /// Create an LTC payment for `amount_cents` (BRL). Returns the address + amount.
    pub async fn create_payment(
        &self,
        amount_cents: i64,
        item_name: &str,
        customer_id: &str,
        customer_email: &str,
        expiration_minutes: u32,
    ) -> AppResult<CryptoCharge> {
        let body = json!({
            "items": [{ "id": item_name, "name": item_name, "value": amount_cents }],
            "recipients": [{ "wallet_id": self.wallet_id, "amount": amount_cents }],
            "customer": { "id": customer_id, "email": customer_email },
            "fee_to_customer": self.fee_to_customer,
            "expiration_minutes": expiration_minutes,
        });
        let d = self.send(reqwest::Method::POST, "/v1/crypto/payments", Some(body)).await?;
        let get = |k: &str| d.get(k).cloned().unwrap_or(Value::Null);
        Ok(CryptoCharge {
            payment_id: get("id").as_str().unwrap_or_default().to_string(),
            address: get("address").as_str().unwrap_or_default().to_string(),
            amount_ltc: get("amountLtc").as_f64().unwrap_or(0.0),
            amount_brl: get("amountBrl").as_i64().unwrap_or(amount_cents),
            expires_at: get("expiresAt").as_str().map(|s| s.to_string()),
            status: get("status").as_str().unwrap_or("pending").to_string(),
        })
    }

    /// Current status of a payment (`pending` | `paid` | `expired`).
    pub async fn payment_status(&self, payment_id: &str) -> AppResult<String> {
        let d = self
            .send(reqwest::Method::GET, &format!("/v1/crypto/payments/{payment_id}"), None)
            .await?;
        Ok(d.get("status").and_then(|s| s.as_str()).unwrap_or("pending").to_string())
    }
}
