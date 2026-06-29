import { proxyToBackend } from "@/lib/api/server";

// Current user (authenticated proxy with transparent refresh). 401 when logged out.
export async function GET(request: Request) {
  return proxyToBackend(request, "/auth/me");
}
