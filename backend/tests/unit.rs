//! Pure unit tests — no database required. They prove the crypto/authz
//! primitives behave correctly (the foundation the integration tests rely on).

use artixcloud_api::auth::{password, token};
use artixcloud_api::oauth;
use artixcloud_api::permissions::{granted, perm};

const SECRET: &[u8] = b"unit-test-secret-key-at-least-32-bytes!!";
const PEPPER: &[u8] = b"unit-test-pepper-key-also-32-bytes-long!";

// ----- Access token (HMAC) -----

fn claims(exp: i64) -> token::AccessClaims {
    token::AccessClaims {
        sub: "u1".into(),
        sid: "s1".into(),
        ver: 1,
        iat: 0,
        exp,
        typ: "access".into(),
    }
}

#[test]
fn access_token_roundtrip() {
    let t = token::sign_access(&claims(10_000), SECRET);
    let got = token::verify_access(&t, SECRET, 0).unwrap();
    assert_eq!(got.sub, "u1");
    assert_eq!(got.ver, 1);
}

#[test]
fn access_token_rejects_tampered_signature() {
    let mut t = token::sign_access(&claims(10_000), SECRET);
    t.pop();
    t.push(if t.ends_with('A') { 'B' } else { 'A' });
    assert!(token::verify_access(&t, SECRET, 0).is_err());
}

#[test]
fn access_token_rejects_wrong_secret() {
    let t = token::sign_access(&claims(10_000), SECRET);
    assert!(token::verify_access(&t, b"another-wrong-secret-key-32-bytes-aaaa", 0).is_err());
}

#[test]
fn access_token_rejects_expired() {
    let t = token::sign_access(&claims(100), SECRET);
    assert!(token::verify_access(&t, SECRET, 200).is_err());
}

// ----- Refresh hashing -----

#[test]
fn refresh_hash_is_deterministic_and_peppered() {
    let rs = token::generate_refresh(PEPPER);
    assert_eq!(token::hash_refresh(&rs.raw, PEPPER), rs.hash);
    assert_ne!(token::hash_refresh(&rs.raw, b"different-pepper"), rs.hash);
}

// ----- Passwords (Argon2id) -----

#[test]
fn password_hash_verifies() {
    let h = password::hash_password("correct horse battery staple").unwrap();
    assert!(password::verify_password("correct horse battery staple", &h).unwrap());
    assert!(!password::verify_password("wrong password", &h).unwrap());
}

// ----- Permissions -----

#[test]
fn permission_wildcards() {
    assert!(granted(&["*".into()], perm::USERS_DELETE));
    assert!(granted(&["users.*".into()], perm::USERS_READ));
    assert!(!granted(&["users.*".into()], perm::ROLES_READ));
    assert!(granted(&[perm::USERS_BAN.into()], perm::USERS_BAN));
    assert!(!granted(&[perm::USERS_BAN.into()], perm::USERS_DELETE));
}

// ----- OAuth signed state (CSRF) -----

fn state(exp: i64) -> oauth::OAuthState {
    oauth::OAuthState {
        nonce: oauth::new_nonce(),
        provider: "discord".into(),
        intent: "login".into(),
        uid: None,
        exp,
    }
}

#[test]
fn oauth_state_roundtrip() {
    let s = oauth::sign_state(SECRET, &state(10_000));
    let got = oauth::verify_state(SECRET, &s, 0).unwrap();
    assert_eq!(got.provider, "discord");
}

#[test]
fn oauth_state_rejects_tamper_and_expiry() {
    let s = oauth::sign_state(SECRET, &state(10_000));
    let mut bad = s.clone();
    bad.insert(0, 'x');
    assert!(oauth::verify_state(SECRET, &bad, 0).is_none());
    assert!(oauth::verify_state(SECRET, &s, 20_000).is_none()); // expired
    assert!(oauth::verify_state(b"wrong-secret-key-32-bytes-aaaaaaaa", &s, 0).is_none());
}
