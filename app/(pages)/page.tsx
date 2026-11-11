import {
  ArrowRight,
  Check,
  Clock,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  Server,
  Shield,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { StarsBackground } from "@/components/animate-ui/components/backgrounds/stars";
import { SplittingText } from "@/components/animate-ui/primitives/texts/splitting";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";
import FloatingNavbar from "@/components/FloatingNavbar";
import Reveal from "@/components/Reveal";
import FaqAccordion from "@/components/FaqAccordion";
import Testimonials from "@/components/Testimonials";
import ActionButton from "@/components/ActionButton";
import PlanCta from "@/components/PlanCta";
import Footer from "@/components/Footer";
import RotatingWord from "@/components/RotatingWord";
import ConnectivityBeams from "@/components/ConnectivityBeams";
import TechCloud from "@/components/TechCloud";
import { getT } from "@/lib/i18n";
import { apiBaseUrl } from "@/lib/env";

const features = [
  {
    icon: HardDrive,
    titleKey: "home.features.nvme.title",
    descKey: "home.features.nvme.desc",
  },
  {
    icon: Shield,
    titleKey: "home.features.ddos.title",
    descKey: "home.features.ddos.desc",
  },
  {
    icon: Gauge,
    titleKey: "home.features.uptime.title",
    descKey: "home.features.uptime.desc",
  },
  {
    icon: TerminalSquare,
    titleKey: "home.features.root.title",
    descKey: "home.features.root.desc",
  },
  {
    icon: Zap,
    titleKey: "home.features.deploy.title",
    descKey: "home.features.deploy.desc",
  },
  {
    icon: Database,
    titleKey: "home.features.backups.title",
    descKey: "home.features.backups.desc",
  },
  {
    icon: Globe,
    titleKey: "home.features.network.title",
    descKey: "home.features.network.desc",
  },
  {
    icon: Clock,
    titleKey: "home.features.support.title",
    descKey: "home.features.support.desc",
  },
];

const stats = [
  { value: 99.9, decimals: 1, suffix: "%", label: "hero.uptime" },
  { value: 60, decimals: 0, suffix: "s", label: "hero.online" },
  { value: 24, decimals: 0, suffix: "/7", label: "hero.suporte" },
];

const faqs = [
  { qKey: "home.faq.q1", aKey: "home.faq.a1" },
  { qKey: "home.faq.q2", aKey: "home.faq.a2" },
  { qKey: "home.faq.q3", aKey: "home.faq.a3" },
  { qKey: "home.faq.q4", aKey: "home.faq.a4" },
  { qKey: "home.faq.q5", aKey: "home.faq.a5" },
];

export default async function Home() {
  const t = await getT();
  let plans: {
    id: string;
    name: string;
    vcpu: number;
    ram_gb: number;
    disk_gb: number;
    price_cents: number;
  }[] = [];
  try {
    const res = await fetch(`${apiBaseUrl()}/billing/plans`, { cache: "no-store" });
    if (res.ok) plans = (await res.json()).plans ?? [];
  } catch (err) {
    // Backend unavailable (or API_INTERNAL_URL invalid): the pricing section renders
    // empty rather than stale, and the cause is logged.
    console.error("home: could not load the plans", err);
  }
  return (
    <div className="flex flex-1 flex-col">
      <FloatingNavbar />

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <StarsBackground className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-32 text-center">
          <div className="relative z-10 flex flex-col items-center">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <ShimmeringText
                text={t("hero.badge")}
                color="rgba(255,255,255,0.55)"
                shimmeringColor="#ffffff"
                className="tracking-[0.2em] mt-1"
              />
            </span>

            <h1 className="max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              <SplittingText
                text={t("hero.title1")}
                type="words"
                className="inline"
              />
              <br />
              <SplittingText
                text={t("hero.title2")}
                type="words"
                delay={350}
                className="inline"
              />{" "}
              <RotatingWord />
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg text-white/60">
              {t("home.hero.subtitle")}
            </p>

            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
              <ActionButton href="#planos" effect="liquid">
                <a className="mt-0.5">  {t("home.hero.cta.plans")}</a>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
              <ActionButton href="#recursos" variant="secondary">
                <a className="mt-0.5">{t("home.hero.cta.features")}</a>
              </ActionButton>
            </div>

            <dl className="mt-16 grid w-full max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
              {stats.map((s) => (
                <div
                  key={s.label}
                  className="bg-black/60 px-4 py-6 backdrop-blur-sm"
                >
                  <dt className="flex items-baseline justify-center text-2xl font-semibold tracking-tight sm:text-3xl">
                    <SlidingNumber
                      number={s.value}
                      fromNumber={0}
                      decimalPlaces={s.decimals}
                      delay={400}
                      inView
                    />
                    <span>{s.suffix}</span>
                  </dt>
                  <dd className="mt-1 text-xs text-white/50 sm:text-sm">
                    {t(s.label)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </StarsBackground>

        {/* Features */}
        <section
          id="recursos"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-24"
        >
          <Reveal className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("home.features.heading")}
            </h2>
            <p className="mt-3 text-white/60">{t("home.features.sub")}</p>
          </Reveal>
          <Reveal
            delay={0.1}
            className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4"
          >
            {features.map((f) => (
              <div
                key={f.titleKey}
                className="group bg-black p-6 transition-colors hover:bg-white/[0.03]"
              >
                <f.icon className="h-6 w-6 text-white/80" strokeWidth={1.5} />
                <h3 className="mt-4 font-medium">{t(f.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {t(f.descKey)}
                </p>
              </div>
            ))}
          </Reveal>
        </section>

        {/* Infra + tecnologias */}
        <section className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-24">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Reveal className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
              <h3 className="text-2xl font-semibold tracking-tight">
                {t("home.infra.center.title")}
              </h3>
              <p className="mt-3 max-w-md text-white/60">
                {t("home.infra.center.desc")}
              </p>
              <div className="mt-4 flex flex-1 items-center">
                <ConnectivityBeams />
              </div>
            </Reveal>

            <Reveal
              delay={0.1}
              className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8"
            >
              <h3 className="text-2xl font-semibold tracking-tight">
                {t("home.infra.tech.title")}
              </h3>
              <p className="mt-3 max-w-md text-white/60">
                {t("home.infra.tech.desc")}
              </p>
              <div className="mt-2 flex flex-1 items-center justify-center">
                <TechCloud />
              </div>
            </Reveal>
          </div>
        </section>

        {/* Testimonials */}
        <Testimonials />

        {/* Pricing */}
        <section
          id="planos"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-24"
        >
          <Reveal className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("home.pricing.heading")}
            </h2>
            <p className="mt-3 text-white/60">{t("home.pricing.sub")}</p>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => {
              const highlight = i === 1;
              const price = (p.price_cents / 100).toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
              });
              const specs = [
                `${p.vcpu} vCPU`,
                `${p.ram_gb} GB RAM`,
                `${p.disk_gb} GB NVMe`,
                t("home.spec.traffic"),
              ];
              return (
                <Reveal
                  key={p.id}
                  delay={(i % 4) * 0.08}
                  className={`relative flex flex-col rounded-2xl border p-6 ${highlight
                    ? "border-white/30 bg-white/[0.06]"
                    : "border-white/10 bg-white/[0.02]"
                    }`}
                >
                  {highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                      {t("home.pricing.popular")}
                    </span>
                  )}
                  <div className="flex items-center gap-2 text-white/70">
                    <Server className="h-4 w-4" strokeWidth={1.5} />
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="mt-5 flex items-end gap-1">
                    <span className="text-sm text-white/50">R$</span>
                    <span className="text-4xl font-semibold tracking-tight">
                      {price}
                    </span>
                    <span className="mb-1 text-sm text-white/50">
                      {t("home.pricing.month")}
                    </span>
                  </div>
                  <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
                    {specs.map((sp) => (
                      <li key={sp} className="flex items-center gap-2 text-white/70">
                        <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                        {sp}
                      </li>
                    ))}
                  </ul>
                  <PlanCta highlight={highlight} />
                </Reveal>
              );
            })}
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-white/40">
            <Cpu className="h-4 w-4" strokeWidth={1.5} />
            {t("home.pricing.note")}
          </p>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-24"
        >
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-20 xl:gap-28">
            {/* Header */}
            <Reveal className="lg:sticky lg:top-28">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("home.faq.heading")}
              </h2>
              <p className="mt-4 max-w-[34ch] text-white/60">
                {t("home.faq.sub")}
              </p>
              <ActionButton href="#planos" className="mt-7">
                {t("home.faq.cta")}
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            </Reveal>

            {/* Accordion */}
            <Reveal delay={0.1}>
              <FaqAccordion
                items={faqs.map((f) => ({ q: t(f.qKey), a: t(f.aKey) }))}
              />
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-6xl px-6 py-24">
          <Reveal className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] px-8 py-16 text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("home.cta.heading")}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white/60">
              {t("home.cta.sub")}
            </p>
            <ActionButton
              href="#planos"
              effect="flip"
              backLabel="Bora! →"
              className="mt-8"
            >
              {t("home.cta.button")}
            </ActionButton>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
