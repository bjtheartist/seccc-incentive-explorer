"use client";

/**
 * "Show on map →" cross-link (Sol #1): from an analysis surface back to the map,
 * with the working session's filter context (year window + funder types) carried
 * in the URL so the map restores the same view — `/map?investment=1&area=…&
 * year=…&types=…`. MapView reads it back (sessionFromQuery), enables the
 * Community Investment layer, applies the filters, and flies to the community.
 *
 * It reads the live session through useSyncExternalStore (the same
 * hydration-safe external-store pattern as PinControls) and, on mount, records
 * the area it is on as the session's focused communityArea so the round-trip and
 * the store stay in agreement. A plain <a> (not next/link) is used deliberately:
 * it avoids prefetching the heavy map bundle from every analysis page.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  getInvestmentSessionServerSnapshot,
  getInvestmentSessionSnapshot,
  mapHrefForSession,
  patchInvestmentSession,
  subscribeInvestmentSession,
  type InvestmentSession,
} from "@/lib/investment-session";

function useInvestmentSession(): InvestmentSession {
  return useSyncExternalStore(
    subscribeInvestmentSession,
    getInvestmentSessionSnapshot,
    getInvestmentSessionServerSnapshot,
  );
}

/**
 * @param area  The community area to focus on the map (an area page passes its
 *   own name; the compare page passes each pinned area). When omitted, the link
 *   uses whatever CA is in the session.
 */
export function ShowOnMapLink({
  area,
  className,
  label = "Show on map →",
}: {
  area?: string;
  className?: string;
  label?: string;
}) {
  const session = useInvestmentSession();

  // Keep the session's focused CA in step with the page the admin is viewing.
  useEffect(() => {
    if (area) patchInvestmentSession({ communityArea: area });
  }, [area]);

  const href = mapHrefForSession(session, area);

  return (
    <a
      href={href}
      className={
        className ??
        "inline-flex items-center rounded-[3px] border border-[#0C1B33]/15 bg-white px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[#0C1B33]/60 hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
      }
    >
      {label}
    </a>
  );
}
