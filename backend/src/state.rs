use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use mongodb::Database;
use tokio::sync::broadcast;

use crate::{
    config::Config, crypto::CryptoClient, frp::Frp, pagci::PagCiClient, proxmox::ProxmoxClient,
    stripe::StripeClient, ws::WsEvent,
};

/// Fixed-window in-memory rate-limit buckets keyed by `"scope:ip"`.
pub type RateBuckets = Arc<Mutex<HashMap<String, (Instant, u32)>>>;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub db: Database,
    pub http: reqwest::Client,
    pub rate: RateBuckets,
    /// `None` when Proxmox is not configured (provisioning disabled).
    pub proxmox: Option<ProxmoxClient>,
    /// `None` when PagCI is not configured (PIX billing disabled).
    pub pagci: Option<PagCiClient>,
    /// `None` when crypto (LTC) billing is not configured.
    pub crypto: Option<CryptoClient>,
    /// `None` unless Stripe is enabled + keyed (card billing).
    pub stripe: Option<StripeClient>,
    /// `None` when the frp relay is not configured (public SSH disabled).
    pub frp: Option<Frp>,
    /// `None` when the container agent (Docker VM) is not configured.
    pub agent: Option<crate::agent::AgentClient>,
    /// Real-time event hub for the WebSocket gateway.
    pub hub: broadcast::Sender<WsEvent>,
}

impl AppState {
    pub fn new(cfg: Config, db: Database) -> Self {
        let proxmox = ProxmoxClient::from_config(&cfg);
        let pagci = PagCiClient::from_config(&cfg);
        let crypto = CryptoClient::from_config(&cfg);
        let stripe = StripeClient::from_config(&cfg);
        let frp = Frp::from_config(&cfg);
        let agent = crate::agent::AgentClient::from_config(&cfg);
        Self {
            cfg: Arc::new(cfg),
            db,
            http: reqwest::Client::new(),
            rate: Arc::new(Mutex::new(HashMap::new())),
            proxmox,
            pagci,
            crypto,
            stripe,
            frp,
            agent,
            hub: crate::ws::hub(),
        }
    }
}
