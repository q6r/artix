"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X, Plus } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { hasAdminAccess, hasSupportAccess } from "@/lib/permissions";
import OverviewIcon from "@/components/icons/OverviewIcon";
import ServersIcon from "@/components/icons/ServersIcon";
import WalletIcon from "@/components/icons/WalletIcon";
import OrgsIcon from "@/components/icons/OrgsIcon";
import AdminIcon from "@/components/icons/AdminIcon";
import TicketsIcon from "@/components/icons/TicketsIcon";
import { Settings } from "@/components/animate-ui/icons/settings";
import { LogOut } from "@/components/animate-ui/icons/log-out";

const primary = [
  { labelKey: "dash.nav.overview", href: "/dashboard", icon: OverviewIcon, exact: true },
  { labelKey: "dash.nav.servers", href: "/dashboard/servers", icon: ServersIcon },
  { labelKey: "dash.nav.organizations", href: "/dashboard/organizations", icon: OrgsIcon },
  { labelKey: "dash.nav.billing", href: "/dashboard/billing", icon: WalletIcon },
];

export default function DashboardMobileNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const initials = (user?.display_name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    router.push("/login");
  };

  const sheetItem =
    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors";

  return (
    <>
      {/* Bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-black/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map((item) => {
          const active = isActive(item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                active ? "text-white" : "text-white/45"
              }`}
            >
              <Icon size={20} animate={active ? "default" : undefined} />
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-white/45 transition-colors hover:text-white"
        >
          <Menu className="h-5 w-5" />
          <span>{t("dash.nav.menu")}</span>
        </button>
      </nav>

      {/* Full menu sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-neutral-950 pb-[env(safe-area-inset-bottom)]"
            >
              <div className="sticky top-0 flex items-center justify-between gap-3 bg-neutral-950 px-5 pb-3 pt-4">
                <div className="flex min-w-0 items-center gap-3">
                  {user?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-semibold">
                      {initials}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user?.display_name ?? "—"}</p>
                    <p className="truncate text-xs text-white/45">{user?.email ?? ""}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("dash.logout")}
                  className="shrink-0 text-white/45 transition-colors hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-1 px-3 pb-4">
                <Link
                  href="/dashboard/servers/new"
                  onClick={() => setOpen(false)}
                  className={`${sheetItem} mb-2 justify-center bg-white text-black hover:bg-white/85`}
                >
                  <Plus className="h-4 w-4" />
                  {t("dash.newVps")}
                </Link>

                {primary.map((item) => {
                  const active = isActive(item.href, item.exact);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`${sheetItem} ${active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
                    >
                      <Icon size={18} />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}

                <Link
                  href="/dashboard/support"
                  onClick={() => setOpen(false)}
                  className={`${sheetItem} ${
                    isActive("/dashboard/support") && !pathname.startsWith("/dashboard/admin")
                      ? "bg-white/10 text-white"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <TicketsIcon size={18} />
                  {t("dash.nav.tickets")}
                </Link>

                {(hasSupportAccess(user?.permissions) || hasAdminAccess(user?.permissions)) && (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    {hasSupportAccess(user?.permissions) && (
                      <Link
                        href="/dashboard/admin/support"
                        onClick={() => setOpen(false)}
                        className={`${sheetItem} ${isActive("/dashboard/admin/support") ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
                      >
                        <TicketsIcon size={18} />
                        {t("dash.nav.teamTickets")}
                      </Link>
                    )}
                    {hasAdminAccess(user?.permissions) && (
                      <Link
                        href="/dashboard/admin"
                        onClick={() => setOpen(false)}
                        className={`${sheetItem} ${
                          isActive("/dashboard/admin") && !isActive("/dashboard/admin/support")
                            ? "bg-white/10 text-white"
                            : "text-white/65 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <AdminIcon size={18} />
                        {t("admin.nav.title")}
                      </Link>
                    )}
                  </div>
                )}

                <div className="mt-2 border-t border-white/10 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenSettings();
                    }}
                    className={`${sheetItem} w-full text-white/65 hover:bg-white/5 hover:text-white`}
                  >
                    <Settings size={18} />
                    {t("dash.nav.settings")}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className={`${sheetItem} w-full text-red-300 hover:bg-red-500/10`}
                  >
                    <LogOut size={18} />
                    {t("dash.logout")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
