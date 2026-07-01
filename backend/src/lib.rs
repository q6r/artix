pub mod agent;
pub mod auth;
pub mod authn;
pub mod billing;
pub mod config;
pub mod crypto;
pub mod db;
pub mod email;
pub mod error;
pub mod frp;
pub mod handlers;
pub mod stripe;
pub mod notify;
pub mod headers;
pub mod models;
pub mod oauth;
pub mod pagci;
pub mod permissions;
pub mod proxmox;
pub mod ratelimit;
pub mod security;
pub mod state;
pub mod storage;
pub mod ws;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderName, HeaderValue, Method},
    middleware::from_fn_with_state,
    routing::{delete, get, patch, post, put},
    Router,
};
use bson::doc;
use chrono::Utc;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{db::Collections, models::Role, state::AppState};

/// Seeds the built-in `super_admin` role (idempotent).
pub async fn seed(state: &AppState) -> mongodb::error::Result<()> {
    if state
        .db
        .roles()
        .find_one(doc! { "name": "super_admin" })
        .await?
        .is_none()
    {
        let now = Utc::now();
        state
            .db
            .roles()
            .insert_one(&Role {
                id: None,
                name: "super_admin".into(),
                description: "Full access".into(),
                permissions: vec!["*".into()],
                system: true,
                created_at: now,
                updated_at: now,
            })
            .await?;
        tracing::info!("seeded super_admin role");
    }

    // Seed the default billing plans on first run (afterwards admin-managed).
    if state.db.plans().count_documents(doc! {}).await? == 0 {
        let now = Utc::now();
        let docs: Vec<models::Plan> = crate::billing::DEFAULT_PLANS
            .iter()
            .enumerate()
            .map(|(i, p)| models::Plan {
                id: None,
                slug: p.id.to_string(),
                name: p.id.to_uppercase(),
                vcpu: p.vcpu,
                ram_gb: p.ram_gb,
                disk_gb: p.disk_gb,
                price_cents: p.price_cents,
                active: true,
                sort: i as i32,
                created_at: now,
                updated_at: now,
            })
            .collect();
        state.db.plans().insert_many(&docs).await?;
        tracing::info!("seeded {} default plans", docs.len());
    }
    Ok(())
}

pub fn build_router(state: AppState) -> Router {
    let auth_routes = Router::new()
        // Passwordless: 6-digit code by email (registration == login).
        .route("/request-code", post(handlers::auth::request_code))
        .route("/verify-code", post(handlers::auth::verify_code))
        .route("/refresh", post(handlers::auth::refresh))
        .route("/logout", post(handlers::auth::logout))
        .route("/logout-all", post(handlers::auth::logout_all))
        .route("/me", get(handlers::auth::me).patch(handlers::auth::update_profile))
        .route("/verify-backup-code", post(handlers::backup::verify))
        .route(
            "/backup-codes",
            get(handlers::backup::status)
                .post(handlers::backup::generate)
                .delete(handlers::backup::disable),
        )
        .route("/verify-email", post(handlers::auth::verify_email))
        .route("/resend-verification", post(handlers::auth::resend_verification))
        .route("/change-email", post(handlers::auth::change_email))
        .route(
            "/confirm-email-change",
            post(handlers::auth::confirm_email_change),
        )
        .layer(from_fn_with_state(state.clone(), ratelimit::auth_limiter));

    let oauth_routes = Router::new()
        .route("/:provider/start", get(handlers::oauth::start))
        .route("/:provider/callback", get(handlers::oauth::callback))
        .route("/:provider/link", post(handlers::oauth::link))
        .route("/:provider/unlink", delete(handlers::oauth::unlink))
        .route("/exchange", post(handlers::oauth::exchange));

    let admin_routes = Router::new()
        .route("/users", get(handlers::admin::list_users))
        .route(
            "/users/:id",
            get(handlers::admin::get_user)
                .patch(handlers::admin::patch_user)
                .delete(handlers::admin::delete_user),
        )
        .route("/users/:id/ban", post(handlers::admin::ban_user))
        .route("/users/:id/unban", post(handlers::admin::unban_user))
        .route("/users/:id/suspend", post(handlers::admin::suspend_user))
        .route("/users/:id/unsuspend", post(handlers::admin::unsuspend_user))
        .route("/users/:id/roles", post(handlers::admin::assign_role))
        .route("/users/:id/roles/:role_id", delete(handlers::admin::remove_role))
        .route(
            "/roles",
            get(handlers::admin::list_roles).post(handlers::admin::create_role),
        )
        .route(
            "/roles/:id",
            delete(handlers::admin::delete_role).patch(handlers::admin::update_role),
        )
        .route("/audit-logs", get(handlers::admin::list_audit_logs))
        .route("/security-events", get(handlers::admin::list_security_events))
        .route("/nodes", get(handlers::admin::list_nodes))
        .route("/nodes/:node", get(handlers::admin::get_node))
        .route(
            "/plans",
            get(handlers::admin_plans::list).post(handlers::admin_plans::create),
        )
        .route(
            "/plans/:id",
            patch(handlers::admin_plans::update).delete(handlers::admin_plans::delete),
        )
        .route("/relays", get(handlers::admin_relays::list))
        .route("/relays/:name", patch(handlers::admin_relays::set_enabled))
        .route("/storage", get(handlers::admin_storage::list))
        .route("/dedicated-ips", get(handlers::dedicated_ip::admin_list))
        .route("/dedicated-ips/:id", patch(handlers::dedicated_ip::admin_assign))
        .route("/subscriptions", get(handlers::billing::admin_list_subscriptions))
        .route("/invoices", get(handlers::billing::admin_list_invoices))
        .route("/invoices/:id/mark-paid", post(handlers::billing::admin_mark_paid))
        .route(
            "/servers",
            get(handlers::admin_servers::list_servers)
                .post(handlers::admin_servers::create_server),
        )
        .route(
            "/servers/:id",
            patch(handlers::admin_servers::update_server)
                .delete(handlers::admin_servers::delete_server),
        )
        .route("/tickets", get(handlers::tickets::admin_list))
        .route("/tickets/:id", get(handlers::tickets::admin_get))
        .route("/tickets/:id/messages", post(handlers::tickets::admin_reply))
        .route("/tickets/:id/status", patch(handlers::tickets::admin_set_status))
        .route(
            "/ticket-categories",
            post(handlers::tickets::create_category),
        )
        .route(
            "/ticket-categories/:id",
            delete(handlers::tickets::delete_category),
        )
        .route(
            "/announcements",
            get(handlers::announcements::list).post(handlers::announcements::create),
        )
        .route(
            "/announcements/:id",
            patch(handlers::announcements::update).delete(handlers::announcements::delete),
        )
        .route("/permissions", get(handlers::admin::list_permissions));

    let cors_origins: Vec<HeaderValue> = state
        .cfg
        .cors_origins
        .iter()
        .filter_map(|o| o.parse::<HeaderValue>().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(cors_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("x-api-key"),
        ]);

    // Developer API authenticated by API key (`X-API-Key` / `Bearer ak_…`).
    let dev_routes = Router::new()
        .route("/whoami", get(handlers::dev::whoami))
        .route("/ping", get(handlers::dev::ping));

    Router::new()
        .route("/health", get(handlers::health::health))
        .route("/ready", get(handlers::health::ready))
        // Public avatar proxy (cached image bytes; provider URL never leaves the server).
        .route("/avatar/:id", get(handlers::avatar::avatar))
        .nest("/auth", auth_routes)
        .nest("/oauth", oauth_routes)
        .nest("/admin", admin_routes)
        .route("/sessions", get(handlers::sessions::list))
        .route("/sessions/:id", delete(handlers::sessions::revoke))
        .route(
            "/servers",
            get(handlers::servers::list).post(handlers::servers::create),
        )
        // No user-facing destroy — users can format (reinstall) but not delete a
        // VPS. Destruction is admin-only (`DELETE /admin/servers/:id`).
        .route("/servers/:id", get(handlers::servers::get))
        .route("/servers/:id/power", post(handlers::servers::power))
        .route(
            "/servers/:id/root-password",
            post(handlers::servers::reset_root_password),
        )
        .route(
            "/servers/:id/reinstall",
            post(handlers::servers::reinstall),
        )
        .route("/servers/:id/metrics", get(handlers::servers::metrics))
        .route("/servers/:id/console", get(handlers::servers::console))
        // VPS file manager + command console (over the guest agent).
        .route(
            "/servers/:id/files",
            get(handlers::vm_agent::list)
                .post(handlers::vm_agent::create)
                .delete(handlers::vm_agent::delete),
        )
        .route(
            "/servers/:id/files/content",
            get(handlers::vm_agent::read).post(handlers::vm_agent::write),
        )
        .route("/servers/:id/files/move", post(handlers::vm_agent::mv))
        .route("/servers/:id/exec", post(handlers::vm_agent::console_exec))
        .route("/servers/:id/disk", get(handlers::vm_agent::disk_usage))
        .route(
            "/servers/:id/dedicated-ip",
            get(handlers::dedicated_ip::get).post(handlers::dedicated_ip::buy),
        )
        .route("/servers/:id/upgrade", post(handlers::upgrade::buy))
        // Containers (server_type = 1). Ownership via the same access()/server_perm.
        .route(
            "/containers",
            get(handlers::containers::list).post(handlers::containers::create),
        )
        .route(
            "/containers/:id",
            get(handlers::containers::get).delete(handlers::containers::delete),
        )
        .route("/containers/:id/status", get(handlers::containers::status))
        .route("/containers/:id/stats", get(handlers::containers::stats))
        .route("/containers/:id/logs", get(handlers::containers::logs))
        .route("/containers/:id/action", post(handlers::containers::action))
        .route(
            "/containers/:id/env",
            get(handlers::containers::get_env).put(handlers::containers::set_env),
        )
        // Deploy uploads a zip; raise the body cap for THIS route only (the
        // global DefaultBodyLimit still guards everything else).
        .route(
            "/containers/:id/deploy",
            post(handlers::containers::deploy).layer(DefaultBodyLimit::max(100 * 1024 * 1024)),
        )
        .route(
            "/keys",
            get(handlers::keys::list).post(handlers::keys::create),
        )
        .route("/keys/:id", delete(handlers::keys::revoke))
        .route("/notifications", get(handlers::notifications::list))
        .route("/notifications/read", post(handlers::notifications::mark_read))
        .nest("/v1", dev_routes)
        // Billing (subscriptions + invoices + PIX).
        .route("/billing/plans", get(handlers::billing::list_plans))
        .route(
            "/billing/subscriptions",
            get(handlers::billing::list_subscriptions).post(handlers::billing::create_subscription),
        )
        .route(
            "/billing/subscriptions/:id",
            get(handlers::billing::get_subscription),
        )
        .route(
            "/billing/subscriptions/:id/cancel",
            post(handlers::billing::cancel_subscription),
        )
        .route("/billing/invoices", get(handlers::billing::list_invoices))
        .route("/billing/invoices/:id", get(handlers::billing::get_invoice))
        .route(
            "/billing/invoices/:id/pay",
            post(handlers::billing::pay_invoice),
        )
        // Organizations (multi-tenancy + per-server grants).
        .route(
            "/orgs",
            get(handlers::orgs::list).post(handlers::orgs::create),
        )
        .route(
            "/orgs/:id",
            get(handlers::orgs::get)
                .patch(handlers::orgs::update)
                .delete(handlers::orgs::delete),
        )
        .route("/orgs/:id/members", post(handlers::orgs::add_member))
        .route(
            "/orgs/:id/members/:user_id",
            patch(handlers::orgs::update_member).delete(handlers::orgs::remove_member),
        )
        .route("/orgs/:id/servers", post(handlers::orgs::add_server))
        .route(
            "/orgs/:id/servers/:server_id",
            delete(handlers::orgs::remove_server),
        )
        .route(
            "/orgs/:id/servers/:server_id/grants/:user_id",
            put(handlers::orgs::set_grant).delete(handlers::orgs::delete_grant),
        )
        // Support tickets.
        .route(
            "/tickets",
            get(handlers::tickets::list).post(handlers::tickets::create),
        )
        .route(
            "/ticket-categories",
            get(handlers::tickets::list_categories),
        )
        .route("/tickets/:id", get(handlers::tickets::get))
        .route("/tickets/:id/messages", post(handlers::tickets::reply))
        .route("/tickets/:id/close", post(handlers::tickets::close))
        .route("/tickets/:id/members", post(handlers::tickets::add_member))
        .route(
            "/tickets/:id/members/:uid",
            delete(handlers::tickets::remove_member),
        )
        .route(
            "/tickets/:id/assign",
            post(handlers::tickets::assign).delete(handlers::tickets::unassign),
        )
        // Active site announcements (public — the client filters by path).
        .route("/announcements", get(handlers::announcements::list_active))
        // Inbound provider webhook (HMAC-verified, no session auth).
        .route("/webhooks/pagci", post(handlers::webhooks::pagci))
        .route("/webhooks/stripe", post(handlers::webhooks::stripe))
        // Real-time gateway: ticket (authed) + WebSocket upgrade (ticket-authed).
        .route("/ws/ticket", get(ws::ticket))
        .route("/ws", get(ws::upgrade))
        // xterm.js serial terminal: backend WS proxy to the Proxmox console.
        .route("/ws/term/:id", get(handlers::term::term_proxy))
        .layer(from_fn_with_state(state.clone(), ratelimit::global_limiter))
        .layer(from_fn_with_state(state.clone(), headers::security_headers))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Per-route-overridable default body cap (the container deploy route
        // raises it). Extractors (Json/Multipart/Bytes) enforce it.
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state)
}
