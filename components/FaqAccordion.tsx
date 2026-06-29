"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Faq = { q: string; a: string };

export default function FaqAccordion({ items }: { items: Faq[] }) {
  // Only one open at a time; first open by default.
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="border-t border-white/10">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} className="border-b border-white/10">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 py-6 text-left text-lg font-medium tracking-tight text-white xl:py-7 xl:text-xl"
            >
              <span className="min-w-0 flex-1">{f.q}</span>
              <span
                className={`relative grid size-7 shrink-0 place-items-center rounded-full border transition-colors ${
                  isOpen ? "border-white/40" : "border-white/20"
                }`}
              >
                <span className="absolute h-px w-3 bg-white/70" />
                <span
                  className={`absolute h-3 w-px bg-white/70 transition-all duration-300 ${
                    isOpen ? "rotate-90 opacity-0" : ""
                  }`}
                />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="max-w-[60ch] pb-7 text-sm leading-relaxed text-white/55 xl:text-base">
                    {f.a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
