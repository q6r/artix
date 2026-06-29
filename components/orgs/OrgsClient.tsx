"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Users, ChevronRight, X } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type { Org } from "@/lib/api/types";

export default function OrgsClient() {
  const { t } = useLang();
  const { data: orgs, error, loading } = useQuery<Org[]>("orgs");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("org.title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("org.subtitle")}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
          {t("org.new")}
        </button>
      </FadeIn>

      {loading ? (
        <OrgsSkeleton />
      ) : error || !orgs ? (
        <p className="text-sm text-red-300">{t("org.error")}</p>
      ) : orgs.length === 0 ? (
        <FadeIn
          delay={0.08}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center"
        >
          <p className="text-lg font-semibold tracking-tight">{t("org.empty.title")}</p>
          <p className="mt-1 max-w-sm text-sm text-white/50">{t("org.empty.desc")}</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            {t("org.new")}
          </button>
        </FadeIn>
      ) : (
        <FadeIn delay={0.08} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {orgs.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/organizations/${o.id}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-600 text-sm font-semibold">
                  {o.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/60">
                  {t(`org.role.${o.role}`)}
                </span>
              </div>
              <p className="mt-3 font-medium">{o.name}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-white/45">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {o.member_count} {t("org.members")}
                </span>
                <span>·</span>
                <span>
                  {o.server_count} {t("org.servers")}
                </span>
                <ChevronRight className="ml-auto h-4 w-4 text-white/30 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </FadeIn>
      )}

      <CreateOrgModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function OrgsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-32" />
          <Skeleton className="mt-3 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

function CreateOrgModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounting the form only while open gives it fresh state every time.
  return (
    <AnimatePresence>{open && <CreateOrgForm onClose={onClose} />}</AnimatePresence>
  );
}

function CreateOrgForm({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape (no state writes here, so it stays effect-safe).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("orgs", { method: "POST", json: { name: name.trim() } });
      await mutate("orgs");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("org.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ scale: 0.96, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl"
      >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t("org.new")}</h2>
                <p className="mt-1 text-sm text-white/50">{t("org.subtitle")}</p>
              </div>
              <button
                onClick={onClose}
                aria-label={t("org.create")}
                className="text-white/40 transition-colors hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("org.name")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("org.namePlaceholder")}
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
                />
              </label>

              {error && (
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10"
                >
                  {t("org.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="h-10 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                >
                  {t("org.create")}
                </button>
              </div>
            </form>
      </motion.div>
    </motion.div>
  );
}
