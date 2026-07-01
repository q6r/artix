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

function docker(args, opts = {}) {
  return new Promise((resolve) => {
    execFile("docker", args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

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
app.use((req, res, next) => {
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

const upload = multer({ dest: "/tmp", limits: { fileSize: 250 * 1024 * 1024 } });

// Deploy: multipart `bundle` (zip) + optional `env` (JSON) + `cpus`.
app.post("/apps/:id/deploy", upload.single("bundle"), async (req, res) => {
  const id = cleanId(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });
  if (!req.file) return res.status(400).json({ error: "no bundle" });
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
  const type = (a.TYPE || "").toLowerCase();
  const runtime = (a.RUNTIME || "node").toLowerCase();
  const image = RUNTIMES[runtime] ? RUNTIMES[runtime](a.VERSION) : null;
  if (!image) return res.status(400).json({ error: "unsupported RUNTIME: " + runtime });
  if (!a.START) return res.status(400).json({ error: "START missing in .artix" });
  // RAM: the .artix value, but clamped to the authoritative cap the backend
  // passes (the plan limit) so a user can't over-request via .artix.
  const cap = Math.max(0, parseInt(req.body.ramCap || "0", 10) || 0);
  let ram = Math.max(64, parseInt(a.RAM || "256", 10) || 256);
  if (cap > 0) ram = Math.min(ram, cap);

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
    const b = await docker(
      [
        "run", "--rm", "--memory", `${ram}m`, "--network", "bridge",
        "-v", `${dir}:/app`, "-w", "/app", "--env-file", envFile,
        image, "sh", "-lc", a.BUILD,
      ],
      { timeout: 15 * 60 * 1000 },
    );
    buildLog = (b.stdout + b.stderr).slice(-6000);
    if (b.code !== 0) return res.status(400).json({ error: "build failed", buildLog });
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
  if (type === "site" && a.PORT) createArgs.push("--label", `artix.port=${a.PORT}`);
  createArgs.push(image, "sh", "-lc", a.START);

  const create = await docker(createArgs);
  if (create.code !== 0) return res.status(500).json({ error: "create failed", detail: create.stderr });
  const start = await docker(["start", cname(id)]);
  if (start.code !== 0) return res.status(500).json({ error: "start failed", detail: start.stderr });

  res.json({ ok: true, id, name: a.NAME || id, type, runtime, image, ram, port: a.PORT || null, buildLog });
});

app.post("/apps/:id/action", async (req, res) => {
  const id = cleanId(req.params.id);
  const action = req.body.action;
  if (!["start", "stop", "restart"].includes(action)) return res.status(400).json({ error: "bad action" });
  const r = await docker([action, cname(id)]);
  if (r.code !== 0) return res.status(400).json({ error: r.stderr.trim() || "failed" });
  res.json({ ok: true });
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

app.delete("/apps/:id", async (req, res) => {
  const id = cleanId(req.params.id);
  await docker(["rm", "-f", cname(id)]);
  await fsp.rm(path.join(APPS_DIR, id), { recursive: true, force: true }).catch(() => {});
  await fsp.rm(path.join(ENV_DIR, `${id}.env`), { force: true }).catch(() => {});
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`artix container agent listening on :${PORT}`));
