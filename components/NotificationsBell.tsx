"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "@/components/animate-ui/icons/bell";
import Tip from "@/components/Tip";
import { useLang } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import { useSubscription } from "@/hooks/use-subscription";
import { api } from "@/lib/api/client";
import { useQuery, mutate } from "@/lib/api/query";
import type { NotificationsResponse } from "@/lib/api/types";

function fmtTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === "pt" ? "pt-BR" : locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function NotificationsBell() {
  const { t, locale } = useLang();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery<NotificationsResponse>("notifications");
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  // Live: refetch when a notification arrives on this user's topic.
  useSubscription(user ? `user:${user.id}` : null, (event) => {
    if (event === "notification") void mutate("notifications");
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await api("notifications/read", { method: "POST" });
        void mutate("notifications");
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div ref={ref} className="relative">
      <Tip label={t("dash.notifications")} side="bottom">
        <button
          type="button"
          onClick={toggle}
          aria-label={t("dash.notifications")}
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition-colors hover:text-white"
        >
          <Bell size={16} animateOnHover />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Tip>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl">
          <div className="border-b border-white/10 px-4 py-3">
            <span className="text-sm font-semibold">{t("dash.notif.title")}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-white/45">{t("dash.notif.empty")}</p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div
                    className={`flex flex-col gap-0.5 border-b border-white/5 px-4 py-3 ${
                      n.read ? "" : "bg-white/[0.03]"
                    }`}
                  >
                    <span className="text-sm font-medium">{n.title}</span>
                    <span className="text-xs leading-relaxed text-white/55">{n.body}</span>
                    <span className="mt-0.5 text-[11px] text-white/35">
                      {fmtTime(n.created_at, locale)}
                    </span>
                  </div>
                );
                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    onClick={() => setOpen(false)}
                    className="block transition-colors hover:bg-white/[0.04]"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
