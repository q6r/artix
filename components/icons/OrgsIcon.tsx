import { Building2 } from "lucide-react";
import type { SVGProps } from "react";

// Wraps the lucide Building2 icon so it can drop into the sidebar nav alongside
// the animate-ui icons (it accepts and ignores their animateOnHover/animate props).
export default function OrgsIcon({
  size = 24,
  animateOnHover: _animateOnHover,
  animate: _animate,
  ...props
}: {
  size?: number;
  animateOnHover?: boolean;
  animate?: string;
} & SVGProps<SVGSVGElement>) {
  return <Building2 size={size} {...props} />;
}
