"use client";

/**
 * Fires `site_shortlist_funnel_shown` once per mount when the zero/thin-
 * result funnel renders (see app/vacancy/[zip]/shortlist/page.tsx's
 * FunnelSection). A separate tiny client island rather than folding this
 * into the server-rendered funnel section itself, because `trackEvent`
 * (lib/analytics-events.ts) is a browser-only call (`typeof window`
 * gated) and the funnel section is otherwise pure server-rendered markup.
 */

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics-events";
import type { ShortlistFunnelStats } from "@/lib/shortlist-engine";

export default function ShortlistFunnelEvent({
  zip,
  funnel,
}: {
  zip: string;
  funnel: ShortlistFunnelStats;
}) {
  useEffect(() => {
    trackEvent("site_shortlist_funnel_shown", {
      metadata: {
        zip,
        trackedEvidence: funnel.trackedEvidence,
        canonicalSites: funnel.canonicalSites,
        withResolvedPin: funnel.withResolvedPin,
        withMeasuredArea: funnel.withMeasuredArea,
        insideBand: funnel.insideBand,
        survivingTransitScreen: funnel.survivingTransitScreen,
        // zoning-alignment-rank change: the true final screening stage — an
        // omitted field here would let this telemetry event under-report a
        // zoning-alignment screen that emptied the results, contradicting
        // the on-screen funnel (app/vacancy/[zip]/shortlist/page.tsx's
        // FUNNEL_STAGES, which already renders this stage).
        survivingZoningScreen: funnel.survivingZoningScreen,
      },
    });
    // Once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
