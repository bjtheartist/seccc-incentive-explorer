"use client";

import { MAP_GUIDE_OPEN_EVENT } from "@/lib/map-guide";

/**
 * Persistent replay affordance for the map page's spotlight tour — the same
 * dispatch-a-window-event pattern as InvestmentTourButton, kept always
 * mounted so the tour stays re-triggerable on demand even after the
 * first-visit run has completed or been skipped.
 */
export function MapTourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(MAP_GUIDE_OPEN_EVENT))}
      className="font-mono-bureau text-[12px] text-[#0C1B33]/50 transition-colors hover:text-[#2563EB]"
    >
      How to use this map
    </button>
  );
}
