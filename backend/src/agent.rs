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

fn net(e: reqwest::Error) -> AppError {
    AppError::Internal(format!("agent request: {e}"))
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
    pub async fn deploy(
        &self,
        id: &str,
        zip: Vec<u8>,
        env_json: String,
        cpus: f64,
        ram_cap: i64,
        subdomain: Option<&str>,
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
        let res = self
            .http
            .post(format!("{}/apps/{}/deploy", self.base, id))
            .bearer_auth(&self.token)
            .multipart(form)
            .send()
            .await
            .map_err(net)?;
        self.json(res).await
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
            // failure) to the user on 4xx; keep 5xx generic.
            let msg = serde_json::from_str::<serde_json::Value>(&b)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
            if status.is_client_error() {
                return Err(AppError::Validation(
                    msg.unwrap_or_else(|| "deploy rejected".into()),
                ));
            }
            return Err(AppError::Unavailable(
                msg.unwrap_or_else(|| "container agent error".into()),
            ));
        }
        res.json::<T>()
            .await
            .map_err(|e| AppError::Internal(format!("agent decode: {e}")))
    }
}
