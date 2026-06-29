"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import {
  AttendancePanel,
  Conversation,
  statusStyles,
  useTicket,
} from "@/components/support/ticketParts";

function TicketSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <div className="shrink-0 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-1/2 max-w-sm" />
      </div>
      <div className="grid flex-1 gap-6 lg:min-h-0 lg:grid-cols-[1fr_320px]">
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] lg:h-full">
          <div className="flex-1 space-y-5 p-5">
            {[0, 1, 2, 3].map((i) => {
              const mine = i % 2 === 1;
              return (
                <div
                  key={i}
                  className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
                >
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : ""}`}>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton
                      className="h-12 rounded-2xl"
                      style={{ width: `${160 + ((i * 47) % 120)}px` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-white/10 p-3">
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function TicketClient({
  id,
  admin = false,
}: {
  id: string;
  admin?: boolean;
}) {
  const { t } = useLang();
  const {
    user,
    thread,
    status,
    busy,
    actionBusy,
    send,
    assignSelf,
    unassign,
    close,
    addMember,
    removeMember,
  } = useTicket(id, admin);

  if (status === "loading" || status === "idle") return <TicketSkeleton />;
  if (status === "error" || !thread)
    return <p className="text-sm text-red-300">{t("sup.error")}</p>;

  const ticket = thread.ticket;
  const isStaff = admin || (user?.permissions ?? []).includes("support.manage");
  const isOwner = !!user && ticket.owner?.id === user.id;

  return (
    <div className="flex flex-col gap-4 lg:h-full">
      <FadeIn className="shrink-0">
        <Link
          href={admin ? "/dashboard/admin" : "/dashboard/support"}
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {admin ? t("admin.nav.title") : t("sup.back")}
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {ticket.subject}
          </h1>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles[ticket.status]}`}
          >
            {t(`sup.status.${ticket.status}`)}
          </span>
        </div>
      </FadeIn>

      <div className="grid flex-1 gap-6 lg:min-h-0 lg:grid-cols-[1fr_320px]">
        <Conversation
          thread={thread}
          busy={busy}
          onSend={send}
          className="h-[70vh] rounded-2xl border border-white/10 bg-white/[0.02] lg:h-full"
        />
        <div className="lg:overflow-y-auto">
          <AttendancePanel
            thread={thread}
            isStaff={isStaff}
            isOwner={isOwner}
            actionBusy={actionBusy}
            onAssignSelf={assignSelf}
            onUnassign={unassign}
            onClose={close}
            onAddMember={addMember}
            onRemoveMember={removeMember}
          />
        </div>
      </div>
    </div>
  );
}
