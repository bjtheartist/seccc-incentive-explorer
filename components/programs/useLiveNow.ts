"use client";

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * A browser clock aligned to minute boundaries, with focus/visibility refreshes.
 * The null server snapshot keeps time-sensitive actions conservative until hydration.
 */
export function useLiveNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timeoutId: number | undefined;

    const refresh = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const current = Date.now();
      setNow(new Date(current));
      timeoutId = window.setTimeout(
        refresh,
        MINUTE_MS - (current % MINUTE_MS) + 50,
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
