"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useQuery, mutate, writeCache } from "@/lib/api/query";
import type { User } from "@/lib/api/types";

type AuthState = {
  user: User | null;
  loading: boolean;
  /** Passwordless step 1: email a login code. */
  requestCode: (email: string, displayName?: string) => Promise<void>;
  /** Passwordless step 2: verify the emailed code and start the session. */
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Alternative step 2: sign in with a single-use backup code. */
  verifyBackupCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Routed through the shared cache: one `me` request even under StrictMode,
  // and no refetch when navigating between dashboard pages.
  const { data, loading } = useQuery<User>("auth/me");
  const user = data ?? null;

  const requestCode = useCallback(async (email: string, displayName?: string) => {
    await api("auth/request-code", {
      method: "POST",
      json: { email, display_name: displayName },
    });
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const res = await api<{ user: User }>("auth/verify-code", {
      method: "POST",
      json: { email, code },
    });
    writeCache("auth/me", res.user); // seed the cache; no extra /me call
  }, []);

  const verifyBackupCode = useCallback(async (email: string, code: string) => {
    const res = await api<{ user: User }>("auth/verify-backup-code", {
      method: "POST",
      json: { email, code },
    });
    writeCache("auth/me", res.user);
  }, []);

  const logout = useCallback(async () => {
    await api("auth/logout", { method: "POST" }).catch(() => {});
    writeCache("auth/me", null);
  }, []);

  const refresh = useCallback(async () => {
    await mutate("auth/me");
  }, []);

  return (
    <Ctx.Provider
      value={{ user, loading, requestCode, verifyCode, verifyBackupCode, logout, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
