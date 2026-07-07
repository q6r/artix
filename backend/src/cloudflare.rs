//! Minimal Cloudflare DNS writer for Minecraft connect domains.
//!
//! Per server we keep two records in the apex zone so players connect by name:
//!   - `A  <sub>.<zone> -> <relay IP>` (DNS-only: Cloudflare's proxy is HTTP-only,
//!     Minecraft is raw TCP/UDP, so it must be grey-cloud).
//!   - `SRV _minecraft._tcp.<sub>.<zone> -> <sub>.<zone>:<port>` so Java clients
//!     get the port from the domain alone (`<sub>.artix.cloud`, no `:port`).
//! No-op when `CLOUDFLARE_*` isn't configured.

use serde_json::json;

use crate::{error::AppResult, state::AppState};

fn enabled(state: &AppState) -> bool {
    !state.cfg.cloudflare_api_token.is_empty() && !state.cfg.cloudflare_zone_id.is_empty()
}

fn base(state: &AppState) -> String {
    format!(
        "https://api.cloudflare.com/client/v4/zones/{}/dns_records",
        state.cfg.cloudflare_zone_id
    )
}

/// The public connect domain for a subdomain, e.g. "myserver.artix.cloud".
pub fn mc_domain(state: &AppState, sub: &str) -> String {
    format!("{}.{}", sub, state.cfg.cloudflare_zone_name)
}

/// Record id for `(name, type)` if it exists.
async fn find_record(state: &AppState, name: &str, typ: &str) -> Option<String> {
    let url = format!("{}?type={}&name={}", base(state), typ, name);
    let v: serde_json::Value = state
        .http
        .get(&url)
        .bearer_auth(&state.cfg.cloudflare_api_token)
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    v.get("result")?
        .as_array()?
        .first()?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

/// Create or update a record (idempotent).
async fn upsert(state: &AppState, name: &str, typ: &str, body: serde_json::Value) {
    let token = &state.cfg.cloudflare_api_token;
    if let Some(id) = find_record(state, name, typ).await {
        let _ = state
            .http
            .put(format!("{}/{}", base(state), id))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await;
    } else {
        let _ = state
            .http
            .post(base(state))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await;
    }
}

/// Point `<sub>.<zone>` at a Minecraft server (relay `ip` : `port`).
pub async fn set_mc_dns(state: &AppState, sub: &str, ip: &str, port: i32) -> AppResult<()> {
    if !enabled(state) {
        return Ok(());
    }
    let fqdn = format!("{}.{}", sub, state.cfg.cloudflare_zone_name);
    let srv = format!("_minecraft._tcp.{fqdn}");
    upsert(
        state,
        &fqdn,
        "A",
        json!({ "type": "A", "name": fqdn, "content": ip, "proxied": false, "ttl": 120 }),
    )
    .await;
    upsert(
        state,
        &srv,
        "SRV",
        json!({
            "type": "SRV",
            "name": srv,
            "data": { "priority": 0, "weight": 5, "port": port, "target": fqdn }
        }),
    )
    .await;
    Ok(())
}

/// Point `<sub>.<zone>` at a voice (Mumble) server relay `ip` via an A record
/// only (Mumble is raw TCP/UDP; no SRV needed — the client uses an explicit port).
pub async fn set_voice_dns(state: &AppState, sub: &str, ip: &str) -> AppResult<()> {
    if !enabled(state) {
        return Ok(());
    }
    let fqdn = format!("{}.{}", sub, state.cfg.cloudflare_zone_name);
    upsert(
        state,
        &fqdn,
        "A",
        json!({ "type": "A", "name": fqdn, "content": ip, "proxied": false, "ttl": 120 }),
    )
    .await;
    Ok(())
}

/// Remove the A + SRV records for a subdomain (on delete).
pub async fn clear_mc_dns(state: &AppState, sub: &str) -> AppResult<()> {
    if !enabled(state) {
        return Ok(());
    }
    let fqdn = format!("{}.{}", sub, state.cfg.cloudflare_zone_name);
    let srv = format!("_minecraft._tcp.{fqdn}");
    for (name, typ) in [(fqdn.as_str(), "A"), (srv.as_str(), "SRV")] {
        if let Some(id) = find_record(state, name, typ).await {
            let _ = state
                .http
                .delete(format!("{}/{}", base(state), id))
                .bearer_auth(&state.cfg.cloudflare_api_token)
                .send()
                .await;
        }
    }
    Ok(())
}
