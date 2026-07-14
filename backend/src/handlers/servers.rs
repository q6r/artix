//! VPS lifecycle backed by Proxmox. Every endpoint is ownership-checked
//! (a user only sees/acts on their own servers — IDOR-safe).

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::Deserialize;

use std::collections::BTreeSet;

use crate::{
    authn::AuthUser,
    billing,
    db::Collections,
    error::{AppError, AppResult},
    models::{OrgRole, Server, ServerPublic, ServerState},
    permissions::{cap, perm, server_perm},
    proxmox::{ConsoleTicket, MetricPoint, PowerAction},
    state::AppState,
};

fn state_str(s: ServerState) -> &'static str {
    match s {
        ServerState::PendingPayment => "pending_payment",
        ServerState::Provisioning => "provisioning",
        ServerState::Running => "running",
        ServerState::Stopped => "stopped",
        ServerState::Suspended => "suspended",
        ServerState::Error => "error",
        ServerState::Deleting => "deleting",
    }
}

/// VM-id of a provisioned server, or 409 if it has not been provisioned yet.
fn require_vmid(server: &Server) -> AppResult<i64> {
    server
        .vmid
        .ok_or_else(|| AppError::Conflict("server not provisioned yet".into()))
}

/// Provision a server that already exists in the DB (paid flow): clone the
/// template, size it, apply cloud-init (stored SSH key only), boot it, and
/// record the assigned `vmid`. Idempotent enough to retry on failure.
pub async fn provision(state: &AppState, server: &Server) -> AppResult<()> {
    // Containers never touch Proxmox — they deploy via the container agent.
    if server.server_type == 1 {
        return Ok(());
    }
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;

    let template = state
        .cfg
        .os_templates
        .get(&server.os)
        .copied()
        .unwrap_or(px.template_vmid);
    let storage = crate::storage::pick(state, server.specs.disk_gb)
        .await?
        .ok_or_else(|| AppError::Unavailable("sem capacidade de armazenamento".into()))?;
    let vmid = px.next_id().await?;
    let upid = px.clone_template(template, vmid, &server.name, &storage).await?;
    px.wait_task(&upid).await?;
    px.set_resources(vmid, server.specs.vcpu, server.specs.ram_gb * 1024)
        .await?;
    if let Err(e) = px.resize_disk(vmid, "scsi0", server.specs.disk_gb).await {
        tracing::warn!(vmid, error = %e, "disk resize failed");
    }
    // Generate an initial root password (set via cloud-init, stored so the owner
    // can copy it from the panel).
    let root_password = crate::auth::token::generate_password();
    let _ = px
        .set_cloudinit(
            vmid,
            "root",
            Some(&root_password),
            server.cloud_init_ssh_key.as_deref(),
            "ip=dhcp",
        )
        .await;
    let _ = px.power(vmid, PowerAction::Start).await;

    state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id },
            doc! { "$set": {
                "vmid": vmid,
                "storage": &storage,
                "node": px.node.clone(),
                "state": "running",
                "root_password": &root_password,
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    // Set up the public SSH tunnel in the background (waits for the agent + IP).
    tokio::spawn(crate::frp::provision_tunnel(state.clone(), vmid, server.id));
    Ok(())
}

/// Power a server on/off by id (used by the billing worker on suspend/resume).
pub async fn set_power(state: &AppState, server: &Server, action: PowerAction) -> AppResult<()> {
    let Some(vmid) = server.vmid else {
        return Ok(());
    };
    if let Some(px) = &state.proxmox {
        let _ = px.power(vmid, action).await;
    }
    Ok(())
}

fn map_state(proxmox_status: &str) -> ServerState {
    match proxmox_status {
        "running" => ServerState::Running,
        "stopped" => ServerState::Stopped,
        _ => ServerState::Error,
    }
}

#[derive(Deserialize)]
pub struct CreateServerReq {
    pub name: String,
    pub plan: String,
    #[serde(default)]
    pub os: Option<String>,
    /// Optional cloud-init credentials.
    #[serde(default)]
    pub ssh_key: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct PowerReq {
    pub action: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateServerReq>,
) -> AppResult<Json<ServerPublic>> {
    auth.scope(cap::SERVICES_CREATE)?;
    // Direct (unbilled) provisioning is an admin-only path; regular users get a
    // VPS only through the paid billing flow (which provisions after payment).
    auth.require(perm::NODES_MANAGE)?;

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
    let plan = req.plan.clone();

    // Direct provision (admin/free path): clone -> size -> cloud-init -> start.
    let template = state.cfg.os_templates.get(&os).copied().unwrap_or(px.template_vmid);
    let storage = crate::storage::pick(&state, specs.disk_gb)
        .await?
        .ok_or_else(|| AppError::Unavailable("sem capacidade de armazenamento".into()))?;
    let vmid = px.next_id().await?;
    let upid = px.clone_template(template, vmid, &name, &storage).await?;
    px.wait_task(&upid).await?;
    px.set_resources(vmid, specs.vcpu, specs.ram_gb * 1024).await?;
    if let Err(e) = px.resize_disk(vmid, "scsi0", specs.disk_gb).await {
        tracing::warn!(vmid, error = %e, "disk resize failed");
    }
    // Use the caller-supplied password if any, otherwise generate a strong one.
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
        .await; // best-effort (needs a cloud-init template)
    let _ = px.power(vmid, PowerAction::Start).await; // best-effort boot

    let now = Utc::now();
    let server = Server {
        id: None,
        user_id: auth.user_id,
        org_id: None,
        name,
        node: px.node.clone(),
        vmid: Some(vmid),
        plan,
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
        expires_at: None,
        created_at: now,
        updated_at: now,
    };
    let inserted = state.db.servers().insert_one(&server).await?;
    let mut created = server;
    created.id = inserted.inserted_id.as_object_id();
    tokio::spawn(crate::frp::provision_tunnel(state.clone(), vmid, created.id));
    Ok(Json(created.public()))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerPublic>>> {
    auth.scope(cap::SERVICES_READ)?;
    // The caller sees: their own servers, every server in orgs they own/admin,
    // and servers individually granted to them.
    let mut org_ids: Vec<ObjectId> = Vec::new();
    let mut granted_ids: Vec<ObjectId> = Vec::new();

    let mut members = state
        .db
        .org_members()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    while members.advance().await? {
        let m = members.deserialize_current()?;
        if matches!(m.role, OrgRole::Owner | OrgRole::Admin) {
            org_ids.push(m.org_id);
        }
    }
    let mut grants = state
        .db
        .server_grants()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    while grants.advance().await? {
        granted_ids.push(grants.deserialize_current()?.server_id);
    }

    let filter = doc! {
        "state": { "$ne": "pending_payment" },
        // VPS only — containers ($type == 1) have their own /containers list.
        "type": { "$ne": 1 },
        "$or": [
            { "user_id": auth.user_id },
            { "org_id": { "$in": &org_ids } },
            { "_id": { "$in": &granted_ids } },
        ]
    };

    let mut cursor = state.db.servers().find(filter).await?;
    let mut seen: BTreeSet<ObjectId> = BTreeSet::new();
    let mut out = Vec::new();
    while cursor.advance().await? {
        let s = cursor.deserialize_current()?;
        if let Some(id) = s.id {
            if seen.insert(id) {
                let mut p = s.public();
                if p.expires_at.is_none() {
                    if let Ok(Some(sub)) = state
                        .db
                        .subscriptions()
                        .find_one(doc! { "server_id": id, "status": "active" })
                        .await
                    {
                        p.renews_at = sub.current_period_end;
                    }
                }
                // The initial root password is only ever shown to the owner, not
                // to org members / grantees who share the server.
                if s.user_id != auth.user_id {
                    p.root_password = None;
                    p.root_user = None;
                }
                out.push(p);
            }
        }
    }
    Ok(Json(out))
}

/// Authorize access to a server for `needed_perm`. The owner always passes; an
/// org owner/admin passes for any shared server; an org member passes only if a
/// `server_grant` lists the permission. Returns `NotFound` otherwise (no leak).
pub async fn access(
    state: &AppState,
    user_id: ObjectId,
    id: &str,
    needed_perm: &str,
) -> AppResult<Server> {
    let oid = ObjectId::parse_str(id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;

    // Resource owner — full access.
    if server.user_id == user_id {
        return Ok(server);
    }

    // Shared into an org the caller belongs to?
    if let Some(org_id) = server.org_id {
        if let Some(member) = state
            .db
            .org_members()
            .find_one(doc! { "org_id": org_id, "user_id": user_id })
            .await?
        {
            if matches!(member.role, OrgRole::Owner | OrgRole::Admin) {
                return Ok(server);
            }
            // Plain member: needs an explicit per-server grant scoped to THIS org
            // (a stale grant from another org must never apply).
            if let Some(grant) = state
                .db
                .server_grants()
                .find_one(doc! { "server_id": oid, "user_id": user_id, "org_id": org_id })
                .await?
            {
                if grant.perms.iter().any(|p| p == needed_perm) {
                    return Ok(server);
                }
            }
        }
    }
    Err(AppError::NotFound)
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ServerPublic>> {
    auth.scope(cap::SERVICES_READ)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;

    // Best-effort live status refresh from Proxmox — but never clobber a
    // billing-driven state (pending_payment / suspended / deleting).
    let refreshable = matches!(
        server.state,
        ServerState::Provisioning | ServerState::Running | ServerState::Stopped
    );
    if let (true, Some(px), Some(vmid)) = (refreshable, &state.proxmox, server.vmid) {
        if let Ok(st) = px.status(vmid).await {
            let new_state = map_state(&st.status);
            if new_state != server.state {
                let _ = state
                    .db
                    .servers()
                    .update_one(
                        doc! { "_id": server.id },
                        doc! { "$set": { "state": state_str(new_state) }},
                    )
                    .await;
                server.state = new_state;
            }
        }
    }

    // Capture the VM's IP from the guest agent once it's known (cache on the doc).
    if server.ip.is_none() {
        if let (Some(px), Some(vmid)) = (&state.proxmox, server.vmid) {
            if let Ok(Some(ip)) = px.agent_ipv4(vmid).await {
                let _ = state
                    .db
                    .servers()
                    .update_one(doc! { "_id": server.id }, doc! { "$set": { "ip": &ip }})
                    .await;
                server.ip = Some(ip);
            }
        }
    }

    // Ensure the public SSH tunnel exists (allocates a relay port on first call).
    // VPS only — containers have no vmid/relay.
    if server.server_type == 0 {
        if let Ok(Some((host, port))) = crate::frp::ensure(&state, &server).await {
            server.ssh_host = Some(host);
            server.ssh_port = Some(port);
        }
    }

    let mut p = server.public();
    // Subscription VPS carry no `expires_at` (the subscription drives the
    // lifecycle) — surface the next renewal date so the panel doesn't mislabel
    // them "lifetime". Only when both are null is it truly vitalícia.
    if p.expires_at.is_none() {
        if let Some(sid) = server.id {
            if let Ok(Some(sub)) = state
                .db
                .subscriptions()
                .find_one(doc! { "server_id": sid, "status": "active" })
                .await
            {
                p.renews_at = sub.current_period_end;
            }
        }
    }
    // The initial root password is only ever shown to the owner.
    if server.user_id != auth.user_id {
        p.root_password = None;
        p.root_user = None;
    }
    Ok(Json(p))
}

#[derive(Deserialize)]
pub struct RootPasswordReq {
    /// Optional explicit password; if omitted (or too short) a strong one is generated.
    #[serde(default)]
    pub password: Option<String>,
}

/// Reset the VPS root password via the guest agent and store the new value so the
/// owner can copy it from the panel. Requires `manage` on the server.
/// Format (reinstall) a VPS: tear down the current VM and reprovision a fresh
/// one from the template — same server record, wiped disk, new root password.
/// Users can format but NOT destroy; destruction is admin-only.
#[derive(serde::Deserialize)]
pub struct ReinstallReq {
    /// Optional new OS to install (must be a known `OS_TEMPLATES` label).
    #[serde(default)]
    pub os: Option<String>,
}

pub async fn reinstall(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ReinstallReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_DELETE)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;

    // Reinstall onto a different OS, when a known template label is supplied.
    if let Some(os) = req.os.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if os != server.os && state.cfg.os_templates.contains_key(os) {
            let _ = state
                .db
                .servers()
                .update_one(doc! { "_id": server.id }, doc! { "$set": { "os": os }})
                .await;
            server.os = os.to_string();
        }
    }

    // Tear down the existing VM (best-effort) and clear its captured IP.
    if let Some(vmid) = server.vmid {
        state
            .db
            .servers()
            .update_one(
                doc! { "_id": server.id },
                doc! { "$set": { "state": "provisioning", "ip": null }},
            )
            .await?;
        if let Ok(upid) = px.power(vmid, PowerAction::Stop).await {
            let _ = px.wait_task(&upid).await;
        }
        if let Ok(upid) = px.delete(vmid).await {
            let _ = px.wait_task(&upid).await;
        }
    }

    // Reprovision from the template (assigns a fresh vmid + root password).
    provision(&state, &server).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn reset_root_password(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<RootPasswordReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;
    let vmid = require_vmid(&server)?;

    let password = req
        .password
        .filter(|p| p.len() >= 8 && p.len() <= 128)
        .unwrap_or_else(crate::auth::token::generate_password);
    px.agent_set_password(vmid, "root", &password).await?;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id },
            doc! { "$set": {
                "root_password": &password,
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "password": password })))
}

pub async fn power(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<PowerReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_RESTART)?;
    let server = access(&state, auth.user_id, &id, server_perm::POWER).await?;
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;
    let vmid = require_vmid(&server)?;
    let action = PowerAction::parse(&req.action)
        .ok_or_else(|| AppError::Validation("invalid action".into()))?;
    // Don't let a suspended/unpaid/expired or deleting VPS be powered back on —
    // otherwise the expiry/non-payment suspension is trivially bypassed.
    if matches!(action, PowerAction::Start | PowerAction::Reboot)
        && matches!(
            server.state,
            ServerState::Suspended | ServerState::PendingPayment | ServerState::Deleting
        )
    {
        return Err(AppError::Conflict("server is suspended".into()));
    }
    let upid = px.power(vmid, action).await?;
    Ok(Json(serde_json::json!({ "ok": true, "task": upid })))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_DELETE)?;
    let server = access(&state, auth.user_id, &id, server_perm::DELETE).await?;

    // A never-provisioned (pending payment) server has no VM — just drop it.
    let Some(vmid) = server.vmid else {
        let _ = state.db.server_grants().delete_many(doc! { "server_id": server.id }).await;
        state.db.servers().delete_one(doc! { "_id": server.id }).await?;
        return Ok(Json(serde_json::json!({ "ok": true })));
    };
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("provisioning unavailable".into()))?;

    state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id },
            doc! { "$set": { "state": "deleting" }},
        )
        .await?;

    // Stop (best-effort), wait, then destroy the VM.
    if let Ok(upid) = px.power(vmid, PowerAction::Stop).await {
        let _ = px.wait_task(&upid).await;
    }
    let upid = px.delete(vmid).await?;
    let _ = px.wait_task(&upid).await;

    let _ = state.db.server_grants().delete_many(doc! { "server_id": server.id }).await;
    state.db.servers().delete_one(doc! { "_id": server.id }).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn metrics(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<MetricPoint>>> {
    auth.scope(cap::METRICS_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::METRICS).await?;
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("metrics unavailable".into()))?;
    Ok(Json(px.rrd(require_vmid(&server)?, "hour").await?))
}

pub async fn console(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ConsoleTicket>> {
    auth.scope(cap::CONSOLE)?;
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let px = state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("console unavailable".into()))?;
    Ok(Json(px.console(require_vmid(&server)?).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_plan_specs() {
        let s = billing::DEFAULT_PLANS.iter().find(|p| p.id == "cloud4").unwrap();
        assert_eq!(s.vcpu, 4);
        assert_eq!(s.ram_gb, 8);
    }
}
