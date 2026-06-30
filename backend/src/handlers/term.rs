//! Backend WebSocket proxy for the xterm.js serial terminal.
//!
//! Proxmox's serial console (`termproxy` + `vncwebsocket`) needs a real PVE user
//! ticket for its in-band auth and won't accept API tokens; the session cookie
//! must never reach the browser. So the backend holds the ticket, dials Proxmox
//! itself, performs the `user:ticket` handshake, and then relays raw bytes
//! between the browser and Proxmox. Authorization is the normal owner/CONSOLE
//! check before the upgrade.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use bson::oid::ObjectId;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio_tungstenite::{
    connect_async_tls_with_config, tungstenite::client::IntoClientRequest,
    tungstenite::protocol::Message as TMessage, Connector,
};

use crate::{auth::token, permissions::server_perm, proxmox::TermSession, state::AppState};

#[derive(Deserialize)]
pub struct TermQuery {
    ticket: String,
}

pub async fn term_proxy(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<TermQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let now = Utc::now().timestamp();
    let claims = match token::verify_ticket(&q.ticket, &state.cfg.auth_token_secret, now) {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid ticket").into_response(),
    };
    let user_id = match ObjectId::parse_str(&claims.sub) {
        Ok(id) => id,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid ticket").into_response(),
    };
    let server =
        match crate::handlers::servers::access(&state, user_id, &id, server_perm::CONSOLE).await {
            Ok(s) => s,
            Err(_) => return (StatusCode::FORBIDDEN, "forbidden").into_response(),
        };
    let vmid = match server.vmid {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "vm not provisioned").into_response(),
    };
    let px = match state.proxmox.as_ref() {
        Some(p) => p,
        None => return (StatusCode::SERVICE_UNAVAILABLE, "console unavailable").into_response(),
    };
    let sess = match px.term(vmid).await {
        Ok(s) => s,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("term: {e}")).into_response(),
    };
    let insecure = state.cfg.proxmox_insecure;
    ws.on_upgrade(move |socket| bridge(socket, sess, insecure))
}

async fn bridge(browser: WebSocket, sess: TermSession, insecure: bool) {
    let (mut browser_tx, mut browser_rx) = browser.split();

    // Dial Proxmox vncwebsocket with the PVE cookie + the binary subprotocol.
    let mut req = match sess.ws_url.as_str().into_client_request() {
        Ok(r) => r,
        Err(_) => return,
    };
    {
        let h = req.headers_mut();
        if let Ok(v) = format!("PVEAuthCookie={}", sess.pveauth).parse() {
            h.insert("Cookie", v);
        }
        if let Ok(v) = "binary".parse() {
            h.insert("Sec-WebSocket-Protocol", v);
        }
    }
    let connector = match native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(insecure)
        .danger_accept_invalid_hostnames(insecure)
        .build()
    {
        Ok(c) => Connector::NativeTls(c),
        Err(_) => return,
    };
    let (pve, _resp) =
        match connect_async_tls_with_config(req, None, false, Some(connector)).await {
            Ok(x) => x,
            Err(_) => {
                let _ = browser_tx.send(Message::Close(None)).await;
                return;
            }
        };
    let (mut pve_tx, mut pve_rx) = pve.split();

    // In-band auth, then strip the leading "OK" from the first reply.
    if pve_tx
        .send(TMessage::Binary(
            format!("{}:{}\n", sess.user, sess.ticket).into_bytes(),
        ))
        .await
        .is_err()
    {
        return;
    }
    loop {
        match pve_rx.next().await {
            Some(Ok(TMessage::Binary(mut b))) => {
                if b.starts_with(b"OK") {
                    b.drain(0..2);
                }
                if !b.is_empty() {
                    let _ = browser_tx.send(Message::Binary(b)).await;
                }
                break;
            }
            Some(Ok(TMessage::Text(t))) => {
                let mut b = t.into_bytes();
                if b.starts_with(b"OK") {
                    b.drain(0..2);
                }
                if !b.is_empty() {
                    let _ = browser_tx.send(Message::Binary(b)).await;
                }
                break;
            }
            Some(Ok(_)) => continue,
            _ => {
                let _ = browser_tx.send(Message::Close(None)).await;
                return;
            }
        }
    }

    // Transparent relay until either side closes.
    loop {
        tokio::select! {
            from_browser = browser_rx.next() => match from_browser {
                Some(Ok(Message::Binary(b))) => {
                    if pve_tx.send(TMessage::Binary(b)).await.is_err() { break; }
                }
                Some(Ok(Message::Text(t))) => {
                    if pve_tx.send(TMessage::Binary(t.into_bytes())).await.is_err() { break; }
                }
                Some(Ok(Message::Ping(p))) => { let _ = browser_tx.send(Message::Pong(p)).await; }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
                _ => {}
            },
            from_pve = pve_rx.next() => match from_pve {
                Some(Ok(TMessage::Binary(b))) => {
                    if browser_tx.send(Message::Binary(b)).await.is_err() { break; }
                }
                Some(Ok(TMessage::Text(t))) => {
                    if browser_tx.send(Message::Binary(t.into_bytes())).await.is_err() { break; }
                }
                Some(Ok(TMessage::Ping(p))) => { let _ = pve_tx.send(TMessage::Pong(p)).await; }
                Some(Ok(TMessage::Close(_))) | None => break,
                Some(Err(_)) => break,
                _ => {}
            },
        }
    }
    let _ = pve_tx.send(TMessage::Close(None)).await;
    let _ = browser_tx.send(Message::Close(None)).await;
}
