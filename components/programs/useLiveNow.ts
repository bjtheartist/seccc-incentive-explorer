"use client";

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * A browser clock aligned to minute boundaries, with focus/visibility refreshes.
 * A server-provided initial timestamp keeps dynamic HTML and hydration identical;
 * callers without one remain conservative until the browser clock is available.
 */
export function useLiveNow(initialNowIso?: string): Date | null {
  const [now, setNow] = useState<Date | null>(() => {
    if (!initialNowIso) return null;
    const initialNow = new Date(initialNowIso);
    return Number.isNaN(initialNow.getTime()) ? null : initialNow;
  });

  useEffect(() => {
    let timeoutId: number | undefined;

    const refresh = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const current = Date.now();
      setNow(new Date(current));
      timeoutId = window.setTimeout(
        refresh,
        MINUTE_MS - (current % MINUTE_MS),
      );
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return now;
}
