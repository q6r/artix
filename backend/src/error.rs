//! Standardized error type. Every error becomes a consistent JSON body and
//! the right HTTP status. Internal details are logged, never leaked.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid input")]
    Validation(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("not found")]
    NotFound,

    #[error("conflict")]
    Conflict(String),

    #[error("too many requests")]
    RateLimited,

    #[error("service unavailable")]
    Unavailable(String),

    /// Generic auth failure — deliberately vague to avoid user enumeration.
    #[error("invalid credentials")]
    InvalidCredentials,

    #[error("account locked")]
    Locked,

    #[error("database error")]
    Db(#[from] mongodb::error::Error),

    #[error("internal error")]
    Internal(String),
}

impl AppError {
    /// The user-facing message — the exact text sent in the JSON response body.
    /// Use this (not `to_string()`, which is the generic `#[error(...)]` label)
    /// whenever the concrete reason needs to be persisted or shown.
    pub fn user_message(&self) -> String {
        self.parts().2
    }

    fn parts(&self) -> (StatusCode, &'static str, String) {
        match self {
            AppError::Validation(m) => (StatusCode::BAD_REQUEST, "validation_error", m.clone()),
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authentication required".into(),
            ),
            AppError::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "You do not have permission to perform this action".into(),
            ),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found", "Not found".into()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, "conflict", m.clone()),
            AppError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many requests, slow down".into(),
            ),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable", m.clone()),
            AppError::InvalidCredentials => (
                StatusCode::UNAUTHORIZED,
                "invalid_credentials",
                "Invalid email or password".into(),
            ),
            AppError::Locked => (
                StatusCode::TOO_MANY_REQUESTS,
                "account_locked",
                "Too many failed attempts. Try again later.".into(),
            ),
            AppError::Db(_) | AppError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Something went wrong".into(),
            ),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = self.parts();

        // Log the real cause for 5xx; never send it to the client.
        // `?self` (Debug) surfaces the underlying Mongo error kind/code/message,
        // not just the opaque "database error" Display.
        if status.is_server_error() {
            tracing::error!(error = ?self, "request failed");
        }

        let body = Json(json!({
            "error": { "code": code, "message": message }
        }));
        (status, body).into_response()
    }
}
