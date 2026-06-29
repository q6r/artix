// Client-side API helper. Talks only to same-origin Next route handlers under
// `/api/*`; the BFF layer attaches the access token and refreshes it. No token
// ever touches client JS.

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type Json = Record<string, unknown>;

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: Json },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");

  const res = await fetch(`/api/${path.replace(/^\//, "")}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Request failed");
  }
  return data as T;
}
