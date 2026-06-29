"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { hasAdminAccess, hasSupportAccess } from "@/lib/permissions";
import Logo from "@/components/Logo";
import SettingsModal from "@/components/SettingsModal";
import DashboardMobileNav from "@/components/DashboardMobileNav";
import DashboardIntro from "@/components/DashboardIntro";
import Tip from "@/components/Tip";
import DashboardCommand from "@/components/DashboardCommand";
import { TooltipProvider } from "@/components/animate-ui/components/animate/tooltip";
import OverviewIcon from "@/components/icons/OverviewIcon";
import ServersIcon from "@/components/icons/ServersIcon";
import WalletIcon from "@/components/icons/WalletIcon";
import OrgsIcon from "@/components/icons/OrgsIcon";
import AdminIcon from "@/components/icons/AdminIcon";
import TicketsIcon from "@/components/icons/TicketsIcon";
import { Settings } from "@/components/animate-ui/icons/settings";
import { Bell } from "@/components/animate-ui/icons/bell";
import { Plus } from "@/components/animate-ui/icons/plus";
import { LogOut } from "@/components/animate-ui/icons/log-out";

const nav = [
  { labelKey: "dash.nav.overview", href: "/dashboard", icon: OverviewIcon, exact: true },
  { labelKey: "dash.nav.servers", href: "/dashboard/servers", icon: ServersIcon },
  { labelKey: "dash.nav.organizations", href: "/dashboard/organizations", icon: OrgsIcon },
  { labelKey: "dash.nav.billing", href: "/dashboard/billing", icon: WalletIcon },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const { user, logout } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initials = (user?.display_name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const itemCls = (active: boolean) =>
    `group flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active
      ? "bg-white/10 text-white"
      : "text-white/55 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden h-full w-64 shrink-0 flex-col gap-6 border-r border-white/10 p-4 lg:flex">
          <div className="px-2 pt-2">
            <Logo />
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
              {t("dash.nav.menu")}
            </span>
            {nav.map((item) => {
              const active = isActive(item.href, item.exact);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={itemCls(active)}>
                  <Icon
                    size={18}
                    animateOnHover
                    animate={active ? "default" : undefined}
                  />
                  <a className="mt-0.5">{t(item.labelKey)}</a>
                </Link>
              );
            })}

            {(hasSupportAccess(user?.permissions) ||
              hasAdminAccess(user?.permissions)) && (
              <>
                <span className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
                  {t("dash.nav.team")}
                </span>
                {hasSupportAccess(user?.permissions) && (
                  <Link
                    href="/dashboard/admin/support"
                    className={itemCls(isActive("/dashboard/admin/support"))}
                  >
                    <TicketsIcon size={18} />
                    <a className="mt-0.5">{t("dash.nav.teamTickets")}</a>
                  </Link>
                )}
                {hasAdminAccess(user?.permissions) && (
                  <Link
                    href="/dashboard/admin"
                    className={itemCls(
                      isActive("/dashboard/admin") &&
                        !isActive("/dashboard/admin/support"),
                    )}
                  >
                    <AdminIcon size={18} />
                    <a className="mt-0.5">{t("admin.nav.title")}</a>
                  </Link>
                )}
              </>
            )}

            <span className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">
              {t("dash.nav.account")}
            </span>
            <Link
              href="/dashboard/support"
              className={itemCls(
                isActive("/dashboard/support") &&
                  !pathname.startsWith("/dashboard/admin"),
              )}
            >
              <TicketsIcon size={18} />
              <a className="mt-0.5">{t("dash.nav.tickets")}</a>
            </Link>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={itemCls(false)}
            >
              <Settings size={18} animateOnHover />
              <a className="mt-0.5"> {t("dash.nav.settings")} </a>
            </button>
          </nav>

          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-xs font-semibold">
                {initials}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.display_name ?? "—"}</p>
              <p className="truncate text-xs text-white/45">{user?.email ?? ""}</p>
            </div>
            <Tip label={t("dash.logout")}>
              <button
                type="button"
                onClick={handleLogout}
                aria-label={t("dash.logout")}
                className="group text-white/45 transition-colors hover:text-white"
              >
                <LogOut size={16} animateOnHover />
              </button>
            </Tip>
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-white/10 bg-black/60 px-4 backdrop-blur-xl sm:px-6">
            <Link href="/dashboard" className="lg:hidden">
              <Logo />
            </Link>

            <div className="hidden flex-1 lg:block">
              <DashboardCommand />
            </div>

            <div className="flex items-center gap-3">
              <Tip label={t("dash.notifications")} side="bottom">
                <button
                  aria-label={t("dash.notifications")}
                  className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white"
                >
                  <Bell size={16} animateOnHover />
                </button>
              </Tip>
              <Link
                href="/dashboard/servers/new"
                className="group flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85"
              >
                <Plus size={16} animateOnHover />
                <a className="mt-0.5">{t("dash.newVps")}</a>
              </Link>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-6">
            {children}
          </main>
        </div>

        {/* Mobile bottom navigation + full menu sheet */}
        <DashboardMobileNav onOpenSettings={() => setSettingsOpen(true)} />

        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />

        <DashboardIntro />
      </div>
    </TooltipProvider>
  );
}
