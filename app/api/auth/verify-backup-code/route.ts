import { backendFetch, forwardHeaders, setAuthCookies, csrfBlock } from "@/lib/api/server";

// Sign in with a single-use backup code. On success, store the session cookies.
export async function POST(request: Request) {
  const blocked = csrfBlock(request);
  if (blocked) return blocked;
  const body = await request.text();
  const res = await backendFetch("/auth/verify-backup-code", {
    method: "POST",
    headers: forwardHeaders(request),
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json(data, { status: res.status });
  }
  await setAuthCookies(data);
  return Response.json({ user: data.user });
}
