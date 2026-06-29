"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Cpu,
  HardDrive,
  KeyRound,
  Loader2,
  MemoryStick,
  Server,
} from "lucide-react";
import Select from "@/components/Select";
import { useLang } from "@/components/LanguageProvider";

const stepKeys = [
  "dash.wizard.step.region",
  "dash.wizard.step.system",
  "dash.wizard.step.plan",
  "dash.wizard.step.config",
  "dash.wizard.step.summary",
];

const regions = [
  { id: "sp", name: "São Paulo", country: "Brasil 🇧🇷", latency: "~5 ms" },
  { id: "mia", name: "Miami", country: "EUA 🇺🇸", latency: "~120 ms", soon: true },
  { id: "fra", name: "Frankfurt", country: "Alemanha 🇩🇪", latency: "~210 ms", soon: true },
];

const images = [
  { id: "ubuntu", name: "Ubuntu", versions: ["24.04 LTS", "22.04 LTS"] },
  { id: "debian", name: "Debian", versions: ["12", "11"] },
  { id: "alma", name: "AlmaLinux", versions: ["9", "8"] },
  { id: "rocky", name: "Rocky Linux", versions: ["9", "8"] },
  { id: "windows", name: "Windows Server", versions: ["2022", "2019"] },
];

const plans = [
  { id: "cloud2", name: "Cloud 2", vcpu: 2, ram: 4, disk: 50, price: 39 },
  { id: "cloud4", name: "Cloud 4", vcpu: 4, ram: 8, disk: 100, price: 79 },
  { id: "cloud8", name: "Cloud 8", vcpu: 8, ram: 16, disk: 200, price: 149 },
  { id: "cloud16", name: "Cloud 16", vcpu: 8, ram: 32, disk: 400, price: 289 },
];

export default function CreateServerWizard() {
  const router = useRouter();
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState("sp");
  const [imageId, setImageId] = useState("ubuntu");
  const [version, setVersion] = useState("24.04 LTS");
  const [planId, setPlanId] = useState("cloud4");
  const [hostname, setHostname] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [creating, setCreating] = useState(false);

  const image = images.find((i) => i.id === imageId)!;
  const plan = plans.find((p) => p.id === planId)!;
  const reg = regions.find((r) => r.id === region)!;

  const next = () => setStep((s) => Math.min(s + 1, stepKeys.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const create = () => {
    setCreating(true);
    setTimeout(() => router.push("/dashboard/servers"), 1300);
  };

  const cardCls = (active: boolean) =>
    `rounded-2xl border p-4 text-left transition-colors ${
      active
        ? "border-white/40 bg-white/[0.06]"
        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
    }`;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href="/dashboard/servers"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("dash.wizard.back")}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {t("dash.wizard.title")}
        </h1>
      </div>

      {/* Stepper */}
      <div className="flex items-center">
        {stepKeys.map((labelKey, i) => (
          <div key={labelKey} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
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
              <span
                className={`hidden text-xs font-medium sm:block ${
                  i <= step ? "text-white" : "text-white/40"
                }`}
              >
                {t(labelKey)}
              </span>
            </div>
            {i < stepKeys.length - 1 && (
              <span
                className={`mx-2 h-px flex-1 ${
                  i < step ? "bg-white/40" : "bg-white/10"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {regions.map((r) => (
                <button
                  key={r.id}
                  disabled={r.soon}
                  onClick={() => setRegion(r.id)}
                  className={`${cardCls(region === r.id)} disabled:opacity-40`}
                >
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-0.5 text-xs text-white/45">{r.country}</p>
                  <p className="mt-2 text-xs text-white/40">
                    {r.soon ? t("dash.wizard.soon") : `${t("dash.wizard.latency")} ${r.latency}`}
                  </p>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => {
                      setImageId(img.id);
                      setVersion(img.versions[0]);
                    }}
                    className={cardCls(imageId === img.id)}
                  >
                    <p className="font-medium">{img.name}</p>
                    <p className="mt-0.5 text-xs text-white/45">
                      {img.versions.length} {t("dash.wizard.versions")}
                    </p>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("dash.wizard.version")}</span>
                <Select
                  value={version}
                  onChange={setVersion}
                  className="h-11 px-4 text-sm sm:w-64"
                  options={image.versions.map((v) => ({ value: v, label: v }))}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlanId(p.id)}
                  className={cardCls(planId === p.id)}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm">
                      <span className="font-semibold">R$ {p.price}</span>
                      <span className="text-white/45">{t("dash.wizard.month")}</span>
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/55">
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3.5 w-3.5" /> {p.vcpu} vCPU
                    </span>
                    <span className="flex items-center gap-1">
                      <MemoryStick className="h-3.5 w-3.5" /> {p.ram} GB
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3.5 w-3.5" /> {p.disk} GB
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">
                  {t("dash.wizard.hostname")}
                </span>
                <input
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="ex.: web-prod-01"
                  className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">
                  {t("dash.wizard.sshKey")}{" "}
                  <span className="font-normal text-white/40">{t("dash.wizard.optional")}</span>
                </span>
                <textarea
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  rows={3}
                  placeholder="ssh-ed25519 AAAA..."
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs outline-none placeholder:text-white/35 focus:border-white/30"
                />
              </label>
              <p className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
                <KeyRound className="h-4 w-4 shrink-0" strokeWidth={1.6} />
                {t("dash.wizard.passwordNotice")}
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {[
                { label: t("dash.wizard.summary.region"), value: `${reg.name} · ${reg.country}` },
                { label: t("dash.wizard.summary.system"), value: `${image.name} ${version}` },
                {
                  label: t("dash.wizard.summary.plan"),
                  value: `${plan.name} — ${plan.vcpu} vCPU · ${plan.ram} GB · ${plan.disk} GB`,
                },
                { label: t("dash.wizard.summary.hostname"), value: hostname || t("dash.wizard.summary.autoGenerated") },
                { label: t("dash.wizard.summary.access"), value: sshKey ? t("dash.wizard.summary.sshKey") : t("dash.wizard.summary.rootByEmail") },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between gap-4 border-b border-white/10 bg-white/[0.02] px-4 py-3 text-sm last:border-0"
                >
                  <span className="text-white/50">{r.label}</span>
                  <span className="text-right font-medium">{r.value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between bg-white/[0.04] px-4 py-4">
                <span className="text-sm text-white/55">{t("dash.wizard.summary.totalMonthly")}</span>
                <span className="text-xl font-semibold">R$ {plan.price},00</span>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={back}
          disabled={step === 0}
          className="h-10 rounded-full border border-white/15 bg-white/5 px-5 text-sm transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
        >
          {t("dash.wizard.btn.back")}
        </button>
        {step < stepKeys.length - 1 ? (
          <button
            onClick={next}
            className="h-10 rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("dash.wizard.btn.continue")}
          </button>
        ) : (
          <button
            onClick={create}
            disabled={creating}
            className="flex h-10 items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-70"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("dash.wizard.btn.provisioning")}
              </>
            ) : (
              <>
                <Server className="h-4 w-4" strokeWidth={1.8} />
                {t("dash.wizard.btn.create")}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
