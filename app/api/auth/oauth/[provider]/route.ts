import { redirect } from "next/navigation";

// Kicks off the OAuth flow by redirecting the browser to the backend's start
// endpoint (Discord / GitHub). The backend signs its own CSRF state.
//
// Same-origin relative redirect: the browser stays on the public host and the
// edge proxy routes `/oauth/<provider>/*` to the backend. Never expose the
// internal backend base URL (`API_INTERNAL_URL`) to the browser.
export async function GET(_request: Request, ctx: RouteContext<"/api/auth/oauth/[provider]">) {
  const { provider } = await ctx.params;
  if (provider !== "discord" && provider !== "github") {
    return new Response("unknown provider", { status: 404 });
  }
  redirect(`/oauth/${provider}/start`);
}
