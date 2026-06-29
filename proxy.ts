import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic auth gate (Next 16 renamed Middleware → Proxy). This only checks
// for the presence of a session cookie to avoid a flash of the dashboard; the
// real authorization happens in the backend on every API call.
export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("artix_at") || request.cookies.has("artix_rt");
  if (!hasSession) {
    // Build the redirect from the public Host/proto headers, not `request.url`
    // (behind a proxy that resolves to the internal localhost:3000 bind).
    const host = request.headers.get("host") ?? request.nextUrl.host;
    const proto =
      request.headers.get("x-forwarded-proto") ??
      request.nextUrl.protocol.replace(":", "");
    const url = new URL(`${proto}://${host}/login`);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/dashboard/:path*",
};
