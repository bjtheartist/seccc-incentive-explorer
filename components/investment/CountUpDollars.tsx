"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatFullDollars } from "./format";

const DURATION_MS = 900;

/** Ease-out cubic on a normalized 0..1 clock — fast start, gentle settle. Pure. */
export function easeOutCubic(t: number): number {
  const c = 1 - Math.min(1, Math.max(0, t));
  return 1 - c * c * c;
}

/** The eased, rounded dollar value at normalized time t (pure — unit-tested). */
export function countUpValue(target: number, t: number): number {
  return Math.round(target * easeOutCubic(t));
}

// useLayoutEffect on the client (runs pre-paint, so the count-up never flashes
// the final value first); a no-op useEffect on the server so React doesn't warn
// during SSR of this client component.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The analysis hero figure, count-up animated. Renders the FINAL formatted dollar
 * string on the server and on first hydration (no layout shift, no hydration
 * mismatch), then eases 0 → target over ~900ms once mounted. Honors
 * prefers-reduced-motion by leaving the final value in place immediately.
 */
export function CountUpDollars({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef(0);

  useIsoLayoutEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / DURATION_MS;
      setDisplay(countUpValue(value, t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setDisplay(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span className={className}>{formatFullDollars(display)}</span>;
}
