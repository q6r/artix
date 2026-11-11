//! Container servers (`server_type == 1`) — Discloud/SquareCloud-style apps run
//! on the dedicated Docker VM via the container agent. A container is just a
//! `Server` doc with `server_type == 1` + a `container` sub-doc, so ownership
//! reuses `servers::access()` verbatim (IDOR-safe). Nothing here touches Proxmox.

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bson::{doc, oid::ObjectId, Document};
use chrono::Utc;
use serde::Deserialize;

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    handlers::servers::access,
    models::{Container, Server, ServerPublic, ServerSpecs, ServerState},
    permissions::{cap, server_perm},
    state::AppState,
};

fn agent(state: &AppState) -> AppResult<&crate::agent::AgentClient> {
    state
        .agent
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("containers unavailable".into()))
}

/// Per-user serialization for RAM-pool mutations. Drawing from the pool is a
/// check-then-act: `account_ram()` reads how much is used, then the handler
/// inserts a container (or raises one's RAM). Without a lock, N concurrent
/// requests all read the same `used`, all pass the check, and all write —
/// overshooting the pool (the duplicate-container race). The backend is a single
/// instance, so an in-process async lock keyed by user is enough; each handler
/// holds it across the check + the write.
static RAM_LOCKS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<ObjectId, std::sync::Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn ram_lock(user_id: ObjectId) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    let mut map = RAM_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    // Bound the map: drop entries nobody is holding (strong_count == 1 → only the
    // map's own reference) once it grows large.
    if map.len() > 4096 {
        map.retain(|_, v| std::sync::Arc::strong_count(v) > 1);
    }
    map.entry(user_id)
        .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn require_container(s: &Server) -> AppResult<&Container> {
    if s.server_type != 1 {
        return Err(AppError::NotFound);
    }
    s.container.as_ref().ok_or(AppError::NotFound)
}

fn env_to_json(env: &Option<Document>) -> String {
    match env {
        Some(d) => serde_json::to_string(d).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    }
}

// ----------------------------- create / list / get -----------------------------

#[derive(Deserialize)]
pub struct CreateContainerReq {
    pub name: String,
    pub container_type: String,
    /// RAM (MB) to allocate from the account pool. Defaults to the type minimum.
    #[serde(default)]
    pub ram_mb: Option<i64>,
    /// Desired subdomain for sites (<subdomain>.artix.cloud). Optional; defaults
    /// to the app id. Ignored for bots.
    #[serde(default)]
    pub subdomain: Option<String>,
    /// Minecraft: "java" | "bedrock".
    #[serde(default)]
    pub edition: Option<String>,
    /// Minecraft Java software: VANILLA | PAPER | PURPUR | FABRIC | FORGE.
    #[serde(default)]
    pub software: Option<String>,
    /// Minecraft version ("LATEST" or e.g. "1.21.1").
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(serde::Serialize)]
pub struct RamBalance {
    pub total_mb: i64,
    pub used_mb: i64,
    pub available_mb: i64,
    /// The one-time free grant size + whether this account has claimed it.
    pub free_grant_mb: i64,
    pub free_claimed: bool,
    pub bot_min_mb: i64,
    pub site_min_mb: i64,
}

/// GET /containers/ram — the account's RAM pool (total / used / available).
pub async fn ram_balance(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<RamBalance>> {
    auth.scope(cap::SERVICES_READ)?;
    let (total, used) = account_ram(&state, &auth.user).await?;
    Ok(Json(RamBalance {
        total_mb: total,
        used_mb: used,
        available_mb: (total - used).max(0),
        free_grant_mb: crate::billing::FREE_CLAIM_MB,
        free_claimed: auth.user.free_ram_claimed,
        bot_min_mb: type_min_ram("discord_bot"),
        site_min_mb: type_min_ram("site"),
    }))
}

/// POST /containers/claim-free — claim the one-time free RAM grant (256 MB).
pub async fn claim_free(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<RamBalance>> {
    auth.scope(cap::SERVICES_CREATE)?;
    if auth.user.free_ram_claimed {
        return Err(AppError::Conflict("você já resgatou o plano grátis".into()));
    }
    state
        .db
        .users()
        .update_one(
            doc! { "_id": auth.user_id },
            doc! { "$set": { "free_ram_claimed": true, "updated_at": bson::DateTime::from_chrono(Utc::now()) } },
        )
        .await?;
    let mut user = auth.user.clone();
    user.free_ram_claimed = true;
    let (total, used) = account_ram(&state, &user).await?;
    Ok(Json(RamBalance {
        total_mb: total,
        used_mb: used,
        available_mb: (total - used).max(0),
        free_grant_mb: crate::billing::FREE_CLAIM_MB,
        free_claimed: true,
        bot_min_mb: type_min_ram("discord_bot"),
        site_min_mb: type_min_ram("site"),
    }))
}

/// Validate a chosen site subdomain (format, reserved list, uniqueness) →
/// normalized value, or `None` if none was given (defaults to app id later).
pub(crate) async fn validate_subdomain(
    state: &AppState,
    input: Option<&str>,
) -> AppResult<Option<String>> {
    let raw: String = input
        .unwrap_or("")
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let raw = raw.trim_matches('-').to_string();
    if raw.is_empty() {
        return Ok(None);
    }
    if raw.len() < 3 || raw.len() > 63 {
        return Err(AppError::Validation(
            "subdomain must be 3–63 characters".into(),
        ));
    }
    // Sites live at <sub>.artix.cloud (same zone as the platform), so reserve
    // system/first-party labels to prevent hijack/confusion.
    const RESERVED: &[&str] = &[
        "www",
        "app",
        "api",
        "admin",
        "pro",
        "mail",
        "smtp",
        "imap",
        "pop",
        "ns",
        "ns1",
        "ns2",
        "dns",
        "ftp",
        "cdn",
        "static",
        "assets",
        "cpanel",
        "webmail",
        "dashboard",
        "panel",
        "status",
        "blog",
        "docs",
        "help",
        "support",
        "billing",
        "pay",
        "checkout",
        "auth",
        "login",
        "oauth",
        "webhooks",
        "agent",
        "traefik",
        "grafana",
        "kibana",
        "vpn",
        "git",
        "artix",
        "apps",
        "test",
        "staging",
        "dev",
        "prod",
        "root",
    ];
    if RESERVED.contains(&raw.as_str()) {
        return Err(AppError::Conflict("this subdomain is reserved".into()));
    }
    let taken = state
        .db
        .servers()
        .count_documents(doc! { "type": 1, "container.subdomain": &raw })
        .await?;
    if taken > 0 {
        return Err(AppError::Conflict("subdomain already taken".into()));
    }
    Ok(Some(raw))
}

/// Minimum RAM (MB) an app type needs to run.
pub(crate) fn type_min_ram(ctype: &str) -> i64 {
    match ctype {
        "site" => 512,
        "minecraft" => 1024, // Java MC needs ~1 GB; not viable on the free 256 pool
        "voice" => 512,      // Mumble voice server
        _ => 256,            // discord_bot
    }
}

/// Max players a Minecraft server may allow — bound by RAM (~15 players/GB) so
/// nobody oversells their own server into lag. Buying more RAM raises the cap.
fn mc_player_cap(ram_mb: i64) -> i32 {
    (((ram_mb / 1024) * 15).max(10)) as i32
}

/// Default max users for a Mumble voice server. Voice is light per user, so this
/// is generous; the owner can lower/raise it in settings.
fn voice_user_cap(ram_mb: i64) -> i32 {
    (ram_mb / 8).clamp(20, 500) as i32
}

/// Account RAM pool → `(total_mb, used_mb)`. Total = the claimed free grant (if
/// any) plus every active RAM-pack subscription; used = the account's containers.
pub(crate) async fn account_ram(
    state: &AppState,
    user: &crate::models::User,
) -> AppResult<(i64, i64)> {
    let user_id = user.id.ok_or(AppError::Unauthorized)?;
    let mut total = if user.free_ram_claimed {
        crate::billing::FREE_CLAIM_MB
    } else {
        0
    };
    // Admin bonus RAM: counts while lifetime (no expiry) or not yet expired.
    let bonus_active = match user.bonus_ram_expires_at {
        None => true,
        Some(exp) => exp > chrono::Utc::now(),
    };
    if bonus_active {
        total += user.bonus_ram_mb.unwrap_or(0).max(0);
    }
    let mut subs = state
        .db
        .subscriptions()
        .find(doc! { "user_id": user_id, "status": "active" })
        .await?;
    while subs.advance().await? {
        let s = subs.deserialize_current()?;
        if let Some(p) = crate::billing::container_plan(&s.plan) {
            total += p.ram_mb;
        }
    }
    let mut used = 0i64;
    let mut cur = state
        .db
        .servers()
        .find(doc! { "type": 1, "user_id": user_id })
        .await?;
    while cur.advance().await? {
        let srv = cur.deserialize_current()?;
        used += srv.container.and_then(|c| c.ram_mb).unwrap_or(0);
    }
    Ok((total, used))
}

/// Create a container server record. RAM is drawn from the account pool; the
/// caller validates the pool + type minimums first.
pub(crate) async fn provision_container_record(
    state: &AppState,
    user_id: ObjectId,
    name: &str,
    ctype: &str,
    subdomain_in: Option<&str>,
    ram_mb: i64,
) -> AppResult<Server> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("name required".into()));
    }
    if ctype != "discord_bot" && ctype != "site" && ctype != "minecraft" && ctype != "voice" {
        return Err(AppError::Validation("invalid container type".into()));
    }
    let subdomain = if ctype == "site" || ctype == "minecraft" || ctype == "voice" {
        validate_subdomain(state, subdomain_in).await?
    } else {
        None
    };

    let now = Utc::now();
    let server = Server {
        id: None,
        user_id,
        org_id: None,
        name,
        node: String::new(),
        vmid: None,
        plan: "pool".to_string(),
        os: String::new(),
        state: ServerState::Stopped,
        ip: None,
        cloud_init_ssh_key: None,
        storage: None,
        root_password: None,
        ssh_host: None,
        ssh_port: None,
        specs: ServerSpecs {
            vcpu: 1,
            ram_gb: 0,
            disk_gb: 0,
        },
        server_type: 1,
        container: Some(Container {
            container_type: ctype.to_string(),
            app_id: String::new(), // filled after insert (= _id hex)
            subdomain: subdomain.clone(),
            runtime: None,
            version: None,
            ram_mb: Some(ram_mb),
            image: None,
            build_log: None,
            start: None,
            port: None,
            status: Some("created".into()),
            env: None,
            deployed: false,
            deploying: false,
            github_repo: None,
            github_ref: None,
            github_hook_id: None,
            webhook_secret: None,
            custom_domain: None,
            custom_domain_verified: false,
            edition: None,
            software: None,
            mc_relay_host: None,
            mc_port: None,
            max_players: None,
            admin_password: None,
            voice_password: None,
            suspended: false,
        }),
        expires_at: None,
        created_at: now,
        updated_at: now,
    };

    let id = state
        .db
        .servers()
        .insert_one(&server)
        .await?
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert id".into()))?;
    let app_id = id.to_hex();
    // A site/minecraft/voice with no chosen subdomain defaults to its app id.
    let final_sub = if ctype == "site" || ctype == "minecraft" || ctype == "voice" {
        subdomain.or_else(|| Some(app_id.clone()))
    } else {
        None
    };
    let mut set = doc! { "container.app_id": &app_id };
    if let Some(s) = &final_sub {
        set.insert("container.subdomain", s);
    }
    state
        .db
        .servers()
        .update_one(doc! { "_id": id }, doc! { "$set": set })
        .await?;

    let mut created = server;
    created.id = Some(id);
    if let Some(c) = created.container.as_mut() {
        c.app_id = app_id;
        c.subdomain = final_sub;
    }
    Ok(created)
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateContainerReq>,
) -> AppResult<Json<ServerPublic>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let ctype = req.container_type.trim().to_lowercase();
    if ctype != "discord_bot" && ctype != "site" && ctype != "minecraft" && ctype != "voice" {
        return Err(AppError::Validation("invalid container type".into()));
    }
    let min = type_min_ram(&ctype);
    // RAM: default to the type minimum; must be at least the minimum.
    let ram_mb = req.ram_mb.unwrap_or(min);
    if ram_mb < min {
        let kind = match ctype.as_str() {
            "site" => "Site",
            "minecraft" => "Servidor de Minecraft",
            _ => "Bot de Discord",
        };
        return Err(AppError::Validation(format!(
            "{kind} precisa de no mínimo {min} MB RAM para funcionar corretamente."
        )));
    }
    // Serialize this user's RAM-pool mutations: hold the lock across the pool
    // check and the insert so concurrent creates can't each pass the check before
    // any of them writes (TOCTOU → duplicate containers). Dropped when create()
    // returns, which is after provision_container_record has inserted. Bind the
    // Arc first so it outlives the guard that borrows from it.
    let ram_gate = ram_lock(auth.user_id);
    let _ram_guard = ram_gate.lock().await;
    // Draw from the account's RAM pool.
    let (total, used) = account_ram(&state, &auth.user).await?;
    let available = total - used;
    if ram_mb > available {
        let hint = if total == 0 {
            "Resgate o plano grátis ou compre RAM para começar."
        } else {
            "Compre mais RAM ou use menos."
        };
        return Err(AppError::Conflict(format!(
            "RAM insuficiente: você tem {available} MB disponíveis (de {total} MB). {hint}"
        )));
    }

    // VM capacity gate for containers that run on the Docker VM (Minecraft,
    // voice): don't provision if the VM can't fit it, which would OOM others.
    if ctype == "minecraft" || ctype == "voice" {
        if let Some(a) = state.agent.as_ref() {
            if let Some(free) = a.host_available_mb().await {
                if free < ram_mb + 512 {
                    return Err(AppError::Unavailable(
                        "sem capacidade no servidor de containers agora — tente novamente em instantes.".into(),
                    ));
                }
            }
        }
    }

    let mut created = provision_container_record(
        &state,
        auth.user_id,
        &req.name,
        &ctype,
        req.subdomain.as_deref(),
        ram_mb,
    )
    .await?;

    // Minecraft has no zip/deploy step: persist its config and provision it in the
    // background (allocate a public port, sync the relay, create the itzg
    // container). The UI shows "provisioning" until the world is up.
    if ctype == "minecraft" {
        let edition = if req.edition.as_deref() == Some("bedrock") {
            "bedrock"
        } else {
            "java"
        }
        .to_string();
        let software = req
            .software
            .as_deref()
            .map(|s| s.trim().to_uppercase())
            .filter(|s| ["VANILLA", "PAPER", "PURPUR", "FABRIC", "FORGE"].contains(&s.as_str()))
            .unwrap_or_else(|| "VANILLA".into());
        let version = req
            .version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("LATEST")
            .to_string();
        let sid = created.id.unwrap();
        let cap = mc_player_cap(ram_mb);
        state
            .db
            .servers()
            .update_one(
                doc! { "_id": sid },
                doc! { "$set": {
                    "container.edition": &edition,
                    "container.software": &software,
                    "container.version": &version,
                    "container.max_players": cap,
                    "state": "provisioning",
                }},
            )
            .await?;
        if let Some(c) = created.container.as_mut() {
            c.edition = Some(edition);
            c.software = Some(software);
            c.version = Some(version);
            c.max_players = Some(cap);
        }
        created.state = ServerState::Provisioning;
        tokio::spawn(provision_minecraft(state.clone(), created.clone(), ram_mb));
    }

    // Voice (Mumble): generate the SuperUser password + a default user cap, then
    // provision in the background (allocate a public port, sync the relay, create
    // the Mumble container). The UI shows "provisioning" until it's up.
    if ctype == "voice" {
        let admin_pw = crate::auth::token::generate_password();
        let max_users = voice_user_cap(ram_mb);
        let sid = created.id.unwrap();
        state
            .db
            .servers()
            .update_one(
                doc! { "_id": sid },
                doc! { "$set": {
                    "container.admin_password": &admin_pw,
                    "container.max_players": max_users,
                    "state": "provisioning",
                }},
            )
            .await?;
        if let Some(c) = created.container.as_mut() {
            c.admin_password = Some(admin_pw);
            c.max_players = Some(max_users);
        }
        created.state = ServerState::Provisioning;
        tokio::spawn(provision_voice(state.clone(), created.clone(), ram_mb));
    }

    Ok(Json(created.public()))
}

/// Mark a container's server `error` (provisioning failed) so the UI shows it.
async fn mc_mark_error(state: &AppState, sid: ObjectId) {
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": { "state": "error", "container.status": "error" }},
        )
        .await;
}

/// Mark a Minecraft server ready (installed + running).
async fn mc_mark_running(state: &AppState, sid: ObjectId) {
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": {
                "state": "running",
                "container.deployed": true,
                "container.status": "running",
            }},
        )
        .await;
}

/// Background: allocate the public port + relay proxy, then create the itzg
/// container. Best-effort — marks the server `error` on failure so the UI shows it.
async fn provision_minecraft(state: AppState, server: Server, ram_mb: i64) {
    let Some(sid) = server.id else { return };
    let Some(c) = server.container.as_ref() else {
        return;
    };
    let app_id = c.app_id.clone();
    let edition = c.edition.clone().unwrap_or_else(|| "java".into());
    let software = c.software.clone().unwrap_or_else(|| "VANILLA".into());
    let version = c.version.clone().unwrap_or_else(|| "LATEST".into());

    // 1) Allocate the public port + push the relay's frpc config.
    let (relay_host, port) = match crate::frp::mc_ensure(&state, &server).await {
        Ok(Some((h, p))) => (h, p),
        _ => {
            tracing::warn!(%app_id, "minecraft: no relay/port available");
            mc_mark_error(&state, sid).await;
            return;
        }
    };

    // Point <sub>.artix.cloud at the server (A + SRV) so players connect by name.
    if let Some(sub) = server.container.as_ref().and_then(|c| c.subdomain.clone()) {
        let _ = crate::cloudflare::set_mc_dns(&state, &sub, &relay_host, port).await;
    }

    // 2) Create the container on the agent (publishes VM:port, pulls image).
    let Some(agent) = state.agent.as_ref() else {
        mc_mark_error(&state, sid).await;
        return;
    };
    let body = serde_json::json!({
        "edition": edition,
        "software": software,
        "version": version,
        "ram": ram_mb,
        "port": port,
        "maxPlayers": c.max_players,
    });
    if let Err(e) = agent.create_minecraft(&app_id, &body).await {
        tracing::warn!(%app_id, error = %e, "minecraft create failed");
        mc_mark_error(&state, sid).await;
        return;
    }

    // The container started; the itzg entrypoint now downloads the server jar and
    // generates the world — the "installing" phase. Stay `provisioning` until the
    // server reports ready ("Done") or we detect a crash (bad version, EULA, OOM),
    // so the panel shows install progress instead of a premature "running".
    let mut restarting = 0;
    for _ in 0..45 {
        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
        let logs = agent
            .logs(&app_id, 40)
            .await
            .map(|l| l.logs.to_lowercase())
            .unwrap_or_default();
        if logs.contains("done (")
            || logs.contains("for help, type")
            || logs.contains("server started")
        {
            mc_mark_running(&state, sid).await;
            return;
        }
        if logs.contains("is not available")
            || logs.contains("failed to download")
            || logs.contains("you need to agree to the eula")
            || logs.contains("unsupportedclassversion")
        {
            tracing::warn!(%app_id, "minecraft install failed (bad version/eula/java)");
            mc_mark_error(&state, sid).await;
            return;
        }
        match agent.status(&app_id).await {
            Ok(st) if st.oom_killed => {
                mc_mark_error(&state, sid).await;
                return;
            }
            Ok(st) if st.status.as_deref() == Some("restarting") => {
                restarting += 1;
                if restarting >= 2 {
                    mc_mark_error(&state, sid).await;
                    return;
                }
            }
            _ => restarting = 0,
        }
    }
    // Timed out without a "Done" line (very large world?) — the container is up,
    // so mark running best-effort.
    mc_mark_running(&state, sid).await;
}

/// Background: allocate the public port + relay proxy (TCP+UDP), then create the
/// Mumble container. Marks the server `error` on failure.
async fn provision_voice(state: AppState, server: Server, ram_mb: i64) {
    let Some(sid) = server.id else { return };
    let Some(c) = server.container.as_ref() else {
        return;
    };
    let app_id = c.app_id.clone();

    // Allocate the public port + push the relay's frpc config (TCP + UDP).
    let (relay_host, port) = match crate::frp::mc_ensure(&state, &server).await {
        Ok(Some((h, p))) => (h, p),
        _ => {
            tracing::warn!(%app_id, "voice: no relay/port available");
            mc_mark_error(&state, sid).await;
            return;
        }
    };

    // Point <sub>.artix.cloud at the relay (A record only) so the Mumble server
    // is reachable at <sub>.<zone>:<port> instead of the raw relay IP.
    if let Some(sub) = server.container.as_ref().and_then(|c| c.subdomain.clone()) {
        let _ = crate::cloudflare::set_voice_dns(&state, &sub, &relay_host).await;
    }

    let Some(agent) = state.agent.as_ref() else {
        mc_mark_error(&state, sid).await;
        return;
    };
    let body = serde_json::json!({
        "ram": ram_mb,
        "port": port,
        "adminPassword": c.admin_password,
        "serverName": server.name,
        "maxUsers": c.max_players,
        "serverPassword": c.voice_password,
    });
    if let Err(e) = agent.create_voice(&app_id, &body).await {
        tracing::warn!(%app_id, error = %e, "voice create failed");
        mc_mark_error(&state, sid).await;
        return;
    }

    // Mumble boots fast — wait for the container to be running, then mark ready.
    for _ in 0..12 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        match agent.status(&app_id).await {
            Ok(st) if st.oom_killed => {
                mc_mark_error(&state, sid).await;
                return;
            }
            Ok(st) if st.running => {
                mc_mark_running(&state, sid).await;
                return;
            }
            _ => {}
        }
    }
    mc_mark_running(&state, sid).await;
}

/// Reconcile Minecraft container state with the Docker VM so a crashed/stopped
/// server stops showing "running". Skips ones still provisioning.
async fn sync_mc_status(state: &AppState) {
    let Some(agent) = state.agent.as_ref() else {
        return;
    };
    let mut cur = match state
        .db
        .servers()
        .find(doc! {
            "type": 1,
            "container.container_type": "minecraft",
            "container.deployed": true,
        })
        .await
    {
        Ok(c) => c,
        Err(_) => return,
    };
    while cur.advance().await.unwrap_or(false) {
        let Ok(s) = cur.deserialize_current() else {
            continue;
        };
        if s.state == ServerState::Provisioning {
            continue;
        }
        let (Some(c), Some(sid)) = (s.container.as_ref(), s.id) else {
            continue;
        };
        if c.suspended {
            continue; // frozen by an admin — don't let the reconciler flip state
        }
        let st = match agent.status(&c.app_id).await {
            Ok(x) => x,
            Err(_) => continue,
        };
        let (state_str, status_str) = if !st.exists {
            ("error", "missing")
        } else if st.oom_killed || st.status.as_deref() == Some("restarting") {
            ("error", "error")
        } else if st.status.as_deref() == Some("running") {
            ("running", "running")
        } else {
            ("stopped", st.status.as_deref().unwrap_or("stopped"))
        };
        let cur_state = match s.state {
            ServerState::Running => "running",
            ServerState::Error => "error",
            ServerState::Stopped => "stopped",
            _ => "other",
        };
        if cur_state != state_str || c.status.as_deref() != Some(status_str) {
            let _ = state
                .db
                .servers()
                .update_one(
                    doc! { "_id": sid },
                    doc! { "$set": { "state": state_str, "container.status": status_str }},
                )
                .await;
        }
    }
}

/// Spawn the background Minecraft status reconciler (~every 60s).
pub fn spawn_status_worker(state: AppState) {
    if state.agent.is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tick.tick().await;
            sync_mc_status(&state).await;
        }
    });
    tracing::info!("minecraft status worker started");
}

// ----------------------------- buy RAM (checkout) -----------------------------

#[derive(Deserialize)]
pub struct PurchaseContainerReq {
    pub plan: String, // a RAM pack id (e.g. "c-1gb")
    #[serde(default)]
    pub method: Option<String>,
}

/// POST /containers/purchase — buy a RAM pack. Creates a RAM-grant subscription
/// + first invoice; the RAM is added to the account pool once the invoice is paid.
pub async fn purchase(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<PurchaseContainerReq>,
) -> AppResult<Json<crate::handlers::billing::CheckoutResponse>> {
    auth.scope(cap::BILLING)?;
    let (sub, invoice) = crate::billing::create_container_subscription(
        &state,
        &auth.user,
        req.plan.trim(),
        req.method.as_deref(),
    )
    .await?;
    Ok(Json(crate::handlers::billing::CheckoutResponse {
        subscription: sub.public(),
        invoice: invoice.public(),
    }))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerPublic>>> {
    auth.scope(cap::SERVICES_READ)?;
    // Caller sees: their own containers, containers in orgs they own/admin, and
    // containers individually granted to them (mirrors servers::list).
    let mut org_ids: Vec<ObjectId> = Vec::new();
    let mut members = state
        .db
        .org_members()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    while members.advance().await? {
        let m = members.deserialize_current()?;
        if matches!(
            m.role,
            crate::models::OrgRole::Owner | crate::models::OrgRole::Admin
        ) {
            org_ids.push(m.org_id);
        }
    }
    let mut granted_ids: Vec<ObjectId> = Vec::new();
    let mut grants = state
        .db
        .server_grants()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    while grants.advance().await? {
        granted_ids.push(grants.deserialize_current()?.server_id);
    }
    let filter = doc! {
        "type": 1,
        "$or": [
            { "user_id": auth.user_id },
            { "org_id": { "$in": &org_ids } },
            { "_id": { "$in": &granted_ids } },
        ],
    };
    let mut cursor = state.db.servers().find(filter).await?;
    let mut seen: std::collections::BTreeSet<ObjectId> = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    while cursor.advance().await? {
        let s = cursor.deserialize_current()?;
        if let Some(sid) = s.id {
            if seen.insert(sid) {
                out.push(s.public());
            }
        }
    }
    Ok(Json(out))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ServerPublic>> {
    auth.scope(cap::SERVICES_READ)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let (app_id, deployed) = {
        let c = require_container(&server)?;
        (c.app_id.clone(), c.deployed)
    };
    // Best-effort live status refresh from the agent (never fatal).
    if deployed {
        if let Ok(ag) = agent(&state) {
            if let Ok(st) = ag.status(&app_id).await {
                let status = st.status.clone().unwrap_or_else(|| "unknown".into());
                let _ = state
                    .db
                    .servers()
                    .update_one(
                        doc! { "_id": server.id.unwrap() },
                        doc! { "$set": { "container.status": &status } },
                    )
                    .await;
                if let Some(cc) = server.container.as_mut() {
                    cc.status = Some(status);
                }
            }
        }
    }
    Ok(Json(server.public()))
}

// ----------------------------- deploy -----------------------------

pub async fn deploy(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    mut mp: Multipart,
) -> AppResult<Json<crate::agent::DeployResult>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (app_id, env_json, ram_cap, subdomain, custom_domain) = {
        let c = require_container(&server)?;
        (
            c.app_id.clone(),
            env_to_json(&c.env),
            c.ram_mb.unwrap_or(256),
            c.subdomain.clone(),
            c.custom_domain.clone(),
        )
    };
    let ag = agent(&state)?;

    let mut zip: Option<Vec<u8>> = None;
    let mut cpus = 0.5f64;
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|_| AppError::Validation("bad multipart".into()))?
    {
        match field.name() {
            Some("bundle") => {
                let b = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::Validation("bad bundle".into()))?;
                zip = Some(b.to_vec());
            }
            Some("cpus") => {
                if let Ok(s) = field.text().await {
                    if let Ok(v) = s.parse::<f64>() {
                        if v.is_finite() {
                            cpus = v.clamp(0.1, 2.0);
                        }
                    }
                }
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }
    let zip = zip.ok_or_else(|| AppError::Validation("bundle required".into()))?;

    // In-flight guard: one deploy per container at a time (shared with the
    // GitHub/auto paths), so concurrent uploads can't race or double-log.
    let sid = server.id.unwrap();
    let claimed = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid, "container.deploying": { "$ne": true } },
            doc! { "$set": { "container.deploying": true } },
        )
        .await
        .map(|r| r.modified_count > 0)
        .unwrap_or(false);
    if !claimed {
        return Err(AppError::Conflict("a deploy is already in progress".into()));
    }

    // ram_cap is authoritative — the agent clamps the .artix RAM to it so a user
    // can't request more than their plan allows.
    let dep = match ag
        .deploy(
            &app_id,
            zip,
            env_json,
            cpus,
            ram_cap,
            subdomain.as_deref(),
            custom_domain.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => {
            let _ = state
                .db
                .servers()
                .update_one(
                    doc! { "_id": sid },
                    doc! { "$set": { "container.deploying": false } },
                )
                .await;
            record_deploy(
                &state,
                sid,
                auth.user_id,
                &auth.user.display_name,
                "zip",
                None,
                None,
                None,
                "failed",
                Some(&e.user_message()),
            )
            .await;
            return Err(e);
        }
    };

    // Persist echoed metadata + mark deployed/running.
    let now = Utc::now();
    let mut set = doc! {
        "container.runtime": dep.runtime.clone(),
        "container.image": dep.image.clone(),
        "container.build_log": dep.build_log.clone(),
        "container.port": dep.port,
        "container.ram_mb": dep.ram,
        "container.status": "running",
        "container.deployed": true,
        "container.deploying": false,
        "state": "running",
        "updated_at": bson::DateTime::from_chrono(now),
    };
    if let Some(s) = &dep.subdomain {
        set.insert("container.subdomain", s);
    }
    // Best-effort: the agent already deployed successfully, so a DB hiccup here
    // must not turn a live deploy into an error response (and must not skip the
    // history row).
    let _ = state
        .db
        .servers()
        .update_one(doc! { "_id": sid }, doc! { "$set": set })
        .await;

    record_deploy(
        &state,
        sid,
        auth.user_id,
        &auth.user.display_name,
        "zip",
        None,
        None,
        None,
        "success",
        None,
    )
    .await;
    crate::ws::publish(
        &state,
        format!("user:{}", auth.user_id.to_hex()),
        "container.deploy",
        serde_json::json!({ "id": sid.to_hex(), "source": "zip", "status": "success" }),
    );

    Ok(Json(dep))
}

// ----------------------------- deploy from GitHub -----------------------------

#[derive(Deserialize)]
pub struct DeployGithubReq {
    pub repo: String,
    #[serde(default, rename = "ref")]
    pub git_ref: Option<String>,
}

fn valid_repo(repo: &str) -> bool {
    let parts: Vec<&str> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 100
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        })
}

async fn persist_deploy(state: &AppState, server_id: ObjectId, dep: &crate::agent::DeployResult) {
    let now = Utc::now();
    let mut set = doc! {
        "container.runtime": dep.runtime.clone(),
        "container.image": dep.image.clone(),
        "container.build_log": dep.build_log.clone(),
        "container.port": dep.port,
        "container.ram_mb": dep.ram,
        "container.status": "running",
        "container.deployed": true,
        "container.deploying": false,
        "state": "running",
        "updated_at": bson::DateTime::from_chrono(now),
    };
    if let Some(s) = &dep.subdomain {
        set.insert("container.subdomain", s);
    }
    let _ = state
        .db
        .servers()
        .update_one(doc! { "_id": server_id }, doc! { "$set": set })
        .await;
}

/// POST /containers/:id/deploy-github — pull a repo zipball (with the caller's
/// GitHub token) and deploy it through the SAME agent path as a zip upload.
/// Append a deploy-history row (best-effort; never fails the request).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_deploy(
    state: &AppState,
    server_id: ObjectId,
    user_id: ObjectId,
    user_name: &str,
    source: &str,
    repo: Option<&str>,
    git_ref: Option<&str>,
    commit: Option<&str>,
    status: &str,
    error: Option<&str>,
) {
    let rec = crate::models::Deploy {
        id: None,
        server_id,
        user_id,
        user_name: user_name.to_string(),
        source: source.to_string(),
        repo: repo.map(str::to_string),
        git_ref: git_ref.map(str::to_string),
        commit: commit.map(str::to_string),
        status: status.to_string(),
        error: error.map(|e| e.chars().take(500).collect()),
        created_at: Utc::now(),
    };
    let _ = state.db.deploys().insert_one(&rec).await;
}

async fn delete_github_hook(state: &AppState, repo: &str, hook_id: i64, token: &str) {
    let _ = state
        .http
        .delete(format!(
            "https://api.github.com/repos/{repo}/hooks/{hook_id}"
        ))
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "ArtixCloud")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await;
}

/// Unset all auto-redeploy fields (and delete the remote hook if we can).
pub(crate) async fn disable_auto_deploy(
    state: &AppState,
    sid: ObjectId,
    delete: Option<(&str, i64, &str)>,
) {
    if let Some((repo, hid, token)) = delete {
        delete_github_hook(state, repo, hid, token).await;
    }
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$unset": {
                "container.github_hook_id": "",
                "container.webhook_secret": "",
            }},
        )
        .await;
}

/// Register (or refresh) the repo's push webhook for auto-redeploy. Best-effort:
/// if it fails the deploy still succeeded, auto-deploy just stays off.
async fn ensure_webhook(state: &AppState, sid: ObjectId, token: &str, repo: &str) {
    if state.cfg.public_webhook_base.is_empty() {
        return;
    }
    // Idempotent: already registered for this repo? do nothing. Repo changed? drop the old hook.
    if let Ok(Some(s)) = state.db.servers().find_one(doc! { "_id": sid }).await {
        if let Some(c) = s.container.as_ref() {
            if let Some(hid) = c.github_hook_id {
                if c.github_repo.as_deref() == Some(repo) {
                    return;
                }
                if let Some(old) = c.github_repo.as_deref() {
                    delete_github_hook(state, old, hid, token).await;
                }
            }
        }
    }
    let secret_plain = hex::encode((0..32).map(|_| rand::random::<u8>()).collect::<Vec<u8>>());
    let sealed = match crate::secretbox::seal(&state.cfg.auth_token_secret, secret_plain.as_bytes())
    {
        Ok(s) => s,
        Err(_) => return,
    };
    let url = format!(
        "{}/webhooks/github/{}",
        state.cfg.public_webhook_base.trim_end_matches('/'),
        sid.to_hex()
    );
    let body = serde_json::json!({
        "name": "web", "active": true, "events": ["push"],
        "config": { "url": url, "content_type": "json", "secret": secret_plain, "insecure_ssl": "0" }
    });
    let res = state
        .http
        .post(format!("https://api.github.com/repos/{repo}/hooks"))
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "ArtixCloud")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .json(&body)
        .send()
        .await;
    if let Ok(r) = res {
        if r.status().is_success() {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                if let Some(hid) = v.get("id").and_then(|x| x.as_i64()) {
                    let _ = state
                        .db
                        .servers()
                        .update_one(
                            doc! { "_id": sid },
                            doc! { "$set": {
                                "container.github_hook_id": hid,
                                "container.webhook_secret": sealed,
                            }},
                        )
                        .await;
                }
            }
        }
    }
}

/// Core GitHub deploy — used by the interactive handler AND the push webhook.
/// `source` = "github" | "auto". Records history + tracks repo/ref. An in-flight
/// guard prevents overlapping builds.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_github_deploy(
    state: &AppState,
    server: &Server,
    token: &str,
    repo: &str,
    requested_ref: Option<&str>,
    actor_id: ObjectId,
    actor_name: &str,
    source: &str,
    register_hook: bool,
) -> AppResult<crate::agent::DeployResult> {
    let sid = server.id.unwrap();
    // In-flight guard: claim the deploy or bail if one's running.
    let claimed = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid, "container.deploying": { "$ne": true } },
            doc! { "$set": { "container.deploying": true } },
        )
        .await
        .map(|r| r.modified_count > 0)
        .unwrap_or(false);
    if !claimed {
        return Err(AppError::Conflict("a deploy is already in progress".into()));
    }
    let out = run_github_deploy_inner(
        state,
        server,
        token,
        repo,
        requested_ref,
        actor_id,
        actor_name,
        source,
        register_hook,
    )
    .await;
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": { "container.deploying": false } },
        )
        .await;
    out
}

#[allow(clippy::too_many_arguments)]
async fn run_github_deploy_inner(
    state: &AppState,
    server: &Server,
    token: &str,
    repo: &str,
    requested_ref: Option<&str>,
    actor_id: ObjectId,
    actor_name: &str,
    source: &str,
    register_hook: bool,
) -> AppResult<crate::agent::DeployResult> {
    let (app_id, env_json, ram_cap, subdomain, custom_domain) = {
        let c = require_container(server)?;
        (
            c.app_id.clone(),
            env_to_json(&c.env),
            c.ram_mb.unwrap_or(256),
            c.subdomain.clone(),
            c.custom_domain.clone(),
        )
    };
    let sid = server.id.unwrap();
    let repo = repo.trim();
    if !valid_repo(repo) {
        return Err(AppError::Validation(
            "invalid repo (expected owner/name)".into(),
        ));
    }
    let ghget = |url: String| {
        state
            .http
            .get(url)
            .bearer_auth(token)
            .header(reqwest::header::USER_AGENT, "ArtixCloud")
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
    };

    // Resolve ref (validated), defaulting to the repo's default branch.
    let git_ref = match requested_ref.map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) => {
            if r.len() > 100
                || !r
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
            {
                return Err(AppError::Validation("invalid ref".into()));
            }
            r.to_string()
        }
        None => {
            let meta: serde_json::Value = ghget(format!("https://api.github.com/repos/{repo}"))
                .send()
                .await
                .map_err(|_| AppError::Unavailable("github unreachable".into()))?
                .json()
                .await
                .map_err(|_| AppError::Validation("repo not found".into()))?;
            meta.get("default_branch")
                .and_then(|x| x.as_str())
                .unwrap_or("main")
                .to_string()
        }
    };

    // Best-effort commit sha for the history entry.
    let commit: Option<String> = match ghget(format!(
        "https://api.github.com/repos/{repo}/commits/{git_ref}"
    ))
    .send()
    .await
    {
        Ok(r) => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("sha").and_then(|x| x.as_str()).map(|s| s.to_string())),
        Err(_) => None,
    };

    // Download the zipball server-side with the user's token.
    let res = ghget(format!(
        "https://api.github.com/repos/{repo}/zipball/{git_ref}"
    ))
    .send()
    .await;
    let res = match res {
        Ok(r) if r.status().is_success() => r,
        _ => {
            let e = "could not download the repo (check the repo/branch and access)";
            record_deploy(
                state,
                sid,
                actor_id,
                actor_name,
                source,
                Some(repo),
                Some(&git_ref),
                commit.as_deref(),
                "failed",
                Some(e),
            )
            .await;
            return Err(AppError::Validation(e.into()));
        }
    };
    let zip = res
        .bytes()
        .await
        .map_err(|_| AppError::Internal("zipball read".into()))?;
    if zip.len() > 100 * 1024 * 1024 {
        return Err(AppError::Validation("repo too large (max 100MB)".into()));
    }

    let dep = match agent(state)?
        .deploy(
            &app_id,
            zip.to_vec(),
            env_json,
            0.5,
            ram_cap,
            subdomain.as_deref(),
            custom_domain.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => {
            record_deploy(
                state,
                sid,
                actor_id,
                actor_name,
                source,
                Some(repo),
                Some(&git_ref),
                commit.as_deref(),
                "failed",
                Some(&e.user_message()),
            )
            .await;
            return Err(e);
        }
    };
    persist_deploy(state, sid, &dep).await;
    // Track the repo/ref so pushes can auto-redeploy.
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": { "container.github_repo": repo, "container.github_ref": &git_ref }},
        )
        .await;
    record_deploy(
        state,
        sid,
        actor_id,
        actor_name,
        source,
        Some(repo),
        Some(&git_ref),
        commit.as_deref(),
        "success",
        None,
    )
    .await;
    crate::ws::publish(
        state,
        format!("user:{}", server.user_id.to_hex()),
        "container.deploy",
        serde_json::json!({ "id": sid.to_hex(), "source": source, "status": "success", "repo": repo, "ref": git_ref }),
    );
    if register_hook {
        ensure_webhook(state, sid, token, repo).await;
    }
    Ok(dep)
}

pub async fn deploy_github(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<DeployGithubReq>,
) -> AppResult<Json<crate::agent::DeployResult>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    require_container(&server)?;
    let token = crate::handlers::account::github_token(&state, &auth)?;
    let dep = run_github_deploy(
        &state,
        &server,
        &token,
        req.repo.trim(),
        req.git_ref.as_deref(),
        auth.user_id,
        &auth.user.display_name,
        "github",
        true,
    )
    .await?;
    Ok(Json(dep))
}

/// GET /containers/:id/deploys — newest-first history (owner/viewer).
pub async fn deploys(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<crate::models::DeployPublic>>> {
    auth.scope(cap::HISTORY_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    require_container(&server)?;
    let sid = server.id.unwrap();
    let mut cursor = state
        .db
        .deploys()
        .find(doc! { "server_id": sid })
        .sort(doc! { "created_at": -1 })
        .limit(50)
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

// ----------------------------- custom domain -----------------------------

/// A valid public FQDN we may attach — not empty, not an artix.cloud name.
fn valid_domain(d: &str) -> bool {
    let d = d.trim().to_lowercase();
    !d.is_empty()
        && d.len() <= 253
        && !d.ends_with("artix.cloud")
        && d.split('.').count() >= 2
        && d.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

/// DoH lookup (Cloudflare) → `(type, data)` answers for `name`/`typ`.
async fn doh(http: &reqwest::Client, name: &str, typ: &str) -> Vec<(u64, String)> {
    let url = format!("https://cloudflare-dns.com/dns-query?name={name}&type={typ}");
    let v: serde_json::Value = match http
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/dns-json")
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or_default(),
        Err(_) => return vec![],
    };
    v.get("Answer")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| {
                    Some((
                        x.get("type")?.as_u64()?,
                        x.get("data")?
                            .as_str()?
                            .trim_end_matches('.')
                            .to_lowercase(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Does `domain` resolve (A record) to our relay's public IP? DoH follows any
/// CNAME chain, so this works whether the customer set an A record or a CNAME.
async fn domain_points_to_relay(http: &reqwest::Client, domain: &str, relay_ip: &str) -> bool {
    if relay_ip.is_empty() {
        return false;
    }
    doh(http, domain, "A")
        .await
        .into_iter()
        .any(|(t, d)| t == 1 && d == relay_ip)
}

#[derive(serde::Serialize)]
pub struct DomainStatus {
    pub domain: Option<String>,
    pub verified: bool,
    /// The relay IP the customer must point their domain's A record at.
    pub target_ip: Option<String>,
}

/// Ensure this is a site container and return its `app_id`.
fn site_app_id(c: &Container) -> AppResult<String> {
    if c.container_type != "site" {
        return Err(AppError::Validation(
            "custom domains are only for site containers".into(),
        ));
    }
    Ok(c.app_id.clone())
}

/// GET /containers/:id/domain — attached domain, live verification, relay IP.
pub async fn get_domain(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<DomainStatus>> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    site_app_id(c)?;
    let relay = state.cfg.custom_domain_relay_ip.clone();
    // Re-check DNS live so the badge reflects reality; persist any change.
    let verified = match c.custom_domain.as_deref() {
        Some(d) => {
            let v = domain_points_to_relay(&state.http, d, &relay).await;
            if v != c.custom_domain_verified {
                let _ = state
                    .db
                    .servers()
                    .update_one(
                        doc! { "_id": server.id.unwrap() },
                        doc! { "$set": { "container.custom_domain_verified": v }},
                    )
                    .await;
            }
            v
        }
        None => false,
    };
    Ok(Json(DomainStatus {
        domain: c.custom_domain.clone(),
        verified,
        target_ip: Some(relay),
    }))
}

#[derive(Deserialize)]
pub struct SetDomainReq {
    pub domain: String,
}

/// PUT /containers/:id/domain — attach (and verify) a custom domain to a site.
pub async fn set_domain(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SetDomainReq>,
) -> AppResult<Json<DomainStatus>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = {
        let c = require_container(&server)?;
        site_app_id(c)?
    };
    let sid = server.id.unwrap();
    let domain = req.domain.trim().to_lowercase();
    if !valid_domain(&domain) {
        return Err(AppError::Validation("invalid domain".into()));
    }
    let taken = state
        .db
        .servers()
        .count_documents(
            doc! { "type": 1, "container.custom_domain": &domain, "_id": { "$ne": sid } },
        )
        .await?;
    if taken > 0 {
        return Err(AppError::Conflict(
            "this domain is already attached to another site".into(),
        ));
    }
    let relay = state.cfg.custom_domain_relay_ip.clone();
    let verified = domain_points_to_relay(&state.http, &domain, &relay).await;
    // Add the Traefik Host rule so host nginx -> Traefik routes this domain.
    let _ = agent(&state)?.set_domain(&app_id, Some(&domain)).await;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": {
                "container.custom_domain": &domain,
                "container.custom_domain_verified": verified,
            }},
        )
        .await?;
    Ok(Json(DomainStatus {
        domain: Some(domain),
        verified,
        target_ip: Some(relay),
    }))
}

/// DELETE /containers/:id/domain — detach the custom domain.
pub async fn remove_domain(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<DomainStatus>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = {
        let c = require_container(&server)?;
        site_app_id(c)?
    };
    let _ = agent(&state)?.set_domain(&app_id, None).await;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id.unwrap() },
            doc! {
                "$unset": { "container.custom_domain": "" },
                "$set": { "container.custom_domain_verified": false },
            },
        )
        .await?;
    Ok(Json(DomainStatus {
        domain: None,
        verified: false,
        target_ip: Some(state.cfg.custom_domain_relay_ip.clone()),
    }))
}

#[derive(Deserialize)]
pub struct DomainAllowedQuery {
    pub domain: String,
}

/// GET /internal/domain-allowed?domain=X — Caddy on-demand-TLS gate (relay).
/// Returns 200 only when `X` is a custom domain registered on a site container,
/// so the relay's Caddy issues a Let's Encrypt cert only for domains our users
/// actually attached. No auth: reachable only from the relay over Tailscale
/// (the host nginx restricts this path to the tailnet).
pub async fn domain_allowed(
    State(state): State<AppState>,
    Query(q): Query<DomainAllowedQuery>,
) -> Response {
    let domain = q.domain.trim().to_lowercase();
    if !valid_domain(&domain) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let found = state
        .db
        .servers()
        .count_documents(doc! { "type": 1, "container.custom_domain": &domain })
        .await
        .unwrap_or(0);
    if found > 0 {
        StatusCode::OK.into_response()
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

#[derive(Deserialize)]
pub struct ConsoleReq {
    pub command: String,
}

/// POST /containers/:id/console — run a Minecraft server console command
/// (RCON for Java, console pipe for Bedrock).
pub async fn console(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ConsoleReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::CONSOLE)?;
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let c = require_container(&server)?;
    if c.container_type != "minecraft" {
        return Err(AppError::Validation(
            "console is only for minecraft servers".into(),
        ));
    }
    let cmd = req.command.trim();
    if cmd.is_empty() {
        return Err(AppError::Validation("command required".into()));
    }
    let out = agent(&state)?.console(&c.app_id, cmd).await?;
    Ok(Json(serde_json::json!({ "output": out })))
}

fn is_mc_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 16 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Parse the RCON `list` header → (online, max). Handles both wordings:
/// "There are 1 of a max of 20 players online" and "There are 1/20 players online".
fn parse_player_counts(s: &str) -> (i64, i64) {
    let low = s.to_lowercase();
    if let Some(i) = low.find("of a max of") {
        let online = low[..i]
            .split_whitespace()
            .last()
            .and_then(|t| t.parse().ok())
            .unwrap_or(0);
        let max = low[i + "of a max of".len()..]
            .split_whitespace()
            .next()
            .and_then(|t| t.parse().ok())
            .unwrap_or(0);
        return (online, max);
    }
    // "there are 1/20 players online[:...]"
    if let Some(i) = low.find("there are ") {
        if let Some(tok) = low[i + "there are ".len()..].split_whitespace().next() {
            if let Some((a, b)) = tok.split_once('/') {
                return (a.trim().parse().unwrap_or(0), b.trim().parse().unwrap_or(0));
            }
        }
    }
    (0, 0)
}

/// Walk timestamped logs, tracking each player's current session start (last
/// "joined the game" not yet followed by "left the game").
fn parse_sessions(logs: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in logs.lines() {
        let ts = line.split_whitespace().next().unwrap_or("");
        let Some(rest) = line.split("]: ").nth(1) else {
            continue;
        };
        let rest = rest.trim();
        if let Some(name) = rest.strip_suffix(" joined the game") {
            if is_mc_name(name.trim()) {
                map.insert(name.trim().to_string(), ts.to_string());
            }
        } else if let Some(name) = rest.strip_suffix(" left the game") {
            map.remove(name.trim());
        }
    }
    map
}

/// GET /containers/:id/players — online players (name + session start) + counts.
pub async fn mc_players(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::CONSOLE)?;
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let c = require_container(&server)?;
    if c.container_type != "minecraft" {
        return Err(AppError::Validation("only for minecraft servers".into()));
    }
    let ag = agent(&state)?;
    let list = ag.console(&c.app_id, "list").await.unwrap_or_default();
    let (online, max) = parse_player_counts(&list);
    let names: Vec<String> = list
        .splitn(2, ':')
        .nth(1)
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| is_mc_name(x))
                .collect()
        })
        .unwrap_or_default();
    let sessions = parse_sessions(
        &ag.logs(&c.app_id, 2000)
            .await
            .map(|l| l.logs)
            .unwrap_or_default(),
    );
    let players: Vec<_> = names
        .iter()
        .map(|n| serde_json::json!({ "name": n, "since": sessions.get(n).cloned() }))
        .collect();
    Ok(Json(
        serde_json::json!({ "online": online, "max": max, "players": players }),
    ))
}

/// Where a Minecraft server loads add-ons: `plugins` (Bukkit-based) or `mods`
/// (Fabric/Forge). `None` = this server can't run add-ons (Vanilla/Bedrock).
fn mc_addon_dir(software: Option<&str>) -> Option<&'static str> {
    match software.map(str::to_uppercase).as_deref() {
        Some("PAPER") | Some("PURPUR") | Some("SPIGOT") | Some("BUKKIT") => Some("plugins"),
        Some("FABRIC") | Some("FORGE") | Some("QUILT") | Some("NEOFORGE") => Some("mods"),
        _ => None,
    }
}

/// POST /containers/:id/plugin — upload a plugin/mod .jar to the server volume.
pub async fn upload_plugin(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    mut mp: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (app_id, dir) = {
        let c = require_container(&server)?;
        if c.container_type != "minecraft" {
            return Err(AppError::Validation("only for minecraft servers".into()));
        }
        let dir = mc_addon_dir(c.software.as_deref()).ok_or_else(|| {
            AppError::Validation("this server type doesn't support plugins/mods".into())
        })?;
        (c.app_id.clone(), dir)
    };

    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("upload.jar");
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|_| AppError::Validation("bad multipart".into()))?
    {
        if field.name() == Some("file") {
            if let Some(f) = field.file_name() {
                filename = f.to_string();
            }
            let b = field
                .bytes()
                .await
                .map_err(|_| AppError::Validation("bad file".into()))?;
            bytes = Some(b.to_vec());
        } else {
            let _ = field.bytes().await;
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::Validation("file required".into()))?;
    if !filename.to_lowercase().ends_with(".jar") {
        return Err(AppError::Validation("only .jar files".into()));
    }
    agent(&state)?
        .upload_file(&app_id, dir, &filename, bytes)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "dir": dir })))
}

#[derive(Deserialize)]
pub struct DeletePluginReq {
    pub name: String,
}

/// POST /containers/:id/plugin/delete — remove a plugin/mod by filename.
pub async fn delete_plugin(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<DeletePluginReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let c = require_container(&server)?;
    let dir = mc_addon_dir(c.software.as_deref()).ok_or_else(|| {
        AppError::Validation("this server type doesn't support plugins/mods".into())
    })?;
    let name = req.name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::Validation("bad name".into()));
    }
    agent(&state)?
        .delete_file(&c.app_id, &format!("{dir}/{name}"))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct MaxPlayersReq {
    pub max: i32,
}

/// PUT /containers/:id/max-players — set the player limit (capped by RAM). More
/// RAM raises the cap. Applies via the itzg env + a restart.
pub async fn set_max_players(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<MaxPlayersReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let ram = {
        let c = require_container(&server)?;
        if c.container_type != "minecraft" {
            return Err(AppError::Validation("only for minecraft servers".into()));
        }
        c.ram_mb.unwrap_or(1024)
    };
    let cap = mc_player_cap(ram);
    if req.max < 1 || req.max > cap {
        return Err(AppError::Validation(format!(
            "max players must be between 1 and {cap} — buy more RAM for a higher limit"
        )));
    }
    let sid = server.id.unwrap();
    // Recreate the container so the new MAX_PLAYERS is baked into the env: itzg
    // re-applies its env vars to server.properties on every (re)start, so a plain
    // server.properties edit + restart gets clobbered back to the old value.
    // Recreate keeps the world (named volume).
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": { "container.max_players": req.max, "state": "provisioning" }},
        )
        .await?;
    if let Some(cc) = server.container.as_mut() {
        cc.max_players = Some(req.max);
    }
    server.state = ServerState::Provisioning;
    tokio::spawn(provision_minecraft(state.clone(), server.clone(), ram));
    Ok(Json(
        serde_json::json!({ "ok": true, "max_players": req.max, "cap": cap }),
    ))
}

// ----------------------------- backups + world -----------------------------

fn valid_backup_name(n: &str) -> bool {
    n.starts_with("backup-")
        && n.ends_with(".tar.gz")
        && n.len() > "backup-.tar.gz".len()
        && n["backup-".len()..n.len() - ".tar.gz".len()]
            .chars()
            .all(|c| c.is_ascii_digit())
}

fn mc_app_id(server: &Server) -> AppResult<String> {
    let c = require_container(server)?;
    if c.container_type != "minecraft" {
        return Err(AppError::Validation("only for minecraft servers".into()));
    }
    Ok(c.app_id.clone())
}

/// POST /containers/:id/backup — snapshot the world/data.
pub async fn create_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    Ok(Json(agent(&state)?.backup(&app_id).await?))
}

/// GET /containers/:id/backups — list snapshots.
pub async fn list_backups(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let app_id = mc_app_id(&server)?;
    Ok(Json(agent(&state)?.list_backups(&app_id).await?))
}

#[derive(Deserialize)]
pub struct BackupNameReq {
    pub name: String,
}

/// POST /containers/:id/backup/restore — restore a snapshot (stops + restarts).
pub async fn restore_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<BackupNameReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    if !valid_backup_name(req.name.trim()) {
        return Err(AppError::Validation("bad backup name".into()));
    }
    agent(&state)?
        .restore_backup(&app_id, req.name.trim())
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /containers/:id/backup/delete — remove a snapshot.
pub async fn delete_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<BackupNameReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    if !valid_backup_name(req.name.trim()) {
        return Err(AppError::Validation("bad backup name".into()));
    }
    agent(&state)?
        .delete_backup(&app_id, req.name.trim())
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /containers/:id/world — import a world/data archive (.zip or .tar.gz).
pub async fn upload_world(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    mut mp: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;

    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("world.zip");
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|_| AppError::Validation("bad multipart".into()))?
    {
        if field.name() == Some("file") {
            if let Some(f) = field.file_name() {
                filename = f.to_string();
            }
            bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|_| AppError::Validation("bad file".into()))?
                    .to_vec(),
            );
        } else {
            let _ = field.bytes().await;
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::Validation("file required".into()))?;
    let low = filename.to_lowercase();
    if !(low.ends_with(".zip") || low.ends_with(".tar.gz") || low.ends_with(".tgz")) {
        return Err(AppError::Validation("use a .zip or .tar.gz archive".into()));
    }
    agent(&state)?
        .upload_world(&app_id, &filename, bytes)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct WorldUrlReq {
    pub url: String,
}

/// POST /containers/:id/world-url — restore a world/data archive from a URL. The
/// agent downloads it server-side, which sidesteps the panel's Cloudflare upload
/// cap (~100MB) — so big backups (multi-GB) work. The download can take minutes,
/// well past Cloudflare's request timeout, so we kick it off in the background
/// (the server shows `provisioning`) and return immediately.
pub async fn import_world_url(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<WorldUrlReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    let url = req.url.trim().to_string();
    let low = url.to_lowercase();
    if !(low.starts_with("http://") || low.starts_with("https://")) {
        return Err(AppError::Validation(
            "Use um link http(s) de download direto.".into(),
        ));
    }
    if url.len() > 2048 {
        return Err(AppError::Validation("Link muito longo.".into()));
    }
    let sid = server.id.unwrap();
    // Show the restore in progress; the agent does the heavy lifting async so this
    // request can't block on a multi-GB download.
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": { "state": "provisioning" } },
        )
        .await?;
    let st = state.clone();
    tokio::spawn(async move {
        let Some(agent) = st.agent.as_ref() else {
            mc_mark_error(&st, sid).await;
            return;
        };
        match agent.import_world_url(&app_id, &url).await {
            Ok(_) => mc_mark_running(&st, sid).await,
            Err(e) => {
                // Persist a short reason so the panel can show why it failed.
                let _ = st
                    .db
                    .servers()
                    .update_one(
                        doc! { "_id": sid },
                        doc! { "$set": {
                            "state": "error",
                            "container.status": "error",
                            "container.build_log": e.user_message(),
                        }},
                    )
                    .await;
            }
        }
    });
    Ok(Json(serde_json::json!({ "ok": true, "started": true })))
}

/// POST /containers/:id/icon — set the server icon (64x64 PNG).
pub async fn upload_icon(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    mut mp: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("icon.png");
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|_| AppError::Validation("bad multipart".into()))?
    {
        if field.name() == Some("file") {
            if let Some(f) = field.file_name() {
                filename = f.to_string();
            }
            bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|_| AppError::Validation("bad file".into()))?
                    .to_vec(),
            );
        } else {
            let _ = field.bytes().await;
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::Validation("file required".into()))?;
    if !filename.to_lowercase().ends_with(".png") {
        return Err(AppError::Validation("use a .png image".into()));
    }
    agent(&state)?
        .upload_icon(&app_id, &filename, bytes)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /containers/:id/icon — stream the current server icon (for the panel
/// preview). 404 when none is set yet.
pub async fn get_icon(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Response> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let app_id = mc_app_id(&server)?;
    match agent(&state)?.get_icon(&app_id).await? {
        Some(upstream) => {
            let body = axum::body::Body::from_stream(upstream.bytes_stream());
            Response::builder()
                .header("content-type", "image/png")
                .header("cache-control", "no-store")
                .body(body)
                .map_err(|_| AppError::Internal("response build".into()))
        }
        None => Err(AppError::NotFound),
    }
}

#[derive(Deserialize)]
pub struct RenameReq {
    pub name: String,
}

/// PUT /containers/:id/name — rename the server (its panel display name).
pub async fn rename_container(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<RenameReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(AppError::Validation("name must be 1–40 characters".into()));
    }
    let sid = server.id.ok_or(AppError::NotFound)?;
    state
        .db
        .servers()
        .update_one(doc! { "_id": sid }, doc! { "$set": { "name": name } })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true, "name": name })))
}

#[derive(Deserialize)]
pub struct BackupDownloadQuery {
    pub name: String,
}

/// GET /containers/:id/backup/download — stream a snapshot to the browser.
pub async fn download_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<BackupDownloadQuery>,
) -> AppResult<Response> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let app_id = mc_app_id(&server)?;
    let name = q.name.trim();
    if !valid_backup_name(name) {
        return Err(AppError::Validation("bad backup name".into()));
    }
    let upstream = agent(&state)?.download_backup(&app_id, name).await?;
    let body = axum::body::Body::from_stream(upstream.bytes_stream());
    Response::builder()
        .header("content-type", "application/gzip")
        .header(
            "content-disposition",
            format!("attachment; filename=\"{name}\""),
        )
        .body(body)
        .map_err(|_| AppError::Internal("response build".into()))
}

// ----------------------------- settings + reprovision -----------------------------

/// server.properties keys a user may set from the panel (safe subset).
const MC_ALLOWED_PROPS: &[&str] = &[
    "motd",
    "difficulty",
    "gamemode",
    "pvp",
    "online-mode",
    "hardcore",
    "white-list",
    "enforce-whitelist",
    "spawn-protection",
    "view-distance",
    "simulation-distance",
    "allow-nether",
    "allow-flight",
    "level-seed",
];

#[derive(Deserialize)]
pub struct McSettingsReq {
    pub props: std::collections::HashMap<String, String>,
}

/// PUT /containers/:id/settings — set safe server.properties keys + restart.
pub async fn set_mc_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<McSettingsReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let app_id = mc_app_id(&server)?;
    let mut props = serde_json::Map::new();
    for (k, v) in req.props {
        if MC_ALLOWED_PROPS.contains(&k.as_str()) && !v.contains(['\n', '\r']) && v.len() <= 256 {
            props.insert(k, serde_json::Value::String(v));
        }
    }
    if props.is_empty() {
        return Err(AppError::Validation("no valid settings".into()));
    }
    agent(&state)?
        .set_settings(&app_id, serde_json::Value::Object(props))
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ReprovisionReq {
    #[serde(default)]
    pub software: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

/// POST /containers/:id/reprovision — change software/version, keeping the world
/// (same edition/port/volume). Recreates the container in the background.
pub async fn reprovision_mc(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ReprovisionReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (sid, ram_mb, software, version) = {
        let c = require_container(&server)?;
        if c.container_type != "minecraft" {
            return Err(AppError::Validation("only for minecraft servers".into()));
        }
        let software = req
            .software
            .as_deref()
            .map(|s| s.trim().to_uppercase())
            .filter(|s| ["VANILLA", "PAPER", "PURPUR", "FABRIC", "FORGE"].contains(&s.as_str()))
            .unwrap_or_else(|| c.software.clone().unwrap_or_else(|| "VANILLA".into()));
        let version = req
            .version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| c.version.as_deref().unwrap_or("LATEST"))
            .to_string();
        (
            server.id.unwrap(),
            c.ram_mb.unwrap_or(1024),
            software,
            version,
        )
    };
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": {
                "container.software": &software,
                "container.version": &version,
                "state": "provisioning",
            }},
        )
        .await?;
    if let Some(c) = server.container.as_mut() {
        c.software = Some(software);
        c.version = Some(version);
    }
    server.state = ServerState::Provisioning;
    tokio::spawn(provision_minecraft(state.clone(), server.clone(), ram_mb));
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct SetRamReq {
    pub ram_mb: i64,
}

/// PUT /containers/:id/ram — change a Minecraft server's RAM. Recreates the
/// container with the new memory limit + JVM heap; the world is preserved on the
/// volume. Draws the difference from the account's RAM pool.
pub async fn set_mc_ram(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SetRamReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    // Same per-user RAM lock as create(): raising a container's RAM reads the pool
    // (account_ram below) then writes — check-then-act. Serialize it so concurrent
    // grows (or a grow racing a create) can't both pass and overshoot the pool.
    let ram_gate = ram_lock(auth.user_id);
    let _ram_guard = ram_gate.lock().await;
    let mut server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (sid, cur_ram) = {
        let c = require_container(&server)?;
        if c.container_type != "minecraft" {
            return Err(AppError::Validation("only for minecraft servers".into()));
        }
        (server.id.unwrap(), c.ram_mb.unwrap_or(1024))
    };
    let new_ram = req.ram_mb;
    let min = type_min_ram("minecraft");
    if new_ram < min {
        return Err(AppError::Validation(format!(
            "Servidor de Minecraft precisa de no mínimo {min} MB RAM."
        )));
    }
    if new_ram == cur_ram {
        return Ok(Json(serde_json::json!({ "ok": true, "unchanged": true })));
    }
    // Pool check: `used` already counts this container's current RAM, so add it
    // back to get how much this one server may grow to.
    let (total, used) = account_ram(&state, &auth.user).await?;
    let max_for_this = total - used + cur_ram;
    if new_ram > max_for_this {
        return Err(AppError::Conflict(format!(
            "RAM insuficiente: você pode usar até {max_for_this} MB neste servidor (de {total} MB no total). Compre mais RAM."
        )));
    }
    // On an increase, make sure the Docker VM can fit the extra RAM.
    if new_ram > cur_ram {
        if let Some(a) = state.agent.as_ref() {
            if let Some(free) = a.host_available_mb().await {
                if free < (new_ram - cur_ram) + 512 {
                    return Err(AppError::Unavailable(
                        "sem capacidade no servidor de containers agora — tente um valor menor ou novamente em instantes.".into(),
                    ));
                }
            }
        }
    }
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid },
            doc! { "$set": {
                "container.ram_mb": new_ram,
                "state": "provisioning",
            }},
        )
        .await?;
    if let Some(c) = server.container.as_mut() {
        c.ram_mb = Some(new_ram);
    }
    server.state = ServerState::Provisioning;
    tokio::spawn(provision_minecraft(state.clone(), server.clone(), new_ram));
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- voice (Mumble) settings -----------------------------

#[derive(Deserialize)]
pub struct VoiceSettingsReq {
    #[serde(default)]
    pub max_users: Option<i32>,
    /// Join password; empty string opens the server. Absent = leave unchanged.
    #[serde(default)]
    pub server_password: Option<String>,
    /// Regenerate the SuperUser (admin) password.
    #[serde(default)]
    pub regen_admin: Option<bool>,
}

/// PUT /containers/:id/voice — change a voice server's settings. Recreates the
/// container with the new config baked in; the data/registrations volume persists.
pub async fn set_voice(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<VoiceSettingsReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let mut server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (sid, ram) = {
        let c = require_container(&server)?;
        if c.container_type != "voice" {
            return Err(AppError::Validation("only for voice servers".into()));
        }
        (server.id.unwrap(), c.ram_mb.unwrap_or(512))
    };
    let mut set = doc! { "state": "provisioning" };
    if let Some(mu) = req.max_users {
        if !(1..=500).contains(&mu) {
            return Err(AppError::Validation(
                "max users must be between 1 and 500".into(),
            ));
        }
        set.insert("container.max_players", mu);
        if let Some(c) = server.container.as_mut() {
            c.max_players = Some(mu);
        }
    }
    if let Some(pw) = req.server_password.as_ref() {
        let pw = pw.trim();
        if pw.chars().count() > 60 {
            return Err(AppError::Validation("password too long".into()));
        }
        let val = if pw.is_empty() {
            None
        } else {
            Some(pw.to_string())
        };
        set.insert(
            "container.voice_password",
            val.clone()
                .map(bson::Bson::String)
                .unwrap_or(bson::Bson::Null),
        );
        if let Some(c) = server.container.as_mut() {
            c.voice_password = val;
        }
    }
    if req.regen_admin == Some(true) {
        let pw = crate::auth::token::generate_password();
        set.insert("container.admin_password", &pw);
        if let Some(c) = server.container.as_mut() {
            c.admin_password = Some(pw);
        }
    }
    state
        .db
        .servers()
        .update_one(doc! { "_id": sid }, doc! { "$set": set })
        .await?;
    server.state = ServerState::Provisioning;
    tokio::spawn(provision_voice(state.clone(), server.clone(), ram));
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- community voice (LiveKit) -----------------------------

/// Build a LiveKit access JWT (HS256) for a room join.
fn livekit_jwt(claims: &serde_json::Value, secret: &[u8]) -> String {
    use base64::Engine;
    use hmac::Mac;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let header = b64.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = b64.encode(serde_json::to_vec(claims).unwrap_or_default());
    let signing_input = format!("{header}.{payload}");
    let mut mac =
        hmac::Hmac::<sha2::Sha256>::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(signing_input.as_bytes());
    let sig = b64.encode(mac.finalize().into_bytes());
    format!("{signing_input}.{sig}")
}

/// POST /community/voice-token — a LiveKit join token for the shared community
/// voice call. Any authenticated user may join.
pub async fn community_voice_token(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let key = &state.cfg.livekit_api_key;
    let secret = &state.cfg.livekit_api_secret;
    if key.is_empty() || secret.is_empty() {
        return Err(AppError::Unavailable("voice chat is not configured".into()));
    }
    let now = chrono::Utc::now().timestamp();
    let identity = auth.user_id.to_hex();
    let claims = serde_json::json!({
        "iss": key,
        "sub": identity,
        "name": auth.user.display_name.clone(),
        "nbf": now - 10,
        "exp": now + 6 * 3600,
        "video": {
            "room": "community",
            "roomJoin": true,
            "canPublish": true,
            "canSubscribe": true,
            "canPublishData": true,
        },
    });
    let token = livekit_jwt(&claims, secret.as_bytes());
    Ok(Json(serde_json::json!({
        "token": token,
        "url": state.cfg.livekit_url,
        "identity": identity,
    })))
}

/// Channels users may read/post in the community chat.
const CHAT_CHANNELS: &[&str] = &["geral"];

/// GET /community/voice-state — who is currently in the community voice call and
/// whether they are muted, read live from LiveKit's RoomService. Best-effort: if
/// LiveKit is unreachable we return an empty roster (200), never a 500. 503 when
/// the integration is not configured (no key pair, or no `LIVEKIT_HOST_URL`).
pub async fn community_voice_state(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let key = &state.cfg.livekit_api_key;
    let secret = &state.cfg.livekit_api_secret;
    if key.is_empty() || secret.is_empty() {
        return Err(AppError::Unavailable("voice chat is not configured".into()));
    }
    // The roster comes from LiveKit's server API, whose internal address has no
    // default: without LIVEKIT_HOST_URL there is nothing to ask.
    if state.cfg.livekit_host_url.is_empty() {
        return Err(AppError::Unavailable(
            "voice chat roster is not configured".into(),
        ));
    }
    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "iss": key,
        "exp": now + 600,
        "video": {
            "room": "community",
            "roomAdmin": true,
        },
    });
    let token = livekit_jwt(&claims, secret.as_bytes());
    let url = format!(
        "{}/twirp/livekit.RoomService/ListParticipants",
        state.cfg.livekit_host_url
    );
    let empty = || Json(serde_json::json!({ "participants": [] }));
    let resp = match state
        .http
        .post(&url)
        .bearer_auth(&token)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "room": "community" }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(empty()),
    };
    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(empty()),
    };
    let participants: Vec<serde_json::Value> = body
        .get("participants")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| {
                    let identity = p.get("identity").and_then(|v| v.as_str()).unwrap_or("");
                    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    // muted = no live (unmuted) audio track. Twirp's proto-JSON
                    // omits default fields, so an unmuted audio track can arrive
                    // with neither `type` (AUDIO == enum 0) nor `muted` (false):
                    // treat an absent type as audio and an absent muted as false.
                    let has_live_audio = p
                        .get("tracks")
                        .and_then(|t| t.as_array())
                        .map(|tracks| {
                            tracks.iter().any(|t| {
                                let ty = t.get("type").and_then(|v| v.as_str());
                                let is_audio = matches!(ty, None | Some("AUDIO"));
                                let is_muted =
                                    t.get("muted").and_then(|v| v.as_bool()) == Some(true);
                                is_audio && !is_muted
                            })
                        })
                        .unwrap_or(false);
                    serde_json::json!({
                        "identity": identity,
                        "name": name,
                        "muted": !has_live_audio,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(serde_json::json!({ "participants": participants })))
}

/// GET /community/chat?channel=geral — the last 50 messages of a channel, oldest
/// first. The channel must be allowlisted.
pub async fn get_community_chat(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(q): Query<ChatQuery>,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    let channel = q.channel.trim();
    if !CHAT_CHANNELS.contains(&channel) {
        return Err(AppError::Validation("invalid channel".into()));
    }
    let mut cursor = state
        .db
        .chat_messages()
        .find(doc! { "channel": channel })
        .sort(doc! { "created_at": -1 })
        .limit(50)
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        let m = cursor.deserialize_current()?;
        out.push(serde_json::json!({
            "id": m.id.map(|o| o.to_hex()).unwrap_or_default(),
            "name": m.name,
            "text": m.text,
            "user_id": m.user_id.to_hex(),
            "created_at": m.created_at.to_rfc3339(),
        }));
    }
    out.reverse(); // oldest -> newest
    Ok(Json(out))
}

/// Per-user last-post timestamp (ms) for a light anti-flood cooldown on chat.
static CHAT_LAST: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<ObjectId, i64>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// POST /community/chat — send a message to an allowlisted channel.
pub async fn post_community_chat(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<PostChatReq>,
) -> AppResult<Json<serde_json::Value>> {
    let channel = req.channel.trim();
    if !CHAT_CHANNELS.contains(&channel) {
        return Err(AppError::Validation("invalid channel".into()));
    }
    let text = req.text.trim().to_string();
    if text.is_empty() || text.chars().count() > 500 {
        return Err(AppError::Validation(
            "message must be 1-500 characters".into(),
        ));
    }
    // Light per-user anti-flood: at most one message every 700ms.
    {
        let now_ms = Utc::now().timestamp_millis();
        let mut last = CHAT_LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(&prev) = last.get(&auth.user_id) {
            if now_ms - prev < 700 {
                return Err(AppError::Validation("devagar — espere um instante".into()));
            }
        }
        if last.len() > 5000 {
            last.clear();
        }
        last.insert(auth.user_id, now_ms);
    }
    let msg = crate::models::ChatMessage {
        id: None,
        channel: channel.to_string(),
        user_id: auth.user_id,
        name: auth.user.display_name.clone(),
        text,
        created_at: Utc::now(),
    };
    state.db.chat_messages().insert_one(&msg).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ChatQuery {
    #[serde(default)]
    pub channel: String,
}

#[derive(Deserialize)]
pub struct PostChatReq {
    pub channel: String,
    pub text: String,
}

// ----------------------------- files (browse / edit) -----------------------------

#[derive(Deserialize)]
pub struct FilesQuery {
    #[serde(default)]
    pub path: String,
}

/// GET /containers/:id/files?path= — list a directory inside the app.
pub async fn list_files(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<FilesQuery>,
) -> AppResult<Json<crate::agent::FilesResult>> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    Ok(Json(agent(&state)?.list_files(&c.app_id, &q.path).await?))
}

/// GET /containers/:id/file?path= — read a single text file.
pub async fn read_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<FilesQuery>,
) -> AppResult<Json<crate::agent::FileContent>> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    Ok(Json(agent(&state)?.read_file(&c.app_id, &q.path).await?))
}

#[derive(Deserialize)]
pub struct WriteFileReq {
    pub path: String,
    pub content: String,
}

/// PUT /containers/:id/file — write a file. Blocked for GitHub-sourced apps
/// (those must be edited in the repo; a push auto-redeploys).
pub async fn write_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<WriteFileReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let c = require_container(&server)?;
    if c.github_repo.is_some() {
        return Err(AppError::Validation(
            "this app is deployed from GitHub — edit the files in the repo (a push auto-redeploys)"
                .into(),
        ));
    }
    agent(&state)?
        .write_file(&c.app_id, &req.path, &req.content)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- status / stats / logs -----------------------------

pub async fn status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<crate::agent::StatusResult>> {
    auth.scope(cap::METRICS_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    Ok(Json(agent(&state)?.status(&c.app_id).await?))
}

pub async fn stats(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<crate::agent::StatsResult>> {
    auth.scope(cap::METRICS_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    Ok(Json(agent(&state)?.stats(&c.app_id).await?))
}

#[derive(Deserialize)]
pub struct LogsQuery {
    #[serde(default)]
    pub tail: Option<u32>,
}

pub async fn logs(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<LogsQuery>,
) -> AppResult<Json<crate::agent::LogsResult>> {
    auth.scope(cap::LOGS_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    let tail = q.tail.unwrap_or(300).min(3000);
    Ok(Json(agent(&state)?.logs(&c.app_id, tail).await?))
}

// ----------------------------- actions -----------------------------

#[derive(Deserialize)]
pub struct ActionReq {
    pub action: String,
}

pub async fn action(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ActionReq>,
) -> AppResult<Response> {
    auth.scope(cap::SERVICES_RESTART)?;
    // Actions this key may run (all require `services.restart`).
    const ALLOWED: [&str; 3] = ["start", "stop", "restart"];
    let action = req.action.trim();
    if !ALLOWED.contains(&action) {
        // Dev-friendly, self-documenting error: name the mistake and list what's
        // accepted, so integrators don't guess by trial and error.
        let body = serde_json::json!({
            "error": "invalid_action",
            "message": format!("The action '{action}' is invalid."),
            "allowed_actions": ALLOWED,
        });
        return Ok((StatusCode::BAD_REQUEST, Json(body)).into_response());
    }
    let server = access(&state, auth.user_id, &id, server_perm::POWER).await?;
    let c = require_container(&server)?;
    if c.suspended {
        return Err(AppError::Conflict(
            "Container suspenso — não é possível iniciar, parar ou reiniciar. Fale com o suporte."
                .into(),
        ));
    }
    // The Docker container is only created by a successful deploy. Without one
    // there is nothing to act on — say so, instead of letting Docker's raw
    // "No such container" bubble up to the user.
    if !c.deployed {
        return Err(AppError::Conflict(
            "Este container ainda não foi criado — envie um deploy do seu código primeiro.".into(),
        ));
    }
    agent(&state)?.action(&c.app_id, action).await?;
    let mapped = match action {
        "stop" => "stopped",
        _ => "running",
    };
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id.unwrap() },
            doc! { "$set": { "container.status": mapped } },
        )
        .await;
    // Realtime event for the owner's SSE/WS stream.
    crate::ws::publish(
        &state,
        format!("user:{}", auth.user_id.to_hex()),
        "container.action",
        serde_json::json!({ "id": id, "action": action, "status": mapped }),
    );
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "status": mapped })),
    )
        .into_response())
}

// ----------------------------- env -----------------------------

pub async fn get_env(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_READ)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let c = require_container(&server)?;
    let val: serde_json::Value = match &c.env {
        Some(d) => serde_json::to_value(d).unwrap_or_else(|_| serde_json::json!({})),
        None => serde_json::json!({}),
    };
    Ok(Json(val))
}

#[derive(Deserialize)]
pub struct SetEnvReq {
    pub env: serde_json::Value,
}

pub async fn set_env(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<SetEnvReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_CREATE)?;
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let c = require_container(&server)?;
    // Validate before it reaches the agent's env-file: keys must look like env
    // vars and values must be single-line strings (no newline injection).
    let obj = req
        .env
        .as_object()
        .ok_or_else(|| AppError::Validation("env must be an object".into()))?;
    if obj.len() > 100 {
        return Err(AppError::Validation("too many env vars (max 100)".into()));
    }
    for (k, v) in obj {
        let valid_key = !k.is_empty()
            && k.len() <= 128
            && k.chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid_key {
            return Err(AppError::Validation(format!("invalid env key: {k}")));
        }
        let s = v
            .as_str()
            .ok_or_else(|| AppError::Validation(format!("env {k} must be a string")))?;
        if s.len() > 4096 || s.contains(['\n', '\r', '\0']) {
            return Err(AppError::Validation(format!(
                "env {k} has invalid characters"
            )));
        }
    }
    let env_doc =
        bson::to_document(&req.env).map_err(|_| AppError::Validation("invalid env".into()))?;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id.unwrap() },
            doc! { "$set": { "container.env": &env_doc } },
        )
        .await?;
    // Push to the agent (applies on next restart/deploy).
    if c.deployed {
        let _ = agent(&state)?.set_env(&c.app_id, req.env).await;
    }
    Ok(Json(
        serde_json::json!({ "ok": true, "note": "restart to apply" }),
    ))
}

// ----------------------------- delete -----------------------------

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.scope(cap::SERVICES_DELETE)?;
    let server = access(&state, auth.user_id, &id, server_perm::DELETE).await?;
    let c = require_container(&server)?;
    if c.suspended {
        return Err(AppError::Conflict(
            "Container suspenso não pode ser deletado. Fale com o suporte.".into(),
        ));
    }
    let was_minecraft = c.mc_port.is_some();
    let mc_sub = if was_minecraft {
        c.subdomain.clone()
    } else {
        None
    };
    let _ = agent(&state)?.delete(&c.app_id).await;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    state.db.servers().delete_one(doc! { "_id": oid }).await?;
    // Drop the freed MC port from the relay's frpc config + remove its DNS records.
    if was_minecraft {
        if let Some(frp) = state.frp.as_ref() {
            let _ = frp.sync(&state).await;
        }
        if let Some(sub) = mc_sub {
            let _ = crate::cloudflare::clear_mc_dns(&state, &sub).await;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- admin: suspend -----------------------------

/// POST /admin/containers/:id/suspend — freeze a container (admin override).
/// Stops the Docker container and marks it suspended: the owner can no longer
/// start, restart or delete it until an admin lifts the suspension. Uses a
/// dedicated `container.suspended` flag so the status reconciler can't clear it.
pub async fn admin_suspend(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(crate::permissions::perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid, "type": 1 })
        .await?
        .ok_or(AppError::NotFound)?;
    let app_id = require_container(&server)?.app_id.clone();
    // Best-effort power-off; the freeze holds even if the agent is unreachable.
    if let Some(a) = state.agent.as_ref() {
        let _ = a.action(&app_id, "stop").await;
    }
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": {
                "container.suspended": true,
                "state": "suspended",
                "container.status": "suspended",
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    crate::security::audit(
        &state,
        auth.user_id,
        crate::permissions::perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "container.suspend" },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /admin/containers/:id/unsuspend — lift a container's suspension. Leaves
/// it stopped; the owner can start it again.
pub async fn admin_unsuspend(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(crate::permissions::perm::NODES_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    state
        .db
        .servers()
        .find_one(doc! { "_id": oid, "type": 1 })
        .await?
        .ok_or(AppError::NotFound)?;
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": {
                "container.suspended": false,
                "state": "stopped",
                "container.status": "stopped",
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    crate::security::audit(
        &state,
        auth.user_id,
        crate::permissions::perm::NODES_MANAGE,
        Some(oid),
        &headers,
        doc! { "action": "container.unsuspend" },
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true })))
}
