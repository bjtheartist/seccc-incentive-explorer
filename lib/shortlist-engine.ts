/**
 * SHORTLIST ENGINE — the full-universe, criteria-relative ranking engine
 * that replaces the old capped-`sitePoints`, always-on-scoring, 12/8-tier
 * design (see lib/site-shortlist.ts's PR1-era header for that history, and
 * the PR2 build spec / gpt5.6 matchmaker consult for why it had to go).
 *
 * PURE. No fs, no Next runtime, no network — every input (the canonical
 * universe rows, the wizard criteria, rail stations, amenity points, and the
 * committed per-ZIP context snapshot) is plain data the server page reads
 * and hands in. This is what makes the exhaustive brute-force oracle test
 * possible: the same function the page calls in production is the function
 * a unit test calls against a hand-built fixture.
 *
 * THREE REAL SCREENS (drop a candidate from the ranked list entirely):
 *   1. Property type, by EVIDENCE FIELD (`hasVacantBuildingEvidence` /
 *      `hasVacantLandEvidence`) — never by a single resolved
 *      `propertyType` string, which would silently lose a site's other
 *      evidence type.
 *   2. The measured-area band, and ONLY when the reader actually set a
 *      minimum or maximum — an unmeasured site is excluded once a band is
 *      set (a size band asserts a size), but is NEVER excluded merely for
 *      lacking a measurement when no band was set.
 *   3. The selected CTA/Metra network's distance cutoff — screening against
 *      the network(s) the reader actually picked, never against "any rail".
 *
 * A resolved PIN and a published measurement are surfaced as FUNNEL
 * diagnostics (so a reader can see how much of the field lacks them) but are
 * NOT screens in v1 — dropping that requirement is what actually fixes the
 * 60621 false-zero (1,541 tracked buildings, most with no PIN yet), not just
 * explains it away.
 *
 * ONE SCORE COMPONENT IN v1: transit proximity, and only when a transit need
 * (CTA rail and/or Metra) was selected — scored against the selected
 * network(s) only. Every other candidate fact (expressway proximity,
 * school/library distance, overlays, incentive count, distress flags) is
 * measured and shown but never moves a candidate's score or membership —
 * see lib/shortlist-criteria.ts for the full registry this engine and the
 * UI both read.
 *
 * BASELINE ORDERING is a small, criteria-INDEPENDENT quality signal applied
 * to every candidate regardless of what the reader selected (so the list has
 * a deterministic order even when zero scoring criteria are selected): fit
 * to the size-band midpoint, plus a few completeness points (PIN, measured
 * area, resolved zoning) rewarding records that are actually usable. It is
 * documented, small relative to the transit score, and — per the whole point
 * of this rewrite — the SAME for every candidate regardless of which
 * criteria were picked.
 *
 * DETERMINISM: score descending, canonicalKey ascending as the final
 * tiebreak — never address, which is not unique.
 */

import type { ShortlistUniverseRow } from "./shortlist-universe-schema";
import type { SiteMatchCriteria, SiteProjectUse } from "./site-matchmaker";
import {
  approxDistanceMeters,
  isCtaStation,
  isMetraStation,
  nearestStation,
  ownerAxesLabel,
  type NearestStation,
  type ShortlistStation,
} from "./site-shortlist";

// ── Ranking model version ───────────────────────────────────────────────────

/**
 * Bumped whenever the screen/score/badge rules in this file change in a way
 * that would make an old cached or shared shortlist URL misleading. Checked
 * against the universe file's own `rankingInputsVersion` (already validated
 * by zod as a schema literal — this is a second, explicit, page-level check
 * so the contract is testable and documented here, not just implied by a
 * schema that happens to reject anything else).
 */
export const RANKING_MODEL_VERSION = 1;

/** How many ranked candidates the page ever renders. Replaces the old
 *  TIER_1_CAP (12) + TIER_2_CAP (8) split with one flat cap — see the PR2
 *  spec's "one ranked list, no tier quotas" section. */
export const SHORTLIST_TOP_N = 20;

// ── Amenity / context display-only inputs ───────────────────────────────────

export interface AmenityPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface ExpresswayContextFact {
  name: string | null;
  miles: number | null;
}

export interface ShortlistEngineInputs {
  rows: readonly ShortlistUniverseRow[];
  criteria: SiteMatchCriteria;
  stations: readonly ShortlistStation[];
  /** DISPLAY-ONLY. Keyed by the same `siteMatchmakerContextKey` convention
   *  lib/site-matchmaker-context.ts already uses (`pin:<pin>` when a PIN is
   *  known, else `coord:<lat,lon>|addr:<normalized address>`), so the
   *  committed public/data/site-matchmaker-context/<zip>.json snapshot can be
   *  joined without inventing a second key scheme. Absent/empty is a valid,
   *  honest "no expressway fact available" state — never fabricated. */
  expresswayContextByKey?: ReadonlyMap<string, ExpresswayContextFact>;
  /** DISPLAY-ONLY. The same committed point files the map's infrastructure
   *  lens fetches (public/data/school-points.json, library-points.json). */
  schoolPoints?: readonly AmenityPoint[];
  libraryPoints?: readonly AmenityPoint[];
}

// ── Zoning badge ─────────────────────────────────────────────────────────────

export type ZoningBadge = "aligned" | "not-aligned" | "planned-development" | "unresolved";

export const ZONING_BADGE_LABELS: Readonly<Record<ZoningBadge, string>> = {
  aligned: "Broad family alignment",
  "not-aligned": "No broad family alignment",
  "planned-development": "Site-specific district (PD)",
  unresolved: "District unresolved",
};

/** Page-level copy, verbatim per the PR2 spec (itself the consult's Q5
 *  correction of the old "compatibility screen" over-claim). Rendered once,
 *  above every result. */
export const ZONING_SCREENING_NOTE =
  "Broad district-family screen. Based only on the mapped zoning district and broad project category. This tool has not evaluated the ordinance use table, use-specific standards, overlays, the controlling Planned Development ordinance, existing approvals or legal nonconforming rights, or pending changes. It does not determine whether the proposed use is permitted or which approval path applies.";

/** Trailing `-N` (or `-N.N`) intensity suffix of a Chicago district code
 *  (B3-2 -> 2). Ported unchanged from the pre-PR2 by-right matrix. */
function districtIntensity(code: string): number | null {
  const match = /-(\d+(?:\.\d+)?)$/.exec(code);
  return match ? Number(match[1]) : null;
}

/**
 * Which broad badge a resolved district earns for a project use. Ported
 * from the pre-PR2 `zoningStatusFor` family matrix (well-tested; kept
 * unchanged) with ONE addition: a bare "PD" prefix (Planned Development —
 * distinct from "PMD", Planned Manufacturing District, which still falls
 * through to "not-aligned" exactly as before) now earns its own badge
 * instead of being folded into "relief-likely" copy the PR2 spec retires.
 *
 * Reads ONLY `zoning.status`/`zoning.district` off the universe row —
 * PR1's export-time zoning fields — never a request-time lookup (see the
 * PR2 spec's "no request-time zoning in the selection path" rule).
 */
export function zoningBadgeFor(
  projectUse: SiteProjectUse | null,
  zoning: { status: "resolved" | "unresolved" | "ambiguous"; district: string | null },
): ZoningBadge {
  if (zoning.status !== "resolved") return "unresolved";
  const code = zoning.district?.trim().toUpperCase() ?? "";
  if (!code) return "unresolved";

  if (code.startsWith("PD") && !code.startsWith("PMD")) return "planned-development";
  // PMD's whole purpose is to exclude the non-industrial uses this wizard
  // mostly collects — it never reads as aligned, for any project use. It
  // also never matches the M*/C3* production check below (PMD doesn't
  // start with "M"), so this branch is a defensive early exit, not a
  // silent fallthrough that depends on that fact staying true.
  if (code.startsWith("PMD")) return "not-aligned";
  if (!projectUse) return "not-aligned";

  const commercial = code.startsWith("B") || code.startsWith("C");

  switch (projectUse) {
    case "retail-service":
    case "food-hospitality":
    case "office-professional":
    case "community-facility":
    case "other-commercial":
      return commercial ? "aligned" : "not-aligned";
    case "production-manufacturing":
    case "distribution-logistics":
      return code.startsWith("M") || code.startsWith("C3") ? "aligned" : "not-aligned";
    case "housing-mixed-use": {
      if (code.startsWith("R") || code.startsWith("D")) return "aligned";
      if (code.startsWith("B")) {
        const intensity = districtIntensity(code);
        return intensity != null && intensity >= 2 ? "aligned" : "not-aligned";
      }
      return "not-aligned";
    }
  }
}

/** The per-card sentence, matched to the badge. Verbatim per the PR2 spec —
 *  NO Special-Use prediction, NO "3-5 months", NO blanket ZBA routing
 *  (removed relative to the pre-PR2 copy; ZBA is not named anywhere here). */
export function zoningBadgeNote(badge: ZoningBadge): string {
  switch (badge) {
    case "aligned":
      return "The mapped district family is broadly aligned with this project category. Verify the exact use and all applicable standards before relying on this screen.";
    case "not-aligned":
      return "The mapped district family is not broadly aligned with this project category. The required approval path has not been determined.";
    case "planned-development":
      return "Site-specific Planned Development. Review the controlling PD ordinance and applicable site-plan requirements.";
    case "unresolved":
      return "District unresolved; no zoning screen was performed.";
  }
}

// ── Property type / footprint (screens) ─────────────────────────────────────

/** The measured area a candidate is ranked on: assessor building area for a
 *  resolved building, lot area for a resolved land site. */
export function screeningAreaSqft(row: ShortlistUniverseRow): number | null {
  const value = row.propertyType === "vacant_building" ? row.buildingSqft : row.lotSqft;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Evidence-field property-type match — the ONLY property-type screen in
 *  v1. Reads the two independent evidence booleans, never the single
 *  resolved `propertyType` string, so a site is not silently dropped for
 *  carrying the "wrong" resolved type while still holding the evidence the
 *  reader asked about. */
export function matchesPropertyTypeEvidence(
  row: ShortlistUniverseRow,
  propertyType: SiteMatchCriteria["propertyType"],
): boolean {
  if (propertyType === "existing-building") return row.hasVacantBuildingEvidence;
  if (propertyType === "vacant-land") return row.hasVacantLandEvidence;
  if (propertyType === "either") return row.hasVacantBuildingEvidence || row.hasVacantLandEvidence;
  return false;
}

/** The size-band screen. A closed band with no measurement present is a
 *  fail — a card asserts a size — but with NO band set, an unmeasured site
 *  is never excluded on that basis alone (per the PR2 spec's explicit
 *  carve-out). */
export function passesFootprintScreen(
  row: ShortlistUniverseRow,
  criteria: Pick<SiteMatchCriteria, "minSquareFeet" | "maxSquareFeet">,
): boolean {
  const { minSquareFeet: min, maxSquareFeet: max } = criteria;
  if (min == null && max == null) return true;
  const area = screeningAreaSqft(row);
  if (area == null) return false;
  if (min != null && area < min) return false;
  if (max != null && area > max) return false;
  return true;
}

// ── Transit (screen + the one v1 score component) ───────────────────────────

const TRANSPORTATION_DISTANCE_METERS: Record<
  NonNullable<SiteMatchCriteria["transportationDistance"]>,
  number | null
> = {
  flexible: null,
  "quarter-mile": 400,
  "half-mile": 800,
  "one-mile": 1600,
};

/** The score decays to zero at this distance — the largest configurable
 *  wizard band (one mile), so the score can differentiate candidates across
 *  the reader's FULL selectable range instead of flattening out well inside
 *  it. A deliberate judgment call: the pre-PR2 engine fixed this horizon at
 *  800 m regardless of the reader's selection. */
const TRANSIT_SCORE_HORIZON_M = 1600;
const TRANSIT_SCORE_WEIGHT = 40;

export interface SelectedTransitNetwork {
  networks: ("cta-rail" | "metra")[];
  stations: ShortlistStation[];
}

/** The selected-network station subset — used by BOTH the distance screen
 *  and the proximity score, so the two can never silently disagree about
 *  which stations count. `null` when no rail network was selected, which is
 *  the only condition under which nothing about transit screens or scores. */
export function selectedTransitNetwork(
  criteria: Pick<SiteMatchCriteria, "transportation">,
  stations: readonly ShortlistStation[],
): SelectedTransitNetwork | null {
  const cta = criteria.transportation.includes("cta-rail");
  const metra = criteria.transportation.includes("metra");
  if (!cta && !metra) return null;
  const subset = stations.filter(
    (station) => (cta && isCtaStation(station)) || (metra && isMetraStation(station)),
  );
  if (subset.length === 0) return null;
  const networks: ("cta-rail" | "metra")[] = [];
  if (cta) networks.push("cta-rail");
  if (metra) networks.push("metra");
  return { networks, stations: subset };
}

/** Metres for the selected distance option, or `null` when no distance
 *  screen applies (flexible, or no distance chosen at all). */
export function transitScreenMeters(
  criteria: Pick<SiteMatchCriteria, "transportationDistance">,
): number | null {
  const distance = criteria.transportationDistance;
  if (!distance) return null;
  return TRANSPORTATION_DISTANCE_METERS[distance];
}

export function passesTransitScreen(
  row: ShortlistUniverseRow,
  network: SelectedTransitNetwork,
  screenMeters: number,
): boolean {
  if (row.lat == null || row.lon == null) return false;
  const nearest = nearestStation(row.lat, row.lon, network.stations);
  return nearest != null && nearest.meters <= screenMeters;
}

export interface TransitScoreFact {
  networks: ("cta-rail" | "metra")[];
  stationName: string;
  stationSystem: string;
  meters: number;
  walkMinutes: number;
  points: number;
}

/** The single v1 SCORE component: proximity to the nearest station on the
 *  SELECTED network(s) only. `null` (zero points, zero effect) whenever no
 *  transit need was selected or the row has no usable coordinate — never a
 *  fallback to "nearest station on any system", which is exactly the
 *  criteria-irrelevance the consult flagged in the pre-PR2 engine. */
export function transitScoreFor(
  row: ShortlistUniverseRow,
  network: SelectedTransitNetwork | null,
): TransitScoreFact | null {
  if (!network) return null;
  if (row.lat == null || row.lon == null) return null;
  const nearest = nearestStation(row.lat, row.lon, network.stations);
  if (!nearest) return null;
  const points =
    (Math.max(0, TRANSIT_SCORE_HORIZON_M - nearest.meters) / TRANSIT_SCORE_HORIZON_M) *
    TRANSIT_SCORE_WEIGHT;
  return {
    networks: network.networks,
    stationName: nearest.name,
    stationSystem: nearest.system,
    meters: nearest.meters,
    walkMinutes: nearest.walkMinutes,
    points: Math.round(points * 100) / 100,
  };
}

// ── Baseline (criteria-independent) ordering ─────────────────────────────────

const DEFAULT_SWEET_SPOT_MIDPOINT_SQFT = 5250; // midpoint of the reference 2,500-8,000 sqft band

/** The size-band midpoint a candidate is scored against for the baseline
 *  "area fit" component. Falls back to the reference default when the
 *  reader left the band open on one or both ends — documented, not hidden:
 *  a lone minimum is read as "the sweet spot sits 50% above the floor", a
 *  lone maximum as "40% below the ceiling", matching the pre-PR2 engine's
 *  40-80%-of-band convention applied to a single bound instead of a pair. */
function sizeBandMidpoint(criteria: Pick<SiteMatchCriteria, "minSquareFeet" | "maxSquareFeet">): number {
  const { minSquareFeet: min, maxSquareFeet: max } = criteria;
  if (min != null && max != null && max > min) return min + (max - min) * 0.6;
  if (min != null) return min * 1.5;
  if (max != null) return max * 0.6;
  return DEFAULT_SWEET_SPOT_MIDPOINT_SQFT;
}

export interface BaselineScoreFact {
  areaFitPoints: number;
  completenessPoints: number;
  total: number;
}

/**
 * The deterministic, criteria-INDEPENDENT floor every candidate gets,
 * regardless of which (if any) scoring criteria the reader selected — see
 * this file's header. Two small, documented components:
 *   - area fit: how close the candidate's measured area sits to the
 *     size-band midpoint (0 when unmeasured — no credit for what is not
 *     known, no penalty beyond that).
 *   - completeness: a record with more of the facts a shortlist card needs
 *     (PIN, a measurement, resolved zoning) is more useful to act on than
 *     one missing them, independent of anything the reader asked for.
 * Max ~30 points, deliberately small next to the ~40-point transit score so
 * a selected criterion still dominates the order when one is picked.
 */
export function baselineScoreFor(
  row: ShortlistUniverseRow,
  criteria: Pick<SiteMatchCriteria, "minSquareFeet" | "maxSquareFeet">,
): BaselineScoreFact {
  const area = screeningAreaSqft(row);
  const midpoint = sizeBandMidpoint(criteria);
  const areaFitPoints =
    area == null || midpoint <= 0
      ? 0
      : Math.max(0, 20 - Math.min(20, (Math.abs(area - midpoint) / midpoint) * 20));

  const completenessPoints =
    (row.pin != null ? 3 : 0) +
    (area != null ? 3 : 0) +
    (row.zoning.status === "resolved" ? 2 : 0) +
    (row.ownerConfidence === "pin_matched" ? 2 : 0);

  return {
    areaFitPoints: Math.round(areaFitPoints * 100) / 100,
    completenessPoints,
    total: Math.round((areaFitPoints + completenessPoints) * 100) / 100,
  };
}

// ── Display-only facts ───────────────────────────────────────────────────────

export interface NearestAmenityFact {
  name: string;
  meters: number;
}

function nearestAmenityPoint(
  lat: number,
  lon: number,
  points: readonly AmenityPoint[],
): NearestAmenityFact | null {
  let best: NearestAmenityFact | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const meters = Math.round(approxDistanceMeters(lat, lon, point.lat, point.lon));
    if (best === null || meters < best.meters) best = { name: point.name, meters };
  }
  return best;
}

// ── Ranked candidate ─────────────────────────────────────────────────────────

export interface RankedShortlistCandidate {
  key: string;
  address: string;
  pin: string | null;
  lat: number | null;
  lon: number | null;
  propertyType: "vacant_building" | "vacant_land";
  buildingSqft: number | null;
  lotSqft: number | null;
  zoningDistrict: string | null;
  zoningStatus: "resolved" | "unresolved" | "ambiguous";
  badge: ZoningBadge;
  badgeNote: string;
  ownerLabel: string;
  incentiveCount: number;
  saleYear: number | null;
  violation: boolean;
  overlays: { ssa: boolean; ccsa: boolean; tif: boolean; nof: boolean };
  /** Populated only when a transit need was selected AND this row could be
   *  measured against it — the one v1 score component, also shown on the
   *  card as the reason it ranked where it did. */
  transitScore: TransitScoreFact | null;
  /** DISPLAY-ONLY nearest-rail fact, populated ONLY when no transit
   *  criterion was selected (so a reader who asked for CTA proximity sees
   *  the scored fact, `transitScore`, above — never both, never neither). */
  nearestRailDisplay: NearestStation | null;
  /** DISPLAY-ONLY. `null` when the committed context snapshot carries no
   *  fact for this row's key — an honest gap, never a fabricated distance. */
  expresswayDisplay: ExpresswayContextFact | null;
  nearestSchool: NearestAmenityFact | null;
  nearestLibrary: NearestAmenityFact | null;
  score: number;
  baseline: BaselineScoreFact;
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export interface ShortlistFunnelStats {
  /** Canonical sites in this ZIP carrying evidence for the selected
   *  property type. The false-zero guard: this must be > 0 for 60621's
   *  building search even when the ranked list ends up thin. */
  trackedEvidence: number;
  /** Same set, restated as "canonical" — the universe is already deduped,
   *  so this equals trackedEvidence today; kept as its own funnel stage so
   *  a future export that changes that invariant is visible here, not
   *  silently absorbed into one number. */
  canonicalSites: number;
  /** DIAGNOSTIC ONLY — does not by itself remove a candidate. Shows how much
   *  of the evidence-matched set carries a resolved PIN. */
  withResolvedPin: number;
  /** DIAGNOSTIC ONLY — does not by itself remove a candidate unless a size
   *  band is set (see `insideBand`). Shows how much of the evidence-matched
   *  set carries ANY published measurement. */
  withMeasuredArea: number;
  /** REAL SCREEN. Equals `trackedEvidence` when no band was set (an
   *  unmeasured site is never excluded merely for lacking a measurement
   *  absent a band) — can therefore exceed `withMeasuredArea`, which is the
   *  honest result of it being diagnostic-only. */
  insideBand: number;
  /** REAL SCREEN — the final stage. Equals the ranked-list length. */
  survivingTransitScreen: number;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface ShortlistEngineResult {
  ranked: RankedShortlistCandidate[];
  funnel: ShortlistFunnelStats;
}

/**
 * Run the full engine: screen, score, badge, and order the complete ZIP
 * universe. Returns EVERY candidate that cleared the screens — the caller
 * (the page) slices the top `SHORTLIST_TOP_N` for rendering; tests exercise
 * the full ordering to check determinism and criteria-relativity without
 * needing 20+ fixture rows.
 */
export function runShortlistEngine(inputs: ShortlistEngineInputs): ShortlistEngineResult {
  const { rows, criteria, stations } = inputs;
  const expresswayContextByKey = inputs.expresswayContextByKey ?? new Map<string, ExpresswayContextFact>();
  const schoolPoints = inputs.schoolPoints ?? [];
  const libraryPoints = inputs.libraryPoints ?? [];

  const propertyType = criteria.propertyType;
  const evidenceMatch = propertyType
    ? rows.filter((row) => matchesPropertyTypeEvidence(row, propertyType))
    : [];

  const withResolvedPin = evidenceMatch.filter((row) => row.pin != null).length;
  const withMeasuredArea = evidenceMatch.filter((row) => screeningAreaSqft(row) != null).length;

  const insideBandRows = evidenceMatch.filter((row) => passesFootprintScreen(row, criteria));

  const network = selectedTransitNetwork(criteria, stations);
  const screenMeters = transitScreenMeters(criteria);
  const runsTransitScreen = network != null && screenMeters != null;

  const survivingRows = runsTransitScreen
    ? insideBandRows.filter((row) => passesTransitScreen(row, network!, screenMeters!))
    : insideBandRows;

  const ranked: RankedShortlistCandidate[] = survivingRows.map((row) => {
    const baseline = baselineScoreFor(row, criteria);
    const transitScore = transitScoreFor(row, network);
    const nearestRailDisplay = network ? null : nearestStation(row.lat ?? NaN, row.lon ?? NaN, stations);

    const contextKey =
      row.pin != null
        ? `pin:${row.pin}`
        : row.lat != null && row.lon != null
          ? `coord:${row.lat.toFixed(6)},${row.lon.toFixed(6)}|addr:${normalizeContextAddress(row.address)}`
          : null;
    const expresswayDisplay = contextKey ? (expresswayContextByKey.get(contextKey) ?? null) : null;

    const nearestSchool =
      row.lat != null && row.lon != null ? nearestAmenityPoint(row.lat, row.lon, schoolPoints) : null;
    const nearestLibrary =
      row.lat != null && row.lon != null ? nearestAmenityPoint(row.lat, row.lon, libraryPoints) : null;

    return {
      key: row.canonicalKey,
      address: row.address ?? "Address not published",
      pin: row.pin,
      lat: row.lat,
      lon: row.lon,
      propertyType: row.propertyType,
      buildingSqft: row.buildingSqft,
      lotSqft: row.lotSqft,
      zoningDistrict: row.zoning.district,
      zoningStatus: row.zoning.status,
      badge: zoningBadgeFor(criteria.projectUse, row.zoning),
      badgeNote: zoningBadgeNote(zoningBadgeFor(criteria.projectUse, row.zoning)),
      ownerLabel: ownerAxesLabel(row.ownerStructure ?? "unresolved", row.ownerGeography ?? "unknown"),
      incentiveCount: row.incentiveCount ?? 0,
      saleYear: row.saleYear,
      violation: row.violation,
      overlays: { ...row.overlays },
      transitScore,
      nearestRailDisplay,
      expresswayDisplay,
      nearestSchool,
      nearestLibrary,
      score: Math.round((baseline.total + (transitScore?.points ?? 0)) * 100) / 100,
      baseline,
    };
  });

  ranked.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    ranked,
    funnel: {
      trackedEvidence: evidenceMatch.length,
      canonicalSites: evidenceMatch.length,
      withResolvedPin,
      withMeasuredArea,
      insideBand: insideBandRows.length,
      survivingTransitScreen: survivingRows.length,
    },
  };
}

/** Mirrors lib/site-matchmaker-context.ts's `normalizeSiteMatchmakerAddress`
 *  (kept local and re-derived rather than imported so this pure engine never
 *  needs to pull in that module's broader, results-table-shaped surface for
 *  one normalization rule). */
function normalizeContextAddress(address: string | null): string {
  return (address ?? "")
    .toUpperCase()
    .replace(/[^\dA-Z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "UNKNOWN";
}
