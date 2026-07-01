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
} from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { useToast, useConfirm } from "@/components/FeedbackProvider";
import ContainerStatusBadge from "@/components/containers/ContainerStatusBadge";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type { Server, ContainerStats, DeployResult } from "@/lib/api/types";

type Tab = "overview" | "deploy" | "logs" | "env";

export default function ContainerDetailClient({ id }: { id: string }) {
  const { t } = useLang();
  const { data: c, error, loading } = useQuery<Server>(`containers/${id}`, {
    refreshInterval: 6000,
  });
  const [tab, setTab] = useState<Tab>("overview");

  if (loading) return <DetailSkeleton />;
  if (error || !c) return <p className="text-sm text-red-300">{t("cont.error")}</p>;

  const tabs: Tab[] = ["overview", "deploy", "logs", "env"];

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

      {tab === "overview" && <Overview id={id} c={c} />}
      {tab === "deploy" && <DeployTab id={id} />}
      {tab === "logs" && <LogsTab id={id} />}
      {tab === "env" && <EnvTab id={id} />}
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
        <Stat label={t("cont.ov.type")} value={c.container?.container_type === "site" ? "Site" : "Bot"} />
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
          href={`https://${c.container.subdomain}.apps.artix.cloud`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm transition-colors hover:bg-white/[0.04]"
        >
          <span className="text-white/55">{t("cont.ov.url")}</span>
          <span className="inline-flex items-center gap-1.5 truncate font-mono text-xs text-sky-300">
            {c.container.subdomain}.apps.artix.cloud
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </span>
        </a>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/55">{t("cont.ov.appId")}</span>
          <span className="truncate font-mono text-xs text-white/70">{c.container?.app_id}</span>
        </div>
      </div>
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

function DeployTab({ id }: { id: string }) {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [buildLog, setBuildLog] = useState("");

  const deploy = async (file: File) => {
    setBusy(true);
    setBuildLog("");
    try {
      const fd = new FormData();
      fd.append("bundle", file);
      const out = await api<DeployResult>(`containers/${id}/deploy`, {
        method: "POST",
        body: fd,
      });
      setBuildLog(out.buildLog ?? "");
      toast(t("cont.deploy.ok"), "success");
      await mutate(`containers/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.deploy.err"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FadeIn className="space-y-4">
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
          onChange={(e) => e.target.files?.[0] && deploy(e.target.files[0])}
        />
      </label>

      <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <summary className="cursor-pointer text-sm text-white/60">{t("cont.deploy.artixHelp")} .artix</summary>
        <pre className="mt-3 overflow-auto rounded-xl bg-black p-3 font-mono text-[12px] text-white/70">
          {ARTIX_EXAMPLE}
        </pre>
      </details>

      {buildLog && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
            {t("cont.deploy.buildLog")}
          </p>
          <pre className="max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black p-4 font-mono text-[13px] whitespace-pre-wrap text-white/80">
            {buildLog}
          </pre>
        </div>
      )}
    </FadeIn>
  );
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
