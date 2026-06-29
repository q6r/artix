import type { SVGProps } from "react";

export default function TicketsIcon({
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
      <path d="M12 14.63a.6.6 0 0 0-.19 0 2.573 2.573 0 1 1 2.68-2.58c-.01 1.4-1.11 2.54-2.49 2.58" />
      <path d="M16.97 14.44c1.37.23 2.88-.01 3.94-.72 1.41-.94 1.41-2.48 0-3.42-1.07-.71-2.6-.95-3.97-.71" />
      <path d="M18 7.16a.6.6 0 0 0-.19 0 2.573 2.573 0 1 1 .19 0" />
      <path d="M5.97 7.16a.6.6 0 0 1 .19 0 2.573 2.573 0 1 0-.19 0" />
      <path d="M7 14.44c-1.37.23-2.88-.01-3.94-.72-1.41-.94-1.41-2.48 0-3.42 1.07-.71 2.6-.95 3.97-.71" />
      <path d="M9.09 17.78c-1.41.94-1.41 2.48 0 3.42 1.6 1.07 4.22 1.07 5.82 0 1.41-.94 1.41-2.48 0-3.42-1.59-1.06-4.22-1.06-5.82 0" />
    </svg>
  );
}
