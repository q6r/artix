//! Account integrations — currently listing the linked GitHub user's repos
//! (server-side, with the user's sealed token) for the container deploy flow.

use axum::{extract::State, Json};
use serde::Serialize;

use crate::{
    authn::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize)]
pub struct RepoLite {
    pub full_name: String,
    pub default_branch: String,
    pub private: bool,
    pub updated_at: Option<String>,
}

/// Decrypt the caller's GitHub token, or a friendly error if not linked.
pub(crate) fn github_token(state: &AppState, auth: &AuthUser) -> AppResult<String> {
    let sealed = auth
        .user
        .github_access_token
        .as_deref()
        .ok_or_else(|| AppError::Validation("link GitHub first".into()))?;
    let bytes = crate::secretbox::open(&state.cfg.auth_token_secret, sealed)?;
    String::from_utf8(bytes).map_err(|_| AppError::Internal("token decode".into()))
}

/// GET /account/github/repos — the caller's repos (owner + collaborator + org).
pub async fn github_repos(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<RepoLite>>> {
    let token = github_token(&state, &auth)?;
    let mut out = Vec::new();
    let mut url = "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member".to_string();

    // Cap at 3 pages (300 repos) to bound latency + rate limit.
    for _ in 0..3 {
        let res = state
            .http
            .get(&url)
            .bearer_auth(&token)
            .header(reqwest::header::USER_AGENT, "ArtixCloud")
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| AppError::Unavailable("github unreachable".into()))?;
        let status = res.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Validation(
                "GitHub token expired — reconnect GitHub".into(),
            ));
        }
        if !status.is_success() {
            return Err(AppError::Unavailable("github repos".into()));
        }
        let next = res
            .headers()
            .get(reqwest::header::LINK)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_next_link);
        let repos: Vec<serde_json::Value> = res
            .json()
            .await
            .map_err(|_| AppError::Internal("github parse".into()))?;
        for r in repos {
            if let Some(full_name) = r.get("full_name").and_then(|x| x.as_str()) {
                out.push(RepoLite {
                    full_name: full_name.to_string(),
                    default_branch: r
                        .get("default_branch")
                        .and_then(|x| x.as_str())
                        .unwrap_or("main")
                        .to_string(),
                    private: r.get("private").and_then(|x| x.as_bool()).unwrap_or(false),
                    updated_at: r
                        .get("updated_at")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                });
            }
        }
        match next {
            Some(n) => url = n,
            None => break,
        }
    }
    Ok(Json(out))
}

/// Extract the `rel="next"` URL from a GitHub `Link` header, if present.
fn parse_next_link(link: &str) -> Option<String> {
    for part in link.split(',') {
        let seg = part.trim();
        if seg.contains("rel=\"next\"") {
            if let (Some(a), Some(b)) = (seg.find('<'), seg.find('>')) {
                if b > a {
                    return Some(seg[a + 1..b].to_string());
                }
            }
        }
    }
    None
}
