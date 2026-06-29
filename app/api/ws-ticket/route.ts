import { proxyToBackend } from "@/lib/api/server";

// Mints a short-lived WebSocket ticket (authenticated). The browser can't attach
// the httpOnly access token to a WS handshake, so it fetches this first.
export async function GET(request: Request) {
  return proxyToBackend(request, "/ws/ticket");
}
