"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Bounces an expired access token through the BFF refresh (which rotates and
 * saves the cookies), then re-runs the server component. Falls back to /login
 * when the session is truly gone. Used by server-gated staff pages.
 */
export default function SessionRefresh() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) router.refresh();
        else window.location.href = "/login";
      } catch {
        if (!cancelled) window.location.href = "/login";
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-white/45">
      Carregando…
    </div>
  );
}
