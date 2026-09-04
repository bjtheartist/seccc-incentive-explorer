"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  MAP_GUIDE_OPEN_EVENT,
  MAP_GUIDE_RESOLVED_EVENT,
  readMapGuidePreference,
} from "@/lib/map-guide";

/**
 * The map's single tour entry point, mounted in the map header.
 *
 * Before the tour has been completed or skipped it is a full "Show me around"
 * pill — the one obvious way in, replacing the three scattered entry points
 * the old build had on this page (a small link under the map, plus the
 * sitewide Site Tour and the concierge bubble, which are NOT this tour and
 * stay where they are).
 *
 * Once an outcome is recorded it collapses to a small labelled replay icon:
 * still always available, no longer competing with the map for attention.
 * The swap happens live off MAP_GUIDE_RESOLVED_EVENT, so finishing a run does
 * not need a reload to demote the control.
 */
export function MapTourButton() {
  // Read in the initializer, not an effect: this only ever mounts inside
  // MapView, which is a client-only dynamic import (ssr: false), so there is
  // no server render to mismatch — and rendering the pill first and swapping
  // it to the icon a tick later would be a visible flicker for every
  // returning visitor.
  const [resolved, setResolved] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(readMapGuidePreference(window.localStorage));
  });

  useEffect(() => {
    const onResolved = () => setResolved(true);
    window.addEventListener(MAP_GUIDE_RESOLVED_EVENT, onResolved);
    return () => window.removeEventListener(MAP_GUIDE_RESOLVED_EVENT, onResolved);
  }, []);

  const start = () => window.dispatchEvent(new Event(MAP_GUIDE_OPEN_EVENT));

  if (resolved) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label="Replay the map tour"
        title="Replay the map tour"
        className="flex h-8 w-8 items-center justify-center border border-[#0C1B33]/12 bg-white/95 text-[#0C1B33]/55 backdrop-blur transition-colors hover:border-[#2563EB]/40 hover:text-[#2563EB]"
      >
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="flex h-8 items-center gap-1.5 rounded-full border border-[#2563EB] bg-[#2563EB] px-3 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-[#1d4ed8]"
    >
      Show me around
    </button>
  );
}
