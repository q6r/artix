//! Strongly-typed configuration loaded once from the environment.
//!
//! No secret is ever hardcoded: everything comes from `.env` / real env vars.
//! `docs/configuration.md` is the reference for every variable.
//!
//! Loading never stops at the first problem: [`Config::from_lookup`] reads every
//! variable, records everything that is wrong and returns all of it in one
//! [`ConfigError`]. The rules are the same for every variable:
//!
//! * a value is trimmed, and a blank value counts as unset (the default applies;
//!   a required variable is reported as missing);
//! * a boolean is exactly `true` or `false` (lowercase), nothing else;
//! * secrets are never echoed: no error, warning or `Debug` output carries one.

use std::{collections::HashMap, fmt, str::FromStr};

use serde::de::DeserializeOwned;

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

    /// The exact value `APP_ENV` accepts for this environment.
    pub fn as_str(self) -> &'static str {
        match self {
            AppEnv::Development => "development",
            AppEnv::Staging => "staging",
            AppEnv::Production => "production",
        }
    }
}

#[derive(Clone)]
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
    pub storage_sell_threshold: f64,
    pub storage_pool: Vec<String>,
    pub proxmox_bridge: String,
    pub proxmox_insecure: bool,
    /// A real PVE user (e.g. `console@pve`) restricted to VM.Console — needed for
    /// the xterm.js serial terminal, whose in-band auth rejects API tokens.
    pub proxmox_console_user: String,
    pub proxmox_console_password: String,
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
    /// Container agent (Docker VM) base URL + bearer token. Empty = disabled.
    pub container_agent_url: String,
    pub container_agent_token: String,
    /// Public base URL GitHub can reach for push webhooks (e.g. https://artix.cloud).
    /// Empty disables auto-redeploy registration.
    pub public_webhook_base: String,
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
    /// Public IP of the relay that fronts custom domains (Caddy on-demand TLS).
    /// Customers point their domain's A record here. Not a secret.
    pub custom_domain_relay_ip: String,

    /// LiveKit (browser voice) — API key/secret to sign join tokens, and the
    /// public wss URL the browser connects to. Secret is sensitive.
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub livekit_url: String,
    /// Internal LiveKit URL the backend uses for the server API (list
    /// participants, etc.) — reaches the Docker VM directly, not via the relay.
    /// Empty by default: the call roster answers 503 until it is set.
    pub livekit_host_url: String,

    /// Minecraft public-port pool: a per-relay range distinct from the SSH range,
    /// forwarded (frp TCP/UDP) to the container's published port on the Docker VM.
    pub mc_port_min: u16,
    pub mc_port_max: u16,
    /// The Docker VM IP the host-side frpc dials for Minecraft ports (published
    /// on the VM). Defaults to parsing the host from `container_agent_url`.
    pub container_vm_ip: String,

    /// Cloudflare API token + zone for writing DNS (Minecraft A/SRV records so
    /// players connect by `<sub>.artix.cloud`). Empty disables the feature.
    pub cloudflare_api_token: String,
    pub cloudflare_zone_id: String,
    /// Apex zone name the subdomains live under (e.g. "artix.cloud").
    pub cloudflare_zone_name: String,
}

/// One thing wrong with the configuration. `message` never holds a secret value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigProblem {
    /// The environment variable the problem is about.
    pub key: &'static str,
    /// What is wrong and what is expected instead.
    pub message: String,
}

impl fmt::Display for ConfigProblem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.key, self.message)
    }
}

/// Everything wrong with the configuration, found in a single pass (never empty).
/// `Display` prints one `KEY: message` line per problem.
#[derive(Debug, thiserror::Error)]
#[error("{}", join_lines(.problems))]
pub struct ConfigError {
    problems: Vec<ConfigProblem>,
}

impl ConfigError {
    /// Every problem found, in the order the variables were read.
    pub fn problems(&self) -> &[ConfigProblem] {
        &self.problems
    }
}

fn join_lines(problems: &[ConfigProblem]) -> String {
    problems
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Production refuses auth secrets shorter than this many bytes.
const MIN_SECRET_BYTES: usize = 32;

/// Variables whose value must never appear in an error, a warning or a log line:
/// credentials, tokens, a URL that embeds credentials (`MONGO_URI`) and the JSON
/// that holds relay tokens (`FRP_RELAYS`). Everything that would echo a raw value
/// checks this list first.
const SECRET_KEYS: &[&str] = &[
    "MONGO_URI",
    "AUTH_TOKEN_SECRET",
    "AUTH_REFRESH_PEPPER",
    "RESEND_API_KEY",
    "DISCORD_CLIENT_SECRET",
    "GITHUB_CLIENT_SECRET",
    "PROXMOX_TOKEN_ID",
    "PROXMOX_TOKEN_SECRET",
    "PROXMOX_CONSOLE_PASSWORD",
    "FRP_RELAYS",
    "FRP_TOKEN",
    "FRP_ADMIN_PASS",
    "EUPA_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAGCI_API_TOKEN",
    "PAGCI_WEBHOOK_SECRET",
    "CONTAINER_AGENT_TOKEN",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "CLOUDFLARE_API_TOKEN",
];

/// `, got "<value>"` for a variable that is not secret, nothing at all for one
/// that is. Long values are cut short so one bad line cannot flood the output.
fn got(key: &str, value: &str) -> String {
    if SECRET_KEYS.contains(&key) {
        return String::new();
    }
    const MAX_CHARS: usize = 48;
    let mut shown: String = value.chars().take(MAX_CHARS).collect();
    if value.chars().count() > MAX_CHARS {
        shown.push_str("...");
    }
    format!(", got {shown:?}")
}

/// A numeric variable type the loader can parse. `EXPECTED` is what the error
/// message tells the operator to write instead.
trait Number: FromStr + PartialOrd + fmt::Display + Copy {
    const EXPECTED: &'static str;
}

impl Number for u16 {
    const EXPECTED: &'static str = "a whole number between 0 and 65535";
}

impl Number for u32 {
    const EXPECTED: &'static str = "a whole number between 0 and 4294967295";
}

impl Number for i64 {
    const EXPECTED: &'static str = "a whole number";
}

/// Reads variables through a lookup function and RECORDS every problem instead of
/// stopping at the first one: each method returns a usable placeholder (the
/// default) after a failure, so one pass reports everything. Every method reads
/// its variable unconditionally.
struct Loader<'a> {
    get: &'a dyn Fn(&str) -> Option<String>,
    problems: Vec<ConfigProblem>,
}

impl<'a> Loader<'a> {
    fn new(get: &'a dyn Fn(&str) -> Option<String>) -> Self {
        Loader {
            get,
            problems: Vec::new(),
        }
    }

    /// The trimmed value, or `None` when the variable is unset or blank.
    fn value(&self, key: &str) -> Option<String> {
        let raw = (self.get)(key)?;
        let trimmed = raw.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    fn fail(&mut self, key: &'static str, message: String) {
        self.problems.push(ConfigProblem { key, message });
    }

    /// Whether `key` already has a problem (used to skip checks that would only
    /// repeat it with a placeholder value).
    fn failed(&self, key: &str) -> bool {
        self.problems.iter().any(|p| p.key == key)
    }

    /// A required variable. When it is missing the problem is recorded and an
    /// empty string stands in.
    fn req(&mut self, key: &'static str) -> String {
        match self.value(key) {
            Some(v) => v,
            None => {
                self.fail(
                    key,
                    "required but not set (a blank value counts as unset)".into(),
                );
                String::new()
            }
        }
    }

    /// An optional string with a default.
    fn opt(&self, key: &'static str, default: &str) -> String {
        self.value(key).unwrap_or_else(|| default.to_string())
    }

    /// An optional number with a default. A value that does not parse is recorded
    /// and the default stands in.
    fn parse<T: Number>(&mut self, key: &'static str, default: T) -> T {
        let Some(v) = self.value(key) else {
            return default;
        };
        match v.parse::<T>() {
            Ok(n) => n,
            Err(_) => {
                self.fail(key, format!("expected {}{}", T::EXPECTED, got(key, &v)));
                default
            }
        }
    }

    /// Like [`parse`](Self::parse), but a value below `min` is a problem too.
    fn parse_min<T: Number>(&mut self, key: &'static str, default: T, min: T) -> T {
        let n = self.parse(key, default);
        if !self.failed(key) && n < min {
            self.fail(key, format!("must be at least {min}, got {n}"));
        }
        n
    }

    /// A fraction in (0, 1].
    fn fraction(&mut self, key: &'static str, default: f64) -> f64 {
        let Some(v) = self.value(key) else {
            return default;
        };
        match v.parse::<f64>() {
            // NaN fails both comparisons and infinity fails `<= 1.0`.
            Ok(n) if n > 0.0 && n <= 1.0 => n,
            _ => {
                self.fail(
                    key,
                    format!(
                        "expected a number greater than 0 and at most 1, for example 0.8{}",
                        got(key, &v)
                    ),
                );
                default
            }
        }
    }

    /// A boolean: exactly `true` or `false`. A typo must not silently turn a
    /// feature off (or on), so `True`, `1` or `yes` are errors.
    fn flag(&mut self, key: &'static str, default: bool) -> bool {
        match self.value(key).as_deref() {
            None => default,
            Some("true") => true,
            Some("false") => false,
            Some(other) => {
                let message = format!("expected `true` or `false` (lowercase){}", got(key, other));
                self.fail(key, message);
                default
            }
        }
    }

    /// A comma-separated list: items trimmed, empty items dropped.
    fn list(&self, key: &'static str, default: &str) -> Vec<String> {
        self.value(key)
            .unwrap_or_else(|| default.to_string())
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    }

    /// A JSON value of type `T` (`T::default()` when unset). `expected` says what
    /// a valid value looks like. serde's message is part of the error unless the
    /// variable is secret: it quotes the fragment that failed to parse.
    fn json<T: DeserializeOwned + Default>(&mut self, key: &'static str, expected: &str) -> T {
        let Some(v) = self.value(key) else {
            return T::default();
        };
        match serde_json::from_str(&v) {
            Ok(parsed) => parsed,
            Err(e) => {
                let detail = if SECRET_KEYS.contains(&key) {
                    format!(
                        "invalid JSON or wrong value type at line {}, column {}",
                        e.line(),
                        e.column()
                    )
                } else {
                    e.to_string()
                };
                self.fail(key, format!("expected {expected}: {detail}"));
                T::default()
            }
        }
    }

    /// `APP_ENV`: exactly `development`, `staging` or `production` (unset or
    /// blank = development). A typo must not silently skip the production checks.
    fn app_env(&mut self) -> AppEnv {
        match self.value("APP_ENV").as_deref() {
            None | Some("development") => AppEnv::Development,
            Some("staging") => AppEnv::Staging,
            Some("production") => AppEnv::Production,
            Some(other) => {
                let message = format!(
                    "expected \"development\", \"staging\" or \"production\"{}",
                    got("APP_ENV", other)
                );
                self.fail("APP_ENV", message);
                AppEnv::Development
            }
        }
    }

    /// `lo_key` must not exceed `hi_key`. Skipped when either one already failed
    /// to parse: the placeholder values would only produce a misleading error.
    fn check_range(&mut self, lo_key: &'static str, lo: u16, hi_key: &'static str, hi: u16) {
        if !self.failed(lo_key) && !self.failed(hi_key) && lo > hi {
            self.fail(
                lo_key,
                format!("must not be greater than {hi_key} ({lo} > {hi})"),
            );
        }
    }
}

impl Config {
    /// Loads the configuration from the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Loads the configuration through `get`, which maps a variable name to its
    /// value (`None` = unset). This never touches the process environment, so
    /// tests pass a closure over a map instead of mutating `std::env`.
    ///
    /// Every variable is read exactly once and unconditionally, and every problem
    /// is reported together in the returned [`ConfigError`].
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let mut l = Loader::new(&get);

        let env = l.app_env();
        let cfg = Config {
            env,
            host: l.opt("API_HOST", "0.0.0.0"),
            port: l.parse("API_PORT", 8080u16),
            cors_origins: l.list("CORS_ALLOWED_ORIGINS", "http://localhost:3000"),
            public_app_url: l.opt("PUBLIC_APP_URL", "http://localhost:3000"),
            public_api_url: l.opt("PUBLIC_API_URL", "http://localhost:8080"),
            mongo_uri: l.opt("MONGO_URI", "mongodb://localhost:27017"),
            mongo_db: l.opt("MONGO_DB", "artixcloud"),
            auth_token_secret: l.req("AUTH_TOKEN_SECRET").into_bytes(),
            auth_refresh_pepper: l.req("AUTH_REFRESH_PEPPER").into_bytes(),
            access_ttl_secs: l.parse_min("ACCESS_TOKEN_TTL_SECONDS", 900i64, 1),
            refresh_ttl_secs: l.parse_min("REFRESH_TOKEN_TTL_SECONDS", 2_592_000i64, 1),
            email_token_ttl_secs: l.parse_min("EMAIL_TOKEN_TTL_SECONDS", 86_400i64, 1),
            login_code_ttl_secs: l.parse_min("LOGIN_CODE_TTL_SECONDS", 600i64, 1),
            resend_api_key: l.opt("RESEND_API_KEY", ""),
            email_from: l.opt("EMAIL_FROM", "ArtixCloud <no-reply@artixcloud.com>"),
            discord_client_id: l.opt("DISCORD_CLIENT_ID", ""),
            discord_client_secret: l.opt("DISCORD_CLIENT_SECRET", ""),
            github_client_id: l.opt("GITHUB_CLIENT_ID", ""),
            github_client_secret: l.opt("GITHUB_CLIENT_SECRET", ""),
            rate_limit_per_min: l.parse_min("RATE_LIMIT_PER_MINUTE", 120u32, 1),
            auth_rate_limit_per_min: l.parse_min("AUTH_RATE_LIMIT_PER_MINUTE", 10u32, 1),
            max_failed_logins: l.parse_min("MAX_FAILED_LOGINS", 8u32, 1),
            lockout_minutes: l.parse_min("LOCKOUT_MINUTES", 15i64, 1),
            proxmox_api_url: l.opt("PROXMOX_API_URL", ""),
            proxmox_token_id: l.opt("PROXMOX_TOKEN_ID", ""),
            proxmox_token_secret: l.opt("PROXMOX_TOKEN_SECRET", ""),
            proxmox_node: l.opt("PROXMOX_NODE", "pve"),
            proxmox_template_vmid: l.parse("PROXMOX_TEMPLATE_VMID", 9000i64),
            proxmox_storage: l.opt("PROXMOX_STORAGE", "local-lvm"),
            storage_sell_threshold: l.fraction("STORAGE_SELL_THRESHOLD", 0.8),
            storage_pool: l.list("STORAGE_POOL", ""),
            proxmox_bridge: l.opt("PROXMOX_BRIDGE", "vmbr0"),
            proxmox_insecure: l.flag("PROXMOX_INSECURE", false),
            proxmox_console_user: l.opt("PROXMOX_CONSOLE_USER", ""),
            proxmox_console_password: l.opt("PROXMOX_CONSOLE_PASSWORD", ""),
            os_templates: l.json(
                "OS_TEMPLATES",
                "a JSON object mapping an OS label to its template VMID, e.g. {\"Debian 12\": 9001}",
            ),
            frp_relays: l.opt("FRP_RELAYS", ""),
            frp_relay_host: l.opt("FRP_RELAY_HOST", ""),
            frp_server_addr: l.opt("FRP_SERVER_ADDR", ""),
            frp_server_port: l.parse("FRP_SERVER_PORT", 7000u16),
            frp_token: l.opt("FRP_TOKEN", ""),
            frp_admin_url: l.opt("FRP_ADMIN_URL", ""),
            frp_admin_user: l.opt("FRP_ADMIN_USER", "artix"),
            frp_admin_pass: l.opt("FRP_ADMIN_PASS", ""),
            frp_port_min: l.parse("FRP_PORT_MIN", 2200u16),
            frp_port_max: l.parse("FRP_PORT_MAX", 2300u16),
            eupa_api_url: l.opt("EUPA_API_URL", "https://api.eupa.gay"),
            eupa_api_key: l.opt("EUPA_API_KEY", ""),
            eupa_wallet_id: l.opt("EUPA_WALLET_ID", ""),
            eupa_fee_to_customer: l.flag("EUPA_FEE_TO_CUSTOMER", true),
            stripe_enabled: l.flag("STRIPE_ENABLED", false),
            stripe_secret_key: l.opt("STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret: l.opt("STRIPE_WEBHOOK_SECRET", ""),
            pagci_api_url: l.opt("PAGCI_API_URL", ""),
            pagci_api_token: l.opt("PAGCI_API_TOKEN", ""),
            pagci_wallet_id: l.opt("PAGCI_WALLET_ID", ""),
            pagci_wallet_name: l.opt("PAGCI_WALLET_NAME", "artix"),
            pagci_webhook_secret: l.opt("PAGCI_WEBHOOK_SECRET", ""),
            container_agent_url: l.opt("CONTAINER_AGENT_URL", ""),
            container_agent_token: l.opt("CONTAINER_AGENT_TOKEN", ""),
            public_webhook_base: l.opt("PUBLIC_WEBHOOK_BASE", ""),
            billing_currency: l.opt("BILLING_CURRENCY", "BRL"),
            billing_grace_days: l.parse("BILLING_GRACE_DAYS", 3i64),
            billing_renew_lead_days: l.parse("BILLING_RENEW_LEAD_DAYS", 3i64),
            billing_pix_ttl_secs: l.parse("BILLING_PIX_TTL_SECONDS", 86_400i64),
            billing_worker_enabled: l.flag("BILLING_WORKER_ENABLED", false),
            expiry_grace_days: l.parse("EXPIRY_GRACE_DAYS", 3i64),
            custom_domain_relay_ip: l.opt("CUSTOM_DOMAIN_RELAY_IP", ""),
            livekit_api_key: l.opt("LIVEKIT_API_KEY", ""),
            livekit_api_secret: l.opt("LIVEKIT_API_SECRET", ""),
            livekit_url: l.opt("LIVEKIT_URL", ""),
            livekit_host_url: l.opt("LIVEKIT_HOST_URL", ""),
            mc_port_min: l.parse("MC_PORT_MIN", 25565u16),
            mc_port_max: l.parse("MC_PORT_MAX", 25764u16),
            container_vm_ip: l.opt("CONTAINER_VM_IP", ""),
            cloudflare_api_token: l.opt("CLOUDFLARE_API_TOKEN", ""),
            cloudflare_zone_id: l.opt("CLOUDFLARE_ZONE_ID", ""),
            cloudflare_zone_name: l.opt("CLOUDFLARE_ZONE_NAME", "artix.cloud"),
        };

        // Rules that look at several values at once. They run after every variable
        // has been read, so they never hide a key from the lookup.
        if cfg.env.is_production() {
            for (key, secret) in [
                ("AUTH_TOKEN_SECRET", &cfg.auth_token_secret),
                ("AUTH_REFRESH_PEPPER", &cfg.auth_refresh_pepper),
            ] {
                // A missing secret is already reported; do not add a second problem.
                if !l.failed(key) && secret.len() < MIN_SECRET_BYTES {
                    l.fail(
                        key,
                        format!("must be at least {MIN_SECRET_BYTES} bytes in production"),
                    );
                }
            }
        }
        l.check_range(
            "FRP_PORT_MIN",
            cfg.frp_port_min,
            "FRP_PORT_MAX",
            cfg.frp_port_max,
        );
        l.check_range(
            "MC_PORT_MIN",
            cfg.mc_port_min,
            "MC_PORT_MAX",
            cfg.mc_port_max,
        );

        if l.problems.is_empty() {
            Ok(cfg)
        } else {
            Err(ConfigError {
                problems: l.problems,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// What is switched on, what looks wrong, and what is safe to print
// ---------------------------------------------------------------------------

/// "Is this integration enabled?" predicates. Each one mirrors the rule the real
/// constructor applies at runtime (`ProxmoxClient::from_config`, `Frp::from_config`,
/// ..., and `cloudflare::enabled`), so the startup summary says what the running
/// service will really do. `tests/config.rs` checks them against the constructors.
impl Config {
    fn proxmox_configured(&self) -> bool {
        !self.proxmox_api_url.is_empty()
            && !self.proxmox_token_id.is_empty()
            && !self.proxmox_token_secret.is_empty()
    }

    /// The xterm.js serial console logs in as a real PVE user (see `pve_ticket`).
    fn serial_console_configured(&self) -> bool {
        !self.proxmox_console_user.is_empty() && !self.proxmox_console_password.is_empty()
    }

    fn pagci_configured(&self) -> bool {
        !self.pagci_api_url.is_empty()
            && !self.pagci_api_token.is_empty()
            && !self.pagci_wallet_id.is_empty()
    }

    fn crypto_configured(&self) -> bool {
        !self.eupa_api_key.is_empty() && !self.eupa_wallet_id.is_empty()
    }

    fn stripe_configured(&self) -> bool {
        self.stripe_enabled && !self.stripe_secret_key.is_empty()
    }

    fn frp_configured(&self) -> bool {
        if !self.frp_relays.trim().is_empty() {
            serde_json::from_str::<Vec<crate::frp::Relay>>(&self.frp_relays)
                .is_ok_and(|relays| !relays.is_empty())
        } else {
            !self.frp_relay_host.is_empty() && !self.frp_admin_url.is_empty()
        }
    }

    fn agent_configured(&self) -> bool {
        !self.container_agent_url.is_empty() && !self.container_agent_token.is_empty()
    }

    fn cloudflare_configured(&self) -> bool {
        !self.cloudflare_api_token.is_empty() && !self.cloudflare_zone_id.is_empty()
    }

    /// Everything the browser needs to join a call: signing key pair and public URL.
    fn livekit_configured(&self) -> bool {
        !self.livekit_api_key.is_empty()
            && !self.livekit_api_secret.is_empty()
            && !self.livekit_url.is_empty()
    }

    /// Which optional features this configuration turns on, in a stable order, as
    /// `(name, enabled)`. Feeds the startup log and `--check-config`.
    pub fn features(&self) -> Vec<(&'static str, bool)> {
        vec![
            ("Email delivery (Resend)", !self.resend_api_key.is_empty()),
            (
                "Discord sign-in",
                !self.discord_client_id.is_empty() && !self.discord_client_secret.is_empty(),
            ),
            (
                "GitHub sign-in",
                !self.github_client_id.is_empty() && !self.github_client_secret.is_empty(),
            ),
            ("VPS provisioning (Proxmox)", self.proxmox_configured()),
            ("VPS serial console", self.serial_console_configured()),
            ("PIX payments (PagCI)", self.pagci_configured()),
            ("Crypto payments (Eupa)", self.crypto_configured()),
            ("Card payments (Stripe)", self.stripe_configured()),
            ("SSH relays (frp)", self.frp_configured()),
            ("Container hosting (agent)", self.agent_configured()),
            ("Minecraft DNS (Cloudflare)", self.cloudflare_configured()),
            ("Voice chat (LiveKit)", self.livekit_configured()),
            ("GitHub push webhooks", !self.public_webhook_base.is_empty()),
            ("Custom domains", !self.custom_domain_relay_ip.is_empty()),
            ("Billing worker", self.billing_worker_enabled),
        ]
    }

    /// Things that are legal but probably not what the operator meant: an
    /// integration set up halfway (it would stay silently disabled), and, in
    /// production, settings that only make sense on a developer machine. These
    /// are never errors, and they only ever name variables, never their values.
    pub fn warnings(&self) -> Vec<String> {
        let set = |value: &str| !value.is_empty();
        let mut w = Vec::new();

        all_or_none(
            &mut w,
            "Proxmox",
            &[
                ("PROXMOX_API_URL", set(&self.proxmox_api_url)),
                ("PROXMOX_TOKEN_ID", set(&self.proxmox_token_id)),
                ("PROXMOX_TOKEN_SECRET", set(&self.proxmox_token_secret)),
            ],
            "VPS provisioning stays disabled",
        );
        all_or_none(
            &mut w,
            "The Proxmox serial console login",
            &[
                ("PROXMOX_CONSOLE_USER", set(&self.proxmox_console_user)),
                (
                    "PROXMOX_CONSOLE_PASSWORD",
                    set(&self.proxmox_console_password),
                ),
            ],
            "the serial console stays unavailable",
        );

        if self.stripe_enabled {
            if self.stripe_secret_key.is_empty() {
                w.push(
                    "Stripe is enabled (STRIPE_ENABLED=true) but STRIPE_SECRET_KEY is empty: \
                     card payments stay disabled"
                        .into(),
                );
            } else if self.stripe_webhook_secret.is_empty() {
                w.push(
                    "Stripe is enabled but STRIPE_WEBHOOK_SECRET is empty: webhook events are \
                     rejected, so card payments are never confirmed"
                        .into(),
                );
            }
        } else if set(&self.stripe_secret_key) || set(&self.stripe_webhook_secret) {
            w.push(
                "Stripe keys are set but STRIPE_ENABLED is not true: card payments stay disabled"
                    .into(),
            );
        }

        all_or_none(
            &mut w,
            "PagCI",
            &[
                ("PAGCI_API_URL", set(&self.pagci_api_url)),
                ("PAGCI_API_TOKEN", set(&self.pagci_api_token)),
                ("PAGCI_WALLET_ID", set(&self.pagci_wallet_id)),
            ],
            "PIX payments stay disabled",
        );
        if self.pagci_configured() && self.pagci_webhook_secret.is_empty() {
            w.push(
                "PagCI is enabled but PAGCI_WEBHOOK_SECRET is empty: webhooks are rejected, so \
                 PIX payments are not confirmed automatically"
                    .into(),
            );
        }

        all_or_none(
            &mut w,
            "Crypto payments (Eupa)",
            &[
                ("EUPA_API_KEY", set(&self.eupa_api_key)),
                ("EUPA_WALLET_ID", set(&self.eupa_wallet_id)),
            ],
            "crypto payments stay disabled",
        );

        if !self.frp_relays.trim().is_empty() {
            match serde_json::from_str::<Vec<crate::frp::Relay>>(&self.frp_relays) {
                Ok(relays) if relays.is_empty() => {
                    w.push("FRP_RELAYS is an empty list: frp stays disabled".into());
                }
                Ok(_) => {}
                // serde's own message may quote the value (a relay token), so only
                // its category and position are reported.
                Err(e) => w.push(format!(
                    "FRP_RELAYS is not a valid JSON array of relays ({} at line {}, column {}): \
                     frp stays disabled",
                    json_error_kind(&e),
                    e.line(),
                    e.column()
                )),
            }
        } else {
            all_or_none(
                &mut w,
                "The frp relay",
                &[
                    ("FRP_RELAY_HOST", set(&self.frp_relay_host)),
                    ("FRP_ADMIN_URL", set(&self.frp_admin_url)),
                ],
                "frp stays disabled",
            );
        }

        all_or_none(
            &mut w,
            "Cloudflare DNS",
            &[
                ("CLOUDFLARE_API_TOKEN", set(&self.cloudflare_api_token)),
                ("CLOUDFLARE_ZONE_ID", set(&self.cloudflare_zone_id)),
            ],
            "DNS records are not written",
        );
        all_or_none(
            &mut w,
            "The container agent",
            &[
                ("CONTAINER_AGENT_URL", set(&self.container_agent_url)),
                ("CONTAINER_AGENT_TOKEN", set(&self.container_agent_token)),
            ],
            "container hosting stays disabled",
        );

        all_or_none(
            &mut w,
            "LiveKit",
            &[
                ("LIVEKIT_API_KEY", set(&self.livekit_api_key)),
                ("LIVEKIT_API_SECRET", set(&self.livekit_api_secret)),
                ("LIVEKIT_URL", set(&self.livekit_url)),
            ],
            "voice chat stays disabled",
        );
        if set(&self.livekit_api_key) && self.livekit_host_url.is_empty() {
            w.push(
                "LIVEKIT_API_KEY is set but LIVEKIT_HOST_URL is empty: the voice call roster \
                 (who is in the call) is unavailable"
                    .into(),
            );
        }

        all_or_none(
            &mut w,
            "Discord sign-in",
            &[
                ("DISCORD_CLIENT_ID", set(&self.discord_client_id)),
                ("DISCORD_CLIENT_SECRET", set(&self.discord_client_secret)),
            ],
            "Discord sign-in stays disabled",
        );
        all_or_none(
            &mut w,
            "GitHub sign-in",
            &[
                ("GITHUB_CLIENT_ID", set(&self.github_client_id)),
                ("GITHUB_CLIENT_SECRET", set(&self.github_client_secret)),
            ],
            "GitHub sign-in stays disabled",
        );

        if self.env.is_production() {
            for (key, url) in [
                ("PUBLIC_APP_URL", &self.public_app_url),
                ("PUBLIC_API_URL", &self.public_api_url),
            ] {
                if !url.trim().to_ascii_lowercase().starts_with("https://") {
                    w.push(format!(
                        "{key} does not start with https:// (production should be served over TLS)"
                    ));
                }
            }
            if self.cors_origins.iter().any(|o| o == "*") {
                w.push(
                    "CORS_ALLOWED_ORIGINS contains `*`, which is not a wildcard here: list the \
                     exact site origins"
                        .into(),
                );
            }
            if self
                .cors_origins
                .iter()
                .any(|o| o.to_ascii_lowercase().contains("localhost"))
            {
                w.push(
                    "CORS_ALLOWED_ORIGINS contains a localhost origin: list the real site \
                     origin(s) for production"
                        .into(),
                );
            }
            if self.proxmox_insecure {
                w.push(
                    "PROXMOX_INSECURE=true turns off TLS certificate checks for the Proxmox API: \
                     use a trusted certificate in production"
                        .into(),
                );
            }
            if self.resend_api_key.is_empty() {
                w.push(
                    "RESEND_API_KEY is empty: emails (login codes included) are only written to \
                     the log, never sent"
                        .into(),
                );
            }
        }
        w
    }
}

/// Pushes a warning when only some of `vars` (`name`, `is set`) are set. Nothing
/// is said when all of them or none of them are.
fn all_or_none(out: &mut Vec<String>, what: &str, vars: &[(&str, bool)], effect: &str) {
    let names = |wanted: bool| {
        vars.iter()
            .filter(|(_, is_set)| *is_set == wanted)
            .map(|(name, _)| *name)
            .collect::<Vec<_>>()
            .join(", ")
    };
    let (set, missing) = (names(true), names(false));
    if !set.is_empty() && !missing.is_empty() {
        out.push(format!(
            "{what} is partially configured (set: {set}; missing: {missing}): {effect}"
        ));
    }
}

fn json_error_kind(e: &serde_json::Error) -> &'static str {
    use serde_json::error::Category;
    match e.classify() {
        Category::Io => "read error",
        Category::Syntax => "syntax error",
        Category::Data => "wrong value type or missing field",
        Category::Eof => "unexpected end of input",
    }
}

/// `Debug` is an ALLOWLIST on purpose. `Config` holds secrets, tokens, passwords
/// and URLs that can carry credentials (`mongo_uri`), so a field is printed only
/// because someone decided it is safe; a new field stays out of the output until
/// it is added here. Never add a secret.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("env", &self.env)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("public_app_url", &self.public_app_url)
            .field("public_api_url", &self.public_api_url)
            .field("cors_origin_count", &self.cors_origins.len())
            .field("os_template_count", &self.os_templates.len())
            .field("access_ttl_secs", &self.access_ttl_secs)
            .field("refresh_ttl_secs", &self.refresh_ttl_secs)
            .field("rate_limit_per_min", &self.rate_limit_per_min)
            .field("auth_rate_limit_per_min", &self.auth_rate_limit_per_min)
            .field("features", &FeatureMap(self.features()))
            .finish_non_exhaustive()
    }
}

/// `{"name": enabled, ...}` for `Debug`.
struct FeatureMap(Vec<(&'static str, bool)>);

impl fmt::Debug for FeatureMap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.0.iter().copied()).finish()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    }

    /// Every key `from_lookup` asks for, with an empty environment.
    fn requested_keys() -> Vec<String> {
        let seen = RefCell::new(Vec::new());
        let _ = Config::from_lookup(|key| {
            seen.borrow_mut().push(key.to_string());
            None
        });
        seen.into_inner()
    }

    #[test]
    fn the_value_of_a_secret_variable_is_never_echoed() {
        // No numeric, boolean or JSON variable is secret today. These calls use a
        // secret name on purpose, to prove the guard holds for the next one.
        let pairs = [("AUTH_TOKEN_SECRET", "hunter2-hunter2")];
        let get = lookup(&pairs);
        let mut l = Loader::new(&get);
        let _: u16 = l.parse("AUTH_TOKEN_SECRET", 1);
        let _ = l.flag("AUTH_TOKEN_SECRET", false);
        let _ = l.fraction("AUTH_TOKEN_SECRET", 0.5);
        let _: HashMap<String, i64> = l.json("AUTH_TOKEN_SECRET", "a JSON object");
        assert_eq!(l.problems.len(), 4);
        for problem in &l.problems {
            assert!(!problem.message.contains("hunter2"), "{problem}");
        }

        // serde quotes the fragment it choked on; for a secret only the position is kept.
        let pairs = [("FRP_RELAYS", r#"{"token": "hunter2-hunter2"}"#)];
        let get = lookup(&pairs);
        let mut l = Loader::new(&get);
        let _: HashMap<String, i64> = l.json("FRP_RELAYS", "a map of integers");
        let message = &l.problems[0].message;
        assert!(
            !message.contains("hunter2") && message.contains("line 1"),
            "{message}"
        );
    }

    #[test]
    fn the_value_of_other_variables_is_shown_but_cut_short() {
        let shown = got("API_PORT", "abc");
        assert_eq!(shown, ", got \"abc\"");
        let long = got("API_PORT", &"x".repeat(500));
        assert!(long.len() < 80 && long.ends_with("...\""), "{long}");
        // Control characters cannot reach the terminal unescaped.
        assert_eq!(got("API_PORT", "a\u{1b}[31mb"), ", got \"a\\u{1b}[31mb\"");
        assert_eq!(got("MONGO_URI", "mongodb://user:pw@host"), "");
    }

    #[test]
    fn every_secret_looking_variable_is_in_the_secret_list_and_the_list_has_no_stale_entry() {
        let keys = requested_keys();
        let hints = [
            "SECRET", "TOKEN", "PASSWORD", "PEPPER", "API_KEY", "_PASS", "_URI",
        ];
        for key in &keys {
            let looks_secret = !key.contains("TTL") && hints.iter().any(|hint| key.contains(hint));
            if looks_secret {
                assert!(
                    SECRET_KEYS.contains(&key.as_str()),
                    "{key} looks like a secret: add it to SECRET_KEYS (or rename it)"
                );
            }
        }
        for key in SECRET_KEYS {
            assert!(
                keys.iter().any(|k| k == key),
                "SECRET_KEYS lists {key}, which the loader never reads"
            );
        }
    }

    #[test]
    fn every_key_is_read_exactly_once() {
        let mut keys = requested_keys();
        let total = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), total, "a variable is read twice");
    }
}
