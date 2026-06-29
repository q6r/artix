import type { SVGProps } from "react";

// Custom wallet icon. Accepts (and ignores) the animate-ui icon props so it can
// drop into the sidebar nav alongside the animated icons.
export default function WalletIcon({
  size = 24,
  animateOnHover: _animateOnHover,
  animate: _animate,
  ...props
}: {
  size?: number;
  animateOnHover?: boolean;
  animate?: string;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 4a2 2 0 0 1 2-2H6C3 2 2 3.79 2 6v15a1 1 0 0 0 1.6.8l1.71-1.28a1 1 0 0 1 1.32.1l1.66 1.67a1 1 0 0 0 1.42 0l1.68-1.68a1 1 0 0 1 1.3-.09l1.71 1.28A1 1 0 0 0 16 21Za2 2 0 0 1 2.02-2A4 4 0 0 1 22 6v2.42C22 10 21 11 19.42 11H16" />
      <path d="M5.996 13h.01" />
      <path d="M5.996 9h.01" />
      <path d="M9 13.01h3" />
      <path d="M9 9.01h3" />
    </svg>
  );
}
