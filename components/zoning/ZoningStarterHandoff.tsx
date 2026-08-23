// ─── Zoning starter handoff (owner rulings A2/A3 + late amendment) ──────
// Extracted from ZoningReviewQuestions.tsx's "Verification Path" footer so
// EVERY persona view — not just the "all" kitchen sink — gets the district
// family, the not-a-determination line, and the ZBA authority routing next
// to the published zoning code. The full activity questionnaire (project
// type + questions) and its one-pager handoff entry point stay inside
// ZoningReviewQuestions, which now mounts ONLY on "all" (A3: excluded from
// every persona lens, present only on the kitchen-sink view — a late
// amendment additionally cuts that one-pager entry point itself from every
// persona-view zoning section, not just the questionnaire).
//
// Structural rule this enforces: zoneClass never renders without its
// detail (district family + authority line) — see
// lib/__tests__/zoning-starter-handoff.test.ts.

import { ExternalLink } from "lucide-react";
import { authorityReferenceLine } from "@/lib/authority-routing";
import { getDistrictUseTableLink } from "@/lib/zoning-review-questions";

const DEFAULT_ZONING_SOURCE = {
  label: "City of Chicago ArcGIS zoning boundaries",
  url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
};

interface ZoningStarterHandoffProps {
  zoneClass: string;
  zoningSourceLabel?: string;
  zoningSourceUrl?: string;
  siteSpecificOrdinanceUrl?: string | null;
}

export function ZoningStarterHandoff({
  zoneClass,
  zoningSourceLabel,
  zoningSourceUrl,
  siteSpecificOrdinanceUrl,
}: ZoningStarterHandoffProps) {
  const districtUseTable = getDistrictUseTableLink(zoneClass);
  const sourceLabel = zoningSourceLabel ?? DEFAULT_ZONING_SOURCE.label;
  const sourceUrl = zoningSourceUrl ?? DEFAULT_ZONING_SOURCE.url;

  return (
    <div
      data-testid="zoning-starter-handoff"
      className="mt-4 border-l-2 border-[#2F5BEA]/45 pl-3 sm:pl-4 print:hidden"
    >
      <p className="text-[11px] sm:text-xs text-[#0C1B33]/60 leading-relaxed">
        <span className="text-[#0C1B33]/80 font-medium">{districtUseTable.label}: </span>
        {districtUseTable.context}
      </p>
      <p className="mt-2 text-[11px] sm:text-xs text-[#0C1B33]/55 leading-relaxed">
        This is a screening read from the published district, not a use determination. Confirm
        the exact ordinance use category and any required approvals with the{" "}
        {authorityReferenceLine("zoning")}.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        <a
          href={districtUseTable.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
        >
          {districtUseTable.label}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
        >
          {sourceLabel}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
        {siteSpecificOrdinanceUrl && (
          <a
            href={siteSpecificOrdinanceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[#2F5BEA] hover:underline"
          >
            Site-specific ordinance record
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}
