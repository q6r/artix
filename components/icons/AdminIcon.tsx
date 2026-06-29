import type { SVGProps } from "react";

export default function AdminIcon({
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
      <path d="M14.78 14.33c-.38.16-.69.62-.69 1.04" />
      <path d="M19.52 13.19a2.66 2.66 0 0 0-1.96 0" />
      <path d="m20.52 13.6.43-2.59c.16-.93-.32-2.18-1.05-2.77l-6.58-5.25c-1.01-.82-2.65-.82-3.66-.01L3.08 8.24c-.74.59-1.21 1.84-1.05 2.77l1.26 7.55C3.52 19.91 4.81 21 6.18 21h9.16c-.79-.98-1.25-2.19-1.25-3.44v-2.19c0-.42.31-.88.69-1.04l2.78-1.14a2.66 2.66 0 0 1 1.96 0zl1.79.73c.38.16.69.62.69 1.04v2.19c0 2.44-1.78 4.74-4.2 5.41a1 1 0 0 1-.51 0A5.7 5.7 0 0 1 15.34 21c-.79-.98-1.25-2.19-1.25-3.44" />
    </svg>
  );
}
