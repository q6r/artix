//! Authentication extractor (authN) + permission helper (authZ).
//!
//! `AuthUser` is an Axum extractor: any handler that takes `auth: AuthUser`
//! is automatically protected. It verifies the access-token signature, then
//! confirms the session is still valid in the DB (instant revocation) and that
//! the account is not banned/suspended, and finally resolves the user's
//! effective permissions from their roles.

use axum::{extract::FromRequestParts, http::request::Parts};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use std::collections::BTreeSet;

use crate::{
    auth::token,
    db::Collections,
    error::AppError,
    models::{User, UserPublic, UserStatus},
    permissions,
    state::AppState,
};

use crate::models::ApiKey;

pub struct AuthUser {
    pub user: User,
    pub user_id: ObjectId,
    pub session_id: ObjectId,
    pub permissions: Vec<String>,
    /// `None` when authenticated by a browser session (full access to the user's
    /// own resources). `Some(scopes)` when authenticated by an API key — the
    /// capability scopes it was granted (see `permissions::cap`).
    pub api_scopes: Option<Vec<String>>,
}

impl AuthUser {
    /// Authorization gate. Returns 403 if the permission is not granted.
    pub fn require(&self, needed: &str) -> Result<(), AppError> {
        if permissions::granted(&self.permissions, needed) {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    /// Capability gate for API keys. A session (no `api_scopes`) always passes;
    /// an API key passes only if it holds this capability (or `*`).
    pub fn scope(&self, cap: &str) -> Result<(), AppError> {
        match &self.api_scopes {
            None => Ok(()),
            Some(scopes) if scopes.iter().any(|s| s == "*" || s == cap) => Ok(()),
            Some(_) => Err(AppError::Forbidden),
        }
    }

    /// Reject API keys — for actions only a logged-in session may take
    /// (e.g. managing API keys themselves, changing password).
    pub fn require_session(&self) -> Result<(), AppError> {
        if self.api_scopes.is_some() {
            Err(AppError::Forbidden)
        } else {
            Ok(())
        }
    }

    pub fn public(&self) -> UserPublic {
        let id = self.user_id.to_hex();
        UserPublic {
            // Cached proxy path, not the provider's (expiring) CDN URL.
            avatar_url: self
                .user
                .avatar_url
                .as_ref()
                .map(|_| format!("/api/avatar/{id}")),
            id,
            email: self.user.email.clone(),
            email_verified: self.user.email_verified,
            display_name: self.user.display_name.clone(),
            status: self.user.status,
            permissions: self.permissions.clone(),
            // Best-effort from the loaded user; /auth/me (public_user) is the
            // authoritative source that also queries linked oauth accounts.
            discord_linked: false,
            github_linked: self.user.github_access_token.is_some(),
            github_username: self.user.github_username.clone(),
        }
    }
}

#[async_trait::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let raw = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        // API-key authentication (`Bearer ak_…`) — carries capability scopes.
        if raw.starts_with("ak_") {
            return AuthUser::from_api_key(raw, state).await;
        }

        let now = Utc::now().timestamp();
        let claims = token::verify_access(raw, &state.cfg.auth_token_secret, now)
            .map_err(|_| AppError::Unauthorized)?;

        let user_id = ObjectId::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;
        let session_id = ObjectId::parse_str(&claims.sid).map_err(|_| AppError::Unauthorized)?;

        let session = state
            .db
            .sessions()
            .find_one(doc! { "_id": session_id })
            .await?
            .ok_or(AppError::Unauthorized)?;

        if session.revoked
            || session.token_version != claims.ver
            || session.expires_at <= Utc::now()
            || session.user_id != user_id
        {
            return Err(AppError::Unauthorized);
        }

        let user = state
            .db
            .users()
            .find_one(doc! { "_id": user_id })
            .await?
            .ok_or(AppError::Unauthorized)?;

        if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
            return Err(AppError::Forbidden);
        }

        let permissions = resolve_permissions(state, &user).await?;

        Ok(AuthUser {
            user,
            user_id,
            session_id,
            permissions,
            api_scopes: None,
        })
    }
}

impl AuthUser {
    /// Resolve an `ak_…` API key into an `AuthUser` carrying the key's scopes.
    async fn from_api_key(key: &str, state: &AppState) -> Result<Self, AppError> {
        let hash = token::hash_refresh(key, &state.cfg.auth_refresh_pepper);
        let now = Utc::now();
        let api_key: ApiKey = state
            .db
            .api_keys()
            .find_one(doc! { "key_hash": &hash, "revoked": false })
            .await?
            .ok_or(AppError::Unauthorized)?;
        if api_key.expires_at.map(|e| e <= now).unwrap_or(false) {
            return Err(AppError::Unauthorized);
        }
        let user = state
            .db
            .users()
            .find_one(doc! { "_id": api_key.user_id })
            .await?
            .ok_or(AppError::Unauthorized)?;
        if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
            return Err(AppError::Forbidden);
        }
        let permissions = resolve_permissions(state, &user).await?;
        let key_id = api_key.id.unwrap_or_default();

        // Best-effort last-used stamp.
        let _ = state
            .db
            .api_keys()
            .update_one(
                doc! { "_id": key_id },
                doc! { "$set": { "last_used_at": bson::DateTime::from_chrono(now) }},
            )
            .await;

        Ok(AuthUser {
            user,
            user_id: api_key.user_id,
            session_id: key_id, // no session for key auth; carry the key id
            permissions,
            api_scopes: Some(api_key.scopes),
        })
    }
}

/// Union of all permissions granted by the user's roles.
pub async fn resolve_permissions(
    state: &AppState,
    user: &User,
) -> Result<Vec<String>, AppError> {
    if user.role_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut set: BTreeSet<String> = BTreeSet::new();
    let mut cursor = state
        .db
        .roles()
        .find(doc! { "_id": { "$in": user.role_ids.clone() } })
        .await?;
    while cursor.advance().await? {
        let role = cursor.deserialize_current()?;
        for p in role.permissions {
            set.insert(p);
        }
    }
    Ok(set.into_iter().collect())
}

/// Authentication via an API key (`X-API-Key` or `Authorization: Bearer ak_…`).
/// Effective permissions = the user's role permissions, optionally narrowed by
/// the key's `scopes` (a key can never exceed its owner).
pub struct ApiCaller {
    pub user: User,
    pub user_id: ObjectId,
    pub key_id: ObjectId,
    pub permissions: Vec<String>,
}

impl ApiCaller {
    pub fn require(&self, needed: &str) -> Result<(), AppError> {
        if permissions::granted(&self.permissions, needed) {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[async_trait::async_trait]
impl FromRequestParts<AppState> for ApiCaller {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .or_else(|| {
                parts
                    .headers
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|h| h.strip_prefix("Bearer "))
                    .filter(|s| s.starts_with("ak_"))
                    .map(|s| s.to_string())
            })
            .ok_or(AppError::Unauthorized)?;

        let hash = token::hash_refresh(&key, &state.cfg.auth_refresh_pepper);
        let now = Utc::now();

        let api_key: ApiKey = state
            .db
            .api_keys()
            .find_one(doc! { "key_hash": &hash, "revoked": false })
            .await?
            .ok_or(AppError::Unauthorized)?;
        if api_key.expires_at.map(|e| e <= now).unwrap_or(false) {
            return Err(AppError::Unauthorized);
        }

        let user = state
            .db
            .users()
            .find_one(doc! { "_id": api_key.user_id })
            .await?
            .ok_or(AppError::Unauthorized)?;
        if matches!(user.status, UserStatus::Banned | UserStatus::Suspended) {
            return Err(AppError::Forbidden);
        }

        let user_perms = resolve_permissions(state, &user).await?;
        let permissions = if api_key.scopes.is_empty() {
            user_perms
        } else {
            user_perms
                .into_iter()
                .filter(|p| permissions::granted(&api_key.scopes, p))
                .collect()
        };

        let _ = state
            .db
            .api_keys()
            .update_one(
                doc! { "_id": api_key.id },
                doc! { "$set": { "last_used_at": bson::DateTime::from_chrono(now) }},
            )
            .await;

        Ok(ApiCaller {
            user,
            user_id: api_key.user_id,
            key_id: api_key.id.unwrap_or_default(),
            permissions,
        })
    }
}
