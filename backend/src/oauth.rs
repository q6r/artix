//! OAuth core: providers (Discord, GitHub), signed anti-CSRF state, code
//! exchange and normalized user-info fetch.
//!
//! ## CSRF / state
//! We are stateless: the `state` parameter is an HMAC-signed token carrying a
//! random nonce, the provider, the intent (`login` | `link`), an optional
//! `uid` (for linking) and an expiry. A forged or tampered `state` fails the
//! signature check, and a `state` minted for another provider is rejected.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::{error::AppError, error::AppResult, state::AppState};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Discord,
    Github,
}

impl Provider {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "discord" => Some(Provider::Discord),
            "github" => Some(Provider::Github),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Discord => "discord",
            Provider::Github => "github",
        }
    }
    fn authorize_url(self) -> &'static str {
        match self {
            Provider::Discord => "https://discord.com/oauth2/authorize",
            Provider::Github => "https://github.com/login/oauth/authorize",
        }
    }
    fn token_url(self) -> &'static str {
        match self {
            Provider::Discord => "https://discord.com/api/oauth2/token",
            Provider::Github => "https://github.com/login/oauth/access_token",
        }
    }
    fn scope(self, want_repo: bool) -> &'static str {
        match self {
            Provider::Discord => "identify email",
            // Only the *link* flow requests `repo` (to deploy from repos); login
            // stays minimal.
            Provider::Github if want_repo => "read:user user:email repo",
            Provider::Github => "read:user user:email",
        }
    }
    fn credentials(self, cfg: &crate::config::Config) -> (String, String) {
        match self {
            Provider::Discord => (
                cfg.discord_client_id.clone(),
                cfg.discord_client_secret.clone(),
            ),
            Provider::Github => (
                cfg.github_client_id.clone(),
                cfg.github_client_secret.clone(),
            ),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthState {
    pub nonce: String,
    pub provider: String,
    pub intent: String, // "login" | "link"
    pub uid: Option<String>,
    pub exp: i64,
}

fn mac(secret: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut m = HmacSha256::new_from_slice(secret).expect("hmac key");
    m.update(payload);
    m.finalize().into_bytes().to_vec()
}

pub fn sign_state(secret: &[u8], st: &OAuthState) -> String {
    let payload = B64.encode(serde_json::to_vec(st).expect("state serialize"));
    let sig = B64.encode(mac(secret, payload.as_bytes()));
    format!("{payload}.{sig}")
}

pub fn verify_state(secret: &[u8], token: &str, now: i64) -> Option<OAuthState> {
    let (payload, sig) = token.split_once('.')?;
    let expected = mac(secret, payload.as_bytes());
    let provided = B64.decode(sig).ok()?;
    if expected.ct_eq(&provided).unwrap_u8() != 1 {
        return None;
    }
    let st: OAuthState = serde_json::from_slice(&B64.decode(payload).ok()?).ok()?;
    if now >= st.exp {
        return None;
    }
    Some(st)
}

pub fn new_nonce() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    B64.encode(b)
}

pub fn redirect_uri(state: &AppState, provider: Provider) -> String {
    format!(
        "{}/oauth/{}/callback",
        state.cfg.public_api_url,
        provider.as_str()
    )
}

/// Build the provider authorize URL the browser is redirected to.
pub fn authorize_url(
    state: &AppState,
    provider: Provider,
    signed_state: &str,
    want_repo: bool,
) -> AppResult<String> {
    let (client_id, _) = provider.credentials(&state.cfg);
    if client_id.is_empty() {
        return Err(AppError::Validation("provider not configured".into()));
    }
    let redirect = redirect_uri(state, provider);
    let url = reqwest::Url::parse_with_params(
        provider.authorize_url(),
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", provider.scope(want_repo)),
            ("state", signed_state),
        ],
    )
    .map_err(|_| AppError::Internal("authorize url".into()))?;
    Ok(url.to_string())
}

/// Normalized identity returned by a provider.
pub struct OAuthUserInfo {
    pub provider_user_id: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub display_name: String,
    pub avatar_url: Option<String>,
    /// The provider access token (kept only for GitHub, to access repos).
    pub access_token: String,
    /// Provider handle (GitHub `login`); used for the linked-account label.
    pub username: Option<String>,
}

/// Exchange the authorization `code` for a provider access token.
async fn exchange_code(state: &AppState, provider: Provider, code: &str) -> AppResult<String> {
    let (client_id, client_secret) = provider.credentials(&state.cfg);
    if client_id.is_empty() || client_secret.is_empty() {
        return Err(AppError::Validation("provider not configured".into()));
    }
    let redirect = redirect_uri(state, provider);
    let params = [
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect.as_str()),
    ];

    let res = state
        .http
        .post(provider.token_url())
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "ArtixCloud")
        .form(&params)
        .send()
        .await
        .map_err(|_| AppError::Internal("token exchange".into()))?;

    if !res.status().is_success() {
        return Err(AppError::Unauthorized);
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|_| AppError::Internal("token parse".into()))?;
    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or(AppError::Unauthorized)
}

/// Fetch + normalize the user identity for the granted token.
async fn fetch_user(
    state: &AppState,
    provider: Provider,
    access_token: &str,
) -> AppResult<OAuthUserInfo> {
    match provider {
        Provider::Discord => {
            let v: serde_json::Value = state
                .http
                .get("https://discord.com/api/users/@me")
                .bearer_auth(access_token)
                .header(reqwest::header::USER_AGENT, "ArtixCloud")
                .send()
                .await
                .map_err(|_| AppError::Internal("discord user".into()))?
                .json()
                .await
                .map_err(|_| AppError::Internal("discord parse".into()))?;

            let id = v
                .get("id")
                .and_then(|x| x.as_str())
                .ok_or(AppError::Unauthorized)?
                .to_string();
            let email = v
                .get("email")
                .and_then(|x| x.as_str())
                .map(|s| s.to_lowercase());
            let email_verified = v.get("verified").and_then(|x| x.as_bool()).unwrap_or(false);
            let display_name = v
                .get("global_name")
                .and_then(|x| x.as_str())
                .or_else(|| v.get("username").and_then(|x| x.as_str()))
                .unwrap_or("Usuário")
                .to_string();
            let avatar_url = v.get("avatar").and_then(|x| x.as_str()).map(|hash| {
                let ext = if hash.starts_with("a_") { "gif" } else { "png" };
                format!("https://cdn.discordapp.com/avatars/{id}/{hash}.{ext}?size=128")
            });
            Ok(OAuthUserInfo {
                provider_user_id: id,
                email,
                email_verified,
                display_name,
                avatar_url,
                access_token: access_token.to_string(),
                username: None,
            })
        }
        Provider::Github => {
            let v: serde_json::Value = state
                .http
                .get("https://api.github.com/user")
                .bearer_auth(access_token)
                .header(reqwest::header::USER_AGENT, "ArtixCloud")
                .send()
                .await
                .map_err(|_| AppError::Internal("github user".into()))?
                .json()
                .await
                .map_err(|_| AppError::Internal("github parse".into()))?;

            let id = v
                .get("id")
                .and_then(|x| x.as_i64())
                .map(|n| n.to_string())
                .ok_or(AppError::Unauthorized)?;
            let display_name = v
                .get("name")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| v.get("login").and_then(|x| x.as_str()))
                .unwrap_or("Usuário")
                .to_string();

            let avatar_url = v
                .get("avatar_url")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());

            // GitHub may hide the email on /user; the verified primary lives here.
            let (email, email_verified) = github_primary_email(state, access_token).await;
            let username = v
                .get("login")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());

            Ok(OAuthUserInfo {
                provider_user_id: id,
                email,
                email_verified,
                display_name,
                avatar_url,
                access_token: access_token.to_string(),
                username,
            })
        }
    }
}

async fn github_primary_email(state: &AppState, access_token: &str) -> (Option<String>, bool) {
    let res = state
        .http
        .get("https://api.github.com/user/emails")
        .bearer_auth(access_token)
        .header(reqwest::header::USER_AGENT, "ArtixCloud")
        .send()
        .await;
    let arr: Vec<serde_json::Value> = match res {
        Ok(r) => r.json().await.unwrap_or_default(),
        Err(_) => return (None, false),
    };
    // Prefer the primary verified email, else any verified email.
    let pick = arr
        .iter()
        .find(|e| {
            e.get("primary").and_then(|p| p.as_bool()).unwrap_or(false)
                && e.get("verified").and_then(|p| p.as_bool()).unwrap_or(false)
        })
        .or_else(|| {
            arr.iter()
                .find(|e| e.get("verified").and_then(|p| p.as_bool()).unwrap_or(false))
        });
    match pick {
        Some(e) => (
            e.get("email")
                .and_then(|x| x.as_str())
                .map(|s| s.to_lowercase()),
            true,
        ),
        None => (None, false),
    }
}

pub async fn complete(
    state: &AppState,
    provider: Provider,
    code: &str,
) -> AppResult<OAuthUserInfo> {
    let token = exchange_code(state, provider, code).await?;
    fetch_user(state, provider, &token).await
}
