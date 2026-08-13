/**
 * The Site Shortlist CSV export — built from exactly the ranked candidates
 * the page rendered (top `SHORTLIST_TOP_N`), never from the full screened
 * universe. Split out of lib/shortlist-engine.ts so the engine module stays
 * scoring-only; split out of lib/site-shortlist.ts so that leaf module never
 * needs to import the engine's candidate type.
 *
 * PURE and CLIENT-SAFE — the client island (SiteShortlistResults) builds the
 * CSV blob in the browser from data it already has, exactly like the pre-PR2
 * version did.
 */

import {
  ZONING_BADGE_LABELS,
  type CandidateOverlays,
  type DecoratedShortlistCandidate,
  type ZoningBadge,
} from "./shortlist-engine";
import type { ShortlistEnrichmentFacts } from "./site-shortlist";

export const SHORTLIST_CSV_HEADERS: readonly string[] = [
  "Rank",
  "Address",
  "PIN",
  "Zoning district",
  "Zoning badge",
  "County class",
  "County class description",
  "Building sq ft",
  "Lot sq ft",
  "Assessed value",
  "Assessed year",
  "Assessor-implied market value",
  "Owner type (unverified)",
  "Transit score basis",
  "Distance to scored transit (m)",
  "Walk to scored transit (min)",
  "Nearest rail (display only)",
  "Expressway proximity (display only, straight-line miles)",
  "Nearest school (display only)",
  "Nearest library (display only)",
  "Mapped overlays",
  "Incentive geographies mapped at this point",
  "Tax-sale year",
  "Vacant-building violation",
  "Active licenses",
  "Screening score",
];

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const OVERLAY_LABELS: { key: keyof CandidateOverlays; label: string }[] = [
  { key: "ssa", label: "SSA" },
  { key: "ccsa", label: "CCSA" },
  { key: "tif", label: "TIF" },
  { key: "nof", label: "NOF" },
];

/** Each active overlay's own name where the source published one (Finding
 *  12) — "SSA: Greater Chatham", not just "SSA". */
function overlaysCell(overlays: CandidateOverlays): string {
  const active = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key].present).map((overlay) => {
    const name = overlays[overlay.key].name;
    return name ? `${overlay.label}: ${name}` : overlay.label;
  });
  return active.length > 0 ? active.join("; ") : "None mapped";
}

export const ZONING_BADGE_CSV_LABEL: Readonly<Record<ZoningBadge, string>> = ZONING_BADGE_LABELS;

/** Build the downloadable CSV from exactly the DECORATED ranked candidates
 *  rendered on the page, in the SAME order. Candidates must already carry
 *  display-only facts (lib/shortlist-engine.ts's
 *  `decorateShortlistDisplayFacts`) — this module never computes them. */
export function shortlistCsv(
  candidates: readonly DecoratedShortlistCandidate[],
  enrichment: Readonly<Record<string, ShortlistEnrichmentFacts>> = {},
): string {
  const lines = [SHORTLIST_CSV_HEADERS.map(csvCell).join(",")];

  candidates.forEach((candidate, index) => {
    const facts = enrichment[candidate.key];
    lines.push(
      [
        index + 1,
        candidate.address,
        candidate.pin ?? "",
        candidate.zoningDistrict ?? "",
        ZONING_BADGE_CSV_LABEL[candidate.badge],
        facts?.countyClass ?? "",
        facts?.classGloss ?? "",
        candidate.buildingSqft ?? "",
        candidate.lotSqft ?? "",
        facts?.assessedValue ?? "",
        facts?.assessedYear ?? "",
        facts?.impliedMarketValue ?? "",
        candidate.ownerLabel,
        candidate.transitScore
          ? `${candidate.transitScore.stationName} (${candidate.transitScore.stationSystem})`
          : "",
        candidate.transitScore?.meters ?? "",
        candidate.transitScore?.walkMinutes ?? "",
        candidate.nearestRailDisplay
          ? `${candidate.nearestRailDisplay.name} (${candidate.nearestRailDisplay.system}) · ${candidate.nearestRailDisplay.meters} m`
          : "",
        candidate.expresswayDisplay?.miles != null
          ? `${candidate.expresswayDisplay.name ?? "Expressway"} · ${candidate.expresswayDisplay.miles} mi`
          : "",
        candidate.nearestSchool
          ? `${candidate.nearestSchool.name} · ${candidate.nearestSchool.meters} m`
          : "",
        candidate.nearestLibrary
          ? `${candidate.nearestLibrary.name} · ${candidate.nearestLibrary.meters} m`
          : "",
        overlaysCell(candidate.overlays),
        candidate.incentiveCount,
        candidate.saleYear ?? "",
        candidate.violation ? "Yes" : "",
        (facts?.activeLicenses ?? []).map((license) => license.name).join("; "),
        candidate.score,
      ]
        .map(csvCell)
        .join(","),
    );
  });

  return lines.join("\n");
}

export function shortlistCsvFilename(zip: string): string {
  return `Site-Shortlist-${zip}.csv`;
}
