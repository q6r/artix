"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useQuery } from "@/lib/api/query";
import { renderMarkdown } from "@/lib/markdown";
import type { Announcement, AnnouncementButton, ButtonColor } from "@/lib/api/types";

const BTN: Record<ButtonColor, string> = {
  blue: "bg-blue-600 hover:bg-blue-500 text-white",
  red: "bg-red-600 hover:bg-red-500 text-white",
  gray: "bg-white/10 hover:bg-white/20 text-white",
  green: "bg-emerald-600 hover:bg-emerald-500 text-white",
};

function matchesScope(a: Announcement, path: string): boolean {
  if (a.scope === "global") return true;
  if (a.scope === "dashboard") return path.startsWith("/dashboard");
  return a.pages.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));
}

function ActionButton({ btn }: { btn: AnnouncementButton }) {
  // Only allow http(s)/relative hrefs — never javascript:/data: etc.
  const href = /^(https?:\/\/|\/)/.test(btn.url) ? btn.url : "#";
  const external = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-xs font-medium transition-colors ${BTN[btn.color] ?? BTN.gray}`}
    >
      {btn.label}
    </a>
  );
}

export default function AnnouncementHost() {
  const pathname = usePathname();
  const { data } = useQuery<Announcement[]>("announcements");

  // Dismissed keys (`id:updated_at`) read once from localStorage. Announcements
  // are client-fetched, so there is no SSR markup to mismatch on hydration.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (typeof window !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("ann_x_")) s.add(k.slice(6));
      }
    }
    return s;
  });

  const dismiss = (key: string) => {
    try {
      localStorage.setItem(`ann_x_${key}`, "1");
    } catch {
      /* storage may be blocked */
    }
    setDismissed((prev) => new Set(prev).add(key));
  };

  if (!data) return null;
  const keyOf = (a: Announcement) => `${a.id}:${a.updated_at}`;
  const visible = data.filter(
    (a) => a.active && matchesScope(a, pathname) && !dismissed.has(keyOf(a)),
  );
  const banners = visible.filter((a) => a.kind === "banner");
  const modal = visible.find((a) => a.kind === "modal");

  return (
    <>
      {banners.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-3 border-b border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm backdrop-blur"
        >
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{a.title}</span>
            {a.description && (
              <span className="text-white/70"> — {renderMarkdown(a.description)}</span>
            )}
          </p>
          {a.buttons.map((b, i) => (
            <ActionButton key={i} btn={b} />
          ))}
          <button
            type="button"
            onClick={() => dismiss(keyOf(a))}
            aria-label="Fechar"
            className="shrink-0 text-white/45 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <AnimatePresence>
        {modal && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => dismiss(keyOf(modal))}
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl"
            >
              <button
                type="button"
                onClick={() => dismiss(keyOf(modal))}
                aria-label="Fechar"
                className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
              <h2 className="pr-8 text-lg font-semibold tracking-tight">{modal.title}</h2>
              {modal.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/65">
                  {renderMarkdown(modal.description)}
                </p>
              )}
              {modal.buttons.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {modal.buttons.map((b, i) => (
                    <ActionButton key={i} btn={b} />
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
