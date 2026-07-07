"use client";

import { useState } from "react";
import Link from "next/link";
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  BookOpen,
  ShieldAlert,
} from "lucide-react";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { useToast } from "@/components/FeedbackProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type { ApiKey, CreateKeyResponse } from "@/lib/api/types";

/** The capability scopes an API key can hold (must match backend `permissions::cap`). */
export const SCOPES = [
  "services.read",
  "services.create",
  "services.restart",
  "services.delete",
  "metrics.read",
  "logs.read",
  "console",
  "history.read",
  "events",
  "billing",
  "admin",
] as const;

function scopeLabel(t: (k: string) => string, s: string): string {
  return t(`dev.scope.${s}`) || s;
}

function fmtDate(iso: string | null, t: (k: string) => string): string {
  if (!iso) return t("dev.never");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function DeveloperSection() {
  const { t } = useLang();
  const { data: keys, loading } = useQuery<ApiKey[]>("keys");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight">{t("dev.title")}</h3>
          <p className="mt-1 max-w-md text-sm text-white/55">{t("dev.subtitle")}</p>
        </div>
        <Link
          href="/docs#api-keys"
          target="_blank"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          <BookOpen className="h-3.5 w-3.5" /> {t("dev.docs")}
        </Link>
      </div>

      {creating ? (
        <CreateKey onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          <Plus className="h-4 w-4" /> {t("dev.new")}
        </button>
      )}

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : !keys || keys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
            <KeyRound className="mx-auto h-6 w-6 text-white/30" />
            <p className="mt-2 text-sm text-white/50">{t("dev.empty")}</p>
          </div>
        ) : (
          keys.map((k) => <KeyRow key={k.id} k={k} />)
        )}
      </div>
    </div>
  );
}

function CreateKey({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["services.read"]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = async () => {
    if (busy || !name.trim() || scopes.length === 0) return;
    setBusy(true);
    try {
      const res = await api<CreateKeyResponse>("keys", {
        method: "POST",
        json: { name: name.trim(), scopes },
      });
      setCreated(res);
      await mutate("keys");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("dev.err"));
      setBusy(false);
    }
  };

  const copy = () => {
    if (!created) return;
    navigator.clipboard?.writeText(created.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (created) {
    return (
      <div className="space-y-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5">
        <div className="flex items-start gap-2.5">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div>
            <p className="text-sm font-medium text-emerald-200">{t("dev.created.title")}</p>
            <p className="mt-0.5 text-xs text-white/55">{t("dev.created.once")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black p-3">
          <code className="flex-1 truncate font-mono text-xs text-white/85">{created.key}</code>
          <button
            onClick={copy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium transition-colors hover:bg-white/20"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t("dev.copied") : t("dev.copy")}
          </button>
        </div>
        <button
          onClick={onDone}
          className="inline-flex h-9 items-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          {t("dev.done")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/70">{t("dev.name")}</span>
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder={t("dev.namePlaceholder")}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
        />
      </label>

      <div>
        <span className="mb-2 block text-sm font-medium text-white/70">{t("dev.perms")}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SCOPES.map((s) => {
            const on = scopes.includes(s);
            const admin = s === "admin";
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  on
                    ? "border-white/30 bg-white/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? "border-white bg-white text-black" : "border-white/25"
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="flex items-center gap-1.5">
                  {admin && <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />}
                  {scopeLabel(t, s)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
        >
          {t("dev.cancel")}
        </button>
        <button
          onClick={submit}
          disabled={busy || !name.trim() || scopes.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {t("dev.generate")}
        </button>
      </div>
    </div>
  );
}

function KeyRow({ k }: { k: ApiKey }) {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      await api(`keys/${k.id}`, { method: "DELETE" });
      await mutate("keys");
      toast(t("dev.revoked"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("dev.err"));
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] p-4 ${k.revoked ? "opacity-55" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{k.name}</p>
            {k.revoked ? (
              <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
                {t("dev.status.revoked")}
              </span>
            ) : (
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                {t("dev.status.active")}
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-white/45">{k.prefix}</p>
        </div>
        {!k.revoked && (
          <button
            onClick={revoke}
            disabled={busy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/25 px-3 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {t("dev.revoke")}
          </button>
        )}
      </div>

      {k.scopes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {k.scopes.map((s) => (
            <span
              key={s}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60"
            >
              {scopeLabel(t, s)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
        <span>
          {t("dev.createdAt")}: {fmtDate(k.created_at, t)}
        </span>
        <span>
          {t("dev.lastUsed")}: {fmtDate(k.last_used_at, t)}
        </span>
      </div>
    </div>
  );
}
