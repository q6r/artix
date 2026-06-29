"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, Server as ServerIcon } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import ServerStateBadge from "@/components/servers/ServerStateBadge";
import StatusBadge from "@/components/billing/StatusBadge";
import { useQuery } from "@/lib/api/query";
import { formatMoney, type Invoice, type Server, type Subscription } from "@/lib/api/types";

export default function OverviewClient() {
  const { t, locale } = useLang();
  const { user } = useAuth();
  const { data: serversData, loading: l1 } = useQuery<Server[]>("servers");
  const { data: subsData, loading: l2 } = useQuery<Subscription[]>("billing/subscriptions");
  const { data: invoicesData, loading: l3 } = useQuery<Invoice[]>("billing/invoices");

  const servers = serversData ?? [];
  const subs = subsData ?? [];
  const invoices = invoicesData ?? [];
  const ready = !l1 && !l2 && !l3;

  const running = servers.filter((s) => s.state === "running").length;
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "past_due");
  const activeSubIds = new Set(activeSubs.map((s) => s.id));
  // "Next invoice" = a renewal of an ACTIVE subscription, not the unpaid
  // invoice of a checkout that was never completed.
  const openInvoice = invoices.find(
    (i) => i.status === "open" && activeSubIds.has(i.subscription_id),
  );

  const stats = [
    { label: t("dash.overview.stat.activeServers"), value: String(servers.length) },
    { label: t("srv.state.running"), value: String(running) },
    { label: t("bill.subscriptions"), value: String(activeSubs.length) },
    {
      label: t("dash.overview.nextInvoice"),
      value: openInvoice ? formatMoney(openInvoice.amount_cents, openInvoice.currency) : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <FadeIn className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.01] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-white/50">
            {t("dash.overview.hello")}
            {user?.display_name ? `, ${user.display_name.split(" ")[0]}` : ""} 👋
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("dash.overview.title")}
          </h1>
          <p className="mt-1.5 text-sm text-white/55">{t("dash.overview.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-xs font-medium text-emerald-400 sm:self-auto">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          {t("dash.overview.allSystems")}
        </div>
      </FadeIn>

      <FadeIn delay={0.06} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <span className="text-xs text-white/50">{s.label}</span>
            <p className="mt-3 text-2xl font-semibold tracking-tight">{ready ? s.value : "—"}</p>
          </div>
        ))}
      </FadeIn>

      <FadeIn delay={0.12}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{t("dash.overview.yourServers")}</h2>
          <Link
            href="/dashboard/servers"
            className="flex items-center gap-1 text-sm text-white/55 transition-colors hover:text-white"
          >
            {t("dash.overview.seeAll")} <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        {servers.length === 0 ? (
          <Link
            href="/dashboard/billing/new"
            className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-sm text-white/55 transition-colors hover:bg-white/[0.04]"
          >
            {t("srv.new")} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {servers.slice(0, 4).map((srv) => (
              <Link
                key={srv.id}
                href={`/dashboard/servers/${srv.id}`}
                className="flex items-center gap-4 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <ServerIcon className="h-4 w-4 text-white/70" strokeWidth={1.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{srv.name}</p>
                    <ServerStateBadge state={srv.state} />
                  </div>
                  <p className="truncate text-xs text-white/45">
                    {srv.os} · {srv.specs.vcpu} {t("srv.specs.vcpu")} · {srv.specs.ram_gb} GB
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
              </Link>
            ))}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.18}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{t("bill.invoices")}</h2>
          <Link
            href="/dashboard/billing"
            className="flex items-center gap-1 text-sm text-white/55 transition-colors hover:text-white"
          >
            {t("dash.overview.seeAll")} <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-white/45">{t("bill.noInvoices")}</p>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {invoices.slice(0, 4).map((i) => (
              <Link
                key={i.id}
                href={`/dashboard/billing/${i.id}`}
                className="flex items-center gap-4 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.number}</p>
                  <p className="text-xs text-white/45">
                    {new Date(i.created_at).toLocaleDateString(locale)}
                  </p>
                </div>
                <StatusBadge status={i.status} />
                <span className="text-sm font-medium">
                  {formatMoney(i.amount_cents, i.currency)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
