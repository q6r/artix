# ArtixCloud API (Rust · Axum · MongoDB)

Production-oriented backend: authentication, OAuth (scaffolded), RBAC admin,
email (Resend), security hardening and Proxmox deployment.

---

## 1. Architecture

```
            ┌────────── reverse proxy (TLS, rate limit, headers) ──────────┐
HTTP  ───►  │  Axum router                                                 │
            │   ├─ global rate limiter (per IP)                            │
            │   ├─ CORS (allowlist) + body-size limit + tracing            │
            │   └─ routes ─► handlers ─► services* ─► repositories ─► Mongo │
            └──────────────────────────────────────────────────────────────┘
```

- **Handlers**: HTTP shape only (parse → call logic → map result).
- **authN** (`authn.rs`): `AuthUser` extractor verifies the token + session.
- **authZ** (`permissions.rs`): every protected action checks one permission.
- **repositories** (`db.rs` `Collections` trait): typed Mongo access.
- **security** (`security.rs`): audit log + security-event log.
- **errors** (`error.rs`): one `AppError` → consistent JSON + correct status.

\*Service layer is thin for now (logic lives in handlers for the auth slice);
extract to `services/` as flows grow. The boundaries are already in place.

## 2. Auth design (why it's secure)

Two token types:

- **Access token** — stateless, HMAC-SHA256 signed (`auth/token.rs`). The
  algorithm is fixed in code, so there is no `alg` field and therefore no
  alg-confusion / `alg=none` class of bug (the most common JWT footgun). It is
  short-lived (default 15 min) and carries `sub`, `sid`, `ver`. On every request
  the `AuthUser` extractor also loads the session and checks `revoked` +
  `token_version`, so revocation is **instant** (not "eventually after expiry").

- **Refresh token** — opaque, 256 bits of CSPRNG entropy, sent as
  `"<session_id>.<secret>"`. We store only `sha256(pepper || secret)`. A DB dump
  alone cannot forge tokens (server-side pepper). On `/auth/refresh` we **rotate**
  (new secret, `token_version++`) and **detect reuse**: presenting a stale secret
  for a still-valid session means theft → the session is revoked and a
  `refresh_reuse` security event is recorded.

Passwords use **Argon2id**. Login runs a dummy verify on unknown users to blunt
timing-based **user enumeration**; errors are deliberately generic.

This separates **authentication** (who you are — token + session) from
**authorization** (what you may do — permissions resolved from roles per
request), which is the core defense against Broken Access Control / privilege
escalation.

## 3. Collections & indexes

| collection          | purpose                                   | key indexes |
|---------------------|-------------------------------------------|-------------|
| `users`             | accounts                                  | `email` (unique) |
| `sessions`          | refresh sessions                          | `refresh_hash` (unique), `user_id`, `expires_at` (TTL) |
| `oauth_accounts`    | linked providers                          | `(provider, provider_user_id)` unique, `user_id` |
| `email_tokens`      | verification + reset                      | `token_hash`, `(user_id, kind)`, `expires_at` (TTL) |
| `roles`             | RBAC roles                                | `name` (unique) |
| `admin_audit_logs`  | admin actions                             | `created_at` desc, `(actor_id, created_at)` |
| `security_events`   | login fails, reuse, rate limits           | `created_at` desc, `(user_id, created_at)` |

TTL indexes let Mongo auto-purge expired sessions/tokens. Unique indexes
enforce one-account-per-email and one provider-identity-per-link at the DB level
(defense even if app checks are bypassed).

## 4. Routes

`auth`: register, login, refresh, logout, logout-all, me, verify-email,
resend-verification, forgot-password, reset-password, change-password,
change-email + confirm-email-change (verified, requires password re-auth when
the account has one). Login is protected by **per-account brute-force lockout**
(`MAX_FAILED_LOGINS` / `LOCKOUT_MINUTES`, returns 429 `account_locked`).
`sessions`: GET `/sessions`, DELETE `/sessions/:id` (ownership-checked).
`admin`: users (list/get/patch/ban/unban/suspend/unsuspend/delete/roles), roles
(list/create/update/delete), audit-logs, security-events — **each guarded by an
explicit permission**. `update_role`/`delete_user`/suspend cannot touch system
roles or act on self; deleting a user cascades to sessions, OAuth links, email
tokens and API keys.
`keys` (developer API keys): `GET /keys`, `POST /keys` (scopes ⊆ caller's own
permissions; full `ak_…` secret returned **once**), `DELETE /keys/:id`.
`v1` (key-authenticated dev API via `X-API-Key` / `Authorization: Bearer ak_…`):
`GET /v1/whoami`, `GET /v1/ping`. Effective permissions = caller's roles
narrowed by the key's scopes; revoked/expired keys are rejected.
`oauth` (**Discord + GitHub**): `GET /oauth/:provider/start`,
`GET /oauth/:provider/callback`, `POST /oauth/:provider/link`,
`DELETE /oauth/:provider/unlink`. CSRF-safe via HMAC-signed `state`; auto-links
only on a **provider-verified** email (anti-takeover); never lets a user unlink
their last sign-in method.
`servers` (**Proxmox VPS control plane**): `GET /servers`, `POST /servers`
(provision w/ cloud-init: ssh key or password), `GET /servers/:id` (live
status), `DELETE /servers/:id` (destroy), `POST /servers/:id/power`
(start/stop/reboot/shutdown), `GET /servers/:id/metrics` (RRD CPU/RAM/net/disk),
`GET /servers/:id/console` (noVNC ticket + PVE websocket URL) — all
**ownership-checked**.
`admin` nodes: `GET /admin/nodes` (cluster nodes) and `GET /admin/nodes/:node`
(live node status) — gated by `nodes.read`.
Backed by `src/proxmox.rs` (PVE API token auth, clone-template provisioning,
async task polling via UPID, cloud-init, rrddata, vncproxy). Disabled cleanly
(503) when `PROXMOX_API_URL`/token are unset.
`billing` (**subscription per VPS, PIX via PagCI**): `GET /billing/plans`
(public catalog), `POST /billing/subscriptions` (subscribe → creates a
pending-payment VPS + first invoice + PIX charge, returns the copy-paste/QR),
`GET /billing/subscriptions[/:id]`, `POST /billing/subscriptions/:id/cancel`
(`at_period_end` default true), `GET /billing/invoices[/:id]`,
`POST /billing/invoices/:id/pay` (re-issue PIX for an open/expired invoice) —
**ownership-checked**. Admin: `GET /admin/subscriptions`, `GET /admin/invoices`
(`billing.read`), `POST /admin/invoices/:id/mark-paid` (`billing.manage`).
`POST /webhooks/pagci` is **unauthenticated by session** — instead each request
is verified by PagCI's `X-Webhook-Signature` HMAC over the raw body, with a
±5-min replay window and constant-time comparison.

### Billing design
PIX is one-shot, so recurrence lives in the backend (`src/billing.rs`): each
period issues a new invoice + PIX charge; `payment.paid` webhooks settle it
(activating the subscription and **provisioning the VM only after payment**).
Money settlement is decoupled from provisioning — if Proxmox fails the invoice
still records as paid and the server is flagged `error` for retry. Renewals and
suspensions (unpaid past `BILLING_GRACE_DAYS`) are driven by an idempotent,
in-process worker (`BILLING_WORKER_ENABLED`, run on exactly one instance).
Backed by `src/pagci.rs`; disabled cleanly (503) when `PAGCI_*` are unset.

## 5. Permission model

Roles → permissions (with `*` and `prefix.*` wildcards). No `is_admin` boolean.
Security response headers (CSP, HSTS in prod, nosniff, frame-deny, COOP/CORP,
referrer + permissions policy) are applied to every response in-app.
Permissions: `users.read|update|ban|delete`, `roles.read|create|update|delete`,
`permissions.assign`, `admin.audit.read`, `admin.security.read`,
`system.config.read|update`, `nodes.read|manage`, `billing.read|manage`.
A seeded `super_admin` system role holds `*`.

## 6. Folder structure

```
src/
  main.rs        router, middleware, seed, bootstrap
  config.rs      typed env config (fails fast on weak prod secrets)
  error.rs       AppError -> JSON
  state.rs       AppState (cfg, db, http, rate buckets)
  db.rs          connect + indexes + Collections trait
  models.rs      Mongo documents
  permissions.rs permission constants + wildcard matching
  authn.rs       AuthUser extractor (authN) + permission gate (authZ)
  ratelimit.rs   per-IP fixed-window limiter middleware
  security.rs    audit + security-event logging
  email.rs       Resend integration (verification, billing, alerts)
  proxmox.rs     Proxmox VE client (provisioning / power / metrics / console)
  pagci.rs       PagCI PIX client + webhook HMAC verification
  billing.rs     plan catalog, subscriptions, invoices, settlement, worker
  auth/          token.rs (HMAC), password.rs (Argon2id)
  handlers/      auth, sessions, admin, oauth, servers, keys, dev,
                 billing, webhooks, health
```

## 7. Tests (implemented)

- **Unit** (`tests/unit.rs`, no DB): HMAC token roundtrip / tamper / wrong-secret
  / expiry, refresh hashing + pepper, Argon2 verify, permission wildcards,
  OAuth signed-state CSRF (tamper/expiry/wrong-secret).
- **Integration** (`tests/integration.rs`): drive the real router via
  `tower::oneshot` and prove the protections — register/login, **refresh
  rotation + reuse → whole session revoked**, **instant revocation** on logout,
  **IDOR** (A cannot revoke B's session → 404), normal user → `/admin/*` = 403,
  admin with permission = 200, **rate-limit = 429**, and **billing settlement**
  (a `payment.paid` webhook marks the invoice paid + activates the subscription,
  idempotent on replay).

Integration tests need a DB and self-skip without one:

```bash
MONGO_TEST_URI=mongodb://localhost:27017 cargo test   # run everything
cargo test                                            # unit only (DB tests no-op)
```

## 8. Proxmox deployment

- **3 LXC/VMs** on a private bridge (`vmbr1`, e.g. `10.10.10.0/24`):
  - `proxy` — Caddy/NGINX: TLS, HSTS + security headers, edge rate limit.
  - `api` — this binary (systemd unit), only reachable from `proxy`.
  - `db` — MongoDB, only reachable from `api` (bind to private IP, auth on).
- **Firewall** (Proxmox datacenter + per-CT): public 80/443 → `proxy` only;
  `api`→`db` 27017; deny the rest. No public Mongo.
- **Environments**: separate CTs (or a `staging` node) per env; never share DB.
- **Backups**: `mongodump` cron → off-host; Proxmox vzdump snapshots of CTs.
- **Snapshots** before each deploy/migration for instant rollback.
- **Logs**: API emits JSON to stdout → journald → ship to Loki/ELK.
- **Monitoring**: `/health` + `/ready` probes; node_exporter + mongodb_exporter.

---

## Build / run / test

```bash
cp .env.example .env          # fill secrets (AUTH_TOKEN_SECRET >= 32 bytes)
cargo run                     # dev (needs a MongoDB on MONGO_URI)
cargo fmt && cargo clippy --all-targets
cargo test
docker compose -f docker-compose.dev.yml up --build   # api + mongo locally
```

## Deploy (Proxmox `api` CT)

```bash
cargo build --release         # or build the Docker image
# copy target/release/artixcloud-api to the CT, set /etc/artixcloud/.env
# run under systemd; front it with the proxy CT for TLS.
```
