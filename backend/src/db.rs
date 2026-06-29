//! MongoDB connection + index bootstrap.
//!
//! Indexes (and why they matter):
//! - users.email (unique)        -> one account per email, fast login lookup.
//! - oauth (provider+uid) unique -> link a provider identity to exactly one user.
//! - sessions.refresh_hash uniq  -> O(1) refresh lookup; uniqueness blocks dupes.
//! - sessions.user_id            -> list/revoke all sessions of a user.
//! - sessions.expires_at TTL     -> Mongo auto-purges expired sessions.
//! - email_tokens.token_hash     -> O(1) verify/reset lookup.
//! - email_tokens.expires_at TTL -> auto-purge expired tokens.
//! - roles.name (unique)         -> stable role slugs.
//! - audit/security created_at   -> time-range queries for the admin panel.

use bson::doc;
use mongodb::{
    options::IndexOptions, results::CreateIndexResult, Client, Database, IndexModel,
};

use crate::config::Config;
use crate::models::*;

pub async fn connect(cfg: &Config) -> mongodb::error::Result<Database> {
    let client = Client::with_uri_str(&cfg.mongo_uri).await?;
    let db = client.database(&cfg.mongo_db);
    // Fail fast if the server is unreachable.
    db.run_command(doc! { "ping": 1 }).await?;
    Ok(db)
}

async fn unique(
    db: &Database,
    coll: &str,
    keys: bson::Document,
) -> mongodb::error::Result<CreateIndexResult> {
    let model = IndexModel::builder()
        .keys(keys)
        .options(IndexOptions::builder().unique(true).build())
        .build();
    db.collection::<bson::Document>(coll).create_index(model).await
}

async fn index(
    db: &Database,
    coll: &str,
    keys: bson::Document,
) -> mongodb::error::Result<CreateIndexResult> {
    db.collection::<bson::Document>(coll)
        .create_index(IndexModel::builder().keys(keys).build())
        .await
}

async fn ttl(db: &Database, coll: &str, field: &str) -> mongodb::error::Result<CreateIndexResult> {
    let model = IndexModel::builder()
        .keys(doc! { field: 1 })
        .options(
            IndexOptions::builder()
                .expire_after(std::time::Duration::from_secs(0))
                .build(),
        )
        .build();
    db.collection::<bson::Document>(coll).create_index(model).await
}

/// Unique only over documents that actually have the field (sparse), so many
/// pending servers without a `vmid` can coexist.
async fn unique_sparse(
    db: &Database,
    coll: &str,
    keys: bson::Document,
) -> mongodb::error::Result<CreateIndexResult> {
    let model = IndexModel::builder()
        .keys(keys)
        .options(IndexOptions::builder().unique(true).sparse(true).build())
        .build();
    db.collection::<bson::Document>(coll).create_index(model).await
}

pub async fn ensure_indexes(db: &Database) -> mongodb::error::Result<()> {
    unique(db, "users", doc! { "email": 1 }).await?;

    unique(db, "oauth_accounts", doc! { "provider": 1, "provider_user_id": 1 }).await?;
    index(db, "oauth_accounts", doc! { "user_id": 1 }).await?;

    unique(db, "sessions", doc! { "refresh_hash": 1 }).await?;
    index(db, "sessions", doc! { "user_id": 1 }).await?;
    ttl(db, "sessions", "expires_at").await?;

    index(db, "email_tokens", doc! { "token_hash": 1 }).await?;
    index(db, "email_tokens", doc! { "user_id": 1, "kind": 1 }).await?;
    ttl(db, "email_tokens", "expires_at").await?;

    unique(db, "roles", doc! { "name": 1 }).await?;

    index(db, "admin_audit_logs", doc! { "created_at": -1 }).await?;
    index(db, "admin_audit_logs", doc! { "actor_id": 1, "created_at": -1 }).await?;

    index(db, "security_events", doc! { "created_at": -1 }).await?;
    index(db, "security_events", doc! { "user_id": 1, "created_at": -1 }).await?;

    unique_sparse(db, "servers", doc! { "vmid": 1 }).await?;
    // Prevents two VPS from sharing a relay host+port (cross-tenant SSH).
    unique_sparse(db, "servers", doc! { "ssh_host": 1, "ssh_port": 1 }).await?;
    index(db, "servers", doc! { "user_id": 1 }).await?;

    unique(db, "api_keys", doc! { "key_hash": 1 }).await?;
    index(db, "api_keys", doc! { "user_id": 1 }).await?;
    ttl(db, "api_keys", "expires_at").await?;

    index(db, "subscriptions", doc! { "user_id": 1 }).await?;
    index(db, "subscriptions", doc! { "status": 1, "current_period_end": 1 }).await?;
    index(db, "subscriptions", doc! { "server_id": 1 }).await?;

    unique(db, "invoices", doc! { "number": 1 }).await?;
    index(db, "invoices", doc! { "user_id": 1, "created_at": -1 }).await?;
    index(db, "invoices", doc! { "subscription_id": 1 }).await?;
    index(db, "invoices", doc! { "status": 1, "due_date": 1 }).await?;
    // Webhook lookup by PagCI payment id.
    unique_sparse(db, "invoices", doc! { "payment_id": 1 }).await?;

    index(db, "organizations", doc! { "owner_id": 1 }).await?;

    unique(db, "org_members", doc! { "org_id": 1, "user_id": 1 }).await?;
    index(db, "org_members", doc! { "user_id": 1 }).await?;

    unique(db, "server_grants", doc! { "server_id": 1, "user_id": 1 }).await?;
    index(db, "server_grants", doc! { "org_id": 1 }).await?;
    index(db, "server_grants", doc! { "user_id": 1 }).await?;
    index(db, "servers", doc! { "org_id": 1 }).await?;

    index(db, "backup_codes", doc! { "user_id": 1 }).await?;

    index(db, "oauth_exchanges", doc! { "code_hash": 1 }).await?;
    ttl(db, "oauth_exchanges", "expires_at").await?;

    index(db, "announcements", doc! { "active": 1, "created_at": -1 }).await?;

    unique(db, "ticket_categories", doc! { "slug": 1 }).await?;

    index(db, "tickets", doc! { "user_id": 1, "updated_at": -1 }).await?;
    index(db, "tickets", doc! { "status": 1, "updated_at": -1 }).await?;
    index(db, "ticket_messages", doc! { "ticket_id": 1, "created_at": 1 }).await?;

    Ok(())
}

/// Typed collection accessors keep handlers/repos honest.
pub trait Collections {
    fn users(&self) -> mongodb::Collection<User>;
    fn sessions(&self) -> mongodb::Collection<Session>;
    fn roles(&self) -> mongodb::Collection<Role>;
    fn oauth_accounts(&self) -> mongodb::Collection<OAuthAccount>;
    fn email_tokens(&self) -> mongodb::Collection<EmailToken>;
    fn audit_logs(&self) -> mongodb::Collection<AuditLog>;
    fn security_events(&self) -> mongodb::Collection<SecurityEvent>;
    fn servers(&self) -> mongodb::Collection<Server>;
    fn api_keys(&self) -> mongodb::Collection<ApiKey>;
    fn subscriptions(&self) -> mongodb::Collection<Subscription>;
    fn invoices(&self) -> mongodb::Collection<Invoice>;
    fn organizations(&self) -> mongodb::Collection<Organization>;
    fn org_members(&self) -> mongodb::Collection<OrgMember>;
    fn server_grants(&self) -> mongodb::Collection<ServerGrant>;
    fn tickets(&self) -> mongodb::Collection<Ticket>;
    fn ticket_messages(&self) -> mongodb::Collection<TicketMessage>;
    fn ticket_categories(&self) -> mongodb::Collection<TicketCategory>;
    fn backup_codes(&self) -> mongodb::Collection<BackupCode>;
    fn oauth_exchanges(&self) -> mongodb::Collection<OAuthExchange>;
    fn announcements(&self) -> mongodb::Collection<Announcement>;
    fn plans(&self) -> mongodb::Collection<Plan>;
    fn relay_settings(&self) -> mongodb::Collection<RelaySetting>;
    fn dedicated_ips(&self) -> mongodb::Collection<DedicatedIp>;
}

impl Collections for Database {
    fn users(&self) -> mongodb::Collection<User> {
        self.collection("users")
    }
    fn sessions(&self) -> mongodb::Collection<Session> {
        self.collection("sessions")
    }
    fn roles(&self) -> mongodb::Collection<Role> {
        self.collection("roles")
    }
    fn oauth_accounts(&self) -> mongodb::Collection<OAuthAccount> {
        self.collection("oauth_accounts")
    }
    fn email_tokens(&self) -> mongodb::Collection<EmailToken> {
        self.collection("email_tokens")
    }
    fn audit_logs(&self) -> mongodb::Collection<AuditLog> {
        self.collection("admin_audit_logs")
    }
    fn security_events(&self) -> mongodb::Collection<SecurityEvent> {
        self.collection("security_events")
    }
    fn servers(&self) -> mongodb::Collection<Server> {
        self.collection("servers")
    }
    fn api_keys(&self) -> mongodb::Collection<ApiKey> {
        self.collection("api_keys")
    }
    fn subscriptions(&self) -> mongodb::Collection<Subscription> {
        self.collection("subscriptions")
    }
    fn invoices(&self) -> mongodb::Collection<Invoice> {
        self.collection("invoices")
    }
    fn organizations(&self) -> mongodb::Collection<Organization> {
        self.collection("organizations")
    }
    fn org_members(&self) -> mongodb::Collection<OrgMember> {
        self.collection("org_members")
    }
    fn server_grants(&self) -> mongodb::Collection<ServerGrant> {
        self.collection("server_grants")
    }
    fn tickets(&self) -> mongodb::Collection<Ticket> {
        self.collection("tickets")
    }
    fn ticket_messages(&self) -> mongodb::Collection<TicketMessage> {
        self.collection("ticket_messages")
    }
    fn ticket_categories(&self) -> mongodb::Collection<TicketCategory> {
        self.collection("ticket_categories")
    }
    fn backup_codes(&self) -> mongodb::Collection<BackupCode> {
        self.collection("backup_codes")
    }
    fn oauth_exchanges(&self) -> mongodb::Collection<OAuthExchange> {
        self.collection("oauth_exchanges")
    }
    fn announcements(&self) -> mongodb::Collection<Announcement> {
        self.collection("announcements")
    }
    fn plans(&self) -> mongodb::Collection<Plan> {
        self.collection("plans")
    }
    fn relay_settings(&self) -> mongodb::Collection<RelaySetting> {
        self.collection("relay_settings")
    }
    fn dedicated_ips(&self) -> mongodb::Collection<DedicatedIp> {
        self.collection("dedicated_ips")
    }
}
