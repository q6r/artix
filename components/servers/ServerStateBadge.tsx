"use client";

import { useLang } from "@/components/LanguageProvider";
import type { ServerState } from "@/lib/api/types";

const styles: Record<ServerState, string> = {
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  provisioning: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  pending_payment: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  stopped: "border-white/15 bg-white/5 text-white/55",
  suspended: "border-red-500/30 bg-red-500/10 text-red-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
  deleting: "border-white/15 bg-white/5 text-white/45",
};

export default function ServerStateBadge({ state }: { state: ServerState }) {
  const { t } = useLang();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[state]}`}
    >
      {state === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
      )}
      {t(`srv.state.${state}`)}
    </span>
  );
}
