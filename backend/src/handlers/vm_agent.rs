//! File manager + command console for a VPS, implemented over the QEMU guest
//! agent (reached through the Proxmox API — no direct VM network access needed).
//! Every handler is ownership-checked via `servers::access`.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    error::{AppError, AppResult},
    handlers::servers::access,
    permissions::server_perm,
    proxmox::ProxmoxClient,
    state::AppState,
};

fn proxmox(state: &AppState) -> AppResult<&ProxmoxClient> {
    state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("agent unavailable".into()))
}

/// Single-quote a string for safe interpolation into `/bin/sh -c`.
fn shq(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('\'');
    for c in s.chars() {
        if c == '\'' {
            o.push_str("'\\''");
        } else {
            o.push(c);
        }
    }
    o.push('\'');
    o
}

fn valid_path(p: &str) -> AppResult<()> {
    if !p.starts_with('/') || p.contains('\n') || p.contains('\0') {
        return Err(AppError::Validation("invalid path".into()));
    }
    Ok(())
}

/// Root-filesystem usage of the VPS (bytes), via the guest agent.
pub async fn disk_usage(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::VIEW).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    // Degrade gracefully: if the agent isn't up yet (or the VM is off), report
    // zero rather than 500 — the panel just hides the disk card.
    let (used, total) = px.agent_fsinfo(vmid).await.unwrap_or((0, 0));
    Ok(Json(serde_json::json!({ "used": used, "total": total })))
}

// ------------------------------- Files -------------------------------

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub kind: String, // "dir" | "file" | "link"
    pub size: i64,
    pub mtime: i64,
}

/// List a directory in the guest.
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    let dir = q.path.unwrap_or_else(|| "/root".into());
    valid_path(&dir)?;

    let (_code, out, _err) = px
        .agent_exec(
            vmid,
            &[
                "/usr/bin/find",
                &dir,
                "-maxdepth",
                "1",
                "-mindepth",
                "1",
                "-printf",
                "%y\\t%s\\t%T@\\t%f\\n",
            ],
        )
        .await?;

    let mut entries: Vec<FileEntry> = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.len() != 4 {
            continue;
        }
        let kind = match parts[0] {
            "d" => "dir",
            "l" => "link",
            _ => "file",
        };
        entries.push(FileEntry {
            kind: kind.to_string(),
            size: parts[1].parse().unwrap_or(0),
            mtime: parts[2]
                .split('.')
                .next()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0),
            name: parts[3].to_string(),
        });
    }
    // Directories first, then alphabetical.
    entries.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Json(serde_json::json!({ "path": dir, "entries": entries })))
}

#[derive(Deserialize)]
pub struct FilePathQuery {
    pub path: String,
}

/// Read a text file from the guest.
pub async fn read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<FilePathQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    valid_path(&q.path)?;
    let content = px.agent_file_read(vmid, &q.path).await?;
    Ok(Json(
        serde_json::json!({ "path": q.path, "content": content }),
    ))
}

#[derive(Deserialize)]
pub struct WriteReq {
    pub path: String,
    pub content: String,
}

/// Overwrite a text file in the guest.
pub async fn write(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<WriteReq>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    valid_path(&req.path)?;
    px.agent_file_write(vmid, &req.path, &req.content).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct CreateReq {
    pub path: String,
    #[serde(default)]
    pub dir: bool,
}

/// Create an empty file or a directory.
pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<CreateReq>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    valid_path(&req.path)?;
    let argv: Vec<&str> = if req.dir {
        vec!["/bin/mkdir", "-p", &req.path]
    } else {
        vec!["/usr/bin/touch", &req.path]
    };
    let (code, _out, err) = px.agent_exec(vmid, &argv).await?;
    if code != 0 {
        return Err(AppError::Validation(if err.is_empty() {
            "command failed".into()
        } else {
            err
        }));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Delete a file or directory (recursive).
pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(q): Query<FilePathQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    valid_path(&q.path)?;
    if q.path == "/" || q.path.trim_end_matches('/').is_empty() {
        return Err(AppError::Validation("refusing to delete /".into()));
    }
    let (code, _out, err) = px.agent_exec(vmid, &["/bin/rm", "-rf", &q.path]).await?;
    if code != 0 {
        return Err(AppError::Validation(if err.is_empty() {
            "command failed".into()
        } else {
            err
        }));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct MoveReq {
    pub from: String,
    pub to: String,
}

/// Move or rename a file/directory (`mv -f from to`). If `to` is an existing
/// directory the item is moved inside it; otherwise `from` is renamed to `to`.
pub async fn mv(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<MoveReq>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::MANAGE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;
    valid_path(&req.from)?;
    valid_path(&req.to)?;
    let (code, _out, err) = px
        .agent_exec(vmid, &["/bin/mv", "-f", &req.from, &req.to])
        .await?;
    if code != 0 {
        return Err(AppError::Validation(if err.is_empty() {
            "move failed".into()
        } else {
            err
        }));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ------------------------------- Console -------------------------------

#[derive(Deserialize)]
pub struct ExecReq {
    pub cmd: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Run a shell command in the guest and return its output plus the resulting
/// working directory (so the client can keep a persistent `cd` across commands).
pub async fn console_exec(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ExecReq>,
) -> AppResult<Json<serde_json::Value>> {
    let server = access(&state, auth.user_id, &id, server_perm::CONSOLE).await?;
    let px = proxmox(&state)?;
    let vmid = server
        .vmid
        .ok_or_else(|| AppError::Conflict("not provisioned".into()))?;

    let cwd = req.cwd.unwrap_or_else(|| "/root".into());
    // Run in cwd, then emit the new pwd behind a sentinel so we can track `cd`.
    let script = format!(
        "cd {} 2>/dev/null; {}; __rc=$?; printf '__ARTIXPWD__%s\\n' \"$(pwd)\"; exit $__rc",
        shq(&cwd),
        req.cmd
    );
    let (code, out, err) = px.agent_exec(vmid, &["/bin/sh", "-c", &script]).await?;

    let (clean, new_cwd) = match out.rsplit_once("__ARTIXPWD__") {
        Some((before, after)) => (before.to_string(), after.trim().to_string()),
        None => (out, cwd.clone()),
    };
    let new_cwd = if new_cwd.is_empty() { cwd } else { new_cwd };

    Ok(Json(serde_json::json!({
        "code": code,
        "out": clean,
        "err": err,
        "cwd": new_cwd,
    })))
}
