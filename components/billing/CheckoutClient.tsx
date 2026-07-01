"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Lock, Server as ServerIcon, Boxes } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import { formatMoney, type Checkout, type PlansResponse, type Server } from "@/lib/api/types";

type Country = { id: string; name: string; ms: string; soon?: boolean };
const COUNTRIES: Country[] = [
  { id: "br", name: "Brasil", ms: "~5 ms" },
  { id: "us", name: "Estados Unidos", ms: "~120 ms", soon: true },
  { id: "de", name: "Alemanha", ms: "~210 ms", soon: true },
  { id: "es", name: "Espanha", ms: "~190 ms", soon: true },
];

function Flag({ code, size = 26, className = "" }: { code: string; size?: number; className?: string }) {
  // flag-icons (self-hosted CSS) — emoji flags don't render on Windows/Chrome.
  // Size via font-size so the library keeps the flag's 4:3 aspect (no squish).
  return (
    <span
      className={`fi fi-${code} shrink-0 rounded-sm ${className}`}
      style={{ fontSize: size }}
      aria-hidden="true"
    />
  );
}

type Sys = { id: string; name: string; icon: string; versions: string[] };
const SYSTEMS: Sys[] = [
  { id: "ubuntu", name: "Ubuntu", icon: "ubuntu", versions: ["24.04 LTS", "22.04 LTS"] },
  { id: "debian", name: "Debian", icon: "debian", versions: ["12"] },
  { id: "almalinux", name: "AlmaLinux", icon: "almalinux", versions: ["9"] },
  { id: "rockylinux", name: "Rocky Linux", icon: "rockylinux", versions: ["9"] },
];
const DATABASES = [
  { id: "mongodb", name: "MongoDB", icon: "mongodb" },
  { id: "supabase", name: "Supabase", icon: "supabase" },
  { id: "elasticsearch", name: "Elasticsearch", icon: "elasticsearch" },
];

function OsLogo({ slug, className = "h-8 w-8" }: { slug: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://cdn.simpleicons.org/${slug}/white`} alt="" className={className} />;
}

export default function CheckoutClient() {
  const { t } = useLang();
  const router = useRouter();
  const { data: plansData } = useQuery<PlansResponse>("billing/plans");

  // Before the VPS wizard: choose what to host. `null` = show the chooser.
  const [hostType, setHostType] = useState<"vps" | "container" | null>(null);
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState("br");
  const [osId, setOsId] = useState("ubuntu");
  const [version, setVersion] = useState("24.04 LTS");
  const [planId, setPlanId] = useState<string>("cloud4");
  const [vcpu, setVcpu] = useState(2);
  const [ram, setRam] = useState(8);
  const [disk, setDisk] = useState(80);
  const [name, setName] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [method, setMethod] = useState<"crypto" | "stripe" | "pix">("crypto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sys = SYSTEMS.find((s) => s.id === osId) ?? SYSTEMS[0];
  const custom = plansData?.custom;
  const isCustom = planId === "custom";

  const fixedPlan = plansData?.plans.find((p) => p.id === planId);
  const priceCents = isCustom
    ? custom
      ? vcpu * custom.vcpu_cents + ram * custom.ram_cents + disk * custom.disk_cents
      : 0
    : (fixedPlan?.price_cents ?? 0);

  const specs = isCustom
    ? { vcpu, ram_gb: ram, disk_gb: disk }
    : fixedPlan
      ? { vcpu: fixedPlan.vcpu, ram_gb: fixedPlan.ram_gb, disk_gb: fixedPlan.disk_gb }
      : null;

  const steps = [t("wiz.step.country"), t("wiz.step.system"), t("wiz.step.plan"), t("wiz.step.pay")];
  const canNext = step === 3 ? !!name.trim() : true;

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const os = `${sys.name} ${version}`;
      const payload = isCustom
        ? { plan: "custom", name: name.trim(), os, ssh_key: sshKey.trim() || undefined, vcpu, ram_gb: ram, disk_gb: disk, method }
        : { plan: planId, name: name.trim(), os, ssh_key: sshKey.trim() || undefined, method };
      const out = await api<Checkout>("billing/subscriptions", { method: "POST", json: payload });
      void mutate("billing/subscriptions");
      void mutate("billing/invoices");
      void mutate("servers");
      router.push(`/dashboard/billing/${out.invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bill.error"));
      setBusy(false);
    }
  };

  if (hostType === null) return <HostTypeChooser onPick={setHostType} />;
  if (hostType === "container") return <CreateBotForm onBack={() => setHostType(null)} />;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("wiz.back")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("wiz.title")}</h1>
      </div>

      <div className="flex items-center">
        {steps.map((label, i) => (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className="flex items-center gap-2"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < step
                    ? "bg-white text-black"
                    : i === step
                      ? "border border-white bg-white/10 text-white"
                      : "border border-white/15 text-white/40"
                }`}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`hidden text-xs font-medium sm:block ${i <= step ? "text-white" : "text-white/40"}`}>
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={`mx-2 h-px flex-1 ${i < step ? "bg-white/40" : "bg-white/10"}`} />
            )}
          </div>
        ))}
      </div>

      <FadeIn key={step} className="min-h-[280px]">
        {step === 0 && <CountryStep value={country} onChange={setCountry} />}
        {step === 1 && (
          <SystemStep osId={osId} setOsId={setOsId} version={version} setVersion={setVersion} />
        )}
        {step === 2 && (
          <PlanStep
            plansData={plansData}
            planId={planId}
            setPlanId={setPlanId}
            vcpu={vcpu}
            setVcpu={setVcpu}
            ram={ram}
            setRam={setRam}
            disk={disk}
            setDisk={setDisk}
            priceCents={priceCents}
          />
        )}
        {step === 3 && (
          <PayStep
            name={name}
            setName={setName}
            sshKey={sshKey}
            setSshKey={setSshKey}
            country={COUNTRIES.find((c) => c.id === country)!}
            osLabel={`${sys.name} ${version}`}
            osIcon={sys.icon}
            planLabel={isCustom ? t("wiz.plan.custom") : planId.toUpperCase()}
            specs={specs}
            priceCents={priceCents}
            method={method}
            setMethod={setMethod}
            error={error}
          />
        )}
      </FadeIn>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("wiz.prev")}
        </button>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(3, s + 1))}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("wiz.next")}
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || !canNext}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? t("wiz.pay.creating") : t("wiz.pay.submit")}
          </button>
        )}
      </div>
    </div>
  );
}

function CountryStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("wiz.country.title")}</h2>
        <p className="mt-1 text-sm text-white/55">{t("wiz.country.subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {COUNTRIES.map((c) => {
          const active = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={c.soon}
              onClick={() => onChange(c.id)}
              className={`relative flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                c.soon
                  ? "cursor-not-allowed border-white/10 bg-white/[0.01] opacity-60"
                  : active
                    ? "border-white/40 bg-white/[0.05]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <Flag code={c.id} />
              <div className="flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-white/45">
                  {t("wiz.latency")}: {c.ms}
                </p>
              </div>
              {c.soon ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/55">
                  <Lock className="h-3 w-3" /> {t("wiz.soon")}
                </span>
              ) : (
                active && <Check className="h-4 w-4 text-white" strokeWidth={2.4} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SystemStep({
  osId,
  setOsId,
  version,
  setVersion,
}: {
  osId: string;
  setOsId: (v: string) => void;
  version: string;
  setVersion: (v: string) => void;
}) {
  const { t } = useLang();
  const sys = SYSTEMS.find((s) => s.id === osId) ?? SYSTEMS[0];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("wiz.system.title")}</h2>
        <p className="mt-1 text-sm text-white/55">{t("wiz.system.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SYSTEMS.map((s) => {
          const active = osId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOsId(s.id);
                setVersion(s.versions[0]);
              }}
              className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-colors ${
                active ? "border-white/40 bg-white/[0.05]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <OsLogo slug={s.icon} className="h-9 w-9" />
              <span className="text-sm font-medium">{s.name}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/55">{t("wiz.system.version")}:</span>
        {sys.versions.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVersion(v)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              version === v ? "border-white/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-4">
        <div>
          <p className="text-sm font-medium text-white/70">{t("wiz.system.databases")}</p>
          <p className="text-xs text-white/40">{t("wiz.system.databasesDesc")}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {DATABASES.map((d) => (
            <div
              key={d.id}
              className="relative flex cursor-not-allowed flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.01] p-3 opacity-60"
            >
              <OsLogo slug={d.icon} className="h-7 w-7" />
              <span className="text-xs font-medium">{d.name}</span>
              <span className="absolute right-2 top-2">
                <Lock className="h-3 w-3 text-white/40" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanStep({
  plansData,
  planId,
  setPlanId,
  vcpu,
  setVcpu,
  ram,
  setRam,
  disk,
  setDisk,
  priceCents,
}: {
  plansData: PlansResponse | undefined;
  planId: string;
  setPlanId: (v: string) => void;
  vcpu: number;
  setVcpu: (v: number) => void;
  ram: number;
  setRam: (v: number) => void;
  disk: number;
  setDisk: (v: number) => void;
  priceCents: number;
}) {
  const { t } = useLang();
  if (!plansData) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }
  const cur = plansData.currency;
  const c = plansData.custom;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("wiz.plan.title")}</h2>
        <p className="mt-1 text-sm text-white/55">{t("wiz.plan.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plansData.plans.map((p) => {
          const active = planId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanId(p.id)}
              className={`relative rounded-2xl border p-4 text-left transition-colors ${
                active ? "border-white/40 bg-white/[0.05]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              {active && <Check className="absolute right-3 top-3 h-4 w-4 text-white" strokeWidth={2.4} />}
              <p className="text-sm font-semibold uppercase tracking-wide">{p.id}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">
                {formatMoney(p.price_cents, p.currency)}
                <span className="text-xs font-normal text-white/45">{t("bill.perMonth")}</span>
              </p>
              <p className="mt-2 text-xs text-white/50">
                {p.vcpu} {t("wiz.custom.vcpu")} · {p.ram_gb}GB RAM · {p.disk_gb}GB
              </p>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setPlanId("custom")}
          className={`relative rounded-2xl border p-4 text-left transition-colors sm:col-span-2 ${
            planId === "custom" ? "border-white/40 bg-white/[0.05]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
          }`}
        >
          {planId === "custom" && <Check className="absolute right-3 top-3 h-4 w-4 text-white" strokeWidth={2.4} />}
          <p className="text-sm font-semibold">{t("wiz.plan.custom")}</p>
          <p className="mt-1 text-xs text-white/50">{t("wiz.plan.customDesc")}</p>
        </button>
      </div>

      {planId === "custom" && (
        <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <RangeRow
            label={t("wiz.custom.vcpu")}
            value={vcpu}
            min={c.vcpu_min}
            max={c.vcpu_max}
            step={1}
            onChange={setVcpu}
            suffix=""
          />
          <RangeRow
            label={t("wiz.custom.ram")}
            value={ram}
            min={c.ram_min}
            max={c.ram_max}
            step={1}
            onChange={setRam}
            suffix=" GB"
          />
          <RangeRow
            label={t("wiz.custom.disk")}
            value={disk}
            min={c.disk_min}
            max={c.disk_max}
            step={10}
            onChange={setDisk}
            suffix=" GB"
          />
          <div className="flex items-baseline justify-between border-t border-white/10 pt-4">
            <span className="text-sm text-white/55">{t("wiz.pay.total")}</span>
            <span className="text-2xl font-semibold tracking-tight">
              {formatMoney(priceCents, cur)}
              <span className="text-sm font-normal text-white/45">{t("bill.perMonth")}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-white"
      />
    </div>
  );
}

function PayStep({
  name,
  setName,
  sshKey,
  setSshKey,
  country,
  osLabel,
  osIcon,
  planLabel,
  specs,
  priceCents,
  method,
  setMethod,
  error,
}: {
  name: string;
  setName: (v: string) => void;
  sshKey: string;
  setSshKey: (v: string) => void;
  country: Country;
  osLabel: string;
  osIcon: string;
  planLabel: string;
  specs: { vcpu: number; ram_gb: number; disk_gb: number } | null;
  priceCents: number;
  method: "crypto" | "stripe" | "pix";
  setMethod: (v: "crypto" | "stripe" | "pix") => void;
  error: string | null;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("wiz.pay.title")}</h2>
        <p className="mt-1 text-sm text-white/55">{t("wiz.pay.subtitle")}</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-white/40">{t("wiz.pay.summary")}</p>
        <Line
          label={t("wiz.pay.region")}
          value={
            <span className="flex items-center gap-2">
              <Flag code={country.id} size={16} /> {country.name}
            </span>
          }
        />
        <Line
          label={t("wiz.pay.system")}
          value={
            <span className="flex items-center gap-2">
              <OsLogo slug={osIcon} className="h-4 w-4" /> {osLabel}
            </span>
          }
        />
        <Line
          label={t("wiz.pay.plan")}
          value={specs ? `${planLabel} · ${specs.vcpu} vCPU · ${specs.ram_gb}GB · ${specs.disk_gb}GB` : planLabel}
        />
        <div className="flex items-baseline justify-between border-t border-white/10 pt-3">
          <span className="text-white/55">{t("wiz.pay.total")}</span>
          <span className="text-xl font-semibold">
            {formatMoney(priceCents)}
            <span className="text-xs font-normal text-white/45">{t("bill.perMonth")}</span>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("wiz.pay.name")}</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("wiz.pay.namePlaceholder")}
            className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("wiz.pay.ssh")}</span>
          <textarea
            value={sshKey}
            onChange={(e) => setSshKey(e.target.value)}
            placeholder={t("wiz.pay.sshPlaceholder")}
            rows={2}
            className="resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs outline-none placeholder:text-white/35 focus:border-white/30"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("bill.method.label")}</span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              { id: "crypto" as const, label: t("bill.method.crypto") },
              { id: "pix" as const, label: t("bill.method.pix") },
              { id: "stripe" as const, label: t("bill.method.card") },
            ]).map((opt) => {
              const active = method === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMethod(opt.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    active
                      ? "border-white bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]"
                  }`}
                >
                  {active && <Check className="h-4 w-4" />}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-white/45">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

// ----------------------------- Host type chooser -----------------------------

function HostTypeChooser({ onPick }: { onPick: (t: "vps" | "container") => void }) {
  const { t } = useLang();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> {t("cont.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("cont.host.q")}</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => onPick("vps")}
          className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.04]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <ServerIcon className="h-5 w-5 text-white/80" strokeWidth={1.6} />
          </span>
          <p className="mt-4 text-lg font-semibold">{t("cont.host.vps")}</p>
          <p className="mt-1 text-sm text-white/55">{t("cont.host.vpsDesc")}</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-white/70 transition-colors group-hover:text-white">
            {t("cont.create")} <ArrowRight className="h-4 w-4" />
          </span>
        </button>
        <button
          onClick={() => onPick("container")}
          className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.04]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <Boxes className="h-5 w-5 text-white/80" strokeWidth={1.6} />
          </span>
          <div className="mt-4 flex items-center gap-2">
            <p className="text-lg font-semibold">{t("cont.host.container")}</p>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              {t("cont.host.free")}
            </span>
          </div>
          <p className="mt-1 text-sm text-white/55">{t("cont.host.containerDesc")}</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-white/70 transition-colors group-hover:text-white">
            {t("cont.create")} <ArrowRight className="h-4 w-4" />
          </span>
        </button>
      </div>
    </div>
  );
}

// ----------------------------- Create free bot -----------------------------

function CreateBotForm({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  const router = useRouter();
  const [ctype, setCtype] = useState<"discord_bot" | "site">("discord_bot");
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<Server>("containers", {
        method: "POST",
        json: {
          name: name.trim(),
          container_type: ctype,
          plan: "free",
          ...(ctype === "site" && subdomain.trim() ? { subdomain: subdomain.trim() } : {}),
        },
      });
      void mutate("containers");
      router.push(`/dashboard/containers/${out.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cont.error"));
      setBusy(false);
    }
  };

  const seg = (active: boolean) =>
    `flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
      active
        ? "border-white/30 bg-white/[0.06]"
        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
    }`;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> {t("cont.back")}
        </button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("cont.create.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("cont.create.desc")}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div>
          <span className="mb-2 block text-sm font-medium text-white/70">{t("cont.type.q")}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCtype("discord_bot")}
              className={seg(ctype === "discord_bot")}
            >
              <span className="text-sm font-medium">{t("cont.type.bot")}</span>
              <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.botDesc")}</span>
            </button>
            <button type="button" onClick={() => setCtype("site")} className={seg(ctype === "site")}>
              <span className="text-sm font-medium">{t("cont.type.site")}</span>
              <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.siteDesc")}</span>
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("cont.name")}</span>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("cont.namePlaceholder")}
            className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
          />
        </label>

        {ctype === "site" && (
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.subdomain")}</span>
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-white/30">
              <input
                value={subdomain}
                onChange={(e) =>
                  setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                placeholder={t("cont.subdomainPlaceholder")}
                className="h-11 flex-1 bg-transparent text-sm outline-none"
              />
              <span className="shrink-0 text-sm text-white/40">.apps.artix.cloud</span>
            </div>
            <span className="text-xs text-white/40">{t("cont.subdomainHint")}</span>
          </label>
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onBack}
            className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
          >
            {t("cont.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="inline-flex h-10 items-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? t("cont.creating") : t("cont.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
