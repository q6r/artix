//! MongoDB document models. These map 1:1 to collections.

use bson::oid::ObjectId;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserStatus {
    Active,
    Unverified,
    Suspended,
    Banned,
}

/// collection: `users`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub email: String,           // stored lowercased
    pub email_verified: bool,
    /// `None` for OAuth-only accounts that never set a password.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    pub display_name: String,
    /// Profile picture URL (from OAuth provider, e.g. Discord/GitHub).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub status: UserStatus,
    pub role_ids: Vec<ObjectId>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banned_reason: Option<String>,
    #[serde(default)]
    pub failed_login_attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub locked_until: Option<DateTime<Utc>>,
    /// GitHub OAuth token (sealed via `secretbox`) for repo access. Never
    /// serialized to clients (skipped when absent; not in `UserPublic`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_username: Option<String>,
}

/// collection: `roles`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub name: String, // unique slug, e.g. "super_admin"
    pub description: String,
    pub permissions: Vec<String>,
    pub system: bool, // built-in roles cannot be deleted
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

/// collection: `sessions`
///
/// `refresh_hash` is the hash of the *current* refresh token. On rotation we
/// replace it; presenting a hash that is not the current one means reuse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub refresh_hash: String,
    /// Incremented on every rotation; embedded in the access token as `ver`.
    pub token_version: u32,
    pub user_agent: String,
    pub ip: String,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub last_used_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_reason: Option<String>,
}

/// collection: `oauth_accounts`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthAccount {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub provider: String,         // "google" | "discord"
    pub provider_user_id: String, // stable id from the provider
    pub email: Option<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailTokenKind {
    Verification,
    PasswordReset,
    EmailChange,
    /// Passwordless login/registration: short numeric code sent by email.
    LoginCode,
}

/// collection: `email_verifications` / `password_resets` (kind discriminates)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailToken {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub kind: EmailTokenKind,
    pub token_hash: String,
    /// Target address for `EmailChange` tokens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_email: Option<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub expires_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub used_at: Option<DateTime<Utc>>,
}

/// collection: `api_keys` — programmatic access tokens for the dev API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub name: String,
    /// Public, non-secret prefix shown in listings (e.g. `ak_AbCdEf…`).
    pub prefix: String,
    /// `sha256(pepper || full_key)`. The full key is shown once at creation.
    pub key_hash: String,
    /// Empty = inherit all of the user's permissions; otherwise a subset.
    pub scopes: Vec<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub last_used_at: Option<DateTime<Utc>>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyPublic {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub scopes: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked: bool,
}

impl ApiKey {
    pub fn public(&self) -> ApiKeyPublic {
        ApiKeyPublic {
            id: self.id.unwrap_or_default().to_hex(),
            name: self.name.clone(),
            prefix: self.prefix.clone(),
            scopes: self.scopes.clone(),
            created_at: self.created_at,
            last_used_at: self.last_used_at,
            expires_at: self.expires_at,
            revoked: self.revoked,
        }
    }
}

/// collection: `oauth_exchanges` — short-lived, single-use codes that swap an
/// OAuth redirect for a session WITHOUT putting the refresh token in the URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthExchange {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub code_hash: String,
    pub user_id: ObjectId,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub expires_at: DateTime<Utc>,
    #[serde(
        default,
        with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub used_at: Option<DateTime<Utc>>,
}

/// collection: `backup_codes` — single-use alphanumeric codes that let a user
/// sign in when they can't receive the email code. Stored hashed; never recovered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupCode {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    /// `sha256(pepper || code)` (code uppercased).
    pub code_hash: String,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(
        default,
        with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub used_at: Option<DateTime<Utc>>,
}

/// collection: `admin_audit_logs`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub actor_id: ObjectId,
    pub action: String, // e.g. "users.ban"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<ObjectId>,
    pub metadata: bson::Document,
    pub ip: String,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

/// collection: `security_events`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEvent {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<ObjectId>,
    pub kind: String, // "login_failed" | "refresh_reuse" | "rate_limited" ...
    pub ip: String,
    pub user_agent: String,
    pub metadata: bson::Document,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    /// Subscribed but the first invoice has not been paid — not yet on Proxmox.
    PendingPayment,
    Provisioning,
    Running,
    Stopped,
    /// Subscription unpaid past its grace period; VM powered off.
    Suspended,
    Error,
    Deleting,
}

/// collection: `servers` — a VPS mapped to a Proxmox VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    /// Organization this server has been placed into (shared access), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_id: Option<ObjectId>,
    pub name: String,
    pub node: String,
    /// `None` until the VM is actually provisioned on Proxmox (paid flow).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vmid: Option<i64>,
    pub plan: String,
    pub os: String,
    pub state: ServerState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    /// Cloud-init SSH public key captured at subscribe time (public, not secret).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_init_ssh_key: Option<String>,
    /// Storage pool the VM's disk lives on (committed-capacity placement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage: Option<String>,
    /// Initial root password set via cloud-init at provision time. Shown once in
    /// the panel so the owner can copy it; only ever returned to that owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_password: Option<String>,
    /// Public SSH entrypoint via the frp relay (host + allocated port).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<i32>,
    pub specs: ServerSpecs,
    /// Product discriminator: 0 = VPS (Proxmox VM), 1 = Container (Docker agent).
    /// `#[serde(default)]` makes every existing VPS doc (which has no `type`
    /// field) deserialize as 0 — do NOT remove the default.
    #[serde(default, rename = "type")]
    pub server_type: i32,
    /// Container-specific sub-document. Absent/`None` for VPS docs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container: Option<Container>,
    /// When the VPS expires. `None` = lifetime (vitalícia). Setting/keeping this
    /// `None` requires the `nodes.lifetime` permission.
    #[serde(
        default,
        with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional"
    )]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSpecs {
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
}

/// Embedded container metadata (present only when `server_type == 1`). The agent
/// `app id` is always the Server `_id` hex; it is mirrored in `app_id` so we
/// never re-derive it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Container {
    /// "site" | "discord_bot" (phase-1 only creates "discord_bot").
    pub container_type: String,
    pub app_id: String,
    /// Reserved for the *.apps.artix.cloud wave. `None` for bots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdomain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// RAM cap in MB (containers track MB, not GB like VPS specs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ram_mb: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_log: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    /// Exposed internal port (sites, later). `None` for bots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<i32>,
    /// Last-known runtime status from the agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Environment variables (JSON object stored as a BSON sub-document).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<bson::Document>,
    /// True once a bundle has been deployed at least once.
    #[serde(default)]
    pub deployed: bool,
}

/// What the frontend sees for a container (no build_log/env in the projection).
#[derive(Debug, Clone, Serialize)]
pub struct ContainerPublic {
    pub container_type: String,
    pub app_id: String,
    pub runtime: Option<String>,
    pub version: Option<String>,
    pub ram_mb: Option<i64>,
    pub port: Option<i32>,
    pub status: Option<String>,
    pub subdomain: Option<String>,
    pub deployed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerPublic {
    pub id: String,
    pub name: String,
    pub state: ServerState,
    pub plan: String,
    pub os: String,
    pub ip: Option<String>,
    pub vmid: Option<i64>,
    pub org_id: Option<String>,
    /// Login user for the initial root password (always `root` when present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<i32>,
    pub specs: ServerSpecs,
    /// 0 = VPS, 1 = Container — lets the dashboard branch the UI.
    #[serde(rename = "type")]
    pub server_type: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<ContainerPublic>,
    /// Expiry timestamp, or `null` for a lifetime VPS.
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl Server {
    pub fn public(&self) -> ServerPublic {
        ServerPublic {
            id: self.id.unwrap_or_default().to_hex(),
            name: self.name.clone(),
            state: self.state,
            plan: self.plan.clone(),
            os: self.os.clone(),
            ip: self.ip.clone(),
            vmid: self.vmid,
            org_id: self.org_id.map(|o| o.to_hex()),
            root_user: self.root_password.as_ref().map(|_| "root".to_string()),
            root_password: self.root_password.clone(),
            ssh_host: self.ssh_host.clone(),
            ssh_port: self.ssh_port,
            specs: self.specs.clone(),
            server_type: self.server_type,
            container: self.container.as_ref().map(|c| ContainerPublic {
                container_type: c.container_type.clone(),
                app_id: c.app_id.clone(),
                runtime: c.runtime.clone(),
                version: c.version.clone(),
                ram_mb: c.ram_mb,
                port: c.port,
                status: c.status.clone(),
                subdomain: c.subdomain.clone(),
                deployed: c.deployed,
            }),
            expires_at: self.expires_at,
            created_at: self.created_at,
        }
    }
}

// ----------------------------- Plans -----------------------------

fn default_true() -> bool {
    true
}

/// collection: `plans` — an admin-managed billing plan (specs + monthly price).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    /// Stable customer-facing identifier used everywhere (e.g. "cloud4").
    pub slug: String,
    pub name: String,
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
    pub price_cents: i64,
    /// Whether the plan is offered to customers (admin can hide without deleting).
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub sort: i32,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanAdminView {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub vcpu: u16,
    pub ram_gb: u32,
    pub disk_gb: u32,
    pub price_cents: i64,
    pub active: bool,
    pub sort: i32,
}

impl Plan {
    pub fn admin_view(&self) -> PlanAdminView {
        PlanAdminView {
            id: self.id.unwrap_or_default().to_hex(),
            slug: self.slug.clone(),
            name: self.name.clone(),
            vcpu: self.vcpu,
            ram_gb: self.ram_gb,
            disk_gb: self.disk_gb,
            price_cents: self.price_cents,
            active: self.active,
            sort: self.sort,
        }
    }
}

// ----------------------------- Billing -----------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    /// Created; waiting for the first invoice to be paid.
    PendingPayment,
    Active,
    /// An invoice is open past its due date (within the grace window).
    PastDue,
    /// Unpaid beyond grace; the VM is powered off.
    Suspended,
    Cancelled,
}

/// collection: `subscriptions` — one recurring plan bound to one VPS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_id: Option<ObjectId>,
    pub plan: String,
    pub status: SubscriptionStatus,
    pub price_cents: i64,
    pub currency: String,
    pub interval: String, // "monthly"
    /// Payment provider used for this subscription ("pix" | "crypto"). Renewals
    /// reuse it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub current_period_start: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub current_period_end: Option<DateTime<Utc>>,
    #[serde(default)]
    pub cancel_at_period_end: bool,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    Open,
    Paid,
    Void,
    /// The PIX charge expired without payment.
    Expired,
    Uncollectible,
}

/// collection: `invoices` — a single charge for one billing period.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub subscription_id: ObjectId,
    pub number: String, // human-facing, e.g. "INV-2606-AB12CD"
    pub amount_cents: i64,
    pub currency: String,
    pub status: InvoiceStatus,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub period_start: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub period_end: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub due_date: DateTime<Utc>,
    /// PagCI payment id (`pay_…`) once a PIX charge has been created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payment_id: Option<String>,
    /// PIX copy-paste (BR Code) string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pix_code: Option<String>,
    /// PIX QR image (data URI / base64) when requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pix_qr_image: Option<String>,
    /// Payment provider for this invoice: "pix" | "crypto" | "stripe".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// LTC deposit address + amount (crypto provider).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crypto_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crypto_amount_ltc: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional"
    )]
    pub crypto_expires_at: Option<DateTime<Utc>>,
    /// Stripe hosted Checkout URL (when provider == "stripe").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stripe_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub paid_at: Option<DateTime<Utc>>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubscriptionPublic {
    pub id: String,
    pub server_id: Option<String>,
    pub plan: String,
    pub status: SubscriptionStatus,
    pub price_cents: i64,
    pub currency: String,
    pub interval: String,
    pub current_period_end: Option<DateTime<Utc>>,
    pub cancel_at_period_end: bool,
    pub created_at: DateTime<Utc>,
}

impl Subscription {
    pub fn public(&self) -> SubscriptionPublic {
        SubscriptionPublic {
            id: self.id.unwrap_or_default().to_hex(),
            server_id: self.server_id.map(|s| s.to_hex()),
            plan: self.plan.clone(),
            status: self.status,
            price_cents: self.price_cents,
            currency: self.currency.clone(),
            interval: self.interval.clone(),
            current_period_end: self.current_period_end,
            cancel_at_period_end: self.cancel_at_period_end,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InvoicePublic {
    pub id: String,
    pub subscription_id: String,
    pub number: String,
    pub amount_cents: i64,
    pub currency: String,
    pub status: InvoiceStatus,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub due_date: DateTime<Utc>,
    pub pix_code: Option<String>,
    pub pix_qr_image: Option<String>,
    pub provider: Option<String>,
    pub crypto_address: Option<String>,
    pub crypto_amount_ltc: Option<f64>,
    pub crypto_expires_at: Option<DateTime<Utc>>,
    pub stripe_url: Option<String>,
    pub paid_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl Invoice {
    pub fn public(&self) -> InvoicePublic {
        InvoicePublic {
            id: self.id.unwrap_or_default().to_hex(),
            subscription_id: self.subscription_id.to_hex(),
            number: self.number.clone(),
            amount_cents: self.amount_cents,
            currency: self.currency.clone(),
            status: self.status,
            period_start: self.period_start,
            period_end: self.period_end,
            due_date: self.due_date,
            pix_code: self.pix_code.clone(),
            pix_qr_image: self.pix_qr_image.clone(),
            provider: self.provider.clone(),
            crypto_address: self.crypto_address.clone(),
            crypto_amount_ltc: self.crypto_amount_ltc,
            crypto_expires_at: self.crypto_expires_at,
            stripe_url: self.stripe_url.clone(),
            paid_at: self.paid_at,
            created_at: self.created_at,
        }
    }
}

// ----------------------------- Organizations -----------------------------

/// collection: `organizations`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub owner_id: ObjectId,
    pub name: String,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrgRole {
    Owner,
    Admin,
    Member,
}

/// collection: `org_members` — a user's membership in an organization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgMember {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub org_id: ObjectId,
    pub user_id: ObjectId,
    pub role: OrgRole,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

/// collection: `server_grants` — a member's permissions on ONE server shared
/// into an org. Owner/admin of the org bypass this (full access).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerGrant {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub org_id: ObjectId,
    pub server_id: ObjectId,
    pub user_id: ObjectId,
    /// Subset of `server_perm::*` (view/power/console/metrics/delete/manage).
    pub perms: Vec<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgPublic {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub role: OrgRole, // the requesting user's role
    pub member_count: u64,
    pub server_count: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrgMemberPublic {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
    pub role: OrgRole,
    /// server_id -> granted perms (empty for owner/admin who have full access).
    pub grants: std::collections::HashMap<String, Vec<String>>,
}

// ----------------------------- Support tickets -----------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TicketStatus {
    Open,
    Pending,
    Closed,
}

/// collection: `tickets`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticket {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub subject: String,
    pub status: TicketStatus,
    /// Category slug (e.g. "financeiro"); gates which staff can handle it.
    #[serde(default)]
    pub category: Option<String>,
    /// Staff member currently handling the ticket (set on "iniciar atendimento").
    #[serde(default)]
    pub assignee_id: Option<ObjectId>,
    /// Extra users (besides the owner) with access to the ticket.
    #[serde(default)]
    pub members: Vec<ObjectId>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

/// collection: `ticket_messages`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketMessage {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub ticket_id: ObjectId,
    pub author_id: ObjectId,
    pub body: String,
    pub is_staff: bool,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

/// A lightweight reference to a user, embedded in ticket payloads.
#[derive(Debug, Clone, Serialize)]
pub struct UserRef {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub avatar_url: Option<String>,
}

impl UserRef {
    pub fn of(u: &User) -> Self {
        let id = u.id.unwrap_or_default().to_hex();
        UserRef {
            // Never expose the raw provider URL (it expires) — point at the
            // server-side avatar proxy, which fetches + caches on demand.
            avatar_url: u
                .avatar_url
                .as_ref()
                .map(|_| format!("/api/avatar/{id}")),
            display_name: u.display_name.clone(),
            email: u.email.clone(),
            id,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TicketPublic {
    pub id: String,
    pub subject: String,
    pub status: TicketStatus,
    pub category: Option<String>,
    /// The user who opened the ticket.
    pub owner: Option<UserRef>,
    /// Staff member handling the ticket, if any.
    pub assignee: Option<UserRef>,
    /// Extra users with access to the ticket.
    #[serde(default)]
    pub members: Vec<UserRef>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TicketMessagePublic {
    pub id: String,
    pub author_id: String,
    pub body: String,
    pub is_staff: bool,
    pub created_at: DateTime<Utc>,
}

/// collection: `ticket_categories` — admin-managed ticket types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketCategory {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    /// URL/permission-safe identifier, e.g. "financeiro".
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TicketCategoryPublic {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub color: Option<String>,
}

impl TicketCategory {
    pub fn public(&self) -> TicketCategoryPublic {
        TicketCategoryPublic {
            id: self.id.unwrap_or_default().to_hex(),
            slug: self.slug.clone(),
            name: self.name.clone(),
            color: self.color.clone(),
        }
    }
}

impl Ticket {
    pub fn public(&self) -> TicketPublic {
        TicketPublic {
            id: self.id.unwrap_or_default().to_hex(),
            subject: self.subject.clone(),
            status: self.status,
            category: self.category.clone(),
            owner: None,
            assignee: None,
            members: Vec::new(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

impl TicketMessage {
    pub fn public(&self) -> TicketMessagePublic {
        TicketMessagePublic {
            id: self.id.unwrap_or_default().to_hex(),
            author_id: self.author_id.to_hex(),
            body: self.body.clone(),
            is_staff: self.is_staff,
            created_at: self.created_at,
        }
    }
}

// ----------------------------- Announcements -----------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnnouncementKind {
    /// A dismissible bar pinned to the top of the page.
    Banner,
    /// A centered dialog shown over the page.
    Modal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnnouncementScope {
    /// Every page of the app.
    Global,
    /// Only `/dashboard*`.
    Dashboard,
    /// Only the listed paths (prefix match).
    Pages,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ButtonColor {
    Blue,
    Red,
    Gray,
    Green,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementButton {
    pub label: String,
    pub url: String,
    pub color: ButtonColor,
}

/// collection: `announcements`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Announcement {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub kind: AnnouncementKind,
    pub scope: AnnouncementScope,
    /// Paths used when `scope == Pages` (prefix-matched on the client).
    #[serde(default)]
    pub pages: Vec<String>,
    pub title: String,
    /// Supports `**bold**` and `[text](url)` (rendered by a small client parser).
    pub description: String,
    #[serde(default)]
    pub buttons: Vec<AnnouncementButton>,
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<ObjectId>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnnouncementPublic {
    pub id: String,
    pub kind: AnnouncementKind,
    pub scope: AnnouncementScope,
    pub pages: Vec<String>,
    pub title: String,
    pub description: String,
    pub buttons: Vec<AnnouncementButton>,
    pub active: bool,
    pub updated_at: DateTime<Utc>,
}

impl Announcement {
    pub fn public(&self) -> AnnouncementPublic {
        AnnouncementPublic {
            id: self.id.unwrap_or_default().to_hex(),
            kind: self.kind,
            scope: self.scope,
            pages: self.pages.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            buttons: self.buttons.clone(),
            active: self.active,
            updated_at: self.updated_at,
        }
    }
}

/// Public, safe representation of a user for API responses.
#[derive(Debug, Clone, Serialize)]
pub struct UserPublic {
    pub id: String,
    pub email: String,
    pub email_verified: bool,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub status: UserStatus,
    pub permissions: Vec<String>,
    /// Linked social accounts (for the settings "Connections" UI).
    #[serde(default)]
    pub discord_linked: bool,
    #[serde(default)]
    pub github_linked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_username: Option<String>,
}

/// collection: `relay_settings` — admin override of a config relay's state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelaySetting {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DedicatedIpStatus {
    PendingPayment,
    PendingAssignment,
    Active,
    Cancelled,
}

/// collection: `dedicated_ips` — a paid add-on for a VPS. The admin manually
/// routes (assigns) the IP after payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DedicatedIp {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub server_id: ObjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_id: Option<ObjectId>,
    pub status: DedicatedIpStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    pub price_cents: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub assigned_at: Option<DateTime<Utc>>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DedicatedIpPublic {
    pub id: String,
    pub server_id: String,
    pub status: DedicatedIpStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    pub price_cents: i64,
}

impl DedicatedIp {
    pub fn public(&self) -> DedicatedIpPublic {
        DedicatedIpPublic {
            id: self.id.map(|o| o.to_hex()).unwrap_or_default(),
            server_id: self.server_id.to_hex(),
            status: self.status,
            ip_address: self.ip_address.clone(),
            price_cents: self.price_cents,
        }
    }
}

/// collection: `notifications` — in-app dashboard notifications (the bell).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub kind: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub read: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationPublic {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Notification {
    pub fn public(&self) -> NotificationPublic {
        NotificationPublic {
            id: self.id.map(|o| o.to_hex()).unwrap_or_default(),
            kind: self.kind.clone(),
            title: self.title.clone(),
            body: self.body.clone(),
            read: self.read,
            link: self.link.clone(),
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpgradeStatus {
    PendingPayment,
    Applied,
    Cancelled,
}

/// collection: `upgrades` — a paid RAM/disk increase, applied to the VM on payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Upgrade {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub user_id: ObjectId,
    pub server_id: ObjectId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_id: Option<ObjectId>,
    pub status: UpgradeStatus,
    pub add_ram_gb: u32,
    pub add_disk_gb: u32,
    pub price_cents: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime_optional")]
    pub applied_at: Option<DateTime<Utc>>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "bson::serde_helpers::chrono_datetime_as_bson_datetime")]
    pub updated_at: DateTime<Utc>,
}
