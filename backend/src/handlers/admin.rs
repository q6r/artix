//! Admin endpoints. EVERY handler starts with an explicit `auth.require(...)`
//! permission check — being authenticated is never enough.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{AuditLog, Role, SecurityEvent, UserStatus},
    permissions::{self, perm, ALL_PERMISSIONS},
    proxmox::{NodeInfo, NodeStatus},
    security,
    state::AppState,
};

#[derive(Deserialize)]
pub struct Pagination {
    pub limit: Option<i64>,
    pub skip: Option<u64>,
}

impl Pagination {
    pub(crate) fn limit(&self) -> i64 {
        self.limit.unwrap_or(50).clamp(1, 200)
    }
    pub(crate) fn skip(&self) -> u64 {
        self.skip.unwrap_or(0)
    }
}

#[derive(Serialize)]
pub struct UserAdminView {
    pub id: String,
    pub email: String,
    pub email_verified: bool,
    pub display_name: String,
    pub status: UserStatus,
    pub role_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
}

// ----------------------------- Users -----------------------------

pub async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<UserAdminView>>> {
    auth.require(perm::USERS_READ)?;
    let mut cursor = state
        .db
        .users()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;

    let mut out = Vec::new();
    while cursor.advance().await? {
        let u = cursor.deserialize_current()?;
        out.push(UserAdminView {
            id: u.id.unwrap_or_default().to_hex(),
            email: u.email,
            email_verified: u.email_verified,
            display_name: u.display_name,
            status: u.status,
            role_ids: u.role_ids.iter().map(|r| r.to_hex()).collect(),
            created_at: u.created_at,
        });
    }
    Ok(Json(out))
}

pub async fn get_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<UserAdminView>> {
    auth.require(perm::USERS_READ)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let u = state
        .db
        .users()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(UserAdminView {
        id: u.id.unwrap_or_default().to_hex(),
        email: u.email,
        email_verified: u.email_verified,
        display_name: u.display_name,
        status: u.status,
        role_ids: u.role_ids.iter().map(|r| r.to_hex()).collect(),
        created_at: u.created_at,
    }))
}

#[derive(Deserialize)]
pub struct PatchUserReq {
    pub display_name: Option<String>,
}

pub async fn patch_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<PatchUserReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_UPDATE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let mut set = doc! { "updated_at": bson::DateTime::from_chrono(Utc::now()) };
    if let Some(name) = req.display_name {
        let name = name.trim().to_string();
        if name.is_empty() || name.len() > 80 {
            return Err(AppError::Validation("invalid display name".into()));
        }
        set.insert("display_name", name);
    }
    let res = state
        .db
        .users()
        .update_one(doc! { "_id": oid }, doc! { "$set": set })
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct BanReq {
    pub reason: Option<String>,
}

pub async fn ban_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<BanReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_BAN)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    if oid == auth.user_id {
        return Err(AppError::Validation("cannot ban yourself".into()));
    }
    let reason = req.reason.unwrap_or_else(|| "policy violation".into());
    let res = state
        .db
        .users()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "status": "banned", "banned_reason": &reason, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    // Kill all of the banned user's sessions immediately.
    state
        .db
        .sessions()
        .update_many(
            doc! { "user_id": oid, "revoked": false },
            doc! { "$set": { "revoked": true, "revoked_reason": "banned" }},
        )
        .await?;
    security::audit(&state, auth.user_id, perm::USERS_BAN, Some(oid), &headers, doc! { "reason": reason }).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unban_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_BAN)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state
        .db
        .users()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "status": "active", "banned_reason": null, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    security::audit(&state, auth.user_id, "users.unban", Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Roles -----------------------------

pub async fn list_roles(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<Role>>> {
    auth.require(perm::ROLES_READ)?;
    let mut cursor = state.db.roles().find(doc! {}).await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct CreateRoleReq {
    pub name: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
}

fn validate_permissions(perms: &[String]) -> AppResult<()> {
    for p in perms {
        let known = p == "*"
            || ALL_PERMISSIONS.contains(&p.as_str())
            // Dynamic per-ticket-category support permissions, e.g.
            // `support.cat.financeiro` (and the `support.cat.*` wildcard).
            || p.starts_with("support.cat.")
            || (p.ends_with(".*")
                && ALL_PERMISSIONS
                    .iter()
                    .any(|known| permissions::granted(&[p.clone()], known)));
        if !known {
            return Err(AppError::Validation(format!("unknown permission: {p}")));
        }
    }
    Ok(())
}

/// Catalog of assignable base permissions (for building role editors in the UI).
/// Per-category support permissions (`support.cat.<slug>`) are derived on the
/// client from the ticket categories list.
pub async fn list_permissions(
    auth: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ROLES_READ)?;
    Ok(Json(serde_json::json!({
        "permissions": ALL_PERMISSIONS,
        "wildcard": "*",
    })))
}

pub async fn create_role(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(req): Json<CreateRoleReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ROLES_CREATE)?;
    let name = req.name.trim().to_lowercase();
    if name.is_empty() || name.len() > 40 {
        return Err(AppError::Validation("invalid role name".into()));
    }
    validate_permissions(&req.permissions)?;

    let now = Utc::now();
    let role = Role {
        id: None,
        name: name.clone(),
        description: req.description.unwrap_or_default(),
        permissions: req.permissions,
        system: false,
        created_at: now,
        updated_at: now,
    };
    let res = state.db.roles().insert_one(&role).await.map_err(|e| {
        if e.to_string().contains("E11000") {
            AppError::Conflict("role name already exists".into())
        } else {
            AppError::Db(e)
        }
    })?;
    let rid = res.inserted_id.as_object_id();
    security::audit(&state, auth.user_id, perm::ROLES_CREATE, rid, &headers, doc! { "name": name }).await;
    Ok(Json(serde_json::json!({ "ok": true, "id": rid.map(|r| r.to_hex()) })))
}

pub async fn delete_role(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ROLES_DELETE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let role = state
        .db
        .roles()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;
    if role.system {
        return Err(AppError::Forbidden);
    }
    state.db.roles().delete_one(doc! { "_id": oid }).await?;
    // Detach the role from any user that had it.
    state
        .db
        .users()
        .update_many(doc! { "role_ids": oid }, doc! { "$pull": { "role_ids": oid }})
        .await?;
    security::audit(&state, auth.user_id, perm::ROLES_DELETE, Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct AssignRoleReq {
    pub role_id: String,
}

pub async fn assign_role(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<AssignRoleReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::PERMISSIONS_ASSIGN)?;
    let uid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let rid = ObjectId::parse_str(&req.role_id).map_err(|_| AppError::Validation("bad role id".into()))?;
    if state.db.roles().find_one(doc! { "_id": rid }).await?.is_none() {
        return Err(AppError::NotFound);
    }
    let res = state
        .db
        .users()
        .update_one(doc! { "_id": uid }, doc! { "$addToSet": { "role_ids": rid }})
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    security::audit(&state, auth.user_id, perm::PERMISSIONS_ASSIGN, Some(uid), &headers, doc! { "role": rid }).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_role(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path((id, role_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::PERMISSIONS_ASSIGN)?;
    let uid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let rid = ObjectId::parse_str(&role_id).map_err(|_| AppError::NotFound)?;
    state
        .db
        .users()
        .update_one(doc! { "_id": uid }, doc! { "$pull": { "role_ids": rid }})
        .await?;
    security::audit(&state, auth.user_id, "permissions.revoke", Some(uid), &headers, doc! { "role": rid }).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Audit / Security -----------------------------

pub async fn list_audit_logs(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<AuditLog>>> {
    auth.require(perm::ADMIN_AUDIT_READ)?;
    let mut cursor = state
        .db
        .audit_logs()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?);
    }
    Ok(Json(out))
}

pub async fn list_security_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<SecurityEvent>>> {
    auth.require(perm::SECURITY_EVENTS_READ)?;
    let mut cursor = state
        .db
        .security_events()
        .find(doc! {})
        .sort(doc! { "created_at": -1 })
        .skip(p.skip())
        .limit(p.limit())
        .await?;
    let mut out = Vec::new();
    while cursor.advance().await? {
        out.push(cursor.deserialize_current()?);
    }
    Ok(Json(out))
}

// ----------------------------- Proxmox nodes -----------------------------

fn proxmox<'a>(state: &'a AppState) -> AppResult<&'a crate::proxmox::ProxmoxClient> {
    state
        .proxmox
        .as_ref()
        .ok_or_else(|| AppError::Unavailable("proxmox not configured".into()))
}

pub async fn list_nodes(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<NodeInfo>>> {
    auth.require(perm::NODES_READ)?;
    Ok(Json(proxmox(&state)?.nodes().await?))
}

pub async fn get_node(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(node): Path<String>,
) -> AppResult<Json<NodeStatus>> {
    auth.require(perm::NODES_READ)?;
    Ok(Json(proxmox(&state)?.node_status(&node).await?))
}

// ----------------------------- Role update -----------------------------

#[derive(Deserialize)]
pub struct UpdateRoleReq {
    pub name: Option<String>,
    pub description: Option<String>,
    pub permissions: Option<Vec<String>>,
}

pub async fn update_role(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<UpdateRoleReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::ROLES_UPDATE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let role = state
        .db
        .roles()
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or(AppError::NotFound)?;
    if role.system {
        return Err(AppError::Forbidden); // built-in roles are immutable
    }

    let mut set = doc! { "updated_at": bson::DateTime::from_chrono(Utc::now()) };
    if let Some(name) = req.name {
        let n = name.trim().to_lowercase();
        if n.is_empty() || n.len() > 40 {
            return Err(AppError::Validation("invalid role name".into()));
        }
        set.insert("name", n);
    }
    if let Some(desc) = req.description {
        set.insert("description", desc);
    }
    if let Some(perms) = req.permissions {
        validate_permissions(&perms)?;
        set.insert("permissions", perms);
    }

    state
        .db
        .roles()
        .update_one(doc! { "_id": oid }, doc! { "$set": set })
        .await
        .map_err(|e| {
            if e.to_string().contains("E11000") {
                AppError::Conflict("role name already exists".into())
            } else {
                AppError::Db(e)
            }
        })?;
    security::audit(&state, auth.user_id, perm::ROLES_UPDATE, Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Suspend / delete -----------------------------

pub async fn suspend_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_BAN)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    if oid == auth.user_id {
        return Err(AppError::Validation("cannot suspend yourself".into()));
    }
    let res = state
        .db
        .users()
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "status": "suspended", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    state
        .db
        .sessions()
        .update_many(
            doc! { "user_id": oid, "revoked": false },
            doc! { "$set": { "revoked": true, "revoked_reason": "suspended" }},
        )
        .await?;
    security::audit(&state, auth.user_id, "users.suspend", Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unsuspend_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_BAN)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    let res = state
        .db
        .users()
        .update_one(
            doc! { "_id": oid, "status": "suspended" },
            doc! { "$set": { "status": "active", "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    security::audit(&state, auth.user_id, "users.unsuspend", Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_user(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    auth.require(perm::USERS_DELETE)?;
    let oid = ObjectId::parse_str(&id).map_err(|_| AppError::NotFound)?;
    if oid == auth.user_id {
        return Err(AppError::Validation("cannot delete yourself".into()));
    }
    let res = state.db.users().delete_one(doc! { "_id": oid }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::NotFound);
    }
    // Cascade: remove everything tied to the user.
    let _ = state.db.sessions().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.oauth_accounts().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.email_tokens().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.api_keys().delete_many(doc! { "user_id": oid }).await;
    // Org memberships + per-server grants + support tickets.
    let _ = state.db.org_members().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.server_grants().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.tickets().delete_many(doc! { "user_id": oid }).await;
    let _ = state.db.backup_codes().delete_many(doc! { "user_id": oid }).await;
    security::audit(&state, auth.user_id, perm::USERS_DELETE, Some(oid), &headers, doc! {}).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}
