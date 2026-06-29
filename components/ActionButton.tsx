"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RippleButton } from "@/components/animate-ui/components/buttons/ripple";
import { LiquidButton } from "@/components/animate-ui/components/buttons/liquid";
import {
  FlipButton,
  FlipButtonFront,
  FlipButtonBack,
} from "@/components/animate-ui/components/buttons/flip";

const variants = {
  primary: "bg-white text-black hover:bg-white/85",
  secondary: "border border-white/15 bg-white/5 text-white hover:bg-white/10",
};

const base = "h-12 gap-2 rounded-full px-6 text-base font-medium";

type ActionButtonProps = {
  children: ReactNode;
  href?: string;
  variant?: keyof typeof variants;
  effect?: "ripple" | "liquid" | "flip";
  backLabel?: ReactNode;
  className?: string;
};

export default function ActionButton({
  children,
  href,
  variant = "primary",
  effect = "ripple",
  backLabel,
  className = "",
}: ActionButtonProps) {
  const router = useRouter();
  const go = () => {
    if (!href) return;
    if (href.startsWith("#")) {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    } else {
      router.push(href);
    }
  };

  if (effect === "liquid") {
    return (
      <LiquidButton
        onClick={go}
        className={`${base} rounded-full border border-white/25 text-white ${className}`}
      >
        {children}
      </LiquidButton>
    );
  }

  if (effect === "flip") {
    return (
      <FlipButton onClick={go} className={className}>
        <FlipButtonFront className={`${base} ${variants[variant]}`}>
          {children}
        </FlipButtonFront>
        <FlipButtonBack className={`${base} ${variants[variant]}`}>
          {backLabel ?? children}
        </FlipButtonBack>
      </FlipButton>
    );
  }

  return (
    <RippleButton
      onClick={go}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </RippleButton>
  );
}
