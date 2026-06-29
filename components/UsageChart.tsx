// Lightweight SVG area chart for usage metrics (no dependencies).

export default function UsageChart({
  data,
  color = "#ffffff",
  id,
  height = 56,
}: {
  data: number[];
  color?: string;
  id: string;
  height?: number;
}) {
  const w = 100;
  const h = 40;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - (v / 100) * h] as const);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      width="100%"
      style={{ height }}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
