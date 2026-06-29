// Browser-side WebSocket gateway client. One shared socket multiplexes every
// topic subscription; it auto-fetches a ticket, reconnects with backoff, and
// re-subscribes on reconnect. Tokens stay in httpOnly cookies — only the
// short-lived ticket (fetched via the BFF) ever reaches JS.

export type WsHandler = (event: string, data: unknown) => void;

function defaultWsUrl(): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  // Dev default: backend on :8080. Override with NEXT_PUBLIC_WS_URL in prod.
  return `${proto}://${window.location.hostname}:8080/ws`;
}

class WsManager {
  private ws: WebSocket | null = null;
  private connecting = false;
  private backoff = 1000;
  private readonly subs = new Map<string, Set<WsHandler>>();

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private async ensure() {
    if (
      this.connecting ||
      (this.ws &&
        (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING))
    ) {
      return;
    }
    this.connecting = true;
    try {
      const res = await fetch("/api/ws-ticket", { cache: "no-store" });
      if (!res.ok) throw new Error("ticket");
      const { ticket } = await res.json();
      const base = process.env.NEXT_PUBLIC_WS_URL || defaultWsUrl();
      const ws = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`);
      this.ws = ws;

      ws.onopen = () => {
        this.backoff = 1000;
        for (const topic of this.subs.keys()) this.send({ action: "subscribe", topic });
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data) as { topic: string; event: string; data: unknown };
          this.subs.get(m.topic)?.forEach((h) => h(m.event, m.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (this.subs.size === 0) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15000);
    setTimeout(() => void this.ensure(), delay);
  }

  subscribe(topic: string, handler: WsHandler): () => void {
    let set = this.subs.get(topic);
    if (!set) {
      set = new Set();
      this.subs.set(topic, set);
    }
    set.add(handler);
    void this.ensure();
    this.send({ action: "subscribe", topic });

    return () => {
      const s = this.subs.get(topic);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.subs.delete(topic);
        this.send({ action: "unsubscribe", topic });
      }
      if (this.subs.size === 0 && this.ws) {
        this.ws.close();
        this.ws = null;
      }
    };
  }
}

export const wsClient = new WsManager();
