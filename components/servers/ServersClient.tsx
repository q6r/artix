"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Server as ServerIcon } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Skeleton from "@/components/Skeleton";
import { useLang } from "@/components/LanguageProvider";
import { useSubscription } from "@/hooks/use-subscription";
import ServerStateBadge from "@/components/servers/ServerStateBadge";
import { useQuery, mutate } from "@/lib/api/query";
import type { Server, ServerState, ServerStat } from "@/lib/api/types";

function Row({ server }: { server: Server }) {
  const { t } = useLang();
  const [state, setState] = useState<ServerState>(server.state);

  // Live state over the gateway socket.
  useSubscription(`server:${server.id}`, (event, data) => {
    if (event === "stat") {
      const d = data as ServerStat;
      if (d.state) setState(d.state);
    }
  });

  return (
    <Link
      href={`/dashboard/servers/${server.id}`}
      className="flex items-center gap-4 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
        <ServerIcon className="h-4 w-4 text-white/70" strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{server.name}</p>
          <ServerStateBadge state={state} />
        </div>
        <p className="truncate text-xs text-white/45">
          {server.os}
          {server.ssh_host ? ` · ${server.ssh_host}:${server.ssh_port}` : ""}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="text-xs uppercase text-white/45">{server.plan}</p>
        <p className="text-sm font-medium">
          {server.specs.vcpu} {t("srv.specs.vcpu")} · {server.specs.ram_gb} GB
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
    </Link>
  );
}

export default function ServersClient() {
  const { t } = useLang();
  const { data: servers, error, loading } = useQuery<Server[]>("servers");

  const provisioning = !!servers?.some(
    (s) => !s.ip && s.state !== "suspended" && s.state !== "stopped" && s.state !== "error",
  );

  // Refresh while a VPS is still provisioning so the IP shows + banner clears.
  useEffect(() => {
    if (!provisioning) return;
    const id = setInterval(() => mutate("servers"), 12000);
    return () => clearInterval(id);
  }, [provisioning]);

  if (loading) return <ServersSkeleton />;
  if (error || !servers) return <p className="text-sm text-red-300">{t("srv.error")}</p>;

  return (
    <div className="space-y-6">
      <FadeIn className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("srv.title")}</h1>
          <p className="mt-1 text-sm text-white/55">
            {servers.length} {t("srv.count")}
          </p>
        </div>
        <Link
          href="/dashboard/billing/new"
          className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          <Plus className="h-4 w-4" />
          {t("srv.new")}
        </Link>
      </FadeIn>

      {provisioning && (
        <FadeIn
          delay={0.04}
          className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <p className="text-sm text-amber-200/90">{t("srv.provisioning")}</p>
        </FadeIn>
      )}

      {servers.length === 0 ? (
        <FadeIn
          delay={0.08}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center"
        >
          <p className="text-lg font-semibold tracking-tight">{t("srv.empty.title")}</p>
          <p className="mt-1 max-w-sm text-sm text-white/50">{t("srv.empty.desc")}</p>
          <Link
            href="/dashboard/billing/new"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            {t("srv.new")}
          </Link>
        </FadeIn>
      ) : (
        <FadeIn
          delay={0.08}
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10"
        >
          {servers.map((s) => (
            <Row key={s.id} server={s} />
          ))}
        </FadeIn>
      )}
    </div>
  );
}

function ServersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {Array.from({ length: 4 }).map((_, i) => (
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
