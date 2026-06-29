"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Plus, Server, Trash2, X } from "lucide-react";
import Select from "@/components/Select";
import Tip from "@/components/Tip";
import { useLang } from "@/components/LanguageProvider";
import {
  type Organization,
  type OrgRole,
  orgRoleStyles,
  orgRoles,
  servers,
  statusStyles,
} from "@/lib/dashboard";

const tabs = [
  { id: "servers", labelKey: "dash.orgDetail.tab.servers" },
  { id: "members", labelKey: "dash.orgDetail.tab.members" },
  { id: "permissions", labelKey: "dash.orgDetail.tab.permissions" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const roleOptions: OrgRole[] = ["Dono", "Admin", "Membro", "Somente leitura"];

export default function OrgDetail({ org }: { org: Organization }) {
  const { t } = useLang();
  const [tab, setTab] = useState<TabId>("servers");
  const [serverIds, setServerIds] = useState<string[]>(org.serverIds);
  const [members, setMembers] = useState(org.members);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("Membro");

  const inOrg = servers.filter((s) => serverIds.includes(s.id));
  const available = servers.filter((s) => !serverIds.includes(s.id));

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setMembers((m) => [
      ...m,
      { name: inviteEmail.split("@")[0], email: inviteEmail, role: inviteRole },
    ]);
    setInviteEmail("");
  };

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/organizations"
        className="inline-flex items-center gap-1.5 text-sm text-white/55 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("dash.orgs.title")}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-lg font-semibold">
          {org.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
          <p className="text-xs text-white/45">
            {org.plan} · {inOrg.length} {t("dash.orgDetail.servers")} · {members.length} {t("dash.orgDetail.members")}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`relative px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === tb.id ? "text-white" : "text-white/50 hover:text-white"
            }`}
          >
            {t(tb.labelKey)}
            {tab === tb.id && (
              <motion.span
                layoutId="org-tab"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-white"
              />
            )}
          </button>
        ))}
      </div>

      {/* Servers */}
      {tab === "servers" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setAddOpen(true)}
              className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
            >
              <Plus className="h-4 w-4" /> {t("dash.orgDetail.addVps")}
            </button>
          </div>
          {inOrg.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/45">
              {t("dash.orgDetail.noServers")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 divide-y divide-white/10">
              {inOrg.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-4 bg-white/[0.02] p-4"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <Server className="h-4 w-4 text-white/70" strokeWidth={1.6} />
                  </span>
                  <Link
                    href={`/dashboard/servers/${s.id}`}
                    className="min-w-0 flex-1"
                  >
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium hover:underline">
                        {s.name}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyles[s.status]}`}
                      >
                        {t(`dash.status.${s.status}`)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-white/45">
                      {s.specs.vcpu} vCPU · {s.specs.ram} GB · {s.region}
                    </p>
                  </Link>
                  <Tip label={t("dash.orgDetail.removeFromOrg")} side="left">
                    <button
                      onClick={() =>
                        setServerIds((ids) => ids.filter((id) => id !== s.id))
                      }
                      aria-label={t("dash.orgDetail.remove")}
                      className="text-white/40 transition-colors hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members */}
      {tab === "members" && (
        <div className="space-y-4">
          <form
            onSubmit={invite}
            className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row"
          >
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              placeholder={t("dash.orgDetail.invitePlaceholder")}
              className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
            />
            <Select
              value={inviteRole}
              onChange={(v) => setInviteRole(v as OrgRole)}
              className="h-10 px-3 text-sm sm:w-44"
              options={roleOptions.map((r) => ({ value: r, label: t(`dash.role.${r}`) }))}
            />
            <button className="h-10 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85">
              {t("dash.orgDetail.invite")}
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-white/10 divide-y divide-white/10">
            {members.map((m, i) => (
              <div
                key={m.email}
                className="flex items-center gap-3 bg-white/[0.02] p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  {m.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-white/45">{m.email}</p>
                </div>
                {i === 0 ? (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${orgRoleStyles[m.role]}`}
                  >
                    {t(`dash.role.${m.role}`)}
                  </span>
                ) : (
                  <Select
                    value={m.role}
                    onChange={(v) =>
                      setMembers((list) =>
                        list.map((x, xi) =>
                          xi === i ? { ...x, role: v as OrgRole } : x,
                        ),
                      )
                    }
                    className="h-8 w-40 px-2.5 text-xs"
                    options={roleOptions.map((r) => ({ value: r, label: t(`dash.role.${r}`) }))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Permissions */}
      {tab === "permissions" && (
        <div className="flex flex-col gap-3">
          {orgRoles.map((r) => (
            <div
              key={r.role}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${orgRoleStyles[r.role]}`}
                >
                  {t(`dash.role.${r.role}`)}
                </span>
                <p className="mt-2 text-sm text-white/55">{t(`dash.roleDesc.${r.role}`)}</p>
              </div>
              <span className="text-xs text-white/40">
                {members.filter((m) => m.role === r.role).length} {t("dash.orgDetail.memberCount")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add server modal */}
      <AnimatePresence>
        {addOpen && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setAddOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6"
            >
              <button
                onClick={() => setAddOpen(false)}
                aria-label={t("dash.createOrg.close")}
                className="absolute right-4 top-4 rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("dash.orgDetail.addVps")}
              </h2>
              <p className="mt-1 text-sm text-white/50">
                {t("dash.orgDetail.chooseServer")} {org.name}.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {available.length === 0 ? (
                  <p className="py-6 text-center text-sm text-white/45">
                    {t("dash.orgDetail.allInOrgs")}
                  </p>
                ) : (
                  available.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setServerIds((ids) => [...ids, s.id]);
                        setAddOpen(false);
                      }}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      <Server className="h-4 w-4 text-white/60" strokeWidth={1.6} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <p className="truncate text-xs text-white/45">
                          {s.specs.vcpu} vCPU · {s.specs.ram} GB
                        </p>
                      </div>
                      <Plus className="h-4 w-4 text-white/40" />
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
