"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "artix_splash_seen";

// Must match the .splash-seq / .splash-overlay animation duration in globals.css.
const TOTAL_MS = 3400;

type State = "checking" | "playing" | "done";

export default function SplashScreen() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    // Once per person.
    if (localStorage.getItem(STORAGE_KEY)) {
      setState("done");
      return;
    }

    document.body.style.overflow = "hidden";
    setState("playing");

    // Fallback in case onAnimationEnd doesn't fire.
    const fallback = setTimeout(finish, TOTAL_MS + 300);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    document.body.style.overflow = "";
    setState("done");
  };

  if (state === "done") return null;

  const playing = state === "playing";

  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-black ${
        playing ? "splash-overlay pointer-events-none" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/screen_loading.gif"
        alt=""
        draggable={false}
        onAnimationEnd={finish}
        className={`w-[min(78vw,520px)] select-none will-change-transform ${
          playing ? "splash-seq" : ""
        }`}
      />
    </div>
  );
}
