"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/** How long the intro plays. Reduced-motion visitors get a brief, still version. */
const SPLASH_MS = 4000;
const SPLASH_REDUCED_MS = 1200;
const FADE_MS = 600;
const SEEN_KEY = "emerg-splash-seen";

/**
 * Inline script placed before the first paint: if this browser tab already showed the intro, hide it immediately so
 * navigating or reloading inside the same session never replays it. Storage can be blocked, so every access is guarded.
 */
export const SPLASH_GUARD = `try{if(sessionStorage.getItem("${SEEN_KEY}"))document.documentElement.setAttribute("data-splash","seen")}catch(e){}`;

/** Full-screen intro shown once per browser session. It plays for a fixed time and then reveals the app by itself. */
export function Splash() {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage blocked: just play the intro */
    }
    // Already shown in this session: the pre-paint guard has hidden it with CSS, so there is nothing to run.
    if (seen) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? SPLASH_REDUCED_MS : SPLASH_MS;
    const leave = window.setTimeout(() => setPhase("leave"), total);
    const gone = window.setTimeout(() => finish(), total + FADE_MS);
    function finish() {
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      setPhase("gone");
    }
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div
      className={`splash${phase === "leave" ? " splash-leave" : ""}`}
      role="presentation"
      style={{ ["--splash-ms" as string]: `${SPLASH_MS}ms` }}
    >
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-center">
        <div className="splash-mark">
          <span className="splash-ring" aria-hidden="true" />
          <span className="splash-ring splash-ring-2" aria-hidden="true" />
          <Image src="/icons/icon-512.png" alt="" width={112} height={112} priority className="splash-logo" />
        </div>
        <h1 className="splash-word">Emerg Music</h1>
        <p className="splash-tag">Music from Liberia, first.</p>
        <div className="splash-eq" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
      </div>
      <div className="splash-progress" aria-hidden="true"><span /></div>
    </div>
  );
}
