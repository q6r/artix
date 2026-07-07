"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";

export type Option = { value: string; label: string };

export default function Select({
  value,
  onChange,
  options,
  className = "",
  placeholder = "Selecionar",
  searchable,
  searchPlaceholder = "Buscar…",
  emptyLabel = "Nada encontrado",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  /** Show a filter box inside the dropdown. Defaults to on when there are many options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const current = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > 7;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = () => {
    if (triggerRef.current)
      setRect(triggerRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  // Reset the filter each time the menu opens, and focus the search box.
  useEffect(() => {
    if (open) {
      setQuery("");
      const id = window.setTimeout(() => searchRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        !triggerRef.current?.contains(t) &&
        !menuRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      // Don't close when scrolling INSIDE the dropdown itself (only on page scroll).
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={toggle}
        className={`flex items-center justify-between gap-2 rounded-xl border bg-white/[0.03] text-left outline-none transition-colors ${
          open ? "border-white/30" : "border-white/10 hover:border-white/20"
        } ${className}`}
      >
        <span className={current ? "truncate" : "truncate text-white/40"}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && rect && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "fixed",
                  top: rect.bottom + 6,
                  left: rect.left,
                  width: rect.width,
                  zIndex: 200,
                }}
                className="flex max-h-72 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0e0e0e] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
              >
                {showSearch && (
                  <div className="relative border-b border-white/10 p-1.5">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && filtered.length > 0) {
                          e.preventDefault();
                          pick(filtered[0].value);
                        }
                      }}
                      placeholder={searchPlaceholder}
                      className="h-9 w-full rounded-lg bg-white/[0.04] pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/35 focus:bg-white/[0.06]"
                    />
                  </div>
                )}
                <div className="overflow-auto p-1">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-3 text-center text-sm text-white/40">{emptyLabel}</p>
                  ) : (
                    filtered.map((o) => {
                      const selected = o.value === value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => pick(o.value)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? "bg-white/10 text-white"
                              : "text-white/70 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <span className="truncate">{o.label}</span>
                          {selected && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
