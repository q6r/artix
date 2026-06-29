// Lightweight shimmer placeholder used while data loads.

export default function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/[0.06] ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}
