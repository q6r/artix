// Server-side environment access for the Next.js app.
//
// Everything the server reads from the environment goes through this module, so the
// defaults, the parsing rules and the error messages live in one place. The rules match
// the Rust API (see docs/configuration.md):
//   - a blank value is the same as unset;
//   - URLs must be absolute http(s) URLs, and a bad one fails with a message naming the variable.
//
// NEXT_PUBLIC_* variables are inlined into the browser bundle at build time, so they have to
// be written literally where they are used (see `process.env.NEXT_PUBLIC_WS_URL` in
// lib/ws/client.ts). They are not read here.

if (typeof window !== "undefined") {
  throw new Error("lib/env.ts is server-only and must not be imported from client code");
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Base URL of the Rust API as seen from the Next.js server. Never sent to the browser. */
export function apiBaseUrl(): string {
  const raw = read("API_INTERNAL_URL") ?? "http://127.0.0.1:8080";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`API_INTERNAL_URL must be an absolute http(s) URL, got "${raw}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`API_INTERNAL_URL must be an absolute http(s) URL, got "${raw}"`);
  }
  return raw.replace(/\/+$/, "");
}

let warnedAboutCookieFlag = false;

/**
 * True only when COOKIE_INSECURE is exactly "true": the auth cookies then lose their Secure
 * flag, which is meant for local development over plain http. Any other value keeps them
 * Secure (fail safe) and logs one warning so a typo does not go unnoticed.
 */
export function cookiesInsecure(): boolean {
  const raw = read("COOKIE_INSECURE");
  if (raw === undefined || raw === "false") return false;
  if (raw === "true") return true;
  if (!warnedAboutCookieFlag) {
    warnedAboutCookieFlag = true;
    console.warn(`COOKIE_INSECURE must be "true" or "false", got "${raw}": the cookies stay Secure`);
  }
  return false;
}
