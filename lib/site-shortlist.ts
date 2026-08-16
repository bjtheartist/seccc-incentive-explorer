/**
 * SITE SHORTLIST — shared vocabulary for the /locate Site Matchmaker's back
 * half.
 *
 * PURE and CLIENT-SAFE by contract: no `node:fs`, no database, no network,
 * no Next.js runtime. This module holds the leaf-level facts every shortlist
 * surface needs — geometry, owner-axis labels, county-class glosses,
 * accessibility notes, card flags, and the incentive-snapshot link — and
 * nothing that depends on the ranking engine or the universe schema, so
 * lib/shortlist-engine.ts (which DOES depend on this file) can never form an
 * import cycle with it.
 *
 * THE RANKING ENGINE LIVES ELSEWHERE. Screening, criteria-relative scoring,
 * zoning badges, and the zero-result funnel are lib/shortlist-engine.ts.
 * This file used to hold all of that too (the pre-PR2 tier/quota engine);
 * PR2's hard cutover deleted it rather than keeping it as an unused
 * fallback — see the PR2 build spec and the gpt5.6 matchmaker consult for
 * why (criteria that scored on every request regardless of selection, a
 * capped-`sitePoints` source that produced a known false-zero, and a
 * 12/8-tier quota with no basis in the actual candidate pool).
 *
 * COPY DOCTRINE that still applies to the facts in THIS file:
 *   • Ownership is "unverified", never "privately held".
 *   • Sizes and values are never described as "available", "free", or
 *     "unused".
 *   • Assessor-implied market value is "a screening ballpark, not an
 *     appraisal".
 * The zoning copy doctrine (no Special-Use predictions, no blanket ZBA
 * routing) now lives with the badge copy in lib/shortlist-engine.ts.
 */

// ── Geometry ─────────────────────────────────────────────────────────────────

/** One rail station from public/data/rail-stations.json. */
export interface ShortlistStation {
  name: string;
  /** "CTA" or a Metra line label ("Metra Electric", "Metra Rock Is.", …). */
  system: string;
  lat: number;
  lon: number;
}

/**
 * Flat-earth metre approximation between two Chicago points — accurate to
 * well under a metre at this latitude and over these distances, and cheap
 * enough to run every candidate against every station and amenity point.
 */
export function approxDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dx = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180) * 111_320;
  const dy = (lat2 - lat1) * 110_540;
  return Math.hypot(dx, dy);
}

export interface NearestStation {
  name: string;
  system: string;
  meters: number;
  walkMinutes: number;
}

const WALK_METERS_PER_MINUTE = 80;

/** The closest station in `stations`, or `null` when the list is empty or
 *  every candidate has a non-finite coordinate. */
export function nearestStation(
  lat: number,
  lon: number,
  stations: readonly ShortlistStation[],
): NearestStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: NearestStation | null = null;
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const meters = Math.round(approxDistanceMeters(lat, lon, station.lat, station.lon));
    if (best === null || meters < best.meters) {
      best = {
        name: station.name,
        system: station.system,
        meters,
        walkMinutes: Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE)),
      };
    }
  }
  return best;
}

/** True when a station belongs to the CTA 'L' network. */
export function isCtaStation(station: ShortlistStation): boolean {
  return station.system.toUpperCase().startsWith("CTA");
}

/** True when a station belongs to Metra (any line). */
export function isMetraStation(station: ShortlistStation): boolean {
  return station.system.toUpperCase().startsWith("METRA");
}

// ── County building class helpers ─────────────────────────────────────────────

/** Cook County major-class glosses for the classes this workflow meets. */
export const COUNTY_CLASS_GLOSS: Record<string, string> = {
  "100": "Vacant land (county)",
  "211": "Two-to-six-unit apartment building",
  "212": "Mixed-use storefront with apartments (6 units or fewer)",
  "313": "Walk-up apartment building",
  "314": "Larger walk-up apartment building",
  "315": "Walk-up apartment building",
  "318": "Walk-up apartment building",
  "511": "Quonset hut / small commercial",
  "517": "One-story commercial building",
  "522": "Commercial service/garage building",
  EX: "Tax-exempt property (public or institutional owner)",
};

export function countyClassGloss(countyClass: string | null): string | null {
  if (!countyClass) return null;
  return COUNTY_CLASS_GLOSS[countyClass] ?? `County class ${countyClass}`;
}

export type AccessibilityLevel = "at-grade" | "ground-floor" | "stairs" | "verify";

export interface AccessibilityNote {
  level: AccessibilityLevel;
  text: string;
}

/**
 * At-grade-entry reading from the county building class. Shown when the
 * project use is a community facility, where step-free entry decides whether
 * a building is usable at all. Always phrased as something to verify on the
 * walkthrough — the class code describes construction, not door widths.
 */
export function accessibilityNoteFor(countyClass: string | null): AccessibilityNote | null {
  if (!countyClass) return null;
  if (countyClass === "517" || countyClass === "522" || countyClass === "511") {
    return {
      level: "at-grade",
      text: "Single-story building with an at-grade entry: the strongest layout for step-free access. Verify door widths, restroom clearance, and interior steps on the walkthrough.",
    };
  }
  if (countyClass === "212") {
    return {
      level: "ground-floor",
      text: "Ground-floor storefront is usable at grade; upper floors are stair-access apartments. Verify the entry threshold on the walkthrough.",
    };
  }
  if (/^3\d\d$/.test(countyClass)) {
    return {
      level: "stairs",
      text: "Multi-story walk-up: expect entry steps and interior stairs. Step-free access would need a ramp or entry modification, priced into the renovation budget.",
    };
  }
  return {
    level: "verify",
    text: "Verify the entry condition and any interior steps on the walkthrough.",
  };
}

/**
 * Assessor-implied market value: the assessed value grossed up at the
 * county's assessment level — 25% for commercial (class 5xx, so ×4) and 10%
 * for residential and mixed-use (2xx/3xx, so ×10). Exempt parcels and county
 * vacant-land class 100 return `null` rather than a number that would
 * misstate what the assessment means. A SCREENING BALLPARK, NOT AN
 * APPRAISAL.
 */
export function impliedMarketValue(
  countyClass: string | null,
  assessedValue: number | null,
): number | null {
  if (!countyClass || assessedValue == null) return null;
  if (!Number.isFinite(assessedValue) || assessedValue <= 0) return null;
  const code = countyClass.trim().toUpperCase();
  if (code === "EX" || code.startsWith("EX") || code === "100") return null;
  if (code.startsWith("5")) return Math.round(assessedValue * 4);
  if (code.startsWith("2") || code.startsWith("3")) return Math.round(assessedValue * 10);
  return null;
}

export const IMPLIED_VALUE_CAPTION = "screening ballpark, not an appraisal";

/** Cook County occasionally serializes a tax year as a decimal-looking string
 * (for example `2026.0`). Preserve unusual source text, but present that known
 * whole-year encoding as the calendar year users expect. */
export function assessedYearLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const wholeYear = /^(\d{4})\.0+$/.exec(trimmed);
  return wholeYear?.[1] ?? trimmed;
}

// ── Owner axes ───────────────────────────────────────────────────────────────

const OWNER_STRUCTURE_LABELS: Record<string, string> = {
  government: "Government",
  individual: "Individual",
  corporate_llc: "Corporate / LLC",
  trust: "Trust",
  nonprofit: "Nonprofit",
  financial: "Financial institution",
  unresolved: "Unresolved",
};

const OWNER_GEOGRAPHY_LABELS: Record<string, string> = {
  in_state: "in-state mailing address",
  out_of_state: "out-of-state mailing address",
  local: "local mailing address",
  unknown: "mailing address unknown",
};

function humanize(value: string): string {
  const cleaned = value.replace(/_/g, " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Unresolved";
}

/**
 * The two owner axes as one label. Ownership is reported as an UNVERIFIED
 * taxpayer-record classification — never a named owner, and never "privately
 * held".
 */
export function ownerAxesLabel(structure: string, geography: string): string {
  const left = OWNER_STRUCTURE_LABELS[structure] ?? humanize(structure);
  const right = OWNER_GEOGRAPHY_LABELS[geography] ?? humanize(geography).toLowerCase();
  return `${left} · ${right} (unverified)`;
}

// ── Card flags ───────────────────────────────────────────────────────────────
//
// AUTHORITY ROUTING — every flag names the office that actually owns the
// record, never a generic "the City" and never the wrong department:
//   • building condition, permits, vacant-building violations → Department of
//     Buildings
//   • business licensing → BACP (Business Affairs and Consumer Protection)
// (Zoning-relief routing, previously listed here, moved with the rest of the
// zoning copy doctrine to lib/shortlist-engine.ts — see that file's header
// for why blanket ZBA routing was retired in PR2.)

/** Tax-sale history: a lien position is leverage, not a listing. */
export function taxSaleFlag(saleYear: number): string {
  return `Tax-sale history (${saleYear}) — possible acquisition leverage`;
}

/** Vacant-building violation, sourced from the Department of Buildings. */
export const VIOLATION_FLAG =
  "On the Department of Buildings vacant-building violation list — expect condition issues";

/** An unexpired BACP license recorded at this address. An address match is a
 *  signal, never proof of occupancy. */
export function activeLicenseFlag(name: string): string {
  return `Active BACP business license on record at this address: ${name} — may be occupied; confirm before outreach`;
}

/** Condition and permit history are the Department of Buildings' record. */
export const CONDITION_VERIFICATION_NOTE =
  "Confirm condition, open violations, and permit history with the Department of Buildings before committing.";

// ── Request-time bounded enrichment (county parcel facts + licensing) ──

/** Per-card facts the request-time enrichment adds, for the CSV and the
 *  cards. Stays DISPLAY-only enrichment — it can never change which
 *  candidates appear or their order (see lib/shortlist-engine.ts). Ranked
 *  results are fetched as one bounded batch; the full explorer fetches only
 *  the one parcel a reader explicitly opens. */
export interface ShortlistEnrichmentFacts {
  countyClass: string | null;
  classGloss: string | null;
  countyClassStatus?: "available" | "not_published" | "unavailable" | "not_requested";
  lotAreaSqft?: number | null;
  lotAreaStatus?: "available" | "not_published" | "unavailable" | "not_requested";
  assessorBuildingSqft?: number | null;
  assessorBuildingYear?: string | null;
  assessorBuildingAreaStatus?: "available" | "not_published" | "unavailable" | "not_requested";
  assessedValue: number | null;
  assessedYear: string | null;
  assessedStage?: "board" | "certified" | "mailed" | null;
  assessedValueStatus?: "available" | "not_published" | "unavailable" | "not_requested";
  impliedMarketValue: number | null;
  activeLicenses: { name: string; description: string }[];
  activeLicenseStatus?: "available" | "not_found" | "unavailable" | "not_requested";
}

// ── Incentive-snapshot link ─────────────────────────────────────────────────

/**
 * The `src` value the shortlist stamps on every incentive-snapshot link.
 *
 * /report validates `src` against an ALLOWLIST (`ALLOWED_REPORT_SOURCES` in
 * app/report/page.tsx) and silently collapses anything unrecognized into the
 * generic `instant_report` bucket. So this constant is not decoration: the
 * string here MUST stay registered there, or every snapshot the shortlist
 * sends loses its attribution with no error to notice. A test pins both
 * halves.
 */
export const SHORTLIST_SNAPSHOT_SOURCE = "site_shortlist";

/**
 * The "Incentive snapshot" destination for one candidate — /report's instant
 * mode, pre-seeded with the record's coordinates and address.
 *
 * The address parameter is `addr`, NOT `address`: that is the name /report
 * actually reads (app/report/page.tsx, `searchParams.get("addr")`), and it
 * is what every other instant link in this repo already emits
 * (lib/vacancy-spreadsheet.ts, components/map/MapPolygonPanel.tsx).
 * Coordinates are fixed to 5 decimals for the same reason those do: it keeps
 * the URL cache-bucketable.
 */
export function shortlistSnapshotHref(candidate: {
  lat: number;
  lon: number;
  address: string;
}): string {
  const params = new URLSearchParams({
    instant: "true",
    lat: candidate.lat.toFixed(5),
    lon: candidate.lon.toFixed(5),
    addr: candidate.address,
    src: SHORTLIST_SNAPSHOT_SOURCE,
  });
  return `/report?${params.toString()}`;
}
