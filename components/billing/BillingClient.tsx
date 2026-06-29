"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import StatusBadge from "@/components/billing/StatusBadge";
import { useQuery } from "@/lib/api/query";
import { formatMoney, type Invoice, type Subscription } from "@/lib/api/types";

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function BillingClient() {
  const { t, locale } = useLang();
  const subsQ = useQuery<Subscription[]>("billing/subscriptions");
  const invQ = useQuery<Invoice[]>("billing/invoices");

  if (subsQ.loading || invQ.loading) {
    return <BillingSkeleton />;
  }
  if ((subsQ.error && !subsQ.data) || (invQ.error && !invQ.data)) {
    return <p className="text-sm text-red-300">{t("bill.error")}</p>;
  }
  const subs = subsQ.data ?? [];
  const invoices = invQ.data ?? [];

  return (
    <div className="space-y-8">
      <FadeIn className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("dash.billing.title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("dash.billing.subtitle")}</p>
        </div>
        <Link
          href="/dashboard/billing/new"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
          {t("bill.newServer")}
        </Link>
      </FadeIn>

      {subs.length === 0 ? (
        <FadeIn
          delay={0.08}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center"
        >
          <p className="text-lg font-semibold tracking-tight">{t("bill.empty.title")}</p>
          <p className="mt-1 max-w-sm text-sm text-white/50">{t("bill.empty.desc")}</p>
          <Link
            href="/dashboard/billing/new"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            {t("bill.subscribe")}
          </Link>
        </FadeIn>
      ) : (
        <FadeIn delay={0.08} className="space-y-3">
          <h2 className="text-sm font-medium text-white/70">{t("bill.subscriptions")}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {subs.map((s) => (
              <div
                key={s.id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold uppercase tracking-wide">{s.plan}</span>
                  <StatusBadge status={s.status} />
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {formatMoney(s.price_cents, s.currency)}
                  <span className="text-sm font-normal text-white/45">{t("bill.perMonth")}</span>
                </p>
                <p className="mt-1 text-xs text-white/45">
                  {t("bill.renews")} {fmtDate(s.current_period_end, locale)}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.12} className="space-y-3">
        <h2 className="text-sm font-medium text-white/70">{t("bill.invoices")}</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-white/45">{t("bill.noInvoices")}</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-left text-xs text-white/45">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("bill.number")}</th>
                  <th className="px-4 py-3 font-medium">{t("bill.amount")}</th>
                  <th className="px-4 py-3 font-medium">{t("dash.billing.title")}</th>
                  <th className="px-4 py-3 font-medium">{t("bill.date")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {invoices.map((i) => (
                  <tr key={i.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium">{i.number}</td>
                    <td className="px-4 py-3">{formatMoney(i.amount_cents, i.currency)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-4 py-3 text-white/55">{fmtDate(i.created_at, locale)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/billing/${i.id}`}
                        className="text-white/70 underline-offset-4 hover:text-white hover:underline"
                      >
                        {t("bill.view")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FadeIn>
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-7 w-28" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
