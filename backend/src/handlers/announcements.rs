//! Site announcements: admins publish banners (top bar) or modals, scoped to
//! the whole app, the dashboard, or specific paths. Each can carry colored
//! action buttons and a small-markdown description (`**bold**`, `[text](url)`).

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::Deserialize;

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{
        Announcement, AnnouncementButton, AnnouncementKind, AnnouncementPublic, AnnouncementScope,
        ButtonColor,
    },
    permissions::perm,
    state::AppState,
};

// ----------------------------- Public -----------------------------

/// Active announcements (unauthenticated). The client filters by current path
/// against each announcement's scope.
pub async fn list_active(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<AnnouncementPublic>>> {
    let mut cursor = state
        .db
        .announcements()
        .find(doc! { "active": true })
        .sort(doc! { "created_at": -1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

// ----------------------------- Admin DTOs -----------------------------

#[derive(Deserialize)]
pub struct ButtonInput {
    pub label: String,
    pub url: String,
    pub color: String,
}

#[derive(Deserialize)]
pub struct AnnouncementInput {
    pub kind: String,  // "banner" | "modal"
    pub scope: String, // "global" | "dashboard" | "pages"
    #[serde(default)]
    pub pages: Vec<String>,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub buttons: Vec<ButtonInput>,
    #[serde(default)]
    pub active: bool,
}

fn parse_kind(s: &str) -> AppResult<AnnouncementKind> {
    match s {
        "banner" => Ok(AnnouncementKind::Banner),
        "modal" => Ok(AnnouncementKind::Modal),
        _ => Err(AppError::Validation("invalid kind".into())),
    }
}

fn parse_scope(s: &str) -> AppResult<AnnouncementScope> {
    match s {
        "global" => Ok(AnnouncementScope::Global),
        "dashboard" => Ok(AnnouncementScope::Dashboard),
        "pages" => Ok(AnnouncementScope::Pages),
        _ => Err(AppError::Validation("invalid scope".into())),
    }
}

/// Only allow http(s) absolute URLs or same-origin paths — blocks `javascript:`,
/// `data:`, etc. that would otherwise execute when rendered as a button href.
fn safe_url(u: &str) -> bool {
    u.starts_with("https://") || u.starts_with("http://") || u.starts_with('/')
}

fn parse_color(s: &str) -> AppResult<ButtonColor> {
    match s {
        "blue" => Ok(ButtonColor::Blue),
        "red" => Ok(ButtonColor::Red),
        "gray" => Ok(ButtonColor::Gray),
        "green" => Ok(ButtonColor::Green),
        _ => Err(AppError::Validation("invalid button color".into())),
    }
}

fn build_fields(
    req: &AnnouncementInput,
) -> AppResult<(
    AnnouncementKind,
    AnnouncementScope,
    Vec<String>,
    String,
    String,
    Vec<AnnouncementButton>,
)> {
    let kind = parse_kind(&req.kind)?;
    let scope = parse_scope(&req.scope)?;
    let title = req.title.trim().to_string();
    if title.is_empty() || title.len() > 160 {
        return Err(AppError::Validation("invalid title".into()));
    }
    if req.description.len() > 4000 {
        return Err(AppError::Validation("description too long".into()));
    }
    let pages: Vec<String> = req
        .pages
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if scope == AnnouncementScope::Pages && pages.is_empty() {
        return Err(AppError::Validation("at least one page is required".into()));
    }
    if req.buttons.len() > 4 {
        return Err(AppError::Validation("too many buttons".into()));
    }
    let mut buttons = Vec::new();
    for b in &req.buttons {
        let label = b.label.trim().to_string();
        let url = b.url.trim().to_string();
        if label.is_empty() || url.is_empty() {
            return Err(AppError::Validation(
                "button label and url are required".into(),
            ));
        }
        if !safe_url(&url) {
            return Err(AppError::Validation(
                "button url must be http(s) or a /path".into(),
            ));
        }
        buttons.push(AnnouncementButton {
            label,
            url,
            color: parse_color(&b.color)?,
        });
    }
    Ok((kind, scope, pages, title, req.description.clone(), buttons))
}

// ----------------------------- Admin handlers -----------------------------

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<AnnouncementPublic>>> {
    auth.require(perm::ANNOUNCEMENTS_READ)?;
    let mut cursor = state
        .db
        .announcements()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<AnnouncementInput>,
) -> AppResult<Json<AnnouncementPublic>> {
    auth.require(perm::ANNOUNCEMENTS_MANAGE)?;
    let (kind, scope, pages, title, description, buttons) = build_fields(&req)?;
    let now = Utc::now();
    let ann = Announcement {
        id: None,
        kind,
        scope,
        pages,
        title,
        description,
        buttons,
        active: req.active,
        created_by: Some(auth.user_id),
        created_at: now,
        updated_at: now,
    };
    let id = state
        .db
        .announcements()
        .insert_one(&ann)
        .await?
        .inserted_id
        .as_object_id();
    let mut saved = ann;
    saved.id = id;
    Ok(Json(saved.public()))
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<AnnouncementInput>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ANNOUNCEMENTS_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let (kind, scope, pages, title, description, buttons) = build_fields(&req)?;

    let kind_str = match kind {
        AnnouncementKind::Banner => "banner",
        AnnouncementKind::Modal => "modal",
    };
    let scope_str = match scope {
        AnnouncementScope::Global => "global",
        AnnouncementScope::Dashboard => "dashboard",
        AnnouncementScope::Pages => "pages",
    };
    let buttons_bson = bson::to_bson(&buttons).map_err(|_| AppError::Internal("bson".into()))?;

    let res = state
        .db
        .announcements()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": {
                "kind": kind_str,
                "scope": scope_str,
                "pages": pages,
                "title": title,
                "description": description,
                "buttons": buttons_bson,
                "active": req.active,
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ANNOUNCEMENTS_MANAGE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state
        .db
        .announcements()
        .delete_one(doc! { "_id": oid })
        .await?;
    if res.deleted_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
