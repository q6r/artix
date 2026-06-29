import { proxyToBackend } from "@/lib/api/server";

// Authenticated transparent proxy to the Rust backend for every non-auth route
// (billing, servers, sessions, admin, …). The backend enforces authorization
// per route, so forwarding the caller's own token grants nothing extra.
//
// Sensitive token endpoints are handled by dedicated routes; refuse to proxy
// them here so they can't be reached without the cookie plumbing.
const BLOCKED = new Set([
  "auth/refresh",
  "auth/request-code",
  "auth/verify-code",
  "auth/verify-backup-code",
  "auth/logout",
  // Returns a session (refresh token) — must never be relayed to client JS;
  // the server-side /oauth/callback route handles it.
  "oauth/exchange",
]);

async function handle(request: Request, ctx: RouteContext<"/api/[...path]">) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (BLOCKED.has(joined)) {
    return new Response(null, { status: 404 });
  }
  return proxyToBackend(request, `/${joined}`);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
