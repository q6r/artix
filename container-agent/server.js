"use strict";
// Artix Container Agent — runs on the dedicated Docker VM (see memory: container-infra).
// The Rust backend is the only client; it calls this HTTP API (bearer-auth) to
// deploy and manage user containers via the local Docker daemon. Nothing here is
// exposed to end users directly.

const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { execFile } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const TOKEN = process.env.AGENT_TOKEN || "";
const PORT = parseInt(process.env.AGENT_PORT || "9090", 10);
const APPS_DIR = process.env.APPS_DIR || "/srv/apps";
const ENV_DIR = process.env.ENV_DIR || "/srv/env";
// Sites are reverse-proxied by Traefik at <subdomain>.APPS_DOMAIN over this network.
// Single-level (<sub>.artix.cloud) so Cloudflare's free Universal SSL covers it.
const APPS_DOMAIN = process.env.APPS_DOMAIN || "artix.cloud";
const WEB_NETWORK = process.env.WEB_NETWORK || "artix-web";

// Supported runtimes -> official base image (VERSION from .artix picks the tag).
const RUNTIMES = {
  node: (v) => `node:${(v || "20").split(".")[0]}-slim`,
  python: (v) => `python:${v || "3.12"}-slim`,
  // extend later: go, rust, java, php...
};

// Fail closed: refuse to start without a bearer token (never serve unauthenticated).
if (!TOKEN) {
  console.error("AGENT_TOKEN is required — refusing to start.");
  process.exit(1);
}

fs.mkdirSync(APPS_DIR, { recursive: true });
fs.mkdirSync(ENV_DIR, { recursive: true });

const cname = (id) => `artix-${id}`;
const cleanId = (s) => String(s || "").replace(/[^a-zA-Z0-9_-]/g, "");

// itzg image Java tag for a Minecraft (Java edition) version. Old MC breaks on
// new Java, so map: <=1.16 -> Java 8, 1.17-1.20 -> Java 17, >=1.21 -> Java 21,
// LATEST/unknown -> latest (newest).
function javaTagFor(version) {
  const v = String(version || "").trim().toUpperCase();
  if (!v || v === "LATEST") return "latest";
  const m = /^1\.(\d+)/.exec(v);
  if (!m) return "latest";
  const minor = parseInt(m[1], 10);
  if (minor <= 16) return "java8";
  if (minor <= 20) return "java17";
  return "java21";
}

// --- deploy concurrency control (this VM is small + multi-tenant) ------------
// One deploy per app at a time (prevents filesystem/docker races + double
// history), and — critically — only ONE build across the WHOLE VM at a time so
// concurrent builds can't over-commit RAM and OOM-kill other tenants' running
// containers. Build memory is capped and gated on free memory before starting.
const inFlight = new Set(); // app ids currently deploying
let buildChain = Promise.resolve(); // global build serializer
function serializeBuild(fn) {
  const run = buildChain.then(() => fn());
  buildChain = run.then(
    () => {},
    () => {},
  ); // keep the chain alive regardless of outcome
  return run;
}
// Absolute per-build memory ceiling (independent of any plan cap) so no single
// build can claim most of the VM. Reserve headroom for the OS/docker/agent/bots.
const BUILD_MEM_MB = Math.max(512, parseInt(process.env.BUILD_MEM_MB || "2048", 10) || 2048);
const BUILD_MEM_MAX = Math.max(BUILD_MEM_MB, parseInt(process.env.BUILD_MEM_MAX || "2560", 10) || 2560);
const BUILD_MEM_RESERVE = Math.max(256, parseInt(process.env.BUILD_MEM_RESERVE || "512", 10) || 512);
function availableMemMB() {
  try {
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    return m ? Math.floor(parseInt(m[1], 10) / 1024) : null;
  } catch {
    return null;
  }
}

function exec(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}
function docker(args, opts = {}) {
  return exec("docker", args, opts);
}
// Minecraft world backups (tar.gz of the /data volume) live outside Docker.
const BACKUP_DIR = process.env.BACKUP_DIR || "/srv/mc-backups";
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const mcDataDir = (id) => path.join(DOCKER_VOLUMES, `artix-mc-${id}`, "_data");
const backupDir = (id) => path.join(BACKUP_DIR, cleanId(id));
const BACKUP_RE = /^backup-\d+\.tar\.gz$/;

function parseArtix(text) {
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(";")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    cfg[t.slice(0, i).trim().toUpperCase()] = t.slice(i + 1).trim();
  }
  return cfg;
}

// Validate a parsed .artix, returning a specific error string (surfaced to the
// user) or null if OK.
function validateArtix(a) {
  const name = (a.NAME || "").trim();
  if (!name || name.length > 128) return ".artix: NAME is required (max 128 chars)";
  const type = (a.TYPE || "").toLowerCase();
  if (type !== "discord_bot" && type !== "site") {
    return `.artix: TYPE must be 'discord_bot' or 'site' (got '${a.TYPE || ""}')`;
  }
  const runtime = (a.RUNTIME || "node").toLowerCase();
  if (!RUNTIMES[runtime]) {
    return `.artix: unsupported RUNTIME '${runtime}' (allowed: ${Object.keys(RUNTIMES).join(", ")})`;
  }
  if (!(a.START || "").trim()) return ".artix: START command is required";
  if (type === "site") {
    const port = parseInt(a.PORT || "", 10);
    if (!port || port < 1 || port > 65535) {
      return ".artix: PORT is required for sites and must be 1–65535";
    }
  }
  if (a.RAM !== undefined && String(a.RAM).trim() !== "") {
    const ram = parseInt(a.RAM, 10);
    if (!ram || ram <= 0) return ".artix: RAM must be a positive number (MB)";
  }
  return null;
}

function writeEnv(id, env) {
  // Defense-in-depth: only well-formed keys and single-line values (the backend
  // validates too, but never trust the caller for something that becomes a file).
  const lines = Object.entries(env || {})
    .filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !/[\n\r\0]/.test(String(v)))
    .map(([k, v]) => `${k}=${String(v)}`);
  const p = path.join(ENV_DIR, `${id}.env`);
  fs.writeFileSync(p, lines.join("\n") + "\n", { mode: 0o600 });
  return p;
}

function readEnv(id) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ENV_DIR, `${id}.env`), "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1);
    }
  } catch {}
  return out;
}

// Reject bundles containing symlinks: they would be honored via the `-v dir:/app`
// mount and could read the Docker VM's host files (defense-in-depth beyond
// adm-zip's own path-traversal guard).
async function hasSymlink(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) return true;
    if (e.isDirectory() && (await hasSymlink(path.join(dir, e.name)))) return true;
  }
  return false;
}

// If the zip unpacked to a single top-level folder (no .artix at root), flatten it.
async function maybeFlatten(dir) {
  if (fs.existsSync(path.join(dir, ".artix"))) return;
  const entries = await fsp.readdir(dir);
  if (entries.length !== 1) return;
  const sole = path.join(dir, entries[0]);
  if (!(await fsp.stat(sole)).isDirectory()) return;
  for (const e of await fsp.readdir(sole)) {
    await fsp.rename(path.join(sole, e), path.join(dir, e));
  }
  await fsp.rm(sole, { recursive: true, force: true });
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Bearer auth for everything else.
// (the /host/mem endpoint below is authed too)
app.use((req, res, next) => {
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

const upload = multer({ dest: "/tmp", limits: { fileSize: 250 * 1024 * 1024 } });

// Free/total RAM on the Docker VM (MB) — backend capacity gate for new servers.
app.get("/host/mem", (_req, res) => {
  let total = null;
  try {
    const m = /MemTotal:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (m) total = Math.floor(parseInt(m[1], 10) / 1024);
  } catch {}
  res.json({ available: availableMemMB(), total });
});

// Deploy: multipart `bundle` (zip) + optional `env` (JSON) + `cpus`.
app.post("/apps/:id/deploy", upload.single("bundle"), async (req, res) => {
  const id = cleanId(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });
  if (!req.file) return res.status(400).json({ error: "no bundle" });
  // One deploy per app at a time — reject overlaps instead of racing.
  if (inFlight.has(id)) {
    await fsp.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(409).json({ error: "a deploy is already in progress" });
  }
  inFlight.add(id);
  try {
    await handleDeploy(id, req, res);
  } finally {
    inFlight.delete(id);
  }
});

async function handleDeploy(id, req, res) {
  const dir = path.join(APPS_DIR, id);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    new AdmZip(req.file.path).extractAllTo(dir, true);
    await fsp.rm(req.file.path, { force: true }).catch(() => {});
    if (await hasSymlink(dir)) {
      await fsp.rm(dir, { recursive: true, force: true });
      return res.status(400).json({ error: "bundle contains symlinks (not allowed)" });
    }
    await maybeFlatten(dir);
  } catch (e) {
    return res.status(400).json({ error: "extract failed: " + e.message });
  }

  let artixText;
  try {
    artixText = fs.readFileSync(path.join(dir, ".artix"), "utf8");
  } catch {
    return res.status(400).json({ error: ".artix not found in project root" });
  }
  const a = parseArtix(artixText);
  const vErr = validateArtix(a);
  if (vErr) return res.status(400).json({ error: vErr });
  const type = (a.TYPE || "").toLowerCase();
  const runtime = (a.RUNTIME || "node").toLowerCase();
  const image = RUNTIMES[runtime](a.VERSION);
  // RAM: the .artix value, but clamped to the authoritative cap the backend
  // passes (the plan limit) so a user can't over-request via .artix.
  const cap = Math.max(0, parseInt(req.body.ramCap || "0", 10) || 0);
  let ram = Math.max(64, parseInt(a.RAM || "256", 10) || 256);
  if (cap > 0) ram = Math.min(ram, cap);
  // Build memory is DECOUPLED from the runtime cap: compiling (npm install,
  // next build, webpack, cargo…) is memory-hungry and would OOM at 256MB, but
  // the *running* app must still stay within its plan cap. The build gets a
  // generous allowance, floored at the runtime cap and hard-capped at an
  // absolute host-aware ceiling so no single build can eat most of the VM.
  const buildRam = Math.min(BUILD_MEM_MAX, Math.max(ram, BUILD_MEM_MB));

  let env = {};
  try {
    env = JSON.parse(req.body.env || "{}");
  } catch {}
  if (type === "site" && a.PORT) env.PORT = env.PORT || a.PORT;
  const envFile = writeEnv(id, env);

  await docker(["rm", "-f", cname(id)]);
  await docker(["pull", image]); // warm cache; run would pull anyway

  let buildLog = "";
  if (a.BUILD) {
    // Run at most ONE build across the whole VM (serializeBuild), and only when
    // there's enough free RAM — so a build can never over-commit memory and
    // OOM-kill other tenants' running containers. --memory-swap == --memory
    // disables swap for the build: it fails fast + clean at the cap instead of
    // thrashing the shared host.
    const built = await serializeBuild(async () => {
      const avail = availableMemMB();
      if (avail !== null && avail < buildRam + BUILD_MEM_RESERVE) {
        return { insufficient: true, avail };
      }
      const b = await docker(
        [
          "run", "--rm", "--memory", `${buildRam}m`, "--memory-swap", `${buildRam}m`,
          "--network", "bridge",
          "-v", `${dir}:/app`, "-w", "/app", "--env-file", envFile,
          image, "sh", "-lc", a.BUILD,
        ],
        { timeout: 15 * 60 * 1000 },
      );
      return { b };
    });
    if (built.insufficient) {
      return res.status(503).json({
        error: `not enough memory to build right now (need ~${buildRam + BUILD_MEM_RESERVE}MB, ${built.avail}MB free) — another build may be running; try again shortly`,
      });
    }
    const b = built.b;
    buildLog = (b.stdout + b.stderr).slice(-6000);
    if (b.code !== 0) {
      // Exit 137 (128+SIGKILL) is the authoritative OOM signal — a host/cgroup
      // OOM kill leaves no reliable text in the log. Keep the substring check as
      // a secondary signal (Node/Python print their own OOM message).
      const oom =
        b.code === 137 ||
        /killed|out of memory|oomkilled|heap out of memory|cannot allocate memory/i.test(buildLog);
      return res.status(400).json({
        error: oom
          ? "build failed: out of memory (build exceeded its memory limit — the app is too heavy to build on the free plan)"
          : "build failed",
        buildLog,
      });
    }
  }

  const createArgs = [
    "create", "--name", cname(id),
    "--memory", `${ram}m`, "--memory-swap", `${ram}m`,
    "--cpus", String(req.body.cpus || "0.5"),
    "--pids-limit", "256",
    "--restart", "unless-stopped",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "-v", `${dir}:/app`, "-w", "/app",
    "--env-file", envFile,
    "--label", "artix.managed=1",
    "--label", `artix.type=${type}`,
  ];
  // Sites join the Traefik network and get host-routing labels so
  // <subdomain>.APPS_DOMAIN reaches them on their internal PORT.
  const subdomain =
    String(req.body.subdomain || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 63) || id;
  const domain = String(req.body.domain || "").toLowerCase().trim();
  if (type === "site" && a.PORT) {
    const rule = domain
      ? `Host(\`${subdomain}.${APPS_DOMAIN}\`) || Host(\`${domain}\`)`
      : `Host(\`${subdomain}.${APPS_DOMAIN}\`)`;
    createArgs.push(
      "--network", WEB_NETWORK,
      "--label", "traefik.enable=true",
      "--label", `traefik.http.routers.${id}.rule=${rule}`,
      "--label", `traefik.http.routers.${id}.entrypoints=web`,
      "--label", `traefik.http.services.${id}.loadbalancer.server.port=${a.PORT}`,
      "--label", `artix.port=${a.PORT}`,
      "--label", `artix.subdomain=${subdomain}`,
      ...(domain ? ["--label", `artix.domain=${domain}`] : []),
    );
  }
  createArgs.push(image, "sh", "-lc", a.START);

  const create = await docker(createArgs);
  if (create.code !== 0) return res.status(500).json({ error: "create failed", detail: create.stderr });
  const start = await docker(["start", cname(id)]);
  if (start.code !== 0) return res.status(500).json({ error: "start failed", detail: start.stderr });

  res.json({
    ok: true,
    id,
    name: a.NAME || id,
    type,
    runtime,
    image,
    ram,
    port: a.PORT ? parseInt(a.PORT, 10) || null : null,
    subdomain: type === "site" ? subdomain : null,
    url: type === "site" ? `https://${subdomain}.${APPS_DOMAIN}` : null,
    buildLog,
  });
}

app.post("/apps/:id/action", async (req, res) => {
  const id = cleanId(req.params.id);
  const action = req.body.action;
  if (!["start", "stop", "restart"].includes(action)) return res.status(400).json({ error: "bad action" });
  const r = await docker([action, cname(id)]);
  if (r.code !== 0) return res.status(400).json({ error: r.stderr.trim() || "failed" });
  res.json({ ok: true });
});

// Attach/detach a custom domain on a site: recreate the container (reusing its
// built dir + config) with an updated Traefik router rule. No rebuild.
app.post("/apps/:id/domain", async (req, res) => {
  const id = cleanId(req.params.id);
  const domain = String(req.body.domain || "").toLowerCase().trim();
  if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: "invalid domain" });
  }
  const insp = await docker([
    "inspect", cname(id), "-f",
    '{{.Config.Image}}|{{.HostConfig.Memory}}|{{index .Config.Labels "artix.subdomain"}}|{{index .Config.Labels "artix.port"}}|{{index .Config.Labels "artix.type"}}',
  ]);
  if (insp.code !== 0) return res.json({ ok: true, applied: false }); // not deployed yet
  const [image, memBytes, subdomain, port, atype] = insp.stdout.trim().split("|");
  if (atype !== "site" || !subdomain || !port || port === "<no value>") {
    return res.status(400).json({ error: "not a routable site container" });
  }
  const cmdInsp = await docker(["inspect", cname(id), "-f", "{{json .Config.Cmd}}"]);
  let cmd = [];
  try { cmd = JSON.parse(cmdInsp.stdout.trim()); } catch {}
  const ramMb = Math.max(64, Math.round(parseInt(memBytes || "0", 10) / 1024 / 1024)) || 256;
  const dir = path.join(APPS_DIR, id);
  const envFile = path.join(ENV_DIR, `${id}.env`);
  const rule = domain
    ? `Host(\`${subdomain}.${APPS_DOMAIN}\`) || Host(\`${domain}\`)`
    : `Host(\`${subdomain}.${APPS_DOMAIN}\`)`;
  await docker(["rm", "-f", cname(id)]);
  const args = [
    "create", "--name", cname(id),
    "--memory", `${ramMb}m`, "--memory-swap", `${ramMb}m`,
    "--cpus", "0.5", "--pids-limit", "256", "--restart", "unless-stopped",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-v", `${dir}:/app`, "-w", "/app",
    ...(fs.existsSync(envFile) ? ["--env-file", envFile] : []),
    "--label", "artix.managed=1", "--label", "artix.type=site",
    "--network", WEB_NETWORK,
    "--label", "traefik.enable=true",
    "--label", `traefik.http.routers.${id}.rule=${rule}`,
    "--label", `traefik.http.routers.${id}.entrypoints=web`,
    "--label", `traefik.http.services.${id}.loadbalancer.server.port=${port}`,
    "--label", `artix.port=${port}`,
    "--label", `artix.subdomain=${subdomain}`,
    ...(domain ? ["--label", `artix.domain=${domain}`] : []),
    image, ...(cmd.length ? cmd : ["sh", "-lc", "true"]),
  ];
  const cr = await docker(args);
  if (cr.code !== 0) return res.status(500).json({ error: "recreate failed", detail: cr.stderr });
  await docker(["start", cname(id)]);
  res.json({ ok: true, applied: true, domain: domain || null });
});

// --- Minecraft servers (itzg images) -----------------------------------------
// A dedicated create path: no zip/build/.artix — the itzg image ships its own
// entrypoint, takes config via env vars, persists the world in a named volume at
// /data, and needs a RAW TCP/UDP port PUBLISHED on the VM (the host-side frpc
// forwards a relay port to it). Nothing to do with the site/Traefik HTTP path.
app.post("/apps/:id/minecraft", async (req, res) => {
  const id = cleanId(req.params.id);
  const b = req.body || {};
  const edition = b.edition === "bedrock" ? "bedrock" : "java";
  const ram = Math.max(512, parseInt(b.ram, 10) || 1024);
  const port = parseInt(b.port, 10);
  if (!port || port < 1024 || port > 65535) return res.status(400).json({ error: "bad port" });
  const version = String(b.version || "LATEST").trim() || "LATEST";
  // Old Minecraft needs old Java (e.g. 1.8-1.16 need Java 8, else Netty errors
  // like "Unable to access address of buffer" and players can't connect). Pick
  // the itzg image's Java tag by MC version. Bedrock is native (no Java tag).
  const image =
    edition === "bedrock"
      ? "itzg/minecraft-bedrock-server"
      : `itzg/minecraft-server:${javaTagFor(version)}`;
  const vol = `artix-mc-${id}`;

  // Build the itzg env. Java heap is sized well BELOW the container cap so the
  // JVM's non-heap (metaspace, threads, GC, Netty buffers) doesn't trip the OOM
  // killer (containers run with swap == memory = a hard cap).
  const env = { EULA: "TRUE", VERSION: version };
  if (edition === "java") {
    env.TYPE = String(b.software || "VANILLA").toUpperCase();
    const heap = Math.max(512, ram - 384);
    env.INIT_MEMORY = `${heap}M`;
    env.MAX_MEMORY = `${heap}M`;
    env.ENABLE_RCON = "true";
    env.RCON_PASSWORD = String(b.rconPassword || "").trim() || "artix";
    env.RCON_PORT = "25575";
  } else {
    env.SERVER_NAME = String(b.serverName || "Artix").slice(0, 40);
  }
  const maxP = parseInt(b.maxPlayers, 10);
  if (maxP > 0) env.MAX_PLAYERS = String(maxP);
  // Optional gameplay overrides (DIFFICULTY, MODE, MOTD, OPS, ...).
  for (const [k, v] of Object.entries(b.props || {})) {
    if (/^[A-Z][A-Z0-9_]*$/.test(k) && !/[\n\r\0]/.test(String(v))) env[k] = String(v);
  }
  const envFile = writeEnv(id, env);

  await docker(["pull", image]);
  await docker(["rm", "-f", cname(id)]); // idempotent re-provision
  await docker(["volume", "create", vol]);

  const publish = edition === "bedrock" ? `${port}:19132/udp` : `${port}:25565/tcp`;
  const args = [
    "create", "--name", cname(id),
    "--memory", `${ram}m`, "--memory-swap", `${ram}m`,
    "--cpus", String(b.cpus || "1"),
    "--pids-limit", "512",
    "--restart", "unless-stopped",
    "--security-opt", "no-new-privileges",
    "--env-file", envFile,
    "-v", `${vol}:/data`,
    "-p", publish,
    "--label", "artix.managed=1",
    "--label", "artix.type=minecraft",
    "--label", `artix.edition=${edition}`,
    "--label", `artix.mcport=${port}`,
    image,
  ];
  const cr = await docker(args);
  if (cr.code !== 0) return res.status(500).json({ error: "create failed", detail: cr.stderr });
  const st = await docker(["start", cname(id)]);
  if (st.code !== 0) return res.status(500).json({ error: "start failed", detail: st.stderr });

  res.json({ ok: true, id, edition, image, ram, port, version });
});

// Run a server console command. Java uses RCON (rcon-cli, bundled in the image);
// Bedrock has no RCON, so we pipe to its console via the itzg `send-command`.
app.post("/apps/:id/console", async (req, res) => {
  const id = cleanId(req.params.id);
  const command = String(req.body.command || "").trim();
  if (!command) return res.status(400).json({ error: "command required" });
  if (/[\n\r\0]/.test(command)) return res.status(400).json({ error: "invalid command" });
  const insp = await docker(["inspect", cname(id), "-f", '{{index .Config.Labels "artix.edition"}}']);
  if (insp.code !== 0) return res.status(404).json({ error: "not found" });
  const edition = insp.stdout.trim();
  const r =
    edition === "bedrock"
      ? await docker(["exec", cname(id), "send-command", command])
      : await docker(["exec", cname(id), "rcon-cli", command]);
  if (r.code !== 0) return res.status(400).json({ error: (r.stderr || "console failed").trim() });
  res.json({ ok: true, output: (r.stdout || "").trim() });
});

// Set server.properties keys (max-players, motd, difficulty, gamemode, ...) by
// editing the file directly (itzg only applies env on first run), then restart.
// Keys are server.properties style (lower-kebab), e.g. { "max-players": "10" }.
app.post("/apps/:id/settings", async (req, res) => {
  const id = cleanId(req.params.id);
  const props = req.body.props || {};
  const p = appPath(id, "server.properties");
  if (!p) return res.status(400).json({ error: "bad path" });
  let lines = [];
  try { lines = (await fsp.readFile(p.target, "utf8")).split(/\r?\n/); } catch {}
  let changed = 0;
  for (const [k, v] of Object.entries(props)) {
    if (!/^[a-z0-9.-]+$/.test(k) || /[\n\r\0]/.test(String(v))) continue;
    const line = `${k}=${String(v)}`;
    const idx = lines.findIndex((l) => l.startsWith(k + "="));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    changed++;
  }
  if (!changed) return res.status(400).json({ error: "no valid settings" });
  await fsp.mkdir(path.dirname(p.target), { recursive: true });
  await fsp.writeFile(p.target, lines.join("\n"), "utf8");
  await docker(["restart", cname(id)]);
  res.json({ ok: true, applied: changed });
});

// --- Minecraft backups + world import (tar.gz of the /data volume) -----------
app.post("/apps/:id/backup", async (req, res) => {
  const id = cleanId(req.params.id);
  const data = mcDataDir(id);
  if (!fs.existsSync(data)) return res.status(404).json({ error: "no server data" });
  const bdir = backupDir(id);
  await fsp.mkdir(bdir, { recursive: true });
  const name = `backup-${Date.now()}.tar.gz`;
  const r = await exec("tar", ["-czf", path.join(bdir, name), "-C", data, "."]);
  if (r.code !== 0) return res.status(500).json({ error: "backup failed", detail: r.stderr });
  const st = await fsp.stat(path.join(bdir, name));
  res.json({ ok: true, name, size: st.size });
});

app.get("/apps/:id/backups", async (req, res) => {
  const id = cleanId(req.params.id);
  let files = [];
  try { files = await fsp.readdir(backupDir(id)); } catch {}
  const out = [];
  for (const f of files) {
    if (!BACKUP_RE.test(f)) continue;
    try { const st = await fsp.stat(path.join(backupDir(id), f)); out.push({ name: f, size: st.size, created: Math.floor(st.mtimeMs) }); } catch {}
  }
  out.sort((a, b) => b.created - a.created);
  res.json({ backups: out });
});

app.post("/apps/:id/backup/restore", async (req, res) => {
  const id = cleanId(req.params.id);
  const name = path.basename(String(req.body.name || ""));
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: "bad name" });
  const file = path.join(backupDir(id), name);
  const data = mcDataDir(id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  if (!fs.existsSync(data)) return res.status(404).json({ error: "no server data" });
  await docker(["stop", cname(id)]);
  await exec("find", [data, "-mindepth", "1", "-delete"]);
  const r = await exec("tar", ["-xzf", file, "-C", data]);
  await docker(["start", cname(id)]);
  if (r.code !== 0) return res.status(500).json({ error: "restore failed", detail: r.stderr });
  res.json({ ok: true });
});

app.post("/apps/:id/backup/delete", async (req, res) => {
  const id = cleanId(req.params.id);
  const name = path.basename(String(req.body.name || ""));
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: "bad name" });
  await fsp.rm(path.join(backupDir(id), name), { force: true }).catch(() => {});
  res.json({ ok: true });
});

app.get("/apps/:id/backup/download", async (req, res) => {
  const id = cleanId(req.params.id);
  const name = path.basename(String(req.query.name || ""));
  if (!BACKUP_RE.test(name)) return res.status(400).json({ error: "bad name" });
  const file = path.join(backupDir(id), name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  fs.createReadStream(file).pipe(res);
});

// Import a world/data archive (.zip or .tar.gz) into /data, replacing it.
app.post("/apps/:id/world", upload.single("file"), async (req, res) => {
  const id = cleanId(req.params.id);
  const cleanup = () => (req.file ? fsp.rm(req.file.path, { force: true }).catch(() => {}) : Promise.resolve());
  if (!req.file) return res.status(400).json({ error: "file required" });
  const nm = String(req.file.originalname || "").toLowerCase();
  const data = mcDataDir(id);
  if (!fs.existsSync(data)) { await cleanup(); return res.status(404).json({ error: "no server data" }); }
  await docker(["stop", cname(id)]);
  let r;
  if (nm.endsWith(".zip")) r = await exec("unzip", ["-o", req.file.path, "-d", data]);
  else if (nm.endsWith(".tar.gz") || nm.endsWith(".tgz")) r = await exec("tar", ["-xzf", req.file.path, "-C", data]);
  else { await cleanup(); await docker(["start", cname(id)]); return res.status(400).json({ error: "use .zip or .tar.gz" }); }
  await cleanup();
  await docker(["start", cname(id)]);
  if (r.code !== 0) return res.status(500).json({ error: "extract failed", detail: (r.stderr || "").slice(0, 300) });
  res.json({ ok: true });
});

// Set the server icon (server-icon.png in /data). Resizes to 64x64 if ImageMagick
// is available, else stores as-is (must already be 64x64). Restarts to apply.
app.post("/apps/:id/icon", upload.single("file"), async (req, res) => {
  const id = cleanId(req.params.id);
  const cleanup = () => (req.file ? fsp.rm(req.file.path, { force: true }).catch(() => {}) : Promise.resolve());
  if (!req.file) return res.status(400).json({ error: "file required" });
  const data = mcDataDir(id);
  if (!fs.existsSync(data)) { await cleanup(); return res.status(404).json({ error: "no server data" }); }
  // Validate PNG magic + small size.
  let head = Buffer.alloc(0);
  try { const fd = fs.openSync(req.file.path, "r"); const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd); head = b; } catch {}
  const isPng = head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!isPng) { await cleanup(); return res.status(400).json({ error: "must be a PNG" }); }
  if ((await fsp.stat(req.file.path)).size > 2 * 1024 * 1024) { await cleanup(); return res.status(400).json({ error: "icon too large (>2MB)" }); }
  const dest = path.join(data, "server-icon.png");
  const r = await exec("convert", [req.file.path, "-resize", "64x64^", "-gravity", "center", "-extent", "64x64", dest]);
  if (r.code !== 0) await fsp.copyFile(req.file.path, dest); // no ImageMagick: store as-is
  await cleanup();
  await docker(["restart", cname(id)]);
  res.json({ ok: true });
});

// Serve the current server icon (for the panel preview). 404 when none is set.
app.get("/apps/:id/icon", (req, res) => {
  const id = cleanId(req.params.id);
  const file = path.join(mcDataDir(id), "server-icon.png");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "no icon" });
  res.type("png");
  res.sendFile(file);
});

// Provision (or reconfigure) a Mumble voice server. Idempotent: recreates the
// container with the given config baked into env; the DB/config volume persists.
app.post("/apps/:id/voice", async (req, res) => {
  const id = cleanId(req.params.id);
  const b = req.body || {};
  const ram = Math.max(256, parseInt(b.ram, 10) || 512);
  const port = parseInt(b.port, 10);
  if (!port || port < 1024 || port > 65535) return res.status(400).json({ error: "bad port" });
  const image = "mumblevoip/mumble-server:latest";
  const vol = `artix-voice-${id}`;

  const env = {
    MUMBLE_SUPERUSER_PASSWORD: String(b.adminPassword || "").trim() || "artixadmin",
    MUMBLE_CONFIG_bandwidth: "72000",
  };
  if (b.serverName) env.MUMBLE_CONFIG_registerName = String(b.serverName).slice(0, 60);
  if (b.welcome) env.MUMBLE_CONFIG_welcometext = String(b.welcome).slice(0, 300);
  const maxU = parseInt(b.maxUsers, 10);
  if (maxU > 0) env.MUMBLE_CONFIG_users = String(maxU);
  if (b.serverPassword) env.MUMBLE_CONFIG_serverpassword = String(b.serverPassword).slice(0, 60);
  const envFile = writeEnv(id, env);

  await docker(["pull", image]);
  await docker(["rm", "-f", cname(id)]); // idempotent re-provision
  await docker(["volume", "create", vol]);
  const args = [
    "create", "--name", cname(id),
    "--memory", `${ram}m`, "--memory-swap", `${ram}m`,
    "--cpus", String(b.cpus || "1"),
    "--pids-limit", "256",
    "--restart", "unless-stopped",
    "--security-opt", "no-new-privileges",
    "--env-file", envFile,
    "-v", `${vol}:/data`,
    "-p", `${port}:64738/tcp`,
    "-p", `${port}:64738/udp`,
    "--label", "artix.managed=1",
    "--label", "artix.type=voice",
    "--label", `artix.mcport=${port}`,
    image,
  ];
  const cr = await docker(args);
  if (cr.code !== 0) return res.status(500).json({ error: "create failed", detail: cr.stderr });
  const st = await docker(["start", cname(id)]);
  if (st.code !== 0) return res.status(500).json({ error: "start failed", detail: st.stderr });
  res.json({ ok: true, id, image, ram, port });
});

app.get("/apps/:id/status", async (req, res) => {
  const id = cleanId(req.params.id);
  const r = await docker([
    "inspect", "-f",
    "{{.State.Status}}|{{.State.Running}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.State.OOMKilled}}",
    cname(id),
  ]);
  if (r.code !== 0) return res.json({ exists: false, status: "absent", running: false });
  const [status, running, exit, started, oom] = r.stdout.trim().split("|");
  res.json({
    exists: true,
    status,
    running: running === "true",
    exitCode: parseInt(exit, 10),
    startedAt: started,
    oomKilled: oom === "true",
  });
});

app.get("/apps/:id/logs", async (req, res) => {
  const id = cleanId(req.params.id);
  const tail = Math.min(3000, Math.max(1, parseInt(req.query.tail || "300", 10) || 300));
  const r = await docker(["logs", "--tail", String(tail), "--timestamps", cname(id)]);
  res.json({ logs: r.stdout + r.stderr });
});

app.get("/apps/:id/stats", async (req, res) => {
  const id = cleanId(req.params.id);
  const r = await docker([
    "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", cname(id),
  ]);
  if (r.code !== 0) return res.json({ cpu: null, mem: null, memPerc: null });
  const [cpu, mem, memPerc] = r.stdout.trim().split("|");
  res.json({ cpu, mem, memPerc });
});

app.put("/apps/:id/env", async (req, res) => {
  const id = cleanId(req.params.id);
  writeEnv(id, req.body.env || {});
  res.json({ ok: true, note: "restart to apply" });
});

// --- file browser / editor (backend gates writes for GitHub-sourced apps) ----
// Resolve a client-supplied path strictly inside the app's own directory. For a
// Minecraft container the files live in its named /data volume, so we browse the
// volume's host mountpoint instead of APPS_DIR (lets users edit server.properties
// etc.). The agent runs as root, so it can read/write the volume path directly.
const DOCKER_VOLUMES = process.env.DOCKER_VOLUMES || "/var/lib/docker/volumes";
function appPath(id, rel) {
  const mcBase = path.join(DOCKER_VOLUMES, `artix-mc-${id}`, "_data");
  const base = fs.existsSync(mcBase) ? mcBase : path.join(APPS_DIR, id);
  const target = path.resolve(base, rel || "");
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return { base, target };
}
const HIDDEN_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);

app.get("/apps/:id/files", async (req, res) => {
  const id = cleanId(req.params.id);
  const p = appPath(id, req.query.path || "");
  if (!p) return res.status(400).json({ error: "bad path" });
  let st;
  try { st = await fsp.stat(p.target); } catch { return res.status(404).json({ error: "not found" }); }
  if (!st.isDirectory()) return res.status(400).json({ error: "not a directory" });
  const dirents = await fsp.readdir(p.target, { withFileTypes: true });
  const entries = [];
  for (const d of dirents) {
    const isDir = d.isDirectory();
    let size = 0;
    if (!isDir) { try { size = (await fsp.stat(path.join(p.target, d.name))).size; } catch {} }
    entries.push({ name: d.name, type: isDir ? "dir" : "file", size, heavy: isDir && HIDDEN_DIRS.has(d.name) });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  res.json({ path: String(req.query.path || "").replace(/^\/+/, ""), entries });
});

app.get("/apps/:id/file", async (req, res) => {
  const id = cleanId(req.params.id);
  const p = appPath(id, req.query.path || "");
  if (!p || p.target === p.base) return res.status(400).json({ error: "bad path" });
  let st;
  try { st = await fsp.stat(p.target); } catch { return res.status(404).json({ error: "not found" }); }
  if (!st.isFile()) return res.status(400).json({ error: "not a file" });
  if (st.size > 512 * 1024) return res.status(413).json({ error: "file too large to edit (>512KB)" });
  const buf = await fsp.readFile(p.target);
  if (buf.includes(0)) return res.status(415).json({ error: "binary file (not editable)" });
  res.json({ path: String(req.query.path || ""), content: buf.toString("utf8"), size: st.size });
});

app.put("/apps/:id/file", async (req, res) => {
  const id = cleanId(req.params.id);
  const p = appPath(id, req.body.path || "");
  if (!p || p.target === p.base) return res.status(400).json({ error: "bad path" });
  const content = typeof req.body.content === "string" ? req.body.content : null;
  if (content === null) return res.status(400).json({ error: "content required" });
  if (Buffer.byteLength(content, "utf8") > 1024 * 1024)
    return res.status(413).json({ error: "content too large (>1MB)" });
  try { await fsp.mkdir(path.dirname(p.target), { recursive: true }); } catch {}
  await fsp.writeFile(p.target, content, "utf8");
  res.json({ ok: true });
});

// Binary upload (Minecraft plugins/mods) into the container's data volume.
app.post("/apps/:id/upload", upload.single("file"), async (req, res) => {
  const id = cleanId(req.params.id);
  const dir = String(req.query.dir || "").replace(/[^a-z]/g, "");
  const cleanup = () => (req.file ? fsp.rm(req.file.path, { force: true }).catch(() => {}) : Promise.resolve());
  if (!["plugins", "mods"].includes(dir)) { await cleanup(); return res.status(400).json({ error: "bad dir" }); }
  if (!req.file) return res.status(400).json({ error: "file required" });
  const name = path.basename(String(req.file.originalname || "upload.jar")).replace(/[^a-zA-Z0-9_.-]/g, "_");
  if (!name.toLowerCase().endsWith(".jar")) { await cleanup(); return res.status(400).json({ error: "only .jar files" }); }
  const p = appPath(id, `${dir}/${name}`);
  if (!p) { await cleanup(); return res.status(400).json({ error: "bad path" }); }
  await fsp.mkdir(path.dirname(p.target), { recursive: true });
  await fsp.copyFile(req.file.path, p.target);
  await cleanup();
  res.json({ ok: true, name });
});

// Delete a file in the data volume (remove a plugin/mod).
app.post("/apps/:id/file/delete", async (req, res) => {
  const id = cleanId(req.params.id);
  const p = appPath(id, req.body.path || "");
  if (!p || p.target === p.base) return res.status(400).json({ error: "bad path" });
  await fsp.rm(p.target, { force: true }).catch(() => {});
  res.json({ ok: true });
});

app.delete("/apps/:id", async (req, res) => {
  const id = cleanId(req.params.id);
  await docker(["rm", "-f", cname(id)]);
  await docker(["volume", "rm", `artix-mc-${id}`]); // Minecraft world volume (no-op if absent)
  await docker(["volume", "rm", `artix-voice-${id}`]); // Mumble data volume (no-op if absent)
  await fsp.rm(path.join(APPS_DIR, id), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(ENV_DIR, `${id}.env`), { force: true }).catch(() => {});
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`artix container agent listening on :${PORT}`));
