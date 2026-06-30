"use client";

import { useState } from "react";
import { Monitor, SquareTerminal } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";
import VmVnc from "@/components/servers/VmVnc";
import VmTerminal from "@/components/servers/VmTerminal";

type Mode = "vnc" | "shell";

/**
 * The Console tab: a real serial terminal (xterm.js) by default — type and
 * copy like any terminal — with a toggle to the graphical noVNC screen.
 */
export default function VmConsolePanel({ id }: { id: string }) {
  const { t } = useLang();
  const [mode, setMode] = useState<Mode>("shell");

  const seg = (active: boolean) =>
    `inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
      active ? "bg-white text-black" : "text-white/60 hover:text-white"
    }`;

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <button type="button" onClick={() => setMode("shell")} className={seg(mode === "shell")}>
          <SquareTerminal className="h-4 w-4" /> {t("srv.console.modeShell")}
        </button>
        <button type="button" onClick={() => setMode("vnc")} className={seg(mode === "vnc")}>
          <Monitor className="h-4 w-4" /> {t("srv.console.modeVnc")}
        </button>
      </div>

      {mode === "shell" ? <VmTerminal id={id} /> : <VmVnc id={id} />}
    </div>
  );
}
