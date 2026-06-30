"use client";

import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Plus, Trash2, X, Shield, Pencil, Check } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import Select from "@/components/Select";
import Sheet from "@/components/ui/Sheet";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import { useConfirm } from "@/components/FeedbackProvider";
import { hasAdminAccess, granted } from "@/lib/permissions";
import type {
  TicketCategory,
  Role,
  AdminUser,
  AdminServer,
  AdminRelay,
  AdminStorage,
  AdminDedicatedIp,
  AdminPlan,
  Plan,
  PlansResponse,
  Subscription,
  Invoice,
  PermissionsCatalog,
  Announcement,
  AnnouncementButton,
  ButtonColor,
} from "@/lib/api/types";

type Tab =
  | "servers"
  | "relays"
  | "storage"
  | "dedipips"
  | "plans"
  | "finance"
  | "categories"
  | "roles"
  | "users"
  | "announcements";

export default function AdminClient() {
  const { t } = useLang();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("servers");

  if (!user || !hasAdminAccess(user.permissions)) {
    return (
      <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <Shield className="mx-auto h-8 w-8 text-white/30" strokeWidth={1.6} />
        <h1 className="mt-3 text-lg font-semibold">{t("admin.noAccess.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("admin.noAccess.desc")}</p>
      </FadeIn>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "servers", label: t("admin.tab.servers") },
    { id: "relays", label: t("admin.tab.relays") },
    { id: "storage", label: t("admin.tab.storage") },
    { id: "dedipips", label: t("admin.tab.dedipips") },
    { id: "plans", label: t("admin.tab.plans") },
    { id: "finance", label: t("admin.tab.finance") },
    { id: "categories", label: t("admin.tab.categories") },
    { id: "roles", label: t("admin.tab.roles") },
    { id: "users", label: t("admin.tab.users") },
    { id: "announcements", label: t("admin.tab.announcements") },
  ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.title")}</h1>
        <p className="mt-1 text-sm text-white/55">{t("admin.subtitle")}</p>
      </FadeIn>

      <FadeIn delay={0.05} className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
              tab === tb.id
                ? "bg-white/10 text-white"
                : "text-white/55 hover:bg-white/5 hover:text-white"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </FadeIn>

      {tab === "servers" && <ServersPanel />}
      {tab === "relays" && <RelaysPanel />}
      {tab === "storage" && <StoragePanel />}
      {tab === "dedipips" && <DedicatedIpsPanel />}
      {tab === "plans" && <PlansPanel />}
      {tab === "finance" && <FinancePanel />}
      {tab === "categories" && <CategoriesPanel />}
      {tab === "roles" && <RolesPanel />}
      {tab === "users" && <UsersPanel />}
      {tab === "announcements" && <AnnouncementsPanel />}
    </div>
  );
}

// ----------------------------- Servers (VPS) -----------------------------

const serverStateStyles: Record<string, string> = {
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  stopped: "border-white/15 bg-white/5 text-white/55",
  provisioning: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  pending_payment: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  suspended: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
  deleting: "border-red-500/30 bg-red-500/10 text-red-300",
};

/**
 * Owner picker. Past 10 users a search box (name or email) is shown above the
 * select so the list stays manageable; below that it's a plain select.
 */
function UserSelect({
  value,
  onChange,
  users,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  users: AdminUser[];
  placeholder?: string;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const opt = (list: AdminUser[]) =>
    list.map((u) => ({ value: u.id, label: `${u.display_name} \u00b7 ${u.email}` }));

  if (users.length <= 10) {
    return (
      <Select
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-11 px-4 text-sm"
        options={opt(users)}
      />
    );
  }

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? users.filter((u) => `${u.display_name} ${u.email}`.toLowerCase().includes(needle))
    : users;
  const selected = users.find((u) => u.id === value);
  const list =
    selected && !filtered.some((u) => u.id === value) ? [selected, ...filtered] : filtered;

  return (
    <div className="flex flex-col gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("admin.servers.searchOwner")}
        className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
      />
      <Select
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-11 px-4 text-sm"
        options={opt(list.slice(0, 50))}
      />
    </div>
  );
}

function OwnerBadge({ owner }: { owner: AdminServer["owner"] }) {
  const { t } = useLang();
  if (!owner) return <span className="text-xs text-white/40">{t("admin.servers.noOwner")}</span>;
  const initials = (owner.display_name || owner.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex min-w-0 items-center gap-2">
      {owner.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={owner.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-[10px] font-semibold">
          {initials}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{owner.display_name}</p>
        <p className="truncate text-[11px] text-white/45">{owner.email}</p>
      </div>
    </div>
  );
}

function expiryLabel(iso: string | null | undefined, locale: string, lifetime: string): string {
  if (!iso) return lifetime;
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function toDateInput(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function ServersPanel() {
  const { t } = useLang();
  const { user } = useAuth();
  const canLifetime = granted(user?.permissions ?? [], "nodes.lifetime");
  const { data: servers, error, loading } = useQuery<AdminServer[]>("admin/servers");
  const { data: users } = useQuery<AdminUser[]>("admin/users");
  const { data: plansResp } = useQuery<PlansResponse>("billing/plans");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminServer | null>(null);

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !servers) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <FadeIn className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/55">
          {servers.length} {t("admin.tab.servers")}
        </p>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t("admin.servers.create")}
        </button>
      </div>

      {creating && (
        <CreateServerForm
          users={users ?? []}
          plans={plansResp?.plans ?? []}
          canLifetime={canLifetime}
          onDone={() => {
            setCreating(false);
            mutate("admin/servers");
          }}
        />
      )}

      {servers.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.servers.empty")}</p>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} onEdit={() => setEditing(s)} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <ServerEditModal
            key={editing.id}
            server={editing}
            users={users ?? []}
            canLifetime={canLifetime}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  );
}

function CreateServerForm({
  users,
  plans,
  canLifetime,
  onDone,
}: {
  users: AdminUser[];
  plans: Plan[];
  canLifetime: boolean;
  onDone: () => void;
}) {
  const { t } = useLang();
  const [ownerId, setOwnerId] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState(plans[0]?.id ?? "");
  const [os, setOs] = useState("Ubuntu 24.04 LTS");
  const [sshKey, setSshKey] = useState("");
  const [lifetime, setLifetime] = useState(false);
  const [date, setDate] = useState(() =>
    toDateInput(new Date(Date.now() + 30 * 86400000).toISOString()),
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !ownerId || !name.trim() || !plan || (!lifetime && !date)) return;
    setBusy(true);
    setFormError(null);
    try {
      await api("admin/servers", {
        method: "POST",
        json: {
          user_id: ownerId,
          name: name.trim(),
          plan,
          os,
          ssh_key: sshKey.trim() || undefined,
          ...(lifetime ? { lifetime: true } : { expires_at: date }),
        },
      });
      onDone();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
      setBusy(false);
    }
  };

  const fieldCls =
    "h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30";

  return (
    <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.owner")}</span>
            <UserSelect
              value={ownerId}
              onChange={setOwnerId}
              users={users}
              placeholder={t("admin.servers.pickOwner")}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin.servers.namePlaceholder")}
              className={fieldCls}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.plan")}</span>
            <Select
              value={plan}
              onChange={setPlan}
              className="h-11 px-4 text-sm"
              options={plans.map((p) => ({
                value: p.id,
                label: `${p.id} · ${p.vcpu} vCPU / ${p.ram_gb}GB / ${p.disk_gb}GB`,
              }))}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.os")}</span>
            <Select
              value={os}
              onChange={setOs}
              className="h-11 px-4 text-sm"
              options={[
                "Ubuntu 24.04 LTS",
                "Ubuntu 22.04 LTS",
                "Debian 12",
                "AlmaLinux 9",
                "Rocky Linux 9",
              ].map((o) => ({ value: o, label: o }))}
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("admin.servers.ssh")}</span>
          <textarea
            value={sshKey}
            onChange={(e) => setSshKey(e.target.value)}
            rows={2}
            placeholder="ssh-ed25519 AAAA…"
            className="resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs outline-none placeholder:text-white/35 focus:border-white/30"
          />
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.expiry")}</span>
            <input
              type="date"
              value={date}
              disabled={lifetime}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30 disabled:opacity-40 [color-scheme:dark]"
            />
          </label>
          {canLifetime && (
            <label className="flex h-11 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={lifetime}
                onChange={(e) => setLifetime(e.target.checked)}
                className="h-4 w-4 accent-white"
              />
              <span className="text-sm text-white/70">{t("admin.servers.lifetime")}</span>
            </label>
          )}
        </div>

        {formError && <p className="text-sm text-red-300">{formError}</p>}

        <button
          type="submit"
          disabled={busy || !ownerId || !name.trim() || !plan || (!lifetime && !date)}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
        >
          {busy ? t("admin.servers.creating") : t("admin.servers.submit")}
        </button>
      </form>
    </FadeIn>
  );
}

function ServerRow({ server, onEdit }: { server: AdminServer; onEdit: () => void }) {
  const { t, locale } = useLang();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!(await confirm({ title: t("admin.servers.confirmDelete"), confirmLabel: t("common.delete"), danger: true }))) return;
    setBusy(true);
    try {
      await api(`admin/servers/${server.id}`, { method: "DELETE" });
      await mutate("admin/servers");
    } catch {
      setBusy(false);
    }
  };

  const lifetime = server.expires_at == null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{server.name}</p>
          <p className="truncate text-xs text-white/45">
            {server.specs.vcpu} vCPU · {server.specs.ram_gb}GB RAM · {server.specs.disk_gb}GB ·{" "}
            {server.node}
            {server.vmid ? ` · #${server.vmid}` : ""}
          </p>
        </div>
        <div className="w-44 shrink-0">
          <OwnerBadge owner={server.owner} />
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            lifetime
              ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : "border-white/15 bg-white/5 text-white/55"
          }`}
        >
          {expiryLabel(server.expires_at, locale, t("admin.servers.lifetime"))}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            serverStateStyles[server.state] ?? serverStateStyles.stopped
          }`}
        >
          {t(`admin.servers.state.${server.state}`)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm transition-colors hover:border-white/20"
        >
          <Pencil className="h-4 w-4" />
          {t("admin.servers.edit")}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl border border-red-500/30 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {t("admin.servers.delete")}
        </button>
      </div>
    </div>
  );
}

function ServerEditModal({
  server,
  users,
  canLifetime,
  onClose,
}: {
  server: AdminServer;
  users: AdminUser[];
  canLifetime: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [ownerId, setOwnerId] = useState(server.owner?.id ?? "");
  const [vcpu, setVcpu] = useState(String(server.specs.vcpu));
  const [ram, setRam] = useState(String(server.specs.ram_gb));
  const [disk, setDisk] = useState(String(server.specs.disk_gb));
  const initialLifetime = server.expires_at == null;
  const initialDate = server.expires_at ? toDateInput(server.expires_at) : "";
  const [lifetime, setLifetime] = useState(initialLifetime);
  const [date, setDate] = useState(initialDate);
  const { data: relays } = useQuery<AdminRelay[]>("admin/relays");
  const [relay, setRelay] = useState("");
  const [port, setPort] = useState(server.ssh_port ? String(server.ssh_port) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      vcpu: Number(vcpu),
      ram_gb: Number(ram),
      disk_gb: Number(disk),
    };
    if (ownerId && ownerId !== (server.owner?.id ?? "")) payload.user_id = ownerId;
    const curRelay = relays?.find((r) => r.host === server.ssh_host)?.name ?? "";
    if (relay && relay !== curRelay) payload.relay = relay;
    if (port && Number(port) !== (server.ssh_port ?? 0)) payload.ssh_port = Number(port);
    if (lifetime !== initialLifetime || date !== initialDate) {
      if (lifetime) payload.lifetime = true;
      else if (date) payload.expires_at = date;
    }
    try {
      await api(`admin/servers/${server.id}`, { method: "PATCH", json: payload });
      await mutate("admin/servers");
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("admin.error"));
      setBusy(false);
    }
  };

  const numCls =
    "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30";

  if (typeof document === "undefined") return null;
  return (
    <Sheet open onClose={onClose} title={`${t("admin.servers.editTitle")} · ${server.name}`}>
        <div className="space-y-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.servers.owner")}</span>
            <UserSelect value={ownerId} onChange={setOwnerId} users={users} />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">vCPU</span>
              <input type="number" min={1} max={64} value={vcpu} onChange={(e) => setVcpu(e.target.value)} className={numCls} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("admin.servers.ram")}</span>
              <input type="number" min={1} max={512} value={ram} onChange={(e) => setRam(e.target.value)} className={numCls} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("admin.servers.disk")}</span>
              <input type="number" min={server.specs.disk_gb} value={disk} onChange={(e) => setDisk(e.target.value)} className={numCls} />
            </label>
          </div>
          <p className="text-xs text-white/40">{t("admin.servers.diskHint")}</p>

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm">
            <span className="text-white/55">{t("admin.servers.node")}</span>
            <span className="font-mono text-white/80">{server.node}</span>
          </div>

          {relays && relays.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("admin.servers.relay")}</span>
                <Select
                  value={relay || (relays.find((r) => r.host === server.ssh_host)?.name ?? "")}
                  onChange={setRelay}
                  className="h-11 px-4 text-sm"
                  options={relays.map((r) => ({ value: r.name, label: `${r.name}${r.enabled ? "" : " (off)"}` }))}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-white/70">{t("admin.servers.port")}</span>
                <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" className={numCls} />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-1 flex-col gap-2">
              <span className="text-sm font-medium text-white/70">{t("admin.servers.expiry")}</span>
              <input
                type="date"
                value={date}
                disabled={lifetime}
                onChange={(e) => setDate(e.target.value)}
                className={`${numCls} disabled:opacity-40 [color-scheme:dark]`}
              />
            </label>
            <label
              className={`flex h-11 items-center gap-2 ${canLifetime ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
            >
              <input
                type="checkbox"
                checked={lifetime}
                disabled={!canLifetime}
                onChange={(e) => setLifetime(e.target.checked)}
                className="h-4 w-4 accent-white"
              />
              <span className="text-sm text-white/70">{t("admin.servers.lifetime")}</span>
            </label>
          </div>

          {err && <p className="text-sm text-red-300">{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
            >
              {t("admin.servers.cancel")}
            </button>
            <button
              onClick={save}
              disabled={busy || (!lifetime && !date)}
              className="inline-flex h-10 items-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {busy ? t("admin.servers.saving") : t("admin.servers.save")}
            </button>
          </div>
        </div>
    </Sheet>
  );
}

// ----------------------------- Dedicated IPs -----------------------------

function DipStatusBadge({ status, ip }: { status: string; ip?: string | null }) {
  const { t } = useLang();
  const cls: Record<string, string> = {
    pending_payment: "bg-white/10 text-white/55",
    pending_assignment: "bg-amber-500/15 text-amber-300",
    active: "bg-emerald-500/15 text-emerald-300",
    cancelled: "bg-white/10 text-white/40",
  };
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${cls[status] ?? "bg-white/10"}`}>
      {t(`admin.dip.status.${status}`)}
      {status === "active" && ip ? ` \u00b7 ${ip}` : ""}
    </span>
  );
}

function DedicatedIpsPanel() {
  const { t } = useLang();
  const { data: ips, error, loading } = useQuery<AdminDedicatedIp[]>("admin/dedicated-ips");
  const [editing, setEditing] = useState<string | null>(null);
  const [ipInput, setIpInput] = useState("");
  const [busy, setBusy] = useState(false);

  const assign = async (id: string) => {
    if (busy || !ipInput.trim()) return;
    setBusy(true);
    try {
      await api(`admin/dedicated-ips/${id}`, { method: "PATCH", json: { ip_address: ipInput.trim() } });
      await mutate("admin/dedicated-ips");
      setEditing(null);
      setIpInput("");
    } catch {
      /* surfaced on next load */
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.02]" />;
  if (error) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <FadeIn className="space-y-3">
      <p className="text-sm text-white/55">{t("admin.dip.desc")}</p>
      <div className="space-y-2">
        {(ips ?? []).map((d) => (
          <div key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {d.owner?.display_name ?? "\u2014"}{" "}
                  <span className="text-white/45">{d.owner?.email}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-white/45">VPS: {d.server_name ?? d.server_id}</p>
              </div>
              <DipStatusBadge status={d.status} ip={d.ip_address} />
            </div>
            {d.status === "pending_assignment" &&
              (editing === d.id ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    autoFocus
                    value={ipInput}
                    onChange={(e) => setIpInput(e.target.value)}
                    placeholder="ex: 191.252.202.4"
                    className="h-9 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
                  />
                  <button
                    onClick={() => assign(d.id)}
                    disabled={busy}
                    className="h-9 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
                  >
                    {t("admin.dip.assign")}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(null);
                      setIpInput("");
                    }}
                    className="h-9 rounded-xl border border-white/10 px-3 text-sm text-white/60 transition-colors hover:bg-white/5"
                  >
                    {t("admin.servers.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditing(d.id);
                    setIpInput("");
                  }}
                  className="mt-3 inline-flex h-9 items-center rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
                >
                  {t("admin.dip.route")}
                </button>
              ))}
          </div>
        ))}
        {(ips ?? []).length === 0 && <p className="text-sm text-white/45">{t("admin.dip.empty")}</p>}
      </div>
    </FadeIn>
  );
}

// ----------------------------- Relays -----------------------------

function RelaysPanel() {
  const { t } = useLang();
  const { data: relays, error, loading } = useQuery<AdminRelay[]>("admin/relays");
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (name: string, enabled: boolean) => {
    setBusy(name);
    try {
      await api(`admin/relays/${encodeURIComponent(name)}`, { method: "PATCH", json: { enabled } });
      await mutate("admin/relays");
    } catch {
      /* re-surfaced on next load */
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.02]" />;
  if (error) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <FadeIn className="space-y-3">
      <p className="text-sm text-white/55">{t("admin.relays.desc")}</p>
      <div className="space-y-2">
        {(relays ?? []).map((r) => {
          const pct = r.capacity > 0 ? Math.round((r.used_ports / r.capacity) * 100) : 0;
          return (
            <div
              key={r.name}
              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      r.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/50"
                    }`}
                  >
                    {r.enabled ? t("admin.relays.on") : t("admin.relays.off")}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-white/45">
                  {r.host}:{r.server_port}
                </p>
                <p className="mt-0.5 text-xs text-white/45">
                  {t("admin.relays.usage")}: {r.used_ports}/{r.capacity} ({pct}%) · {r.port_min}-{r.port_max}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(r.name, !r.enabled)}
                disabled={busy === r.name}
                className={`inline-flex h-9 shrink-0 items-center rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                  r.enabled
                    ? "border border-white/10 text-white/70 hover:bg-white/5"
                    : "bg-white text-black hover:bg-white/85"
                }`}
              >
                {r.enabled ? t("admin.relays.disable") : t("admin.relays.enable")}
              </button>
            </div>
          );
        })}
        {(relays ?? []).length === 0 && (
          <p className="text-sm text-white/45">{t("admin.relays.empty")}</p>
        )}
      </div>
    </FadeIn>
  );
}

// ----------------------------- Plans -----------------------------

function StoragePanel() {
  const { t } = useLang();
  const { data: items, error, loading } = useQuery<AdminStorage[]>("admin/storage");
  if (loading)
    return <div className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.02]" />;
  if (error) return <p className="text-sm text-red-300">{t("admin.error")}</p>;
  return (
    <FadeIn className="space-y-3">
      <p className="text-sm text-white/55">{t("admin.storage.desc")}</p>
      <div className="space-y-2">
        {(items ?? []).map((s) => {
          const pct = Math.min(100, s.pct_committed);
          const danger = pct >= 80 || !s.sellable;
          return (
            <div key={s.name} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/50">
                    {s.type}
                  </span>
                  {!s.sellable && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">
                      {t("admin.storage.full")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-white/45">{s.vps_count} VPS</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${danger ? "bg-red-400" : "bg-emerald-400"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
                <span>
                  {t("admin.storage.committed")}:{" "}
                  <span className="font-medium text-white/80">
                    {s.committed_gb} / {s.sellable_gb} GB ({pct}%)
                  </span>
                </span>
                <span>
                  {t("admin.storage.sellable")}:{" "}
                  <span className="font-medium text-white/80">{s.free_to_sell_gb} GB</span>
                </span>
                <span>
                  {t("admin.storage.used")}: {s.used_gb} / {s.total_gb} GB
                </span>
              </div>
            </div>
          );
        })}
        {(items ?? []).length === 0 && (
          <p className="text-sm text-white/45">{t("admin.storage.empty")}</p>
        )}
      </div>
    </FadeIn>
  );
}

const fmtMoney = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`;

function PlansPanel() {
  const { t } = useLang();
  const { data: plans, error, loading } = useQuery<AdminPlan[]>("admin/plans");
  const [editing, setEditing] = useState<AdminPlan | "new" | null>(null);

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !plans) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <FadeIn className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/55">
          {plans.length} {t("admin.tab.plans")}
        </p>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
        >
          <Plus className="h-4 w-4" /> {t("admin.plans.new")}
        </button>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.plans.empty")}</p>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{p.name}</p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/45">
                    {p.slug}
                  </span>
                  {!p.active && (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                      {t("admin.plans.inactive")}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-white/45">
                  {p.vcpu} vCPU · {p.ram_gb}GB RAM · {p.disk_gb}GB
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold">
                {fmtMoney(p.price_cents)}
                <span className="text-xs font-normal text-white/40">/mês</span>
              </p>
              <button
                onClick={() => setEditing(p)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm transition-colors hover:border-white/20"
              >
                <Pencil className="h-4 w-4" /> {t("admin.servers.edit")}
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <PlanModal
            key={editing === "new" ? "new" : editing.id}
            plan={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </FadeIn>
  );
}

function PlanModal({ plan, onClose }: { plan: AdminPlan | null; onClose: () => void }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [slug, setSlug] = useState(plan?.slug ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [vcpu, setVcpu] = useState(String(plan?.vcpu ?? 2));
  const [ram, setRam] = useState(String(plan?.ram_gb ?? 4));
  const [disk, setDisk] = useState(String(plan?.disk_gb ?? 50));
  const [price, setPrice] = useState(((plan?.price_cents ?? 0) / 100).toFixed(2));
  const [active, setActive] = useState(plan?.active ?? true);
  const [sort, setSort] = useState(String(plan?.sort ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const body = {
      name: name.trim(),
      vcpu: Number(vcpu),
      ram_gb: Number(ram),
      disk_gb: Number(disk),
      price_cents: Math.round(Number(price) * 100),
      active,
      sort: Number(sort),
    };
    try {
      if (plan) {
        await api(`admin/plans/${plan.id}`, { method: "PATCH", json: body });
      } else {
        await api("admin/plans", {
          method: "POST",
          json: { slug: slug.trim().toLowerCase(), ...body },
        });
      }
      await mutate("admin/plans");
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("admin.error"));
      setBusy(false);
    }
  };

  const del = async () => {
    if (!plan || busy) return;
    if (!(await confirm({ title: t("admin.plans.confirmDelete"), confirmLabel: t("common.delete"), danger: true }))) return;
    setBusy(true);
    try {
      await api(`admin/plans/${plan.id}`, { method: "DELETE" });
      await mutate("admin/plans");
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("admin.error"));
      setBusy(false);
    }
  };

  const f =
    "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none focus:border-white/30";

  if (typeof document === "undefined") return null;
  return (
    <Sheet open onClose={onClose} title={plan ? t("admin.plans.edit") : t("admin.plans.new")}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.plans.slug")}</span>
              <input value={slug} disabled={!!plan} onChange={(e) => setSlug(e.target.value)} placeholder="cloud4" className={`${f} disabled:opacity-50`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.plans.name")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cloud 4" className={f} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">vCPU</span>
              <input type="number" min={1} value={vcpu} onChange={(e) => setVcpu(e.target.value)} className={f} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.servers.ram")}</span>
              <input type="number" min={1} value={ram} onChange={(e) => setRam(e.target.value)} className={f} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.servers.disk")}</span>
              <input type="number" min={1} value={disk} onChange={(e) => setDisk(e.target.value)} className={f} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.plans.price")}</span>
              <input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={f} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/45">{t("admin.plans.sort")}</span>
              <input type="number" value={sort} onChange={(e) => setSort(e.target.value)} className={f} />
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-white" />
            <span className="text-sm text-white/70">{t("admin.plans.active")}</span>
          </label>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex items-center justify-between pt-1">
            {plan ? (
              <button onClick={del} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> {t("admin.servers.delete")}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5">
                {t("admin.servers.cancel")}
              </button>
              <button onClick={save} disabled={busy || !name.trim() || (!plan && !slug.trim())} className="inline-flex h-10 items-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50">
                {busy ? t("admin.servers.saving") : t("admin.servers.save")}
              </button>
            </div>
          </div>
        </div>
    </Sheet>
  );
}

// ----------------------------- Finance -----------------------------

const subStatusStyles: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  pending_payment: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  past_due: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  suspended: "border-red-500/30 bg-red-500/10 text-red-300",
  cancelled: "border-white/15 bg-white/5 text-white/55",
};
const invStatusStyles: Record<string, string> = {
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  open: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  void: "border-white/15 bg-white/5 text-white/55",
  expired: "border-red-500/30 bg-red-500/10 text-red-300",
  uncollectible: "border-red-500/30 bg-red-500/10 text-red-300",
};

function FinancePanel() {
  const { t, locale } = useLang();
  const { data: subs, loading: ls } = useQuery<Subscription[]>("admin/subscriptions");
  const { data: invoices, loading: li } = useQuery<Invoice[]>("admin/invoices");

  const markPaid = async (id: string) => {
    try {
      await api(`admin/invoices/${id}/mark-paid`, { method: "POST" });
      await mutate("admin/invoices");
      await mutate("admin/subscriptions");
    } catch {
      /* ignore */
    }
  };

  if (ls || li) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;

  const paidTotal = (invoices ?? []).filter((i) => i.status === "paid").reduce((a, i) => a + i.amount_cents, 0);
  const openTotal = (invoices ?? []).filter((i) => i.status === "open").reduce((a, i) => a + i.amount_cents, 0);

  return (
    <FadeIn className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs text-white/45">{t("admin.finance.activeSubs")}</p>
          <p className="mt-1 text-xl font-semibold">{(subs ?? []).filter((s) => s.status === "active").length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs text-white/45">{t("admin.finance.received")}</p>
          <p className="mt-1 text-xl font-semibold text-emerald-300">{fmtMoney(paidTotal)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs text-white/45">{t("admin.finance.pending")}</p>
          <p className="mt-1 text-xl font-semibold text-amber-300">{fmtMoney(openTotal)}</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">{t("admin.finance.invoices")}</h2>
        {(invoices ?? []).length === 0 ? (
          <p className="text-sm text-white/45">{t("admin.finance.noInvoices")}</p>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {invoices!.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 bg-white/[0.02] p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{i.number}</p>
                  <p className="text-xs text-white/45">
                    {t("admin.finance.due")} {new Date(i.due_date).toLocaleDateString(locale)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold">{fmtMoney(i.amount_cents)}</p>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${invStatusStyles[i.status] ?? invStatusStyles.void}`}>
                  {t(`admin.finance.invStatus.${i.status}`)}
                </span>
                {i.status === "open" && (
                  <button
                    onClick={() => markPaid(i.id)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
                  >
                    <Check className="h-3.5 w-3.5" /> {t("admin.finance.markPaid")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">{t("admin.finance.subscriptions")}</h2>
        {(subs ?? []).length === 0 ? (
          <p className="text-sm text-white/45">{t("admin.finance.noSubs")}</p>
        ) : (
          <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {subs!.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 bg-white/[0.02] p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium uppercase">{s.plan}</p>
                  <p className="text-xs text-white/45">
                    {s.current_period_end
                      ? `${t("admin.finance.renews")} ${new Date(s.current_period_end).toLocaleDateString(locale)}`
                      : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold">{fmtMoney(s.price_cents)}</p>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${subStatusStyles[s.status] ?? subStatusStyles.cancelled}`}>
                  {t(`admin.finance.subStatus.${s.status}`)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </FadeIn>
  );
}

// ----------------------------- Announcements -----------------------------

const ANNOUNCE_COLORS: { id: ButtonColor; label: string; dot: string }[] = [
  { id: "blue", label: "Azul", dot: "bg-blue-500" },
  { id: "red", label: "Vermelho", dot: "bg-red-500" },
  { id: "gray", label: "Cinza", dot: "bg-white/40" },
  { id: "green", label: "Verde", dot: "bg-emerald-500" },
];

function AnnouncementsPanel() {
  const { t } = useLang();
  const { data: items, error, loading } = useQuery<Announcement[]>("admin/announcements");
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !items) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <div className="space-y-4">
      <FadeIn className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
          {t("admin.announce.new")}
        </button>
      </FadeIn>

      {editing && (
        <AnnouncementEditor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {items.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.announce.empty")}</p>
      ) : (
        <FadeIn
          delay={0.05}
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10"
        >
          {items.map((a) => (
            <div key={a.id} className="flex items-center gap-3 bg-white/[0.02] p-4">
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">
                {t(`admin.announce.kind.${a.kind}`)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="truncate text-xs text-white/45">
                  {t(`admin.announce.scope.${a.scope}`)}
                  {a.scope === "pages" && a.pages.length > 0 ? ` · ${a.pages.join(", ")}` : ""}
                </p>
              </div>
              {a.active ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  {t("admin.announce.active")}
                </span>
              ) : (
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/45">
                  {t("admin.announce.inactive")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:text-white"
              >
                {t("admin.announce.edit")}
              </button>
            </div>
          ))}
        </FadeIn>
      )}
    </div>
  );
}

function AnnouncementEditor({
  item,
  onClose,
}: {
  item: Announcement | null;
  onClose: () => void;
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [kind, setKind] = useState<string>(item?.kind ?? "banner");
  const [scope, setScope] = useState<string>(item?.scope ?? "global");
  const [pagesText, setPagesText] = useState((item?.pages ?? []).join("\n"));
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [buttons, setButtons] = useState<AnnouncementButton[]>(item?.buttons ?? []);
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const setBtn = (i: number, patch: Partial<AnnouncementButton>) =>
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addBtn = () =>
    setButtons((prev) => (prev.length >= 4 ? prev : [...prev, { label: "", url: "", color: "blue" }]));
  const removeBtn = (i: number) => setButtons((prev) => prev.filter((_, idx) => idx !== i));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setFormError(null);
    const payload = {
      kind,
      scope,
      pages:
        scope === "pages"
          ? pagesText.split("\n").map((p) => p.trim()).filter(Boolean)
          : [],
      title: title.trim(),
      description,
      buttons: buttons.filter((b) => b.label.trim() && b.url.trim()),
      active,
    };
    try {
      if (item) {
        await api(`admin/announcements/${item.id}`, { method: "PATCH", json: payload });
      } else {
        await api("admin/announcements", { method: "POST", json: payload });
      }
      await mutate("admin/announcements");
      await mutate("announcements");
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item || busy) return;
    if (!(await confirm({ title: t("admin.announce.confirmDelete"), confirmLabel: t("common.delete"), danger: true }))) return;
    setBusy(true);
    try {
      await api(`admin/announcements/${item.id}`, { method: "DELETE" });
      await mutate("admin/announcements");
      await mutate("announcements");
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
      setBusy(false);
    }
  };

  const fieldCls =
    "h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30";

  return (
    <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {item ? t("admin.announce.edit") : t("admin.announce.new")}
        </h2>
        <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.announce.type")}</span>
            <Select
              value={kind}
              onChange={setKind}
              className="h-11 px-4 text-sm"
              options={[
                { value: "banner", label: t("admin.announce.kind.banner") },
                { value: "modal", label: t("admin.announce.kind.modal") },
              ]}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.announce.scopeLabel")}</span>
            <Select
              value={scope}
              onChange={setScope}
              className="h-11 px-4 text-sm"
              options={[
                { value: "global", label: t("admin.announce.scope.global") },
                { value: "dashboard", label: t("admin.announce.scope.dashboard") },
                { value: "pages", label: t("admin.announce.scope.pages") },
              ]}
            />
          </label>
        </div>

        {scope === "pages" && (
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.announce.pages")}</span>
            <textarea
              value={pagesText}
              onChange={(e) => setPagesText(e.target.value)}
              rows={3}
              placeholder={"/dashboard/servers\n/dashboard/billing"}
              className="resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs outline-none placeholder:text-white/35 focus:border-white/30"
            />
            <span className="text-xs text-white/40">{t("admin.announce.pagesHint")}</span>
          </label>
        )}

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("admin.announce.title")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("admin.announce.titlePlaceholder")}
            className={fieldCls}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">{t("admin.announce.description")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder={t("admin.announce.descPlaceholder")}
            className="resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
          />
          <span className="text-xs text-white/40">{t("admin.announce.descHint")}</span>
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white/70">{t("admin.announce.buttons")}</span>
            {buttons.length < 4 && (
              <button
                type="button"
                onClick={addBtn}
                className="inline-flex items-center gap-1 text-xs text-white/60 transition-colors hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("admin.announce.addButton")}
              </button>
            )}
          </div>
          {buttons.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-2">
              <input
                value={b.label}
                onChange={(e) => setBtn(i, { label: e.target.value })}
                placeholder={t("admin.announce.btnLabel")}
                className="h-9 min-w-[120px] flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
              />
              <input
                value={b.url}
                onChange={(e) => setBtn(i, { url: e.target.value })}
                placeholder="https://…"
                className="h-9 min-w-[160px] flex-[2] rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
              />
              <Select
                value={b.color}
                onChange={(v) => setBtn(i, { color: v as ButtonColor })}
                className="h-9 px-3 text-sm"
                options={ANNOUNCE_COLORS.map((c) => ({ value: c.id, label: c.label }))}
              />
              <button
                type="button"
                onClick={() => removeBtn(i)}
                className="text-white/40 transition-colors hover:text-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          <span className="text-sm text-white/70">{t("admin.announce.activeLabel")}</span>
        </label>

        {formError && <p className="text-sm text-red-300">{formError}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {item ? t("admin.announce.save") : t("admin.announce.create")}
          </button>
          {item && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t("admin.announce.delete")}
            </button>
          )}
        </div>
      </form>
    </FadeIn>
  );
}

function CategoryBadge({ name, color }: { name: string; color?: string | null }) {
  const c = color || "#888888";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{ borderColor: `${c}55`, backgroundColor: `${c}1a`, color: c }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
      {name}
    </span>
  );
}

// ----------------------------- Categories -----------------------------

function CategoriesPanel() {
  const { t } = useLang();
  const { data: cats, error, loading } = useQuery<TicketCategory[]>("ticket-categories");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await api("admin/ticket-categories", {
        method: "POST",
        json: { name: name.trim(), color },
      });
      setName("");
      await mutate("ticket-categories");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`admin/ticket-categories/${id}`, { method: "DELETE" });
      await mutate("ticket-categories");
    } catch {
      /* ignore */
    }
  };

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !cats) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <div className="space-y-4">
      <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.cats.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin.cats.namePlaceholder")}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.cats.color")}</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-11 w-16 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-1"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t("admin.cats.create")}
          </button>
        </form>
        {formError && <p className="mt-3 text-sm text-red-300">{formError}</p>}
      </FadeIn>

      {cats.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.cats.empty")}</p>
      ) : (
        <FadeIn
          delay={0.05}
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10"
        >
          {cats.map((c) => (
            <div key={c.id} className="flex items-center gap-4 bg-white/[0.02] p-4">
              <CategoryBadge name={c.name} color={c.color} />
              <span className="flex-1 truncate text-xs text-white/40">{c.slug}</span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label={t("admin.cats.delete")}
                className="text-white/40 transition-colors hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </FadeIn>
      )}
    </div>
  );
}

// ----------------------------- Roles -----------------------------

const PERM_LABELS: Record<string, string> = {};

function groupPerms(perms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    const prefix = p.split(".")[0];
    (groups[prefix] ??= []).push(p);
  }
  return groups;
}

function RolesPanel() {
  const { t } = useLang();
  const { data: roles, error, loading } = useQuery<Role[]>("admin/roles");
  const { data: catalog } = useQuery<PermissionsCatalog>("admin/permissions");
  const { data: cats } = useQuery<TicketCategory[]>("ticket-categories");
  const [editing, setEditing] = useState<Role | "new" | null>(null);

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !roles) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  return (
    <div className="space-y-4">
      <FadeIn className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-neutral-950 bg-neutral-900 px-4 text-sm font-medium transition-colors hover:bg-neutral-800"
        >
          <Plus className="h-4 w-4" />
          {t("admin.roles.new")}
        </button>
      </FadeIn>

      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          basePerms={catalog?.permissions ?? []}
          categories={cats ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      {roles.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.roles.empty")}</p>
      ) : (
        <FadeIn
          delay={0.05}
          className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10"
        >
          {roles.map((r) => (
            <div key={r.id} className="flex items-center gap-4 bg-white/[0.02] p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium">
                  {r.name}
                  {r.system && (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                      {t("admin.roles.system")}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-white/45">
                  {r.description || r.permissions.join(", ")}
                </p>
              </div>
              <button
                type="button"
                disabled={r.system}
                onClick={() => setEditing(r)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:text-white disabled:opacity-40 disabled:hover:text-white/70"
              >
                {t("admin.roles.edit")}
              </button>
            </div>
          ))}
        </FadeIn>
      )}
    </div>
  );
}

function RoleEditor({
  role,
  basePerms,
  categories,
  onClose,
}: {
  role: Role | null;
  basePerms: string[];
  categories: TicketCategory[];
  onClose: () => void;
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const all = perms.has("*");
  const toggle = (p: string) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const groups = groupPerms(basePerms);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setFormError(null);
    const permissions = Array.from(perms);
    try {
      if (role) {
        await api(`admin/roles/${role.id}`, {
          method: "PATCH",
          json: { name: name.trim(), description, permissions },
        });
      } else {
        await api("admin/roles", {
          method: "POST",
          json: { name: name.trim(), description, permissions },
        });
      }
      await mutate("admin/roles");
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!role || busy) return;
    if (!(await confirm({ title: t("admin.roles.confirmDelete"), confirmLabel: t("common.delete"), danger: true }))) return;
    setBusy(true);
    try {
      await api(`admin/roles/${role.id}`, { method: "DELETE" });
      await mutate("admin/roles");
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("admin.error"));
      setBusy(false);
    }
  };

  return (
    <FadeIn className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {role ? t("admin.roles.edit") : t("admin.roles.new")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("admin.roles.cancel")}
          className="text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.roles.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin.roles.namePlaceholder")}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-white/70">{t("admin.roles.description")}</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("admin.roles.descriptionPlaceholder")}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30"
            />
          </label>
        </div>

        <div className="space-y-3">
          <span className="text-sm font-medium text-white/70">{t("admin.roles.permissions")}</span>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <input
              type="checkbox"
              checked={all}
              onChange={() => toggle("*")}
              className="mt-0.5 h-4 w-4 accent-white"
            />
            <span>
              <span className="block text-sm font-medium">{t("admin.roles.permAll")}</span>
              <span className="block text-xs text-white/45">{t("admin.roles.permAllDesc")}</span>
            </span>
          </label>

          <div className={all ? "pointer-events-none opacity-40" : ""}>
            {Object.entries(groups).map(([group, list]) => (
              <div key={group} className="mb-3">
                <span className="block pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                  {group}
                </span>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {list.map((p) => (
                    <label
                      key={p}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={perms.has(p)}
                        onChange={() => toggle(p)}
                        className="h-4 w-4 accent-white"
                      />
                      {PERM_LABELS[p] ?? p}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {categories.length > 0 && (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="block text-sm font-medium">{t("admin.roles.catSection")}</span>
                <span className="mb-2 block text-xs text-white/45">
                  {t("admin.roles.catSectionDesc")}
                </span>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {categories.map((c) => {
                    const key = `support.cat.${c.slug}`;
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={perms.has(key)}
                          onChange={() => toggle(key)}
                          className="h-4 w-4 accent-white"
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {formError && <p className="text-sm text-red-300">{formError}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {role ? t("admin.roles.save") : t("admin.roles.create")}
          </button>
          {role && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-500/30 px-4 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t("admin.roles.delete")}
            </button>
          )}
        </div>
      </form>
    </FadeIn>
  );
}

// ----------------------------- Users -----------------------------

const userStatusStyles: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  unverified: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  suspended: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  banned: "border-red-500/30 bg-red-500/10 text-red-300",
};

function UsersPanel() {
  const { t } = useLang();
  const { data: users, error, loading } = useQuery<AdminUser[]>("admin/users");
  const { data: roles } = useQuery<Role[]>("admin/roles");

  if (loading) return <p className="text-sm text-white/50">{t("admin.loading")}</p>;
  if (error || !users) return <p className="text-sm text-red-300">{t("admin.error")}</p>;

  const roleById = new Map((roles ?? []).map((r) => [r.id, r]));

  return (
    <FadeIn className="space-y-3">
      {users.length === 0 ? (
        <p className="text-sm text-white/45">{t("admin.users.empty")}</p>
      ) : (
        users.map((u) => (
          <UserRow key={u.id} user={u} roles={roles ?? []} roleById={roleById} />
        ))
      )}
    </FadeIn>
  );
}

function UserRow({
  user,
  roles,
  roleById,
}: {
  user: AdminUser;
  roles: Role[];
  roleById: Map<string, Role>;
}) {
  const { t } = useLang();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const available = roles.filter((r) => !user.role_ids.includes(r.id));

  const add = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await api(`admin/users/${user.id}/roles`, { method: "POST", json: { role_id: pick } });
      setPick("");
      await mutate("admin/users");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (roleId: string) => {
    try {
      await api(`admin/users/${user.id}/roles/${roleId}`, { method: "DELETE" });
      await mutate("admin/users");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{user.display_name}</p>
          <p className="truncate text-xs text-white/45">{user.email}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            userStatusStyles[user.status] ?? userStatusStyles.active
          }`}
        >
          {t(`admin.users.status.${user.status}`)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {user.role_ids.length === 0 ? (
          <span className="text-xs text-white/40">{t("admin.users.noRoles")}</span>
        ) : (
          user.role_ids.map((rid) => (
            <span
              key={rid}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs"
            >
              {roleById.get(rid)?.name ?? rid}
              <button
                type="button"
                onClick={() => remove(rid)}
                aria-label={t("admin.users.remove")}
                className="text-white/40 transition-colors hover:text-red-300"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {available.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Select
            value={pick}
            onChange={setPick}
            placeholder={t("admin.users.pickRole")}
            className="h-9 px-3 text-sm"
            options={available.map((r) => ({ value: r.id, label: r.name }))}
          />
          <button
            type="button"
            onClick={add}
            disabled={!pick || busy}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm transition-colors hover:border-white/20 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {t("admin.users.add")}
          </button>
        </div>
      )}
    </div>
  );
}
