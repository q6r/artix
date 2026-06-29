"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import Select from "@/components/Select";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type { Ticket, TicketCategory } from "@/lib/api/types";

const statusStyles: Record<string, string> = {
  open: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  pending: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  closed: "border-white/15 bg-white/5 text-white/55",
};

export default function SupportClient() {
  const { t, locale } = useLang();
  const { data: tickets, error, loading } = useQuery<Ticket[]>("tickets");
  const { data: categories } = useQuery<TicketCategory[]>("ticket-categories");
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const catBySlug = new Map((categories ?? []).map((c) => [c.slug, c]));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !subject.trim() || !body.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await api("tickets", {
        method: "POST",
        json: {
          subject: subject.trim(),
          body: body.trim(),
          ...(category ? { category } : {}),
        },
      });
      setSubject("");
      setBody("");
      setCategory("");
      setOpen(false);
      await mutate("tickets");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("sup.error"));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-72 max-w-[60vw]" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 bg-white/[0.02] p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4" style={{ width: `${40 + ((i * 13) % 35)}%` }} />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  if (error || !tickets) return <p className="text-sm text-red-300">{t("sup.error")}</p>;

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("sup.title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("sup.subtitle")}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
          {t("sup.new")}
        </button>
      </FadeIn>

      {open && (
        <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <form onSubmit={create} className="space-y-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("sup.subject")}</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("sup.subjectPlaceholder")}
                className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
              />
            </label>
            {categories && categories.length > 0 && (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("admin.cat.select")}</span>
                <Select
                  value={category}
                  onChange={setCategory}
                  placeholder={t("admin.cat.none")}
                  className="h-11 px-4 text-sm"
                  options={[
                    { value: "", label: t("admin.cat.none") },
                    ...categories.map((c) => ({ value: c.slug, label: c.name })),
                  ]}
                />
              </label>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("sup.message")}</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder={t("sup.messagePlaceholder")}
                className="resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
              />
            </label>
            {formError && <p className="text-sm text-red-300">{formError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {t("sup.send")}
            </button>
          </form>
        </FadeIn>
      )}

      {tickets.length === 0 ? (
        <p className="text-sm text-white/45"></p>
      ) : (
        <FadeIn delay={0.08} className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
          {tickets.map((tk) => (
            <Link
              key={tk.id}
              href={`/dashboard/support/${tk.id}`}
              className="flex items-center gap-4 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{tk.subject}</p>
                <p className="text-xs text-white/45">{new Date(tk.updated_at).toLocaleDateString(locale)}</p>
              </div>
              {tk.category && (() => {
                const c = catBySlug.get(tk.category);
                const col = c?.color || "#888888";
                return (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
                    style={{ borderColor: `${col}55`, backgroundColor: `${col}1a`, color: col }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col }} />
                    {c?.name ?? tk.category}
                  </span>
                );
              })()}
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles[tk.status] ?? statusStyles.closed}`}
              >
                {t(`sup.status.${tk.status}`)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
            </Link>
          ))}
        </FadeIn>
      )}
    </div>
  );
}
