//! Container servers (`server_type == 1`) — Discloud/SquareCloud-style apps run
//! on the dedicated Docker VM via the container agent. A container is just a
//! `Server` doc with `server_type == 1` + a `container` sub-doc, so ownership
//! reuses `servers::access()` verbatim (IDOR-safe). Nothing here touches Proxmox.

use axum::{
    extract::{Multipart, Path, Query, State},
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
    permissions::server_perm,
    state::AppState,
};

fn agent(state: &AppState) -> AppResult<&crate::agent::AgentClient> {
    state
        .agent
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("containers unavailable".into()))
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
    /// "discord_bot" (phase-1). "site" is rejected until the proxy wave lands.
    pub container_type: String,
    #[serde(default)]
    pub plan: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateContainerReq>,
) -> AppResult<Json<ServerPublic>> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("name required".into()));
    }
    let ctype = req.container_type.trim().to_lowercase();
    if ctype != "discord_bot" {
        return Err(AppError::Validation(
            "only discord_bot containers are available for now".into(),
        ));
    }
    let plan = if req.plan.trim().is_empty() {
        "free".to_string()
    } else {
        req.plan.trim().to_string()
    };
    // Free tier RAM cap (MB). Plan-based limits get richer in the anti-abuse wave.
    let ram_mb = 256i64;

    let now = Utc::now();
    let server = Server {
        id: None,
        user_id: auth.user_id,
        org_id: None,
        name,
        node: String::new(),
        vmid: None,
        plan,
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
            container_type: ctype,
            app_id: String::new(), // filled after insert (= _id hex)
            subdomain: None,
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
        }),
        expires_at: None,
        created_at: now,
        updated_at: now,
    };

    let inserted = state.db.servers().insert_one(&server).await?;
    let id = inserted
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert id".into()))?;
    let app_id = id.to_hex();
    state
        .db
        .servers()
        .update_one(
            doc! { "_id": id },
            doc! { "$set": { "container.app_id": &app_id } },
        )
        .await?;

    let mut created = server;
    created.id = Some(id);
    if let Some(c) = created.container.as_mut() {
        c.app_id = app_id;
    }
    Ok(Json(created.public()))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerPublic>>> {
    let filter = doc! { "type": 1, "user_id": auth.user_id };
    let mut cursor = state.db.servers().find(filter).await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<ServerPublic>> {
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
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let (app_id, env_json, ram_cap) = {
        let c = require_container(&server)?;
        (c.app_id.clone(), env_to_json(&c.env), c.ram_mb.unwrap_or(256))
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

    // ram_cap is authoritative — the agent clamps the .artix RAM to it so a user
    // can't request more than their plan allows.
    let dep = ag.deploy(&app_id, zip, env_json, cpus, ram_cap).await?;

    // Persist echoed metadata + mark deployed/running.
    let now = Utc::now();
    let _ = state
        .db
        .servers()
        .update_one(
            doc! { "_id": server.id.unwrap() },
            doc! { "$set": {
                "container.runtime": dep.runtime.clone(),
                "container.image": dep.image.clone(),
                "container.build_log": dep.build_log.clone(),
                "container.port": dep.port,
                "container.ram_mb": dep.ram,
                "container.status": "running",
                "container.deployed": true,
                "state": "running",
                "updated_at": bson::DateTime::from_chrono(now),
            }},
        )
        .await?;

    Ok(Json(dep))
}

// ----------------------------- status / stats / logs -----------------------------

pub async fn status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<crate::agent::StatusResult>> {
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let c = require_container(&server)?;
    Ok(Json(agent(&state)?.status(&c.app_id).await?))
}

pub async fn stats(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<crate::agent::StatsResult>> {
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
) -> AppResult<Json<serde_json::Value>> {
    let action = req.action.trim();
    if !["start", "stop", "restart"].contains(&action) {
        return Err(AppError::Validation("invalid action".into()));
    }
    let server = access(&state, auth.user_id, &id, server_perm::POWER).await?;
    let c = require_container(&server)?;
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
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- env -----------------------------

pub async fn get_env(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
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
            && k.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid_key {
            return Err(AppError::Validation(format!("invalid env key: {k}")));
        }
        let s = v
            .as_str()
            .ok_or_else(|| AppError::Validation(format!("env {k} must be a string")))?;
        if s.len() > 4096 || s.contains(['\n', '\r', '\0']) {
            return Err(AppError::Validation(format!("env {k} has invalid characters")));
        }
    }
    let env_doc = bson::to_document(&req.env)
        .map_err(|_| AppError::Validation("invalid env".into()))?;
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
    Ok(Json(serde_json::json!({ "ok": true, "note": "restart to apply" })))
}

// ----------------------------- delete -----------------------------

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::DELETE).await?;
    let c = require_container(&server)?;
    let _ = agent(&state)?.delete(&c.app_id).await;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    state.db.servers().delete_one(doc! { "_id": oid }).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
