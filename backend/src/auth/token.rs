//! Token primitives.
//!
//! ## Why this design (HMAC + opaque refresh)
//!
//! - **Access token**: a compact, *stateless* token signed with HMAC-SHA256.
//!   The algorithm is fixed in code (no `alg` field in the payload), which
//!   eliminates the classic JWT "alg=none"/algorithm-confusion class of bugs.
//!   It is short-lived (minutes), so a leaked access token has a tiny window.
//!   It carries `sub` (user id), `sid` (session id) and `ver` (session token
//!   version) so a single signature check authenticates the request without a
//!   DB round-trip on the hot path.
//!
//! - **Refresh token**: a high-entropy *opaque* random string. We never store
//!   it; we store only `sha256(pepper || raw)`. On refresh we look the hash up,
//!   rotate it (issue a new one, invalidate the old) and detect reuse. If an
//!   already-rotated refresh token is presented, the whole session family is
//!   revoked (token-theft response).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccessClaims {
    pub sub: String, // user id (hex ObjectId)
    pub sid: String, // session id
    pub ver: u32,    // session token_version
    pub iat: i64,
    pub exp: i64,
    pub typ: String, // always "access"
}

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    #[error("malformed token")]
    Malformed,
    #[error("bad signature")]
    BadSignature,
    #[error("expired")]
    Expired,
    #[error("wrong token type")]
    WrongType,
}

fn sign_payload(secret: &[u8], payload: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(payload);
    mac.finalize().into_bytes().to_vec()
}

/// Sign an access token: `base64url(json(claims)).base64url(hmac)`.
pub fn sign_access(claims: &AccessClaims, secret: &[u8]) -> String {
    let payload = serde_json::to_vec(claims).expect("claims serialize");
    let payload_b64 = B64.encode(&payload);
    let sig = sign_payload(secret, payload_b64.as_bytes());
    format!("{}.{}", payload_b64, B64.encode(sig))
}

/// Verify signature + expiry + type. Constant-time signature comparison.
pub fn verify_access(token: &str, secret: &[u8], now: i64) -> Result<AccessClaims, TokenError> {
    let (payload_b64, sig_b64) = token.split_once('.').ok_or(TokenError::Malformed)?;

    let expected = sign_payload(secret, payload_b64.as_bytes());
    let provided = B64.decode(sig_b64).map_err(|_| TokenError::Malformed)?;

    if expected.ct_eq(&provided).unwrap_u8() != 1 {
        return Err(TokenError::BadSignature);
    }

    let payload = B64.decode(payload_b64).map_err(|_| TokenError::Malformed)?;
    let claims: AccessClaims =
        serde_json::from_slice(&payload).map_err(|_| TokenError::Malformed)?;

    if claims.typ != "access" {
        return Err(TokenError::WrongType);
    }
    if now >= claims.exp {
        return Err(TokenError::Expired);
    }
    Ok(claims)
}

/// Short-lived ticket for opening a WebSocket. The browser can't attach the
/// httpOnly access token to a WS handshake, so it first asks (over an
/// authenticated HTTP call) for this signed, ~60s ticket and passes it in the
/// `?ticket=` query. Same HMAC scheme as the access token, with `typ:"ws"`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TicketClaims {
    pub sub: String, // user id (hex ObjectId)
    pub iat: i64,
    pub exp: i64,
    pub typ: String, // always "ws"
}

pub fn sign_ticket(claims: &TicketClaims, secret: &[u8]) -> String {
    let payload = serde_json::to_vec(claims).expect("claims serialize");
    let payload_b64 = B64.encode(&payload);
    let sig = sign_payload(secret, payload_b64.as_bytes());
    format!("{}.{}", payload_b64, B64.encode(sig))
}

pub fn verify_ticket(token: &str, secret: &[u8], now: i64) -> Result<TicketClaims, TokenError> {
    let (payload_b64, sig_b64) = token.split_once('.').ok_or(TokenError::Malformed)?;
    let expected = sign_payload(secret, payload_b64.as_bytes());
    let provided = B64.decode(sig_b64).map_err(|_| TokenError::Malformed)?;
    if expected.ct_eq(&provided).unwrap_u8() != 1 {
        return Err(TokenError::BadSignature);
    }
    let payload = B64.decode(payload_b64).map_err(|_| TokenError::Malformed)?;
    let claims: TicketClaims =
        serde_json::from_slice(&payload).map_err(|_| TokenError::Malformed)?;
    if claims.typ != "ws" {
        return Err(TokenError::WrongType);
    }
    if now >= claims.exp {
        return Err(TokenError::Expired);
    }
    Ok(claims)
}

/// A freshly minted opaque refresh token + its stored hash.
pub struct RefreshSecret {
    pub raw: String,  // sent to the client once
    pub hash: String, // stored in the DB
}

/// 32 bytes of CSPRNG entropy, base64url-encoded.
pub fn generate_refresh(pepper: &[u8]) -> RefreshSecret {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let raw = B64.encode(bytes);
    let hash = hash_refresh(&raw, pepper);
    RefreshSecret { raw, hash }
}

/// Deterministic lookup hash for a refresh token. SHA-256 is fine here because
/// the input already has 256 bits of entropy (no need for a slow KDF), and the
/// server-side pepper means a DB dump alone can't be used to forge tokens.
pub fn hash_refresh(raw: &str, pepper: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pepper);
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

/// Random URL-safe token for email verification / password reset.
pub fn generate_url_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    B64.encode(bytes)
}

/// Hash used to store email/reset tokens (same rationale as refresh tokens).
pub fn hash_url_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

/// 6-digit numeric code for passwordless email login. Stored hashed with the
/// refresh pepper (a DB dump alone can't brute-force it); brute force is also
/// bounded by the short TTL, single-use and the auth rate limiter.
pub fn generate_login_code() -> String {
    let n = rand::thread_rng().next_u32() % 1_000_000;
    format!("{n:06}")
}

/// 8-char alphanumeric backup code (single-use account recovery). Uses an
/// unambiguous alphabet (no 0/O/1/I/L) so codes are easy to read and type.
pub fn generate_backup_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| ALPHABET[(rng.next_u32() as usize) % ALPHABET.len()] as char)
        .collect()
}

/// Strong initial root password for a freshly provisioned VPS. Alphanumeric only
/// (unambiguous alphabet, no 0/O/1/I/L) so it's safe to pass through cloud-init
/// and easy to read/copy — 20 chars ≈ 100 bits of entropy.
pub fn generate_password() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..20)
        .map(|_| ALPHABET[(rng.next_u32() as usize) % ALPHABET.len()] as char)
        .collect()
}
