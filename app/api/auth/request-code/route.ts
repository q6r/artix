import { backendFetch, forwardHeaders, csrfBlock } from "@/lib/api/server";

// Passwordless step 1: send a 6-digit login code by email (creates the account
// on first use). No cookies set here — only on successful code verification.
export async function POST(request: Request) {
  const blocked = csrfBlock(request);
  if (blocked) return blocked;
  const body = await request.text();
  const res = await backendFetch("/auth/request-code", {
    method: "POST",
    headers: forwardHeaders(request),
    body,
  });
  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
