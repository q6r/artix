"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import StatusBadge from "@/components/billing/StatusBadge";
import PixPanel from "@/components/billing/PixPanel";
import CryptoPanel from "@/components/billing/CryptoPanel";
import StripePanel from "@/components/billing/StripePanel";
import { api } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import { formatMoney, type Invoice } from "@/lib/api/types";

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InvoiceClient({ id }: { id: string }) {
  const { t, locale } = useLang();
  const key = `billing/invoices/${id}`;
  const { data: invoice, error, loading } = useQuery<Invoice>(key);
  const [paying, setPaying] = useState(false);

  // (Re)issue a PIX charge for an open/expired invoice that has no code yet.
  const pay = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await api(`${key}/pay`, { method: "POST" });
    } finally {
      await mutate(key);
      setPaying(false);
    }
  };

  const onPaid = () => {
    void mutate(key);
    void mutate("billing/invoices");
  };

  if (loading) return <p className="text-sm text-white/50">{t("bill.loading")}</p>;
  if (error || !invoice)
    return <p className="text-sm text-red-300">{t("bill.error")}</p>;

  const payable = invoice.status === "open" || invoice.status === "expired";
  const provider = invoice.provider ?? "pix";
  const charged =
    (provider === "crypto" && !!invoice.crypto_address) ||
    (provider === "stripe" && !!invoice.stripe_url) ||
    (provider === "pix" && !!invoice.pix_code);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <FadeIn>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("dash.billing.title")}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{invoice.number}</h1>
          <StatusBadge status={invoice.status} />
        </div>
      </FadeIn>

      <FadeIn delay={0.06} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <dl className="grid grid-cols-2 gap-y-4 text-sm">
          <dt className="text-white/45">{t("bill.amount")}</dt>
          <dd className="text-right font-semibold">
            {formatMoney(invoice.amount_cents, invoice.currency)}
          </dd>
          <dt className="text-white/45">{t("bill.dueDate")}</dt>
          <dd className="text-right">{fmtDate(invoice.due_date, locale)}</dd>
          <dt className="text-white/45">{t("bill.date")}</dt>
          <dd className="text-right">{fmtDate(invoice.created_at, locale)}</dd>
        </dl>
      </FadeIn>

      {payable && charged && provider === "crypto" && (
        <FadeIn delay={0.1}>
          <CryptoPanel invoice={invoice} onPaid={onPaid} />
        </FadeIn>
      )}

      {payable && charged && provider === "stripe" && (
        <FadeIn delay={0.1}>
          <StripePanel invoice={invoice} onPaid={onPaid} />
        </FadeIn>
      )}

      {payable && charged && provider === "pix" && (
        <FadeIn delay={0.1}>
          <PixPanel invoice={invoice} onPaid={onPaid} />
        </FadeIn>
      )}

      {payable && !charged && (
        <FadeIn delay={0.1}>
          <button
            type="button"
            onClick={pay}
            disabled={paying}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            {paying ? t("bill.checkout.creating") : t("bill.pay")}
          </button>
        </FadeIn>
      )}
    </div>
  );
}
