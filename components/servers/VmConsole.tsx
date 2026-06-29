"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { useLang } from "@/components/LanguageProvider";
import { api, ApiError } from "@/lib/api/client";

type Line = { type: "cmd" | "out" | "err"; text: string };

export default function VmConsole({ id }: { id: string }) {
  const { t } = useLang();
  const [lines, setLines] = useState<Line[]>([]);
  const [cwd, setCwd] = useState("/root");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const run = async () => {
    const cmd = input.trim();
    if (busy || !cmd) return;
    setLines((l) => [...l, { type: "cmd", text: `${cwd} $ ${cmd}` }]);
    setInput("");
    setHistory((h) => [...h, cmd]);
    setHIdx(-1);
    if (cmd === "clear") {
      setLines([]);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ code: number; out: string; err: string; cwd: string }>(
        `servers/${id}/exec`,
        { method: "POST", json: { cmd, cwd } },
      );
      if (r.out) setLines((l) => [...l, { type: "out", text: r.out.replace(/\n+$/, "") }]);
      if (r.err) setLines((l) => [...l, { type: "err", text: r.err.replace(/\n+$/, "") }]);
      if (r.cwd) setCwd(r.cwd);
    } catch (e) {
      setLines((l) => [
        ...l,
        { type: "err", text: e instanceof ApiError ? e.message : t("srv.console.agentHint") },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const ni = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1);
      setHIdx(ni);
      setInput(history[ni]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx < 0) return;
      const ni = hIdx + 1;
      if (ni >= history.length) {
        setHIdx(-1);
        setInput("");
      } else {
        setHIdx(ni);
        setInput(history[ni]);
      }
    }
  };

  return (
    <FadeIn>
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="mt-0.5">{t("srv.console.delayNotice")}</span>
      </div>
      <div
        onClick={() => !busy && inputRef.current?.focus()}
        className="h-[420px] cursor-text overflow-y-auto rounded-2xl border border-white/10 bg-black p-4 font-mono text-[13px] leading-relaxed"
      >
        {lines.length === 0 && (
          <p className="text-white/35">{t("srv.console.welcome")}</p>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-words ${
              l.type === "cmd"
                ? "text-sky-300"
                : l.type === "err"
                  ? "text-red-300"
                  : "text-white/80"
            }`}
          >
            {l.text}
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-white/45">
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            {t("srv.console.running")}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-emerald-400">{cwd} $</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoFocus
              className="flex-1 bg-transparent text-white outline-none"
            />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </FadeIn>
  );
}
