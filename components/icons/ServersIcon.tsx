import type { SVGProps } from "react";

// Custom servers/cloud icon. Accepts (and ignores) the animate-ui icon props so
// it drops into the sidebar nav alongside the animated icons.
export default function ServersIcon({
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
      <path d="M15.85 9.92a3.9 3.9 0 0 1 1.67-.41" />
      <path d="M7.27 13.01a3.8 3.8 0 0 0-1.72-.41c-4.68.33-4.68 7.14 0 7.47h11.09a5.32 5.32 0 0 0 3.64-1.4c3.29-2.87 1.53-8.64-2.8-9.19C15.92.11 2.39 3.67 5.6 12.6" />
    </svg>
  );
}
