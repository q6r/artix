//! Admin VPS management: list every server (with owner), provision a VPS for a
//! user, reassign ownership, and destroy a VPS. EVERY handler starts with an
//! explicit permission check (`nodes.read` to view, `nodes.manage` to mutate).

use std::collections::{BTreeSet, HashMap};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use bson::{doc, oid::ObjectId, Bson};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    billing,
    db::Collections,
    email,
    error::{AppError, AppResult},
    models::{Server, ServerPublic, ServerState, UserRef},
    permissions::perm,
    proxmox::PowerAction,
    security,
    state::AppState,
};

/// Parse an expiry from an ISO datetime or a `YYYY-MM-DD` date (end of that day).
fn parse_expiry(s: &str) -> AppResult<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Ok(dt.with_timezone(&Utc));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        if let Some(ndt) = d.and_hms_opt(23, 59, 59) {
            return Ok(DateTime::from_naive_utc_and_offset(ndt, Utc));
        }
    }
    Err(AppError::Validation("invalid expiry date".into()))
}

/// Resolve the expiry for a create: a missing date (or explicit `lifetime`) means
/// a lifetime VPS, which requires the `nodes.lifetime` permission.
fn resolve_expiry(
    auth: &AuthUser,
    lifetime: Option<bool>,
    expires_at: &Option<String>,
) -> AppResult<Option<DateTime<Utc>>> {
    let date = expires_at
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if lifetime.unwrap_or(false) || date.is_none() {
        auth.require(perm::NODES_LIFETIME)?;
        Ok(None)
    } else {
        Ok(Some(parse_expiry(date.unwrap())?))
    }
}

/// A server plus the bits only an admin needs: which node it lives on and who
/// owns it (resolved to a lightweight user reference).
#[derive(Serialize)]
pub struct ServerAdminView {
    #[serde(flatten)]
    pub server: ServerPublic,
    pub node: String,
    pub owner: Option<UserRef>,
}

pub async fn list_servers(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerAdminView>>> {
    auth.require(perm::NODES_READ)?;

    let mut cursor = state
        .db
        .servers()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .await?;

    let mut servers: Vec<Server> = Vec::new();
    let mut owner_ids: BTreeSet<ObjectId> = BTreeSet::new();
    while cursor.advance().await? {
        let s = cursor.deserialize_current()?;
        owner_ids.insert(s.user_id);
        servers.push(s);
    }

    // Resolve owners in one query.
    let mut owners: HashMap<ObjectId, UserRef> = HashMap::new();
    let ids: Vec<ObjectId> = owner_ids.into_iter().collect();
    if !ids.is_empty() {
        let mut uc = state
            .db
            .users()
            .find(doc! { "_id": { "$in": ids } })
            .await?;
        while uc.advance().await? {
            let u = uc.deserialize_current()?;
            if let Some(id) = u.id {
                owners.insert(id, UserRef::of(&u));
            }
        }
    }

    let out = servers
        .into_iter()
        .map(|s| ServerAdminView {
            node: s.node.clone(),
            owner: owners.get(&s.user_id).cloned(),
            server: s.public(),
        })
        .collect();
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct AdminCreateServerReq {
    /// User the VPS will belong to.
    pub user_id: String,
    pub name: String,
    pub plan: String,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub ssh_key: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    /// Expiry date (ISO or `YYYY-MM-DD`). Omit (or set `lifetime`) for vitalícia.
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub lifetime: Option<bool>,
}

/// Provision a VPS directly (unbilled) for an arbitrary user — clone the
/// template, size it, apply cloud-init, boot it, and record the server doc.
pub async fn create_server(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(req): Json<AdminCreateServerReq>,
) -> AppResult<Json<ServerPublic>> {
    auth.require(perm::NODES_MANAGE)?;
    let expires_at = resolve_expiry(&auth, req.lifetime, &req.expires_at)?;

    let owner = ObjectId::parse_str(&req.user_id)
        .map_err(|_| AppError::Validation("bad user id".into()))?;
    if state
        .db
        .users()
        .find_one(doc! { "_id": owner })
        .await?
        .is_none()
    {
        return Err(AppError::NotFound);
    }

    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 63 {
        return Err(AppError::Validation("invalid server name".into()));
    }
    let specs = billing::plan_specs(&state, &req.plan)
        .await?
        .ok_or_else(|| AppError::Validation("unknown plan".into()))?;
    let os = req.os.clone().unwrap_or_else(|| "Ubuntu 24.04".into());

    let template = state
        .cfg
        .os_templates
        .get(&os)
        .copied()
        .unwrap_or(px.template_vmid);
    let storage = crate::storage::pick(&state, specs.disk_gb)
        .await?
        .ok_or_else(|| AppError::Unavailable("sem capacidade de armazenamento".into()))?;
    let vmid = px.next_id().await?;
    let upid = px.clone_template(template, vmid, &name, &storage).await?;
    px.wait_task(&upid).await?;
    px.set_resources(vmid, specs.vcpu, specs.ram_gb * 1024)
        .await?;
    if let Err(e) = px.resize_disk(vmid, "scsi0", specs.disk_gb).await {
        tracing::warn!(vmid, error = %e, "disk resize failed");
    }
    let root_password = req
        .password
        .clone()
        .unwrap_or_else(crate::auth::token::generate_password);
    let _ = px
        .set_cloudinit(
            vmid,
            "root",
            Some(&root_password),
            req.ssh_key.as_deref(),
            "ip=dhcp",
        )
        .await;
    let _ = px.power(vmid, PowerAction::Start).await;

    let now = Utc::now();
    let server = Server {
        id: None,
        user_id: owner,
        org_id: None,
        name,
        node: px.node.clone(),
        vmid: Some(vmid),
        plan: req.plan.clone(),
        os,
        state: ServerState::Running,
        ip: None,
        cloud_init_ssh_key: req.ssh_key.clone(),
        root_password: Some(root_password),
        ssh_host: None,
        ssh_port: None,
        storage: Some(storage.clone()),
        specs,
        server_type: 0,
        container: None,
        expires_at,
        created_at: now,
        updated_at: now,
    };
    let inserted = state.db.servers().insert_one(&server).await?;
    let mut created = server;
    created.id = inserted.inserted_id.as_object_id();

    // A vencimento (non-lifetime) makes it a real billable subscription: it shows
    // up in billing and the renewal worker invoices it at the period end. Lifetime
    // VPS (expires_at == None) stay unbilled.
    if let Some(period_end) = expires_at {
        let price_cents = state
            .db
            .plans()
            .find_one(doc! { "slug": &req.plan })
            .await
            .ok()
            .flatten()
            .map(|p| p.price_cents)
            .unwrap_or(0);
        let sub = crate::models::Subscription {
            id: None,
            user_id: owner,
            server_id: created.id,
            plan: req.plan.clone(),
            status: crate::models::SubscriptionStatus::Active,
            price_cents,
            currency: state.cfg.billing_currency.clone(),
            interval: "monthly".into(),
            provider: Some("crypto".into()),
            current_period_start: Some(now),
            current_period_end: Some(period_end),
            cancel_at_period_end: false,
            created_at: now,
            updated_at: now,
        };
        let _ = state.db.subscriptions().insert_one(&sub).await;
    }

    security::audit(
        &state,
        auth.user_id,
        perm::NODES_MANAGE,
        created.id,
        &headers,
        doc! { "action": "server.create", "owner": owner },
    )
    .await;
    tokio::spawn(crate::frp::provision_tunnel(
        state.clone(),
        vmid,
        created.id,
    ));
    Ok(Json(created.public()))
}

#[derive(Deserialize)]
pub struct UpdateServerReq {
    /// New owner (optional).
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub vcpu: Option<u16>,
    #[serde(default)]
    pub ram_gb: Option<u32>,
    #[serde(default)]
    pub disk_gb: Option<u32>,
    /// New expiry date (ISO or `YYYY-MM-DD`). Ignored unless present.
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Set to true to make the VPS lifetime (needs `nodes.lifetime`).
    #[serde(default)]
    pub lifetime: Option<bool>,
    /// Move the VPS to a different relay by name (needs `relays.manage`).
    #[serde(default)]
    pub relay: Option<String>,
    /// New SSH port on the relay (needs `relays.manage`).
    #[serde(default)]
    pub ssh_port: Option<i32>,
}

/// Edit an existing VPS: owner, specs (vCPU/RAM/disk — applied to the live VM),
/// and expiry. Spec/owner changes need `nodes.manage`; lifetime needs
/// `nodes.lifetime`. Disk can only grow (Proxmox limitation).
pub async fn update_server(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateServerReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;

    let mut set = doc! { "updated_at": bson::DateTime::from_chrono(Utc::now()) };

    // Owner reassignment (drops stale per-server grants).
    if let Some(uid) = &req.user_id {
        let new_owner =
            ObjectId::parse_str(uid).map_err(|_| AppError::Validation("bad user id".into()))?;
        if state
            .db
            .users()
            .find_one(doc! { "_id": new_owner })
            .await?
            .is_none()
        {
            return Err(AppError::NotFound);
        }
        set.insert("user_id", new_owner);
        set.insert("org_id", Bson::Null);
        let _ = state
            .db
            .server_grants()
            .delete_many(doc! { "server_id": oid })
            .await;
    }

    // Spec changes — also pushed to the live Proxmox config (reboot to apply).
    let mut specs = server.specs.clone();
    let mut specs_changed = false;
    let mut grow_disk: Option<u32> = None;
    if let Some(v) = req.vcpu {
        if (1..=64).contains(&v) {
            specs.vcpu = v;
            specs_changed = true;
        }
    }
    if let Some(r) = req.ram_gb {
        if (1..=512).contains(&r) {
            specs.ram_gb = r;
            specs_changed = true;
        }
    }
    if let Some(d) = req.disk_gb {
        if d < server.specs.disk_gb {
            return Err(AppError::Validation("disk can only grow".into()));
        }
        if d > server.specs.disk_gb {
            specs.disk_gb = d;
            grow_disk = Some(d);
            specs_changed = true;
        }
    }
    if specs_changed {
        set.insert(
            "specs",
            bson::to_bson(&specs).map_err(|_| AppError::Internal("specs encode".into()))?,
        );
        if let (Some(px), Some(vmid)) = (state.proxmox.as_ref(), server.vmid) {
            let _ = px
                .set_resources(vmid, specs.vcpu, specs.ram_gb * 1024)
                .await;
            if let Some(d) = grow_disk {
                let _ = px.resize_disk(vmid, "scsi0", d).await;
            }
        }
    }

    // Expiry — only touched when lifetime or a date is supplied.
    if req.lifetime == Some(true) {
        auth.require(perm::NODES_LIFETIME)?;
        set.insert("expires_at", Bson::Null);
    } else if let Some(s) = req
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        set.insert("expires_at", bson::DateTime::from_chrono(parse_expiry(s)?));
    }

    let res = state
        .db
        .servers()
        .update_one(doc! { "_id": oid }, doc! { "$set": set })
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }

    // Relay / port reassignment touches the frpc config; gated on relays.manage.
    if req.relay.is_some() || req.ssh_port.is_some() {
        auth.require(perm::RELAYS_MANAGE)?;
        let frp = state
            .frp
            .as_ref()
            .ok_or_else(|| AppError::Unavailable("relays not configured".into()))?;
        frp.reassign(&state, oid, req.relay.as_deref(), req.ssh_port)
            .await?;
    }

    security::audit(
        &state,
        auth.user_id,
        perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "server.update" },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Destroy a VPS regardless of owner (admin override): stop + delete the VM on
/// Proxmox, then drop the server doc and its grants.
pub async fn delete_server(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;

    if let (Some(vmid), Some(px)) = (server.vmid, state.proxmox.as_ref()) {
        let _ = state
            .db
            .servers()
            .update_one(doc! { "_id": oid }, doc! { "$set": { "state": "deleting" }})
            .await;
        if let Ok(upid) = px.power(vmid, PowerAction::Stop).await {
            let _ = px.wait_task(&upid).await;
        }
        if let Ok(upid) = px.delete(vmid).await {
            let _ = px.wait_task(&upid).await;
        }
    }

    // Container: reap the Docker container on the agent so it doesn't orphan.
    if server.server_type == 1 {
        if let (Some(c), Some(ag)) = (server.container.as_ref(), state.agent.as_ref()) {
            let _ = ag.delete(&c.app_id).await;
        }
    }

    let _ = state
        .db
        .server_grants()
        .delete_many(doc! { "server_id": oid })
        .await;
    state.db.servers().delete_one(doc! { "_id": oid }).await?;
    // Drop the server's tunnel from frpc (rebuild config without it).
    if let Some(frp) = state.frp.as_ref() {
        let _ = frp.sync(&state).await;
    }
    security::audit(
        &state,
        auth.user_id,
        perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "server.delete" },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Suspend / reactivate -----------------------------

/// Which default template + accent a notification uses.
#[derive(Clone, Copy)]
enum NoticeKind {
    Suspended,
    Reactivated,
}

/// Body of a suspend/reactivate call: whether to email the owner, and if so
/// whether to send the default template or an admin-authored (custom) message.
/// A custom message overrides subject/title and renders `message` as Markdown.
#[derive(Deserialize)]
pub struct NotifyReq {
    #[serde(default)]
    pub notify: bool,
    #[serde(default)]
    pub custom: bool,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// Markdown body (`**bold**`, `# heading`, `[text](url)`, …).
    #[serde(default)]
    pub message: Option<String>,
}

/// Email the server's owner about a suspend/reactivate, honoring `req.notify`
/// and `req.custom`. Returns whether an email was actually dispatched.
async fn notify_owner(
    state: &AppState,
    server: &Server,
    req: &NotifyReq,
    kind: NoticeKind,
) -> bool {
    if !req.notify {
        return false;
    }
    let Ok(Some(user)) = state
        .db
        .users()
        .find_one(doc! { "_id": server.user_id })
        .await
    else {
        return false;
    };
    if req.custom {
        let subject = req
            .subject
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Aviso — ArtixCloud");
        let title = req
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Aviso da ArtixCloud");
        let message = req.message.as_deref().unwrap_or("");
        let accent = match kind {
            NoticeKind::Suspended => email::WARN,
            NoticeKind::Reactivated => email::GOOD,
        };
        email::send_admin_notice(state, &user.email, subject, title, message, accent).await;
    } else {
        match kind {
            NoticeKind::Suspended => email::send_server_suspended(state, &user, &server.name).await,
            NoticeKind::Reactivated => {
                email::send_server_reactivated(state, &user, &server.name).await
            }
        }
    }
    true
}

/// Suspend a VPS regardless of owner (admin override): power the VM off and mark
/// it `suspended` (the power handler then refuses to boot it back up until it's
/// reactivated). Optionally emails the owner — default or custom message.
pub async fn suspend_server(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<NotifyReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;

    let _ = crate::handlers::servers::set_power(&state, &server, PowerAction::Stop).await;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "state": "suspended", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;

    let emailed = notify_owner(&state, &server, &req, NoticeKind::Suspended).await;
    security::audit(
        &state,
        auth.user_id,
        perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "server.suspend", "emailed": emailed },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true, "emailed": emailed })))
}

/// Reactivate a suspended VPS: power it back on and mark it `running`.
/// Optionally emails the owner — default or custom message.
pub async fn unsuspend_server(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<NotifyReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;

    let _ = crate::handlers::servers::set_power(&state, &server, PowerAction::Start).await;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "state": "running", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;

    let emailed = notify_owner(&state, &server, &req, NoticeKind::Reactivated).await;
    security::audit(
        &state,
        auth.user_id,
        perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "server.unsuspend", "emailed": emailed },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true, "emailed": emailed })))
}
