"use client";

import dynamic from "next/dynamic";
import type { SiteShortlistMapProps } from "./SiteShortlistMap";

/**
 * Client island around the Site Shortlist's map panel, following the same
 * ssr:false pattern as CaseWorkspaceMapIsland / CasePreviewMapIsland:
 * mapbox-gl touches `window` at module scope, and this panel is purely
 * interactive (no print/PDF or SSR-content dependency on the shortlist
 * page — unlike the vacancy report/map pages' VacancyReportMap, which is
 * kept a synchronous import on purpose because its output is exercised via
 * renderToStaticMarkup, see vacancy-map-island-site-matchmaker.test.tsx).
 * Splitting mapbox-gl + its overlay code out of the shortlist route's
 * initial JS is a pure bundle-size win with no visible behavior change:
 * SiteShortlistResults already renders the map unconditionally in the same
 * position, just one client-fetched chunk later.
 */
const SiteShortlistMap = dynamic(() => import("./SiteShortlistMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full items-center justify-center border border-[#0C1B33]/10 bg-[#F0F1EE] sm:h-[480px]">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/35">
        Loading shortlist map
      </span>
    </div>
  ),
});

export default function SiteShortlistMapIsland(props: SiteShortlistMapProps) {
  return <SiteShortlistMap {...props} />;
}
