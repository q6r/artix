"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Square,
  RotateCw,
  Trash2,
  Upload,
  RefreshCw,
  Plus,
  Cpu,
  MemoryStick,
  ExternalLink,
  Lock,
  History,
  CheckCircle2,
  XCircle,
  GitBranch,
  Zap,
  Folder,
  FileText,
  Save,
  ChevronRight,
  Loader2,
  Globe,
  Copy,
  Check,
  SendHorizonal,
  Clock,
  Image as ImageIcon,
  Download,
} from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import Select from "@/components/Select";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { useToast, useConfirm } from "@/components/FeedbackProvider";
import ContainerStatusBadge from "@/components/containers/ContainerStatusBadge";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type {
  Server,
  ContainerInfo,
  ContainerStats,
  DeployResult,
  DeployItem,
  DomainStatus,
  FileEntry,
  FilesResult,
  FileContent,
  GithubRepo,
  RamBalance,
} from "@/lib/api/types";

type Tab =
  | "overview"
  | "deploy"
  | "domain"
  | "files"
  | "history"
  | "logs"
  | "env"
  | "console"
  | "players"
  | "plugins"
  | "backups"
  | "settings";

/** Add-on directory for a Minecraft software, or null if it can't run add-ons. */
function mcAddonDir(software?: string | null): "plugins" | "mods" | null {
  const s = (software ?? "").toUpperCase();
  if (["PAPER", "PURPUR", "SPIGOT", "BUKKIT"].includes(s)) return "plugins";
  if (["FABRIC", "FORGE", "QUILT", "NEOFORGE"].includes(s)) return "mods";
  return null;
}

/** Public domain for site containers: <subdomain>.APPS_DOMAIN. */
const APPS_DOMAIN = "artix.cloud";

/** First line of a (possibly multi-line) error — full text stays in History. */
function firstLine(s: string): string {
  const line = s.split("\n")[0].trim();
  return line.length > 160 ? line.slice(0, 157) + "…" : line;
}

export default function ContainerDetailClient({ id }: { id: string }) {
  const { t } = useLang();
  const { data: c, error, loading } = useQuery<Server>(`containers/${id}`, {
    refreshInterval: 6000,
  });
  const [tab, setTab] = useState<Tab>("overview");

  if (loading) return <DetailSkeleton />;
  if (error || !c) return <p className="text-sm text-red-300">{t("cont.error")}</p>;

  const isSite = c.container?.container_type === "site";
  const isMc = c.container?.container_type === "minecraft";
  const isVoice = c.container?.container_type === "voice";
  const addonDir = isMc ? mcAddonDir(c.container?.software) : null;
  const tabs: Tab[] = isVoice
    ? ["overview", "settings"]
    : isMc
    ? [
        "overview",
        "console",
        "players",
        ...(addonDir ? (["plugins"] as Tab[]) : []),
        "files",
        "backups",
        "settings",
      ]
    : [
        "overview",
        "deploy",
        ...(isSite ? (["domain"] as Tab[]) : []),
        "files",
        "history",
        "logs",
        "env",
      ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <Link
          href="/dashboard/containers"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> {t("cont.title")}
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <ContainerStatusBadge status={c.container?.status} />
        </div>
      </FadeIn>

      {isMc && c.state === "provisioning" && <McInstallBanner />}
      {isMc && c.state === "error" && <McErrorBanner />}
      {isVoice && c.state === "provisioning" && <VoiceInstallBanner />}
      {isVoice && c.state === "error" && <McErrorBanner />}

      <FadeIn delay={0.04} className="flex gap-1 overflow-x-auto border-b border-white/10">
        {tabs.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === tb
                ? "border-white text-white"
                : "border-transparent text-white/45 hover:text-white/80"
            }`}
          >
            {t(`cont.tab.${tb}`)}
          </button>
        ))}
      </FadeIn>

      {tab === "overview" && (isVoice ? <VoiceOverview id={id} c={c} /> : <Overview id={id} c={c} />)}
      {tab === "deploy" && <DeployTab id={id} c={c} />}
      {tab === "domain" && <DomainTab id={id} c={c} />}
      {tab === "files" && <FilesTab id={id} c={c} />}
      {tab === "history" && <HistoryTab id={id} />}
      {tab === "logs" && <LogsTab id={id} />}
      {tab === "env" && <EnvTab id={id} />}
      {tab === "console" && <McConsoleTab id={id} />}
      {tab === "players" && <McPlayersTab id={id} c={c} />}
      {tab === "plugins" && addonDir && <McPluginsTab id={id} dir={addonDir} />}
      {tab === "backups" && <McBackupsTab id={id} />}
      {tab === "settings" && isMc && <McSettingsTab id={id} c={c} />}
      {tab === "settings" && isVoice && <VoiceSettingsTab id={id} c={c} />}
    </div>
  );
}

// ----------------------------- Overview -----------------------------

function Overview({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { data: stats } = useQuery<ContainerStats>(`containers/${id}/stats`, {
    refreshInterval: 4000,
  });

  const act = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      await api(`containers/${id}/action`, { method: "POST", json: { action } });
      await mutate(`containers/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (
      !(await confirm({
        title: t("cont.delete.title"),
        message: t("cont.delete.msg"),
        confirmLabel: t("cont.action.delete"),
        danger: true,
      }))
    )
      return;
    try {
      await api(`containers/${id}`, { method: "DELETE" });
      await mutate("containers");
      router.push("/dashboard/containers");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  const btn =
    "inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-40";

  return (
    <FadeIn className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("cont.ov.cpu")} value={stats?.cpu ?? "—"} icon={<Cpu className="h-4 w-4" />} />
        <Stat
          label={t("cont.ov.mem")}
          value={stats?.mem ?? `— / ${c.container?.ram_mb ?? 256} MB`}
          icon={<MemoryStick className="h-4 w-4" />}
        />
        <Stat label={t("cont.runtime")} value={c.container?.runtime ?? "—"} />
        <Stat
          label={t("cont.ov.type")}
          value={
            c.container?.container_type === "site"
              ? "Site"
              : c.container?.container_type === "minecraft"
                ? "Minecraft"
                : "Bot"
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => act("start")} disabled={busy} className={btn}>
          <Play className="h-4 w-4" /> {t("cont.action.start")}
        </button>
        <button onClick={() => act("stop")} disabled={busy} className={btn}>
          <Square className="h-4 w-4" /> {t("cont.action.stop")}
        </button>
        <button onClick={() => act("restart")} disabled={busy} className={btn}>
          <RotateCw className="h-4 w-4" /> {t("cont.action.restart")}
        </button>
        <button
          onClick={del}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" /> {t("cont.action.delete")}
        </button>
      </div>

      {c.container?.container_type === "site" && c.container?.subdomain && (
        <a
          href={`https://${c.container.subdomain}.${APPS_DOMAIN}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm transition-colors hover:bg-white/[0.04]"
        >
          <span className="text-white/55">{t("cont.ov.url")}</span>
          <span className="inline-flex items-center gap-1.5 truncate font-mono text-xs text-sky-300">
            {c.container.subdomain}.{APPS_DOMAIN}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </span>
        </a>
      )}

      {c.container?.container_type === "minecraft" && <McMetrics id={id} />}
      {c.container?.container_type === "minecraft" && <McConnectCard c={c} />}

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/55">{t("cont.ov.appId")}</span>
          <span className="truncate font-mono text-xs text-white/70">{c.container?.app_id}</span>
        </div>
      </div>
    </FadeIn>
  );
}

// ----------------------------- Minecraft -----------------------------

/** Tiny rolling line chart (values 0–100). */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 100, h = 28;
  if (data.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" />;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (Math.min(Math.max(v, 0), 100) / 100) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Live CPU + RAM usage with a rolling client-side graph (shares the stats poll). */
function McMetrics({ id }: { id: string }) {
  const { data: stats } = useQuery<ContainerStats>(`containers/${id}/stats`, { refreshInterval: 4000 });
  const [cpu, setCpu] = useState<number[]>([]);
  const [mem, setMem] = useState<number[]>([]);
  useEffect(() => {
    if (!stats) return;
    const c = parseFloat((stats.cpu ?? "").replace("%", "")) || 0;
    const m = parseFloat((stats.memPerc ?? "").replace("%", "")) || 0;
    setCpu((h) => [...h, c].slice(-40));
    setMem((h) => [...h, m].slice(-40));
  }, [stats]);
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-white/45">CPU</span>
          <span className="text-sm font-semibold">{stats?.cpu ?? "—"}</span>
        </div>
        <div className="mt-2">
          <Sparkline data={cpu} color="#38bdf8" />
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-white/45">RAM</span>
          <span className="text-sm font-semibold">{stats?.mem ?? "—"}</span>
        </div>
        <div className="mt-2">
          <Sparkline data={mem} color="#34d399" />
        </div>
      </div>
    </div>
  );
}

/** Copyable mono value with a label. */
function McAddr({ label, value }: { label: string; value: string | null }) {
  const { t } = useLang();
  const toast = useToast();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-white/55">{label}</span>
      {value ? (
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value);
            toast(t("cont.mc.copied"), "success");
          }}
          className="inline-flex items-center gap-2 truncate font-mono text-sm text-sky-300 hover:underline"
        >
          {value} <Copy className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : (
        <span className="text-sm text-white/40">{t("cont.mc.provisioning")}</span>
      )}
    </div>
  );
}

/** Server address (domain + direct) + edition/software/version for a Minecraft container. */
function McConnectCard({ c }: { c: Server }) {
  const { t } = useLang();
  const mc = c.container;
  const host = mc?.mc_relay_host ?? null;
  const port = mc?.mc_port ?? null;
  const direct = host && port ? `${host}:${port}` : null;
  const isBedrock = mc?.edition === "bedrock";
  const domain = mc?.subdomain ? `${mc.subdomain}.${APPS_DOMAIN}` : null;
  const edition = isBedrock ? "Bedrock" : "Java";
  const soft = isBedrock ? "Bedrock" : (mc?.software ?? "Vanilla");

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      {/* Java: SRV means the domain alone works. Bedrock needs the domain + port. */}
      {!isBedrock && domain && <McAddr label={t("cont.mc.address")} value={domain} />}
      {isBedrock && domain && <McAddr label={t("cont.mc.addressBedrock")} value={domain} />}
      {isBedrock && port != null && <McAddr label={t("cont.mc.portLabel")} value={String(port)} />}
      <McAddr label={t("cont.mc.direct")} value={direct} />
      <div className="grid grid-cols-3 gap-3 border-t border-white/5 pt-3 text-center">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/35">{t("cont.mc.edition")}</p>
          <p className="mt-0.5 text-sm font-medium">{edition}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/35">{t("cont.mc.software")}</p>
          <p className="mt-0.5 text-sm font-medium capitalize">{soft.toLowerCase()}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-white/35">{t("cont.mc.version")}</p>
          <p className="mt-0.5 text-sm font-medium">{mc?.version ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

/** Shown while a Minecraft server is downloading its jar + generating the world. */
function McInstallBanner() {
  const { t } = useLang();
  return (
    <FadeIn className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-5">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-300" />
        <div>
          <p className="text-sm font-semibold text-sky-200">{t("cont.mc.installing.title")}</p>
          <p className="mt-1 text-sm text-white/60">{t("cont.mc.installing.desc")}</p>
          <p className="mt-2 text-xs text-white/40">{t("cont.mc.installing.hint")}</p>
        </div>
      </div>
    </FadeIn>
  );
}

/** Shown when provisioning failed (bad version, EULA, OOM, crash-loop). */
function McErrorBanner() {
  const { t } = useLang();
  return (
    <FadeIn className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
        <div>
          <p className="text-sm font-semibold text-red-200">{t("cont.mc.error.title")}</p>
          <p className="mt-1 text-sm text-white/60">{t("cont.mc.error.desc")}</p>
        </div>
      </div>
    </FadeIn>
  );
}

/** Shown while a Mumble voice server is being provisioned. */
function VoiceInstallBanner() {
  const { t } = useLang();
  return (
    <FadeIn className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-5">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-sky-300" />
        <div>
          <p className="text-sm font-semibold text-sky-200">{t("cont.voice.installing.title")}</p>
          <p className="mt-1 text-sm text-white/60">{t("cont.voice.installing.desc")}</p>
        </div>
      </div>
    </FadeIn>
  );
}

/** Voice (Mumble) overview: power controls + how to connect + the admin credentials. */
function VoiceOverview({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const v = c.container;
  const host = v?.mc_relay_host ?? null;
  const port = v?.mc_port ?? null;
  const domain = v?.subdomain ? `${v.subdomain}.${APPS_DOMAIN}` : host;
  const address = domain && port ? `${domain}:${port}` : null;

  const act = async (action: "start" | "stop" | "restart") => {
    setBusy(true);
    try {
      await api(`containers/${id}/action`, { method: "POST", json: { action } });
      await mutate(`containers/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (
      !(await confirm({
        title: t("cont.delete.title"),
        message: t("cont.delete.msg"),
        confirmLabel: t("cont.action.delete"),
        danger: true,
      }))
    )
      return;
    try {
      await api(`containers/${id}`, { method: "DELETE" });
      await mutate("containers");
      router.push("/dashboard/containers");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  const btn =
    "inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-40";

  return (
    <FadeIn className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => act("start")} disabled={busy} className={btn}>
          <Play className="h-4 w-4" /> {t("cont.action.start")}
        </button>
        <button onClick={() => act("stop")} disabled={busy} className={btn}>
          <Square className="h-4 w-4" /> {t("cont.action.stop")}
        </button>
        <button onClick={() => act("restart")} disabled={busy} className={btn}>
          <RotateCw className="h-4 w-4" /> {t("cont.action.restart")}
        </button>
        <button
          onClick={del}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" /> {t("cont.action.delete")}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm font-medium">{t("cont.voice.connect")}</p>
        <McAddr label={t("cont.voice.address")} value={address} />
        <McAddr label={t("cont.voice.port")} value={port ? String(port) : null} />
        <p className="text-xs text-white/40">{t("cont.voice.connectHint")}</p>
      </div>
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm font-medium">{t("cont.voice.admin")}</p>
        <McAddr label={t("cont.voice.adminUser")} value="SuperUser" />
        <McAddr label={t("cont.voice.adminPw")} value={v?.admin_password ?? null} />
        {v?.voice_password ? <McAddr label={t("cont.voice.serverPw")} value={v.voice_password} /> : null}
        <p className="text-xs text-white/40">{t("cont.voice.adminHint")}</p>
      </div>
    </FadeIn>
  );
}

/** Voice settings: max users, join password, regenerate the admin password. */
function VoiceSettingsTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const v = c.container;
  const [maxUsers, setMaxUsers] = useState(v?.max_players ?? 50);
  const [serverPw, setServerPw] = useState(v?.voice_password ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api(`containers/${id}/voice`, {
        method: "PUT",
        json: { max_users: maxUsers, server_password: serverPw },
      });
      await mutate(`containers/${id}`);
      toast(t("cont.voice.saved"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setSaving(false);
    }
  };

  const regenAdmin = async () => {
    if (
      !(await confirm({
        title: t("cont.voice.regenTitle"),
        message: t("cont.voice.regenMsg"),
        confirmLabel: t("cont.voice.regen"),
        danger: true,
      }))
    )
      return;
    setSaving(true);
    try {
      await api(`containers/${id}/voice`, { method: "PUT", json: { regen_admin: true } });
      await mutate(`containers/${id}`);
      toast(t("cont.voice.regenerated"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FadeIn className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">{t("cont.voice.settings")}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/70">{t("cont.voice.maxUsers")}</span>
          <input
            type="number"
            min={1}
            max={500}
            value={maxUsers}
            onChange={(e) => setMaxUsers(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="h-11 w-32 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/70">{t("cont.voice.serverPw")}</span>
          <input
            value={serverPw}
            onChange={(e) => setServerPw(e.target.value)}
            maxLength={60}
            placeholder={t("cont.voice.serverPwPlaceholder")}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <span className="text-xs text-white/40">{t("cont.voice.serverPwHint")}</span>
        </label>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-white/40">{t("cont.voice.restartNote")}</p>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("cont.mc.settings.save")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("cont.voice.admin")}</p>
          <p className="mt-1 text-xs text-white/40">{t("cont.voice.regenHint")}</p>
        </div>
        <button
          onClick={regenAdmin}
          disabled={saving}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
          {t("cont.voice.regen")}
        </button>
      </div>
    </FadeIn>
  );
}

/** Live console: server logs + an RCON command input (Java) / console pipe (Bedrock). */
function McConsoleTab({ id }: { id: string }) {
  const { t } = useLang();
  const toast = useToast();
  const { data: logs } = useQuery<{ logs: string }>(`containers/${id}/logs?tail=300`, {
    refreshInterval: 4000,
  });
  const [cmd, setCmd] = useState("");
  const [sending, setSending] = useState(false);
  const [replies, setReplies] = useState<string[]>([]);
  const boxRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, replies]);

  const send = async () => {
    const command = cmd.trim();
    if (!command || sending) return;
    setSending(true);
    try {
      const out = await api<{ output: string }>(`containers/${id}/console`, {
        method: "POST",
        json: { command },
      });
      setReplies((r) => [...r, `> ${command}`, out.output || "(ok)"].slice(-40));
      setCmd("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setSending(false);
    }
  };

  const body = [logs?.logs ?? "", ...replies].filter(Boolean).join("\n");

  return (
    <FadeIn className="space-y-3">
      <pre
        ref={boxRef}
        className="h-[52vh] overflow-auto rounded-2xl border border-white/10 bg-black p-4 font-mono text-xs leading-relaxed text-white/80"
      >
        {body || t("cont.logs.empty")}
      </pre>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-white/40">/</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={t("cont.mc.cmdPlaceholder")}
          className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 font-mono text-sm outline-none focus:border-white/30"
        />
        <button
          onClick={send}
          disabled={sending || !cmd.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          {t("cont.mc.send")}
        </button>
      </div>
      <p className="text-xs text-white/40">{t("cont.mc.consoleHint")}</p>
    </FadeIn>
  );
}

type McPlayer = { name: string; since: string | null };

/** Elapsed time since an ISO timestamp → "1h 4m" / "12m" / "40s" (null if unknown). */
function fmtSince(iso: string | null): string | null {
  if (!iso) return null;
  const start = Date.parse(iso);
  if (!start) return null;
  let s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Online players — avatar + session time via the backend /players endpoint. */
function McPlayersTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const [players, setPlayers] = useState<McPlayer[]>([]);
  const [count, setCount] = useState<{ online: number; max: number } | null>(null);
  const [err, setErr] = useState(false);
  const [, tick] = useState(0);
  const ramMb = c.container?.ram_mb ?? 1024;
  const cap = Math.max(10, Math.floor((ramMb / 1024) * 15));
  const savedMax = c.container?.max_players ?? 20;
  const [maxPlayers, setMaxPlayers] = useState(savedMax);
  const [savingMax, setSavingMax] = useState(false);

  const saveMax = async () => {
    if (savingMax) return;
    setSavingMax(true);
    try {
      await api(`containers/${id}/max-players`, { method: "PUT", json: { max: maxPlayers } });
      await mutate(`containers/${id}`);
      toast(t("cont.mc.slots.saved"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setSavingMax(false);
    }
  };

  const refresh = async () => {
    try {
      const r = await api<{ online: number; max: number; players: McPlayer[] }>(
        `containers/${id}/players`,
      );
      setCount({ online: r.online, max: r.max });
      setPlayers(r.players ?? []);
      setErr(false);
    } catch {
      setErr(true);
    }
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10000);
    const tk = setInterval(() => tick((x) => x + 1), 30000); // keep durations ticking
    return () => {
      clearInterval(iv);
      clearInterval(tk);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <FadeIn className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-white/55">{t("cont.mc.slots.max")}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={cap}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Math.max(1, Math.min(cap, Number(e.target.value) || 1)))}
              className="h-9 w-20 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-center text-sm outline-none focus:border-white/30"
            />
            <span className="text-xs text-white/40">/ {cap}</span>
            <button
              onClick={saveMax}
              disabled={savingMax || maxPlayers === savedMax}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-40"
            >
              {savingMax ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("cont.mc.slots.save")}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-white/40">{t("cont.mc.slots.hint")}</p>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <span className="text-sm text-white/55">{t("cont.mc.playersOnline")}</span>
        <span className="text-lg font-semibold">
          {count ? `${count.online} / ${count.max}` : err ? "—" : "…"}
        </span>
      </div>
      {players.length > 0 ? (
        <div className="space-y-2">
          {players.map((p) => {
            const dur = fmtSince(p.since);
            return (
              <div
                key={p.name}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/32`}
                  alt=""
                  width={32}
                  height={32}
                  loading="lazy"
                  className="h-8 w-8 shrink-0 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
                <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                {dur && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-white/40">
                    <Clock className="h-3.5 w-3.5" />
                    {dur}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-white/40">{err ? t("cont.mc.playersErr") : t("cont.mc.noPlayers")}</p>
      )}
    </FadeIn>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-1.5 text-xs text-white/45">
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

// ----------------------------- Deploy -----------------------------

const ARTIX_EXAMPLE = `NAME=MeuBot
TYPE=discord_bot
MAIN=index.js
RUNTIME=node
VERSION=20
RAM=256
BUILD=npm install
START=node index.js`;

type DeployPhase = "idle" | "running" | "done" | "error";
const ZIP_STAGES = ["upload", "extract", "artix", "build", "start"] as const;
const GH_STAGES = ["fetch", "extract", "artix", "build", "start"] as const;

function DeployTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const { user } = useAuth();
  const [source, setSource] = useState<"zip" | "github">("zip");
  const [busy, setBusy] = useState(false);
  const [buildLog, setBuildLog] = useState("");
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [stage, setStage] = useState(0);

  const stages = source === "zip" ? ZIP_STAGES : GH_STAGES;

  // Advance through the early (fast) stages while a deploy runs, then hold on
  // "build" (the long pole) until the real result lands.
  useEffect(() => {
    if (phase !== "running") return;
    const iv = setInterval(() => setStage((s) => (s < 3 ? s + 1 : s)), 1300);
    return () => clearInterval(iv);
  }, [phase]);

  const begin = () => {
    setBusy(true);
    setBuildLog("");
    setStage(0);
    setPhase("running");
  };
  const finish = (out: DeployResult) => {
    setBuildLog(out.buildLog ?? "");
    setStage(stages.length);
    setPhase("done");
    setBusy(false);
    toast(t("cont.deploy.ok"), "success");
    void mutate(`containers/${id}`);
    void mutate(`containers/${id}/deploys`);
  };
  const fail = (msg: string) => {
    // Backend error messages carry the build-log tail after a newline.
    setBuildLog(msg);
    setPhase("error");
    setBusy(false);
    toast(firstLine(msg));
  };

  const deployZip = async (file: File) => {
    begin();
    try {
      const fd = new FormData();
      fd.append("bundle", file);
      finish(await api<DeployResult>(`containers/${id}/deploy`, { method: "POST", body: fd }));
    } catch (e) {
      fail(e instanceof ApiError ? e.message : t("cont.deploy.err"));
    }
  };

  const seg = (active: boolean) =>
    `inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
      active ? "bg-white text-black" : "text-white/60 hover:text-white"
    }`;

  return (
    <FadeIn className="space-y-4">
      <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <button type="button" onClick={() => setSource("zip")} className={seg(source === "zip")}>
          <Upload className="h-4 w-4" /> {t("cont.deploy.srcZip")}
        </button>
        <button type="button" onClick={() => setSource("github")} className={seg(source === "github")}>
          <GithubIcon className="h-4 w-4" /> {t("cont.deploy.srcGithub")}
        </button>
      </div>

      {source === "zip" ? (
        <>
          <p className="text-sm text-white/55">{t("cont.deploy.hint")}</p>
          <label
            className={`inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 ${
              busy ? "pointer-events-none opacity-60" : "cursor-pointer"
            }`}
          >
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                {t("cont.deploy.deploying")}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> {t("cont.deploy.btn")}
              </>
            )}
            <input
              type="file"
              accept=".zip"
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && deployZip(e.target.files[0])}
            />
          </label>
        </>
      ) : (
        <GithubDeploy
          id={id}
          container={c.container}
          linked={!!user?.github_linked}
          busy={busy}
          onStart={begin}
          onDone={finish}
          onErr={fail}
        />
      )}

      {phase !== "idle" && <DeployProgress stages={stages} active={stage} phase={phase} t={t} />}

      <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <summary className="cursor-pointer text-sm text-white/60">{t("cont.deploy.artixHelp")} .artix</summary>
        <pre className="mt-3 overflow-auto rounded-xl bg-black p-3 font-mono text-[12px] text-white/70">
          {ARTIX_EXAMPLE}
        </pre>
      </details>

      {buildLog && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
            {phase === "error" ? t("cont.deploy.buildErr") : t("cont.deploy.buildLog")}
          </p>
          <pre
            className={`max-h-80 overflow-auto rounded-2xl border bg-black p-4 font-mono text-[13px] whitespace-pre-wrap ${
              phase === "error" ? "border-red-500/25 text-red-200/85" : "border-white/10 text-white/80"
            }`}
          >
            {buildLog}
          </pre>
        </div>
      )}
    </FadeIn>
  );
}

function DeployProgress({
  stages,
  active,
  phase,
  t,
}: {
  stages: readonly string[];
  active: number;
  phase: DeployPhase;
  t: (k: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <ol className="space-y-2.5">
        {stages.map((s, i) => {
          let state: "done" | "active" | "failed" | "idle";
          if (phase === "done") state = "done";
          else if (phase === "error") state = i < active ? "done" : i === active ? "failed" : "idle";
          else state = i < active ? "done" : i === active ? "active" : "idle";
          return (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {state === "done" && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                {state === "active" && <Loader2 className="h-4 w-4 animate-spin text-sky-300" />}
                {state === "failed" && <XCircle className="h-5 w-5 text-red-400" />}
                {state === "idle" && <span className="h-2 w-2 rounded-full bg-white/20" />}
              </span>
              <span
                className={
                  state === "idle"
                    ? "text-white/35"
                    : state === "failed"
                      ? "text-red-300"
                      : state === "active"
                        ? "text-white"
                        : "text-white/70"
                }
              >
                {t(`cont.deploy.stage.${s}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function GithubDeploy({
  id,
  container,
  linked,
  busy,
  onStart,
  onDone,
  onErr,
}: {
  id: string;
  container?: ContainerInfo | null;
  linked: boolean;
  busy: boolean;
  onStart: () => void;
  onDone: (out: DeployResult) => void;
  onErr: (m: string) => void;
}) {
  const { t } = useLang();
  const [repo, setRepo] = useState(container?.github_repo ?? "");
  const [branch, setBranch] = useState(container?.github_ref ?? "");
  const { data: repos, loading } = useQuery<GithubRepo[]>(
    linked ? "account/github/repos" : null,
  );
  const selected = (repos ?? []).find((r) => r.full_name === repo);
  const autoOn = !!container?.auto_deploy;

  const connect = async () => {
    try {
      const { authorize_url } = await api<{ authorize_url: string }>("oauth/github/link", {
        method: "POST",
      });
      window.location.href = authorize_url;
    } catch (e) {
      onErr(e instanceof ApiError ? e.message : t("cont.deploy.err"));
    }
  };

  const deploy = async () => {
    if (!repo) return;
    onStart();
    try {
      onDone(
        await api<DeployResult>(`containers/${id}/deploy-github`, {
          method: "POST",
          json: { repo, ref: branch.trim() || undefined },
        }),
      );
    } catch (e) {
      onErr(e instanceof ApiError ? e.message : t("cont.deploy.err"));
    }
  };

  if (!linked) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm text-white/60">{t("cont.deploy.githubNotLinked")}</p>
        <button
          onClick={connect}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          <GithubIcon className="h-4 w-4" /> {t("cont.deploy.connectGithub")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {autoOn && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div className="text-sm">
            <p className="font-medium text-emerald-200">{t("cont.deploy.autoOn")}</p>
            <p className="mt-0.5 text-white/55">
              {t("cont.deploy.autoOnDesc")}{" "}
              <span className="font-mono text-xs text-white/75">
                {container?.github_repo}
                {container?.github_ref ? `@${container.github_ref}` : ""}
              </span>
            </p>
          </div>
        </div>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/70">{t("cont.deploy.repo")}</span>
        <Select
          value={repo}
          onChange={setRepo}
          placeholder={loading ? t("cont.deploy.loadingRepos") : t("cont.deploy.pickRepo")}
          className="h-11 w-full px-4 text-sm"
          searchable
          searchPlaceholder={t("cont.deploy.searchRepo")}
          emptyLabel={t("cont.deploy.noRepos")}
          options={(repos ?? []).map((r) => ({ value: r.full_name, label: r.full_name }))}
        />
        {selected?.private && (
          <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
            <Lock className="h-3.5 w-3.5" /> {t("cont.deploy.private")}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/70">{t("cont.deploy.branch")}</span>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder={t("cont.deploy.branchPlaceholder")}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
        />
      </label>
      <button
        onClick={deploy}
        disabled={busy || !repo}
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
      >
        {busy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            {t("cont.deploy.deploying")}
          </>
        ) : (
          <>
            <GithubIcon className="h-4 w-4" />{" "}
            {autoOn ? t("cont.deploy.redeployNow") : t("cont.deploy.deployFromGithub")}
          </>
        )}
      </button>
      {!autoOn && <p className="text-xs text-white/40">{t("cont.deploy.autoHint")}</p>}
    </div>
  );
}

// ----------------------------- History -----------------------------

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(t: (k: string) => string, source: string): string {
  if (source === "auto") return t("cont.hist.srcAuto");
  if (source === "github") return t("cont.hist.srcGithub");
  if (source === "zip") return t("cont.hist.srcZip");
  return source;
}

function HistoryTab({ id }: { id: string }) {
  const { t } = useLang();
  const { data, loading, error } = useQuery<DeployItem[]>(`containers/${id}/deploys`, {
    refreshInterval: 8000,
  });

  if (loading && !data)
    return (
      <FadeIn className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </FadeIn>
    );

  if (error) return <p className="text-sm text-red-300">{t("cont.error")}</p>;

  if (!data || data.length === 0)
    return (
      <FadeIn>
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <History className="mx-auto h-6 w-6 text-white/30" />
          <p className="mt-2 text-sm text-white/50">{t("cont.hist.empty")}</p>
        </div>
      </FadeIn>
    );

  return (
    <FadeIn className="space-y-2">
      {data.map((d) => (
        <DeployRow key={d.id} d={d} t={t} />
      ))}
    </FadeIn>
  );
}

function DeployRow({ d, t }: { d: DeployItem; t: (k: string) => string }) {
  const ok = d.status === "success";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {ok ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : (
            <XCircle className="h-5 w-5 text-red-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                d.source === "auto"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-white/10 text-white/70"
              }`}
            >
              {d.source === "auto" && <Zap className="mr-1 h-3 w-3" />}
              {sourceLabel(t, d.source)}
            </span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
              }`}
            >
              {ok ? t("cont.hist.ok") : t("cont.hist.failed")}
            </span>
            <span className="text-xs text-white/40">{fmtDateTime(d.created_at)}</span>
          </div>

          {(d.repo || d.git_ref || d.commit) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/55">
              {d.repo && (
                <span className="inline-flex items-center gap-1 truncate">
                  <GithubIcon className="h-3 w-3 shrink-0" /> {d.repo}
                </span>
              )}
              {d.git_ref && (
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3 shrink-0" /> {d.git_ref}
                </span>
              )}
              {d.commit && <span className="text-white/40">#{d.commit.slice(0, 7)}</span>}
            </div>
          )}

          <p className="mt-1 text-xs text-white/45">
            {t("cont.hist.by")} <span className="text-white/65">{d.user_name}</span>
          </p>

          {!ok && d.error && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2.5 font-mono text-[11px] text-red-200/80">
              {d.error}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------- Domain -----------------------------

function DomainTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const { data, loading } = useQuery<DomainStatus>(`containers/${id}/domain`);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const fromGithub = !!c.container?.github_repo;

  const target = data?.target_ip ?? "";
  const domain = data?.domain ?? null;
  const verified = data?.verified ?? false;

  const save = async () => {
    const d = input.trim().toLowerCase();
    if (!d || busy) return;
    setBusy(true);
    try {
      await api(`containers/${id}/domain`, { method: "PUT", json: { domain: d } });
      await mutate(`containers/${id}/domain`);
      await mutate(`containers/${id}`);
      setInput("");
      toast(t("cont.domain.saved"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`containers/${id}/domain`, { method: "DELETE" });
      await mutate(`containers/${id}/domain`);
      await mutate(`containers/${id}`);
      toast(t("cont.domain.removed"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    // Re-submit the same domain to re-run DNS verification.
    if (!domain) return;
    setBusy(true);
    try {
      await api(`containers/${id}/domain`, { method: "PUT", json: { domain } });
      await mutate(`containers/${id}/domain`);
      toast(t("cont.domain.rechecked"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const copyTarget = () => {
    navigator.clipboard?.writeText(target);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading && !data) return <Skeleton className="h-56 rounded-2xl" />;

  return (
    <FadeIn className="space-y-4">
      {!domain ? (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center gap-2.5">
              <Globe className="h-4 w-4 text-white/60" />
              <p className="text-sm font-medium">{t("cont.domain.title")}</p>
            </div>
            <p className="mt-1 text-sm text-white/50">{t("cont.domain.desc")}</p>
            <label className="mt-4 flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("cont.domain.yourDomain")}</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="app.seudominio.com"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
              />
            </label>
            <button
              onClick={save}
              disabled={busy || !input.trim()}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              {t("cont.domain.add")}
            </button>
          </div>
          <DnsInstructions target={target} onCopy={copyTarget} copied={copied} t={t} />
        </>
      ) : (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={`https://${domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 truncate text-base font-semibold text-sky-300 hover:underline"
                >
                  {domain} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
                <div className="mt-1.5">
                  {verified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> {t("cont.domain.verified")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      <Loader2 className="h-3 w-3" /> {t("cont.domain.pending")}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={remove}
                disabled={busy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/25 px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("cont.domain.remove")}
              </button>
            </div>
            {!verified && (
              <button
                onClick={recheck}
                disabled={busy}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t("cont.domain.recheck")}
              </button>
            )}
          </div>
          {!verified && <DnsInstructions target={target} onCopy={copyTarget} copied={copied} t={t} />}
        </>
      )}

      {fromGithub && <p className="text-xs text-white/40">{t("cont.domain.githubNote")}</p>}
    </FadeIn>
  );
}

function DnsInstructions({
  target,
  onCopy,
  copied,
  t,
}: {
  target: string;
  onCopy: () => void;
  copied: boolean;
  t: (k: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-medium">{t("cont.domain.dns.title")}</p>
      <p className="mt-1 text-sm text-white/50">{t("cont.domain.dns.desc")}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-white/45">
              <th className="px-4 py-2 font-medium">{t("cont.domain.dns.type")}</th>
              <th className="px-4 py-2 font-medium">{t("cont.domain.dns.name")}</th>
              <th className="px-4 py-2 font-medium">{t("cont.domain.dns.value")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-white/10 font-mono text-xs">
              <td className="px-4 py-3 text-white/70">A</td>
              <td className="px-4 py-3 text-white/70">@ / www</td>
              <td className="px-4 py-3">
                <button onClick={onCopy} className="inline-flex items-center gap-2 text-sky-300 hover:underline">
                  {target}
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-white/40">{t("cont.domain.dns.hint")}</p>
    </div>
  );
}

/** Upload/list/delete plugin (Bukkit) or mod (Fabric/Forge) .jar files. */
function McPluginsTab({ id, dir }: { id: string; dir: "plugins" | "mods" }) {
  const { t } = useLang();
  const toast = useToast();
  const { data, loading } = useQuery<FilesResult>(`containers/${id}/files?path=${dir}`);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const jars = (data?.entries ?? []).filter(
    (e) => e.type === "file" && e.name.toLowerCase().endsWith(".jar"),
  );

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".jar")) {
      toast(t("cont.mc.plugins.jarOnly"));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`containers/${id}/plugin`, { method: "POST", body: fd });
      await mutate(`containers/${id}/files?path=${dir}`);
      toast(t("cont.mc.plugins.uploaded"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (name: string) => {
    try {
      await api(`containers/${id}/plugin/delete`, { method: "POST", json: { name } });
      await mutate(`containers/${id}/files?path=${dir}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  const restart = async () => {
    try {
      await api(`containers/${id}/action`, { method: "POST", json: { action: "restart" } });
      toast(t("cont.mc.plugins.restarting"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  return (
    <FadeIn className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">
          {dir === "mods" ? t("cont.mc.plugins.modsTitle") : t("cont.mc.plugins.title")}
        </p>
        <p className="mt-1 text-sm text-white/50">{t("cont.mc.plugins.desc")}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".jar"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {t("cont.mc.plugins.upload")}
        </button>
      </div>

      {loading && !data ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : jars.length ? (
        <div className="space-y-2">
          {jars.map((j) => (
            <div
              key={j.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <span className="inline-flex items-center gap-2 truncate text-sm">
                <FileText className="h-4 w-4 shrink-0 text-white/40" /> {j.name}
              </span>
              <button
                onClick={() => remove(j.name)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/25 px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("cont.action.delete")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/40">{t("cont.mc.plugins.empty")}</p>
      )}

      <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
        <span className="text-sm text-amber-200/80">{t("cont.mc.plugins.restartHint")}</span>
        <button
          onClick={restart}
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium transition-colors hover:bg-white/10"
        >
          <RotateCw className="h-3.5 w-3.5" /> {t("cont.action.restart")}
        </button>
      </div>
    </FadeIn>
  );
}

type McBackup = { name: string; size: number; created: number };

function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return `${n} B`;
}

/** Create/list/restore/delete/download world snapshots + import a world archive. */
function McBackupsTab({ id }: { id: string }) {
  const { t } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading } = useQuery<{ backups: McBackup[] }>(`containers/${id}/backups`);
  const [busy, setBusy] = useState(false);
  const worldRef = useRef<HTMLInputElement | null>(null);
  const backups = data?.backups ?? [];

  const create = async () => {
    setBusy(true);
    try {
      await api(`containers/${id}/backup`, { method: "POST" });
      await mutate(`containers/${id}/backups`);
      toast(t("cont.mc.backups.created"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string) => {
    if (
      !(await confirm({
        title: t("cont.mc.backups.restoreTitle"),
        message: t("cont.mc.backups.restoreMsg"),
        confirmLabel: t("cont.mc.backups.restore"),
        danger: true,
      }))
    )
      return;
    try {
      await api(`containers/${id}/backup/restore`, { method: "POST", json: { name } });
      toast(t("cont.mc.backups.restored"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  const remove = async (name: string) => {
    try {
      await api(`containers/${id}/backup/delete`, { method: "POST", json: { name } });
      await mutate(`containers/${id}/backups`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    }
  };

  const importWorld = async (file: File) => {
    if (
      !(await confirm({
        title: t("cont.mc.backups.worldTitle"),
        message: t("cont.mc.backups.worldMsg"),
        confirmLabel: t("cont.mc.backups.import"),
        danger: true,
      }))
    ) {
      if (worldRef.current) worldRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`containers/${id}/world`, { method: "POST", body: fd });
      toast(t("cont.mc.backups.imported"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setBusy(false);
      if (worldRef.current) worldRef.current.value = "";
    }
  };

  const icon = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:bg-white/10";

  return (
    <FadeIn className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={create}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("cont.mc.backups.create")}
        </button>
        <input
          ref={worldRef}
          type="file"
          accept=".zip,.tar.gz,.tgz"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && importWorld(e.target.files[0])}
        />
        <button
          onClick={() => worldRef.current?.click()}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" /> {t("cont.mc.backups.importWorld")}
        </button>
      </div>
      <p className="text-xs text-white/40">{t("cont.mc.backups.desc")}</p>

      {loading && !data ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : backups.length ? (
        <div className="space-y-2">
          {backups.map((b) => (
            <div
              key={b.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{new Date(b.created).toLocaleString()}</p>
                <p className="text-xs text-white/40">{fmtBytes(b.size)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/api/containers/${id}/backup/download?name=${encodeURIComponent(b.name)}`}
                  className={icon}
                  title={t("cont.mc.backups.download")}
                >
                  <Download className="h-4 w-4 text-white/70" />
                </a>
                <button
                  onClick={() => restore(b.name)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium transition-colors hover:bg-white/10"
                >
                  <RotateCw className="h-3.5 w-3.5" /> {t("cont.mc.backups.restore")}
                </button>
                <button
                  onClick={() => remove(b.name)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/25 text-red-300 transition-colors hover:bg-red-500/10"
                  title={t("cont.action.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/40">{t("cont.mc.backups.empty")}</p>
      )}
    </FadeIn>
  );
}

function parseProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

/** Server config (MOTD/difficulty/gamemode/PvP/whitelist) + change version/software. */
function McSettingsTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: file } = useQuery<FileContent>(`containers/${id}/file?path=server.properties`);

  const [name, setName] = useState(c.name);
  const [motd, setMotd] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [gamemode, setGamemode] = useState("survival");
  const [pvp, setPvp] = useState(true);
  const [whitelist, setWhitelist] = useState(false);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => {
    if (!file) return;
    const p = parseProps(file.content ?? "");
    setMotd(p["motd"] ?? "");
    setDifficulty(p["difficulty"] ?? "normal");
    setGamemode(p["gamemode"] ?? "survival");
    setPvp((p["pvp"] ?? "true") !== "false");
    setWhitelist((p["white-list"] ?? "false") === "true");
    setOnline((p["online-mode"] ?? "true") !== "false");
  }, [file]);

  const save = async () => {
    setSaving(true);
    try {
      const nm = name.trim();
      if (nm && nm !== c.name) {
        await api(`containers/${id}/name`, { method: "PUT", json: { name: nm } });
      }
      await api(`containers/${id}/settings`, {
        method: "PUT",
        json: {
          props: {
            motd,
            difficulty,
            gamemode,
            pvp: String(pvp),
            "white-list": String(whitelist),
            "enforce-whitelist": String(whitelist),
            "online-mode": String(online),
          },
        },
      });
      await mutate(`containers/${id}`);
      toast(t("cont.mc.settings.saved"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setSaving(false);
    }
  };

  // Icon: live preview of the current server-icon (or the freshly-picked file),
  // with the upload folded into clicking the thumbnail.
  const iconRef = useRef<HTMLInputElement | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconVer, setIconVer] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [iconMissing, setIconMissing] = useState(false);
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked); }, [picked]);

  const onPickIcon = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".png")) {
      toast(t("cont.mc.settings.iconPng"));
      return;
    }
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setIconMissing(false);
    uploadIcon(f);
  };
  const uploadIcon = async (f: File) => {
    setIconBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api(`containers/${id}/icon`, { method: "POST", body: fd });
      setIconVer((v) => v + 1);
      toast(t("cont.mc.settings.iconSet"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setIconBusy(false);
      if (iconRef.current) iconRef.current.value = "";
    }
  };
  const iconSrc = picked ?? (iconMissing ? null : `/api/containers/${id}/icon?v=${iconVer}`);

  // --- RAM change (recreates the container; world preserved) ---
  const { data: ramBal } = useQuery<RamBalance>("containers/ram");
  const curRam = c.container?.ram_mb ?? 1024;
  const [newRam, setNewRam] = useState(curRam);
  const [ramBusy, setRamBusy] = useState(false);
  useEffect(() => setNewRam(curRam), [curRam]);
  const maxForThis = (ramBal?.available_mb ?? 0) + curRam;
  const ramOptions = [1024, 2048, 4096, 6144, 8192].filter((s) => s <= maxForThis || s === curRam);
  const applyRam = async () => {
    if (ramBusy || newRam === curRam) return;
    if (
      !(await confirm({
        title: t("cont.mc.settings.ramTitle"),
        message: t("cont.mc.settings.ramMsg"),
        confirmLabel: t("cont.mc.settings.apply"),
      }))
    )
      return;
    setRamBusy(true);
    try {
      await api(`containers/${id}/ram`, { method: "PUT", json: { ram_mb: newRam } });
      await mutate(`containers/${id}`);
      await mutate("containers/ram");
      toast(t("cont.mc.settings.reprovisioning"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setRamBusy(false);
    }
  };

  const [software, setSoftware] = useState(c.container?.software ?? "PAPER");
  const [version, setVersion] = useState(c.container?.version ?? "LATEST");
  const [applying, setApplying] = useState(false);
  const apply = async () => {
    if (
      !(await confirm({
        title: t("cont.mc.settings.changeTitle"),
        message: t("cont.mc.settings.changeMsg"),
        confirmLabel: t("cont.mc.settings.apply"),
        danger: true,
      }))
    )
      return;
    setApplying(true);
    try {
      await api(`containers/${id}/reprovision`, { method: "POST", json: { software, version } });
      await mutate(`containers/${id}`);
      toast(t("cont.mc.settings.reprovisioning"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setApplying(false);
    }
  };

  const sel = "h-11 px-4 text-sm";
  const Toggle = ({ v, on, label }: { v: boolean; on: (b: boolean) => void; label: string }) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <span className="text-sm text-white/70">{label}</span>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="h-4 w-4 accent-white" />
    </label>
  );

  return (
    <FadeIn className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">{t("cont.mc.settings.identity")}</p>

        <div className="flex gap-4">
          {/* Icon preview — click to change */}
          <div className="shrink-0">
            <input
              ref={iconRef}
              type="file"
              accept=".png,image/png"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPickIcon(e.target.files[0])}
            />
            <button
              type="button"
              onClick={() => iconRef.current?.click()}
              disabled={iconBusy}
              title={t("cont.mc.settings.iconUpload")}
              className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-colors hover:border-white/30 disabled:opacity-60"
            >
              {iconSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={iconSrc}
                  alt=""
                  width={64}
                  height={64}
                  className="h-16 w-16 [image-rendering:pixelated]"
                  onError={() => {
                    if (!picked) setIconMissing(true);
                  }}
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-white/30">
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-[10px]">{t("cont.mc.settings.iconNone")}</span>
                </div>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                {iconBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              </span>
            </button>
            <p className="mt-1.5 w-20 text-center text-[10px] leading-tight text-white/35">
              {t("cont.mc.settings.iconHint")}
            </p>
          </div>

          {/* Name + description */}
          <div className="flex flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-white/70">{t("cont.mc.settings.name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-white/70">{t("cont.mc.settings.motd")}</span>
              <input
                value={motd}
                onChange={(e) => setMotd(e.target.value)}
                maxLength={200}
                placeholder={t("cont.mc.settings.motdHint")}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/30 focus:border-white/30"
              />
            </label>
          </div>
        </div>

        <div className="h-px bg-white/10" />

        <p className="text-sm font-medium">{t("cont.mc.settings.gameplay")}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.mc.settings.difficulty")}</span>
            <Select
              value={difficulty}
              onChange={setDifficulty}
              className={sel}
              options={["peaceful", "easy", "normal", "hard"].map((v) => ({ value: v, label: v }))}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.mc.settings.gamemode")}</span>
            <Select
              value={gamemode}
              onChange={setGamemode}
              className={sel}
              options={["survival", "creative", "adventure", "spectator"].map((v) => ({ value: v, label: v }))}
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle v={pvp} on={setPvp} label="PvP" />
          <Toggle v={whitelist} on={setWhitelist} label={t("cont.mc.settings.whitelist")} />
          <Toggle v={online} on={setOnline} label={t("cont.mc.settings.online")} />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-white/40">{t("cont.mc.settings.restartNote")}</p>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("cont.mc.settings.save")}
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">{t("cont.mc.settings.ramTitle")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={String(newRam)}
            onChange={(v) => setNewRam(Number(v))}
            className={sel}
            options={ramOptions.map((s) => ({
              value: String(s),
              label: `${s / 1024} GB${s === curRam ? ` · ${t("cont.mc.settings.ramCurrent")}` : ""}`,
            }))}
          />
          <button
            onClick={applyRam}
            disabled={ramBusy || newRam === curRam}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {ramBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            {t("cont.mc.settings.apply")}
          </button>
        </div>
        <p className="text-xs text-white/40">
          {t("cont.mc.settings.ramHint")}
          {ramBal ? ` · ${t("cont.ram.available")}: ${ramBal.available_mb} MB` : ""}
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">{t("cont.mc.settings.changeTitle")}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.mc.software")}</span>
            <Select
              value={software}
              onChange={setSoftware}
              className={sel}
              options={["VANILLA", "PAPER", "PURPUR", "FABRIC", "FORGE"].map((s) => ({
                value: s,
                label: s.charAt(0) + s.slice(1).toLowerCase(),
              }))}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.mc.version")}</span>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="LATEST"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-amber-200/70">{t("cont.mc.settings.changeWarn")}</p>
          <button
            onClick={apply}
            disabled={applying}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            {t("cont.mc.settings.apply")}
          </button>
        </div>
      </div>
    </FadeIn>
  );
}

// ----------------------------- Files -----------------------------

function FilesTab({ id, c }: { id: string; c: Server }) {
  const { t } = useLang();
  const toast = useToast();
  const fromGithub = !!c.container?.github_repo;

  const [dir, setDir] = useState("");
  const [data, setData] = useState<FilesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [orig, setOrig] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDir = async (p: string) => {
    setLoading(true);
    setErr("");
    try {
      const r = await api<FilesResult>(`containers/${id}/files?path=${encodeURIComponent(p)}`);
      setData(r);
      setDir(r.path || "");
    } catch (e) {
      setErr(e instanceof ApiError ? firstLine(e.message) : t("cont.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const child = (name: string) => (dir ? `${dir}/${name}` : name);
  const enterDir = (name: string) => {
    setFile(null);
    loadDir(child(name));
  };
  const parent = () => {
    setFile(null);
    loadDir(dir.split("/").slice(0, -1).join("/"));
  };

  const openFile = async (path: string) => {
    setFileLoading(true);
    try {
      const r = await api<FileContent>(`containers/${id}/file?path=${encodeURIComponent(path)}`);
      setContent(r.content);
      setOrig(r.content);
      setFile(path);
    } catch (e) {
      toast(e instanceof ApiError ? firstLine(e.message) : t("cont.error"));
    } finally {
      setFileLoading(false);
    }
  };

  const save = async () => {
    if (file === null) return;
    setSaving(true);
    try {
      await api(`containers/${id}/file`, { method: "PUT", json: { path: file, content } });
      setOrig(content);
      toast(t("cont.files.saved"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? firstLine(e.message) : t("cont.files.saveErr"));
    } finally {
      setSaving(false);
    }
  };

  const roBanner = fromGithub ? (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5 text-sm">
      <GithubIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p className="text-amber-200/90">{t("cont.files.roGithub")}</p>
    </div>
  ) : null;

  // ---- editor view ----
  if (file !== null) {
    const dirty = content !== orig;
    return (
      <FadeIn className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFile(null)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("cont.files.back")}
          </button>
          <span className="truncate font-mono text-xs text-white/60">/{file}</span>
        </div>
        {roBanner}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={fromGithub}
          spellCheck={false}
          className="h-[440px] w-full resize-none rounded-2xl border border-white/10 bg-black p-4 font-mono text-[13px] leading-relaxed text-white/85 outline-none focus:border-white/25"
        />
        {!fromGithub && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("cont.files.save")}
            </button>
            {dirty && <span className="text-xs text-white/40">{t("cont.files.unsaved")}</span>}
          </div>
        )}
        {!fromGithub && <p className="text-xs text-white/40">{t("cont.files.restartHint")}</p>}
      </FadeIn>
    );
  }

  // ---- browser view ----
  return (
    <FadeIn className="space-y-3">
      {roBanner}
      <div className="flex items-center gap-1.5 font-mono text-xs text-white/50">
        <Folder className="h-3.5 w-3.5" />
        <span className="truncate">/{dir}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        {dir && (
          <button
            onClick={parent}
            className="flex w-full items-center gap-2 border-b border-white/5 px-4 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/5"
          >
            <ChevronRight className="h-4 w-4 rotate-180 text-white/40" /> ..
          </button>
        )}
        {loading || fileLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}
          </div>
        ) : (data?.entries ?? []).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-white/40">{t("cont.files.empty")}</p>
        ) : (
          (data?.entries ?? []).map((e) =>
            e.type === "dir" ? (
              <button
                key={e.name}
                onClick={() => !e.heavy && enterDir(e.name)}
                disabled={e.heavy}
                className={`flex w-full items-center gap-2.5 border-b border-white/5 px-4 py-2.5 text-left text-sm transition-colors last:border-0 ${
                  e.heavy ? "cursor-not-allowed text-white/30" : "text-white/80 hover:bg-white/5"
                }`}
              >
                <Folder className={`h-4 w-4 shrink-0 ${e.heavy ? "text-white/25" : "text-sky-300/80"}`} />
                <span className="truncate">{e.name}/</span>
                {e.heavy && <span className="ml-auto text-[11px] text-white/30">{t("cont.files.heavy")}</span>}
              </button>
            ) : (
              <button
                key={e.name}
                onClick={() => openFile(child(e.name))}
                className="flex w-full items-center gap-2.5 border-b border-white/5 px-4 py-2.5 text-left text-sm text-white/80 transition-colors last:border-0 hover:bg-white/5"
              >
                <FileText className="h-4 w-4 shrink-0 text-white/40" />
                <span className="truncate">{e.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-white/30">{fmtSize(e.size)}</span>
              </button>
            ),
          )
        )}
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
    </FadeIn>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ----------------------------- Logs -----------------------------

function LogsTab({ id }: { id: string }) {
  const { t } = useLang();
  const [logs, setLogs] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await api<{ logs: string }>(`containers/${id}/logs?tail=300`);
      setLogs(r.logs || "");
    } catch {
      /* ignore transient */
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [logs]);

  return (
    <FadeIn className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={load}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("cont.logs.refresh")}
        </button>
      </div>
      <div className="h-[440px] overflow-y-auto rounded-2xl border border-white/10 bg-black p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-white/80">
        {logs || <span className="text-white/35">{t("cont.logs.empty")}</span>}
        <div ref={endRef} />
      </div>
    </FadeIn>
  );
}

// ----------------------------- Env -----------------------------

function EnvTab({ id }: { id: string }) {
  const { t } = useLang();
  const toast = useToast();
  const { data: env } = useQuery<Record<string, string>>(`containers/${id}/env`);
  const [rows, setRows] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (env) setRows(Object.entries(env));
  }, [env]);

  const setRow = (i: number, k: string, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? [k, v] : row)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of rows) if (k.trim()) obj[k.trim()] = v;
      await api(`containers/${id}/env`, { method: "PUT", json: { env: obj } });
      toast(t("cont.env.saved"), "success");
      await mutate(`containers/${id}/env`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.env.err"));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 font-mono text-sm outline-none focus:border-white/30";

  return (
    <FadeIn className="space-y-3">
      <p className="text-sm text-white/55">{t("cont.env.hint")}</p>
      <div className="space-y-2">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={k}
              onChange={(e) => setRow(i, e.target.value, v)}
              placeholder={t("cont.env.key")}
              className={`${inputCls} sm:w-56`}
            />
            <span className="text-white/30">=</span>
            <input
              value={v}
              onChange={(e) => setRow(i, k, e.target.value)}
              placeholder={t("cont.env.value")}
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => removeRow(i)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-white/40 transition-colors hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setRows((r) => [...r, ["", ""]])}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-white/70 transition-colors hover:bg-white/5"
        >
          <Plus className="h-4 w-4" /> {t("cont.env.add")}
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {t("cont.env.save")}
        </button>
      </div>
    </FadeIn>
  );
}

// ----------------------------- Skeleton -----------------------------

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
