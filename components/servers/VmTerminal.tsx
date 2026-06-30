"use client";

import { useEffect, useRef, useState } from "react";
import { Info, RotateCw } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import "@xterm/xterm/css/xterm.css";

type Status = "connecting" | "connected" | "disconnected";

/**
 * Real serial terminal (xterm.js) over the backend WS proxy at /ws/term/:id.
 * The proxy holds the Proxmox ticket and performs the in-band auth, so the
 * browser just speaks the Proxmox term framing: `1:cols:rows:`, `0:len:data`,
 * and `2` (ping). Typing and text selection/copy work like any terminal.
 */
export default function VmTerminal({ id }: { id: string }) {
  const { t } = useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fit: any = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let ro: ResizeObserver | null = null;
    setStatus("connecting");

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !wrapRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        theme: { background: "#000000", foreground: "#e5e5e5" },
        scrollback: 5000,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(wrapRef.current);
      try {
        fit.fit();
      } catch {
        /* ignore */
      }

      const res = await fetch("/api/ws-ticket", { cache: "no-store" });
      if (disposed) return;
      if (!res.ok) {
        setStatus("disconnected");
        return;
      }
      const { ticket } = await res.json();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(
        `${proto}://${window.location.host}/ws/term/${id}?ticket=${encodeURIComponent(ticket)}`,
      );
      ws.binaryType = "arraybuffer";
      const enc = new TextEncoder();
      const send = (s: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(enc.encode(s));
      };

      ws.onopen = () => {
        if (disposed) return;
        setStatus("connected");
        send(`1:${term.cols}:${term.rows}:`);
        term.focus();
        ping = setInterval(() => send("2"), 30000);
      };
      ws.onmessage = (ev: MessageEvent) => {
        const d = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
        term.write(d);
      };
      ws.onclose = () => !disposed && setStatus("disconnected");
      ws.onerror = () => !disposed && setStatus("disconnected");

      term.onData((d: string) => send(`0:${d.length}:${d}`));
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => send(`1:${cols}:${rows}:`));

      ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      ro.observe(wrapRef.current);
    })();

    return () => {
      disposed = true;
      if (ping) clearInterval(ping);
      ro?.disconnect();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      try {
        term?.dispose();
      } catch {
        /* ignore */
      }
    };
  }, [id, attempt]);

  return (
    <FadeIn className="space-y-3">
      <p className="flex items-center gap-2 text-xs text-white/45">
        <Info className="h-3.5 w-3.5 text-sky-400" /> {t("srv.term.hint")}
      </p>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black p-2">
        <div ref={wrapRef} className="h-[460px] w-full" />
        {status !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-sm text-white/70">
            {status === "connecting" ? (
              <>
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                {t("srv.term.connecting")}
              </>
            ) : (
              <>
                <p>{t("srv.term.disconnected")}</p>
                <button
                  onClick={() => setAttempt((n) => n + 1)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
                >
                  <RotateCw className="h-4 w-4" /> {t("srv.term.reconnect")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
