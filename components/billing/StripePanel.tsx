"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import { useSubscription } from "@/hooks/use-subscription";
import type { Invoice } from "@/lib/api/types";

/**
 * Stripe hosted-checkout: a button that sends the customer to Stripe's page.
 * Confirms in real time over the gateway socket once the webhook settles it.
 */
export default function StripePanel({
  invoice,
  onPaid,
}: {
  invoice: Invoice;
  onPaid?: () => void;
}) {
  const { t } = useLang();
  const [status, setStatus] = useState<Invoice["status"]>(invoice.status);
  const firedPaid = useRef(false);

  useSubscription(status === "paid" ? null : `invoice:${invoice.id}`, (event) => {
    if (event === "paid") setStatus("paid");
  });

  useEffect(() => {
    if (status === "paid" && !firedPaid.current) {
      firedPaid.current = true;
      onPaid?.();
    }
  }, [status, onPaid]);

  if (status === "paid") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-300">
        <Check className="h-5 w-5 shrink-0" strokeWidth={1.8} />
        {t("bill.stripe.paid")}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-medium">{t("bill.stripe.title")}</p>
      <p className="mt-1 text-xs text-white/50">{t("bill.stripe.desc")}</p>
      <a
        href={invoice.stripe_url ?? "#"}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
      >
        <CreditCard className="h-4 w-4" />
        {t("bill.stripe.pay")}
        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
      </a>
      <div className="mt-3 flex items-center gap-2 text-xs text-white/45">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {t("bill.stripe.waiting")}
      </div>
    </div>
  );
}
