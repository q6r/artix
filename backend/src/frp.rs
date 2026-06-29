//! Public SSH access for NAT'd VPS via one or more frp relays.
//!
//! Each relay is a public VPS running `frps`; the Proxmox host runs one `frpc`
//! instance per relay (managed through its admin HTTP API — no SSH needed). A
//! VPS is assigned to a relay (the relay's public host is stored as the server's
//! `ssh_host`) and gets a dedicated port forwarded to `VM_IP:22`. New VPS land on
//! the relay with the most free ports.

use std::{
    collections::{BTreeSet, HashMap},
    time::Duration,
};

use bson::{doc, oid::ObjectId};
use serde::Deserialize;

use crate::{
    config::Config,
    db::Collections,
    error::{AppError, AppResult},
    models::{RelaySetting, Server},
    state::AppState,
};

fn d_port() -> u16 {
    7000
}
fn d_min() -> u16 {
    2200
}
fn d_max() -> u16 {
    2300
}
fn d_user() -> String {
    "artix".into()
}

/// One relay: a public `frps` + the host-side `frpc` instance that feeds it.
#[derive(Clone, Deserialize)]
pub struct Relay {
    pub name: String,
    /// Public host clients connect to (`ssh user@host -p port`).
    pub host: String,
    /// Address frpc dials to reach frps (defaults to `host`).
    #[serde(default)]
    pub server_addr: String,
    #[serde(default = "d_port")]
    pub server_port: u16,
    pub token: String,
    /// frpc admin API for this relay's instance, e.g. `http://10.0.0.x:7400`.
    pub admin_url: String,
    #[serde(default = "d_user")]
    pub admin_user: String,
    pub admin_pass: String,
    #[serde(default = "d_min")]
    pub port_min: u16,
    #[serde(default = "d_max")]
    pub port_max: u16,
}

/// Admin-facing view of a relay: config + live usage + enabled flag.
#[derive(serde::Serialize)]
pub struct RelayInfo {
    pub name: String,
    pub host: String,
    pub server_port: u16,
    pub port_min: u16,
    pub port_max: u16,
    pub used_ports: usize,
    pub capacity: usize,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct Frp {
    http: reqwest::Client,
    relays: Vec<Relay>,
}

fn admin_port_of(url: &str) -> u16 {
    url.rsplit(':')
        .next()
        .and_then(|s| s.split('/').next())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(7400)
}

impl Frp {
    pub fn from_config(cfg: &Config) -> Option<Self> {
        let mut relays: Vec<Relay> = if !cfg.frp_relays.trim().is_empty() {
            match serde_json::from_str(&cfg.frp_relays) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!("FRP_RELAYS parse error: {e}");
                    return None;
                }
            }
        } else if !cfg.frp_relay_host.is_empty() && !cfg.frp_admin_url.is_empty() {
            // Backward-compatible single relay from the flat FRP_* vars.
            vec![Relay {
                name: "relay1".into(),
                host: cfg.frp_relay_host.clone(),
                server_addr: cfg.frp_server_addr.clone(),
                server_port: cfg.frp_server_port,
                token: cfg.frp_token.clone(),
                admin_url: cfg.frp_admin_url.clone(),
                admin_user: cfg.frp_admin_user.clone(),
                admin_pass: cfg.frp_admin_pass.clone(),
                port_min: cfg.frp_port_min,
                port_max: cfg.frp_port_max,
            }]
        } else {
            return None;
        };
        if relays.is_empty() {
            return None;
        }
        for r in &mut relays {
            if r.server_addr.is_empty() {
                r.server_addr = r.host.clone();
            }
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .ok()?;
        Some(Self { http, relays })
    }

    fn relay_by_host(&self, host: &str) -> Option<&Relay> {
        self.relays.iter().find(|r| r.host == host)
    }

    fn relay_by_name(&self, name: &str) -> Option<&Relay> {
        self.relays.iter().find(|r| r.name == name)
    }

    /// Relay names an admin has disabled (no doc = enabled).
    async fn disabled_names(&self, state: &AppState) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if let Ok(mut cur) = state.db.relay_settings().find(doc! { "enabled": false }).await {
            while cur.advance().await.unwrap_or(false) {
                if let Ok(rs) = cur.deserialize_current() {
                    out.insert(rs.name);
                }
            }
        }
        out
    }

    /// Every configured relay with usage + enabled state (admin panel).
    pub async fn admin_list(&self, state: &AppState) -> AppResult<Vec<RelayInfo>> {
        let used = self.used_by_host(state).await?;
        let disabled = self.disabled_names(state).await;
        Ok(self
            .relays
            .iter()
            .map(|r| {
                let u = used.get(&r.host).map(|s| s.len()).unwrap_or(0);
                RelayInfo {
                    name: r.name.clone(),
                    host: r.host.clone(),
                    server_port: r.server_port,
                    port_min: r.port_min,
                    port_max: r.port_max,
                    used_ports: u,
                    capacity: (r.port_max - r.port_min + 1) as usize,
                    enabled: !disabled.contains(&r.name),
                }
            })
            .collect())
    }

    /// Enable/disable a relay. Disabled relays are skipped by `pick_relay`;
    /// existing tunnels are left intact.
    pub async fn set_enabled(&self, state: &AppState, name: &str, enabled: bool) -> AppResult<()> {
        if self.relay_by_name(name).is_none() {
            return Err(AppError::NotFound);
        }
        state
            .db
            .relay_settings()
            .update_one(
                doc! { "name": name },
                doc! { "$set": { "name": name, "enabled": enabled } },
            )
            .upsert(true)
            .await?;
        Ok(())
    }

    /// Move a server to a different relay and/or change its port. Re-syncs
    /// the new relay (and the old one, if it changed, to drop the tunnel).
    pub async fn reassign(
        &self,
        state: &AppState,
        server_id: ObjectId,
        relay_name: Option<&str>,
        port: Option<i32>,
    ) -> AppResult<(String, i32)> {
        let server = state.db.servers().find_one(doc! { "_id": server_id }).await?.ok_or(AppError::NotFound)?;
        let old_host = server.ssh_host.clone();
        let relay = match relay_name {
            Some(n) => self.relay_by_name(n).ok_or(AppError::NotFound)?.clone(),
            None => match server.ssh_host.as_deref().and_then(|h| self.relay_by_host(h)) {
                Some(r) => r.clone(),
                None => return Err(AppError::Validation("server has no relay".into())),
            },
        };
        let used = self.used_by_host(state).await?.remove(&relay.host).unwrap_or_default();
        let new_port = match port {
            Some(p) => {
                if p < relay.port_min as i32 || p > relay.port_max as i32 {
                    return Err(AppError::Validation("port out of relay range".into()));
                }
                let same = server.ssh_host.as_deref() == Some(relay.host.as_str())
                    && server.ssh_port == Some(p);
                if used.contains(&p) && !same {
                    return Err(AppError::Conflict("port already used on relay".into()));
                }
                p
            }
            None => self.alloc_in(&relay, &used)?,
        };
        state
            .db
            .servers()
            .update_one(
                doc! { "_id": server_id },
                doc! { "$set": { "ssh_host": &relay.host, "ssh_port": new_port } },
            )
            .await?;
        self.sync_relay(state, &relay).await?;
        if let Some(oh) = old_host {
            if oh != relay.host {
                if let Some(old) = self.relay_by_host(&oh) {
                    let _ = self.sync_relay(state, old).await;
                }
            }
        }
        Ok((relay.host, new_port))
    }

    /// Ports already in use, grouped by relay host.
    async fn used_by_host(&self, state: &AppState) -> AppResult<HashMap<String, BTreeSet<i32>>> {
        let mut map: HashMap<String, BTreeSet<i32>> = HashMap::new();
        let mut cursor = state
            .db
            .servers()
            .find(doc! { "ssh_port": { "$ne": null }, "ssh_host": { "$ne": null } })
            .await?;
        while cursor.advance().await? {
            let s = cursor.deserialize_current()?;
            if let (Some(h), Some(p)) = (s.ssh_host, s.ssh_port) {
                map.entry(h).or_default().insert(p);
            }
        }
        Ok(map)
    }

    /// The relay with the most free ports (simple load balancing).
    pub async fn pick_relay(&self, state: &AppState) -> AppResult<Relay> {
        let used = self.used_by_host(state).await?;
        let disabled = self.disabled_names(state).await;
        let mut best: Option<&Relay> = None;
        let mut best_free: i64 = -1;
        for r in &self.relays {
            if disabled.contains(&r.name) {
                continue;
            }
            let cap = r.port_max as i64 - r.port_min as i64 + 1;
            let u = used.get(&r.host).map(|s| s.len() as i64).unwrap_or(0);
            let free = cap - u;
            if free > best_free {
                best_free = free;
                best = Some(r);
            }
        }
        match best {
            Some(r) if best_free > 0 => Ok(r.clone()),
            _ => Err(AppError::Unavailable("no relay capacity".into())),
        }
    }

    fn alloc_in(&self, relay: &Relay, used: &BTreeSet<i32>) -> AppResult<i32> {
        for p in (relay.port_min as i32)..=(relay.port_max as i32) {
            if !used.contains(&p) {
                return Ok(p);
            }
        }
        Err(AppError::Unavailable("no free relay port".into()))
    }

    /// Rebuild and apply one relay's frpc config from the servers assigned to it.
    pub async fn sync_relay(&self, state: &AppState, relay: &Relay) -> AppResult<()> {
        let mut cfg = String::new();
        cfg.push_str(&format!("serverAddr = \"{}\"\n", relay.server_addr));
        cfg.push_str(&format!("serverPort = {}\n", relay.server_port));
        cfg.push_str("auth.method = \"token\"\n");
        cfg.push_str(&format!("auth.token = \"{}\"\n", relay.token));
        cfg.push_str("webServer.addr = \"0.0.0.0\"\n");
        cfg.push_str(&format!("webServer.port = {}\n", admin_port_of(&relay.admin_url)));
        cfg.push_str(&format!("webServer.user = \"{}\"\n", relay.admin_user));
        cfg.push_str(&format!("webServer.password = \"{}\"\n", relay.admin_pass));

        let mut cursor = state
            .db
            .servers()
            .find(doc! {
                "ssh_host": &relay.host,
                "ssh_port": { "$ne": null },
                "ip": { "$ne": null },
                "vmid": { "$ne": null },
            })
            .await?;
        while cursor.advance().await? {
            let s = cursor.deserialize_current()?;
            if let (Some(ip), Some(port), Some(id)) = (s.ip.as_ref(), s.ssh_port, s.id) {
                // Defense-in-depth: never interpolate an IP that isn't a valid
                // address into the relay config (guards legacy/unsanitized docs).
                if ip.parse::<std::net::IpAddr>().is_err() {
                    tracing::warn!(server = ?s.id, ip = %ip, "skipping invalid ip in frpc sync");
                    continue;
                }
                cfg.push_str(&format!(
                    "\n[[proxies]]\nname = \"vps-{}\"\ntype = \"tcp\"\nlocalIP = \"{}\"\nlocalPort = 22\nremotePort = {}\n",
                    id.to_hex(),
                    ip,
                    port
                ));
            }
        }

        let put = self
            .http
            .put(format!("{}/api/config", relay.admin_url.trim_end_matches('/')))
            .basic_auth(&relay.admin_user, Some(&relay.admin_pass))
            .body(cfg)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("frpc put: {e}")))?;
        if !put.status().is_success() {
            return Err(AppError::Internal(format!("frpc put status {}", put.status())));
        }
        let reload = self
            .http
            .get(format!("{}/api/reload", relay.admin_url.trim_end_matches('/')))
            .basic_auth(&relay.admin_user, Some(&relay.admin_pass))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("frpc reload: {e}")))?;
        if !reload.status().is_success() {
            return Err(AppError::Internal(format!(
                "frpc reload status {}",
                reload.status()
            )));
        }
        Ok(())
    }

    /// Allocate a free port on `relay` and persist it on the server, retrying on
    /// a unique-index conflict (TOCTOU: another provision grabbed the same port).
    async fn alloc_and_assign(
        &self,
        state: &AppState,
        relay: &Relay,
        server_id: Option<ObjectId>,
    ) -> AppResult<i32> {
        for _ in 0..8 {
            let used = self
                .used_by_host(state)
                .await?
                .remove(&relay.host)
                .unwrap_or_default();
            let port = self.alloc_in(relay, &used)?;
            match state
                .db
                .servers()
                .update_one(
                    doc! { "_id": server_id },
                    doc! { "$set": { "ssh_host": &relay.host, "ssh_port": port }},
                )
                .await
            {
                Ok(_) => return Ok(port),
                // Duplicate key = the (ssh_host, ssh_port) was taken concurrently.
                Err(e) if e.to_string().contains("E11000") => continue,
                Err(e) => return Err(AppError::Db(e)),
            }
        }
        Err(AppError::Unavailable("could not allocate relay port".into()))
    }

    /// Re-sync every relay (used after a delete so dropped VPS disappear).
    pub async fn sync(&self, state: &AppState) -> AppResult<()> {
        for r in &self.relays {
            if let Err(e) = self.sync_relay(state, r).await {
                tracing::warn!(relay = %r.name, error = %e, "frp sync failed");
            }
        }
        Ok(())
    }
}

/// Ensure a server with a known IP has a relay + port + tunnel. Picks the least
/// loaded relay the first time, then returns the stored `(host, port)` without
/// re-syncing. No-op when frp isn't configured or the VM has no IP yet.
pub async fn ensure(state: &AppState, server: &Server) -> AppResult<Option<(String, i32)>> {
    let Some(frp) = state.frp.as_ref() else {
        return Ok(None);
    };
    if server.vmid.is_none() || server.ip.is_none() {
        return Ok(None);
    }
    if let (Some(h), Some(p)) = (server.ssh_host.clone(), server.ssh_port) {
        return Ok(Some((h, p)));
    }
    let relay = frp.pick_relay(state).await?;
    let port = frp.alloc_and_assign(state, &relay, server.id).await?;
    frp.sync_relay(state, &relay).await?;
    Ok(Some((relay.host, port)))
}

/// Background task after a VM boots: wait for the guest agent, capture the VM IP,
/// assign a relay + port (first time), and re-sync that relay. Always re-syncs so
/// a changed IP (e.g. after a reinstall) updates the tunnel target.
pub async fn provision_tunnel(state: AppState, vmid: i64, server_id: Option<ObjectId>) {
    let Some(sid) = server_id else { return };
    let Some(frp) = state.frp.clone() else { return };
    let Some(px) = state.proxmox.clone() else { return };

    let mut ip = None;
    for _ in 0..18 {
        if let Ok(Some(a)) = px.agent_ipv4(vmid).await {
            ip = Some(a);
            break;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let Some(addr) = ip else { return };

    let server = match state.db.servers().find_one(doc! { "_id": sid }).await {
        Ok(Some(s)) => s,
        _ => return,
    };

    // Determine the relay: keep the existing one (reinstall) or pick a new one.
    let relay = match server.ssh_host.as_deref().and_then(|h| frp.relay_by_host(h)) {
        Some(r) => r.clone(),
        None => match frp.pick_relay(&state).await {
            Ok(r) => r,
            Err(_) => return,
        },
    };

    // Persist the (validated) IP, then allocate a relay port if not yet assigned.
    let _ = state
        .db
        .servers()
        .update_one(doc! { "_id": sid }, doc! { "$set": { "ip": &addr }})
        .await;
    if server.ssh_port.is_none() {
        let _ = frp.alloc_and_assign(&state, &relay, Some(sid)).await;
    }
    let _ = frp.sync_relay(&state, &relay).await;
}
