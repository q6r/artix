# Configuration

ArtixCloud is three programs, and each one is configured with environment variables:

| Program | Folder | Template to copy | Reference |
|---|---|---|---|
| The API (`artixcloud-api`) | `backend/` | `backend/.env.example` | [Backend](#backend-artixcloud-api) |
| The web app (Next.js) | the repository root | `.env.example` (copy it to `.env.local`) | [Web app](#web-app-nextjs) |
| The container agent | `container-agent/` | `container-agent/.env.example` | [Container agent](#container-agent) |

Nothing secret is stored in the code. The templates hold placeholders only, and `.gitignore` keeps every real `.env*` file
out of Git (only the `.env.example` templates are tracked).

## How configuration is read

**The API** loads a `.env` file from the working directory (or one of its parents) if there is one, and then reads the
environment. The real environment wins over the file. These rules apply to every variable:

- A blank value (`KEY=` or only spaces) is the same as unset. The default applies, and a required variable counts as missing.
  This is what makes `env_file:` in Docker Compose and an untouched copy of `.env.example` behave sensibly.
- Values are trimmed.
- Booleans are exactly `true` or `false`, in lowercase. `True`, `1` and `yes` are errors, so a typo can never silently turn a
  feature off.
- Numbers must parse as the type the table gives. A comma separated list is trimmed and empty items are dropped.
- JSON values (`FRP_RELAYS`, `OS_TEMPLATES`) must be valid JSON. In a `.env` file wrap them in single quotes.
- `APP_ENV` must be `development`, `staging` or `production`. A typo is an error, not a silent switch to development.

A `.env` line that cannot be parsed stops the loader at that line, so the lines after it are ignored. The API logs a warning for
it at startup and `--check-config` reports it as an error. The message never quotes the line, because it may hold a secret. A
value with spaces or a `#` needs quotes (single quotes for JSON).

**Errors and warnings.** The API refuses to start when the configuration is invalid and prints every problem at once, one per
line, with exit code 1. These are errors: a missing required variable, a value of the wrong type, an unknown `APP_ENV`, a
secret shorter than 32 bytes in production, `STORAGE_SELL_THRESHOLD` outside (0, 1], an `OS_TEMPLATES` value that is not a JSON
object of integers, a port range whose minimum is above its maximum (`FRP_PORT_MIN`/`FRP_PORT_MAX`, `MC_PORT_MIN`/`MC_PORT_MAX`),
and a lifetime or limit that must be positive but is not.

Warnings never stop the API. They are logged at startup and printed by `--check-config`:

- an integration that is only half configured (for example a Proxmox URL without a token, or a LiveKit key without a URL),
- in production: a public URL that is not `https`, a CORS origin of `*` or one that points at `localhost`,
  `PROXMOX_INSECURE=true`, or an empty `RESEND_API_KEY`.

**Check without starting.** `artixcloud-api --check-config` (or `cargo run -- --check-config` from `backend/`) loads the
configuration the same way and prints either all the errors (to stderr, exit code 1) or the list of enabled features and the
warnings (exit code 0). It never contacts MongoDB or any other service, so it is safe to run in CI or on a deployment host before
a restart. `artixcloud-api --help` prints the usage, and an unknown option prints it too and exits with code 2.

**Secrets are never printed.** Errors, warnings, the startup summary and the `Debug` output of the configuration name a variable
but never show the value of a secret.

**The web app** is a Next.js app: put local values in `.env.local`, or set real environment variables in production. The server
reads them at runtime, except `NEXT_PUBLIC_*` values, which Next.js inlines into the browser bundle when you run `npm run build`.

**The container agent** does not read `.env` files itself. Load the file with your process manager
(`EnvironmentFile=` in systemd, `--env-file` in Docker) or with `node --env-file=.env server.js` on Node 20.6 or newer.

## Backend (artixcloud-api)

A variable is **required** only when the API cannot start without it. Everything else is optional, and an integration whose
variables are missing is switched off: its endpoints answer `503` and nothing else is affected. A **secret** is a value you must
keep out of Git, logs and screenshots.

### Server

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `APP_ENV` | no | `development` | no | Deployment mode: `development`, `staging` or `production`. In production the two auth secrets must be at least 32 bytes and the API sends HSTS. |
| `API_HOST` | no | `0.0.0.0` | no | Address the HTTP server binds to. |
| `API_PORT` | no | `8080` | no | Port the HTTP server listens on. |
| `CORS_ALLOWED_ORIGINS` | no | `http://localhost:3000` | no | Browser origins allowed to call the API, comma separated. Use the public URL of the web app. |
| `PUBLIC_APP_URL` | no | `http://localhost:3000` | no | Public URL of the web app. Used in links inside emails, after OAuth sign-in and for Stripe redirects. |
| `PUBLIC_API_URL` | no | `http://localhost:8080` | no | Public URL under which the API is reachable from the internet. The OAuth callback (`<url>/oauth/<provider>/callback`) and the PagCI webhook (`<url>/webhooks/pagci`) are built from it. |

### Database

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `MONGO_URI` | no | `mongodb://localhost:27017` | if it has a password | MongoDB connection string. |
| `MONGO_DB` | no | `artixcloud` | no | Database name. |

### Authentication

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `AUTH_TOKEN_SECRET` | **yes** | none | yes | Signs the access tokens (HMAC-SHA256) and is also the key that encrypts the GitHub tokens and webhook secrets stored in the database. At least 32 bytes in production. Generate one with `openssl rand -hex 32`. Changing it signs everybody out and makes the stored GitHub tokens unreadable, so users have to reconnect GitHub. |
| `AUTH_REFRESH_PEPPER` | **yes** | none | yes | Mixed into the stored hash of refresh tokens, so a database dump alone cannot forge a session. At least 32 bytes in production. Changing it signs everybody out. |
| `ACCESS_TOKEN_TTL_SECONDS` | no | `900` | no | Lifetime of an access token (15 minutes). Must be greater than 0. |
| `REFRESH_TOKEN_TTL_SECONDS` | no | `2592000` | no | Lifetime of a refresh token, and so of a session (30 days). Must be greater than 0. The web app's own cookie lasts 30 days. |
| `EMAIL_TOKEN_TTL_SECONDS` | no | `86400` | no | Lifetime of the links in verification and password-reset emails (24 hours). Must be greater than 0. |
| `LOGIN_CODE_TTL_SECONDS` | no | `600` | no | Lifetime of a passwordless login code (10 minutes). Must be greater than 0. |

### Rate limits and lockout

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | no | `120` | no | Requests per minute per client IP across the API. Must be greater than 0. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | no | `10` | no | Requests per minute per client IP on the `/auth` endpoints (login, registration, codes). Must be greater than 0. |
| `MAX_FAILED_LOGINS` | no | `8` | no | Failed password logins before the account is locked. Must be greater than 0. |
| `LOCKOUT_MINUTES` | no | `15` | no | How long a locked account stays locked. Must be greater than 0. |

### Email

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `RESEND_API_KEY` | no | empty | yes | API key of [Resend](https://resend.com), which delivers the email. Empty means emails, login codes included, are written to the log instead of being sent: fine for development, never for production. |
| `EMAIL_FROM` | no | `ArtixCloud <no-reply@artixcloud.com>` | no | The From header of outgoing email. The domain must be verified in Resend. |

### Sign in with Discord and GitHub

A provider is available when both its client id and its client secret are set. Register
`<PUBLIC_API_URL>/oauth/discord/callback` or `<PUBLIC_API_URL>/oauth/github/callback` as the callback URL of the OAuth app.
Linking GitHub is also what lets a user deploy a site from one of their repositories.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `DISCORD_CLIENT_ID` | no | empty | no | Client id of the Discord OAuth app. |
| `DISCORD_CLIENT_SECRET` | no | empty | yes | Client secret of the Discord OAuth app. |
| `GITHUB_CLIENT_ID` | no | empty | no | Client id of the GitHub OAuth app. |
| `GITHUB_CLIENT_SECRET` | no | empty | yes | Client secret of the GitHub OAuth app. |

### Proxmox VE (VPS)

Enabled when `PROXMOX_API_URL`, `PROXMOX_TOKEN_ID` and `PROXMOX_TOKEN_SECRET` are all set. The API clones a template for each new
server and manages it through the Proxmox API.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `PROXMOX_API_URL` | no | empty | no | Base URL of the Proxmox API, including the path: `https://pve.example.com:8006/api2/json`. |
| `PROXMOX_TOKEN_ID` | no | empty | yes | API token id in the form `user@realm!tokenname`. It names a Proxmox account, so it is never printed either. |
| `PROXMOX_TOKEN_SECRET` | no | empty | yes | Secret of that API token. |
| `PROXMOX_NODE` | no | `pve` | no | Name of the node that hosts the VMs. |
| `PROXMOX_TEMPLATE_VMID` | no | `9000` | no | VMID of the default template cloned for new servers. |
| `OS_TEMPLATES` | no | `{}` | no | JSON object that maps an operating system label to a template VMID, for example `{"Debian 12": 9001}`. A label that is not listed uses `PROXMOX_TEMPLATE_VMID`. |
| `PROXMOX_STORAGE` | no | `local-lvm` | no | Storage that holds the disks of new VMs. |
| `STORAGE_POOL` | no | empty | no | Storages whose capacity may be sold, comma separated. Empty means every storage that can hold disk images. |
| `STORAGE_SELL_THRESHOLD` | no | `0.8` | no | Fraction of a storage's capacity, above 0 and up to 1, that may be sold as VM disks once the space used by templates and the OS is set aside. |
| `PROXMOX_BRIDGE` | no | `vmbr0` | no | Network bridge new VMs attach to. |
| `PROXMOX_INSECURE` | no | `false` | no | Accept an invalid or self-signed TLS certificate from Proxmox. For lab setups only. |
| `PROXMOX_CONSOLE_USER` | no | empty | no | A Proxmox user limited to `VM.Console`, for example `console@pve`. Needed for the serial terminal in the browser, whose login rejects API tokens. |
| `PROXMOX_CONSOLE_PASSWORD` | no | empty | yes | Password of that user. |

### Public SSH through frp relays

For servers behind NAT: a relay is a public VPS that runs `frps`, and the Proxmox host runs one `frpc` per relay. Enabled when
`FRP_RELAYS` is set, or when both `FRP_RELAY_HOST` and `FRP_ADMIN_URL` are. `FRP_RELAYS` is the preferred form and wins when
both are set. Each relay in it has `name`, `host`, `token`, `admin_url` and `admin_pass`, and optionally `server_addr`
(default: the host), `server_port` (`7000`), `admin_user` (`artix`), `port_min` (`2200`) and `port_max` (`2300`). The flat
`FRP_*` variables describe one relay named `relay1`.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `FRP_RELAYS` | no | empty | yes | JSON array of relays (see above). It holds tokens and passwords, so treat it as a secret. |
| `FRP_RELAY_HOST` | no | empty | no | Public host of the relay that customers connect to. |
| `FRP_SERVER_ADDR` | no | empty | no | Address `frpc` dials to reach `frps`. Empty means the relay host. |
| `FRP_SERVER_PORT` | no | `7000` | no | Port of `frps`. |
| `FRP_TOKEN` | no | empty | yes | Token shared between `frpc` and `frps`. |
| `FRP_ADMIN_URL` | no | empty | no | Admin API of the `frpc` instance on the Proxmox host, for example `http://127.0.0.1:7400`. |
| `FRP_ADMIN_USER` | no | `artix` | no | User of that admin API. |
| `FRP_ADMIN_PASS` | no | empty | yes | Password of that admin API. |
| `FRP_PORT_MIN` | no | `2200` | no | First public SSH port the relay hands out. Must not be above `FRP_PORT_MAX`. |
| `FRP_PORT_MAX` | no | `2300` | no | Last public SSH port the relay hands out. |

### Containers (Docker VM)

Enabled when `CONTAINER_AGENT_URL` and `CONTAINER_AGENT_TOKEN` are both set. The agent is the only thing that talks to Docker;
see [Container agent](#container-agent).

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `CONTAINER_AGENT_URL` | no | empty | no | Base URL of the container agent, for example `http://203.0.113.20:9090`. |
| `CONTAINER_AGENT_TOKEN` | no | empty | yes | Bearer token the API sends to the agent. It must equal `AGENT_TOKEN` on the agent. |
| `CONTAINER_VM_IP` | no | empty | no | IP of the Docker VM that the `frpc` on the Proxmox host dials for Minecraft ports. Empty means the host part of `CONTAINER_AGENT_URL`. |
| `MC_PORT_MIN` | no | `25565` | no | First public port handed out to Minecraft servers (a range separate from the SSH one). Must not be above `MC_PORT_MAX`. |
| `MC_PORT_MAX` | no | `25764` | no | Last public port handed out to Minecraft servers. |
| `CUSTOM_DOMAIN_RELAY_IP` | no | empty | no | Public IP of the relay that fronts customers' own domains (Caddy with on-demand TLS). Customers point the A record of their domain at it. |
| `PUBLIC_WEBHOOK_BASE` | no | empty | no | Base URL that GitHub can reach to deliver push webhooks for auto-redeploys. The API adds `/webhooks/github/<server id>`. Empty disables auto-redeploy. |

### Cloudflare DNS

Enabled when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are both set. The API creates the `<name>.<zone>` records that let
players reach a Minecraft or voice server by name.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | no | empty | yes | Cloudflare API token with permission to edit DNS in the zone. |
| `CLOUDFLARE_ZONE_ID` | no | empty | no | Id of the zone. |
| `CLOUDFLARE_ZONE_NAME` | no | `artix.cloud` | no | Name of the zone that the `<name>.<zone>` records are created under. |

### Payments

Each provider is enabled on its own: PagCI (PIX) when `PAGCI_API_URL`, `PAGCI_API_TOKEN` and `PAGCI_WALLET_ID` are all set;
eupa (Litecoin) when `EUPA_API_KEY` and `EUPA_WALLET_ID` are both set; Stripe (cards) when `STRIPE_ENABLED` is `true` and
`STRIPE_SECRET_KEY` is set. Point the Stripe webhook at `<PUBLIC_API_URL>/webhooks/stripe`. PagCI is told to call
`<PUBLIC_API_URL>/webhooks/pagci`, and every webhook is checked against its signature.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `PAGCI_API_URL` | no | empty | no | Base URL of the PagCI API. |
| `PAGCI_API_TOKEN` | no | empty | yes | PagCI API token. |
| `PAGCI_WALLET_ID` | no | empty | no | Wallet that receives the PIX payments. |
| `PAGCI_WALLET_NAME` | no | `artix` | no | Name sent with the wallet id as the owner of each charge. |
| `PAGCI_WEBHOOK_SECRET` | no | empty | yes | Secret used to verify the `X-Webhook-Signature` of incoming PagCI webhooks. |
| `EUPA_API_URL` | no | `https://api.eupa.gay` | no | Base URL of the eupa API. |
| `EUPA_API_KEY` | no | empty | yes | eupa API key. |
| `EUPA_WALLET_ID` | no | empty | no | Wallet that receives the Litecoin payments. |
| `EUPA_FEE_TO_CUSTOMER` | no | `true` | no | Whether eupa charges its fee to the customer (`true`) instead of to you (`false`). |
| `STRIPE_ENABLED` | no | `false` | no | Turns on card payments through Stripe Checkout. |
| `STRIPE_SECRET_KEY` | no | empty | yes | Stripe secret key. |
| `STRIPE_WEBHOOK_SECRET` | no | empty | yes | Signing secret of the Stripe webhook endpoint. |

### Billing

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `BILLING_CURRENCY` | no | `BRL` | no | Currency of plans and invoices. |
| `BILLING_WORKER_ENABLED` | no | `false` | no | Runs the in-process billing worker, which issues renewal invoices and suspends overdue servers. Turn it on for exactly one API instance. |
| `BILLING_RENEW_LEAD_DAYS` | no | `3` | no | Days before the end of a period that the renewal invoice is issued. |
| `BILLING_GRACE_DAYS` | no | `3` | no | Days an invoice stays payable before the unpaid server is suspended. |
| `EXPIRY_GRACE_DAYS` | no | `3` | no | Days a server is kept after its expiry date before it is suspended. |
| `BILLING_PIX_TTL_SECONDS` | no | `86400` | no | Not used by the API today: PagCI decides how long a PIX charge stays valid. |

### Voice room (LiveKit)

The shared community voice room in the dashboard. Enabled when `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `LIVEKIT_URL` are set.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `LIVEKIT_API_KEY` | no | empty | yes | API key used to sign the tokens that let a browser join the room. It is never printed. |
| `LIVEKIT_API_SECRET` | no | empty | yes | API secret that goes with the key. |
| `LIVEKIT_URL` | no | empty | no | Public `wss://` URL that the browser connects to. |
| `LIVEKIT_HOST_URL` | no | empty | no | Internal URL the API uses to ask LiveKit who is in the room, for example `http://192.0.2.10:7880`. There is no default: when it is empty, the endpoint that lists who is in the call answers `503` (joining a call still works). Older versions defaulted to a private address of the original deployment. |

### Logging

Logging uses the standard `RUST_LOG` filter (default `info,artixcloud_api=debug`) and writes JSON lines to stdout. It is read by
the logging library, not by the configuration loader, so it is not in the tables above.

## Web app (Next.js)

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `API_INTERNAL_URL` | no | `http://127.0.0.1:8080` | no | Base URL of the API as the Next.js server sees it. It must be an absolute `http(s)` URL. It is never sent to the browser. |
| `NEXT_PUBLIC_WS_URL` | no | `ws(s)://<page host>:8080/ws` | no | Public WebSocket URL of the API gateway, for example `wss://app.example.com/ws`. It is baked in at build time, so set it before `npm run build`. |
| `COOKIE_INSECURE` | no | `false` | no | `true` drops the `Secure` flag from the auth cookies so they work on plain `http`. For local development only. Any other value than `true` or `false` keeps the cookies `Secure` and logs a warning. |

The standard Next.js variables (`PORT`, `HOSTNAME`, `NODE_ENV`) work as usual.

## Container agent

The agent runs on the Docker VM and is called only by the API. It refuses to start without `AGENT_TOKEN`.

| Variable | Required | Default | Secret | Description |
|---|---|---|---|---|
| `AGENT_TOKEN` | **yes** | none | yes | Bearer token the API must send. Set the same value as `CONTAINER_AGENT_TOKEN` on the API. Generate one with `openssl rand -hex 32`. |
| `AGENT_PORT` | no | `9090` | no | Port the agent listens on. |
| `APPS_DIR` | no | `/srv/apps` | no | Where the files of deployed apps are stored. |
| `ENV_DIR` | no | `/srv/env` | no | Where the environment files of containers are stored. |
| `BACKUP_DIR` | no | `/srv/mc-backups` | no | Where Minecraft world backups are stored. |
| `DOCKER_VOLUMES` | no | `/var/lib/docker/volumes` | no | Host path of Docker's named volumes, used by the file browser and backups of Minecraft servers. |
| `APPS_DOMAIN` | no | `artix.cloud` | no | Sites are served at `<subdomain>.<APPS_DOMAIN>` through the reverse proxy. |
| `WEB_NETWORK` | no | `artix-web` | no | Docker network shared with the reverse proxy. |
| `BUILD_MEM_MB` | no | `2048` | no | Memory a build gets at least, even on small plans. The minimum accepted is 512. |
| `BUILD_MEM_MAX` | no | `2560` | no | Most memory a single build may use. It is never lower than `BUILD_MEM_MB`. |
| `BUILD_MEM_RESERVE` | no | `512` | no | Memory that must stay free on the VM on top of a build's share, or the build is refused. The minimum accepted is 256. |

## Values that have to agree

- `CONTAINER_AGENT_TOKEN` (API) and `AGENT_TOKEN` (agent) are the same secret.
- `PUBLIC_APP_URL` and `CORS_ALLOWED_ORIGINS` (API) are the public URL of the web app, and `API_INTERNAL_URL` (web app) reaches
  the API's `API_HOST` and `API_PORT`.
- `PUBLIC_API_URL` (API) is where the OAuth providers, PagCI and Stripe can reach the API from the internet. If you use the web
  app's `/api` proxy for that, it is `https://app.example.com/api`.
- `APPS_DOMAIN` (agent) and `CLOUDFLARE_ZONE_NAME` (API) normally name the same zone.

## Before production

- Set `APP_ENV=production` and generate both auth secrets with `openssl rand -hex 32`.
- Use `https` for `PUBLIC_APP_URL` and `PUBLIC_API_URL`, list only your real origins in `CORS_ALLOWED_ORIGINS`, and leave
  `COOKIE_INSECURE` unset.
- Set `RESEND_API_KEY`, or users will never receive their login codes.
- Keep MongoDB off the public internet and use credentials in `MONGO_URI`.
- Run the billing worker (`BILLING_WORKER_ENABLED=true`) on one instance only.
- Run `artixcloud-api --check-config` with the production environment before every restart and read the warnings.

## Values that are baked into the code

Some values are not configurable yet. If you run a copy under another name, search for them first:

- The domain `artix.cloud`: the API refuses custom domains that end with it (`backend/src/handlers/containers.rs`), and the web
  app shows it in the container screens (for example `APPS_DOMAIN` in `components/containers/ContainerDetailClient.tsx`), in the
  docs page and in the translations (`lib/dict/`).
- The default `EMAIL_FROM` and the contact addresses on the legal pages (`components/LegalLayout.tsx`) use `artixcloud.com`.
