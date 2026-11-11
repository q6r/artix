//! Storage capacity by COMMITTED (sold) GB — the sum of every VPS disk size on a
//! storage, not actual usage — so we never oversell even when thin-provisioned
//! disks look empty. New VPS land on the least-loaded eligible storage; sales
//! are blocked once every eligible storage is at/over the sell threshold. On
//! shared storages (e.g. `local`) the space the host/OS already uses is reserved
//! so the hypervisor disk is never filled.

use std::collections::HashMap;

use bson::doc;

use crate::{db::Collections, error::AppResult, state::AppState};

const GB: i64 = 1024 * 1024 * 1024;

#[derive(serde::Serialize, Clone)]
pub struct StorageReport {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub total_gb: i64,
    pub used_gb: i64,
    pub committed_gb: i64,
    pub reserved_gb: i64,
    pub sellable_gb: i64,
    pub free_to_sell_gb: i64,
    pub vps_count: i64,
    pub pct_committed: i64,
    pub sellable: bool,
}

async fn committed_by_storage(state: &AppState) -> AppResult<HashMap<String, (i64, i64)>> {
    let mut map: HashMap<String, (i64, i64)> = HashMap::new();
    let mut cur = state
        .db
        .servers()
        .find(doc! { "storage": { "$ne": null } })
        .await?;
    while cur.advance().await? {
        let s = cur.deserialize_current()?;
        if let Some(st) = s.storage {
            let e = map.entry(st).or_insert((0, 0));
            e.0 += s.specs.disk_gb as i64;
            e.1 += 1;
        }
    }
    Ok(map)
}

/// Capacity report for every eligible (images-capable, in-pool) storage.
pub async fn report(state: &AppState) -> AppResult<Vec<StorageReport>> {
    let Some(px) = state.proxmox.as_ref() else {
        return Ok(vec![]);
    };
    let threshold = state.cfg.storage_sell_threshold;
    let pool = &state.cfg.storage_pool;
    let committed = committed_by_storage(state).await?;
    let mut out = Vec::new();
    for st in px.list_storages().await? {
        if !st.content.contains("images") {
            continue;
        }
        if !pool.is_empty() && !pool.iter().any(|p| p == &st.storage) {
            continue;
        }
        let total_gb = st.total / GB;
        let used_gb = st.used / GB;
        let (committed_gb, vps_count) = committed.get(&st.storage).copied().unwrap_or((0, 0));
        // Real usage not backed by sold VPS disks (OS/templates) is reserved.
        let reserved_gb = (used_gb - committed_gb).max(0);
        let sellable_total = (total_gb - reserved_gb).max(0);
        let sellable_gb = (sellable_total as f64 * threshold) as i64;
        let free_to_sell_gb = (sellable_gb - committed_gb).max(0);
        let pct_committed = if sellable_total > 0 {
            (committed_gb * 100 / sellable_total).min(100)
        } else {
            100
        };
        out.push(StorageReport {
            name: st.storage,
            kind: st.kind,
            total_gb,
            used_gb,
            committed_gb,
            reserved_gb,
            sellable_gb,
            free_to_sell_gb,
            vps_count,
            pct_committed,
            sellable: free_to_sell_gb > 0,
        });
    }
    out.sort_by(|a, b| b.free_to_sell_gb.cmp(&a.free_to_sell_gb));
    Ok(out)
}

/// The eligible storage with the most room for `disk_gb`, or None if none fits.
pub async fn pick(state: &AppState, disk_gb: u32) -> AppResult<Option<String>> {
    let rep = report(state).await?;
    Ok(rep
        .into_iter()
        .find(|r| r.free_to_sell_gb >= disk_gb as i64)
        .map(|r| r.name))
}

/// Is there capacity for `disk_gb` on any eligible storage?
pub async fn has_capacity(state: &AppState, disk_gb: u32) -> AppResult<bool> {
    Ok(pick(state, disk_gb).await?.is_some())
}
