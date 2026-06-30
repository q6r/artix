"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

/**
 * Responsive overlay: a centered dialog on `sm+` and a bottom sheet on mobile.
 * On mobile it has a drag handle and can be flicked/dragged down to close (no X);
 * the X stays on desktop.
 */
export default function Sheet({
  open,
  onClose,
  children,
  title,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
            className={`relative max-h-[92vh] w-full touch-none overflow-y-auto rounded-t-2xl border border-white/10 bg-neutral-950 p-5 shadow-2xl sm:max-w-md sm:rounded-2xl ${className}`}
          >
            {/* Mobile drag handle (drag down to close) */}
            <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 cursor-grab rounded-full bg-white/20 sm:hidden" />

            {title && (
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="hidden h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:text-white sm:inline-flex"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
