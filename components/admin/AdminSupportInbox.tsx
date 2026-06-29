"use client";

import { useMemo, useState } from "react";
import { Shield } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { useQuery, mutate } from "@/lib/api/query";
import { hasSupportAccess } from "@/lib/permissions";
import {
  AttendancePanel,
  Conversation,
  statusStyles,
  useTicket,
} from "@/components/support/ticketParts";
import type { Ticket, TicketCategory } from "@/lib/api/types";

export default function AdminSupportInbox() {
  const { t, locale } = useLang();
  const { user } = useAuth();
  const { data: tickets, error, loading } = useQuery<Ticket[]>("admin/tickets");
  const { data: cats } = useQuery<TicketCategory[]>("ticket-categories");
  const [filter, setFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const catBySlug = useMemo(() => {
    const m = new Map<string, TicketCategory>();
    (cats ?? []).forEach((c) => m.set(c.slug, c));
    return m;
  }, [cats]);

  // Selected conversation (staff endpoints); refreshes the list after changes.
  const tk = useTicket(selectedId, true, () => mutate("admin/tickets"));

  if (!user || !hasSupportAccess(user.permissions)) {
    return (
      <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <Shield className="mx-auto h-8 w-8 text-white/30" strokeWidth={1.6} />
        <h1 className="mt-3 text-lg font-semibold">{t("admin.noAccess.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("admin.noAccess.desc")}</p>
      </FadeIn>
    );
  }

  const thread = tk.thread;
  const isOwner = !!user && thread?.ticket.owner?.id === user.id;

  const shown = (tickets ?? []).filter((row) => {
    if (filter === "all") return true;
    if (filter === "__none__") return !row.category;
    return row.category === filter;
  });

  const chips: { value: string; label: string }[] = [
    { value: "all", label: t("admin.tickets.all") },
    ...(cats ?? []).map((c) => ({ value: c.slug, label: c.name })),
    { value: "__none__", label: t("admin.tickets.uncategorized") },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <FadeIn className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.tickets.title")}
        </h1>
        <p className="mt-1 text-sm text-white/55">{t("admin.tickets.subtitle")}</p>
      </FadeIn>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* Left: ticket list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <div className="flex flex-wrap gap-1.5 border-b border-white/10 p-2">
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilter(c.value)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === c.value
                    ? "border-white/30 bg-white/10 text-white"
                    : "border-white/10 bg-white/[0.02] text-white/55 hover:text-white"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-white/50">{t("admin.loading")}</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-300">{t("admin.error")}</p>
            ) : shown.length === 0 ? (
              <p className="p-4 text-sm text-white/45">{t("admin.tickets.empty")}</p>
            ) : (
              shown.map((row) => {
                const cat = row.category ? catBySlug.get(row.category) : undefined;
                const active = row.id === selectedId;
                const color = cat?.color || "#888888";
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`flex w-full items-start gap-3 border-b border-white/5 p-3 text-left transition-colors ${
                      active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    {row.category && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                        title={cat?.name ?? row.category}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.subject}</p>
                      <p className="truncate text-xs text-white/45">
                        {row.owner ? row.owner.display_name : ""}
                        {" · "}
                        {new Date(row.updated_at).toLocaleDateString(locale)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        statusStyles[row.status] ?? statusStyles.closed
                      }`}
                    >
                      {t(`admin.status.${row.status}`)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Middle: conversation */}
        {thread && tk.status === "ready" ? (
          <Conversation
            thread={thread}
            busy={tk.busy}
            onSend={tk.send}
            className="h-[60vh] rounded-2xl border border-white/10 bg-white/[0.02] lg:h-full"
          />
        ) : (
          <div className="flex h-[60vh] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] lg:h-full">
            <p className="text-sm text-white/40">
              {tk.status === "loading"
                ? t("admin.loading")
                : tk.status === "error"
                  ? t("admin.error")
                  : t("admin.tickets.select")}
            </p>
          </div>
        )}

        {/* Right: attendance + members */}
        <div className="lg:overflow-y-auto">
          {thread ? (
            <AttendancePanel
              thread={thread}
              isStaff
              isOwner={isOwner}
              actionBusy={tk.actionBusy}
              onAssignSelf={tk.assignSelf}
              onUnassign={tk.unassign}
              onClose={tk.close}
              onAddMember={tk.addMember}
              onRemoveMember={tk.removeMember}
            />
          ) : (
            <div className="hidden rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-white/35 lg:block">
              {t("admin.tickets.select")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
