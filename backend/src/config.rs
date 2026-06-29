//! Strongly-typed configuration loaded once from the environment.
//! No secret is ever hardcoded — everything comes from `.env` / real env vars.

use std::collections::HashMap;
use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Staging,
    Production,
}

impl AppEnv {
    pub fn is_production(self) -> bool {
        matches!(self, AppEnv::Production)
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub env: AppEnv,
    pub host: String,
    pub port: u16,
    pub cors_origins: Vec<String>,

    pub public_app_url: String,
    pub public_api_url: String,

    pub mongo_uri: String,
    pub mongo_db: String,

    pub auth_token_secret: Vec<u8>,
    pub auth_refresh_pepper: Vec<u8>,
    pub access_ttl_secs: i64,
    pub refresh_ttl_secs: i64,
    pub email_token_ttl_secs: i64,
    /// Short TTL for passwordless login codes (separate from email links).
    pub login_code_ttl_secs: i64,

    pub resend_api_key: String,
    pub email_from: String,

    pub discord_client_id: String,
    pub discord_client_secret: String,
    pub github_client_id: String,
    pub github_client_secret: String,

    pub rate_limit_per_min: u32,
    pub auth_rate_limit_per_min: u32,
    pub max_failed_logins: u32,
    pub lockout_minutes: i64,

    pub proxmox_api_url: String,
    pub proxmox_token_id: String,
    pub proxmox_token_secret: String,
    pub proxmox_node: String,
    pub proxmox_template_vmid: i64,
    pub proxmox_storage: String,
    pub proxmox_bridge: String,
    pub proxmox_insecure: bool,
    /// OS label -> template VMID (e.g. {"Debian 12": 9001}). Falls back to
    /// `proxmox_template_vmid` for any label not listed.
    pub os_templates: HashMap<String, i64>,

    // frp relays (public SSH entrypoint for NAT'd VPS)
    /// JSON array of relays (preferred). When empty, falls back to the flat
    /// FRP_* vars below as a single relay.
    pub frp_relays: String,
    pub frp_relay_host: String,
    pub frp_server_addr: String,
    pub frp_server_port: u16,
    pub frp_token: String,
    pub frp_admin_url: String,
    pub frp_admin_user: String,
    pub frp_admin_pass: String,
    pub frp_port_min: u16,
    pub frp_port_max: u16,

    // Crypto payments (eupa/pagay — LTC)
    pub eupa_api_url: String,
    pub eupa_api_key: String,
    pub eupa_wallet_id: String,
    pub eupa_fee_to_customer: bool,
    // Stripe (card payments via Checkout)
    pub stripe_enabled: bool,
    pub stripe_secret_key: String,
    pub stripe_webhook_secret: String,

    // Billing / PagCI (PIX)
    pub pagci_api_url: String,
    pub pagci_api_token: String,
    pub pagci_wallet_id: String,
    pub pagci_wallet_name: String,
    pub pagci_webhook_secret: String,
    pub billing_currency: String,
    /// Days a customer has to pay an invoice before the VPS is suspended.
    pub billing_grace_days: i64,
    /// How many days before period end to issue the renewal invoice.
    pub billing_renew_lead_days: i64,
    /// PIX charge validity in seconds (informational; PagCI enforces its own).
    pub billing_pix_ttl_secs: i64,
    /// Run the in-process billing worker (issue renewals, suspend overdue).
    pub billing_worker_enabled: bool,
    /// Grace period (days) after a VPS `expires_at` before it is suspended.
    pub expiry_grace_days: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing required env var: {0}")]
    Missing(&'static str),
    #[error("invalid value for {0}: {1}")]
    Invalid(&'static str, String),
}

fn req(key: &'static str) -> Result<String, ConfigError> {
    env::var(key).map_err(|_| ConfigError::Missing(key))
}

fn opt(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse<T: std::str::FromStr>(key: &'static str, default: T) -> Result<T, ConfigError> {
    match env::var(key) {
        Ok(v) => v
            .parse::<T>()
            .map_err(|_| ConfigError::Invalid(key, "parse failed".into())),
        Err(_) => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let env = match opt("APP_ENV", "development").as_str() {
            "production" => AppEnv::Production,
            "staging" => AppEnv::Staging,
            _ => AppEnv::Development,
        };

        let auth_token_secret = req("AUTH_TOKEN_SECRET")?.into_bytes();
        let auth_refresh_pepper = req("AUTH_REFRESH_PEPPER")?.into_bytes();

        // Hard fail in production if secrets are weak.
        if env.is_production() {
            if auth_token_secret.len() < 32 {
                return Err(ConfigError::Invalid(
                    "AUTH_TOKEN_SECRET",
                    "must be >= 32 bytes in production".into(),
                ));
            }
            if auth_refresh_pepper.len() < 32 {
                return Err(ConfigError::Invalid(
                    "AUTH_REFRESH_PEPPER",
                    "must be >= 32 bytes in production".into(),
                ));
            }
        }

        let cors_origins = opt("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(Config {
            env,
            host: opt("API_HOST", "0.0.0.0"),
            port: parse("API_PORT", 8080u16)?,
            cors_origins,
            public_app_url: opt("PUBLIC_APP_URL", "http://localhost:3000"),
            public_api_url: opt("PUBLIC_API_URL", "http://localhost:8080"),
            mongo_uri: opt("MONGO_URI", "mongodb://localhost:27017"),
            mongo_db: opt("MONGO_DB", "artixcloud"),
            auth_token_secret,
            auth_refresh_pepper,
            access_ttl_secs: parse("ACCESS_TOKEN_TTL_SECONDS", 900i64)?,
            refresh_ttl_secs: parse("REFRESH_TOKEN_TTL_SECONDS", 2_592_000i64)?,
            email_token_ttl_secs: parse("EMAIL_TOKEN_TTL_SECONDS", 86_400i64)?,
            login_code_ttl_secs: parse("LOGIN_CODE_TTL_SECONDS", 600i64)?,
            resend_api_key: opt("RESEND_API_KEY", ""),
            email_from: opt("EMAIL_FROM", "ArtixCloud <no-reply@artixcloud.com>"),
            discord_client_id: opt("DISCORD_CLIENT_ID", ""),
            discord_client_secret: opt("DISCORD_CLIENT_SECRET", ""),
            github_client_id: opt("GITHUB_CLIENT_ID", ""),
            github_client_secret: opt("GITHUB_CLIENT_SECRET", ""),
            rate_limit_per_min: parse("RATE_LIMIT_PER_MINUTE", 120u32)?,
            auth_rate_limit_per_min: parse("AUTH_RATE_LIMIT_PER_MINUTE", 10u32)?,
            max_failed_logins: parse("MAX_FAILED_LOGINS", 8u32)?,
            lockout_minutes: parse("LOCKOUT_MINUTES", 15i64)?,
            proxmox_api_url: opt("PROXMOX_API_URL", ""),
            proxmox_token_id: opt("PROXMOX_TOKEN_ID", ""),
            proxmox_token_secret: opt("PROXMOX_TOKEN_SECRET", ""),
            proxmox_node: opt("PROXMOX_NODE", "pve"),
            proxmox_template_vmid: parse("PROXMOX_TEMPLATE_VMID", 9000i64)?,
            proxmox_storage: opt("PROXMOX_STORAGE", "local-lvm"),
            proxmox_bridge: opt("PROXMOX_BRIDGE", "vmbr0"),
            proxmox_insecure: opt("PROXMOX_INSECURE", "false") == "true",
            os_templates: serde_json::from_str(&opt("OS_TEMPLATES", "{}")).unwrap_or_default(),
            frp_relays: opt("FRP_RELAYS", ""),
            frp_relay_host: opt("FRP_RELAY_HOST", ""),
            frp_server_addr: opt("FRP_SERVER_ADDR", ""),
            frp_server_port: parse("FRP_SERVER_PORT", 7000u16)?,
            frp_token: opt("FRP_TOKEN", ""),
            frp_admin_url: opt("FRP_ADMIN_URL", ""),
            frp_admin_user: opt("FRP_ADMIN_USER", "artix"),
            frp_admin_pass: opt("FRP_ADMIN_PASS", ""),
            frp_port_min: parse("FRP_PORT_MIN", 2200u16)?,
            frp_port_max: parse("FRP_PORT_MAX", 2300u16)?,
            eupa_api_url: opt("EUPA_API_URL", "https://api.eupa.gay"),
            eupa_api_key: opt("EUPA_API_KEY", ""),
            eupa_wallet_id: opt("EUPA_WALLET_ID", ""),
            eupa_fee_to_customer: opt("EUPA_FEE_TO_CUSTOMER", "true") == "true",
            stripe_enabled: opt("STRIPE_ENABLED", "false") == "true",
            stripe_secret_key: opt("STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret: opt("STRIPE_WEBHOOK_SECRET", ""),
            pagci_api_url: opt("PAGCI_API_URL", ""),
            pagci_api_token: opt("PAGCI_API_TOKEN", ""),
            pagci_wallet_id: opt("PAGCI_WALLET_ID", ""),
            pagci_wallet_name: opt("PAGCI_WALLET_NAME", "artix"),
            pagci_webhook_secret: opt("PAGCI_WEBHOOK_SECRET", ""),
            billing_currency: opt("BILLING_CURRENCY", "BRL"),
            billing_grace_days: parse("BILLING_GRACE_DAYS", 3i64)?,
            billing_renew_lead_days: parse("BILLING_RENEW_LEAD_DAYS", 3i64)?,
            billing_pix_ttl_secs: parse("BILLING_PIX_TTL_SECONDS", 86_400i64)?,
            billing_worker_enabled: opt("BILLING_WORKER_ENABLED", "false") == "true",
            expiry_grace_days: parse("EXPIRY_GRACE_DAYS", 3i64)?,
        })
    }
}
