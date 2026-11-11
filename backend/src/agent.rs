//! Client for the Artix container agent (the HTTP service on the dedicated
//! Docker VM). Auth is a bearer token (`CONTAINER_AGENT_TOKEN`); the agent is
//! the only thing that talks to Docker. Disabled (`from_config` returns `None`)
//! when `CONTAINER_AGENT_URL`/token are unset, so the app runs without it.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{
    config::Config,
    error::{AppError, AppResult},
};

#[derive(Clone)]
pub struct AgentClient {
    http: reqwest::Client,
    base: String,
    token: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeployResult {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "type", default)]
    pub app_type: String,
    pub runtime: Option<String>,
    pub image: Option<String>,
    pub ram: Option<i64>,
    pub port: Option<i32>,
    pub subdomain: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "buildLog", default)]
    pub build_log: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatusResult {
    #[serde(default)]
    pub exists: bool,
    pub status: Option<String>,
    #[serde(default)]
    pub running: bool,
    #[serde(rename = "exitCode", default)]
    pub exit_code: Option<i32>,
    #[serde(rename = "startedAt", default)]
    pub started_at: Option<String>,
    #[serde(rename = "oomKilled", default)]
    pub oom_killed: bool,
}

/// docker stats are human strings ("0.05%", "6.5MiB / 128MiB", "5.12%").
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatsResult {
    pub cpu: Option<String>,
    pub mem: Option<String>,
    #[serde(rename = "memPerc")]
    pub mem_perc: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LogsResult {
    #[serde(default)]
    pub logs: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FileEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "dir" | "file"
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub heavy: bool, // node_modules/.git/.next/… — skip auto-expanding
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FilesResult {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FileContent {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub size: i64,
}

fn net(e: reqwest::Error) -> AppError {
    AppError::Internal(format!("agent request: {e}"))
}

/// Last `n` characters of `s` (char-safe — never splits a UTF-8 boundary).
fn tail_chars(s: &str, n: usize) -> String {
    let total = s.chars().count();
    if total <= n {
        s.to_string()
    } else {
        s.chars().skip(total - n).collect()
    }
}

impl AgentClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if cfg.container_agent_url.is_empty() || cfg.container_agent_token.is_empty() {
            return None;
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(300)) // deploy builds can be slow
            .user_agent("artixcloud-api/1.0")
            .build()
            .ok()?;
        Some(Self {
            http,
            base: cfg.container_agent_url.trim_end_matches('/').to_string(),
            token: cfg.container_agent_token.clone(),
        })
    }

    /// Deploy a project bundle (zip bytes) with env (JSON string) + cpu cap.
    #[allow(clippy::too_many_arguments)]
    pub async fn deploy(
        &self,
        id: &str,
        zip: Vec<u8>,
        env_json: String,
        cpus: f64,
        ram_cap: i64,
        subdomain: Option<&str>,
        domain: Option<&str>,
    ) -> AppResult<DeployResult> {
        let part = reqwest::multipart::Part::bytes(zip)
            .file_name("bundle.zip")
            .mime_str("application/zip")
            .map_err(|e| AppError::Internal(format!("agent part: {e}")))?;
        let mut form = reqwest::multipart::Form::new()
            .part("bundle", part)
            .text("env", env_json)
            .text("cpus", cpus.to_string())
            // Authoritative RAM cap (MB); the agent clamps .artix RAM to it.
            .text("ramCap", ram_cap.to_string());
        if let Some(sub) = subdomain {
            form = form.text("subdomain", sub.to_string());
        }
        if let Some(d) = domain {
            form = form.text("domain", d.to_string());
        }
        let res = self
            .http
            .post(format!("{}/apps/{}/deploy", self.base, id))
            .bearer_auth(&self.token)
            .multipart(form)
            // Builds (npm install + next build, cargo, …) can take minutes — well
            // past the client's 300s default. Match the agent's 15-min build cap.
            .timeout(Duration::from_secs(15 * 60))
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    /// Attach/detach a custom domain on a running site (live, no rebuild).
    pub async fn set_domain(&self, id: &str, domain: Option<&str>) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/domain", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "domain": domain.unwrap_or("") }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    pub async fn action(&self, id: &str, action: &str) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/action", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "action": action }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Provision a Minecraft server (itzg image) — dedicated create path (no zip).
    /// Long timeout: first run pulls a large image and generates the world.
    pub async fn create_minecraft(&self, id: &str, req: &serde_json::Value) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/minecraft", self.base, id))
            .bearer_auth(&self.token)
            .json(req)
            .timeout(Duration::from_secs(10 * 60))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Provision or reconfigure a Mumble voice server (idempotent recreate).
    pub async fn create_voice(&self, id: &str, req: &serde_json::Value) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/voice", self.base, id))
            .bearer_auth(&self.token)
            .json(req)
            .timeout(Duration::from_secs(5 * 60))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Run a server console command (RCON for Java, console pipe for Bedrock).
    pub async fn console(&self, id: &str, command: &str) -> AppResult<String> {
        let res = self
            .http
            .post(format!("{}/apps/{}/console", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "command": command }))
            .send()
            .await
            .map_err(net)?;
        #[derive(serde::Deserialize)]
        struct ConsoleResp {
            #[serde(default)]
            output: String,
        }
        let r: ConsoleResp = self.json(res).await?;
        Ok(r.output)
    }

    pub async fn status(&self, id: &str) -> AppResult<StatusResult> {
        self.get(id, "status").await
    }

    pub async fn stats(&self, id: &str) -> AppResult<StatsResult> {
        self.get(id, "stats").await
    }

    pub async fn logs(&self, id: &str, tail: u32) -> AppResult<LogsResult> {
        let res = self
            .http
            .get(format!("{}/apps/{}/logs?tail={}", self.base, id, tail))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    pub async fn list_files(&self, id: &str, path: &str) -> AppResult<FilesResult> {
        let res = self
            .http
            .get(format!("{}/apps/{}/files", self.base, id))
            .query(&[("path", path)])
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    pub async fn read_file(&self, id: &str, path: &str) -> AppResult<FileContent> {
        let res = self
            .http
            .get(format!("{}/apps/{}/file", self.base, id))
            .query(&[("path", path)])
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    pub async fn write_file(&self, id: &str, path: &str, content: &str) -> AppResult<()> {
        let res = self
            .http
            .put(format!("{}/apps/{}/file", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "path": path, "content": content }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Upload a plugin/mod .jar into the container's data volume (`dir` = plugins|mods).
    pub async fn upload_file(
        &self,
        id: &str,
        dir: &str,
        filename: &str,
        bytes: Vec<u8>,
    ) -> AppResult<()> {
        let part = reqwest::multipart::Part::bytes(bytes).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);
        let res = self
            .http
            .post(format!("{}/apps/{}/upload?dir={}", self.base, id, dir))
            .bearer_auth(&self.token)
            .multipart(form)
            .timeout(Duration::from_secs(180))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Delete a file in the container's data volume (remove a plugin/mod).
    pub async fn delete_file(&self, id: &str, path: &str) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/file/delete", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "path": path }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Merge itzg server settings (MAX_PLAYERS, MOTD, DIFFICULTY, …) + restart.
    pub async fn set_settings(&self, id: &str, props: serde_json::Value) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/settings", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "props": props }))
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Snapshot the server's /data volume to a backup tarball.
    pub async fn backup(&self, id: &str) -> AppResult<serde_json::Value> {
        let res = self
            .http
            .post(format!("{}/apps/{}/backup", self.base, id))
            .bearer_auth(&self.token)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    pub async fn list_backups(&self, id: &str) -> AppResult<serde_json::Value> {
        self.get(id, "backups").await
    }

    pub async fn restore_backup(&self, id: &str, name: &str) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/backup/restore", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "name": name }))
            .timeout(Duration::from_secs(180))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    pub async fn delete_backup(&self, id: &str, name: &str) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/backup/delete", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Import a world/data archive (.zip or .tar.gz) into /data.
    pub async fn upload_world(&self, id: &str, filename: &str, bytes: Vec<u8>) -> AppResult<()> {
        let part = reqwest::multipart::Part::bytes(bytes).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);
        let res = self
            .http
            .post(format!("{}/apps/{}/world", self.base, id))
            .bearer_auth(&self.token)
            .multipart(form)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Restore a world/data archive from a URL — the agent downloads it
    /// server-side (bypassing the panel's Cloudflare upload cap) and extracts it
    /// into `/data`. Very long timeout: multi-GB internet downloads take a while.
    pub async fn import_world_url(&self, id: &str, url: &str) -> AppResult<()> {
        let res = self
            .http
            .post(format!("{}/apps/{}/world-url", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "url": url }))
            .timeout(Duration::from_secs(30 * 60))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Set the server icon (server-icon.png).
    pub async fn upload_icon(&self, id: &str, filename: &str, bytes: Vec<u8>) -> AppResult<()> {
        let part = reqwest::multipart::Part::bytes(bytes).file_name(filename.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);
        let res = self
            .http
            .post(format!("{}/apps/{}/icon", self.base, id))
            .bearer_auth(&self.token)
            .multipart(form)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    /// Raw streaming response for the server icon (proxied to the browser as an
    /// `<img>` source). `Ok(None)` when the server has no icon set yet.
    pub async fn get_icon(&self, id: &str) -> AppResult<Option<reqwest::Response>> {
        let res = self
            .http
            .get(format!("{}/apps/{}/icon", self.base, id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !res.status().is_success() {
            return Err(AppError::NotFound);
        }
        Ok(Some(res))
    }

    /// Raw streaming response for a backup download (proxied to the browser).
    pub async fn download_backup(&self, id: &str, name: &str) -> AppResult<reqwest::Response> {
        let res = self
            .http
            .get(format!(
                "{}/apps/{}/backup/download?name={}",
                self.base, id, name
            ))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        if !res.status().is_success() {
            return Err(AppError::NotFound);
        }
        Ok(res)
    }

    /// Free RAM (MB) on the Docker VM — the new-server capacity gate.
    pub async fn host_available_mb(&self) -> Option<i64> {
        let res = self
            .http
            .get(format!("{}/host/mem", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .ok()?;
        res.json::<serde_json::Value>()
            .await
            .ok()?
            .get("available")?
            .as_i64()
    }

    pub async fn set_env(&self, id: &str, env: serde_json::Value) -> AppResult<()> {
        let res = self
            .http
            .put(format!("{}/apps/{}/env", self.base, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "env": env }))
            .send()
            .await
            .map_err(net)?;
        self.ok(res).await
    }

    pub async fn delete(&self, id: &str) -> AppResult<()> {
        let res = self
            .http
            .delete(format!("{}/apps/{}", self.base, id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        // 404 == already gone: idempotent delete.
        if res.status().is_success() || res.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(AppError::Unavailable("container agent error".into()))
        }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, id: &str, path: &str) -> AppResult<T> {
        let res = self
            .http
            .get(format!("{}/apps/{}/{}", self.base, id, path))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
    }

    async fn ok(&self, res: reqwest::Response) -> AppResult<()> {
        if res.status().is_success() {
            Ok(())
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(AppError::Unavailable(format!(
                "container agent: {}",
                body.trim()
            )))
        }
    }

    async fn json<T: serde::de::DeserializeOwned>(&self, res: reqwest::Response) -> AppResult<T> {
        let status = res.status();
        if !status.is_success() {
            let b = res.text().await.unwrap_or_default();
            tracing::error!(status = %status, body = %b, "container agent error");
            // Surface the agent's specific message (e.g. .artix validation, build
            // failure) to the user on 4xx; keep 5xx generic. When the agent
            // returns a build log, append its tail so the caller sees *why* the
            // build failed (recorded in deploy history + shown to the user).
            let parsed = serde_json::from_str::<serde_json::Value>(&b).ok();
            let err = parsed
                .as_ref()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()))
                .map(str::to_string);
            let log = parsed
                .as_ref()
                .and_then(|v| v.get("buildLog").and_then(|e| e.as_str()))
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| tail_chars(s, 400));
            let msg = match (err, log) {
                (Some(e), Some(l)) => format!("{e}\n{l}"),
                (Some(e), None) => e,
                (None, Some(l)) => l,
                (None, None) => String::new(),
            };
            if status.is_client_error() {
                return Err(AppError::Validation(if msg.is_empty() {
                    "deploy rejected".into()
                } else {
                    msg
                }));
            }
            return Err(AppError::Unavailable(if msg.is_empty() {
                "container agent error".into()
            } else {
                msg
            }));
        }
        res.json::<T>()
            .await
            .map_err(|e| AppError::Internal(format!("agent decode: {e}")))
    }
}
