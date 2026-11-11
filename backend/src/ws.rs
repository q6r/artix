//! Real-time gateway (WebSocket). Replaces client polling: the browser opens
//! one socket and subscribes to topics — `invoice:<id>` (payment confirmation,
//! event-driven) and `server:<id>` (live status, pushed on a tick).
//!
//! Auth: a WS handshake can't carry the httpOnly access token, so the client
//! first asks `GET /ws/ticket` (authenticated) for a short-lived signed ticket
//! and passes it as `?ticket=`. Every subscription is ownership-checked against
//! the ticket's user, so a socket can only ever observe its owner's resources.

use std::collections::HashSet;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use futures_util::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::{
    auth::token, authn::AuthUser, db::Collections, error::AppError, permissions::cap,
    state::AppState,
};

/// An event published to the hub and forwarded to every socket subscribed to
/// its `topic`.
#[derive(Clone, Debug)]
pub struct WsEvent {
    pub topic: String,
    pub event: String,
    pub data: Value,
}

/// Create the broadcast hub kept in `AppState`.
pub fn hub() -> broadcast::Sender<WsEvent> {
    broadcast::channel(512).0
}

/// Best-effort publish (no-op when there are no subscribers).
pub fn publish(state: &AppState, topic: String, event: &str, data: Value) {
    let _ = state.hub.send(WsEvent {
        topic,
        event: event.to_string(),
        data,
    });
}

// ----------------------------- SSE (developer gateway) -----------------------------

/// `GET /events` — Server-Sent Events stream of the caller's account events
/// (container actions, deploys, status). Auth via API key with the `events`
/// scope (or a browser session). Avoids polling for external integrations.
pub async fn events_sse(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    auth.scope(cap::EVENTS)?;
    let topic = format!("user:{}", auth.user_id.to_hex());
    let rx = state.hub.subscribe();

    let stream = futures_util::stream::unfold(rx, move |mut rx| {
        let topic = topic.clone();
        async move {
            loop {
                match rx.recv().await {
                    Ok(ev) if ev.topic == topic => {
                        let sse = Event::default()
                            .event(ev.event.clone())
                            .json_data(&ev.data)
                            .unwrap_or_else(|_| Event::default().event(ev.event));
                        return Some((Ok(sse), rx));
                    }
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        }
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ----------------------------- Ticket -----------------------------

pub async fn ticket(State(state): State<AppState>, auth: AuthUser) -> Json<Value> {
    let now = Utc::now().timestamp();
    let claims = token::TicketClaims {
        sub: auth.user_id.to_hex(),
        iat: now,
        exp: now + 60,
        typ: "ws".into(),
    };
    let ticket = token::sign_ticket(&claims, &state.cfg.auth_token_secret);
    Json(json!({ "ticket": ticket, "expires_in": 60 }))
}

// ----------------------------- Upgrade -----------------------------

#[derive(Deserialize)]
pub struct WsQuery {
    ticket: String,
}

pub async fn upgrade(
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
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
    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

#[derive(Deserialize)]
struct ClientMsg {
    action: String, // "subscribe" | "unsubscribe"
    topic: String,
}

async fn handle_socket(mut socket: WebSocket, state: AppState, user_id: ObjectId) {
    let mut rx = state.hub.subscribe();
    let mut topics: HashSet<String> = HashSet::new();
    let mut tick = tokio::time::interval(Duration::from_secs(5));

    loop {
        tokio::select! {
            biased;

            // 1) Messages from the client (subscribe / unsubscribe / close).
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) {
                            if handle_client_msg(&mut socket, &state, user_id, &mut topics, msg)
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        if socket.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }

            // 2) Hub events (e.g. invoice paid) for subscribed topics.
            ev = rx.recv() => {
                match ev {
                    Ok(ev) if topics.contains(&ev.topic) => {
                        let payload = json!({ "topic": ev.topic, "event": ev.event, "data": ev.data });
                        if socket.send(Message::Text(payload.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // 3) Periodic push of live status for subscribed servers.
            _ = tick.tick() => {
                let server_ids: Vec<String> = topics
                    .iter()
                    .filter_map(|t| t.strip_prefix("server:").map(str::to_string))
                    .collect();
                for id in server_ids {
                    if push_server_status(&mut socket, &state, user_id, &id).await.is_err() {
                        return;
                    }
                }
            }
        }
    }
}

async fn handle_client_msg(
    socket: &mut WebSocket,
    state: &AppState,
    user_id: ObjectId,
    topics: &mut HashSet<String>,
    msg: ClientMsg,
) -> Result<(), axum::Error> {
    match msg.action.as_str() {
        "subscribe" => {
            if owns_topic(state, user_id, &msg.topic).await {
                topics.insert(msg.topic.clone());
                let ack = json!({ "topic": msg.topic, "event": "subscribed", "data": {} });
                socket.send(Message::Text(ack.to_string())).await?;
                // Send an immediate snapshot for server topics.
                if let Some(id) = msg.topic.strip_prefix("server:") {
                    let id = id.to_string();
                    push_server_status(socket, state, user_id, &id).await?;
                }
            } else {
                let err = json!({ "topic": msg.topic, "event": "error", "data": { "code": "forbidden" } });
                socket.send(Message::Text(err.to_string())).await?;
            }
        }
        "unsubscribe" => {
            topics.remove(&msg.topic);
        }
        _ => {}
    }
    Ok(())
}

/// Ownership check: the ticket's user must own the resource behind the topic.
async fn owns_topic(state: &AppState, user_id: ObjectId, topic: &str) -> bool {
    if let Some(id) = topic.strip_prefix("invoice:") {
        let Ok(oid) = ObjectId::parse_str(id) else {
            return false;
        };
        return state
            .db
            .invoices()
            .find_one(doc! { "_id": oid, "user_id": user_id })
            .await
            .ok()
            .flatten()
            .is_some();
    }
    if let Some(id) = topic.strip_prefix("server:") {
        let Ok(oid) = ObjectId::parse_str(id) else {
            return false;
        };
        return state
            .db
            .servers()
            .find_one(doc! { "_id": oid, "user_id": user_id })
            .await
            .ok()
            .flatten()
            .is_some();
    }
    if let Some(id) = topic.strip_prefix("user:") {
        return id == user_id.to_hex();
    }
    false
}

/// Fetch and push one live status snapshot for a server the user owns.
async fn push_server_status(
    socket: &mut WebSocket,
    state: &AppState,
    user_id: ObjectId,
    id: &str,
) -> Result<(), axum::Error> {
    let Ok(oid) = ObjectId::parse_str(id) else {
        return Ok(());
    };
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": oid, "user_id": user_id })
        .await
        .ok()
        .flatten();
    let Some(server) = server else { return Ok(()) };

    let mut data = json!({ "state": server.state });
    if let (Some(px), Some(vmid)) = (&state.proxmox, server.vmid) {
        if let Ok(st) = px.status(vmid).await {
            data = json!({
                "state": server.state,
                "status": st.status,
                "mem": st.mem,
                "max_mem": st.max_mem,
                "cpus": st.cpus,
                "uptime": st.uptime,
            });
        }
    }
    let payload = json!({ "topic": format!("server:{id}"), "event": "stat", "data": data });
    socket.send(Message::Text(payload.to_string())).await
}
