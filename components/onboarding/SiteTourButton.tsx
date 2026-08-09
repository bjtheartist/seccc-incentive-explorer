"use client";

import { FIRST_VISIT_GUIDE_OPEN_EVENT } from "@/lib/first-visit-guide";

export function SiteTourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(FIRST_VISIT_GUIDE_OPEN_EVENT))}
      className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-white/30 hover:text-white/70 transition-colors"
    >
      Site Tour
    </button>
  );
}
