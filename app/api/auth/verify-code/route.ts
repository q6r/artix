import { backendFetch, forwardHeaders, setAuthCookies } from "@/lib/api/server";

// Passwordless step 2: verify the emailed code, start a session, and store the
// tokens as httpOnly cookies. Only the public user object reaches the browser.
export async function POST(request: Request) {
  const body = await request.text();
  const res = await backendFetch("/auth/verify-code", {
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
