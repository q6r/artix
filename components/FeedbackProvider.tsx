"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useLang } from "@/components/LanguageProvider";
import Sheet from "@/components/ui/Sheet";

type ToastKind = "error" | "success" | "info";
type Toast = { id: number; message: string; kind: ToastKind };

type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Feedback = {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
};

const Ctx = createContext<Feedback | null>(null);

/** Toasts replace `alert()`; never block the thread. */
export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within <FeedbackProvider>");
  return c.toast;
}

/** Promise-based confirm replaces `window.confirm()` with a sheet/dialog. */
export function useConfirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm must be used within <FeedbackProvider>");
  return c.confirm;
}

let seq = 0;

export default function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);

  const toast = useCallback((message: string, kind: ToastKind = "error") => {
    const id = ++seq;
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4200);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })),
    [],
  );

  const settle = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      {typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[130] flex flex-col items-center gap-2 px-4">
            <AnimatePresence>
              {toasts.map((tt) => (
                <motion.div
                  key={tt.id}
                  initial={{ opacity: 0, y: 20, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                  className={`pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
                    tt.kind === "error"
                      ? "border-red-500/30 bg-red-500/15 text-red-100"
                      : tt.kind === "success"
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
                        : "border-white/15 bg-white/10 text-white"
                  }`}
                >
                  {tt.message}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}

      <Sheet open={!!dialog} onClose={() => settle(false)} title={dialog?.title}>
        {dialog?.message && <p className="text-sm leading-relaxed text-white/60">{dialog.message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm text-white/70 transition-colors hover:bg-white/5"
          >
            {dialog?.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={`inline-flex h-10 items-center rounded-xl px-5 text-sm font-medium transition-colors ${
              dialog?.danger
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-white text-black hover:bg-white/85"
            }`}
          >
            {dialog?.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}
