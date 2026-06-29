"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Select from "@/components/Select";
import Link from "next/link";
import Tip from "@/components/Tip";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import Skeleton from "@/components/Skeleton";
import {
  SERVER_PERMS,
  formatMoney,
  type Org,
  type OrgDetail,
  type Subscription,
} from "@/lib/api/types";
import type { Locale } from "@/lib/dictionaries";
import {
  Bell,
  Building2,
  Check,
  Copy,
  CreditCard,
  HelpCircle,
  KeyRound,
  LogOut,
  Palette,
  Plus,
  Shield,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";

type SectionId =
  | "perfil"
  | "aparencia"
  | "seguranca"
  | "notificacoes"
  | "geral"
  | "plano"
  | "membros"
  | "permissoes";

const groups: {
  titleKey: string;
  items: { id: SectionId; labelKey: string; icon: typeof User }[];
}[] = [
    {
      titleKey: "dash.settings.group.account",
      items: [
        { id: "perfil", labelKey: "dash.settings.nav.profile", icon: User },
        { id: "aparencia", labelKey: "dash.settings.nav.appearance", icon: Palette },
        { id: "seguranca", labelKey: "dash.settings.nav.security", icon: Shield },
        { id: "notificacoes", labelKey: "dash.settings.nav.notifications", icon: Bell },
      ],
    },
    {
      titleKey: "dash.settings.group.organization",
      items: [
        { id: "geral", labelKey: "dash.settings.nav.general", icon: Building2 },
        { id: "plano", labelKey: "dash.settings.nav.plan", icon: CreditCard },
        { id: "membros", labelKey: "dash.settings.nav.members", icon: Users },
        { id: "permissoes", labelKey: "dash.settings.nav.permissions", icon: KeyRound },
      ],
    },
  ];

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-white" : "bg-white/15"
        }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${on ? "left-[22px] bg-black" : "left-0.5 bg-white/70"
          }`}
      />
    </button>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none placeholder:text-white/35 focus:border-white/30";

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-white/45">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function SectionShell({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-[60ch] text-sm leading-relaxed text-white/50">
          {desc}
        </p>
      </header>
      {children}
    </div>
  );
}

function ProfileSection() {
  const { t } = useLang();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const id = user?.id ?? "—";
  const initials = (user?.display_name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <SectionShell
      title={t("dash.settings.profile.title")}
      desc={t("dash.settings.profile.desc")}
    >
      <section className="flex items-center gap-5">
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt=""
            className="size-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-2xl font-semibold">
            {initials}
          </span>
        )}
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-sm font-medium">{t("dash.settings.profile.fullName")}</label>
          <input
            key={user?.display_name}
            className={inputCls}
            defaultValue={user?.display_name ?? ""}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-white/10 pt-6">
        <h3 className="text-sm font-semibold">{t("dash.settings.profile.personalDetails")}</h3>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t("dash.settings.profile.email")}</span>
          <span className="text-sm text-white/50">{user?.email ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{t("dash.settings.profile.userId")}</span>
            <span className="truncate font-mono text-xs text-white/50">{id}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(id);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex h-8 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? t("dash.settings.profile.copied") : t("dash.settings.profile.copy")}
          </button>
        </div>
      </section>
    </SectionShell>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState("dark");
  const { locale, setLocale, t } = useLang();
  const options = [
    { id: "dark", label: t("dash.settings.appearance.dark") },
    { id: "light", label: t("dash.settings.appearance.light") },
    { id: "system", label: t("dash.settings.appearance.system") },
  ];
  return (
    <SectionShell title={t("dash.settings.appearance.title")} desc={t("dash.settings.appearance.desc")}>
      <div className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setTheme(o.id)}
            className={`flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors ${theme === o.id
                ? "border-white/40 bg-white/[0.06]"
                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
          >
            <span
              className={`h-14 rounded-lg border border-white/10 ${o.id === "light" ? "bg-neutral-200" : "bg-neutral-900"
                }`}
            />
            <span className="text-sm font-medium">{o.label}</span>
          </button>
        ))}
      </div>

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
          {t("dash.settings.appearance.language")}
        </p>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("dash.settings.appearance.interfaceLanguage")}</p>
            <p className="mt-0.5 text-xs text-white/45">
              {t("dash.settings.appearance.languageNote")}
            </p>
          </div>
          <Select
            value={locale}
            onChange={(v) => setLocale(v as Locale)}
            className="h-10 w-56 px-3 text-sm"
            options={[
              { value: "pt", label: "Português (Brasil)" },
              { value: "en", label: "English" },
              { value: "es", label: "Español" },
            ]}
          />
        </div>
      </div>
    </SectionShell>
  );
}

function SecuritySection() {
  const { t } = useLang();
  const [status, setStatus] = useState<{ enabled: boolean; remaining: number } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadStatus = async () => {
    try {
      setStatus(await api<{ enabled: boolean; remaining: number }>("auth/backup-codes"));
    } catch {
      /* not signed in / transient */
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await api<{ enabled: boolean; remaining: number }>("auth/backup-codes");
        if (active) setStatus(s);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api<{ codes: string[] }>("auth/backup-codes", { method: "POST" });
      setCodes(r.codes);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await api("auth/backup-codes", { method: "DELETE" });
      setCodes(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <SectionShell
      title={t("dash.settings.security.title")}
      desc={t("dash.settings.security.backupDesc")}
    >
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-white/70" strokeWidth={1.6} />
          <div className="flex-1">
            <p className="text-sm font-medium">{t("dash.settings.security.backupTitle")}</p>
            <p className="text-xs text-white/50">
              {status?.enabled
                ? `${status.remaining} ${t("dash.settings.security.backupRemaining")}`
                : t("dash.settings.security.backupDisabled")}
            </p>
          </div>
          <div className="flex gap-2">
            {status?.enabled && (
              <button
                onClick={disable}
                disabled={busy}
                className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {t("dash.settings.security.backupDisable")}
              </button>
            )}
            <button
              onClick={generate}
              disabled={busy}
              className="h-8 rounded-lg bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
            >
              {status?.enabled
                ? t("dash.settings.security.backupRegenerate")
                : t("dash.settings.security.backupGenerate")}
            </button>
          </div>
        </div>

        {codes && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
            <p className="text-xs text-amber-200">{t("dash.settings.security.backupSaveWarning")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {codes.map((c) => (
                <code
                  key={c}
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-center font-mono text-sm tracking-widest"
                >
                  {c}
                </code>
              ))}
            </div>
            <button
              onClick={copyAll}
              className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium transition-colors hover:bg-white/10"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("dash.settings.security.backupCopied") : t("dash.settings.security.backupCopyAll")}
            </button>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

function NotificationsSection() {
  const { t } = useLang();
  return (
    <SectionShell
      title={t("dash.settings.notifications.title")}
      desc={t("dash.settings.notifications.desc")}
    >
      <div className="flex flex-col gap-3">
        <Row title={t("dash.settings.notifications.serverAlerts")} desc={t("dash.settings.notifications.serverAlertsDesc")}>
          <Toggle defaultOn />
        </Row>
        <Row title={t("dash.settings.notifications.billing")} desc={t("dash.settings.notifications.billingDesc")}>
          <Toggle defaultOn />
        </Row>
        <Row title={t("dash.settings.notifications.product")} desc={t("dash.settings.notifications.productDesc")}>
          <Toggle />
        </Row>
      </div>
    </SectionShell>
  );
}

// ----------------------------- Organization (real data) -----------------------------

type OrgSectionProps = {
  orgs: Org[];
  orgId: string | null;
  setOrgId: (id: string) => void;
};

function OrgEmpty() {
  const { t } = useLang();
  return (
    <Link
      href="/dashboard/organizations"
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center transition-colors hover:bg-white/[0.04]"
    >
      <Building2 className="h-7 w-7 text-white/30" strokeWidth={1.6} />
      <p className="mt-2 text-sm text-white/55">{t("dash.settings.org.none")}</p>
      <span className="mt-2 text-xs font-medium text-white/70">
        {t("dash.settings.org.manage")}
      </span>
    </Link>
  );
}

function OrgPickerBar({ orgs, orgId, setOrgId }: OrgSectionProps) {
  if (orgs.length <= 1) return null;
  return (
    <Select
      value={orgId ?? ""}
      onChange={setOrgId}
      className="h-10 w-full max-w-xs px-3 text-sm"
      options={orgs.map((o) => ({ value: o.id, label: o.name }))}
    />
  );
}

function initialsOf(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function GeneralSection(p: OrgSectionProps) {
  const { t } = useLang();
  const { data: org } = useQuery<OrgDetail>(p.orgId ? `orgs/${p.orgId}` : null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (org) setName(org.name);
  }, [org?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!p.orgId || !name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`orgs/${p.orgId}`, { method: "PATCH", json: { name: name.trim() } });
      await mutate(`orgs/${p.orgId}`);
      void mutate("orgs");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("org.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell title={t("dash.settings.general.title")} desc={t("dash.settings.general.desc")}>
      {p.orgs.length === 0 ? (
        <OrgEmpty />
      ) : (
        <div className="grid gap-3">
          <OrgPickerBar {...p} />
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("dash.settings.general.orgName")}</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="h-10 w-fit rounded-xl bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-white/85 disabled:opacity-50"
          >
            {t("org.save")}
          </button>
        </div>
      )}
    </SectionShell>
  );
}

function PlanSection() {
  const { t } = useLang();
  const { data: subs } = useQuery<Subscription[]>("billing/subscriptions");
  return (
    <SectionShell title={t("dash.settings.plan.title")} desc={t("dash.settings.plan.desc")}>
      {!subs ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : subs.length === 0 ? (
        <p className="text-sm text-white/45">{t("dash.settings.plan.none")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {subs.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div>
                <p className="text-sm text-white/50">{t("dash.settings.plan.current")}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight">{s.plan}</p>
                <p className="mt-0.5 text-xs text-white/45">
                  {formatMoney(s.price_cents, s.currency)} / {s.interval}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  s.status === "active"
                    ? "bg-emerald-400/10 text-emerald-400"
                    : "bg-white/10 text-white/60"
                }`}
              >
                {s.status === "active" ? t("dash.settings.plan.active") : s.status}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link
        href="/dashboard/billing"
        className="inline-flex h-9 w-fit items-center rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
      >
        {t("dash.settings.plan.manage")}
      </Link>
    </SectionShell>
  );
}

function MembersSection(p: OrgSectionProps) {
  const { t } = useLang();
  const { data: org } = useQuery<OrgDetail>(p.orgId ? `orgs/${p.orgId}` : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [err, setErr] = useState<string | null>(null);

  const call = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      if (p.orgId) await mutate(`orgs/${p.orgId}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("org.error"));
    }
  };

  const isManager = org?.role === "owner" || org?.role === "admin";
  const isOwner = org?.role === "owner";

  return (
    <SectionShell title={t("dash.settings.members.title")} desc={t("dash.settings.members.desc")}>
      {p.orgs.length === 0 ? (
        <OrgEmpty />
      ) : (
        <div className="flex flex-col gap-4">
          <OrgPickerBar {...p} />

          {isManager && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!email.trim() || !p.orgId) return;
                call(() =>
                  api(`orgs/${p.orgId}/members`, {
                    method: "POST",
                    json: { email: email.trim(), role },
                  }),
                ).then(() => setEmail(""));
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("org.emailPlaceholder")}
                className={`${inputCls} flex-1`}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm outline-none focus:border-white/30"
              >
                <option value="member">{t("org.role.member")}</option>
                <option value="admin">{t("org.role.admin")}</option>
              </select>
              <button
                type="submit"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
              >
                <Plus className="h-4 w-4" />
                {t("org.invite")}
              </button>
            </form>
          )}

          {err && <p className="text-sm text-red-300">{err}</p>}

          {!org ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : (
            <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
              {org.members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-3 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                    {initialsOf(m.display_name || m.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.display_name}</p>
                    <p className="truncate text-xs text-white/45">{m.email}</p>
                  </div>
                  {isOwner && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        call(() =>
                          api(`orgs/${p.orgId}/members/${m.user_id}`, {
                            method: "PATCH",
                            json: { role: e.target.value },
                          }),
                        )
                      }
                      className="h-8 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-xs outline-none focus:border-white/30"
                    >
                      <option value="member">{t("org.role.member")}</option>
                      <option value="admin">{t("org.role.admin")}</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/60">
                      {t(`org.role.${m.role}`)}
                    </span>
                  )}
                  {isManager && m.role !== "owner" && (
                    <button
                      onClick={() =>
                        call(() =>
                          api(`orgs/${p.orgId}/members/${m.user_id}`, { method: "DELETE" }),
                        )
                      }
                      aria-label={t("org.removeMember")}
                      className="text-white/40 transition-colors hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}

function PermissionsSection(p: OrgSectionProps) {
  const { t } = useLang();
  const { data: org } = useQuery<OrgDetail>(p.orgId ? `orgs/${p.orgId}` : null);
  const isManager = org?.role === "owner" || org?.role === "admin";
  const members = (org?.members ?? []).filter((m) => m.role === "member");

  return (
    <SectionShell
      title={t("dash.settings.permissions.title")}
      desc={t("dash.settings.permissions.desc")}
    >
      {p.orgs.length === 0 ? (
        <OrgEmpty />
      ) : (
        <div className="flex flex-col gap-4">
          <OrgPickerBar {...p} />
          {!org ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : !isManager ? (
            <p className="text-sm text-white/45">{t("org.grants.desc")}</p>
          ) : members.length === 0 || org.servers.length === 0 ? (
            <p className="text-sm text-white/45">{t("org.grants.desc")}</p>
          ) : (
            members.map((m) => (
              <div
                key={m.user_id}
                className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
              >
                <p className="text-sm font-semibold">{m.display_name}</p>
                <p className="text-xs text-white/45">{m.email}</p>
                <div className="mt-3 space-y-3">
                  {org.servers.map((s) => (
                    <GrantRow
                      key={s.id}
                      orgId={p.orgId!}
                      serverId={s.id}
                      serverName={s.name}
                      userId={m.user_id}
                      initial={m.grants[s.id] ?? []}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </SectionShell>
  );
}

function GrantRow({
  orgId,
  serverId,
  serverName,
  userId,
  initial,
}: {
  orgId: string;
  serverId: string;
  serverName: string;
  userId: string;
  initial: string[];
}) {
  const { t } = useLang();
  const [perms, setPerms] = useState<Set<string>>(new Set(initial));
  const [dirty, setDirty] = useState(false);

  const toggle = (perm: string) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    await api(`orgs/${orgId}/servers/${serverId}/grants/${userId}`, {
      method: "PUT",
      json: { perms: Array.from(perms) },
    });
    void mutate(`orgs/${orgId}`);
    setDirty(false);
  };

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
        {SERVER_PERMS.map((perm) => {
          const on = perms.has(perm);
          return (
            <button
              key={perm}
              onClick={() => toggle(perm)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-white/5 text-white/45 hover:bg-white/10"
              }`}
            >
              {t(`org.perm.${perm}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function renderSection(id: SectionId, orgProps: OrgSectionProps): React.ReactNode {
  switch (id) {
    case "perfil":
      return <ProfileSection />;
    case "aparencia":
      return <AppearanceSection />;
    case "seguranca":
      return <SecuritySection />;
    case "notificacoes":
      return <NotificationsSection />;
    case "geral":
      return <GeneralSection {...orgProps} />;
    case "plano":
      return <PlanSection />;
    case "membros":
      return <MembersSection {...orgProps} />;
    case "permissoes":
      return <PermissionsSection {...orgProps} />;
  }
}

export default function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const { user } = useAuth();
  const [active, setActive] = useState<SectionId>("perfil");
  const { data: orgs } = useQuery<Org[]>(open ? "orgs" : null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (orgs && orgs.length && (!orgId || !orgs.some((o) => o.id === orgId))) {
      setOrgId(orgs[0].id);
    }
  }, [orgs, orgId]);

  const orgProps: OrgSectionProps = { orgs: orgs ?? [], orgId, setOrgId };

  const initials = (user?.display_name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            role="dialog"
            aria-label={t("dash.settings.title")}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex h-[min(88vh,760px)] w-[min(96vw,1000px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
          >
            {/* Sub-sidebar */}
            <aside className="flex w-[256px] shrink-0 flex-col border-r border-white/10 bg-white/[0.02]">
              <header className="flex items-center gap-3 px-4 py-4">
                {user?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="size-9 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-xs font-semibold">
                    {initials}
                  </span>
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold">
                    {user?.display_name ?? "—"}
                  </span>
                  <span className="truncate text-[11px] text-white/45">
                    {user?.email ?? ""}
                  </span>
                </div>
              </header>

              <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-2 pb-4 pt-1">
                {groups.map((g) => (
                  <div key={g.titleKey} className="flex flex-col gap-0.5">
                    <span className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                      {t(g.titleKey)}
                    </span>
                    {g.items.map((it) => {
                      const Icon = it.icon;
                      const isActive = active === it.id;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setActive(it.id)}
                          className={`group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${isActive
                              ? "bg-white/10 text-white"
                              : "text-white/65 hover:bg-white/5 hover:text-white"
                            }`}
                        >
                          <Icon className="h-4 w-4" strokeWidth={1.75} />
                          <span className="truncate mt-0.5">{t(it.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>

              <footer className="flex flex-col gap-0.5 border-t border-white/10 p-2">
                <Link href="/dashboard/support" onClick={onClose} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-white/65 transition-colors hover:bg-white/5 hover:text-white">
                  <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
                  <a className="mt-0.5">{t("dash.settings.helpSupport")}</a>
                </Link>
                <button className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10">
                  <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  <a className="mt-0.5">{t("dash.settings.logout")}</a>
                </button>
              </footer>
            </aside>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  {renderSection(active, orgProps)}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Close */}
            <Tip label={t("dash.settings.close")} side="left">
              <button
                type="button"
                onClick={onClose}
                aria-label={t("dash.settings.close")}
                className="absolute right-4 top-4 rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </Tip>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
