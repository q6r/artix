"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Gift, Loader2, MemoryStick } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import Select from "@/components/Select";
import { useLang } from "@/components/LanguageProvider";
import { useToast } from "@/components/FeedbackProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import {
  formatMoney,
  type Checkout,
  type ContainerPlan,
  type PlansResponse,
  type RamBalance,
  type Server,
} from "@/lib/api/types";

export function fmtRam(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

const RAM_SIZES = [256, 512, 1024, 2048, 4096, 6144, 8192];

// Valid Minecraft versions PER SOFTWARE — the 1.8 slot differs: Vanilla/Forge
// have a real 1.8.9 server, Paper/Purpur only go to 1.8.8 (1.8.9 clients still
// connect to it), and Fabric only supports 1.14+. Keeps invalid combos (which
// crash-loop the itzg image, e.g. Paper 1.8.9) out of the dropdown.
const MC_BASE = ["1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5"];
function mcVersionsFor(edition: string, software: string): string[] {
  if (edition === "bedrock") return ["LATEST"];
  switch (software) {
    case "VANILLA":
    case "FORGE":
      return ["LATEST", ...MC_BASE, "1.12.2", "1.8.9"];
    case "FABRIC":
      return ["LATEST", ...MC_BASE, "1.14.4"];
    default: // PAPER, PURPUR
      return ["LATEST", ...MC_BASE, "1.12.2", "1.8.8"];
  }
}

/** Usage bar + (when relevant) a claim-free / buy-more affordance. */
export function RamUsage({ ram, onBuy }: { ram?: RamBalance; onBuy?: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  if (!ram) return <Skeleton className="h-24 rounded-2xl" />;

  const pct = ram.total_mb > 0 ? Math.min(100, Math.round((ram.used_mb / ram.total_mb) * 100)) : 0;

  const claim = async () => {
    setClaiming(true);
    try {
      await api("containers/claim-free", { method: "POST" });
      await mutate("containers/ram");
      toast(t("cont.ram.claimed"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white/55">{t("cont.ram.available")}</span>
        <span>
          <span className="text-lg font-semibold">{fmtRam(ram.available_mb)}</span>
          <span className="text-white/45"> / {fmtRam(ram.total_mb)}</span>
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-white/70 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-white/40">
          {t("cont.ram.used")}: {fmtRam(ram.used_mb)}
        </span>
        {!ram.free_claimed ? (
          <button
            onClick={claim}
            disabled={claiming}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {claiming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
            {t("cont.ram.claim")} ({fmtRam(ram.free_grant_mb)})
          </button>
        ) : onBuy ? (
          <button onClick={onBuy} className="text-xs font-medium text-white/60 transition-colors hover:text-white">
            {t("cont.ram.buy")} →
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The create-container form. Handles the empty-pool states (claim / buy) too. */
export function CreateContainerForm({
  onCreated,
  onBuyRam,
}: {
  onCreated: (id: string) => void;
  onBuyRam: () => void;
}) {
  const { t } = useLang();
  const toast = useToast();
  const { data: ram } = useQuery<RamBalance>("containers/ram");
  const [ctype, setCtype] = useState<"discord_bot" | "site" | "minecraft" | "voice">("discord_bot");
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [ramMb, setRamMb] = useState(256);
  const [edition, setEdition] = useState<"java" | "bedrock">("java");
  const [software, setSoftware] = useState("PAPER");
  const [mcVersion, setMcVersion] = useState("LATEST");
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const min =
    ctype === "minecraft"
      ? 1024
      : ctype === "voice"
        ? 512
        : ctype === "site"
          ? (ram?.site_min_mb ?? 512)
          : (ram?.bot_min_mb ?? 256);

  // Version list depends on edition/software; reset if the current pick is no
  // longer valid (e.g. switching Vanilla 1.8.9 -> Paper, which lacks 1.8.9).
  const mcVersionOptions = mcVersionsFor(edition, software);
  useEffect(() => {
    if (!mcVersionOptions.includes(mcVersion)) setMcVersion("LATEST");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edition, software]);
  const available = ram?.available_mb ?? 0;
  useEffect(() => {
    setRamMb((r) => (r < min ? min : r));
  }, [min]);
  const sizes = RAM_SIZES.filter((s) => s >= min);

  const claim = async () => {
    setClaiming(true);
    try {
      await api("containers/claim-free", { method: "POST" });
      await mutate("containers/ram");
      toast(t("cont.ram.claimed"), "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("cont.error"));
    } finally {
      setClaiming(false);
    }
  };

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
          ram_mb: ramMb,
          ...((ctype === "site" || ctype === "minecraft") && subdomain.trim()
            ? { subdomain: subdomain.trim() }
            : {}),
          ...(ctype === "minecraft"
            ? {
                edition,
                ...(edition === "java" ? { software } : {}),
                version: mcVersion.trim() || "LATEST",
              }
            : {}),
        },
      });
      await mutate("containers");
      await mutate("containers/ram");
      onCreated(out.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cont.error"));
      setBusy(false);
    }
  };

  if (!ram) return <Skeleton className="h-64 rounded-2xl" />;

  // Nothing left to allocate → claim the free grant (if never claimed) or buy.
  if (available < (ram.bot_min_mb ?? 256)) {
    const claimable = !ram.free_claimed;
    return (
      <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          {claimable ? (
            <Gift className="h-5 w-5 text-emerald-300" />
          ) : (
            <MemoryStick className="h-5 w-5 text-white/50" />
          )}
        </span>
        <p className="mt-4 text-base font-semibold">
          {claimable ? t("cont.ram.noneTitle") : t("cont.ram.fullTitle")}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-white/50">
          {claimable ? t("cont.ram.noneDesc") : t("cont.ram.fullDesc")}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          {claimable && (
            <button
              onClick={claim}
              disabled={claiming}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
              {t("cont.ram.claim")} ({fmtRam(ram.free_grant_mb)})
            </button>
          )}
          <button
            onClick={onBuyRam}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("cont.ram.buy")} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </FadeIn>
    );
  }

  const seg = (active: boolean) =>
    `flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
      active ? "border-white/30 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
    }`;

  return (
    <FadeIn className="space-y-4">
      <div>
        <span className="mb-2 block text-sm font-medium text-white/70">{t("cont.type.q")}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button type="button" onClick={() => setCtype("discord_bot")} className={seg(ctype === "discord_bot")}>
            <span className="text-sm font-medium">{t("cont.type.bot")}</span>
            <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.botDesc")}</span>
          </button>
          <button type="button" onClick={() => setCtype("site")} className={seg(ctype === "site")}>
            <span className="text-sm font-medium">{t("cont.type.site")}</span>
            <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.siteDesc")}</span>
          </button>
          <button type="button" onClick={() => setCtype("minecraft")} className={seg(ctype === "minecraft")}>
            <span className="text-sm font-medium">{t("cont.type.minecraft")}</span>
            <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.mcDesc")}</span>
          </button>
          <button type="button" onClick={() => setCtype("voice")} className={seg(ctype === "voice")}>
            <span className="text-sm font-medium">{t("cont.type.voice")}</span>
            <span className="mt-0.5 block text-xs text-white/45">{t("cont.type.voiceDesc")}</span>
          </button>
        </div>
      </div>

      {ctype === "minecraft" && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <span className="mb-2 block text-sm font-medium text-white/70">{t("cont.mc.edition")}</span>
            <div className="grid grid-cols-2 gap-2">
              {(["java", "bedrock"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEdition(e)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                    edition === e
                      ? "border-white/40 bg-white/[0.08] text-white"
                      : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/[0.05]"
                  }`}
                >
                  {e === "java" ? "Java" : "Bedrock"}
                </button>
              ))}
            </div>
          </div>
          {edition === "java" && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("cont.mc.software")}</span>
              <Select
                value={software}
                onChange={setSoftware}
                className="h-11 px-4 text-sm"
                options={["VANILLA", "PAPER", "PURPUR", "FABRIC", "FORGE"].map((s) => ({
                  value: s,
                  label: s.charAt(0) + s.slice(1).toLowerCase(),
                }))}
              />
            </label>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("cont.mc.version")}</span>
            <Select
              value={mcVersion}
              onChange={setMcVersion}
              className="h-11 px-4 text-sm"
              options={mcVersionOptions.map((v) => ({
                value: v,
                label: v === "LATEST" ? t("cont.mc.latest") : v,
              }))}
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-white/70">{t("cont.name")}</span>
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder={t("cont.namePlaceholder")}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30"
        />
      </label>

      {(ctype === "site" || ctype === "minecraft") && (
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">
            {ctype === "minecraft" ? t("cont.mc.subdomain") : t("cont.subdomain")}
          </span>
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-white/30">
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder={ctype === "minecraft" ? "meuserver" : t("cont.subdomainPlaceholder")}
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
            <span className="shrink-0 text-sm text-white/40">.artix.cloud</span>
          </div>
        </label>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-white/70">{t("cont.ram.label")}</span>
          <span className="text-xs text-white/40">
            {t("cont.ram.min")}: {fmtRam(min)} · {t("cont.ram.available")}: {fmtRam(available)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sizes.map((s) => {
            const ok = s <= available;
            const active = ramMb === s;
            return (
              <button
                key={s}
                type="button"
                disabled={!ok}
                onClick={() => setRamMb(s)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : ok
                      ? "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/[0.05]"
                      : "cursor-not-allowed border-white/5 text-white/25"
                }`}
              >
                {fmtRam(s)}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex justify-end pt-1">
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? t("cont.creating") : t("cont.create")}
        </button>
      </div>
    </FadeIn>
  );
}

/** RAM packs to purchase (redirects to the invoice on checkout). */
export function BuyRamPacks({ plans }: { plans?: ContainerPlan[] }) {
  const { t } = useLang();
  const router = useRouter();
  const [pick, setPick] = useState<ContainerPlan | null>(null);
  const [method, setMethod] = useState<"crypto" | "stripe" | "pix">("crypto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<Checkout>("containers/purchase", {
        method: "POST",
        json: { plan: pick.id, method },
      });
      void mutate("billing/subscriptions");
      void mutate("billing/invoices");
      router.push(`/dashboard/billing/${out.invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cont.error"));
      setBusy(false);
    }
  };

  const paid = (plans ?? []).filter((p) => p.price_cents > 0);
  if (!plans)
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );

  return (
    <FadeIn className="space-y-4">
      <p className="text-sm text-white/55">{t("cont.ram.buyDesc")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {paid.map((p) => {
          const active = pick?.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPick(p)}
              className={`relative rounded-2xl border p-4 text-left transition-colors ${
                active ? "border-white/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              {active && <Check className="absolute right-3 top-3 h-4 w-4 text-white" strokeWidth={2.4} />}
              <p className="text-lg font-semibold">{fmtRam(p.ram_mb)} RAM</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">
                {formatMoney(p.price_cents, p.currency)}
                <span className="text-xs font-normal text-white/45">{t("bill.perMonth")}</span>
              </p>
            </button>
          );
        })}
      </div>

      {pick && (
        <FadeIn className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("bill.method.label")}</span>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "crypto" as const, label: t("bill.method.crypto") },
                { id: "pix" as const, label: t("bill.method.pix") },
                { id: "stripe" as const, label: t("bill.method.card") },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMethod(opt.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    method === opt.id
                      ? "border-white bg-white/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06]"
                  }`}
                >
                  {method === opt.id && <Check className="h-3.5 w-3.5" />}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/55">
              {fmtRam(pick.ram_mb)} · {formatMoney(pick.price_cents, pick.currency)}
              {t("bill.perMonth")}
            </span>
            <button
              onClick={buy}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? t("cont.creating") : t("cont.plan.goPay")}
            </button>
          </div>
        </FadeIn>
      )}
    </FadeIn>
  );
}
