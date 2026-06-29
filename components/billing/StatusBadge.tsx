"use client";

import { useLang } from "@/components/LanguageProvider";

const styles: Record<string, string> = {
  // subscriptions
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  pending_payment: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  past_due: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  suspended: "border-red-500/30 bg-red-500/10 text-red-300",
  cancelled: "border-white/15 bg-white/5 text-white/55",
  // invoices
  open: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  expired: "border-white/15 bg-white/5 text-white/55",
  void: "border-white/15 bg-white/5 text-white/55",
  uncollectible: "border-red-500/30 bg-red-500/10 text-red-300",
};

export default function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const cls = styles[status] ?? "border-white/15 bg-white/5 text-white/55";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {t(`bill.status.${status}`)}
    </span>
  );
}
