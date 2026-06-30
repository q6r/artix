import Image from "next/image";
import Link from "next/link";

export default function Logo({
  className = "",
  short = false,
}: {
  className?: string;
  /** Render just "Artix" (drops the "Cloud" suffix) — used in the mobile header. */
  short?: boolean;
}) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`}>
      <Image
        src="/logo.svg"
        alt="ArtixCloud"
        width={32}
        height={32}
        className="h-8 w-8"
      />
      <span className="font-logo text-lg tracking-tight mt-1">
        Artix<span className={`text-white/45 ${short ? "hidden" : ""}`}>Cloud</span>
      </span>
    </Link>
  );
}
