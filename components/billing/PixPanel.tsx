"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import { useSubscription } from "@/hooks/use-subscription";
import type { Invoice } from "@/lib/api/types";

function qrSrc(raw: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
}

/**
 * Renders the PIX charge for an open invoice and polls until it is paid.
 * Calls `onPaid` once the backend confirms (via the PagCI webhook).
 */
export default function PixPanel({
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

  // Live confirmation over the gateway socket — no polling. The parent already
  // loads the current invoice status, so no extra sync fetch is needed here.
  useSubscription(status === "paid" ? null : `invoice:${invoice.id}`, (event) => {
    if (event === "paid") setStatus("paid");
  });

  useEffect(() => {
    if (status === "paid" && !firedPaid.current) {
      firedPaid.current = true;
      onPaid?.();
    }
  }, [status, onPaid]);

  const copy = async () => {
    if (!invoice.pix_code) return;
    try {
      await navigator.clipboard.writeText(invoice.pix_code);
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
        {t("bill.pix.paid")}
      </div>
    );
  }

  const img = qrSrc(invoice.pix_qr_image);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-sm font-medium">{t("bill.pix.title")}</p>
      <p className="mt-1 text-xs text-white/50">{t("bill.pix.scan")}</p>

      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt="PIX QR code"
            className="h-40 w-40 rounded-xl border border-white/10 bg-white p-2"
          />
        )}
        <div className="min-w-0 flex-1">
          {invoice.pix_code && (
            <code className="block w-full break-all rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
              {invoice.pix_code}
            </code>
          )}
          <button
            type="button"
            onClick={copy}
            disabled={!invoice.pix_code}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("bill.pix.copied") : t("bill.pix.copy")}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-white/45">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {t("bill.pix.waiting")}
      </div>
    </div>
  );
}
