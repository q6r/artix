"use client";

import Link from "next/link";
import { ChevronRight, Plus, Boxes } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import ContainerStatusBadge from "@/components/containers/ContainerStatusBadge";
import { useQuery } from "@/lib/api/query";
import type { Server } from "@/lib/api/types";

function Row({ c }: { c: Server }) {
  const { t } = useLang();
  return (
    <Link
      href={`/dashboard/containers/${c.id}`}
      className="flex items-center gap-4 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
        <Boxes className="h-4 w-4 text-white/70" strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{c.name}</p>
          <ContainerStatusBadge status={c.container?.status} />
        </div>
        <p className="truncate text-xs text-white/45">
          {c.container?.container_type === "site" ? "Site" : "Bot de Discord"}
          {c.container?.runtime ? ` · ${c.container.runtime}` : ""}
          {!c.container?.deployed ? ` · ${t("cont.notDeployed")}` : ""}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="text-xs uppercase text-white/45">{c.plan}</p>
        <p className="text-sm font-medium">{c.container?.ram_mb ?? 256} MB</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
    </Link>
  );
}

export default function ContainersClient() {
  const { t } = useLang();
  const { data, error, loading } = useQuery<Server[]>("containers", { refreshInterval: 8000 });
  // Defensive: only render actual containers even if the endpoint ever mixes rows.
  const containers = (data ?? []).filter((s) => s.type === 1);

  if (loading) return <ListSkeleton />;
  if (error || !data) return <p className="text-sm text-red-300">{t("cont.error")}</p>;

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("cont.title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("cont.subtitle")}</p>
        </div>
        <Link
          href="/dashboard/billing/new"
          className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          <Plus className="h-4 w-4" />
          {t("cont.new")}
        </Link>
      </FadeIn>

      {containers.length === 0 ? (
        <FadeIn
          delay={0.08}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center"
        >
          <p className="text-lg font-semibold tracking-tight">{t("cont.empty.title")}</p>
          <p className="mt-1 max-w-sm text-sm text-white/50">{t("cont.empty.desc")}</p>
          <Link
            href="/dashboard/billing/new"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            {t("cont.new")}
          </Link>
        </FadeIn>
      ) : (
        <FadeIn
          delay={0.08}
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10"
        >
          {containers.map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </FadeIn>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="hidden h-8 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
