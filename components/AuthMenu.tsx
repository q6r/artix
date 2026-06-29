"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { LayoutDashboard, LifeBuoy, LogOut } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";

/** Avatar + dropdown shown in the landing navbar when the user is signed in. */
export default function AuthMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = (user.display_name || user.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatar = (cls: string) =>
    user.avatar_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.avatar_url} alt="" className={`${cls} object-cover`} />
    ) : (
      <span
        className={`${cls} flex items-center justify-center bg-gradient-to-br from-sky-400 to-blue-600 text-xs font-semibold`}
      >
        {initials}
      </span>
    );

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    router.push("/");
  };

  const itemCls =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={user.display_name}
        className={`overflow-hidden mt-1.5 rounded-full border border-white/15 bg-white/5 transition-all duration-300 hover:border-white/40 ${
          compact ? "h-8 w-8" : "h-10 w-10"
        }`}
      >
        {avatar("h-full w-full")}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+10px)] w-60 origin-top-right overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 px-2.5 py-2">
              {avatar("h-9 w-9 shrink-0 rounded-full")}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.display_name}</p>
                <p className="truncate text-xs text-white/45">{user.email}</p>
              </div>
            </div>

            <div className="my-1 h-px bg-white/10" />

            <Link href="/dashboard" onClick={() => setOpen(false)} className={itemCls}>
              <LayoutDashboard className="h-4 w-4" strokeWidth={1.6} />
              {t("nav.painel")}
            </Link>
            <Link
              href="/dashboard/support"
              onClick={() => setOpen(false)}
              className={itemCls}
            >
              <LifeBuoy className="h-4 w-4" strokeWidth={1.6} />
              {t("dash.nav.tickets")}
            </Link>

            <div className="my-1 h-px bg-white/10" />

            <button
              type="button"
              onClick={handleLogout}
              className={`${itemCls} text-red-400 hover:bg-red-500/10 hover:text-red-300`}
            >
              <LogOut className="h-4 w-4" strokeWidth={1.6} />
              {t("dash.logout")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
