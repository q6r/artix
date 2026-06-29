"use client";

import { forwardRef, useRef } from "react";
import Image from "next/image";
import { AnimatedBeam } from "@/components/ui/animated-beam";

const Node = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; className?: string }
>(({ children, className = "" }, ref) => (
  <div
    ref={ref}
    className={`z-10 flex size-12 items-center justify-center rounded-xl border border-white/10 bg-[#0c0c0c] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)] ${className}`}
  >
    {children}
  </div>
));
Node.displayName = "Node";

function Logo({ slug }: { slug: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.simpleicons.org/${slug}/white`}
      alt={slug}
      className="h-6 w-6 opacity-80"
    />
  );
}

export default function ConnectivityBeams() {
  const container = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const l1 = useRef<HTMLDivElement>(null);
  const l2 = useRef<HTMLDivElement>(null);
  const l3 = useRef<HTMLDivElement>(null);
  const r1 = useRef<HTMLDivElement>(null);
  const r2 = useRef<HTMLDivElement>(null);
  const r3 = useRef<HTMLDivElement>(null);

  const beam = {
    containerRef: container,
    toRef: center,
    pathColor: "rgba(255,255,255,0.22)",
    pathWidth: 2,
    gradientStartColor: "#38bdf8",
    gradientStopColor: "#a78bfa",
    duration: 4,
  };

  return (
    <div
      ref={container}
      className="relative mx-auto flex h-[320px] w-full max-w-xl items-center justify-center"
    >
      <div className="flex size-full items-center justify-between">
        <div className="flex flex-col justify-center gap-7">
          <Node ref={l1}>
            <Logo slug="postgresql" />
          </Node>
          <Node ref={l2}>
            <Logo slug="redis" />
          </Node>
          <Node ref={l3}>
            <Logo slug="cloudflare" />
          </Node>
        </div>

        <Node ref={center} className="size-16 border-white/20 bg-white">
          <Image
            src="/logo.svg"
            alt="ArtixCloud"
            width={32}
            height={32}
            className="h-8 w-8 invert"
          />
        </Node>

        <div className="flex flex-col justify-center gap-7">
          <Node ref={r1}>
            <Logo slug="docker" />
          </Node>
          <Node ref={r2}>
            <Logo slug="nginx" />
          </Node>
          <Node ref={r3}>
            <Logo slug="nodedotjs" />
          </Node>
        </div>
      </div>

      <AnimatedBeam {...beam} fromRef={l1} curvature={-60} />
      <AnimatedBeam {...beam} fromRef={l2} />
      <AnimatedBeam {...beam} fromRef={l3} curvature={60} />
      <AnimatedBeam {...beam} fromRef={r1} curvature={-60} reverse />
      <AnimatedBeam {...beam} fromRef={r2} reverse />
      <AnimatedBeam {...beam} fromRef={r3} curvature={60} reverse />
    </div>
  );
}
