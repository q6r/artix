"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

type NavLink = { label: string; href: string };

export default function SiteHeaderMobile({
  links,
  loginLabel,
  registerLabel,
  dashboardLabel,
}: {
  links: NavLink[];
  loginLabel: string;
  registerLabel: string;
  dashboardLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/80 transition-colors hover:text-white"
      >
        <Menu className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[60]"
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
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-3 top-3 rounded-2xl border border-white/10 bg-neutral-950 p-3 shadow-2xl"
            >
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar"
                  className="text-white/45 transition-colors hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-xl px-3 py-3 text-sm font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
                {user ? (
                  <Link
                    href="/dashboard"
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-white py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-white/85"
                  >
                    {dashboardLabel}
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={() => setOpen(false)}
                      className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-center text-sm font-medium transition-colors hover:bg-white/10"
                    >
                      {loginLabel}
                    </Link>
                    <Link
                      href="/register"
                      onClick={() => setOpen(false)}
                      className="rounded-xl bg-white py-2.5 text-center text-sm font-medium text-black transition-colors hover:bg-white/85"
                    >
                      {registerLabel}
                    </Link>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
