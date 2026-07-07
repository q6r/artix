"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

/** Desktop header actions — Dashboard when signed in, otherwise sign in / sign up. */
export default function SiteHeaderActions({
  dashboardLabel,
  loginLabel,
  registerLabel,
}: {
  dashboardLabel: string;
  loginLabel: string;
  registerLabel: string;
}) {
  const { user, loading } = useAuth();

  // While auth resolves, hold the space (no flash of the wrong state).
  if (loading) return <div className="h-9 w-40" aria-hidden />;

  if (user) {
    return (
      <Link
        href="/dashboard"
        className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/85"
      >
        {dashboardLabel}
      </Link>
    );
  }

  return (
    <>
      <Link href="/login" className="text-sm text-white/70 transition-colors hover:text-white">
        {loginLabel}
      </Link>
      <Link
        href="/register"
        className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/85"
      >
        {registerLabel}
      </Link>
    </>
  );
}
