import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backendFetch, forwardHeaders, setAuthCookies } from "@/lib/api/server";

// Relative 307 redirect: `next start` behind a proxy builds `request.url` from
// its internal bind address (localhost:3000), not the public Host, so an
// absolute `new URL(path, request.url)` would bounce the browser to localhost.
// A relative Location is resolved by the browser against the real address-bar
// URL (the public host), which is what we want.
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

// Landing point after the backend completes OAuth. It redirects here with a
// single-use `code` in the query (NOT the refresh token); we swap it for a
// session server-to-server and store httpOnly cookies.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectTo("/login?error=oauth");
  }

  const res = await backendFetch("/oauth/exchange", {
    method: "POST",
    headers: forwardHeaders(request),
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    return redirectTo("/login?error=oauth");
  }
  const data = await res.json();
  await setAuthCookies(data);
  return redirectTo("/dashboard");
}
