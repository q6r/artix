"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { useQuery } from "@/lib/api/query";
import { CreateContainerForm, BuyRamPacks, RamUsage } from "@/components/containers/CreateContainer";
import type { PlansResponse, RamBalance } from "@/lib/api/types";

/** Full-page version of the create-container flow (create + buy-RAM tabs). */
export default function CreateContainerClient() {
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "buy">("create");
  const { data: plansData } = useQuery<PlansResponse>("billing/plans");
  const { data: ram } = useQuery<RamBalance>("containers/ram");

  const seg = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      active ? "bg-white text-black" : "text-white/60 hover:text-white"
    }`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FadeIn>
        <Link
          href="/dashboard/containers"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("cont.title")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("cont.create.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("cont.create.desc")}</p>
      </FadeIn>

      <RamUsage ram={ram} onBuy={() => setTab("buy")} />

      <FadeIn delay={0.05} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-4 inline-flex w-full rounded-xl border border-white/10 bg-white/[0.03] p-1">
          <button onClick={() => setTab("create")} className={seg(tab === "create")}>
            {t("cont.create")}
          </button>
          <button onClick={() => setTab("buy")} className={seg(tab === "buy")}>
            {t("cont.ram.buy")}
          </button>
        </div>

        {tab === "create" ? (
          <CreateContainerForm
            onCreated={(id) => router.push(`/dashboard/containers/${id}`)}
            onBuyRam={() => setTab("buy")}
          />
        ) : (
          <BuyRamPacks plans={plansData?.container_plans} />
        )}
      </FadeIn>
    </div>
  );
}
