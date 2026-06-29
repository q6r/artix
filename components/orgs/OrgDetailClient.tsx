"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2, Plus, X } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import { useConfirm } from "@/components/FeedbackProvider";
import Skeleton from "@/components/Skeleton";
import Select from "@/components/Select";
import { SERVER_PERMS, type OrgDetail, type Server } from "@/lib/api/types";

type Tab = "servers" | "members" | "permissions";

export default function OrgDetailClient({ id }: { id: string }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const router = useRouter();
  const orgKey = `orgs/${id}`;
  const { data: org, error, loading } = useQuery<OrgDetail>(orgKey);
  const { data: myServersData } = useQuery<Server[]>("servers");
  const [tab, setTab] = useState<Tab>("servers");
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <OrgDetailSkeleton />;
  if (error || !org) return <p className="text-sm text-red-300">{t("org.error")}</p>;

  const myServers = myServersData ?? [];
  const isManager = org.role === "owner" || org.role === "admin";
  const isOwner = org.role === "owner";

  const call = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await mutate(orgKey);
      void mutate("servers");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("org.error"));
    }
  };

  const deleteOrg = async () => {
    if (!(await confirm({ title: t("org.deleteConfirm"), confirmLabel: t("common.delete"), danger: true }))) return;
    try {
      await api(`orgs/${id}`, { method: "DELETE" });
      void mutate("orgs");
      void mutate("servers");
      router.push("/dashboard/organizations");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("org.error"));
    }
  };

  const candidates = myServers.filter((s) => !s.org_id);
  const tabs: Tab[] = ["servers", "members", "permissions"];

  return (
    <div className="space-y-6">
      <FadeIn>
        <Link
          href="/dashboard/organizations"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("org.title")}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-600 text-sm font-semibold">
              {org.name.slice(0, 2).toUpperCase()}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/60">
              {t(`org.role.${org.role}`)}
            </span>
          </div>
          {isOwner && (
            <button
              onClick={deleteOrg}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              {t("org.delete")}
            </button>
          )}
        </div>
      </FadeIn>

      {err && <p className="text-sm text-red-300">{err}</p>}

      <FadeIn delay={0.06} className="flex gap-1 border-b border-white/10">
        {tabs.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb ? "border-white text-white" : "border-transparent text-white/45 hover:text-white/80"
            }`}
          >
            {t(`org.tab.${tb}`)}
          </button>
        ))}
      </FadeIn>

      {tab === "servers" && (
        <ServersTab org={org} candidates={candidates} isManager={isManager} id={id} call={call} />
      )}
      {tab === "members" && (
        <MembersTab org={org} isManager={isManager} isOwner={isOwner} id={id} call={call} />
      )}
      {tab === "permissions" && <PermissionsTab org={org} isManager={isManager} id={id} call={call} />}
    </div>
  );
}

function OrgDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex gap-4 border-b border-white/10 pb-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type CallFn = (fn: () => Promise<unknown>) => Promise<void>;

function ServersTab({
  org,
  candidates,
  isManager,
  id,
  call,
}: {
  org: OrgDetail;
  candidates: Server[];
  isManager: boolean;
  id: string;
  call: CallFn;
}) {
  const { t } = useLang();
  const [picking, setPicking] = useState(false);

  return (
    <FadeIn className="space-y-3">
      {isManager && (
        <div className="flex justify-end">
          <button
            onClick={() => setPicking((v) => !v)}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium transition-colors hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
            {t("org.addServer")}
          </button>
        </div>
      )}

      {picking && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-2 text-sm text-white/55">{t("org.pickServer")}</p>
          {candidates.length === 0 ? (
            <p className="text-sm text-white/40">{t("org.noServersToAdd")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {candidates.map((s) => (
                <button
                  key={s.id}
                  onClick={() =>
                    call(() => api(`orgs/${id}/servers`, { method: "POST", json: { server_id: s.id } })).then(() =>
                      setPicking(false),
                    )
                  }
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05]"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs uppercase text-white/45">{s.plan}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {org.servers.length === 0 ? (
        <p className="text-sm text-white/45">{t("org.noServers")}</p>
      ) : (
        <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
          {org.servers.map((s) => (
            <div key={s.id} className="flex items-center gap-4 bg-white/[0.02] p-4">
              <Link href={`/dashboard/servers/${s.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium hover:underline">{s.name}</p>
                <p className="truncate text-xs text-white/45">
                  {s.os} · {s.specs.vcpu} vCPU · {s.specs.ram_gb} GB
                </p>
              </Link>
              {isManager && (
                <button
                  onClick={() => call(() => api(`orgs/${id}/servers/${s.id}`, { method: "DELETE" }))}
                  className="text-white/40 transition-colors hover:text-red-300"
                  aria-label={t("org.removeServer")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </FadeIn>
  );
}

function MembersTab({
  org,
  isManager,
  isOwner,
  id,
  call,
}: {
  org: OrgDetail;
  isManager: boolean;
  isOwner: boolean;
  id: string;
  call: CallFn;
}) {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    call(() => api(`orgs/${id}/members`, { method: "POST", json: { email: email.trim(), role } })).then(() =>
      setEmail(""),
    );
  };

  return (
    <FadeIn className="space-y-4">
      {isManager && (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("org.emailPlaceholder")}
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
          />
          <Select
            value={role}
            onChange={setRole}
            className="h-10 w-full px-3 text-sm sm:w-40"
            options={[
              { value: "member", label: t("org.role.member") },
              { value: "admin", label: t("org.role.admin") },
            ]}
          />
          <button
            type="submit"
            className="h-10 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("org.invite")}
          </button>
        </form>
      )}

      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
        {org.members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 bg-white/[0.02] p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
              {(m.display_name || m.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.display_name}</p>
              <p className="truncate text-xs text-white/45">{m.email}</p>
            </div>
            {isOwner && m.role !== "owner" ? (
              <Select
                value={m.role}
                onChange={(v) =>
                  call(() =>
                    api(`orgs/${id}/members/${m.user_id}`, { method: "PATCH", json: { role: v } }),
                  )
                }
                className="h-8 w-32 px-2 text-xs"
                options={[
                  { value: "member", label: t("org.role.member") },
                  { value: "admin", label: t("org.role.admin") },
                ]}
              />
            ) : (
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/60">
                {t(`org.role.${m.role}`)}
              </span>
            )}
            {isManager && m.role !== "owner" && (
              <button
                onClick={() => call(() => api(`orgs/${id}/members/${m.user_id}`, { method: "DELETE" }))}
                className="text-white/40 transition-colors hover:text-red-300"
                aria-label={t("org.removeMember")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </FadeIn>
  );
}

function PermissionsTab({
  org,
  isManager,
  id,
  call,
}: {
  org: OrgDetail;
  isManager: boolean;
  id: string;
  call: CallFn;
}) {
  const { t } = useLang();
  const members = org.members.filter((m) => m.role === "member");

  if (!isManager) {
    return <p className="text-sm text-white/45">{t("org.grants.desc")}</p>;
  }
  if (members.length === 0 || org.servers.length === 0) {
    return (
      <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-white/55">
        {t("org.grants.desc")}
      </FadeIn>
    );
  }

  return (
    <FadeIn className="space-y-4">
      <p className="text-sm text-white/55">{t("org.grants.desc")}</p>
      {members.map((m) => (
        <div key={m.user_id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold">{m.display_name}</p>
          <p className="text-xs text-white/45">{m.email}</p>
          <div className="mt-4 space-y-4">
            {org.servers.map((s) => (
              <GrantRow
                key={s.id}
                orgId={id}
                serverId={s.id}
                serverName={s.name}
                userId={m.user_id}
                initial={m.grants[s.id] ?? []}
                call={call}
              />
            ))}
          </div>
        </div>
      ))}
    </FadeIn>
  );
}

function GrantRow({
  orgId,
  serverId,
  serverName,
  userId,
  initial,
  call,
}: {
  orgId: string;
  serverId: string;
  serverName: string;
  userId: string;
  initial: string[];
  call: CallFn;
}) {
  const { t } = useLang();
  const [perms, setPerms] = useState<Set<string>>(new Set(initial));
  const [dirty, setDirty] = useState(false);

  const toggle = (p: string) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
    setDirty(true);
  };

  const save = () =>
    call(() =>
      api(`orgs/${orgId}/servers/${serverId}/grants/${userId}`, {
        method: "PUT",
        json: { perms: Array.from(perms) },
      }),
    ).then(() => setDirty(false));

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{serverName}</span>
        {dirty && (
          <button
            onClick={save}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-black transition-colors hover:bg-white/85"
          >
            {t("org.save")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {SERVER_PERMS.map((p) => {
          const on = perms.has(p);
          return (
            <button
              key={p}
              onClick={() => toggle(p)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-white/5 text-white/45 hover:bg-white/10"
              }`}
            >
              {t(`org.perm.${p}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
