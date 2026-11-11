// Public avatar passthrough. The backend fetches the provider image (never
// persisting it) and we stream the bytes with cache headers so the browser
// caches it — the provider's expiring CDN URL never reaches the client.

import { apiBaseUrl } from "@/lib/env";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/avatar/[id]">,
) {
  const { id } = await ctx.params;
  const res = await fetch(`${apiBaseUrl()}/avatar/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) return new Response(null, { status: 404 });

  const body = await res.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=21600",
    },
  });
}
