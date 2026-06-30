"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Power, RotateCw, Play, Eye, EyeOff, Copy, Check } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { useSubscription } from "@/hooks/use-subscription";
import ServerStateBadge from "@/components/servers/ServerStateBadge";
import VmConsole from "@/components/servers/VmConsole";
import VmVnc from "@/components/servers/VmVnc";
import VmFiles from "@/components/servers/VmFiles";
import MetricChart, { type ChartPoint } from "@/components/servers/MetricChart";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import { useConfirm, useToast } from "@/components/FeedbackProvider";
import Select from "@/components/Select";

// OS labels that map to a provisioning template (mirror of OS_TEMPLATES).
const OS_OPTIONS = [
  "Ubuntu 24.04 LTS",
  "Ubuntu 22.04 LTS",
  "Debian 12",
  "AlmaLinux 9",
  "Rocky Linux 9",
];
import type { MetricPoint, Server, ServerState, ServerStat, DedicatedIp, PlansResponse } from "@/lib/api/types";
import { formatMoney } from "@/lib/api/types";

type Tab = "overview" | "metrics" | "files" | "vnc" | "console" | "settings";

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Full granularity so it never collapses to "0h": d/h/min/s, smallest unit last.
function fmtUptime(secs?: number): string {
  if (secs == null || secs < 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

// Live uptime: anchor on the last value the socket reported, then advance it
// with the local clock and re-render every second so it visibly ticks.
function useLiveUptime(uptime: number | undefined): number | undefined {
  const [base, setBase] = useState<{ u: number; at: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (uptime != null) setBase({ u: uptime, at: Date.now() });
  }, [uptime]);
  useEffect(() => {
    if (base == null) return;
    const h = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, [base]);
  if (base == null) return uptime;
  return base.u + Math.floor((Date.now() - base.at) / 1000);
}

function fmtGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default function ServerDetailClient({ id }: { id: string }) {
  const { t, locale } = useLang();

  const { data: server, error, loading } = useQuery<Server>(`servers/${id}`);
  const [stat, setStat] = useState<ServerStat | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [formatConfirm, setFormatConfirm] = useState(false);
  const [formatOs, setFormatOs] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Live status over the gateway socket (no refetch needed).
  useSubscription(`server:${id}`, (event, data) => {
    if (event === "stat") setStat(data as ServerStat);
  });

  // While the VM is still installing (provisioned but no IP yet), refresh so the
  // IP/SSH details appear and the banner clears without a manual reload.
  useEffect(() => {
    const installing =
      !!server?.vmid &&
      !server?.ip &&
      server?.state !== "suspended" &&
      server?.state !== "stopped" &&
      server?.state !== "error";
    if (!installing) return;
    const h = setInterval(() => mutate(`servers/${id}`), 12000);
    return () => clearInterval(h);
  }, [server?.vmid, server?.ip, server?.state, id]);

  if (loading) return <DetailSkeleton />;
  if (error || !server) return <p className="text-sm text-red-300">{t("srv.error")}</p>;

  // Prefer the live socket state when available.
  const state: ServerState = stat?.state ?? server.state;
  const provisioned = server.vmid != null;

  const power = async (action: "start" | "reboot" | "shutdown" | "stop") => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`servers/${id}/power`, { method: "POST", json: { action } });
    } catch {
      /* surfaced by live state */
    } finally {
      setBusy(false);
    }
  };

  const reinstall = async () => {
    if (busy) return;
    setBusy(true);
    setActionErr(null);
    try {
      await api(`servers/${id}/reinstall`, { method: "POST", json: { os: formatOs || undefined } });
      setFormatConfirm(false);
      void mutate(`servers/${id}`);
    } catch (err) {
      setActionErr(err instanceof ApiError ? err.message : t("srv.format.failed"));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Tab[] = ["overview", "metrics", "files", "vnc", "console", "settings"];

  return (
    <div className="space-y-6">
      <FadeIn>
        <Link
          href="/dashboard/servers"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("srv.title")}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{server.name}</h1>
            <ServerStateBadge state={state} />
          </div>
          {provisioned && (
            <div className="flex items-center gap-2">
              {state === "running" ? (
                <>
                  <button
                    onClick={() => power("reboot")}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    <RotateCw className="h-4 w-4" />
                    {t("srv.power.reboot")}
                  </button>
                  <button
                    onClick={() => power("shutdown")}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    <Power className="h-4 w-4" />
                    {t("srv.power.shutdown")}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => power("start")}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {t("srv.power.start")}
                </button>
              )}
            </div>
          )}
        </div>
      </FadeIn>

      {!provisioned && (
        <FadeIn delay={0.04} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          {t("srv.notProvisioned")}
        </FadeIn>
      )}

      {provisioned &&
        !server.ip &&
        state !== "suspended" &&
        state !== "stopped" &&
        state !== "error" && (
          <FadeIn
            delay={0.04}
            className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
            <p className="text-sm text-amber-200/90">{t("srv.provisioning")}</p>
          </FadeIn>
        )}

      <FadeIn delay={0.06} className="flex gap-1 border-b border-white/10">
        {tabs.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb
                ? "border-white text-white"
                : "border-transparent text-white/45 hover:text-white/80"
            }`}
          >
            {t(`srv.tab.${tb}`)}
          </button>
        ))}
      </FadeIn>

      {tab === "overview" && (
        <Overview server={server} stat={stat} locale={locale} />
      )}
      {tab === "metrics" && <Metrics id={id} provisioned={provisioned} />}
      {tab === "files" && <VmFiles id={id} />}
      {tab === "vnc" && <VmVnc id={id} />}
      {tab === "console" && <VmConsole id={id} />}
      {tab === "settings" && (
        <FadeIn className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
          <p className="text-sm font-semibold text-amber-300">{t("srv.format.title")}</p>
          <p className="mt-1 text-sm text-white/55">{t("srv.format.desc")}</p>
          {actionErr && <p className="mt-2 text-sm text-red-300">{actionErr}</p>}
          {formatConfirm ? (
            <>
            <div className="mt-4 flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("srv.format.osLabel")}</span>
              <Select
                value={formatOs}
                onChange={setFormatOs}
                className="h-10 px-3 text-sm sm:max-w-xs"
                options={OS_OPTIONS.map((o) => ({ value: o, label: o }))}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-white/70">{t("srv.format.confirm")}</span>
              <button
                onClick={() => setFormatConfirm(false)}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                {t("srv.format.cancel")}
              </button>
              <button
                onClick={reinstall}
                disabled={busy}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
              >
                <RotateCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                {busy ? t("srv.format.formatting") : t("srv.format.action")}
              </button>
            </div>
            </>
          ) : (
            <button
              onClick={() => {
                setActionErr(null);
                setFormatOs(server.os);
                setFormatConfirm(true);
              }}
              disabled={!provisioned || busy}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              <RotateCw className="h-4 w-4" />
              {t("srv.format.action")}
            </button>
          )}
        </FadeIn>
      )}
    </div>
  );
}

function Overview({
  server,
  stat,
  locale,
}: {
  server: Server;
  stat: ServerStat | null;
  locale: string;
}) {
  const { t } = useLang();
  const liveUptime = useLiveUptime(stat?.uptime);
  const ramPct =
    stat?.mem && stat?.max_mem ? Math.round((stat.mem / stat.max_mem) * 100) : null;
  const { data: disk } = useQuery<{ used: number; total: number }>(
    server.vmid != null ? `servers/${server.id}/disk` : null,
    { refreshInterval: 30000 },
  );
  const diskPct = disk && disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : null;

  const specs = [
    { label: t("srv.specs.vcpu"), value: `${server.specs.vcpu}` },
    { label: t("srv.specs.ram"), value: `${server.specs.ram_gb} GB` },
    { label: t("srv.specs.disk"), value: `${server.specs.disk_gb} GB` },
    { label: t("srv.field.uptime"), value: fmtUptime(liveUptime) },
  ];
  const info = [
    { label: t("srv.field.os"), value: server.os },
    { label: t("srv.field.ip"), value: server.ssh_host ?? "—" },
    { label: t("srv.field.plan"), value: server.plan.toUpperCase() },
    { label: t("srv.field.vmid"), value: server.vmid != null ? `#${server.vmid}` : "—" },
    { label: t("srv.field.created"), value: fmtDate(server.created_at, locale) },
    {
      label: t("srv.field.expires"),
      value: server.expires_at ? fmtDate(server.expires_at, locale) : t("srv.field.lifetime"),
    },
  ];

  return (
    <FadeIn className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {specs.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-xs text-white/45">{s.label}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight">{s.value}</p>
          </div>
        ))}
      </div>

      {server.vmid != null && <AccessCard server={server} id={server.id} />}

      {server.vmid != null && <DedicatedIpCard id={server.id} />}

      {server.vmid != null && <UpgradeCard server={server} />}

      {ramPct != null && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/55">{t("srv.usage.ram")}</span>
            <span className="font-medium">
              {fmtGB(stat?.mem ?? 0)} / {fmtGB(stat?.max_mem ?? 0)} · {ramPct}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-all"
              style={{ width: `${ramPct}%` }}
            />
          </div>
        </div>
      )}

      {diskPct != null && disk && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/55">{t("srv.usage.disk")}</span>
            <span className="font-medium">
              {fmtGB(disk.used)} / {fmtGB(disk.total)} · {diskPct}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-600 transition-all"
              style={{ width: `${diskPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:grid-cols-2">
        {info.map((i) => (
          <div key={i.label} className="flex items-center justify-between bg-black/40 px-4 py-3 text-sm">
            <span className="text-white/45">{i.label}</span>
            <span className="font-medium">{i.value}</span>
          </div>
        ))}
      </div>
    </FadeIn>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition-colors hover:text-white"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function UpgradeCard({ server }: { server: Server }) {
  const { t } = useLang();
  const router = useRouter();
  const { data: plans } = useQuery<PlansResponse>("billing/plans");
  const rates = plans?.custom;
  const [ram, setRam] = useState(0);
  const [disk, setDisk] = useState(0);
  const [method, setMethod] = useState<"crypto" | "pix" | "stripe">("crypto");
  const [busy, setBusy] = useState(false);

  const price = rates ? ram * rates.ram_cents + disk * rates.disk_cents : 0;
  const input =
    "h-10 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30";

  const buy = async () => {
    if (busy || (ram <= 0 && disk <= 0)) return;
    setBusy(true);
    try {
      const inv = await api<{ id: string }>(`servers/${server.id}/upgrade`, {
        method: "POST",
        json: { add_ram_gb: ram, add_disk_gb: disk, method },
      });
      router.push(`/dashboard/billing/${inv.id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-medium">{t("srv.upgrade.title")}</p>
      <p className="mt-1 text-sm text-white/55">{t("srv.upgrade.desc")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">{t("srv.upgrade.addRam")}</span>
          <input
            type="number"
            min={0}
            max={256}
            value={ram}
            onChange={(e) => setRam(Math.max(0, Number(e.target.value)))}
            className={input}
          />
          <span className="text-[11px] text-white/35">
            {t("srv.upgrade.total")}: {server.specs.ram_gb + ram} GB
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/55">{t("srv.upgrade.addDisk")}</span>
          <input
            type="number"
            min={0}
            max={4000}
            value={disk}
            onChange={(e) => setDisk(Math.max(0, Number(e.target.value)))}
            className={input}
          />
          <span className="text-[11px] text-white/35">
            {t("srv.upgrade.total")}: {server.specs.disk_gb + disk} GB
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-2 sm:w-64">
          {(["crypto", "pix", "stripe"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                method === m
                  ? "border-white bg-white/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]"
              }`}
            >
              {t(`bill.method.${m === "stripe" ? "card" : m}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">
            <span className="text-white/45">+ </span>
            <span className="font-semibold">{formatMoney(price)}</span>
            <span className="text-xs text-white/45">{t("bill.perMonth")}</span>
          </span>
          <button
            type="button"
            onClick={buy}
            disabled={busy || price <= 0}
            className="inline-flex h-10 items-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? "…" : t("srv.upgrade.buy")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DedicatedIpCard({ id }: { id: string }) {
  const { t } = useLang();
  const router = useRouter();
  const { data: dip } = useQuery<DedicatedIp | null>(`servers/${id}/dedicated-ip`);
  const [method, setMethod] = useState<"crypto" | "pix" | "stripe">("crypto");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const inv = await api<{ id: string }>(`servers/${id}/dedicated-ip`, {
        method: "POST",
        json: { method },
      });
      router.push(`/dashboard/billing/${inv.id}`);
    } catch {
      setBusy(false);
    }
  };

  if (dip?.status === "active" && dip.ip_address) {
    return (
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
        <p className="text-sm font-medium">{t("srv.dip.title")}</p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="font-mono text-sm">{dip.ip_address}</span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(dip.ip_address!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-white/50 transition-colors hover:text-white"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
    );
  }

  if (dip?.status === "pending_assignment") {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5">
        <p className="text-sm font-medium">{t("srv.dip.title")}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-amber-200/90">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          {t("srv.dip.routing")}
        </p>
      </div>
    );
  }

  if (dip?.status === "pending_payment") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-medium">{t("srv.dip.title")}</p>
        <p className="mt-1 text-sm text-white/55">{t("srv.dip.pendingPay")}</p>
        <Link
          href="/dashboard/billing"
          className="mt-3 inline-flex h-9 items-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          {t("srv.dip.goPay")}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("srv.dip.title")}</p>
          <p className="mt-1 text-sm text-white/55">{t("srv.dip.desc")}</p>
        </div>
        <span className="shrink-0 text-right">
          <span className="text-2xl font-semibold tracking-tight">R$ 25</span>
          <span className="text-xs text-white/45">{t("bill.perMonth")}</span>
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid flex-1 grid-cols-3 gap-2">
          {(["crypto", "pix", "stripe"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                method === m
                  ? "border-white bg-white/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]"
              }`}
            >
              {t(`bill.method.${m === "stripe" ? "card" : m}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={buy}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? "…" : t("srv.dip.buy")}
        </button>
      </div>
    </div>
  );
}

function AccessCard({ server, id }: { server: Server; id: string }) {
  const { t } = useLang();
  const [show, setShow] = useState(false);
  const [resetting, setResetting] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const user = server.root_user ?? "root";
  const pass = server.root_password ?? "";
  // Prefer the public relay endpoint; fall back to the internal IP.
  const host = server.ssh_host ?? server.ip ?? "";
  const port = server.ssh_port ?? 22;
  const sshCmd = host ? `ssh ${user}@${host}${port !== 22 ? ` -p ${port}` : ""}` : "";

  const reset = async () => {
    if (resetting) return;
    if (!(await confirm({ title: t("srv.access.resetConfirm"), danger: true }))) return;
    setResetting(true);
    try {
      await api(`servers/${id}/root-password`, { method: "POST", json: {} });
      await mutate(`servers/${id}`);
      setShow(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("srv.console.unavailable"));
    } finally {
      setResetting(false);
    }
  };

  const rowCls =
    "flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2";
  const valCls = "min-w-0 flex-1 truncate font-mono text-sm";

  return (
    <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-semibold">{t("srv.access.title")}</p>
      <p className="mt-1 text-sm text-white/55">{t("srv.access.desc")}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/45">{t("srv.access.user")}</span>
          <div className={rowCls}>
            <span className={valCls}>{user}</span>
            <CopyButton value={user} />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/45">{t("srv.access.host")}</span>
          <div className={rowCls}>
            <span className={valCls}>{host || "—"}</span>
            {host && <CopyButton value={host} />}
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/45">{t("srv.access.port")}</span>
          <div className={rowCls}>
            <span className={valCls}>{port}</span>
            <CopyButton value={String(port)} />
          </div>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-white/45">{t("srv.access.password")}</span>
          <div className={rowCls}>
            <span className={valCls}>
              {pass ? (show ? pass : "•".repeat(Math.min(pass.length, 20))) : "—"}
            </span>
            {pass && (
              <>
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? t("srv.access.hide") : t("srv.access.reveal")}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition-colors hover:text-white"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <CopyButton value={pass} />
              </>
            )}
          </div>
        </label>

        {sshCmd && (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-white/45">SSH</span>
            <div className={rowCls}>
              <span className={valCls}>{sshCmd}</span>
              <CopyButton value={sshCmd} />
            </div>
          </label>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-amber-200/70">{t("srv.access.warn")}</p>
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RotateCw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
          {resetting ? t("srv.access.resetting") : t("srv.access.reset")}
        </button>
      </div>
    </FadeIn>
  );
}

const pct = (v: number) => `${v.toFixed(1)}%`;
function rate(v: number): string {
  if (v < 1024) return `${v.toFixed(0)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB/s`;
}

function Metrics({ id, provisioned }: { id: string; provisioned: boolean }) {
  const { t } = useLang();
  // Refresh metrics every 30s while the tab is open (live-ish without polling spam).
  const { data: points, error, loading } = useQuery<MetricPoint[]>(
    provisioned ? `servers/${id}/metrics` : null,
    { refreshInterval: 30000 },
  );

  if (!provisioned || error || (points && points.length === 0)) {
    return <p className="text-sm text-white/45">{t("srv.metrics.empty")}</p>;
  }
  if (loading || !points) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-16 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
            <div className="mt-2 h-7 w-24 animate-pulse rounded bg-white/10" />
            <div className="mt-3 h-[120px] w-full animate-pulse rounded-lg bg-white/[0.06]" />
          </div>
        ))}
      </div>
    );
  }

  const series = (pick: (p: MetricPoint) => number): ChartPoint[] =>
    points.map((p) => ({ t: p.time, v: pick(p) }));

  const cards = [
    { key: "cpu", label: t("srv.metrics.cpu"), color: "#38bdf8", points: series((p) => Math.min(100, p.cpu * 100)), fmt: pct },
    { key: "ram", label: t("srv.metrics.ram"), color: "#a78bfa", points: series((p) => (p.maxmem ? (p.mem / p.maxmem) * 100 : 0)), fmt: pct },
    { key: "net", label: t("srv.metrics.net"), color: "#34d399", points: series((p) => p.netin + p.netout), fmt: rate },
    { key: "disk", label: t("srv.metrics.disk"), color: "#fbbf24", points: series((p) => p.diskread + p.diskwrite), fmt: rate },
  ];

  return (
    <FadeIn className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((c) => (
        <MetricChart key={c.key} label={c.label} points={c.points} color={c.color} fmt={c.fmt} />
      ))}
    </FadeIn>
  );
}

