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
import { assessorRecordUrl, clerkRecordsUrl, cookViewerUrl } from "./cook-viewer";

export const SHORTLIST_CSV_HEADERS: readonly string[] = [
  "Rank",
  "Address",
  "PIN",
  "Zoning district",
  "Zoning badge",
  "County class",
  "County class state",
  "County class description",
  "Building sq ft",
  "Building area publication state",
  "Lot sq ft",
  "Lot area publication state",
  "Assessed value",
  "Assessed year",
  "Assessed stage",
  "Assessment check state",
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
  "Issued unexpired BACP license signals",
  "CookViewer parcel details",
  "Cook County Assessor property record",
  "Cook County Clerk recorded documents",
  "Screening score",
];

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const raw = String(value);
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const OVERLAY_LABELS: { key: keyof CandidateOverlays; label: string }[] = [
  { key: "ssa", label: "SSA" },
  { key: "ccsa", label: "CCSA" },
  { key: "tif", label: "TIF" },
  { key: "nof", label: "NOF" },
];

/** Each active overlay's own name where the source published one (Finding
 *  12) — "SSA: Greater Chatham", not just "SSA".
 *
 * review5 S2: mirrors SiteShortlistResults.tsx's overlaysText() — "None
 * mapped" must never be printed for a layer that was `unknown`
 * (uncheckable), only for a genuinely confirmed absence. */
export function overlaysCell(overlays: CandidateOverlays): string {
  const active = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key].present).map((overlay) => {
    const name = overlays[overlay.key].name;
    return name ? `${overlay.label}: ${name}` : overlay.label;
  });
  const unknown = OVERLAY_LABELS.filter((overlay) => overlays[overlay.key].unknown).map(
    (overlay) => overlay.label,
  );

  if (active.length === 0 && unknown.length === OVERLAY_LABELS.length) {
    return "Not checked";
  }
  if (unknown.length > 0) {
    const base = active.length > 0 ? active.join("; ") : "None confirmed";
    return `${base} (${unknown.join(", ")} not checked)`;
  }
  return active.length > 0 ? active.join("; ") : "None mapped";
}

export const ZONING_BADGE_CSV_LABEL: Readonly<Record<ZoningBadge, string>> = ZONING_BADGE_LABELS;

type CountyFieldStatus =
  | "available"
  | "not_published"
  | "unavailable"
  | "not_requested"
  | undefined;

function fieldStateLabel(
  status: CountyFieldStatus,
  hasFacts: boolean,
  value: unknown,
): string {
  if (!hasFacts) return "Not checked";
  if (status === "unavailable") return "Unavailable";
  if (status === "not_requested") return "Not requested — PIN needs verification";
  if (status === "not_published") return "Not published";
  if (status === "available") return "Available";
  return value == null ? "Not published" : "Available";
}

function fieldValue(
  status: CountyFieldStatus,
  hasFacts: boolean,
  value: string | number | null | undefined,
): string | number {
  const state = fieldStateLabel(status, hasFacts, value);
  return state === "Available" ? (value ?? "Not published") : state;
}

function areaField(
  snapshotValue: number | null,
  hasFacts: boolean,
  liveValue: number | null | undefined,
  liveStatus: CountyFieldStatus,
): { value: number | string; state: string } {
  if (hasFacts && liveStatus === "available" && liveValue != null) {
    return { value: liveValue, state: "Available · current County record" };
  }
  if (snapshotValue != null) {
    if (liveStatus === "unavailable") {
      return { value: snapshotValue, state: "Published snapshot · current County check unavailable" };
    }
    if (liveStatus === "not_published") {
      return {
        value: snapshotValue,
        state: "Published snapshot · current County record did not publish an area",
      };
    }
    return { value: snapshotValue, state: "Published snapshot" };
  }
  const state = fieldStateLabel(liveStatus, hasFacts, liveValue);
  return { value: state, state };
}

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
    const countyClassState = fieldStateLabel(
      facts?.countyClassStatus,
      facts !== undefined,
      facts?.countyClass,
    );
    const assessmentState = fieldStateLabel(
      facts?.assessedValueStatus,
      facts !== undefined,
      facts?.assessedValue,
    );
    const buildingArea = areaField(
      candidate.buildingSqft,
      facts !== undefined,
      facts?.assessorBuildingSqft,
      facts?.assessorBuildingAreaStatus,
    );
    const lotArea = areaField(
      candidate.lotSqft,
      facts !== undefined,
      facts?.lotAreaSqft,
      facts?.lotAreaStatus,
    );
    lines.push(
      [
        index + 1,
        candidate.address,
        candidate.pin ?? "",
        candidate.zoningDistrict ?? "",
        ZONING_BADGE_CSV_LABEL[candidate.badge],
        fieldValue(facts?.countyClassStatus, facts !== undefined, facts?.countyClass),
        countyClassState,
        countyClassState === "Available" ? (facts?.classGloss ?? "Not published") : countyClassState,
        buildingArea.value,
        buildingArea.state,
        lotArea.value,
        lotArea.state,
        fieldValue(facts?.assessedValueStatus, facts !== undefined, facts?.assessedValue),
        assessmentState === "Available" ? (facts?.assessedYear ?? "Not published") : assessmentState,
        assessmentState === "Available" ? (facts?.assessedStage ?? "Not published") : assessmentState,
        assessmentState,
        assessmentState === "Available" ? (facts?.impliedMarketValue ?? "Not published") : assessmentState,
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
        cookViewerUrl(candidate.pin) ?? "PIN needs verification",
        assessorRecordUrl(candidate.pin) ?? "PIN needs verification",
        clerkRecordsUrl(candidate.pin) ?? "PIN needs verification",
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
