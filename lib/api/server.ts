// Server-only Backend-for-Frontend (BFF) layer.
//
// The browser never sees the Rust API or the auth tokens: it talks only to
// same-origin Next route handlers, which attach the httpOnly access token and
// transparently refresh it. Tokens live in httpOnly+SameSite cookies, so they
// are not reachable from JS (XSS can't exfiltrate them).

import { cookies } from "next/headers";
import type { User } from "@/lib/api/types";

export const AT_COOKIE = "artix_at";
export const RT_COOKIE = "artix_rt";

/** Base URL of the Rust backend (server-side only — never shipped to the client). */
export function backendBase(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:8080";
}

// Secure cookies everywhere except explicit local development over http. This
// avoids leaking tokens in cleartext on staging/preview boxes (where NODE_ENV
// may not be "production" but the host is still internet-reachable).
const cookieSecure = process.env.COOKIE_INSECURE !== "true";

type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

/** Persist the access + refresh tokens as httpOnly cookies. */
export async function setAuthCookies(t: Tokens) {
  const jar = await cookies();
  const common = { httpOnly: true, secure: cookieSecure, sameSite: "lax" as const, path: "/" };
  jar.set(AT_COOKIE, t.access_token, { ...common, maxAge: Math.max(60, t.expires_in) });
  // Refresh token lifetime mirrors the backend default (30 days).
  jar.set(RT_COOKIE, t.refresh_token, { ...common, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(AT_COOKIE);
  jar.delete(RT_COOKIE);
}

/** Raw call to the backend (no auth handling). */
export function backendFetch(path: string, init?: RequestInit) {
  return fetch(`${backendBase()}${path}`, { ...init, cache: "no-store" });
}

/** The real client IP as seen by the edge, to forward to the backend (so its
 * rate-limiter / lockout key on the user, not on the BFF). */
export function clientIp(request: Request): string | null {
  // Cloudflare sets CF-Connecting-IP and strips any client-supplied copy, so it
  // can't be spoofed through the edge (unlike the first X-Forwarded-For element,
  // which the client controls). Prefer it for the rate-limit/audit key.
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/** Headers to forward the client IP + content-type to the backend. Mirrors the
 * incoming content-type verbatim so a `multipart/form-data; boundary=…` (the
 * container deploy upload) reaches the backend with its boundary intact. */
export function forwardHeaders(request: Request): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": request.headers.get("content-type") ?? "application/json",
  };
  const ip = clientIp(request);
  if (ip) h["x-forwarded-for"] = ip;
  return h;
}

/** Exchange the refresh token for a fresh token pair, rotating the cookies. */
async function tryRefresh(): Promise<string | null> {
  const jar = await cookies();
  const rt = jar.get(RT_COOKIE)?.value;
  if (!rt) return null;

  const res = await backendFetch("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!res.ok) {
    await clearAuthCookies();
    return null;
  }
  const data = (await res.json()) as Tokens;
  await setAuthCookies(data);
  return data.access_token;
}

/**
 * Forward an incoming Next request to the backend with the user's access token,
 * refreshing once on 401. Returns a Response mirroring the backend's status/body.
 */
/**
 * CSRF defense-in-depth for state-changing requests: they must originate from
 * our own origin. Returns a 403 Response to short-circuit, or `null` if allowed.
 * Applied by `proxyToBackend` AND directly by the dedicated auth route handlers
 * (which don't go through the proxy).
 */
export function csrfBlock(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;
  const url = new URL(request.url);
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  // Behind a proxy, `request.url` resolves to the internal bind
  // (localhost:3000), so compare against the public Host/proto headers.
  const fwdHost = request.headers.get("host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const expectedOrigin = fwdHost ? `${fwdProto}://${fwdHost}` : url.origin;
  const sameSite = site ? site === "same-origin" || site === "same-site" : null;
  const okOrigin = origin ? origin === expectedOrigin : null;
  if (sameSite === false || okOrigin === false) {
    return Response.json(
      { error: { code: "forbidden", message: "cross-site request blocked" } },
      { status: 403 },
    );
  }
  return null;
}

export async function proxyToBackend(request: Request, path: string): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const blocked = csrfBlock(request);
  if (blocked) return blocked;

  const jar = await cookies();
  const search = url.search;
  const hasBody = method !== "GET" && method !== "HEAD";
  // Binary-safe: request.text() would UTF-8-corrupt a zip upload. Buffering
  // (not streaming request.body) keeps content-length, which the backend's
  // multipart parser needs. Round-trips JSON byte-for-byte too.
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

  // External API-key auth: forward a `Bearer ak_…` header verbatim (the backend
  // validates it). Only the `ak_` form is forwarded — session tokens come from
  // our own httpOnly cookie, never from the client.
  const clientAuth = request.headers.get("authorization");
  const apiKey =
    clientAuth && clientAuth.startsWith("Bearer ak_") ? clientAuth : undefined;

  const call = (accessToken?: string) => {
    const headers = forwardHeaders(request);
    if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;
    else if (apiKey) headers["authorization"] = apiKey;
    return backendFetch(`${path}${search}`, { method, headers, body });
  };

  let access = jar.get(AT_COOKIE)?.value;
  let res = await call(access);

  // Cookie sessions can be refreshed; API keys cannot (and don't need to).
  if (res.status === 401 && !apiKey) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      access = refreshed;
      res = await call(access);
    }
  }

  // Stream the backend body straight through (binary-safe: text() would corrupt
  // a download). Preserve status + content-type/disposition/length.
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") ?? "application/json");
  const cd = res.headers.get("content-disposition");
  if (cd) headers.set("content-disposition", cd);
  const cl = res.headers.get("content-length");
  if (cl) headers.set("content-length", cl);
  return new Response(res.body, { status: res.status, headers });
}

/**
 * Server-only: resolve the current user from the access-token cookie WITHOUT
 * refreshing (server components can't write cookies). `expired` tells the caller
 * to bounce through a client-side refresh. Used to hard-gate staff pages so the
 * UI is never even rendered for unauthorized users.
 */
export async function getMe(): Promise<{ user: User | null; expired: boolean }> {
  const jar = await cookies();
  const access = jar.get(AT_COOKIE)?.value;
  if (!access) return { user: null, expired: true };
  const res = await backendFetch("/auth/me", {
    headers: { authorization: `Bearer ${access}` },
  });
  if (res.status === 401) return { user: null, expired: true };
  if (!res.ok) return { user: null, expired: false };
  return { user: (await res.json()) as User, expired: false };
}
