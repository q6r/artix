"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const words = ["site", "servidor", "bot", "jogo", "app", "backend"];

export default function RotatingWord() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % words.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    // inline-block whose in-flow (invisible) word sets the baseline + width,
    // so the animated word overlays it perfectly aligned with the rest of the line.
    <span className="relative inline-block whitespace-nowrap align-baseline">
      <span aria-hidden className="invisible">servidor</span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: "0.35em", filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: "-0.35em", filter: "blur(8px)" }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute left-0 top-0 bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
