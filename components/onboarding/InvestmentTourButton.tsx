"use client";

import { INVESTMENT_GUIDE_OPEN_EVENT } from "@/lib/investment-guide";

/**
 * Persistent replay affordance for the investment landing page's spotlight
 * tour — same dispatch-a-window-event pattern as SiteTourButton, restyled
 * for this page's light background (SiteTourButton's white-on-dark styling
 * is tuned for the app shell's dark footer and would be near-invisible here).
 * Always mounted, so the tour stays re-triggerable on demand even after the
 * first-visit run has completed or been skipped.
 */
export function InvestmentTourButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(INVESTMENT_GUIDE_OPEN_EVENT))}
      className="font-mono-bureau text-[12px] text-[#0C1B33]/50 transition-colors hover:text-[#2563EB]"
    >
      How to use this page
    </button>
  );
}
