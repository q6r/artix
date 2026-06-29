"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";

type Phase = "center" | "move" | "done";

export default function DashboardIntro() {
  const [phase, setPhase] = useState<Phase>("center");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("move"), 700);
    const t2 = setTimeout(() => setPhase("done"), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "done") return null;

  const moving = phase !== "center";

  return (
    <div className="pointer-events-none fixed inset-0 z-[120]">
      {/* Overlay */}
      <motion.div
        className="absolute inset-0 bg-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: moving ? 0 : 1 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />

      {/* Logo: centered -> sidebar top-left */}
      <motion.div
        className="absolute"
        initial={{ top: "50%", left: "50%", x: "-50%", y: "-50%", scale: 2.6 }}
        animate={
          moving
            ? { top: 24, left: 24, x: "0%", y: "0%", scale: 1 }
            : { top: "50%", left: "50%", x: "-50%", y: "-50%", scale: 2.6 }
        }
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <Image
          src="/logo.svg"
          alt="ArtixCloud"
          width={32}
          height={32}
          priority
          className="h-8 w-8"
        />
      </motion.div>
    </div>
  );
}
