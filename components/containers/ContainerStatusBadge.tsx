"use client";

import { useLang } from "@/components/LanguageProvider";

const STYLES: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-300",
  stopped: "bg-white/10 text-white/55",
  exited: "bg-red-500/15 text-red-300",
  created: "bg-amber-500/15 text-amber-300",
  unknown: "bg-white/10 text-white/55",
};

export default function ContainerStatusBadge({ status }: { status?: string | null }) {
  const { t } = useLang();
  const key = status && STYLES[status] ? status : "unknown";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[key]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`cont.status.${key}`)}
    </span>
  );
}
