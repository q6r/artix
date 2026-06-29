"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MoreVertical } from "lucide-react";
import { useLang } from "@/components/LanguageProvider";

export type RowMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
};

export default function RowMenu({ items }: { items: RowMenuItem[] }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t))
        setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={t("dash.rowMenu.actions")}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && rect && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "fixed",
                  top: rect.bottom + 6,
                  left: Math.max(8, rect.right - 184),
                  width: 184,
                  zIndex: 200,
                }}
                className="rounded-xl border border-white/10 bg-[#0e0e0e] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
              >
                {items.map((it) => (
                  <button
                    key={it.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      it.onClick();
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      it.danger
                        ? "text-red-400 hover:bg-red-500/10"
                        : "text-white/75 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {it.icon}
                    {it.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
