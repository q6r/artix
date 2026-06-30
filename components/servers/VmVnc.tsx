"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Maximize2, RotateCw, Keyboard } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { api } from "@/lib/api/client";

type ConsoleTicket = { ticket: string; port: string; user: string; ws_url: string };
type Status = "connecting" | "connected" | "disconnected";

const btn =
  "inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40";

/**
 * Live VPS screen over noVNC. The browser RFB connects to the Proxmox
 * `vncwebsocket` through the nginx `/pvevnc/` reverse-proxy (which terminates
 * the self-signed TLS and injects the API token). The per-session `vncticket`
 * from `GET /servers/:id/console` is the capability and the RFB password.
 */
export default function VmVnc({ id }: { id: string }) {
  const { t } = useLang();
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<{ disconnect: () => void; sendCtrlAltDel: () => void } | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [attempt, setAttempt] = useState(0); // bump to reconnect

  useEffect(() => {
    let disposed = false;
    let rfb: { disconnect: () => void; addEventListener: (e: string, cb: () => void) => void } | null = null;
    setStatus("connecting");

    (async () => {
      try {
        const tk = await api<ConsoleTicket>(`servers/${id}/console`);
        if (disposed || !screenRef.current) return;
        const path = tk.ws_url.replace(/^wss?:\/\/[^/]+/, "");
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${window.location.host}/pvevnc${path}`;

        const { default: RFB } = await import("@novnc/novnc");
        if (disposed || !screenRef.current) return;

        const inst = new RFB(screenRef.current, url, { credentials: { password: tk.ticket } });
        inst.scaleViewport = true;
        inst.clipViewport = false;
        inst.background = "#0a0a0a";
        inst.addEventListener("connect", () => !disposed && setStatus("connected"));
        inst.addEventListener("disconnect", () => !disposed && setStatus("disconnected"));
        inst.addEventListener("securityfailure", () => !disposed && setStatus("disconnected"));
        rfb = inst as unknown as typeof rfb;
        rfbRef.current = inst as unknown as typeof rfbRef.current;
      } catch {
        if (!disposed) setStatus("disconnected");
      }
    })();

    return () => {
      disposed = true;
      try {
        rfb?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
    };
  }, [id, attempt]);

  const fullscreen = () => {
    const el = screenRef.current?.parentElement;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
  };
  const cad = () => {
    try {
      rfbRef.current?.sendCtrlAltDel();
    } catch {
      /* ignore */
    }
  };

  return (
    <FadeIn className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-white/45">
          <Info className="h-3.5 w-3.5 text-sky-400" /> {t("srv.vnc.hint")}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={cad} disabled={status !== "connected"} className={btn}>
            <Keyboard className="h-4 w-4" /> {t("srv.vnc.cad")}
          </button>
          <button onClick={fullscreen} disabled={status !== "connected"} className={btn}>
            <Maximize2 className="h-4 w-4" /> {t("srv.vnc.fullscreen")}
          </button>
        </div>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]">
        <div ref={screenRef} className="h-full w-full" />
        {status !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-sm text-white/70 backdrop-blur-sm">
            {status === "connecting" ? (
              <>
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                {t("srv.vnc.connecting")}
              </>
            ) : (
              <>
                <p>{t("srv.vnc.disconnected")}</p>
                <button onClick={() => setAttempt((n) => n + 1)} className={btn}>
                  <RotateCw className="h-4 w-4" /> {t("srv.vnc.reconnect")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
