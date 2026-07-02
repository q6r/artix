//! Authenticated encryption at rest for sensitive tokens (e.g. a user's GitHub
//! OAuth token). ChaCha20-Poly1305 with a key derived from `auth_token_secret`
//! (so no extra env var). Sealed form is base64(nonce ‖ ciphertext+tag).

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

fn derive_key(secret: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"artix-oauth-token-v1");
    h.update(secret);
    h.finalize().into()
}

/// Encrypt `plaintext` under a key derived from `secret`. Returns base64.
pub fn seal(secret: &[u8], plaintext: &[u8]) -> AppResult<String> {
    let key = derive_key(secret);
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|_| AppError::Internal("cipher key".into()))?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| AppError::Internal("seal".into()))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

/// Decrypt a value produced by [`seal`].
pub fn open(secret: &[u8], sealed: &str) -> AppResult<Vec<u8>> {
    let raw = B64
        .decode(sealed)
        .map_err(|_| AppError::Internal("open: bad base64".into()))?;
    if raw.len() < 12 {
        return Err(AppError::Internal("open: too short".into()));
    }
    let (nonce, ct) = raw.split_at(12);
    let key = derive_key(secret);
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|_| AppError::Internal("cipher key".into()))?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| AppError::Internal("open: decrypt failed".into()))
}
