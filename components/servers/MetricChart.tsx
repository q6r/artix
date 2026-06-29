"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/components/LanguageProvider";

export type ChartPoint = { t: number; v: number };

// Interactive area chart: auto-scales to the window, shows the current/hovered
// value + peak, and a hover guide with a tooltip (time + value).
export default function MetricChart({
  label,
  points,
  color,
  fmt,
}: {
  label: string;
  points: ChartPoint[];
  color: string;
  fmt: (v: number) => string;
}) {
  const { t, locale } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const H = 120;
  const padT = 8;
  const padB = 4;
  const n = points.length;
  const peak = Math.max(...points.map((p) => p.v), 0);
  const vmax = Math.max(peak * 1.15, 1); // headroom; never divide by zero
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => padT + (1 - v / vmax) * (H - padT - padB);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z` : "";

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHi(Math.round(ratio * (n - 1)));
  };

  const hp = hi != null ? points[hi] : null;
  const current = hp ? hp.v : points.length ? points[points.length - 1].v : 0;
  const gid = `mc-${label.replace(/\W/g, "")}-${color.replace("#", "")}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-white/55">{label}</span>
        <span className="text-xs text-white/40">
          {t("srv.metrics.peak")} {fmt(peak)}
        </span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ color }}>
        {fmt(current)}
      </div>

      <div
        ref={ref}
        className="relative mt-3 w-full select-none"
        style={{ height: H }}
        onMouseMove={onMove}
        onMouseLeave={() => setHi(null)}
      >
        <svg width={w} height={H} className="block overflow-visible">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* gridlines */}
          {[0, 0.5, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={w}
              y1={padT + g * (H - padT - padB)}
              y2={padT + g * (H - padT - padB)}
              stroke="#ffffff"
              strokeOpacity={0.06}
              strokeWidth={1}
            />
          ))}
          {area && <path d={area} fill={`url(#${gid})`} />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {hp && (
            <>
              <line x1={x(hi!)} x2={x(hi!)} y1={padT} y2={H} stroke="#ffffff" strokeOpacity={0.2} strokeWidth={1} />
              <circle cx={x(hi!)} cy={y(hp.v)} r={3.5} fill={color} stroke="#000" strokeWidth={1} />
            </>
          )}
        </svg>

        {/* y-axis labels */}
        <span className="pointer-events-none absolute left-0 top-0 text-[10px] text-white/30">
          {fmt(vmax)}
        </span>
        <span className="pointer-events-none absolute bottom-0 left-0 text-[10px] text-white/30">0</span>

        {/* hover tooltip */}
        {hp && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-[#0e0e0e] px-2.5 py-1.5 text-xs shadow-xl"
            style={{ left: Math.min(Math.max(x(hi!), 44), w - 44) }}
          >
            <span className="font-semibold tabular-nums" style={{ color }}>
              {fmt(hp.v)}
            </span>
            <span className="ml-2 text-white/45">
              {new Date(hp.t * 1000).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
