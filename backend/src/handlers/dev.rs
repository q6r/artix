//! Public developer API, authenticated by API key (`/v1`). These routes use the
//! `ApiCaller` extractor, so they accept `X-API-Key` / `Authorization: Bearer ak_…`
//! and operate under the key's (possibly narrowed) permissions.

use axum::Json;
use serde_json::{json, Value};

use crate::authn::ApiCaller;

pub async fn whoami(api: ApiCaller) -> Json<Value> {
    Json(json!({
        "user_id": api.user_id.to_hex(),
        "key_id": api.key_id.to_hex(),
        "email": api.user.email,
        "display_name": api.user.display_name,
        "permissions": api.permissions,
    }))
}

pub async fn ping(_api: ApiCaller) -> Json<Value> {
    Json(json!({ "pong": true }))
}
