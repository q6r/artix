//! Support tickets. A user opens a ticket and exchanges messages; staff (admins
//! with `support.*`) read every ticket and reply as staff.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{
        Ticket, TicketCategory, TicketCategoryPublic, TicketMessage, TicketMessagePublic,
        TicketPublic, TicketStatus, UserRef,
    },
    permissions::{granted, perm},
    state::AppState,
};

/// Can the staff member VIEW tickets of this category? `support.read` and
/// `support.manage` see everything; `support.cat.<slug>` sees only that type.
fn can_view(perms: &[String], cat: Option<&str>) -> bool {
    if granted(perms, perm::SUPPORT_MANAGE) || granted(perms, perm::SUPPORT_READ) {
        return true;
    }
    match cat {
        Some(c) => granted(perms, &format!("support.cat.{c}")),
        None => false,
    }
}

/// Can the staff member HANDLE (reply/assign) tickets of this category?
fn can_handle(perms: &[String], cat: Option<&str>) -> bool {
    if granted(perms, perm::SUPPORT_MANAGE) {
        return true;
    }
    match cat {
        Some(c) => granted(perms, &format!("support.cat.{c}")),
        None => false,
    }
}

/// Does the user have any staff access to support at all?
fn has_support_access(perms: &[String]) -> bool {
    granted(perms, perm::SUPPORT_READ)
        || granted(perms, perm::SUPPORT_MANAGE)
        || perms
            .iter()
            .any(|p| p.starts_with("support.cat.") || p == "support.*" || p == "*")
}

use super::admin::Pagination;

fn oid(id: &str) -> AppResult<ObjectId> {
    ObjectId::parse_str(id).map_err(|_| AppError::NotFound)
}

#[derive(Deserialize)]
pub struct CreateTicketReq {
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub category: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateTicketReq>,
) -> AppResult<Json<TicketPublic>> {
    let subject = req.subject.trim().to_string();
    let body = req.body.trim().to_string();
    if subject.is_empty() || subject.len() > 160 {
        return Err(AppError::Validation("invalid subject".into()));
    }
    if body.is_empty() || body.len() > 8000 {
        return Err(AppError::Validation("invalid message".into()));
    }
    // Validate the category against the admin-managed list, if provided.
    let category = match req
        .category
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(slug) => {
            state
                .db
                .ticket_categories()
                .find_one(doc! { "slug": slug })
                .await?
                .ok_or_else(|| AppError::Validation("invalid category".into()))?;
            Some(slug.to_string())
        }
        None => None,
    };
    let now = Utc::now();
    let ticket = Ticket {
        id: None,
        user_id: auth.user_id,
        subject,
        status: TicketStatus::Open,
        category,
        assignee_id: None,
        members: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    let ticket_id = state
        .db
        .tickets()
        .insert_one(&ticket)
        .await?
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert".into()))?;

    state
        .db
        .ticket_messages()
        .insert_one(&TicketMessage {
            id: None,
            ticket_id,
            author_id: auth.user_id,
            body,
            is_staff: false,
            created_at: now,
        })
        .await?;

    let mut saved = ticket;
    saved.id = Some(ticket_id);
    Ok(Json(saved.public()))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<TicketPublic>>> {
    let mut cursor = state
        .db
        .tickets()
        .find(doc! { "$or": [ { "user_id": auth.user_id }, { "members": auth.user_id } ] })
        .sort(doc! { "updated_at": -1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

#[derive(Serialize)]
pub struct TicketThread {
    pub ticket: TicketPublic,
    pub messages: Vec<TicketMessagePublic>,
}

/// Owner-only lookup (for member management and closing).
async fn owned_ticket(state: &AppState, auth: &AuthUser, id: &str) -> AppResult<Ticket> {
    let tid = oid(id)?;
    state
        .db
        .tickets()
        .find_one(doc! { "_id": tid, "user_id": auth.user_id })
        .await?
        .ok_or(AppError::NotFound)
}

/// Build the public ticket, resolving the assignee and member user refs.
async fn enrich(state: &AppState, ticket: &Ticket) -> AppResult<TicketPublic> {
    let mut public = ticket.public();
    if let Some(owner) = state
        .db
        .users()
        .find_one(doc! { "_id": ticket.user_id })
        .await?
    {
        public.owner = Some(UserRef::of(&owner));
    }
    if let Some(aid) = ticket.assignee_id {
        if let Some(u) = state.db.users().find_one(doc! { "_id": aid }).await? {
            public.assignee = Some(UserRef::of(&u));
        }
    }
    if !ticket.members.is_empty() {
        let mut cursor = state
            .db
            .users()
            .find(doc! { "_id": { "$in": ticket.members.clone() } })
            .await?;
        while cursor.advance().await? {
            public
                .members
                .push(UserRef::of(&cursor.deserialize_current()?));
        }
    }
    Ok(public)
}

async fn thread(state: &AppState, ticket: Ticket) -> AppResult<TicketThread> {
    let tid = ticket.id.unwrap_or_default();
    let mut messages = Vec::new();
    let mut cursor = state
        .db
        .ticket_messages()
        .find(doc! { "ticket_id": tid })
        .sort(doc! { "created_at": 1 })
        .await?;
    while cursor.advance().await? {
        messages.push(cursor.deserialize_current()?.public());
    }
    Ok(TicketThread {
        ticket: enrich(state, &ticket).await?,
        messages,
    })
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<TicketThread>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    let mine = ticket.user_id == auth.user_id || ticket.members.contains(&auth.user_id);
    if !mine && !can_view(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::NotFound);
    }
    Ok(Json(thread(&state, ticket).await?))
}

#[derive(Deserialize)]
pub struct ReplyReq {
    pub body: String,
}

pub async fn reply(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ReplyReq>,
) -> AppResult<Json<serde_json::Value>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    let mine = ticket.user_id == auth.user_id || ticket.members.contains(&auth.user_id);
    // A category-authorized staff member replies as staff.
    let is_staff = can_handle(&auth.permissions, ticket.category.as_deref());
    if !mine && !is_staff {
        return Err(AppError::Forbidden);
    }
    add_message(&state, tid, auth.user_id, &req.body, is_staff).await
}

// ----------------------------- Assignment (staff) -----------------------------

/// Staff claims the ticket ("iniciar atendimento"). Gated by category.
pub async fn assign(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<TicketThread>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    if !can_handle(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::Forbidden);
    }
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": tid },
            doc! { "$set": {
                "assignee_id": auth.user_id,
                "status": "pending",
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(thread(&state, ticket).await?))
}

/// Staff releases the ticket.
pub async fn unassign(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<TicketThread>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    if !can_handle(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::Forbidden);
    }
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": tid },
            doc! { "$set": {
                "assignee_id": bson::Bson::Null,
                "updated_at": bson::DateTime::from_chrono(Utc::now()),
            }},
        )
        .await?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(thread(&state, ticket).await?))
}

// ----------------------------- Members -----------------------------

#[derive(Deserialize)]
pub struct AddMemberReq {
    pub email: String,
}

/// Owner adds another user (by email) to the ticket so they can follow it.
pub async fn add_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<AddMemberReq>,
) -> AppResult<Json<TicketPublic>> {
    let ticket = owned_ticket(&state, &auth, &id).await?;
    let email = req.email.trim().to_lowercase();
    let user = state
        .db
        .users()
        .find_one(doc! { "email": &email })
        .await?
        .ok_or_else(|| AppError::Validation("usuário não encontrado".into()))?;
    let uid = user.id.unwrap_or_default();
    if uid == ticket.user_id {
        return Err(AppError::Validation("já é o dono do chamado".into()));
    }
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": ticket.id.unwrap() },
            doc! { "$addToSet": { "members": uid } },
        )
        .await?;
    let updated = owned_ticket(&state, &auth, &id).await?;
    Ok(Json(enrich(&state, &updated).await?))
}

/// Owner removes a member from the ticket.
pub async fn remove_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, uid)): Path<(String, String)>,
) -> AppResult<Json<TicketPublic>> {
    let ticket = owned_ticket(&state, &auth, &id).await?;
    let member = oid(&uid)?;
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": ticket.id.unwrap() },
            doc! { "$pull": { "members": member } },
        )
        .await?;
    let updated = owned_ticket(&state, &auth, &id).await?;
    Ok(Json(enrich(&state, &updated).await?))
}

pub async fn close(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let ticket = owned_ticket(&state, &auth, &id).await?;
    set_status(&state, ticket.id.unwrap(), TicketStatus::Closed).await
}

// ----------------------------- Shared writes -----------------------------

async fn add_message(
    state: &AppState,
    ticket_id: ObjectId,
    author_id: ObjectId,
    body: &str,
    is_staff: bool,
) -> AppResult<Json<serde_json::Value>> {
    let body = body.trim().to_string();
    if body.is_empty() || body.len() > 8000 {
        return Err(AppError::Validation("invalid message".into()));
    }
    let now = Utc::now();
    state
        .db
        .ticket_messages()
        .insert_one(&TicketMessage {
            id: None,
            ticket_id,
            author_id,
            body,
            is_staff,
            created_at: now,
        })
        .await?;
    // A staff reply moves it to "pending" (awaiting user); a user reply re-opens.
    let status = if is_staff { "pending" } else { "open" };
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": ticket_id },
            doc! { "$set": { "status": status, "updated_at": bson::DateTime::from_chrono(now) }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn set_status(
    state: &AppState,
    ticket_id: ObjectId,
    status: TicketStatus,
) -> AppResult<Json<serde_json::Value>> {
    let label = match status {
        TicketStatus::Open => "open",
        TicketStatus::Pending => "pending",
        TicketStatus::Closed => "closed",
    };
    state
        .db
        .tickets()
        .update_one(
            doc! { "_id": ticket_id },
            doc! { "$set": { "status": label, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Admin (staff) -----------------------------

pub async fn admin_list(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<TicketPublic>>> {
    if !has_support_access(&auth.permissions) {
        return Err(AppError::Forbidden);
    }
    let mut cursor = state
        .db
        .tickets()
        .find(doc! {})
        .sort(doc! { "updated_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        let ticket = cursor.deserialize_current()?;
        // Only surface tickets this staff member is allowed to see.
        if can_view(&auth.permissions, ticket.category.as_deref()) {
            out.push(enrich(&state, &ticket).await?);
        }
    }
    Ok(Json(out))
}

pub async fn admin_get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<TicketThread>> {
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": oid(&id)? })
        .await?
        .ok_or(AppError::NotFound)?;
    if !can_view(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(thread(&state, ticket).await?))
}

pub async fn admin_reply(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ReplyReq>,
) -> AppResult<Json<serde_json::Value>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    if !can_handle(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::Forbidden);
    }
    add_message(&state, tid, auth.user_id, &req.body, true).await
}

#[derive(Deserialize)]
pub struct StatusReq {
    pub status: String,
}

pub async fn admin_set_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<StatusReq>,
) -> AppResult<Json<serde_json::Value>> {
    let tid = oid(&id)?;
    let ticket = state
        .db
        .tickets()
        .find_one(doc! { "_id": tid })
        .await?
        .ok_or(AppError::NotFound)?;
    if !can_handle(&auth.permissions, ticket.category.as_deref()) {
        return Err(AppError::Forbidden);
    }
    let status = match req.status.as_str() {
        "open" => TicketStatus::Open,
        "pending" => TicketStatus::Pending,
        "closed" => TicketStatus::Closed,
        _ => return Err(AppError::Validation("invalid status".into())),
    };
    set_status(&state, tid, status).await
}

// ----------------------------- Categories -----------------------------

/// List ticket categories (any authenticated user, for the new-ticket picker).
pub async fn list_categories(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> AppResult<Json<Vec<TicketCategoryPublic>>> {
    let mut cursor = state
        .db
        .ticket_categories()
        .find(doc! {})
        .sort(doc! { "name": 1 })
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?.public());
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreateCategoryReq {
    pub name: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

fn slugify(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Create a ticket category (staff with support.manage).
pub async fn create_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateCategoryReq>,
) -> AppResult<Json<TicketCategoryPublic>> {
    auth.require(perm::SUPPORT_MANAGE)?;
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::Validation("invalid category name".into()));
    }
    let slug = match req.slug.as_deref().map(slugify).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => slugify(&name),
    };
    if slug.is_empty() {
        return Err(AppError::Validation("invalid category slug".into()));
    }
    if state
        .db
        .ticket_categories()
        .find_one(doc! { "slug": &slug })
        .await?
        .is_some()
    {
        return Err(AppError::Conflict("category already exists".into()));
    }
    let cat = TicketCategory {
        id: None,
        slug,
        name,
        color: req.color,
        created_at: Utc::now(),
    };
    let id = state
        .db
        .ticket_categories()
        .insert_one(&cat)
        .await?
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert".into()))?;
    let mut saved = cat;
    saved.id = Some(id);
    Ok(Json(saved.public()))
}

/// Delete a ticket category (staff with support.manage).
pub async fn delete_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::SUPPORT_MANAGE)?;
    state
        .db
        .ticket_categories()
        .delete_one(doc! { "_id": oid(&id)? })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
