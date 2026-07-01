//! Thin client for the Proxmox VE REST API (`/api2/json`).
//!
//! Auth uses an **API token** (`Authorization: PVEAPIToken=ID=SECRET`) — no
//! ticket/cookie juggling. Most write actions are asynchronous and return a
//! `UPID`; `wait_task` polls until it finishes. Disabled (returns `None` from
//! `from_config`) when `PROXMOX_API_URL`/token are not set, so the rest of the
//! app runs fine without a hypervisor.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use reqwest::Method;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::{config::Config, error::AppError, error::AppResult};

#[derive(Clone)]
pub struct ProxmoxClient {
    http: reqwest::Client,
    base: String,
    /// Web origin (no `/api2/json`) used to build console websocket URLs.
    web_base: String,
    token_header: String,
    pub node: String,
    pub template_vmid: i64,
    pub storage: String,
    pub bridge: String,
    /// Restricted PVE user used only for the xterm.js serial terminal.
    console_user: String,
    console_password: String,
    /// Cached PVE login ticket: (ticket, csrf, expires_at_unix).
    ticket_cache: Arc<Mutex<Option<(String, String, i64)>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerAction {
    Start,
    Stop,
    Reboot,
    Shutdown,
}

impl PowerAction {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "start" => Some(PowerAction::Start),
            "stop" => Some(PowerAction::Stop),
            "reboot" => Some(PowerAction::Reboot),
            "shutdown" => Some(PowerAction::Shutdown),
            _ => None,
        }
    }
    fn verb(self) -> &'static str {
        match self {
            PowerAction::Start => "start",
            PowerAction::Stop => "stop",
            PowerAction::Reboot => "reboot",
            PowerAction::Shutdown => "shutdown",
        }
    }
}

#[derive(Debug, Clone)]
pub struct VmStatus {
    pub status: String, // "running" | "stopped"
    pub max_mem: u64,
    pub mem: u64,
    pub cpus: f64,
    pub uptime: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeInfo {
    pub node: String,
    pub status: String,
    pub cpu: f64,
    pub maxcpu: u64,
    pub mem: u64,
    pub maxmem: u64,
    pub uptime: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NodeStatus {
    pub cpus: u64,
    pub mem_total: u64,
    pub mem_used: u64,
    pub uptime: u64,
    pub loadavg: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MetricPoint {
    pub time: i64,
    pub cpu: f64,
    pub mem: u64,
    pub maxmem: u64,
    pub netin: f64,
    pub netout: f64,
    pub diskread: f64,
    pub diskwrite: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConsoleTicket {
    pub ticket: String,
    pub port: String,
    pub user: String,
    pub ws_url: String,
}

/// Everything the backend WS proxy needs to bridge a browser xterm.js to the
/// Proxmox serial `vncwebsocket` (the cookie/ticket never reach the browser).
#[derive(Debug, Clone)]
pub struct TermSession {
    /// PVE user that owns the term ticket (sent in the in-band `user:ticket` auth).
    pub user: String,
    /// termproxy ticket — used both in the URL and the in-band auth line.
    pub ticket: String,
    /// PVE session ticket — sent to Proxmox as the `PVEAuthCookie` on the WS.
    pub pveauth: String,
    /// Full `wss://…/vncwebsocket?port=&vncticket=` URL the backend dials.
    pub ws_url: String,
}

/// Proxmox requires a VM `name` to be a valid DNS name (letters/digits/hyphens,
/// no spaces). The human-facing name is kept in Mongo; this is only for the
/// hypervisor. Falls back to `vps` when nothing usable remains.
fn sanitize_vm_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-');
    let s: String = s.chars().take(63).collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "vps".to_string()
    } else {
        s
    }
}

/// Minimal percent-encoding for the vnc ticket in the websocket URL.
fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// `UPID:node:....` -> node. Used to poll the task on the right node.
pub fn task_node<'a>(upid: &'a str, fallback: &'a str) -> &'a str {
    upid.split(':').nth(1).filter(|s| !s.is_empty()).unwrap_or(fallback)
}

#[derive(serde::Deserialize)]
pub struct StorageStatus {
    pub storage: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub used: i64,
    #[serde(default)]
    pub avail: i64,
    #[serde(default)]
    pub content: String,
}

impl ProxmoxClient {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        if cfg.proxmox_api_url.is_empty()
            || cfg.proxmox_token_id.is_empty()
            || cfg.proxmox_token_secret.is_empty()
        {
            return None;
        }
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(cfg.proxmox_insecure)
            .timeout(Duration::from_secs(30))
            // Cloudflare (in front of the PVE host) blocks requests with no
            // User-Agent as bots — reqwest sends none by default, so set one.
            .user_agent("artixcloud-api/1.0")
            .build()
            .ok()?;
        let base = cfg.proxmox_api_url.trim_end_matches('/').to_string();
        let web_base = base.trim_end_matches("/api2/json").to_string();
        Some(Self {
            http,
            web_base,
            base,
            token_header: format!(
                "PVEAPIToken={}={}",
                cfg.proxmox_token_id, cfg.proxmox_token_secret
            ),
            node: cfg.proxmox_node.clone(),
            template_vmid: cfg.proxmox_template_vmid,
            storage: cfg.proxmox_storage.clone(),
            bridge: cfg.proxmox_bridge.clone(),
            console_user: cfg.proxmox_console_user.clone(),
            console_password: cfg.proxmox_console_password.clone(),
            ticket_cache: Arc::new(Mutex::new(None)),
        })
    }

    /// A real PVE login ticket (cached ~90 min) for `console_user`. Required by
    /// the xterm.js serial terminal, whose in-band auth rejects API tokens.
    async fn pve_ticket(&self) -> AppResult<(String, String)> {
        let now = Utc::now().timestamp();
        {
            let guard = self.ticket_cache.lock().await;
            if let Some((t, c, exp)) = guard.as_ref() {
                if *exp > now {
                    return Ok((t.clone(), c.clone()));
                }
            }
        }
        if self.console_user.is_empty() || self.console_password.is_empty() {
            return Err(AppError::Unavailable("serial console not configured".into()));
        }
        let res = self
            .http
            .post(format!("{}/access/ticket", self.base))
            .form(&[
                ("username", self.console_user.as_str()),
                ("password", self.console_password.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("pve ticket: {e}")))?;
        if !res.status().is_success() {
            return Err(AppError::Internal("pve ticket: login failed".into()));
        }
        let body: Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("pve ticket json: {e}")))?;
        let d = &body["data"];
        let ticket = d.get("ticket").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let csrf = d
            .get("CSRFPreventionToken")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        if ticket.is_empty() {
            return Err(AppError::Internal("pve ticket: empty".into()));
        }
        // PVE tickets last ~2h; refresh after 90 min.
        *self.ticket_cache.lock().await = Some((ticket.clone(), csrf.clone(), now + 90 * 60));
        Ok((ticket, csrf))
    }

    /// Open an xterm.js serial terminal session for a VM. Returns everything the
    /// backend WS proxy needs to bridge the browser to Proxmox's `vncwebsocket`.
    pub async fn term(&self, vmid: i64) -> AppResult<TermSession> {
        let (pveauth, csrf) = self.pve_ticket().await?;
        let url = format!(
            "{}/nodes/{}/qemu/{}/termproxy",
            self.base, self.node, vmid
        );
        let res = self
            .http
            .post(&url)
            .header("Cookie", format!("PVEAuthCookie={pveauth}"))
            .header("CSRFPreventionToken", &csrf)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("termproxy: {e}")))?;
        if !res.status().is_success() {
            return Err(AppError::Internal(format!(
                "termproxy: status {}",
                res.status()
            )));
        }
        let body: Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("termproxy json: {e}")))?;
        let d = &body["data"];
        let user = d.get("user").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let ticket = d.get("ticket").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let port = d
            .get("port")
            .and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_i64().map(|n| n.to_string())))
            .unwrap_or_default();
        let ws = self.web_base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
        let ws_url = format!(
            "{}/api2/json/nodes/{}/qemu/{}/vncwebsocket?port={}&vncticket={}",
            ws,
            self.node,
            vmid,
            port,
            pct(&ticket)
        );
        Ok(TermSession { user, ticket, pveauth, ws_url })
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        form: Option<&[(&str, String)]>,
    ) -> AppResult<Value> {
        let mut rb = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .header(reqwest::header::AUTHORIZATION, &self.token_header);
        if let Some(f) = form {
            rb = rb.form(f);
        }
        let res = rb
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("proxmox request: {e}")))?;
        if !res.status().is_success() {
            return Err(AppError::Internal(format!(
                "proxmox status {}",
                res.status()
            )));
        }
        let body: Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("proxmox decode: {e}")))?;
        Ok(body.get("data").cloned().unwrap_or(Value::Null))
    }

    /// A free VM id from the cluster.
    pub async fn next_id(&self) -> AppResult<i64> {
        let d = self.call(Method::GET, "/cluster/nextid", None).await?;
        d.as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .or_else(|| d.as_i64())
            .ok_or_else(|| AppError::Internal("proxmox nextid".into()))
    }

    /// Full-clone `template_vmid` into `newid`. Returns the task UPID.
    /// Storages on this node (with total/used bytes + content types).
    pub async fn list_storages(&self) -> AppResult<Vec<StorageStatus>> {
        let path = format!("/nodes/{}/storage", self.node);
        let d = self.call(Method::GET, &path, None).await?;
        let arr = d.as_array().ok_or_else(|| AppError::Internal("storage list".into()))?;
        Ok(arr
            .iter()
            .filter_map(|v| serde_json::from_value::<StorageStatus>(v.clone()).ok())
            .collect())
    }

    pub async fn clone_template(
        &self,
        template_vmid: i64,
        newid: i64,
        name: &str,
        storage: &str,
    ) -> AppResult<String> {
        let path = format!("/nodes/{}/qemu/{}/clone", self.node, template_vmid);
        let form = [
            ("newid", newid.to_string()),
            ("name", sanitize_vm_name(name)),
            ("full", "1".to_string()),
            ("storage", storage.to_string()),
        ];
        let d = self.call(Method::POST, &path, Some(&form)).await?;
        d.as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::Internal("proxmox clone upid".into()))
    }

    pub async fn set_resources(&self, vmid: i64, cores: u16, memory_mb: u32) -> AppResult<()> {
        let path = format!("/nodes/{}/qemu/{}/config", self.node, vmid);
        let form = [
            ("cores", cores.to_string()),
            ("memory", memory_mb.to_string()),
        ];
        self.call(Method::POST, &path, Some(&form)).await?;
        Ok(())
    }

    /// Grow a VM disk to an absolute size in GiB. Proxmox can only grow a disk,
    /// never shrink it — the cloud-image template is tiny, so the plan size is
    /// always larger. Cloud-init's growpart expands the filesystem on first boot.
    pub async fn resize_disk(&self, vmid: i64, disk: &str, size_gb: u32) -> AppResult<()> {
        let path = format!("/nodes/{}/qemu/{}/resize", self.node, vmid);
        let form = [
            ("disk", disk.to_string()),
            ("size", format!("{size_gb}G")),
        ];
        // Resize returns a task UPID — wait so the disk is fully grown before the
        // VM boots (cloud-init's growpart then expands the filesystem on start).
        let d = self.call(Method::PUT, &path, Some(&form)).await?;
        if let Some(upid) = d.as_str() {
            self.wait_task(upid).await?;
        }
        Ok(())
    }

    pub async fn power(&self, vmid: i64, action: PowerAction) -> AppResult<String> {
        let path = format!(
            "/nodes/{}/qemu/{}/status/{}",
            self.node,
            vmid,
            action.verb()
        );
        let d = self.call(Method::POST, &path, Some(&[])).await?;
        Ok(d.as_str().unwrap_or_default().to_string())
    }

    pub async fn status(&self, vmid: i64) -> AppResult<VmStatus> {
        let path = format!("/nodes/{}/qemu/{}/status/current", self.node, vmid);
        let d = self.call(Method::GET, &path, None).await?;
        Ok(VmStatus {
            status: d
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string(),
            max_mem: d.get("maxmem").and_then(|s| s.as_u64()).unwrap_or(0),
            mem: d.get("mem").and_then(|s| s.as_u64()).unwrap_or(0),
            cpus: d.get("cpus").and_then(|s| s.as_f64()).unwrap_or(0.0),
            uptime: d.get("uptime").and_then(|s| s.as_u64()).unwrap_or(0),
        })
    }

    pub async fn delete(&self, vmid: i64) -> AppResult<String> {
        let path = format!("/nodes/{}/qemu/{}", self.node, vmid);
        let d = self.call(Method::DELETE, &path, None).await?;
        Ok(d.as_str().unwrap_or_default().to_string())
    }

    /// Poll a task UPID until it finishes (bounded). Errors if it fails.
    pub async fn wait_task(&self, upid: &str) -> AppResult<()> {
        let node = task_node(upid, &self.node);
        let path = format!("/nodes/{}/tasks/{}/status", node, upid);
        for _ in 0..150 {
            let d = self.call(Method::GET, &path, None).await?;
            if d.get("status").and_then(|s| s.as_str()) == Some("stopped") {
                let exit = d.get("exitstatus").and_then(|s| s.as_str()).unwrap_or("");
                return if exit == "OK" {
                    Ok(())
                } else {
                    Err(AppError::Internal(format!("proxmox task failed: {exit}")))
                };
            }
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
        Err(AppError::Internal("proxmox task timeout".into()))
    }

    /// Cluster nodes (for the admin panel).
    pub async fn nodes(&self) -> AppResult<Vec<NodeInfo>> {
        let d = self.call(Method::GET, "/nodes", None).await?;
        let arr = d.as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|n| NodeInfo {
                node: n.get("node").and_then(|x| x.as_str()).unwrap_or("").into(),
                status: n
                    .get("status")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown")
                    .into(),
                cpu: n.get("cpu").and_then(|x| x.as_f64()).unwrap_or(0.0),
                maxcpu: n.get("maxcpu").and_then(|x| x.as_u64()).unwrap_or(0),
                mem: n.get("mem").and_then(|x| x.as_u64()).unwrap_or(0),
                maxmem: n.get("maxmem").and_then(|x| x.as_u64()).unwrap_or(0),
                uptime: n.get("uptime").and_then(|x| x.as_u64()).unwrap_or(0),
            })
            .collect())
    }

    pub async fn node_status(&self, node: &str) -> AppResult<NodeStatus> {
        let d = self
            .call(Method::GET, &format!("/nodes/{node}/status"), None)
            .await?;
        Ok(NodeStatus {
            cpus: d.pointer("/cpuinfo/cpus").and_then(|x| x.as_u64()).unwrap_or(0),
            mem_total: d.pointer("/memory/total").and_then(|x| x.as_u64()).unwrap_or(0),
            mem_used: d.pointer("/memory/used").and_then(|x| x.as_u64()).unwrap_or(0),
            uptime: d.get("uptime").and_then(|x| x.as_u64()).unwrap_or(0),
            loadavg: d
                .get("loadavg")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| {
                            v.as_str()
                                .map(str::to_string)
                                .or_else(|| v.as_f64().map(|f| f.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    /// Time-series metrics for a VM (`timeframe`: hour|day|week|month|year).
    pub async fn rrd(&self, vmid: i64, timeframe: &str) -> AppResult<Vec<MetricPoint>> {
        let path = format!(
            "/nodes/{}/qemu/{}/rrddata?timeframe={}&cf=AVERAGE",
            self.node, vmid, timeframe
        );
        let d = self.call(Method::GET, &path, None).await?;
        let arr = d.as_array().cloned().unwrap_or_default();
        Ok(arr
            .iter()
            .map(|p| MetricPoint {
                time: p.get("time").and_then(|x| x.as_i64()).unwrap_or(0),
                cpu: p.get("cpu").and_then(|x| x.as_f64()).unwrap_or(0.0),
                mem: p.get("mem").and_then(|x| x.as_u64()).unwrap_or(0),
                maxmem: p.get("maxmem").and_then(|x| x.as_u64()).unwrap_or(0),
                netin: p.get("netin").and_then(|x| x.as_f64()).unwrap_or(0.0),
                netout: p.get("netout").and_then(|x| x.as_f64()).unwrap_or(0.0),
                diskread: p.get("diskread").and_then(|x| x.as_f64()).unwrap_or(0.0),
                diskwrite: p.get("diskwrite").and_then(|x| x.as_f64()).unwrap_or(0.0),
            })
            .collect())
    }

    /// noVNC console ticket + the PVE websocket URL the frontend connects to.
    pub async fn console(&self, vmid: i64) -> AppResult<ConsoleTicket> {
        let path = format!("/nodes/{}/qemu/{}/vncproxy", self.node, vmid);
        let d = self
            .call(Method::POST, &path, Some(&[("websocket", "1".to_string())]))
            .await?;
        let ticket = d.get("ticket").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let port = d
            .get("port")
            .and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_i64().map(|n| n.to_string())))
            .unwrap_or_default();
        let user = d.get("user").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let ws = self.web_base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
        let ws_url = format!(
            "{}/api2/json/nodes/{}/qemu/{}/vncwebsocket?port={}&vncticket={}",
            ws,
            self.node,
            vmid,
            port,
            pct(&ticket)
        );
        Ok(ConsoleTicket { ticket, port, user, ws_url })
    }

    /// Apply cloud-init settings (best-effort; requires a cloud-init template).
    pub async fn set_cloudinit(
        &self,
        vmid: i64,
        ciuser: &str,
        cipassword: Option<&str>,
        sshkeys: Option<&str>,
        ipconfig0: &str,
    ) -> AppResult<()> {
        let path = format!("/nodes/{}/qemu/{}/config", self.node, vmid);
        let mut form: Vec<(&str, String)> = vec![
            ("ciuser", ciuser.to_string()),
            ("ipconfig0", ipconfig0.to_string()),
        ];
        if let Some(p) = cipassword {
            form.push(("cipassword", p.to_string()));
        }
        if let Some(k) = sshkeys {
            form.push(("sshkeys", k.to_string()));
        }
        self.call(Method::POST, &path, Some(&form)).await?;
        Ok(())
    }

    /// Best-effort primary non-loopback IPv4 reported by the guest agent. `Ok(None)`
    /// if the agent answered but has no usable address; `Err` if the agent is down.
    pub async fn agent_ipv4(&self, vmid: i64) -> AppResult<Option<String>> {
        let path = format!(
            "/nodes/{}/qemu/{}/agent/network-get-interfaces",
            self.node, vmid
        );
        let d = self.call(Method::GET, &path, None).await?;
        let ifaces = d
            .get("result")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        for ifc in &ifaces {
            let name = ifc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            // Skip loopback and obvious virtual interfaces.
            if name == "lo" || name.starts_with("docker") || name.starts_with("veth") {
                continue;
            }
            for a in ifc
                .get("ip-addresses")
                .and_then(|a| a.as_array())
                .into_iter()
                .flatten()
            {
                if a.get("ip-address-type").and_then(|t| t.as_str()) == Some("ipv4") {
                    if let Some(raw) = a.get("ip-address").and_then(|i| i.as_str()) {
                        // The guest agent runs inside an attacker-controlled VM, so
                        // never trust this string — require it to parse as a real
                        // IPv4 and re-serialize the canonical form (prevents config
                        // injection downstream, e.g. into the frpc TOML).
                        if let Ok(addr) = raw.parse::<std::net::Ipv4Addr>() {
                            if !addr.is_loopback()
                                && !addr.is_link_local()
                                && !addr.is_unspecified()
                            {
                                return Ok(Some(addr.to_string()));
                            }
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    /// Set a guest user's password through the guest agent (plain, not crypted).
    pub async fn agent_set_password(&self, vmid: i64, user: &str, password: &str) -> AppResult<()> {
        // The guest-agent `set-user-password` silently no-ops on some images
        // (returns success without changing the password), so set it reliably
        // with `chpasswd`, feeding "user:password" on stdin via `input-data`
        // (no shell, nothing to escape). Full path because the exec PATH is
        // minimal and may not include /usr/sbin.
        let exec_path = format!("/nodes/{}/qemu/{}/agent/exec", self.node, vmid);
        let form: Vec<(&str, String)> = vec![
            ("command", "/usr/sbin/chpasswd".to_string()),
            ("input-data", format!("{user}:{password}\n")),
        ];
        let d = self.call(Method::POST, &exec_path, Some(&form)).await?;
        let pid = d
            .get("pid")
            .and_then(|p| p.as_i64())
            .ok_or_else(|| AppError::Internal("agent set password: no pid".into()))?;
        let status_path = format!(
            "/nodes/{}/qemu/{}/agent/exec-status?pid={}",
            self.node, vmid, pid
        );
        for _ in 0..50 {
            let s = self.call(Method::GET, &status_path, None).await?;
            if s.get("exited").and_then(|e| e.as_i64()).unwrap_or(0) == 1 {
                let code = s.get("exitcode").and_then(|c| c.as_i64()).unwrap_or(-1);
                if code != 0 {
                    let err = s.get("err-data").and_then(|o| o.as_str()).unwrap_or("").to_string();
                    return Err(AppError::Internal(format!("chpasswd exit {code}: {err}")));
                }
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        Err(AppError::Internal("agent set password timeout".into()))
    }

    /// Root-filesystem usage `(used, total)` in bytes via the guest agent.
    /// Prefers the `/` mount, falling back to the largest filesystem.
    pub async fn agent_fsinfo(&self, vmid: i64) -> AppResult<(u64, u64)> {
        let path = format!("/nodes/{}/qemu/{}/agent/get-fsinfo", self.node, vmid);
        let d = self.call(Method::GET, &path, None).await?;
        let arr = d
            .get("result")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        let mut root: Option<(u64, u64)> = None;
        let mut largest: Option<(u64, u64)> = None;
        for fs in &arr {
            let total = fs.get("total-bytes").and_then(|x| x.as_u64()).unwrap_or(0);
            let used = fs.get("used-bytes").and_then(|x| x.as_u64()).unwrap_or(0);
            if total == 0 {
                continue;
            }
            if fs.get("mountpoint").and_then(|x| x.as_str()) == Some("/") {
                root = Some((used, total));
            }
            if largest.map(|(_, t)| total > t).unwrap_or(true) {
                largest = Some((used, total));
            }
        }
        root.or(largest)
            .ok_or_else(|| AppError::Unavailable("no filesystem info".into()))
    }

    /// Run a program in the guest via the agent and wait for it to exit (bounded).
    /// Returns `(exitcode, stdout, stderr)`. `argv[0]` is the absolute program path.
    pub async fn agent_exec(&self, vmid: i64, argv: &[&str]) -> AppResult<(i64, String, String)> {
        let exec_path = format!("/nodes/{}/qemu/{}/agent/exec", self.node, vmid);
        let form: Vec<(&str, String)> = argv.iter().map(|a| ("command", a.to_string())).collect();
        let d = self.call(Method::POST, &exec_path, Some(&form)).await?;
        let pid = d
            .get("pid")
            .and_then(|p| p.as_i64())
            .ok_or_else(|| AppError::Internal("agent exec: no pid".into()))?;
        let status_path = format!(
            "/nodes/{}/qemu/{}/agent/exec-status?pid={}",
            self.node, vmid, pid
        );
        for _ in 0..150 {
            let s = self.call(Method::GET, &status_path, None).await?;
            if s.get("exited").and_then(|e| e.as_i64()).unwrap_or(0) == 1 {
                let code = s.get("exitcode").and_then(|c| c.as_i64()).unwrap_or(-1);
                let out = s.get("out-data").and_then(|o| o.as_str()).unwrap_or("").to_string();
                let err = s.get("err-data").and_then(|o| o.as_str()).unwrap_or("").to_string();
                return Ok((code, out, err));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        Err(AppError::Internal("agent exec timeout".into()))
    }

    /// Read a (text) file from the guest. Returns its content.
    pub async fn agent_file_read(&self, vmid: i64, file: &str) -> AppResult<String> {
        let path = format!(
            "/nodes/{}/qemu/{}/agent/file-read?file={}",
            self.node,
            vmid,
            pct(file)
        );
        let d = self.call(Method::GET, &path, None).await?;
        Ok(d.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string())
    }

    /// Write a (text) file to the guest (plain content; Proxmox base64-encodes it).
    pub async fn agent_file_write(&self, vmid: i64, file: &str, content: &str) -> AppResult<()> {
        let path = format!("/nodes/{}/qemu/{}/agent/file-write", self.node, vmid);
        let form = [
            ("file", file.to_string()),
            ("content", content.to_string()),
        ];
        self.call(Method::POST, &path, Some(&form)).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_task_node() {
        assert_eq!(task_node("UPID:pve2:00001:...", "pve"), "pve2");
        assert_eq!(task_node("garbage", "pve"), "pve");
    }

    #[test]
    fn power_action_parse() {
        assert_eq!(PowerAction::parse("start"), Some(PowerAction::Start));
        assert_eq!(PowerAction::parse("nope"), None);
    }
}
