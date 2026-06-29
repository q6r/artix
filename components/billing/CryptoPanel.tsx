"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import { useSubscription } from "@/hooks/use-subscription";
import type { Invoice } from "@/lib/api/types";

/**
 * Renders the Litecoin charge for an open invoice and confirms in real time over
 * the gateway socket (`invoice:<id>` "paid"). The backend poller settles it.
 */
export default function CryptoPanel({
  invoice,
  onPaid,
}: {
  invoice: Invoice;
  onPaid?: () => void;
}) {
  const { t } = useLang();
  const [status, setStatus] = useState<Invoice["status"]>(invoice.status);
  const [copied, setCopied] = useState(false);
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

  const address = invoice.crypto_address ?? "";
  const amount = invoice.crypto_amount_ltc ?? 0;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  };

  if (status === "paid") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-300">
        <Check className="h-5 w-5 shrink-0" strokeWidth={1.8} />
        {t("bill.crypto.paid")}
      </div>
    );
  }

  const uri = address ? `litecoin:${address}?amount=${amount}` : "";
  const qr = uri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(uri)}`
    : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-medium">{t("bill.crypto.title")}</p>
      <p className="mt-1 text-xs text-white/50">{t("bill.crypto.scan")}</p>

      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="Litecoin QR code"
            className="h-44 w-44 shrink-0 rounded-xl border border-white/10 bg-white p-2"
          />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs text-white/45">{t("bill.crypto.amount")}</p>
            <button
              type="button"
              onClick={() => copy(String(amount))}
              className="mt-1 font-mono text-lg font-semibold tracking-tight text-white"
              title={t("bill.crypto.copy")}
            >
              {amount} LTC
            </button>
          </div>
          <div>
            <p className="text-xs text-white/45">{t("bill.crypto.address")}</p>
            <code className="mt-1 block w-full break-all rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
              {address}
            </code>
            <button
              type="button"
              onClick={() => copy(address)}
              disabled={!address}
              className="mt-2 inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("bill.crypto.copied") : t("bill.crypto.copy")}
            </button>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-amber-200/70">{t("bill.crypto.exact")}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-white/45">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {t("bill.crypto.waiting")}
      </div>
    </div>
  );
}
