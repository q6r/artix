import { cookies } from "next/headers";
import { backendFetch, clearAuthCookies, csrfBlock, RT_COOKIE } from "@/lib/api/server";

// Revokes the session on the backend (best-effort) and clears the cookies.
export async function POST(request: Request) {
  const blocked = csrfBlock(request);
  if (blocked) return blocked;
  const rt = (await cookies()).get(RT_COOKIE)?.value;
  if (rt) {
    await backendFetch("/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    }).catch(() => {});
  }
  await clearAuthCookies();
  return Response.json({ ok: true });
}
