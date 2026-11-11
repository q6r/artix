//! Configuration loader tests. They need no database and no network, and they never
//! touch the process environment: every test feeds `Config::from_lookup` a closure
//! over a map.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use artixcloud_api::{
    agent::AgentClient,
    cli::{self, Command, EnvFile},
    config::{AppEnv, Config, ConfigError},
    crypto::CryptoClient,
    frp::Frp,
    pagci::PagCiClient,
    proxmox::ProxmoxClient,
    stripe::StripeClient,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_SECRET: &str = "unit-test-token-secret-0123456789-abcdef";
const REFRESH_PEPPER: &str = "unit-test-refresh-pepper-0123456789-abcd";

type Env = BTreeMap<String, String>;

/// The two required secrets plus `extra`, which wins over them.
fn env_with(extra: &[(&str, &str)]) -> Env {
    let mut env: Env = [
        ("AUTH_TOKEN_SECRET", TOKEN_SECRET),
        ("AUTH_REFRESH_PEPPER", REFRESH_PEPPER),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    for (k, v) in extra {
        env.insert(k.to_string(), v.to_string());
    }
    env
}

fn load_env(env: &Env) -> Result<Config, ConfigError> {
    Config::from_lookup(|key| env.get(key).cloned())
}

fn load(extra: &[(&str, &str)]) -> Result<Config, ConfigError> {
    load_env(&env_with(extra))
}

/// A configuration that must be accepted.
fn ok(extra: &[(&str, &str)]) -> Config {
    load(extra)
        .unwrap_or_else(|e| panic!("expected a valid configuration for {extra:?}, got:\n{e}"))
}

/// A configuration that must be rejected.
fn err(extra: &[(&str, &str)]) -> ConfigError {
    match load(extra) {
        Ok(_) => panic!("expected the configuration to be rejected: {extra:?}"),
        Err(e) => e,
    }
}

fn keys_of(e: &ConfigError) -> Vec<&'static str> {
    e.problems().iter().map(|p| p.key).collect()
}

/// The message for `key`; fails unless `key` has exactly one problem.
fn message<'a>(e: &'a ConfigError, key: &str) -> &'a str {
    let found: Vec<&str> = e
        .problems()
        .iter()
        .filter(|p| p.key == key)
        .map(|p| p.message.as_str())
        .collect();
    assert_eq!(
        found.len(),
        1,
        "expected exactly one problem for {key}, got {:?}",
        e.problems()
    );
    found[0]
}

fn feature(cfg: &Config, name_contains: &str) -> bool {
    let hits: Vec<(&str, bool)> = cfg
        .features()
        .into_iter()
        .filter(|(name, _)| name.contains(name_contains))
        .collect();
    assert_eq!(
        hits.len(),
        1,
        "expected one feature matching {name_contains:?}: {hits:?}"
    );
    hits[0].1
}

// ---------------------------------------------------------------------------
// (1) Parity: the variables the loader reads == the variables the docs describe
// ---------------------------------------------------------------------------

/// Every key `Config::from_lookup` asks for when the environment is empty.
fn requested_keys() -> BTreeSet<String> {
    let seen = RefCell::new(BTreeSet::new());
    let _ = Config::from_lookup(|key| {
        seen.borrow_mut().insert(key.to_string());
        None
    });
    seen.into_inner()
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'
}

/// The variable assigned on a `.env.example` line: `^#?\s*([A-Z][A-Z0-9_]*)=`.
fn env_example_name(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('#').unwrap_or(line).trim_start();
    let end = rest.find(|c: char| !is_name_char(c)).unwrap_or(rest.len());
    let (name, after) = rest.split_at(end);
    (name.starts_with(|c: char| c.is_ascii_uppercase()) && after.starts_with('=')).then_some(name)
}

/// The variable named by a docs table row: ``^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|``.
fn doc_table_name(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('|')?.trim_start().strip_prefix('`')?;
    let end = rest.find(|c: char| !is_name_char(c))?;
    let (name, after) = rest.split_at(end);
    let after = after.strip_prefix('`')?.trim_start();
    (name.starts_with(|c: char| c.is_ascii_uppercase()) && after.starts_with('|')).then_some(name)
}

fn read_repo_file(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {relative}: {e}"));
    text.trim_start_matches('\u{feff}').to_string()
}

/// Fails with a readable diff unless both sets are equal.
fn assert_same_keys(label: &str, read_by_code: &BTreeSet<String>, documented: &BTreeSet<String>) {
    let join = |set: Vec<&String>| set.into_iter().cloned().collect::<Vec<_>>().join(", ");
    let missing = join(read_by_code.difference(documented).collect());
    let extra = join(documented.difference(read_by_code).collect());
    assert!(
        missing.is_empty() && extra.is_empty(),
        "the variables Config::from_lookup reads and {label} disagree:\n  \
         missing in {label} (read by the code, not documented): {}\n  \
         extra in {label} (documented, never read by the code): {}",
        if missing.is_empty() { "-" } else { &missing },
        if extra.is_empty() { "-" } else { &extra },
    );
}

/// The variable names in the tables of the `## Backend (artixcloud-api)` section.
fn backend_section_variables(text: &str) -> BTreeSet<String> {
    let mut inside = false;
    let mut found_heading = false;
    let mut names = BTreeSet::new();
    for line in text.lines() {
        if line.starts_with("## ") {
            inside = line.trim_end() == "## Backend (artixcloud-api)";
            found_heading |= inside;
            continue;
        }
        if inside {
            names.extend(doc_table_name(line).map(str::to_string));
        }
    }
    assert!(
        found_heading,
        "docs/configuration.md has no `## Backend (artixcloud-api)` heading"
    );
    names
}

#[test]
fn the_loader_reads_every_key_even_with_an_empty_environment() {
    let keys = requested_keys();
    // A smoke check on the check itself: nothing is hidden behind an `if`.
    for key in [
        "APP_ENV",
        "AUTH_TOKEN_SECRET",
        "AUTH_REFRESH_PEPPER",
        "OS_TEMPLATES",
        "LIVEKIT_HOST_URL",
    ] {
        assert!(keys.contains(key), "{key} was never requested");
    }
    assert!(
        keys.len() > 70,
        "only {} keys requested: {keys:?}",
        keys.len()
    );
}

#[test]
fn every_variable_is_documented_in_env_example() {
    let text = read_repo_file(".env.example");
    let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
    for name in text.lines().filter_map(env_example_name) {
        *seen.entry(name).or_default() += 1;
    }
    let repeated: Vec<String> = seen
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(name, n)| format!("{name} ({n}x)"))
        .collect();
    assert!(
        repeated.is_empty(),
        "backend/.env.example must list each variable exactly once, but repeats: {}",
        repeated.join(", ")
    );
    let documented: BTreeSet<String> = seen.keys().map(|k| k.to_string()).collect();
    assert_same_keys("backend/.env.example", &requested_keys(), &documented);
}

#[test]
fn every_variable_is_documented_in_configuration_md() {
    let text = read_repo_file("../docs/configuration.md");
    let documented = backend_section_variables(&text);
    assert_same_keys(
        "docs/configuration.md (## Backend (artixcloud-api))",
        &requested_keys(),
        &documented,
    );
}

#[test]
fn the_doc_parsers_follow_the_patterns_they_mirror() {
    // `.env.example`: ^#?\s*([A-Z][A-Z0-9_]*)=
    assert_eq!(env_example_name("API_PORT=8080"), Some("API_PORT"));
    assert_eq!(env_example_name("# API_PORT=8080"), Some("API_PORT"));
    assert_eq!(env_example_name("#API_PORT="), Some("API_PORT"));
    assert_eq!(
        env_example_name("#   OS_TEMPLATES={\"a\": 1}"),
        Some("OS_TEMPLATES")
    );
    assert_eq!(env_example_name("# Default: http://localhost:3000"), None);
    assert_eq!(env_example_name("# api_port=1"), None);
    assert_eq!(env_example_name("API_PORT = 1"), None);
    assert_eq!(env_example_name("9PORT=1"), None);
    assert_eq!(env_example_name("  # API_PORT=1"), None);
    assert_eq!(env_example_name(""), None);
    // docs tables: ^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|
    assert_eq!(
        doc_table_name("| `API_PORT` | `8080` | the port |"),
        Some("API_PORT")
    );
    assert_eq!(doc_table_name("|`API_PORT`|8080|"), Some("API_PORT"));
    assert_eq!(doc_table_name("| API_PORT | 8080 |"), None);
    assert_eq!(doc_table_name("| `api_port` | 8080 |"), None);
    assert_eq!(doc_table_name("| `API_PORT` ok | 8080 |"), None);
    assert_eq!(doc_table_name("| Variable | Default |"), None);
    assert_eq!(doc_table_name("| --- | --- |"), None);
    assert_eq!(doc_table_name(" | `API_PORT` | 1 |"), None);

    let doc = "\
## Web app
| `NEXT_PUBLIC_WS_URL` | x |
## Backend (artixcloud-api)
intro
| Variable | Default |
| --- | --- |
| `API_PORT` | `8080` |
### Auth
| `AUTH_TOKEN_SECRET` | required |
## Deploy
| `NOT_BACKEND` | x |
";
    let names: Vec<String> = backend_section_variables(doc).into_iter().collect();
    assert_eq!(names, ["API_PORT", "AUTH_TOKEN_SECRET"]);
}

// ---------------------------------------------------------------------------
// (2) Defaults
// ---------------------------------------------------------------------------

/// Every field with only the two required secrets set.
fn assert_defaults(cfg: &Config) {
    assert_eq!(cfg.env, AppEnv::Development);
    assert_eq!(cfg.host, "0.0.0.0");
    assert_eq!(cfg.port, 8080);
    assert_eq!(cfg.cors_origins, ["http://localhost:3000"]);
    assert_eq!(cfg.public_app_url, "http://localhost:3000");
    assert_eq!(cfg.public_api_url, "http://localhost:8080");
    assert_eq!(cfg.mongo_uri, "mongodb://localhost:27017");
    assert_eq!(cfg.mongo_db, "artixcloud");
    assert_eq!(cfg.auth_token_secret, TOKEN_SECRET.as_bytes());
    assert_eq!(cfg.auth_refresh_pepper, REFRESH_PEPPER.as_bytes());
    assert_eq!(cfg.access_ttl_secs, 900);
    assert_eq!(cfg.refresh_ttl_secs, 2_592_000);
    assert_eq!(cfg.email_token_ttl_secs, 86_400);
    assert_eq!(cfg.login_code_ttl_secs, 600);
    assert_eq!(cfg.email_from, "ArtixCloud <no-reply@artixcloud.com>");
    assert_eq!(cfg.rate_limit_per_min, 120);
    assert_eq!(cfg.auth_rate_limit_per_min, 10);
    assert_eq!(cfg.max_failed_logins, 8);
    assert_eq!(cfg.lockout_minutes, 15);
    assert_eq!(cfg.proxmox_node, "pve");
    assert_eq!(cfg.proxmox_template_vmid, 9000);
    assert_eq!(cfg.proxmox_storage, "local-lvm");
    assert_eq!(cfg.storage_sell_threshold, 0.8);
    assert!(cfg.storage_pool.is_empty());
    assert_eq!(cfg.proxmox_bridge, "vmbr0");
    assert!(!cfg.proxmox_insecure);
    assert!(cfg.os_templates.is_empty());
    assert_eq!(cfg.frp_server_port, 7000);
    assert_eq!(cfg.frp_admin_user, "artix");
    assert_eq!((cfg.frp_port_min, cfg.frp_port_max), (2200, 2300));
    assert_eq!(cfg.eupa_api_url, "https://api.eupa.gay");
    assert!(cfg.eupa_fee_to_customer);
    assert!(!cfg.stripe_enabled);
    assert_eq!(cfg.pagci_wallet_name, "artix");
    assert_eq!(cfg.billing_currency, "BRL");
    assert_eq!(cfg.billing_grace_days, 3);
    assert_eq!(cfg.billing_renew_lead_days, 3);
    assert_eq!(cfg.billing_pix_ttl_secs, 86_400);
    assert!(!cfg.billing_worker_enabled);
    assert_eq!(cfg.expiry_grace_days, 3);
    // The default used to be a private address of the original deployment.
    assert_eq!(cfg.livekit_host_url, "");
    assert_eq!((cfg.mc_port_min, cfg.mc_port_max), (25565, 25764));
    assert_eq!(cfg.cloudflare_zone_name, "artix.cloud");

    let empty_by_default = [
        ("resend_api_key", &cfg.resend_api_key),
        ("discord_client_id", &cfg.discord_client_id),
        ("discord_client_secret", &cfg.discord_client_secret),
        ("github_client_id", &cfg.github_client_id),
        ("github_client_secret", &cfg.github_client_secret),
        ("proxmox_api_url", &cfg.proxmox_api_url),
        ("proxmox_token_id", &cfg.proxmox_token_id),
        ("proxmox_token_secret", &cfg.proxmox_token_secret),
        ("proxmox_console_user", &cfg.proxmox_console_user),
        ("proxmox_console_password", &cfg.proxmox_console_password),
        ("frp_relays", &cfg.frp_relays),
        ("frp_relay_host", &cfg.frp_relay_host),
        ("frp_server_addr", &cfg.frp_server_addr),
        ("frp_token", &cfg.frp_token),
        ("frp_admin_url", &cfg.frp_admin_url),
        ("frp_admin_pass", &cfg.frp_admin_pass),
        ("eupa_api_key", &cfg.eupa_api_key),
        ("eupa_wallet_id", &cfg.eupa_wallet_id),
        ("stripe_secret_key", &cfg.stripe_secret_key),
        ("stripe_webhook_secret", &cfg.stripe_webhook_secret),
        ("pagci_api_url", &cfg.pagci_api_url),
        ("pagci_api_token", &cfg.pagci_api_token),
        ("pagci_wallet_id", &cfg.pagci_wallet_id),
        ("pagci_webhook_secret", &cfg.pagci_webhook_secret),
        ("container_agent_url", &cfg.container_agent_url),
        ("container_agent_token", &cfg.container_agent_token),
        ("public_webhook_base", &cfg.public_webhook_base),
        ("custom_domain_relay_ip", &cfg.custom_domain_relay_ip),
        ("livekit_api_key", &cfg.livekit_api_key),
        ("livekit_api_secret", &cfg.livekit_api_secret),
        ("livekit_url", &cfg.livekit_url),
        ("livekit_host_url", &cfg.livekit_host_url),
        ("container_vm_ip", &cfg.container_vm_ip),
        ("cloudflare_api_token", &cfg.cloudflare_api_token),
        ("cloudflare_zone_id", &cfg.cloudflare_zone_id),
    ];
    for (field, value) in empty_by_default {
        assert!(
            value.is_empty(),
            "{field} should default to empty, got a value"
        );
    }
}

#[test]
fn defaults_with_only_the_two_required_secrets() {
    assert_defaults(&ok(&[]));
}

#[test]
fn every_variable_reaches_its_own_field() {
    // Every value is distinct (and different from the default), so a mix-up
    // between two fields cannot go unnoticed.
    let strings = [
        ("API_HOST", "api-host"),
        ("PUBLIC_APP_URL", "https://app.example.com"),
        ("PUBLIC_API_URL", "https://api.example.com"),
        ("MONGO_URI", "mongodb://db.example.com:27017"),
        ("MONGO_DB", "mongo-db"),
        ("RESEND_API_KEY", "resend-key"),
        ("EMAIL_FROM", "Example <no-reply@example.com>"),
        ("DISCORD_CLIENT_ID", "discord-id"),
        ("DISCORD_CLIENT_SECRET", "discord-secret"),
        ("GITHUB_CLIENT_ID", "github-id"),
        ("GITHUB_CLIENT_SECRET", "github-secret"),
        ("PROXMOX_API_URL", "https://pve.example.com:8006/api2/json"),
        ("PROXMOX_TOKEN_ID", "proxmox-token-id"),
        ("PROXMOX_TOKEN_SECRET", "proxmox-token-secret"),
        ("PROXMOX_NODE", "proxmox-node"),
        ("PROXMOX_STORAGE", "proxmox-storage"),
        ("PROXMOX_BRIDGE", "proxmox-bridge"),
        ("PROXMOX_CONSOLE_USER", "console-user"),
        ("PROXMOX_CONSOLE_PASSWORD", "console-password"),
        ("FRP_RELAYS", "frp-relays"),
        ("FRP_RELAY_HOST", "frp-relay-host"),
        ("FRP_SERVER_ADDR", "frp-server-addr"),
        ("FRP_TOKEN", "frp-token"),
        ("FRP_ADMIN_URL", "frp-admin-url"),
        ("FRP_ADMIN_USER", "frp-admin-user"),
        ("FRP_ADMIN_PASS", "frp-admin-pass"),
        ("EUPA_API_URL", "https://eupa.example.com"),
        ("EUPA_API_KEY", "eupa-key"),
        ("EUPA_WALLET_ID", "eupa-wallet"),
        ("STRIPE_SECRET_KEY", "stripe-secret"),
        ("STRIPE_WEBHOOK_SECRET", "stripe-webhook"),
        ("PAGCI_API_URL", "https://pagci.example.com"),
        ("PAGCI_API_TOKEN", "pagci-token"),
        ("PAGCI_WALLET_ID", "pagci-wallet"),
        ("PAGCI_WALLET_NAME", "pagci-wallet-name"),
        ("PAGCI_WEBHOOK_SECRET", "pagci-webhook"),
        ("CONTAINER_AGENT_URL", "http://192.0.2.10:9090"),
        ("CONTAINER_AGENT_TOKEN", "agent-token"),
        ("PUBLIC_WEBHOOK_BASE", "https://hooks.example.com"),
        ("BILLING_CURRENCY", "USD"),
        ("CUSTOM_DOMAIN_RELAY_IP", "203.0.113.7"),
        ("LIVEKIT_API_KEY", "livekit-key"),
        ("LIVEKIT_API_SECRET", "livekit-secret"),
        ("LIVEKIT_URL", "wss://live.example.com"),
        ("LIVEKIT_HOST_URL", "http://192.0.2.20:7880"),
        ("CONTAINER_VM_IP", "192.0.2.30"),
        ("CLOUDFLARE_API_TOKEN", "cloudflare-token"),
        ("CLOUDFLARE_ZONE_ID", "cloudflare-zone"),
        ("CLOUDFLARE_ZONE_NAME", "example.org"),
    ];
    let others = [
        ("APP_ENV", "staging"),
        ("API_PORT", "9001"),
        (
            "CORS_ALLOWED_ORIGINS",
            "https://a.example.com, https://b.example.com",
        ),
        ("ACCESS_TOKEN_TTL_SECONDS", "111"),
        ("REFRESH_TOKEN_TTL_SECONDS", "222"),
        ("EMAIL_TOKEN_TTL_SECONDS", "333"),
        ("LOGIN_CODE_TTL_SECONDS", "444"),
        ("RATE_LIMIT_PER_MINUTE", "555"),
        ("AUTH_RATE_LIMIT_PER_MINUTE", "66"),
        ("MAX_FAILED_LOGINS", "7"),
        ("LOCKOUT_MINUTES", "88"),
        ("PROXMOX_TEMPLATE_VMID", "9100"),
        ("STORAGE_SELL_THRESHOLD", "0.65"),
        ("STORAGE_POOL", "pool-a, pool-b"),
        ("PROXMOX_INSECURE", "true"),
        (
            "OS_TEMPLATES",
            r#"{"Debian 12": 9001, "Ubuntu 24.04": 9002}"#,
        ),
        ("FRP_SERVER_PORT", "7001"),
        ("FRP_PORT_MIN", "3000"),
        ("FRP_PORT_MAX", "3100"),
        ("EUPA_FEE_TO_CUSTOMER", "false"),
        ("STRIPE_ENABLED", "true"),
        ("BILLING_GRACE_DAYS", "11"),
        ("BILLING_RENEW_LEAD_DAYS", "12"),
        ("BILLING_PIX_TTL_SECONDS", "13"),
        ("BILLING_WORKER_ENABLED", "true"),
        ("EXPIRY_GRACE_DAYS", "14"),
        ("MC_PORT_MIN", "26000"),
        ("MC_PORT_MAX", "26100"),
    ];
    let mut env = env_with(&[]);
    for (k, v) in strings.iter().chain(others.iter()) {
        env.insert(k.to_string(), v.to_string());
    }
    // The table above must cover every variable the loader reads.
    let covered: BTreeSet<String> = env.keys().cloned().collect();
    assert_same_keys("this test's table", &requested_keys(), &covered);

    let cfg = load_env(&env).unwrap_or_else(|e| panic!("{e}"));
    let s = |key: &str| strings.iter().find(|(k, _)| *k == key).unwrap().1;

    assert_eq!(cfg.env, AppEnv::Staging);
    assert_eq!(cfg.host, s("API_HOST"));
    assert_eq!(cfg.port, 9001);
    assert_eq!(
        cfg.cors_origins,
        ["https://a.example.com", "https://b.example.com"]
    );
    assert_eq!(cfg.public_app_url, s("PUBLIC_APP_URL"));
    assert_eq!(cfg.public_api_url, s("PUBLIC_API_URL"));
    assert_eq!(cfg.mongo_uri, s("MONGO_URI"));
    assert_eq!(cfg.mongo_db, s("MONGO_DB"));
    assert_eq!(cfg.auth_token_secret, TOKEN_SECRET.as_bytes());
    assert_eq!(cfg.auth_refresh_pepper, REFRESH_PEPPER.as_bytes());
    assert_eq!(cfg.access_ttl_secs, 111);
    assert_eq!(cfg.refresh_ttl_secs, 222);
    assert_eq!(cfg.email_token_ttl_secs, 333);
    assert_eq!(cfg.login_code_ttl_secs, 444);
    assert_eq!(cfg.resend_api_key, s("RESEND_API_KEY"));
    assert_eq!(cfg.email_from, s("EMAIL_FROM"));
    assert_eq!(cfg.discord_client_id, s("DISCORD_CLIENT_ID"));
    assert_eq!(cfg.discord_client_secret, s("DISCORD_CLIENT_SECRET"));
    assert_eq!(cfg.github_client_id, s("GITHUB_CLIENT_ID"));
    assert_eq!(cfg.github_client_secret, s("GITHUB_CLIENT_SECRET"));
    assert_eq!(cfg.rate_limit_per_min, 555);
    assert_eq!(cfg.auth_rate_limit_per_min, 66);
    assert_eq!(cfg.max_failed_logins, 7);
    assert_eq!(cfg.lockout_minutes, 88);
    assert_eq!(cfg.proxmox_api_url, s("PROXMOX_API_URL"));
    assert_eq!(cfg.proxmox_token_id, s("PROXMOX_TOKEN_ID"));
    assert_eq!(cfg.proxmox_token_secret, s("PROXMOX_TOKEN_SECRET"));
    assert_eq!(cfg.proxmox_node, s("PROXMOX_NODE"));
    assert_eq!(cfg.proxmox_template_vmid, 9100);
    assert_eq!(cfg.proxmox_storage, s("PROXMOX_STORAGE"));
    assert_eq!(cfg.storage_sell_threshold, 0.65);
    assert_eq!(cfg.storage_pool, ["pool-a", "pool-b"]);
    assert_eq!(cfg.proxmox_bridge, s("PROXMOX_BRIDGE"));
    assert!(cfg.proxmox_insecure);
    assert_eq!(cfg.proxmox_console_user, s("PROXMOX_CONSOLE_USER"));
    assert_eq!(cfg.proxmox_console_password, s("PROXMOX_CONSOLE_PASSWORD"));
    assert_eq!(cfg.os_templates.len(), 2);
    assert_eq!(cfg.os_templates["Debian 12"], 9001);
    assert_eq!(cfg.os_templates["Ubuntu 24.04"], 9002);
    assert_eq!(cfg.frp_relays, s("FRP_RELAYS"));
    assert_eq!(cfg.frp_relay_host, s("FRP_RELAY_HOST"));
    assert_eq!(cfg.frp_server_addr, s("FRP_SERVER_ADDR"));
    assert_eq!(cfg.frp_server_port, 7001);
    assert_eq!(cfg.frp_token, s("FRP_TOKEN"));
    assert_eq!(cfg.frp_admin_url, s("FRP_ADMIN_URL"));
    assert_eq!(cfg.frp_admin_user, s("FRP_ADMIN_USER"));
    assert_eq!(cfg.frp_admin_pass, s("FRP_ADMIN_PASS"));
    assert_eq!((cfg.frp_port_min, cfg.frp_port_max), (3000, 3100));
    assert_eq!(cfg.eupa_api_url, s("EUPA_API_URL"));
    assert_eq!(cfg.eupa_api_key, s("EUPA_API_KEY"));
    assert_eq!(cfg.eupa_wallet_id, s("EUPA_WALLET_ID"));
    assert!(!cfg.eupa_fee_to_customer);
    assert!(cfg.stripe_enabled);
    assert_eq!(cfg.stripe_secret_key, s("STRIPE_SECRET_KEY"));
    assert_eq!(cfg.stripe_webhook_secret, s("STRIPE_WEBHOOK_SECRET"));
    assert_eq!(cfg.pagci_api_url, s("PAGCI_API_URL"));
    assert_eq!(cfg.pagci_api_token, s("PAGCI_API_TOKEN"));
    assert_eq!(cfg.pagci_wallet_id, s("PAGCI_WALLET_ID"));
    assert_eq!(cfg.pagci_wallet_name, s("PAGCI_WALLET_NAME"));
    assert_eq!(cfg.pagci_webhook_secret, s("PAGCI_WEBHOOK_SECRET"));
    assert_eq!(cfg.container_agent_url, s("CONTAINER_AGENT_URL"));
    assert_eq!(cfg.container_agent_token, s("CONTAINER_AGENT_TOKEN"));
    assert_eq!(cfg.public_webhook_base, s("PUBLIC_WEBHOOK_BASE"));
    assert_eq!(cfg.billing_currency, s("BILLING_CURRENCY"));
    assert_eq!(cfg.billing_grace_days, 11);
    assert_eq!(cfg.billing_renew_lead_days, 12);
    assert_eq!(cfg.billing_pix_ttl_secs, 13);
    assert!(cfg.billing_worker_enabled);
    assert_eq!(cfg.expiry_grace_days, 14);
    assert_eq!(cfg.custom_domain_relay_ip, s("CUSTOM_DOMAIN_RELAY_IP"));
    assert_eq!(cfg.livekit_api_key, s("LIVEKIT_API_KEY"));
    assert_eq!(cfg.livekit_api_secret, s("LIVEKIT_API_SECRET"));
    assert_eq!(cfg.livekit_url, s("LIVEKIT_URL"));
    assert_eq!(cfg.livekit_host_url, s("LIVEKIT_HOST_URL"));
    assert_eq!((cfg.mc_port_min, cfg.mc_port_max), (26000, 26100));
    assert_eq!(cfg.container_vm_ip, s("CONTAINER_VM_IP"));
    assert_eq!(cfg.cloudflare_api_token, s("CLOUDFLARE_API_TOKEN"));
    assert_eq!(cfg.cloudflare_zone_id, s("CLOUDFLARE_ZONE_ID"));
    assert_eq!(cfg.cloudflare_zone_name, s("CLOUDFLARE_ZONE_NAME"));
}

// ---------------------------------------------------------------------------
// (3) Strictness
// ---------------------------------------------------------------------------

#[test]
fn booleans_are_exactly_true_or_false() {
    type Getter = fn(&Config) -> bool;
    let flags: [(&str, Getter, bool); 4] = [
        ("PROXMOX_INSECURE", |c| c.proxmox_insecure, false),
        ("EUPA_FEE_TO_CUSTOMER", |c| c.eupa_fee_to_customer, true),
        ("STRIPE_ENABLED", |c| c.stripe_enabled, false),
        (
            "BILLING_WORKER_ENABLED",
            |c| c.billing_worker_enabled,
            false,
        ),
    ];
    for (key, get, default) in flags {
        assert!(get(&ok(&[(key, "true")])), "{key}=true");
        assert!(!get(&ok(&[(key, "false")])), "{key}=false");
        assert!(get(&ok(&[(key, " true ")])), "{key} is trimmed");
        assert_eq!(get(&ok(&[(key, "")])), default, "{key} blank is unset");

        for bad in [
            "True", "TRUE", "False", "1", "0", "yes", "no", "on", "off", "t", "truee",
        ] {
            let e = err(&[(key, bad)]);
            assert_eq!(keys_of(&e), [key], "{key}={bad}: only that key is wrong");
            let m = message(&e, key);
            assert!(
                m.contains("`true`") && m.contains("`false`"),
                "{key}={bad}: says what is expected: {m}"
            );
            assert!(
                m.contains(&format!("{bad:?}")),
                "{key}={bad}: shows the offending value: {m}"
            );
        }
    }
}

#[test]
fn numbers_name_the_key_the_type_and_the_value() {
    let bad = [
        ("API_PORT", "abc"),
        ("API_PORT", "70000"),
        ("API_PORT", "-1"),
        ("API_PORT", "80.5"),
        ("API_PORT", "8080 8081"),
        ("FRP_SERVER_PORT", "port"),
        ("FRP_PORT_MIN", "1e3"),
        ("MC_PORT_MAX", "65536"),
        ("ACCESS_TOKEN_TTL_SECONDS", "15m"),
        ("REFRESH_TOKEN_TTL_SECONDS", "1.5"),
        ("RATE_LIMIT_PER_MINUTE", "-5"),
        ("AUTH_RATE_LIMIT_PER_MINUTE", "many"),
        ("MAX_FAILED_LOGINS", "99999999999"),
        ("PROXMOX_TEMPLATE_VMID", "9000.0"),
        ("BILLING_GRACE_DAYS", "three"),
        ("EXPIRY_GRACE_DAYS", ""),
    ];
    for (key, value) in bad {
        if value.is_empty() {
            // Blank is unset, not a parse error.
            ok(&[(key, value)]);
            continue;
        }
        let e = err(&[(key, value)]);
        assert_eq!(keys_of(&e), [key], "{key}={value}");
        let m = message(&e, key);
        assert!(
            m.contains("whole number"),
            "{key}={value}: names the expected type: {m}"
        );
        assert!(
            m.contains(&format!("{value:?}")),
            "{key}={value}: shows the value: {m}"
        );
    }
}

#[test]
fn storage_sell_threshold_is_a_fraction_above_zero_up_to_one() {
    for good in ["0.8", "0.5", "1", "1.0", "0.01", " 0.25 "] {
        let cfg = ok(&[("STORAGE_SELL_THRESHOLD", good)]);
        assert_eq!(
            cfg.storage_sell_threshold,
            good.trim().parse::<f64>().unwrap()
        );
    }
    for bad in [
        "abc", "0", "0.0", "-0.5", "1.01", "2", "100", "NaN", "inf", "-inf", "80%", "0,8",
    ] {
        let e = err(&[("STORAGE_SELL_THRESHOLD", bad)]);
        assert_eq!(keys_of(&e), ["STORAGE_SELL_THRESHOLD"], "{bad}");
        let m = message(&e, "STORAGE_SELL_THRESHOLD");
        assert!(
            m.contains("greater than 0") && m.contains("at most 1"),
            "{bad}: {m}"
        );
        assert!(m.contains(&format!("{bad:?}")), "{bad}: {m}");
    }
    assert_eq!(ok(&[]).storage_sell_threshold, 0.8);
}

#[test]
fn os_templates_is_a_json_object_of_integers_and_the_error_says_why() {
    let cfg = ok(&[(
        "OS_TEMPLATES",
        r#"{"Debian 12": 9001, "Ubuntu 24.04": 9002}"#,
    )]);
    assert_eq!(cfg.os_templates.len(), 2);
    assert_eq!(cfg.os_templates["Debian 12"], 9001);
    assert!(ok(&[("OS_TEMPLATES", "{}")]).os_templates.is_empty());
    assert!(ok(&[("OS_TEMPLATES", "  ")]).os_templates.is_empty());

    for (bad, serde_says) in [
        ("not json", "expected"),
        (r#"{"Debian 12": "9001"}"#, "invalid type"),
        (r#"{"Debian 12": 9001.5}"#, "invalid type"),
        (r#"["Debian 12"]"#, "invalid type"),
        ("null", "invalid type"),
        ("9001", "invalid type"),
        (r#"{"Debian 12": 9001"#, "EOF"),
    ] {
        let e = err(&[("OS_TEMPLATES", bad)]);
        assert_eq!(keys_of(&e), ["OS_TEMPLATES"], "{bad}");
        let m = message(&e, "OS_TEMPLATES");
        assert!(
            m.contains("JSON object"),
            "{bad}: says what is expected: {m}"
        );
        assert!(
            m.contains(serde_says),
            "{bad}: carries serde's message ({serde_says}): {m}"
        );
        assert!(
            m.contains("line 1 column"),
            "{bad}: carries the position: {m}"
        );
    }
}

#[test]
fn app_env_is_exactly_one_of_three_and_a_typo_is_an_error() {
    for (value, expected) in [
        ("development", AppEnv::Development),
        ("staging", AppEnv::Staging),
        ("production", AppEnv::Production),
        ("  production ", AppEnv::Production),
    ] {
        assert_eq!(ok(&[("APP_ENV", value)]).env, expected, "{value:?}");
    }
    for unset in ["", "   "] {
        assert_eq!(
            ok(&[("APP_ENV", unset)]).env,
            AppEnv::Development,
            "{unset:?}"
        );
    }
    assert_eq!(ok(&[]).env, AppEnv::Development);

    for bad in [
        "prodution",
        "Production",
        "PRODUCTION",
        "prod",
        "dev",
        "test",
        "live",
        "production,staging",
    ] {
        let e = err(&[("APP_ENV", bad)]);
        assert_eq!(keys_of(&e), ["APP_ENV"], "{bad}");
        let m = message(&e, "APP_ENV");
        for word in ["development", "staging", "production"] {
            assert!(m.contains(word), "{bad}: lists {word}: {m}");
        }
        assert!(m.contains(&format!("{bad:?}")), "{bad}: {m}");
    }
}

#[test]
fn app_env_round_trips_through_as_str() {
    for env in [AppEnv::Development, AppEnv::Staging, AppEnv::Production] {
        assert_eq!(ok(&[("APP_ENV", env.as_str())]).env, env);
    }
}

const POSITIVE_ONLY: [&str; 8] = [
    "ACCESS_TOKEN_TTL_SECONDS",
    "REFRESH_TOKEN_TTL_SECONDS",
    "EMAIL_TOKEN_TTL_SECONDS",
    "LOGIN_CODE_TTL_SECONDS",
    "RATE_LIMIT_PER_MINUTE",
    "AUTH_RATE_LIMIT_PER_MINUTE",
    "MAX_FAILED_LOGINS",
    "LOCKOUT_MINUTES",
];

#[test]
fn ttls_rate_limits_and_lockout_must_be_positive() {
    for key in POSITIVE_ONLY {
        ok(&[(key, "1")]);
        for bad in ["0", "-1", "-900"] {
            let e = err(&[(key, bad)]);
            assert_eq!(keys_of(&e), [key], "{key}={bad}");
        }
        // A zero is reported with the rule, not as a parse failure.
        let m = message(&err(&[(key, "0")]), key).to_string();
        assert!(
            m.contains("at least 1") && m.contains("got 0"),
            "{key}: {m}"
        );
    }
}

#[test]
fn zero_is_still_accepted_where_it_means_something() {
    // Grace periods of 0 days mean "no grace"; port 0 asks the OS for a free port.
    let cfg = ok(&[
        ("BILLING_GRACE_DAYS", "0"),
        ("BILLING_RENEW_LEAD_DAYS", "0"),
        ("EXPIRY_GRACE_DAYS", "0"),
        ("BILLING_PIX_TTL_SECONDS", "0"),
        ("API_PORT", "0"),
        ("PROXMOX_TEMPLATE_VMID", "0"),
    ]);
    assert_eq!(
        (
            cfg.billing_grace_days,
            cfg.billing_renew_lead_days,
            cfg.expiry_grace_days
        ),
        (0, 0, 0)
    );
    assert_eq!(cfg.port, 0);
}

#[test]
fn lists_are_trimmed_and_empty_items_dropped() {
    let cfg = ok(&[
        (
            "CORS_ALLOWED_ORIGINS",
            " https://a.example.com , ,https://b.example.com,, ",
        ),
        ("STORAGE_POOL", "pool-a,pool-b , ,pool-c"),
    ]);
    assert_eq!(
        cfg.cors_origins,
        ["https://a.example.com", "https://b.example.com"]
    );
    assert_eq!(cfg.storage_pool, ["pool-a", "pool-b", "pool-c"]);
    // Only separators: the list is empty (it is set, so the default does not apply).
    assert!(ok(&[("STORAGE_POOL", " , ,")]).storage_pool.is_empty());
    assert!(ok(&[("CORS_ALLOWED_ORIGINS", " , ")])
        .cors_origins
        .is_empty());
}

#[test]
fn production_rule_secrets_must_be_at_least_32_bytes() {
    let k31 = "k".repeat(31);
    let k32 = "k".repeat(32);

    // Both too short: both reported, once each, without the value.
    let e = err(&[
        ("APP_ENV", "production"),
        ("AUTH_TOKEN_SECRET", &k31),
        ("AUTH_REFRESH_PEPPER", &k31),
    ]);
    assert_eq!(keys_of(&e), ["AUTH_TOKEN_SECRET", "AUTH_REFRESH_PEPPER"]);
    for key in ["AUTH_TOKEN_SECRET", "AUTH_REFRESH_PEPPER"] {
        let m = message(&e, key);
        assert!(m.contains("32 bytes") && m.contains("production"), "{m}");
        assert!(!m.contains(&k31), "the secret must not be echoed: {m}");
    }

    // One of them only.
    let e = err(&[("APP_ENV", "production"), ("AUTH_REFRESH_PEPPER", &k31)]);
    assert_eq!(keys_of(&e), ["AUTH_REFRESH_PEPPER"]);

    // Exactly 32 bytes is fine; so is anything short outside production.
    ok(&[
        ("APP_ENV", "production"),
        ("AUTH_TOKEN_SECRET", &k32),
        ("AUTH_REFRESH_PEPPER", &k32),
    ]);
    for env in ["development", "staging"] {
        ok(&[
            ("APP_ENV", env),
            ("AUTH_TOKEN_SECRET", "short"),
            ("AUTH_REFRESH_PEPPER", "short"),
        ]);
    }
    // The length is in bytes, not characters: 16 two-byte characters are 32 bytes.
    let wide = "é".repeat(16);
    ok(&[
        ("APP_ENV", "production"),
        ("AUTH_TOKEN_SECRET", &wide),
        ("AUTH_REFRESH_PEPPER", &wide),
    ]);
    // Trimming happens first: padding does not make a short secret long enough.
    let padded = format!("  {k31}  ");
    let e = err(&[("APP_ENV", "production"), ("AUTH_TOKEN_SECRET", &padded)]);
    assert_eq!(keys_of(&e), ["AUTH_TOKEN_SECRET"]);
}

#[test]
fn a_missing_secret_in_production_is_one_problem_not_two() {
    let env = BTreeMap::from([("APP_ENV".to_string(), "production".to_string())]);
    let e = load_env(&env).expect_err("must be rejected");
    assert_eq!(keys_of(&e), ["AUTH_TOKEN_SECRET", "AUTH_REFRESH_PEPPER"]);
    for p in e.problems() {
        assert!(p.message.contains("required"), "{p}");
    }
}

#[test]
fn port_ranges_must_not_be_inverted() {
    // The default maximum is used when only the minimum is set.
    let e = err(&[("FRP_PORT_MIN", "2400")]);
    assert_eq!(keys_of(&e), ["FRP_PORT_MIN"]);
    let m = message(&e, "FRP_PORT_MIN");
    assert!(
        m.contains("FRP_PORT_MAX") && m.contains("2400 > 2300"),
        "{m}"
    );

    let e = err(&[("FRP_PORT_MAX", "2100")]);
    assert_eq!(keys_of(&e), ["FRP_PORT_MIN"]);
    assert!(message(&e, "FRP_PORT_MIN").contains("2200 > 2100"));

    let e = err(&[("MC_PORT_MIN", "30000"), ("MC_PORT_MAX", "20000")]);
    assert_eq!(keys_of(&e), ["MC_PORT_MIN"]);
    let m = message(&e, "MC_PORT_MIN");
    assert!(
        m.contains("MC_PORT_MAX") && m.contains("30000 > 20000"),
        "{m}"
    );

    // Both ranges wrong at once: both reported.
    let e = err(&[
        ("FRP_PORT_MIN", "3000"),
        ("FRP_PORT_MAX", "2000"),
        ("MC_PORT_MIN", "3000"),
        ("MC_PORT_MAX", "2000"),
    ]);
    assert_eq!(keys_of(&e), ["FRP_PORT_MIN", "MC_PORT_MIN"]);

    // A single port (min == max) is a valid range.
    let cfg = ok(&[
        ("FRP_PORT_MIN", "2222"),
        ("FRP_PORT_MAX", "2222"),
        ("MC_PORT_MIN", "25565"),
        ("MC_PORT_MAX", "25565"),
    ]);
    assert_eq!((cfg.frp_port_min, cfg.frp_port_max), (2222, 2222));

    // A bound that does not parse is reported once, with no bogus range error.
    let e = err(&[("FRP_PORT_MIN", "abc"), ("FRP_PORT_MAX", "100")]);
    assert_eq!(keys_of(&e), ["FRP_PORT_MIN"]);
    assert!(message(&e, "FRP_PORT_MIN").contains("whole number"));
}

// ---------------------------------------------------------------------------
// (4) Blank == unset
// ---------------------------------------------------------------------------

#[test]
fn blank_and_whitespace_values_count_as_unset() {
    // Every optional variable blank, in three different ways: same as the defaults.
    let required = ["AUTH_TOKEN_SECRET", "AUTH_REFRESH_PEPPER"];
    let mut env = env_with(&[]);
    for (i, key) in requested_keys().iter().enumerate() {
        if !required.contains(&key.as_str()) {
            let blank = ["", "   ", "\t \t"][i % 3];
            env.insert(key.clone(), blank.to_string());
        }
    }
    assert_defaults(&load_env(&env).unwrap_or_else(|e| panic!("{e}")));

    // A required variable that is blank is missing.
    for key in required {
        for blank in ["", "   ", "\t"] {
            let e = err(&[(key, blank)]);
            assert_eq!(keys_of(&e), [key], "{key}={blank:?}");
            assert!(message(&e, key).contains("required"));
        }
    }
}

#[test]
fn a_blank_line_in_dot_env_gives_the_default_not_an_empty_string() {
    // `KEY=` in a `.env` reaches the loader as "". These used to come out empty.
    let cfg = ok(&[
        ("API_HOST", ""),
        ("CORS_ALLOWED_ORIGINS", ""),
        ("MONGO_URI", ""),
        ("EMAIL_FROM", ""),
        ("BILLING_CURRENCY", ""),
        ("CLOUDFLARE_ZONE_NAME", ""),
        ("EUPA_API_URL", ""),
    ]);
    assert_eq!(cfg.host, "0.0.0.0");
    assert_eq!(cfg.cors_origins, ["http://localhost:3000"]);
    assert_eq!(cfg.mongo_uri, "mongodb://localhost:27017");
    assert_eq!(cfg.email_from, "ArtixCloud <no-reply@artixcloud.com>");
    assert_eq!(cfg.billing_currency, "BRL");
    assert_eq!(cfg.cloudflare_zone_name, "artix.cloud");
    assert_eq!(cfg.eupa_api_url, "https://api.eupa.gay");
}

#[test]
fn values_are_trimmed() {
    let cfg = ok(&[
        (
            "AUTH_TOKEN_SECRET",
            "  secret-with-padding-0123456789-abcdef  ",
        ),
        ("API_PORT", " 9090 "),
        ("PROXMOX_NODE", "\tnode1 \n"),
        ("PUBLIC_APP_URL", " https://app.example.com "),
        ("STORAGE_SELL_THRESHOLD", " 0.5 "),
        ("OS_TEMPLATES", " {\"A\": 1} "),
    ]);
    assert_eq!(
        cfg.auth_token_secret,
        b"secret-with-padding-0123456789-abcdef"
    );
    assert_eq!(cfg.port, 9090);
    assert_eq!(cfg.proxmox_node, "node1");
    assert_eq!(cfg.public_app_url, "https://app.example.com");
    assert_eq!(cfg.storage_sell_threshold, 0.5);
    assert_eq!(cfg.os_templates["A"], 1);
}

// ---------------------------------------------------------------------------
// (5) Everything is reported together
// ---------------------------------------------------------------------------

#[test]
fn an_empty_environment_reports_both_required_secrets() {
    let e = Config::from_lookup(|_| None).expect_err("must be rejected");
    assert_eq!(keys_of(&e), ["AUTH_TOKEN_SECRET", "AUTH_REFRESH_PEPPER"]);
}

#[test]
fn several_problems_are_all_reported_in_one_call() {
    // Two missing secrets, plus a typo in almost every kind of variable.
    let env: Env = [
        ("APP_ENV", "prodution"),
        ("API_PORT", "abc"),
        ("STRIPE_ENABLED", "True"),
        ("PROXMOX_INSECURE", "1"),
        ("EUPA_FEE_TO_CUSTOMER", "yes"),
        ("BILLING_WORKER_ENABLED", "on"),
        ("STORAGE_SELL_THRESHOLD", "2"),
        ("OS_TEMPLATES", "[]"),
        ("ACCESS_TOKEN_TTL_SECONDS", "0"),
        ("RATE_LIMIT_PER_MINUTE", "-1"),
        ("LOCKOUT_MINUTES", "0"),
        ("FRP_PORT_MIN", "3000"),
        ("FRP_PORT_MAX", "2000"),
        ("MC_PORT_MIN", "30000"),
        ("MC_PORT_MAX", "20000"),
        ("PROXMOX_TEMPLATE_VMID", "nine"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let e = load_env(&env).expect_err("must be rejected");

    let mut got = keys_of(&e);
    got.sort_unstable();
    let mut expected = vec![
        "APP_ENV",
        "API_PORT",
        "STRIPE_ENABLED",
        "PROXMOX_INSECURE",
        "EUPA_FEE_TO_CUSTOMER",
        "BILLING_WORKER_ENABLED",
        "STORAGE_SELL_THRESHOLD",
        "OS_TEMPLATES",
        "ACCESS_TOKEN_TTL_SECONDS",
        "RATE_LIMIT_PER_MINUTE",
        "LOCKOUT_MINUTES",
        "FRP_PORT_MIN",
        "MC_PORT_MIN",
        "PROXMOX_TEMPLATE_VMID",
        "AUTH_TOKEN_SECRET",
        "AUTH_REFRESH_PEPPER",
    ];
    expected.sort_unstable();
    assert_eq!(got, expected, "every problem, exactly once");

    // Display: one `KEY: message` line per problem.
    let text = e.to_string();
    assert_eq!(text.lines().count(), e.problems().len(), "{text}");
    for (line, problem) in text.lines().zip(e.problems()) {
        assert_eq!(line, format!("{}: {}", problem.key, problem.message));
        assert!(!problem.message.is_empty() && !problem.message.contains('\n'));
    }

    // It is a real error type: usable as `dyn Error` (main() boxes it).
    let as_error: &dyn std::error::Error = &e;
    assert_eq!(as_error.to_string(), text);
}

// ---------------------------------------------------------------------------
// (6) Nothing secret ever comes out
// ---------------------------------------------------------------------------

const MARKER: &str = "s3ntinel-9f3b2c71";

/// Variables that hold a credential, or a URL that can embed one.
const SECRET_VARS: [&str; 33] = [
    "AUTH_TOKEN_SECRET",
    "AUTH_REFRESH_PEPPER",
    "MONGO_URI",
    "RESEND_API_KEY",
    "DISCORD_CLIENT_SECRET",
    "GITHUB_CLIENT_SECRET",
    "PROXMOX_API_URL",
    "PROXMOX_TOKEN_ID",
    "PROXMOX_TOKEN_SECRET",
    "PROXMOX_CONSOLE_USER",
    "PROXMOX_CONSOLE_PASSWORD",
    "FRP_RELAYS",
    "FRP_RELAY_HOST",
    "FRP_TOKEN",
    "FRP_ADMIN_URL",
    "FRP_ADMIN_PASS",
    "EUPA_API_URL",
    "EUPA_API_KEY",
    "EUPA_WALLET_ID",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAGCI_API_URL",
    "PAGCI_API_TOKEN",
    "PAGCI_WALLET_ID",
    "PAGCI_WEBHOOK_SECRET",
    "CONTAINER_AGENT_URL",
    "CONTAINER_AGENT_TOKEN",
    "PUBLIC_WEBHOOK_BASE",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ZONE_ID",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_URL",
];

/// A value for `key` that carries the marker (as the password of a URL where the
/// variable is a URL) and is long enough for the production rule.
fn secret_value(key: &str) -> String {
    let pad = "0123456789abcdef0123456789abcdef";
    if key.ends_with("_URI") || key.ends_with("_URL") || key.ends_with("_BASE") {
        format!("https://user:{MARKER}-{key}-{pad}@host.example.com/path")
    } else {
        format!("{MARKER}-{key}-{pad}")
    }
}

fn marker_env(extra: &[(&str, &str)]) -> Env {
    let mut env: Env = SECRET_VARS
        .iter()
        .map(|k| (k.to_string(), secret_value(k)))
        .collect();
    // A valid relay list whose tokens carry the marker.
    env.insert(
        "FRP_RELAYS".into(),
        format!(
            r#"[{{"name":"r1","host":"relay.example.com","token":"{MARKER}-t","admin_url":"http://192.0.2.10:7400","admin_pass":"{MARKER}-p"}}]"#
        ),
    );
    for (k, v) in extra {
        env.insert(k.to_string(), v.to_string());
    }
    env
}

fn assert_no_marker(what: &str, text: &str) {
    assert!(!text.contains(MARKER), "{what} leaks a secret:\n{text}");
    assert!(
        !text.contains("0123456789abcdef"),
        "{what} leaks part of a secret:\n{text}"
    );
}

#[test]
fn debug_output_is_an_allowlist_and_never_shows_a_secret() {
    let env = marker_env(&[("APP_ENV", "production"), ("STRIPE_ENABLED", "true")]);
    let cfg = load_env(&env).unwrap_or_else(|e| panic!("{e}"));

    for (what, text) in [("{:?}", format!("{cfg:?}")), ("{:#?}", format!("{cfg:#?}"))] {
        assert_no_marker(what, &text);
        // ... while still telling something useful.
        assert!(text.contains("Production"), "{text}");
        assert!(text.contains("8080"), "{text}");
        assert!(text.contains("Card payments (Stripe)"), "{text}");
        // URLs that can carry credentials never appear, whatever they hold.
        assert!(!text.contains("host.example.com"), "{text}");
    }
    // The secret bytes themselves, in any rendering.
    let dbg = format!("{cfg:?}");
    let as_list = format!("{:?}", cfg.auth_token_secret);
    assert!(!dbg.contains(&as_list));
}

#[test]
fn errors_never_show_a_secret() {
    // Every secret set, in production, with short auth secrets and typos elsewhere.
    let short = format!("{MARKER}-short");
    assert!(short.len() < 32);
    let env = marker_env(&[
        ("APP_ENV", "production"),
        ("AUTH_TOKEN_SECRET", &short),
        ("AUTH_REFRESH_PEPPER", &short),
        ("API_PORT", "abc"),
        ("STRIPE_ENABLED", "True"),
        ("OS_TEMPLATES", "nope"),
    ]);
    let e = load_env(&env).expect_err("must be rejected");
    // Sanity: the typos and both short secrets are reported (so there is something
    // that could have leaked).
    let mut got = keys_of(&e);
    got.sort_unstable();
    assert_eq!(
        got,
        [
            "API_PORT",
            "AUTH_REFRESH_PEPPER",
            "AUTH_TOKEN_SECRET",
            "OS_TEMPLATES",
            "STRIPE_ENABLED"
        ]
    );
    assert_no_marker("ConfigError Display", &e.to_string());
    assert_no_marker("ConfigError Debug", &format!("{e:?}"));
    assert_no_marker("ConfigError problems", &format!("{:?}", e.problems()));

    // The same through the `--check-config` report.
    let out = cli::check_config(|k| env.get(k).cloned(), &EnvFile::Missing);
    assert_eq!(out.exit_code, 1);
    assert_no_marker("check-config stderr", &out.stderr);
    assert_no_marker("check-config stdout", &out.stdout);
}

#[test]
fn warnings_never_show_a_secret() {
    // Everything configured: partial setups, plus a production environment that
    // trips the production warnings.
    let env = marker_env(&[
        ("APP_ENV", "production"),
        ("PROXMOX_INSECURE", "true"),
        ("RESEND_API_KEY", ""),
        ("PAGCI_WEBHOOK_SECRET", ""),
        ("STRIPE_ENABLED", "true"),
        ("STRIPE_WEBHOOK_SECRET", ""),
        ("DISCORD_CLIENT_SECRET", ""),
        ("CORS_ALLOWED_ORIGINS", "*, http://localhost:3000"),
    ]);
    let cfg = load_env(&env).unwrap_or_else(|e| panic!("{e}"));
    let warnings = cfg.warnings();
    assert!(
        warnings.len() >= 6,
        "expected a pile of warnings, got {warnings:#?}"
    );
    for w in &warnings {
        assert_no_marker("a warning", w);
    }

    // A relay list that does not parse: the warning gives the position and the
    // kind of error, never serde's message (which quotes the offending value).
    let broken = [
        // wrong type for a number: serde would say `invalid type: string "<marker>"`
        format!(
            r#"[{{"name":"r1","host":"h","token":"{MARKER}","admin_url":"u","admin_pass":"p","server_port":"{MARKER}"}}]"#
        ),
        // cut short
        format!(r#"[{{"name":"r1","token":"{MARKER}""#),
        // not an array
        format!(r#"{{"token":"{MARKER}"}}"#),
        // syntax error right after a secret
        format!(r#"[{{"name":"r1","token":"{MARKER}", oops}}]"#),
    ];
    for relays in &broken {
        let cfg = ok(&[("FRP_RELAYS", relays)]);
        let w = cfg.warnings();
        assert!(
            w.iter()
                .any(|l| l.contains("FRP_RELAYS") && l.contains("not a valid JSON array")),
            "{relays}: {w:#?}"
        );
        for line in &w {
            assert_no_marker("an FRP_RELAYS warning", line);
        }
        assert_no_marker("Debug", &format!("{cfg:?}"));
    }

    // And the check-config report that prints them.
    let out = cli::check_config(|k| env.get(k).cloned(), &EnvFile::Missing);
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    assert_no_marker("check-config stdout", &out.stdout);
}

// ---------------------------------------------------------------------------
// (8) Warnings
// ---------------------------------------------------------------------------

fn warnings_for(extra: &[(&str, &str)]) -> Vec<String> {
    ok(extra).warnings()
}

#[track_caller]
fn assert_warns(extra: &[(&str, &str)], needles: &[&str]) {
    let w = warnings_for(extra);
    assert!(
        w.iter()
            .any(|line| needles.iter().all(|n| line.contains(n))),
        "expected a warning mentioning {needles:?} for {extra:?}, got {w:#?}"
    );
}

#[track_caller]
fn assert_quiet(extra: &[(&str, &str)]) {
    let w = warnings_for(extra);
    assert!(
        w.is_empty(),
        "expected no warnings for {extra:?}, got {w:#?}"
    );
}

#[test]
fn an_empty_optional_setup_has_no_warnings() {
    assert_quiet(&[]);
    assert_quiet(&[("APP_ENV", "staging")]);
    assert_quiet(&[("APP_ENV", "development")]);
    // Development-only settings are fine in development.
    assert_quiet(&[
        ("PROXMOX_INSECURE", "true"),
        ("CORS_ALLOWED_ORIGINS", "*, http://localhost:3000"),
    ]);
    assert_quiet(&[("PUBLIC_APP_URL", "http://localhost:3000")]);
    // Settings that have defaults are not a signal that an integration is wanted.
    assert_quiet(&[
        ("EUPA_API_URL", "https://eupa.example.com"),
        ("CLOUDFLARE_ZONE_NAME", "example.org"),
        ("PAGCI_WALLET_NAME", "wallet"),
        ("PROXMOX_NODE", "node1"),
        ("STRIPE_ENABLED", "false"),
    ]);
}

#[test]
fn partially_configured_proxmox_is_flagged() {
    let url = "https://pve.example.com:8006/api2/json";
    assert_warns(
        &[("PROXMOX_API_URL", url)],
        &[
            "Proxmox",
            "partially",
            "set: PROXMOX_API_URL",
            "missing: PROXMOX_TOKEN_ID, PROXMOX_TOKEN_SECRET",
        ],
    );
    assert_warns(
        &[("PROXMOX_TOKEN_ID", "root@pam!artix")],
        &["missing: PROXMOX_API_URL, PROXMOX_TOKEN_SECRET"],
    );
    assert_warns(
        &[("PROXMOX_TOKEN_SECRET", "x")],
        &["missing: PROXMOX_API_URL, PROXMOX_TOKEN_ID"],
    );
    assert_warns(
        &[
            ("PROXMOX_API_URL", url),
            ("PROXMOX_TOKEN_ID", "root@pam!artix"),
        ],
        &["missing: PROXMOX_TOKEN_SECRET"],
    );
    assert_quiet(&[
        ("PROXMOX_API_URL", url),
        ("PROXMOX_TOKEN_ID", "root@pam!artix"),
        ("PROXMOX_TOKEN_SECRET", "x"),
    ]);

    assert_warns(
        &[("PROXMOX_CONSOLE_USER", "console@pve")],
        &["serial console", "missing: PROXMOX_CONSOLE_PASSWORD"],
    );
    assert_warns(
        &[("PROXMOX_CONSOLE_PASSWORD", "x")],
        &["serial console", "missing: PROXMOX_CONSOLE_USER"],
    );
    assert_quiet(&[
        ("PROXMOX_CONSOLE_USER", "console@pve"),
        ("PROXMOX_CONSOLE_PASSWORD", "x"),
    ]);
}

#[test]
fn stripe_warnings_follow_the_real_enabled_rule() {
    assert_warns(
        &[("STRIPE_ENABLED", "true")],
        &["STRIPE_SECRET_KEY", "disabled"],
    );
    assert_warns(
        &[
            ("STRIPE_ENABLED", "true"),
            ("STRIPE_SECRET_KEY", "sk_test_x"),
        ],
        &["STRIPE_WEBHOOK_SECRET"],
    );
    assert_quiet(&[
        ("STRIPE_ENABLED", "true"),
        ("STRIPE_SECRET_KEY", "sk_test_x"),
        ("STRIPE_WEBHOOK_SECRET", "whsec_x"),
    ]);
    // Keys without the switch: Stripe stays off.
    assert_warns(&[("STRIPE_SECRET_KEY", "sk_test_x")], &["STRIPE_ENABLED"]);
    assert_warns(&[("STRIPE_WEBHOOK_SECRET", "whsec_x")], &["STRIPE_ENABLED"]);
    assert_quiet(&[("STRIPE_ENABLED", "false")]);
}

#[test]
fn pagci_warnings() {
    let url = "https://pagci.example.com";
    assert_warns(
        &[("PAGCI_API_URL", url)],
        &[
            "PagCI",
            "partially",
            "missing: PAGCI_API_TOKEN, PAGCI_WALLET_ID",
        ],
    );
    assert_warns(
        &[("PAGCI_API_TOKEN", "t")],
        &["missing: PAGCI_API_URL, PAGCI_WALLET_ID"],
    );
    assert_warns(
        &[("PAGCI_WALLET_ID", "w")],
        &["missing: PAGCI_API_URL, PAGCI_API_TOKEN"],
    );
    // Enabled, but its webhooks would all be rejected.
    let enabled = [
        ("PAGCI_API_URL", url),
        ("PAGCI_API_TOKEN", "t"),
        ("PAGCI_WALLET_ID", "w"),
    ];
    assert_warns(&enabled, &["PAGCI_WEBHOOK_SECRET"]);
    let mut all = enabled.to_vec();
    all.push(("PAGCI_WEBHOOK_SECRET", "whsec"));
    assert_quiet(&all);
    // A webhook secret alone does not enable anything.
    assert_quiet(&[("PAGCI_WEBHOOK_SECRET", "whsec")]);
}

#[test]
fn crypto_frp_cloudflare_agent_and_oauth_warnings() {
    // Eupa (crypto)
    assert_warns(
        &[("EUPA_API_KEY", "k")],
        &["Eupa", "missing: EUPA_WALLET_ID"],
    );
    assert_warns(
        &[("EUPA_WALLET_ID", "w")],
        &["Eupa", "missing: EUPA_API_KEY"],
    );
    assert_quiet(&[("EUPA_API_KEY", "k"), ("EUPA_WALLET_ID", "w")]);

    // frp: flat variables
    assert_warns(
        &[("FRP_RELAY_HOST", "relay.example.com")],
        &["frp", "missing: FRP_ADMIN_URL"],
    );
    assert_warns(
        &[("FRP_ADMIN_URL", "http://192.0.2.10:7400")],
        &["frp", "missing: FRP_RELAY_HOST"],
    );
    assert_quiet(&[
        ("FRP_RELAY_HOST", "relay.example.com"),
        ("FRP_ADMIN_URL", "http://192.0.2.10:7400"),
    ]);
    // frp: the JSON list
    let relays = r#"[{"name":"r1","host":"relay.example.com","token":"t","admin_url":"http://192.0.2.10:7400","admin_pass":"p"}]"#;
    assert_quiet(&[("FRP_RELAYS", relays)]);
    assert_warns(
        &[("FRP_RELAYS", "not json")],
        &[
            "FRP_RELAYS",
            "not a valid JSON array",
            "syntax error",
            "line 1",
        ],
    );
    assert_warns(
        &[("FRP_RELAYS", r#"[{"name":"r1"}]"#)],
        &["FRP_RELAYS", "not a valid JSON array"],
    );
    assert_warns(&[("FRP_RELAYS", "[]")], &["FRP_RELAYS", "empty"]);
    // Once FRP_RELAYS is set the flat variables are not looked at.
    assert_quiet(&[
        ("FRP_RELAYS", relays),
        ("FRP_RELAY_HOST", "relay.example.com"),
    ]);

    // Cloudflare
    assert_warns(
        &[("CLOUDFLARE_API_TOKEN", "t")],
        &["Cloudflare", "missing: CLOUDFLARE_ZONE_ID"],
    );
    assert_warns(
        &[("CLOUDFLARE_ZONE_ID", "z")],
        &["Cloudflare", "missing: CLOUDFLARE_API_TOKEN"],
    );
    assert_quiet(&[("CLOUDFLARE_API_TOKEN", "t"), ("CLOUDFLARE_ZONE_ID", "z")]);

    // Container agent: the URL without the token, and the reverse
    assert_warns(
        &[("CONTAINER_AGENT_URL", "http://192.0.2.10:9090")],
        &["container agent", "missing: CONTAINER_AGENT_TOKEN"],
    );
    assert_warns(
        &[("CONTAINER_AGENT_TOKEN", "t")],
        &["container agent", "missing: CONTAINER_AGENT_URL"],
    );
    assert_quiet(&[
        ("CONTAINER_AGENT_URL", "http://192.0.2.10:9090"),
        ("CONTAINER_AGENT_TOKEN", "t"),
    ]);

    // OAuth providers, each on its own
    assert_warns(
        &[("DISCORD_CLIENT_ID", "id")],
        &["Discord", "missing: DISCORD_CLIENT_SECRET"],
    );
    assert_warns(
        &[("DISCORD_CLIENT_SECRET", "s")],
        &["Discord", "missing: DISCORD_CLIENT_ID"],
    );
    assert_warns(
        &[("GITHUB_CLIENT_ID", "id")],
        &["GitHub", "missing: GITHUB_CLIENT_SECRET"],
    );
    assert_warns(
        &[("GITHUB_CLIENT_SECRET", "s")],
        &["GitHub", "missing: GITHUB_CLIENT_ID"],
    );
    assert_quiet(&[("DISCORD_CLIENT_ID", "id"), ("DISCORD_CLIENT_SECRET", "s")]);
    assert_quiet(&[("GITHUB_CLIENT_ID", "id"), ("GITHUB_CLIENT_SECRET", "s")]);
    // One provider complete and the other empty is perfectly fine.
    assert_quiet(&[
        ("GITHUB_CLIENT_ID", "id"),
        ("GITHUB_CLIENT_SECRET", "s"),
        ("DISCORD_CLIENT_ID", ""),
        ("DISCORD_CLIENT_SECRET", ""),
    ]);
}

#[test]
fn livekit_warnings() {
    // key / secret / url: all or none
    assert_warns(
        &[("LIVEKIT_API_KEY", "k")],
        &[
            "LiveKit",
            "partially",
            "missing: LIVEKIT_API_SECRET, LIVEKIT_URL",
        ],
    );
    assert_warns(
        &[("LIVEKIT_API_SECRET", "s")],
        &[
            "LiveKit",
            "partially",
            "missing: LIVEKIT_API_KEY, LIVEKIT_URL",
        ],
    );
    assert_warns(
        &[("LIVEKIT_URL", "wss://live.example.com")],
        &[
            "LiveKit",
            "partially",
            "missing: LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
        ],
    );

    // A key without LIVEKIT_HOST_URL: the call roster cannot work.
    let trio = [
        ("LIVEKIT_API_KEY", "k"),
        ("LIVEKIT_API_SECRET", "s"),
        ("LIVEKIT_URL", "wss://live.example.com"),
    ];
    assert_warns(&trio, &["LIVEKIT_API_KEY", "LIVEKIT_HOST_URL", "roster"]);
    assert!(
        !warnings_for(&trio).iter().any(|w| w.contains("partially")),
        "the key pair and the public URL are all there"
    );
    assert_warns(&[("LIVEKIT_API_KEY", "k")], &["LIVEKIT_HOST_URL"]);

    // Everything set: quiet.
    let mut all = trio.to_vec();
    all.push(("LIVEKIT_HOST_URL", "http://192.0.2.20:7880"));
    assert_quiet(&all);
    // The roster URL alone is not a signal either way.
    assert_quiet(&[("LIVEKIT_HOST_URL", "http://192.0.2.20:7880")]);
}

#[test]
fn production_setups_that_look_wrong_are_flagged() {
    // A production environment with no other setting: every dev default shows up.
    let w = warnings_for(&[("APP_ENV", "production")]);
    for needle in [
        "PUBLIC_APP_URL",
        "PUBLIC_API_URL",
        "CORS_ALLOWED_ORIGINS",
        "RESEND_API_KEY",
    ] {
        assert!(w.iter().any(|l| l.contains(needle)), "{needle}: {w:#?}");
    }
    assert_eq!(w.len(), 4, "{w:#?}");

    let good = [
        ("APP_ENV", "production"),
        ("PUBLIC_APP_URL", "https://app.example.com"),
        ("PUBLIC_API_URL", "https://api.example.com"),
        ("CORS_ALLOWED_ORIGINS", "https://app.example.com"),
        ("RESEND_API_KEY", "re_example"),
    ];
    assert_quiet(&good);

    let with = |extra: (&'static str, &'static str)| {
        let mut v = good.to_vec();
        v.retain(|(k, _)| *k != extra.0);
        v.push(extra);
        v
    };
    assert_warns(
        &with(("PUBLIC_APP_URL", "http://app.example.com")),
        &["PUBLIC_APP_URL", "https://"],
    );
    assert_warns(
        &with(("PUBLIC_API_URL", "http://api.example.com")),
        &["PUBLIC_API_URL", "https://"],
    );
    assert_warns(
        &with(("CORS_ALLOWED_ORIGINS", "*")),
        &["CORS_ALLOWED_ORIGINS", "`*`"],
    );
    assert_warns(
        &with((
            "CORS_ALLOWED_ORIGINS",
            "https://app.example.com, https://*.example.com, *",
        )),
        &["`*`"],
    );
    assert_warns(
        &with((
            "CORS_ALLOWED_ORIGINS",
            "https://app.example.com, http://LocalHost:3000",
        )),
        &["CORS_ALLOWED_ORIGINS", "localhost"],
    );
    assert_warns(&with(("PROXMOX_INSECURE", "true")), &["PROXMOX_INSECURE"]);
    assert_warns(&with(("RESEND_API_KEY", "")), &["RESEND_API_KEY", "emails"]);

    // The scheme check ignores case; a wildcard subdomain is not `*`.
    assert_quiet(&with(("PUBLIC_APP_URL", "HTTPS://APP.EXAMPLE.COM")));
    assert_quiet(&with(("CORS_ALLOWED_ORIGINS", "https://*.example.com")));

    // The very same settings in staging or development are left alone.
    for env in ["staging", "development"] {
        assert_quiet(&[
            ("APP_ENV", env),
            ("PROXMOX_INSECURE", "true"),
            ("PUBLIC_APP_URL", "http://app.example.com"),
            ("CORS_ALLOWED_ORIGINS", "*"),
        ]);
    }
}

#[test]
fn every_warning_is_a_single_line_naming_variables() {
    let w = warnings_for(&[
        ("APP_ENV", "production"),
        ("PROXMOX_API_URL", "https://pve.example.com"),
        ("STRIPE_ENABLED", "true"),
        ("FRP_RELAYS", "{"),
        ("LIVEKIT_API_KEY", "k"),
        ("DISCORD_CLIENT_ID", "id"),
    ]);
    assert!(w.len() >= 8, "{w:#?}");
    for line in &w {
        assert!(!line.is_empty() && !line.contains('\n'), "{line:?}");
        assert!(
            line.chars().any(|c| c.is_ascii_uppercase()) && line.contains('_'),
            "names a variable: {line}"
        );
    }
}

// ---------------------------------------------------------------------------
// Features: the summary mirrors what the real constructors decide
// ---------------------------------------------------------------------------

/// Every on/off combination of `pairs`.
fn combinations<'a>(pairs: &[(&'a str, &'a str)]) -> Vec<Vec<(&'a str, &'a str)>> {
    (0..1usize << pairs.len())
        .map(|mask| {
            pairs
                .iter()
                .enumerate()
                .filter(|(i, _)| mask >> i & 1 == 1)
                .map(|(_, pair)| *pair)
                .collect()
        })
        .collect()
}

#[test]
fn features_agree_with_the_real_constructors() {
    for set in combinations(&[
        ("PROXMOX_API_URL", "https://pve.example.com:8006/api2/json"),
        ("PROXMOX_TOKEN_ID", "root@pam!artix"),
        ("PROXMOX_TOKEN_SECRET", "x"),
    ]) {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "Proxmox"),
            ProxmoxClient::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }
    for set in combinations(&[
        ("PAGCI_API_URL", "https://pagci.example.com"),
        ("PAGCI_API_TOKEN", "t"),
        ("PAGCI_WALLET_ID", "w"),
    ]) {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "PagCI"),
            PagCiClient::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }
    for set in combinations(&[("EUPA_API_KEY", "k"), ("EUPA_WALLET_ID", "w")]) {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "Eupa"),
            CryptoClient::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }
    for set in combinations(&[
        ("STRIPE_ENABLED", "true"),
        ("STRIPE_SECRET_KEY", "sk_test_x"),
        ("STRIPE_WEBHOOK_SECRET", "whsec_x"),
    ]) {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "Stripe"),
            StripeClient::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }
    for set in combinations(&[
        ("CONTAINER_AGENT_URL", "http://192.0.2.10:9090"),
        ("CONTAINER_AGENT_TOKEN", "t"),
    ]) {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "agent"),
            AgentClient::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }

    // frp has two ways to be configured.
    let relays = r#"[{"name":"r1","host":"relay.example.com","token":"t","admin_url":"http://192.0.2.10:7400","admin_pass":"p"}]"#;
    let flat = [
        ("FRP_RELAY_HOST", "relay.example.com"),
        ("FRP_ADMIN_URL", "http://192.0.2.10:7400"),
    ];
    let cases: Vec<Vec<(&str, &str)>> = vec![
        vec![],
        vec![flat[0]],
        vec![flat[1]],
        flat.to_vec(),
        vec![("FRP_RELAYS", relays)],
        vec![("FRP_RELAYS", relays), flat[0]],
        vec![("FRP_RELAYS", "[]")],
        vec![("FRP_RELAYS", "not json")],
        vec![("FRP_RELAYS", r#"[{"name":"r1"}]"#)],
        vec![("FRP_RELAYS", "not json"), flat[0], flat[1]],
    ];
    for set in cases {
        let cfg = ok(&set);
        assert_eq!(
            feature(&cfg, "frp"),
            Frp::from_config(&cfg).is_some(),
            "{set:?}"
        );
    }
}

#[test]
fn features_report_what_is_switched_on() {
    let cfg = ok(&[]);
    let all = cfg.features();
    assert!(all.len() >= 12, "{all:?}");
    assert!(
        all.iter().all(|(_, on)| !on),
        "a bare setup enables nothing: {all:?}"
    );
    let names: BTreeSet<&str> = all.iter().map(|(name, _)| *name).collect();
    assert_eq!(names.len(), all.len(), "feature names are unique");

    let cfg = ok(&[
        ("RESEND_API_KEY", "re_x"),
        ("DISCORD_CLIENT_ID", "id"),
        ("DISCORD_CLIENT_SECRET", "s"),
        ("BILLING_WORKER_ENABLED", "true"),
        ("PUBLIC_WEBHOOK_BASE", "https://hooks.example.com"),
        ("CUSTOM_DOMAIN_RELAY_IP", "203.0.113.7"),
        ("CLOUDFLARE_API_TOKEN", "t"),
        ("CLOUDFLARE_ZONE_ID", "z"),
        ("LIVEKIT_API_KEY", "k"),
        ("LIVEKIT_API_SECRET", "s"),
        ("LIVEKIT_URL", "wss://live.example.com"),
        ("PROXMOX_CONSOLE_USER", "console@pve"),
        ("PROXMOX_CONSOLE_PASSWORD", "x"),
    ]);
    for on in [
        "Email",
        "Discord",
        "Billing worker",
        "webhooks",
        "Custom domains",
        "Cloudflare",
        "LiveKit",
        "serial console",
    ] {
        assert!(feature(&cfg, on), "{on} should be on");
    }
    for off in [
        "GitHub sign-in",
        "Proxmox",
        "PagCI",
        "Eupa",
        "Stripe",
        "frp",
        "agent",
    ] {
        assert!(!feature(&cfg, off), "{off} should be off");
    }
    // The key pair alone is not enough for voice: the browser needs the URL too.
    assert!(!feature(
        &ok(&[("LIVEKIT_API_KEY", "k"), ("LIVEKIT_API_SECRET", "s")]),
        "LiveKit"
    ));
}

// ---------------------------------------------------------------------------
// (9) `--check-config`
// ---------------------------------------------------------------------------

fn check(extra: &[(&str, &str)]) -> cli::CheckOutcome {
    let env = env_with(extra);
    cli::check_config(|k| env.get(k).cloned(), &EnvFile::Missing)
}

#[test]
fn check_config_with_an_empty_environment_prints_both_missing_secrets() {
    let out = cli::check_config(|_| None, &EnvFile::Missing);
    assert_eq!(out.exit_code, 1);
    assert!(
        out.stdout.is_empty(),
        "errors go to stderr only: {}",
        out.stdout
    );
    assert!(
        out.stderr.contains("AUTH_TOKEN_SECRET: required"),
        "{}",
        out.stderr
    );
    assert!(
        out.stderr.contains("AUTH_REFRESH_PEPPER: required"),
        "{}",
        out.stderr
    );
    assert!(out.stderr.contains("2 problems"), "{}", out.stderr);
    assert!(
        out.stderr
            .trim_end()
            .ends_with("docs/configuration.md for every variable and its default."),
        "ends with a pointer to the docs: {}",
        out.stderr
    );
}

#[test]
fn check_config_reports_every_problem_at_once() {
    let out = check(&[
        ("STRIPE_ENABLED", "True"),
        ("API_PORT", "abc"),
        ("MC_PORT_MIN", "30000"),
        ("MC_PORT_MAX", "20000"),
        ("APP_ENV", "prodution"),
    ]);
    assert_eq!(out.exit_code, 1);
    assert!(out.stdout.is_empty());
    for needle in [
        "4 problems",
        "APP_ENV:",
        "API_PORT:",
        "STRIPE_ENABLED:",
        "MC_PORT_MIN:",
        "\"prodution\"",
        "\"abc\"",
        "\"True\"",
    ] {
        assert!(out.stderr.contains(needle), "{needle}: {}", out.stderr);
    }
    // One line per problem, each indented under the header.
    let problem_lines = out.stderr.lines().filter(|l| l.starts_with("  ")).count();
    assert_eq!(problem_lines, 4, "{}", out.stderr);

    let one = check(&[("API_PORT", "abc")]);
    assert!(
        one.stderr.contains("1 problem found"),
        "singular: {}",
        one.stderr
    );
}

#[test]
fn check_config_summarises_a_valid_environment() {
    let out = check(&[]);
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    assert!(out.stderr.is_empty());
    assert!(
        out.stdout.contains("Configuration is valid"),
        "{}",
        out.stdout
    );
    assert!(out.stdout.contains("development"), "{}", out.stdout);
    assert!(out.stdout.contains("0.0.0.0:8080"), "{}", out.stdout);
    assert!(out.stdout.contains("Warnings: none"), "{}", out.stdout);
    assert!(
        out.stdout.contains("Nothing was contacted"),
        "{}",
        out.stdout
    );
    for (name, _) in ok(&[]).features() {
        assert!(
            out.stdout.contains(name),
            "feature {name} listed:\n{}",
            out.stdout
        );
    }
    assert!(out.stdout.contains("[off] Card payments (Stripe)"));
}

#[test]
fn check_config_lists_what_is_on_and_the_warnings_without_failing() {
    let out = check(&[
        ("APP_ENV", "production"),
        ("STRIPE_ENABLED", "true"),
        ("STRIPE_SECRET_KEY", "sk_test_x"),
        ("PROXMOX_API_URL", "https://pve.example.com:8006/api2/json"),
    ]);
    // Warnings are not errors.
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    assert!(out.stderr.is_empty());
    assert!(
        out.stdout.contains("[on ] Card payments (Stripe)"),
        "{}",
        out.stdout
    );
    assert!(
        out.stdout.contains("[off] VPS provisioning (Proxmox)"),
        "{}",
        out.stdout
    );
    assert!(out.stdout.contains("Warnings ("), "{}", out.stdout);
    assert!(
        out.stdout.contains("STRIPE_WEBHOOK_SECRET"),
        "{}",
        out.stdout
    );
    assert!(out.stdout.contains("PROXMOX_TOKEN_ID"), "{}", out.stdout);
    assert!(out.stdout.contains("PUBLIC_APP_URL"), "{}", out.stdout);
}

#[test]
fn check_config_notes_the_env_file_and_fails_when_it_is_broken() {
    let env = env_with(&[]);
    let loaded = cli::check_config(
        |k| env.get(k).cloned(),
        &EnvFile::Loaded(PathBuf::from("/srv/artix/.env")),
    );
    assert_eq!(loaded.exit_code, 0);
    assert!(
        loaded.stdout.contains("loaded from /srv/artix/.env")
            || loaded.stdout.contains("loaded from \\srv\\artix\\.env"),
        "{}",
        loaded.stdout
    );

    // A `.env` that could not be read in full is a problem even when the rest is fine.
    let broken = cli::check_config(
        |k| env.get(k).cloned(),
        &EnvFile::Failed("a line could not be parsed".into()),
    );
    assert_eq!(broken.exit_code, 1);
    assert!(broken.stdout.is_empty());
    assert!(
        broken.stderr.contains(".env: a line could not be parsed"),
        "{}",
        broken.stderr
    );
    assert!(
        broken.stderr.contains("1 problem found"),
        "{}",
        broken.stderr
    );

    // ... and it is listed together with the configuration problems.
    let both = cli::check_config(|_| None, &EnvFile::Failed("could not be read".into()));
    assert_eq!(both.exit_code, 1);
    assert!(both.stderr.contains("3 problems found"), "{}", both.stderr);
}

#[test]
fn the_env_file_status_never_quotes_the_file() {
    let secret_line = format!("AUTH_TOKEN_SECRET=\"{MARKER}");
    let failed = EnvFile::from_dotenv(Err(dotenvy::Error::LineParse(secret_line, 22)));
    match failed {
        EnvFile::Failed(text) => {
            assert_no_marker("the .env status", &text);
            assert!(!text.contains("AUTH_TOKEN_SECRET"), "{text}");
            assert!(text.contains("could not be parsed"), "{text}");
        }
        other => panic!("expected Failed, got {other:?}"),
    }

    let not_found = std::io::Error::from(std::io::ErrorKind::NotFound);
    assert_eq!(
        EnvFile::from_dotenv(Err(dotenvy::Error::Io(not_found))),
        EnvFile::Missing
    );

    let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    match EnvFile::from_dotenv(Err(dotenvy::Error::Io(denied))) {
        EnvFile::Failed(text) => assert!(text.contains("could not be read"), "{text}"),
        other => panic!("expected Failed, got {other:?}"),
    }

    let path = PathBuf::from("/srv/artix/.env");
    assert_eq!(
        EnvFile::from_dotenv(Ok(path.clone())),
        EnvFile::Loaded(path)
    );
}

#[test]
fn arguments_are_parsed_strictly() {
    let none: [&str; 0] = [];
    assert_eq!(cli::parse_args(&none), Ok(Command::Serve));
    assert_eq!(
        cli::parse_args(&["--check-config"]),
        Ok(Command::CheckConfig)
    );
    assert_eq!(cli::parse_args(&["--help"]), Ok(Command::Help));
    assert_eq!(cli::parse_args(&["-h"]), Ok(Command::Help));

    for bad in [
        &["--check-conf"][..],
        &["--check-config", "extra"],
        &["check-config"],
        &["-x"],
        &["--"],
        &["--check-config", "--nope"],
    ] {
        let e = cli::parse_args(bad).expect_err(&format!("{bad:?} must be rejected"));
        assert!(!e.is_empty());
    }
    // The option name is echoed, a value glued to it is not.
    let e = cli::parse_args(&["--token=s3cr3t-value"]).unwrap_err();
    assert!(e.contains("--token") && !e.contains("s3cr3t"), "{e}");
    let e = cli::parse_args(&["s3cr3t-positional"]).unwrap_err();
    assert!(!e.contains("s3cr3t"), "{e}");

    assert!(cli::USAGE.contains("--check-config") && cli::USAGE.contains("docs/configuration.md"));
}
