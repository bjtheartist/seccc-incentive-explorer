/**
 * SITE SHORTLIST — the back half of the /locate Site Matchmaker.
 *
 * The wizard collects criteria; this module turns those criteria plus one
 * committed vacancy edition into a RANKED, TIERED shortlist of specific
 * candidate properties. It is the productized form of the manual pipeline run
 * for the Stan & Ken community-space search (Aug 2026) — the screens, weights,
 * and tier split below are ported from that reference implementation.
 *
 * PURE and CLIENT-SAFE by contract: no `node:fs`, no database, no network, no
 * Next.js runtime. The server page loads the edition (lib/vacancy-index.ts),
 * the rail stations (lib/rail-stations.ts), and the zone overlays
 * (lib/zones-check.ts) and hands the plain data in. That separation is the same
 * one lib/vacancy-index-adapter.ts and lib/vacancy-portfolio.ts keep, and it is
 * load-bearing: value-importing the fs loader from a client component breaks
 * the build.
 *
 * COPY DOCTRINE (enforced by the labels exported here, not just by the page):
 *   • The by-right matrix is a SCREENING SIGNAL, never a zoning determination.
 *     Every rendered tier carries a "confirm with the Zoning Board of Appeals"
 *     caveat. The ZBA (with the Zoning Administrator) is the authority for
 *     Special Use and variation relief in Chicago — the Department of Planning
 *     and Development is NOT, and must never be named as one here.
 *   • Ownership is "unverified", never "privately held".
 *   • Sizes and values are never described as "available", "free", or "unused".
 *   • Assessor-implied market value is "a screening ballpark, not an appraisal".
 *
 * Two phases, because the overlay point-in-polygon pass is the expensive step:
 *   1. screenShortlistSites() — property-type, footprint, and (only when
 *      honestly applicable) rail screens, plus every score component that needs
 *      no overlay lookup. Returns candidates in provisional rank order.
 *   2. assembleShortlist()   — takes the top slice WITH its overlay hits
 *      attached, applies the overlay weight, assigns tiers, and caps.
 */

import type {
  SiteMatchCriteria,
  SiteProjectUse,
  SiteTransportationDistance,
} from "./site-matchmaker";

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The vacancy-edition fields the shortlist reads. Structurally satisfied by
 *  `VacancySitePoint` — deliberately restated so this file never imports the
 *  fs-backed module. */
export interface ShortlistSourceSite {
  address: string | null;
  pin: string | null;
  lat: number;
  lon: number;
  propertyType: "vacant_building" | "vacant_land";
  zoningClass: string | null;
  space?: { assessorBuildingSqft?: number; lotAreaSqft?: number };
  ownerStructure: string;
  ownerGeography: string;
  incentiveCount: number;
  saleYear: number | null;
  violation: boolean;
}

/** One rail station from public/data/rail-stations.json. */
export interface ShortlistStation {
  name: string;
  /** "CTA" or a Metra line label ("Metra Electric", "Metra Rock Is.", …). */
  system: string;
  lat: number;
  lon: number;
}

/** One mapped overlay containing a candidate (SSA / CCSA / TIF / NOF). */
export interface ShortlistOverlay {
  /** Layer label, e.g. "SSA". */
  layer: string;
  /** Feature name, e.g. "Greater Chatham". Empty when the source is unnamed. */
  name: string;
}

// ── Ported constants ─────────────────────────────────────────────────────────

/**
 * Arterial street tokens, ported verbatim from the reference pipeline. A site
 * on one of these streets carries corridor visibility a rail-distance number
 * alone does not capture, which is why the arterial bonus outweighs the
 * off-arterial floor.
 */
export const ARTERIAL_TOKENS: readonly string[] = [
  "75TH", "79TH", "83RD", "87TH", "95TH", "103RD", "63RD", "67TH", "71ST",
  "COTTAGE GROVE", "KING DR", "MICHIGAN", "STATE ST", "STONY ISLAND",
  "SOUTH CHICAGO", "COMMERCIAL AVE", "EXCHANGE", "ASHLAND", "HALSTED",
  "WESTERN", "PULASKI", "KEDZIE", "KOSTNER", "CICERO", "MADISON",
  "CHICAGO AVE", "NORTH AVE", "ROOSEVELT", "16TH", "26TH", "CERMAK",
  "LAKE ST", "DIVISION", "GRAND AVE", "OGDEN", "ARCHER", "VINCENNES", "WABASH",
];

/** Metres behind each wizard distance option. `null` = carry no rail screen. */
export const TRANSPORTATION_DISTANCE_METERS: Record<
  SiteTransportationDistance,
  number | null
> = {
  flexible: null,
  "quarter-mile": 400,
  "half-mile": 800,
  "one-mile": 1600,
};

/** Reference default sweet spot, used when the criteria carry no closed band. */
export const DEFAULT_SWEET_SPOT_SQFT = { min: 2500, max: 8000 } as const;

/** Rail score decays linearly to zero at this distance (reference weight). */
const RAIL_SCORE_HORIZON_M = 800;
/** Assumed walking pace, metres per minute (reference: rail_m / 80). */
const WALK_METERS_PER_MINUTE = 80;

export const TIER_1_CAP = 12;
export const TIER_2_CAP = 8;

/** How many screened candidates get the overlay point-in-polygon pass. Larger
 *  than the combined tier caps so the overlay weight can still reorder the
 *  rendered set, small enough that the PIP pass stays cheap. */
export const OVERLAY_ENRICH_LIMIT = 40;

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Flat-earth metre approximation between two Chicago points — the reference
 * pipeline's own `dist_m`. Accurate to well under a metre at this latitude and
 * over these distances, and cheap enough to run every candidate against every
 * station.
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

/** The closest station in `stations`, or `null` when the list is empty. */
export function nearestStation(
  lat: number,
  lon: number,
  stations: readonly ShortlistStation[],
): NearestStation | null {
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

// ── Screens ──────────────────────────────────────────────────────────────────

/**
 * The rail screen, and only when it is honest to apply one.
 *
 * A screen runs ONLY when the reader asked for CTA rail or Metra AND chose a
 * non-flexible distance. Bus and the other networks deliberately do NOT screen:
 * Chicago's bus coverage is dense enough that a radius filter would be
 * precision the data does not support, and dropping real candidates on it would
 * be dishonest. Returns the screen radius plus the station subset it applies to,
 * or `null` when no screen runs.
 */
export function railScreenFor(
  criteria: SiteMatchCriteria,
  stations: readonly ShortlistStation[],
): { meters: number; stations: ShortlistStation[] } | null {
  const wantsCta = criteria.transportation.includes("cta-rail");
  const wantsMetra = criteria.transportation.includes("metra");
  if (!wantsCta && !wantsMetra) return null;

  const distance = criteria.transportationDistance;
  if (!distance) return null;
  const meters = TRANSPORTATION_DISTANCE_METERS[distance];
  if (meters == null) return null;

  const subset = stations.filter(
    (station) =>
      (wantsCta && isCtaStation(station)) || (wantsMetra && isMetraStation(station)),
  );
  if (subset.length === 0) return null;
  return { meters, stations: subset };
}

/** The measured area a candidate is screened on: assessor building area for a
 *  building, lot area for land. `null` when the edition published none. */
export function screeningAreaSqft(site: ShortlistSourceSite): number | null {
  const value =
    site.propertyType === "vacant_building"
      ? site.space?.assessorBuildingSqft
      : site.space?.lotAreaSqft;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Property-type screen. `existing-building` additionally requires a PIN and a
 * published space record — without both, a building cannot be enriched, linked
 * to a county record, or sized, so it is not a shortlist candidate (the raw map
 * remains the honest home for those rows).
 */
export function passesPropertyTypeScreen(site: ShortlistSourceSite, criteria: SiteMatchCriteria): boolean {
  if (criteria.propertyType === "existing-building") {
    return site.propertyType === "vacant_building" && Boolean(site.pin) && Boolean(site.space);
  }
  if (criteria.propertyType === "vacant-land") return site.propertyType === "vacant_land";
  if (criteria.propertyType === "either") {
    return site.propertyType === "vacant_building"
      ? Boolean(site.pin) && Boolean(site.space)
      : true;
  }
  return false;
}

/**
 * Footprint band screen. Unlike the map's prefilter, a candidate with NO
 * published measurement is dropped whenever a bound is set: a shortlist card
 * asserts a size, so an unmeasured site cannot earn a place on one.
 */
export function passesFootprintScreen(
  site: ShortlistSourceSite,
  criteria: SiteMatchCriteria,
): boolean {
  const min = criteria.minSquareFeet;
  const max = criteria.maxSquareFeet;
  if (min == null && max == null) return true;
  const area = screeningAreaSqft(site);
  if (area == null) return false;
  if (min != null && area < min) return false;
  if (max != null && area > max) return false;
  return true;
}

/** The sweet spot band: the middle 40–80% of a closed criteria band, else the
 *  reference default. */
export function sweetSpotFor(criteria: SiteMatchCriteria): { min: number; max: number } {
  const min = criteria.minSquareFeet;
  const max = criteria.maxSquareFeet;
  if (min != null && max != null && max > min) {
    const span = max - min;
    return { min: min + span * 0.4, max: min + span * 0.8 };
  }
  return { min: DEFAULT_SWEET_SPOT_SQFT.min, max: DEFAULT_SWEET_SPOT_SQFT.max };
}

/** True when the street address carries one of the ported arterial tokens. */
export function onArterial(address: string | null): boolean {
  if (!address) return false;
  const upper = address.toUpperCase();
  return ARTERIAL_TOKENS.some((token) => upper.includes(token));
}

// ── Zoning: the by-right matrix (a SCREENING SIGNAL) ──────────────────────────

export type ShortlistZoningStatus = "by-right" | "relief-likely" | "unverified";

/** Trailing `-N` intensity suffix of a Chicago district code (B3-2 -> 2). */
function districtIntensity(code: string): number | null {
  const match = /-(\d+)$/.exec(code);
  return match ? Number(match[1]) : null;
}

/**
 * Does this project use read as PERMITTED BY RIGHT in this district?
 *
 * This is a screening signal drawn from the district family, NOT a zoning
 * determination: it does not read the use table, does not account for Planned
 * Developments, overlay districts, or pending map amendments, and cannot see a
 * site's legal nonconforming status. Anything it cannot place lands in Tier 2.
 * Planned Manufacturing Districts are NEVER Tier 1 — a PMD's whole purpose is
 * to exclude the non-industrial uses this wizard mostly collects.
 */
export function zoningStatusFor(
  projectUse: SiteProjectUse | null,
  zoningClass: string | null,
): ShortlistZoningStatus {
  const code = zoningClass?.trim().toUpperCase() ?? "";
  if (!code) return "unverified";
  // PMD first: "PMD 11" would otherwise never match anything anyway, but the
  // rule is stated explicitly so a future family test cannot let one through.
  if (code.startsWith("PMD")) return "relief-likely";
  if (!projectUse) return "relief-likely";

  const commercial = code.startsWith("B") || code.startsWith("C");

  switch (projectUse) {
    case "retail-service":
    case "food-hospitality":
    case "office-professional":
    case "community-facility":
    case "other-commercial":
      return commercial ? "by-right" : "relief-likely";
    case "production-manufacturing":
    case "distribution-logistics":
      return code.startsWith("M") || code.startsWith("C3") ? "by-right" : "relief-likely";
    case "housing-mixed-use": {
      if (code.startsWith("R") || code.startsWith("D")) return "by-right";
      if (code.startsWith("B")) {
        const intensity = districtIntensity(code);
        return intensity != null && intensity >= 2 ? "by-right" : "relief-likely";
      }
      return "relief-likely";
    }
  }
}

/**
 * The verbatim caveat every rendered tier carries.
 *
 * The named authority is the Zoning Administrator / Zoning Board of Appeals —
 * Chicago's zoning relief (Special Use, variation) runs through the ZBA. The
 * Department of Planning and Development does NOT oversee zoning approvals and
 * must never be named as the authority here.
 */
export const ZONING_SCREENING_NOTE =
  "Zoning here is a screening signal read from the district code, not a determination. Confirm current zoning and any required approvals with the City's Zoning Administrator / Zoning Board of Appeals before committing.";

export const TIER_1_HEADING = "Ready from a zoning standpoint — permitted by right";
export const TIER_2_HEADING =
  "Zoning relief likely needed — Special Use, roughly 3-5 extra months";

/** The per-card zoning sentence, matched to the screening status. */
export function zoningStatusNote(
  status: ShortlistZoningStatus,
  zoningClass: string | null,
): string {
  const code = zoningClass?.trim() ?? "";
  if (status === "unverified") {
    return "Zoning unverified — this record carries no district code, so the use could not be screened. Confirm the district with the Zoning Board of Appeals.";
  }
  if (status === "by-right") {
    return `Zoned ${code} — this district family reads as permitting the use by right. Screening signal only; confirm with the Zoning Board of Appeals.`;
  }
  return `Zoned ${code} — this district family does not read as permitting the use by right, so expect a Special Use approval from the Zoning Board of Appeals (roughly 3 to 5 extra months). Screening signal only; confirm with the Zoning Board of Appeals.`;
}

// ── Card flags ───────────────────────────────────────────────────────────────
//
// AUTHORITY ROUTING — every flag names the office that actually owns the
// record, never a generic "the City" and never the wrong department:
//   • zoning relief / by-right confirmation → Zoning Board of Appeals
//   • building condition, permits, vacant-building violations → Department of
//     Buildings
//   • business licensing → BACP (Business Affairs and Consumer Protection)
//   • TIF → Department of Planning and Development (genuinely DPD's program)

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
 * project use is a community facility, where step-free entry decides whether a
 * building is usable at all. Always phrased as something to verify on the
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
 * Assessor-implied market value: the assessed value grossed up at the county's
 * assessment level — 25% for commercial (class 5xx, so ×4) and 10% for
 * residential and mixed-use (2xx/3xx, so ×10). Exempt parcels and county
 * vacant-land class 100 return `null` rather than a number that would misstate
 * what the assessment means. A SCREENING BALLPARK, NOT AN APPRAISAL.
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

// ── Phase 1: screen + provisional score ──────────────────────────────────────

export interface ScreenedSite {
  /** Stable identity for React keys, CSV rows, and enrichment requests. */
  key: string;
  address: string;
  pin: string | null;
  lat: number;
  lon: number;
  propertyType: "vacant_building" | "vacant_land";
  buildingSqft: number | null;
  lotSqft: number | null;
  zoning: string | null;
  ownerLabel: string;
  incentiveCount: number;
  saleYear: number | null;
  violation: boolean;
  nearestRail: NearestStation | null;
  onArterial: boolean;
  /** Every score component except the overlay weight. */
  baseScore: number;
}

export interface ShortlistScreenStats {
  loadedCount: number;
  propertyTypeKeptCount: number;
  footprintKeptCount: number;
  railScreenMeters: number | null;
  candidateCount: number;
}

function siteKey(site: ShortlistSourceSite, address: string): string {
  return site.pin ?? `${address}@${site.lat.toFixed(5)},${site.lon.toFixed(5)}`;
}

/**
 * Run the screens and every overlay-independent score component, returning
 * candidates in provisional rank order (highest first, address-ascending as the
 * deterministic tiebreak).
 */
export function screenShortlistSites(
  sites: readonly ShortlistSourceSite[],
  criteria: SiteMatchCriteria,
  stations: readonly ShortlistStation[],
): { candidates: ScreenedSite[]; stats: ShortlistScreenStats } {
  const railScreen = railScreenFor(criteria, stations);
  const sweetSpot = sweetSpotFor(criteria);

  let propertyTypeKeptCount = 0;
  let footprintKeptCount = 0;
  const candidates: ScreenedSite[] = [];

  for (const site of sites) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
    if (!passesPropertyTypeScreen(site, criteria)) continue;
    propertyTypeKeptCount += 1;
    if (!passesFootprintScreen(site, criteria)) continue;
    footprintKeptCount += 1;

    if (railScreen) {
      const screened = nearestStation(site.lat, site.lon, railScreen.stations);
      if (!screened || screened.meters > railScreen.meters) continue;
    }

    const address = (site.address ?? "").trim();
    if (!address) continue;

    // Display rail is the nearest station on ANY line, which is what a reader
    // walking to a train actually cares about; the screen above is the one that
    // honors the criteria.
    const rail = nearestStation(site.lat, site.lon, stations);
    const arterial = onArterial(address);
    const area = screeningAreaSqft(site);

    const railPoints = rail
      ? (Math.max(0, RAIL_SCORE_HORIZON_M - rail.meters) / RAIL_SCORE_HORIZON_M) * 30
      : 0;
    const arterialPoints = arterial ? 20 : 8;
    const incentivePoints = Math.min(site.incentiveCount || 0, 10) * 2;
    const sweetSpotPoints =
      area != null && area >= sweetSpot.min && area <= sweetSpot.max ? 8 : 0;
    const distressPoints = site.saleYear || site.violation ? 5 : 0;

    candidates.push({
      key: siteKey(site, address),
      address,
      pin: site.pin,
      lat: site.lat,
      lon: site.lon,
      propertyType: site.propertyType,
      buildingSqft:
        typeof site.space?.assessorBuildingSqft === "number"
          ? site.space.assessorBuildingSqft
          : null,
      lotSqft: typeof site.space?.lotAreaSqft === "number" ? site.space.lotAreaSqft : null,
      zoning: site.zoningClass?.trim() || null,
      ownerLabel: ownerAxesLabel(site.ownerStructure, site.ownerGeography),
      incentiveCount: site.incentiveCount || 0,
      saleYear: site.saleYear,
      violation: Boolean(site.violation),
      nearestRail: rail,
      onArterial: arterial,
      baseScore:
        railPoints + arterialPoints + incentivePoints + sweetSpotPoints + distressPoints,
    });
  }

  candidates.sort(
    (a, b) => b.baseScore - a.baseScore || a.address.localeCompare(b.address),
  );

  return {
    candidates,
    stats: {
      loadedCount: sites.length,
      propertyTypeKeptCount,
      footprintKeptCount,
      railScreenMeters: railScreen?.meters ?? null,
      candidateCount: candidates.length,
    },
  };
}

// ── Phase 2: overlays, final score, tiers, caps ──────────────────────────────

export interface ShortlistCandidate extends ScreenedSite {
  overlays: ShortlistOverlay[];
  /** Final 0–100-ish screening score. Never rendered as a rank guarantee. */
  score: number;
  tier: 1 | 2;
  zoningStatus: ShortlistZoningStatus;
  zoningNote: string;
  /** True when the project use is a community facility, where step-free entry
   *  decides usability. The note itself is derived from the county building
   *  class, which only arrives with the request-time enrichment. */
  showAccessibility: boolean;
}

export interface ShortlistResult {
  tier1: ShortlistCandidate[];
  tier2: ShortlistCandidate[];
  /** Pre-cap counts, so the page can say how many were held back. */
  tier1Total: number;
  tier2Total: number;
}

/** Overlay hits that earn the non-TIF weight. A TIF district is a financing
 *  geography, not a demand signal, so it is listed but not scored. */
function scoredOverlayCount(overlays: readonly ShortlistOverlay[]): number {
  return overlays.filter((overlay) => overlay.layer.toUpperCase() !== "TIF").length;
}

/**
 * Attach overlays, finish the score, split by the by-right matrix, and cap.
 * Deterministic: the same input always yields the same order.
 */
export function assembleShortlist(
  entries: readonly { site: ScreenedSite; overlays: ShortlistOverlay[] }[],
  criteria: SiteMatchCriteria,
): ShortlistResult {
  const showAccessibility = criteria.projectUse === "community-facility";

  const scored: ShortlistCandidate[] = entries.map(({ site, overlays }) => {
    const status = zoningStatusFor(criteria.projectUse, site.zoning);
    return {
      ...site,
      overlays,
      score: Math.round((site.baseScore + scoredOverlayCount(overlays) * 10) * 10) / 10,
      tier: status === "by-right" ? 1 : 2,
      zoningStatus: status,
      zoningNote: zoningStatusNote(status, site.zoning),
      showAccessibility,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));

  const tier1 = scored.filter((entry) => entry.tier === 1);
  const tier2 = scored.filter((entry) => entry.tier === 2);

  return {
    tier1: tier1.slice(0, TIER_1_CAP),
    tier2: tier2.slice(0, TIER_2_CAP),
    tier1Total: tier1.length,
    tier2Total: tier2.length,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export const SHORTLIST_CSV_HEADERS: readonly string[] = [
  "Tier",
  "Rank",
  "Address",
  "PIN",
  "Zoning",
  "Zoning screening signal",
  "County class",
  "County class description",
  "Building sq ft",
  "Lot sq ft",
  "Assessed value",
  "Assessed year",
  "Assessor-implied market value",
  "Owner type (unverified)",
  "Nearest rail",
  "Distance to rail (m)",
  "Walk (min)",
  "Mapped overlays",
  "Incentive geographies",
  "Tax-sale year",
  "Vacant-building violation",
  "Active licenses",
  "Screening score",
];

/** Per-card facts the request-time enrichment adds, for the CSV and the cards. */
export interface ShortlistEnrichmentFacts {
  countyClass: string | null;
  classGloss: string | null;
  assessedValue: number | null;
  assessedYear: string | null;
  impliedMarketValue: number | null;
  activeLicenses: { name: string; description: string }[];
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build the downloadable CSV from exactly what the page rendered. */
export function shortlistCsv(
  result: ShortlistResult,
  enrichment: Readonly<Record<string, ShortlistEnrichmentFacts>> = {},
): string {
  const lines = [SHORTLIST_CSV_HEADERS.map(csvCell).join(",")];

  const emit = (candidate: ShortlistCandidate, tierLabel: string, rank: number) => {
    const facts = enrichment[candidate.key];
    lines.push(
      [
        tierLabel,
        rank,
        candidate.address,
        candidate.pin ?? "",
        candidate.zoning ?? "",
        candidate.zoningStatus === "by-right"
          ? "Reads as permitted by right (screening signal)"
          : candidate.zoningStatus === "unverified"
            ? "Zoning unverified"
            : "Zoning relief likely needed (screening signal)",
        facts?.countyClass ?? "",
        facts?.classGloss ?? "",
        candidate.buildingSqft ?? "",
        candidate.lotSqft ?? "",
        facts?.assessedValue ?? "",
        facts?.assessedYear ?? "",
        facts?.impliedMarketValue ?? "",
        candidate.ownerLabel,
        candidate.nearestRail ? `${candidate.nearestRail.name} (${candidate.nearestRail.system})` : "",
        candidate.nearestRail?.meters ?? "",
        candidate.nearestRail?.walkMinutes ?? "",
        candidate.overlays
          .map((overlay) => (overlay.name ? `${overlay.layer}: ${overlay.name}` : overlay.layer))
          .join("; "),
        candidate.incentiveCount,
        candidate.saleYear ?? "",
        candidate.violation ? "Yes" : "",
        (facts?.activeLicenses ?? []).map((license) => license.name).join("; "),
        candidate.score,
      ]
        .map(csvCell)
        .join(","),
    );
  };

  result.tier1.forEach((candidate, index) =>
    emit(candidate, "1 - reads as by right", index + 1),
  );
  result.tier2.forEach((candidate, index) =>
    emit(candidate, "2 - zoning relief likely", result.tier1.length + index + 1),
  );

  return lines.join("\n");
}

export function shortlistCsvFilename(zip: string): string {
  return `Site-Shortlist-${zip}.csv`;
}

/**
 * The `src` value the shortlist stamps on every incentive-snapshot link.
 *
 * /report validates `src` against an ALLOWLIST (`ALLOWED_REPORT_SOURCES` in
 * app/report/page.tsx) and silently collapses anything unrecognized into the
 * generic `instant_report` bucket. So this constant is not decoration: the
 * string here MUST stay registered there, or every snapshot the shortlist sends
 * loses its attribution with no error to notice. A test pins both halves.
 */
export const SHORTLIST_SNAPSHOT_SOURCE = "site_shortlist";

/**
 * The "Incentive snapshot" destination for one candidate — /report's instant
 * mode, pre-seeded with the record's coordinates and address.
 *
 * The address parameter is `addr`, NOT `address`: that is the name /report
 * actually reads (app/report/page.tsx, `searchParams.get("addr")`), and it is
 * what every other instant link in this repo already emits (lib/vacancy-
 * spreadsheet.ts, components/map/MapPolygonPanel.tsx). Coordinates are fixed to
 * 5 decimals for the same reason those do: it keeps the URL cache-bucketable.
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
