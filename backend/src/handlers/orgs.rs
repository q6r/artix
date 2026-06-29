//! Organizations: a user creates an org, moves servers they already own into
//! it, invites members, and grants each member fine-grained permissions on
//! individual shared servers. Owner/admin manage; members get only what their
//! per-server grants allow (enforced in `servers::access`).

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Json,
};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    authn::AuthUser,
    db::Collections,
    error::{AppError, AppResult},
    models::{OrgMember, OrgMemberPublic, OrgRole, Organization, OrgPublic, ServerPublic},
    permissions::server_perm,
    state::AppState,
};

fn oid(id: &str) -> AppResult<ObjectId> {
    ObjectId::parse_str(id).map_err(|_| AppError::NotFound)
}

/// The caller's role in an org, or `None` if not a member.
async fn role_of(state: &AppState, org_id: ObjectId, user_id: ObjectId) -> AppResult<Option<OrgRole>> {
    Ok(state
        .db
        .org_members()
        .find_one(doc! { "org_id": org_id, "user_id": user_id })
        .await?
        .map(|m| m.role))
}

/// Require membership; returns the caller's role.
async fn require_member(state: &AppState, org_id: ObjectId, user_id: ObjectId) -> AppResult<OrgRole> {
    role_of(state, org_id, user_id).await?.ok_or(AppError::NotFound)
}

/// Require owner/admin (management rights).
async fn require_manager(state: &AppState, org_id: ObjectId, user_id: ObjectId) -> AppResult<OrgRole> {
    let role = require_member(state, org_id, user_id).await?;
    if matches!(role, OrgRole::Owner | OrgRole::Admin) {
        Ok(role)
    } else {
        Err(AppError::Forbidden)
    }
}

// ----------------------------- Org CRUD -----------------------------

#[derive(Deserialize)]
pub struct CreateOrgReq {
    pub name: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateOrgReq>,
) -> AppResult<Json<OrgPublic>> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 80 {
        return Err(AppError::Validation("invalid organization name".into()));
    }
    let now = Utc::now();
    let org = Organization {
        id: None,
        owner_id: auth.user_id,
        name,
        created_at: now,
        updated_at: now,
    };
    let org_id = state
        .db
        .organizations()
        .insert_one(&org)
        .await?
        .inserted_id
        .as_object_id()
        .ok_or_else(|| AppError::Internal("insert".into()))?;

    // The creator is the owner member.
    state
        .db
        .org_members()
        .insert_one(&OrgMember {
            id: None,
            org_id,
            user_id: auth.user_id,
            role: OrgRole::Owner,
            created_at: now,
        })
        .await?;

    Ok(Json(OrgPublic {
        id: org_id.to_hex(),
        name: org.name,
        owner_id: auth.user_id.to_hex(),
        role: OrgRole::Owner,
        member_count: 1,
        server_count: 0,
        created_at: now,
    }))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<OrgPublic>>> {
    let mut members = state
        .db
        .org_members()
        .find(doc! { "user_id": auth.user_id })
        .await?;
    let mut out = Vec::new();
    while members.advance().await? {
        let m = members.deserialize_current()?;
        let Some(org) = state.db.organizations().find_one(doc! { "_id": m.org_id }).await? else {
            continue;
        };
        let member_count = state.db.org_members().count_documents(doc! { "org_id": m.org_id }).await?;
        let server_count = state.db.servers().count_documents(doc! { "org_id": m.org_id }).await?;
        out.push(OrgPublic {
            id: m.org_id.to_hex(),
            name: org.name,
            owner_id: org.owner_id.to_hex(),
            role: m.role,
            member_count,
            server_count,
            created_at: org.created_at,
        });
    }
    Ok(Json(out))
}

#[derive(Serialize)]
pub struct OrgDetail {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub role: OrgRole,
    pub members: Vec<OrgMemberPublic>,
    pub servers: Vec<ServerPublic>,
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<OrgDetail>> {
    let org_id = oid(&id)?;
    let role = require_member(&state, org_id, auth.user_id).await?;
    let org = state
        .db
        .organizations()
        .find_one(doc! { "_id": org_id })
        .await?
        .ok_or(AppError::NotFound)?;

    // Members with their per-server grants.
    let mut members = Vec::new();
    let mut cursor = state.db.org_members().find(doc! { "org_id": org_id }).await?;
    while cursor.advance().await? {
        let m = cursor.deserialize_current()?;
        let user = state.db.users().find_one(doc! { "_id": m.user_id }).await?;
        let (email, display_name) = user
            .map(|u| (u.email, u.display_name))
            .unwrap_or_else(|| ("(deleted)".into(), "(deleted)".into()));

        let mut grants: HashMap<String, Vec<String>> = HashMap::new();
        let mut gc = state
            .db
            .server_grants()
            .find(doc! { "org_id": org_id, "user_id": m.user_id })
            .await?;
        while gc.advance().await? {
            let g = gc.deserialize_current()?;
            grants.insert(g.server_id.to_hex(), g.perms);
        }
        members.push(OrgMemberPublic {
            user_id: m.user_id.to_hex(),
            email,
            display_name,
            role: m.role,
            grants,
        });
    }

    // Servers shared into the org.
    let mut servers = Vec::new();
    let mut sc = state.db.servers().find(doc! { "org_id": org_id }).await?;
    while sc.advance().await? {
        servers.push(sc.deserialize_current()?.public());
    }

    Ok(Json(OrgDetail {
        id: org_id.to_hex(),
        name: org.name,
        owner_id: org.owner_id.to_hex(),
        role,
        members,
        servers,
    }))
}

#[derive(Deserialize)]
pub struct UpdateOrgReq {
    pub name: String,
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateOrgReq>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    require_manager(&state, org_id, auth.user_id).await?;
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 80 {
        return Err(AppError::Validation("invalid organization name".into()));
    }
    state
        .db
        .organizations()
        .update_one(
            doc! { "_id": org_id },
            doc! { "$set": { "name": name, "updated_at": bson::DateTime::from_chrono(Utc::now()) }},
        )
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    // Only the owner can dissolve the org.
    let org = state
        .db
        .organizations()
        .find_one(doc! { "_id": org_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if org.owner_id != auth.user_id {
        return Err(AppError::Forbidden);
    }
    // Detach servers, drop grants + memberships, then the org.
    state
        .db
        .servers()
        .update_many(doc! { "org_id": org_id }, doc! { "$unset": { "org_id": "" }})
        .await?;
    let _ = state.db.server_grants().delete_many(doc! { "org_id": org_id }).await;
    let _ = state.db.org_members().delete_many(doc! { "org_id": org_id }).await;
    state.db.organizations().delete_one(doc! { "_id": org_id }).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Members -----------------------------

#[derive(Deserialize)]
pub struct AddMemberReq {
    pub email: String,
    #[serde(default)]
    pub role: Option<String>,
}

pub async fn add_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<AddMemberReq>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let caller_role = require_manager(&state, org_id, auth.user_id).await?;

    let email = req.email.trim().to_lowercase();
    let role = match req.role.as_deref() {
        Some("admin") => OrgRole::Admin,
        None | Some("member") => OrgRole::Member,
        _ => return Err(AppError::Validation("invalid role".into())),
    };
    // Only the owner may mint admins (otherwise an admin could escalate peers,
    // bypassing the owner-only role-change rule).
    if role == OrgRole::Admin && caller_role != OrgRole::Owner {
        return Err(AppError::Forbidden);
    }

    let user = state
        .db
        .users()
        .find_one(doc! { "email": &email })
        .await?
        .ok_or_else(|| AppError::Validation("no user with that email".into()))?;
    let target_id = user.id.ok_or(AppError::NotFound)?;

    let res = state
        .db
        .org_members()
        .insert_one(&OrgMember {
            id: None,
            org_id,
            user_id: target_id,
            role,
            created_at: Utc::now(),
        })
        .await;
    if let Err(e) = res {
        if e.to_string().contains("E11000") {
            return Err(AppError::Conflict("already a member".into()));
        }
        return Err(e.into());
    }
    Ok(Json(serde_json::json!({ "ok": true, "user_id": target_id.to_hex() })))
}

#[derive(Deserialize)]
pub struct UpdateMemberReq {
    pub role: String,
}

pub async fn update_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, user_id)): Path<(String, String)>,
    Json(req): Json<UpdateMemberReq>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let target = oid(&user_id)?;
    // Only the owner can change roles.
    let org = state
        .db
        .organizations()
        .find_one(doc! { "_id": org_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if org.owner_id != auth.user_id {
        return Err(AppError::Forbidden);
    }
    if target == org.owner_id {
        return Err(AppError::Validation("cannot change the owner".into()));
    }
    let role = match req.role.as_str() {
        "admin" => "admin",
        "member" => "member",
        _ => return Err(AppError::Validation("invalid role".into())),
    };
    let res = state
        .db
        .org_members()
        .update_one(
            doc! { "org_id": org_id, "user_id": target },
            doc! { "$set": { "role": role }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, user_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let target = oid(&user_id)?;
    require_manager(&state, org_id, auth.user_id).await?;

    let org = state
        .db
        .organizations()
        .find_one(doc! { "_id": org_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if target == org.owner_id {
        return Err(AppError::Validation("cannot remove the owner".into()));
    }
    let _ = state
        .db
        .server_grants()
        .delete_many(doc! { "org_id": org_id, "user_id": target })
        .await;
    let res = state
        .db
        .org_members()
        .delete_one(doc! { "org_id": org_id, "user_id": target })
        .await?;
    if res.deleted_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Servers in org -----------------------------

#[derive(Deserialize)]
pub struct AddServerReq {
    pub server_id: String,
}

pub async fn add_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<AddServerReq>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    require_manager(&state, org_id, auth.user_id).await?;
    let server_id = oid(&req.server_id)?;

    // Only a server the caller personally owns can be placed into the org.
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": server_id, "user_id": auth.user_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if server.org_id.is_some() {
        return Err(AppError::Conflict("server already in an organization".into()));
    }
    state
        .db
        .servers()
        .update_one(doc! { "_id": server_id }, doc! { "$set": { "org_id": org_id }})
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, server_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let sid = oid(&server_id)?;
    require_manager(&state, org_id, auth.user_id).await?;

    let _ = state.db.server_grants().delete_many(doc! { "server_id": sid }).await;
    let res = state
        .db
        .servers()
        .update_one(
            doc! { "_id": sid, "org_id": org_id },
            doc! { "$unset": { "org_id": "" }},
        )
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ----------------------------- Grants -----------------------------

#[derive(Deserialize)]
pub struct SetGrantReq {
    pub perms: Vec<String>,
}

pub async fn set_grant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, server_id, user_id)): Path<(String, String, String)>,
    Json(req): Json<SetGrantReq>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let sid = oid(&server_id)?;
    let target = oid(&user_id)?;
    let role = require_manager(&state, org_id, auth.user_id).await?;

    for p in &req.perms {
        if !server_perm::is_valid(p) {
            return Err(AppError::Validation(format!("invalid permission: {p}")));
        }
    }
    // The server must be shared into this org and the target must be a member.
    let server = state
        .db
        .servers()
        .find_one(doc! { "_id": sid, "org_id": org_id })
        .await?
        .ok_or(AppError::NotFound)?;
    if role_of(&state, org_id, target).await?.is_none() {
        return Err(AppError::Validation("target is not a member".into()));
    }

    // Destructive perms (delete/manage) can only be delegated by the org owner
    // or the server's actual owner — not by a mere org admin.
    let grants_destructive = req
        .perms
        .iter()
        .any(|p| p == server_perm::DELETE || p == server_perm::MANAGE);
    if grants_destructive && role != OrgRole::Owner && server.user_id != auth.user_id {
        return Err(AppError::Forbidden);
    }

    let now = Utc::now();
    state
        .db
        .server_grants()
        // Scope by org_id so a stale cross-org grant row can't be silently mutated.
        .update_one(
            doc! { "server_id": sid, "user_id": target, "org_id": org_id },
            doc! { "$set": { "perms": &req.perms }, "$setOnInsert": {
                "created_at": bson::DateTime::from_chrono(now),
            }},
        )
        .upsert(true)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_grant(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, server_id, user_id)): Path<(String, String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    let org_id = oid(&id)?;
    let sid = oid(&server_id)?;
    let target = oid(&user_id)?;
    require_manager(&state, org_id, auth.user_id).await?;
    state
        .db
        .server_grants()
        // Scope to this org so a manager can't strip another org's grants.
        .delete_one(doc! { "server_id": sid, "user_id": target, "org_id": org_id })
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
