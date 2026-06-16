"use client";

/**
 * Animate a number from 0 → target with an ease-out curve on mount. Used for
 * the hero traction figures so money "tallies up" like a counter. Respects
 * prefers-reduced-motion (snaps to the target). The initial value is resolved
 * lazily so the effect never has to setState synchronously.
 */

import { useEffect, useState } from "react";

function prefersReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCountUp(target: number, durationMs = 1100): number {
  const [value, setValue] = useState(() =>
    typeof window === "undefined" || prefersReduced() ? target : 0,
  );

  useEffect(() => {
    if (typeof window === "undefined" || prefersReduced() || !target) return;
    let raf = 0;
    let startTs = 0;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / durationMs);
      setValue(target * easeOut(p)); // inside rAF callback, not the effect body
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
