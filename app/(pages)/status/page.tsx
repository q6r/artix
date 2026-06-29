import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { getT } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Status — ArtixCloud",
};

const components = [
  { nameKey: "status.component.api", uptime: "99.99%", status: "operational" },
  {
    nameKey: "status.component.panel",
    uptime: "99.98%",
    status: "operational",
  },
  {
    nameKey: "status.component.network",
    uptime: "100%",
    status: "operational",
  },
  {
    nameKey: "status.component.provisioning",
    uptime: "99.95%",
    status: "operational",
  },
  {
    nameKey: "status.component.backups",
    uptime: "99.97%",
    status: "operational",
  },
  {
    nameKey: "status.component.antiddos",
    uptime: "100%",
    status: "operational",
  },
];

const incidents = [
  {
    dateKey: "status.incident1.date",
    titleKey: "status.incident1.title",
    statusKey: "status.statusResolved",
    detailKey: "status.incident1.detail",
  },
  {
    dateKey: "status.incident2.date",
    titleKey: "status.incident2.title",
    statusKey: "status.statusDone",
    detailKey: "status.incident2.detail",
  },
];

// 90 days of mostly-green uptime bars (deterministic, no randomness).
const bars = Array.from({ length: 90 }, (_, i) =>
  i === 61 ? "degraded" : "up",
);

export default async function StatusPage() {
  const t = await getT();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-20">
        {/* Overall */}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-6 py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400" strokeWidth={1.6} />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("status.allOperational")}
          </h1>
          <p className="text-sm text-white/55">{t("status.avgUptime")}</p>
        </div>

        {/* Components */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            {t("status.components")}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10 divide-y divide-white/10">
            {components.map((c) => (
              <div
                key={c.nameKey}
                className="flex items-center justify-between bg-white/[0.02] p-4"
              >
                <span className="font-medium">{t(c.nameKey)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white/45">{c.uptime}</span>
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {t("status.operational")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 90 day uptime */}
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between text-sm">
            <h2 className="font-semibold tracking-tight">
              {t("status.uptime90")}
            </h2>
            <span className="text-white/45">99.98%</span>
          </div>
          <div className="flex gap-[3px] rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            {bars.map((b, i) => (
              <span
                key={i}
                className={`h-9 flex-1 rounded-sm ${
                  b === "up" ? "bg-emerald-400/70" : "bg-amber-400/70"
                }`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/40">
            <span>{t("status.daysAgo")}</span>
            <span>{t("status.today")}</span>
          </div>
        </section>

        {/* Incident history */}
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            {t("status.incidentHistory")}
          </h2>
          <div className="space-y-4">
            {incidents.map((inc) => (
              <div
                key={inc.titleKey}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-medium">{t(inc.titleKey)}</h3>
                  <span className="shrink-0 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                    {t(inc.statusKey)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/40">{t(inc.dateKey)}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  {t(inc.detailKey)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
