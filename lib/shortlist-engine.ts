/**
 * SHORTLIST ENGINE — the full-universe, criteria-relative ranking engine
 * that replaces the old capped-`sitePoints`, always-on-scoring, 12/8-tier
 * design (see lib/site-shortlist.ts's PR1-era header for that history, and
 * the PR2 build spec / gpt5.6 matchmaker consult for why it had to go).
 *
 * REVISED after the PR2 adversarial review (FIX-FIRST, findings 1-12). The
 * changes from the first PR2 cut, in one place:
 *   - Finding 1: the invented "baseline" (always-on sweet-spot + PIN/
 *     measurement/zoning/owner-confidence points) is GONE. It restored
 *     always-on scoring by another name and made PIN/measurement — which
 *     the funnel calls diagnostics — silently change top-20 membership by
 *     moving order. Ordering is now: score from the SELECTED scoring
 *     criteria only (v1: transit proximity), tiebreak on canonicalKey.
 *     When no scoring criterion is selected, every candidate scores 0 and
 *     the order is simply canonicalKey ascending — accepted as correct,
 *     not defended as a feature.
 *   - Finding 2: the criterion registry (lib/shortlist-criteria.ts) is now
 *     the actual source of the screen/score DISPATCH, not just UI copy —
 *     see `SCREEN_HANDLERS`/`SCORE_CRITERION_IDS` and the coverage
 *     assertions below, which throw at module load if the registry and the
 *     engine's own handler tables ever disagree.
 *   - Finding 3: footprint screening now resolves the measured area from
 *     the REQUESTED property type, not the row's single resolved
 *     `propertyType` — a site admitted into a LAND search via
 *     `hasVacantLandEvidence` is screened on `lotSqft`, even when its
 *     resolved type is "vacant_building" (building evidence wins
 *     resolution whenever both are present — see lib/canonical-sites.ts).
 *   - Finding 6: the zero-result funnel's first stage now reads the
 *     universe file's RAW, pre-dedup `counts.sourceRecordsByEvidenceType`
 *     (schema v2) instead of repeating the post-dedup canonical count
 *     under a second label.
 *   - Finding 8: a selected CTA/Metra criterion whose station SOURCE failed
 *     to load (empty, not "no nearby stations") is surfaced as
 *     `railDataUnavailable`, which the page treats as fail-closed — never
 *     silently ranked as if the criterion had not been selected.
 *   - Finding 9: PMD no longer reads "not broadly aligned" for any project
 *     use, including production-manufacturing, which the Chicago ordinance
 *     defines PMDs to encourage. It shares the site-specific badge with PD,
 *     with its own honest, non-predictive card sentence.
 *   - Finding 11: display-only geometry (nearest school/library, expressway
 *     proximity, nearest-rail-when-not-scored) is computed in a SEPARATE
 *     pass, `decorateShortlistDisplayFacts`, that the page calls only AFTER
 *     slicing to the rendered top 20 — not for the full screened universe.
 *
 * PURE. No fs, no Next runtime, no network — every input (the canonical
 * universe rows, the wizard criteria, rail stations, amenity points, and the
 * committed per-ZIP context snapshot) is plain data the server page reads
 * and hands in.
 *
 * DETERMINISM: score descending, canonicalKey ascending as the final
 * tiebreak — never address, which is not unique.
 */

import type { EvidenceType, ShortlistUniverseRow } from "./shortlist-universe-schema";
import type { SiteMatchCriteria, SiteProjectUse } from "./site-matchmaker";
import { shortlistCriteriaByBehavior } from "./shortlist-criteria";
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
 * schema that happens to reject anything else). This is a DATA-compatibility
 * check (does the loaded file's ranking-inputs shape match what this engine
 * expects) — distinct from Finding 5's `sm_rv` REQUEST-versioning check in
 * lib/site-matchmaker.ts (does this URL's ranking semantics predate a change
 * a reader might not know about). Bumped to 2 alongside
 * `RANKING_INPUTS_VERSION` for the algorithm changes in this review round.
 */
export const RANKING_MODEL_VERSION = 2;

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
  /** The universe file's `counts.sourceRecordsByEvidenceType` (schema v2,
   *  Finding 6) — the RAW, pre-dedup record tally the funnel's first stage
   *  now reads, distinct from the post-dedup canonical-site count. */
  sourceRecordsByEvidenceType: Readonly<Record<EvidenceType, number>>;
}

// ── Overlays (retain names — Finding 12) ─────────────────────────────────────

export interface OverlayMembership {
  present: boolean;
  name: string | null;
}

export interface CandidateOverlays {
  ssa: OverlayMembership;
  ccsa: OverlayMembership;
  tif: OverlayMembership;
  nof: OverlayMembership;
}

// ── Zoning badge ─────────────────────────────────────────────────────────────

export type ZoningBadge = "aligned" | "not-aligned" | "planned-development" | "unresolved";

export const ZONING_BADGE_LABELS: Readonly<Record<ZoningBadge, string>> = {
  aligned: "Broad family alignment",
  "not-aligned": "No broad family alignment",
  // Broadened in the adversarial-review fix round (Finding 9) to cover BOTH
  // Planned Development ("PD") and Planned Manufacturing District ("PMD")
  // — see zoningBadgeFor/zoningBadgeNote below for why PMD can no longer
  // share the "not-aligned" badge.
  "planned-development": "Site-specific district (PD/PMD)",
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
 * Which broad badge a resolved district earns for a project use.
 *
 * Finding 9 fix: PD and PMD ("Planned Manufacturing District") both earn
 * the neutral, site-specific badge — NEITHER "aligned" (this screen cannot
 * read a site-specific ordinance) NOR "not-aligned" (which the pre-fix
 * version asserted for every PMD, including for production-manufacturing —
 * false: Chicago's own ordinance defines PMDs specifically to foster
 * manufacturing and industrial investment, §17-6-0401-A). The badge and its
 * card copy (`zoningBadgeNote`) never predict an approval path for either.
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

  // Both site-specific district types (PD and PMD) share one neutral badge.
  // "PD" and "PMD" are the only two prefixes reaching this branch, and
  // neither is a prefix of the other ("PMD" does not start with "PD"), so
  // this single check is unambiguous.
  if (code.startsWith("PD") || code.startsWith("PMD")) return "planned-development";
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

/**
 * The per-card sentence, matched to the badge. Verbatim per the PR2 spec —
 * NO Special-Use prediction, NO "3-5 months", NO blanket ZBA routing. The
 * "planned-development" badge takes the district CODE so it can give PD and
 * PMD their own honest, non-predictive sentences while sharing one badge —
 * PMD is not a "Planned Development" and must never be described as one
 * (Finding 9).
 */
export function zoningBadgeNote(badge: ZoningBadge, districtCode?: string | null): string {
  switch (badge) {
    case "aligned":
      return "The mapped district family is broadly aligned with this project category. Verify the exact use and all applicable standards before relying on this screen.";
    case "not-aligned":
      return "The mapped district family is not broadly aligned with this project category. The required approval path has not been determined.";
    case "planned-development": {
      const code = districtCode?.trim().toUpperCase() ?? "";
      if (code.startsWith("PMD")) {
        return "Planned Manufacturing District — a site-specific industrial/manufacturing district under its own sub-area regulations. Review the controlling PMD standards; this screen does not predict which uses or approvals apply.";
      }
      return "Site-specific Planned Development. Review the controlling PD ordinance and applicable site-plan requirements.";
    }
    case "unresolved":
      return "District unresolved; no zoning screen was performed.";
  }
}

// ── Property type / footprint (screens) ─────────────────────────────────────

/**
 * The measured area a candidate is screened on — resolved from the
 * REQUESTED property type, never the row's single resolved `propertyType`
 * (Finding 3). A site can be admitted into a search via
 * `hasVacantLandEvidence` while its resolved `propertyType` still reads
 * "vacant_building" (building evidence always wins resolution when a site
 * carries both — see lib/canonical-sites.ts) — screening that row on
 * `buildingSqft` in a LAND search would silently apply the wrong area.
 *
 * For `"either"`, a row is screened on whichever area corresponds to the
 * evidence that made it eligible: building area if it carries building
 * evidence (falling back to lot area if building area itself is
 * unpublished), else lot area.
 */
export function screeningAreaSqft(
  row: ShortlistUniverseRow,
  requestedPropertyType: SiteMatchCriteria["propertyType"],
): number | null {
  let value: number | null;
  if (requestedPropertyType === "existing-building") {
    value = row.buildingSqft;
  } else if (requestedPropertyType === "vacant-land") {
    value = row.lotSqft;
  } else {
    value = row.hasVacantBuildingEvidence ? (row.buildingSqft ?? row.lotSqft) : row.lotSqft;
  }
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
  criteria: Pick<SiteMatchCriteria, "propertyType" | "minSquareFeet" | "maxSquareFeet">,
): boolean {
  const { minSquareFeet: min, maxSquareFeet: max } = criteria;
  if (min == null && max == null) return true;
  const area = screeningAreaSqft(row, criteria.propertyType);
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

// ── Registry-driven dispatch (Finding 2) ─────────────────────────────────────
//
// The criterion registry (lib/shortlist-criteria.ts) is the AUTHORITATIVE
// list of which criteria screen and which score — not a parallel narrative
// that can drift from what this file actually does. `SCREEN_ORDER` and
// `SCORE_CRITERION_IDS` are read directly off the registry's own
// `behavior` field; `assertShortlistDispatchCoverage()` (called once at
// module load, and again directly by a test for a clear failure message)
// throws if the registry and this file's handler tables ever disagree in
// EITHER direction — a registry entry with no handler, or a handler with no
// matching registry entry.

interface ScreenDispatchContext {
  criteria: SiteMatchCriteria;
  network: SelectedTransitNetwork | null;
  screenMeters: number | null;
}

type ScreenHandler = (row: ShortlistUniverseRow, ctx: ScreenDispatchContext) => boolean;

/** One handler per registry SCREEN entry. Each handler is a no-op PASS
 *  (returns true) when its criterion was not actually configured — the
 *  registry entry always runs; whether it has any effect depends on the
 *  request, exactly like every other criterion in this engine. */
const SCREEN_HANDLERS: Readonly<Record<string, ScreenHandler>> = {
  "property-type": (row, ctx) =>
    ctx.criteria.propertyType != null && matchesPropertyTypeEvidence(row, ctx.criteria.propertyType),
  "square-footage": (row, ctx) => passesFootprintScreen(row, ctx.criteria),
  "transportation-distance": (row, ctx) => {
    if (!ctx.network || ctx.screenMeters == null) return true;
    if (row.lat == null || row.lon == null) return false;
    const nearest = nearestStation(row.lat, row.lon, ctx.network.stations);
    return nearest != null && nearest.meters <= ctx.screenMeters;
  },
};

/** Registry-driven screen order — the registry's own SCREEN entries, in
 *  registry order. */
const SCREEN_ORDER: readonly string[] = shortlistCriteriaByBehavior("screen").map((entry) => entry.id);

/** Registry-driven set of criteria that may contribute a score in v1 — read
 *  directly from the registry rather than a hardcoded `["cta-rail",
 *  "metra"]` literal, so a registry change that adds/removes a SCORE
 *  criterion is enforced here, not just documented there. */
const SCORE_CRITERION_IDS: readonly string[] = shortlistCriteriaByBehavior("score").map((entry) => entry.id);

/**
 * Fails loud (throws) if the registry's declared SCREEN/SCORE criteria and
 * this file's actual dispatch tables disagree in either direction. Called
 * once at module load (so any drift breaks the build/first import
 * immediately, never silently) and directly by a dedicated test for a
 * readable failure message.
 */
export function assertShortlistDispatchCoverage(): void {
  for (const id of SCREEN_ORDER) {
    if (!(id in SCREEN_HANDLERS)) {
      throw new Error(`shortlist-engine: registry SCREEN entry "${id}" has no screen handler registered.`);
    }
  }
  for (const id of Object.keys(SCREEN_HANDLERS)) {
    if (!SCREEN_ORDER.includes(id)) {
      throw new Error(`shortlist-engine: screen handler "${id}" has no matching registry SCREEN entry.`);
    }
  }
  // v1 has exactly one scoring implementation — unified transit proximity —
  // which only understands the "cta-rail"/"metra" ids. A registry SCORE
  // entry with any other id would silently score nothing; fail loud instead.
  for (const id of SCORE_CRITERION_IDS) {
    if (id !== "cta-rail" && id !== "metra") {
      throw new Error(
        `shortlist-engine: registry SCORE entry "${id}" has no scoring implementation (only cta-rail/metra transit proximity exists in v1).`,
      );
    }
  }
}
assertShortlistDispatchCoverage();

/** The selected-network station subset — used by BOTH the distance screen
 *  and the proximity score, so the two can never silently disagree about
 *  which stations count. Reads the registry's own SCORE ids
 *  (`SCORE_CRITERION_IDS`) rather than a hardcoded literal, so this stays
 *  registry-driven per Finding 2. `null` when no rail network was selected
 *  — the only condition under which nothing about transit screens or
 *  scores (see `railDataUnavailable` on the engine result for the DIFFERENT
 *  case of a selected-but-unavailable network, Finding 8). */
export function selectedTransitNetwork(
  criteria: Pick<SiteMatchCriteria, "transportation">,
  stations: readonly ShortlistStation[],
): SelectedTransitNetwork | null {
  const cta = SCORE_CRITERION_IDS.includes("cta-rail") && criteria.transportation.includes("cta-rail");
  const metra = SCORE_CRITERION_IDS.includes("metra") && criteria.transportation.includes("metra");
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
 *  fallback to "nearest station on any system". */
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

// ── Display-only facts (computed ONLY post-slice — Finding 11) ─────────────

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

/** Mirrors lib/site-matchmaker-context.ts's `normalizeSiteMatchmakerAddress`
 *  (kept local and re-derived rather than imported so this pure engine never
 *  needs to pull in that module's broader, results-table-shaped surface for
 *  one normalization rule). */
function normalizeContextAddress(address: string | null): string {
  return (
    (address ?? "")
      .toUpperCase()
      .replace(/[^\dA-Z]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "UNKNOWN"
  );
}

// ── Ranked candidate ─────────────────────────────────────────────────────────
//
// NOTE: display-only geometry (nearest rail/school/library, expressway
// proximity) is deliberately NOT part of this type. Those facts live on
// `DecoratedShortlistCandidate` below, produced by
// `decorateShortlistDisplayFacts` — a SEPARATE pass the page runs only on
// the sliced top-N, never on the full screened universe (Finding 11).

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
  /** True when this site carries BOTH land and building evidence (Finding
   *  3) — screened using whichever evidence made it eligible for THIS
   *  search, reported explicitly rather than silently resolved. */
  conflictingPropertyTypes: boolean;
  overlays: CandidateOverlays;
  /** Populated only when a transit need was selected AND this row could be
   *  measured against it — the one v1 score component, also shown on the
   *  card as the reason it ranked where it did. */
  transitScore: TransitScoreFact | null;
  /** The candidate's total score. In v1 this is exactly `transitScore.points`
   *  (0 when no transit criterion was selected, or the row has no
   *  coordinate) — see this file's header: there is no criteria-independent
   *  baseline component (Finding 1). */
  score: number;
}

export interface ShortlistDisplayFacts {
  /** DISPLAY-ONLY nearest-rail fact, populated ONLY when no transit
   *  criterion was selected (so a reader who asked for CTA proximity sees
   *  the scored fact, `transitScore`, above — never both, never neither). */
  nearestRailDisplay: NearestStation | null;
  /** DISPLAY-ONLY. `null` when the committed context snapshot carries no
   *  fact for this row's key — an honest gap, never a fabricated distance. */
  expresswayDisplay: ExpresswayContextFact | null;
  nearestSchool: NearestAmenityFact | null;
  nearestLibrary: NearestAmenityFact | null;
}

export type DecoratedShortlistCandidate = RankedShortlistCandidate & ShortlistDisplayFacts;

// ── Funnel ───────────────────────────────────────────────────────────────────

export interface ShortlistFunnelStats {
  /** RAW, pre-dedup source-record count for the selected property type,
   *  read from the universe file's `counts.sourceRecordsByEvidenceType`
   *  (Finding 6) — genuinely distinct from `canonicalSites` below, so the
   *  funnel can show actual deduplication instead of one number under two
   *  labels. The false-zero guard: this must be > 0 for 60621's building
   *  search even when the ranked list ends up thin. */
  trackedEvidence: number;
  /** Post-dedup canonical sites in this ZIP carrying evidence for the
   *  selected property type. */
  canonicalSites: number;
  /** DIAGNOSTIC ONLY — does not by itself remove a candidate. Shows how much
   *  of the evidence-matched set carries a resolved PIN. */
  withResolvedPin: number;
  /** DIAGNOSTIC ONLY — does not by itself remove a candidate unless a size
   *  band is set (see `insideBand`). Shows how much of the evidence-matched
   *  set carries ANY published measurement (resolved from the REQUESTED
   *  property type, per Finding 3). */
  withMeasuredArea: number;
  /** REAL SCREEN. Equals `canonicalSites` when no band was set (an
   *  unmeasured site is never excluded merely for lacking a measurement
   *  absent a band) — can therefore exceed `withMeasuredArea`, which is the
   *  honest result of it being diagnostic-only. */
  insideBand: number;
  /** REAL SCREEN — the final stage. Equals the ranked-list length. */
  survivingTransitScreen: number;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface ShortlistEngineResult {
  /** The FULL screened, scored, badged, ordered list — no display-only
   *  geometry. The caller slices the top `SHORTLIST_TOP_N` and calls
   *  `decorateShortlistDisplayFacts` on THAT slice only (Finding 11). */
  ranked: RankedShortlistCandidate[];
  funnel: ShortlistFunnelStats;
  /** True when the reader selected a CTA/Metra transit criterion but the
   *  underlying rail-station SOURCE is empty (a load failure — see
   *  lib/rail-stations.ts, which degrades to `[]` rather than throwing),
   *  not merely "no stations happen to be nearby." The page must treat this
   *  as fail-closed, the same as a missing/invalid universe file — never
   *  silently rank as though the criterion had not been selected
   *  (Finding 8). */
  railDataUnavailable: boolean;
}

function trackedEvidenceCount(
  propertyType: SiteMatchCriteria["propertyType"],
  counts: Readonly<Record<EvidenceType, number>>,
): number {
  if (propertyType === "existing-building") return counts["311_building"];
  if (propertyType === "vacant-land") {
    return counts.city_land + counts["311_land"] + counts.assessor_vacant_land;
  }
  if (propertyType === "either") {
    return counts.city_land + counts["311_building"] + counts["311_land"] + counts.assessor_vacant_land;
  }
  return 0;
}

/**
 * Run the full engine: screen, score, badge, and order the complete ZIP
 * universe. Returns EVERY candidate that cleared the screens — the caller
 * (the page) slices the top `SHORTLIST_TOP_N` for rendering, THEN decorates
 * that slice with display-only facts via `decorateShortlistDisplayFacts`
 * (Finding 11) — this function itself does no amenity/expressway geometry
 * at all, so its cost is O(rows) for screening plus O(rows log rows) for
 * the sort, independent of how many display-only points exist.
 */
export function runShortlistEngine(inputs: ShortlistEngineInputs): ShortlistEngineResult {
  const { rows, criteria, stations, sourceRecordsByEvidenceType } = inputs;

  const propertyType = criteria.propertyType;
  const evidenceMatch = propertyType
    ? rows.filter((row) => matchesPropertyTypeEvidence(row, propertyType))
    : [];

  const withResolvedPin = evidenceMatch.filter((row) => row.pin != null).length;
  const withMeasuredArea = propertyType
    ? evidenceMatch.filter((row) => screeningAreaSqft(row, propertyType) != null).length
    : 0;

  const network = selectedTransitNetwork(criteria, stations);
  const screenMeters = transitScreenMeters(criteria);
  const wantsRail = criteria.transportation.includes("cta-rail") || criteria.transportation.includes("metra");
  // A selected network with zero stations of ANY system in the source is a
  // load failure (lib/rail-stations.ts collapses any read/parse failure to
  // `[]`), not "there are legitimately no CTA/Metra stations nearby" — that
  // would still leave `stations` non-empty. Fail closed (Finding 8).
  const railDataUnavailable = wantsRail && stations.length === 0;

  const screenContext: ScreenDispatchContext = { criteria, network, screenMeters };

  // Registry-driven screen pipeline (Finding 2): apply every registry
  // SCREEN entry, in registry order, via its dispatched handler. Each
  // handler is internally a no-op PASS when its criterion is not actually
  // configured (see SCREEN_HANDLERS), so this loop is the complete,
  // authoritative screening pipeline — not a subset hand-picked elsewhere.
  // "property-type" is already applied above (evidenceMatch is also the
  // funnel's own canonicalSites stage), so it is skipped here; the funnel's
  // "insideBand" stage is captured right after "square-footage" runs,
  // before "transportation-distance" narrows further.
  let candidates = evidenceMatch;
  let insideBandCount = evidenceMatch.length;
  for (const id of SCREEN_ORDER) {
    if (id === "property-type") continue;
    const handler = SCREEN_HANDLERS[id];
    candidates = candidates.filter((row) => handler(row, screenContext));
    if (id === "square-footage") insideBandCount = candidates.length;
  }

  const survivingRows = candidates;

  const ranked: RankedShortlistCandidate[] = survivingRows.map((row) => {
    const transitScore = transitScoreFor(row, network);
    const badge = zoningBadgeFor(criteria.projectUse, row.zoning);

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
      badge,
      badgeNote: zoningBadgeNote(badge, row.zoning.district),
      ownerLabel: ownerAxesLabel(row.ownerStructure ?? "unresolved", row.ownerGeography ?? "unknown"),
      incentiveCount: row.incentiveCount ?? 0,
      saleYear: row.saleYear,
      violation: row.violation,
      conflictingPropertyTypes: row.conflictingPropertyTypes,
      overlays: { ...row.overlays },
      transitScore,
      score: transitScore?.points ?? 0,
    };
  });

  ranked.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    ranked,
    funnel: {
      trackedEvidence: propertyType ? trackedEvidenceCount(propertyType, sourceRecordsByEvidenceType) : 0,
      canonicalSites: evidenceMatch.length,
      withResolvedPin,
      withMeasuredArea,
      insideBand: insideBandCount,
      survivingTransitScreen: survivingRows.length,
    },
    railDataUnavailable,
  };
}

// ── Display-fact decoration (POST-SLICE ONLY — Finding 11) ──────────────────

export interface ShortlistDisplayInputs {
  stations: readonly ShortlistStation[];
  network: SelectedTransitNetwork | null;
  expresswayContextByKey?: ReadonlyMap<string, ExpresswayContextFact>;
  schoolPoints?: readonly AmenityPoint[];
  libraryPoints?: readonly AmenityPoint[];
}

/**
 * Adds the display-only facts (nearest rail when not scored, expressway
 * proximity, nearest school, nearest library) to an ALREADY-SLICED list of
 * candidates. Callers MUST slice to `SHORTLIST_TOP_N` (or fewer) before
 * calling this — it is the only function in this module that runs the
 * amenity nearest-point loops, and it runs them once per candidate passed
 * in, with no internal cap. Calling it on the full screened universe (up to
 * several thousand rows for the largest committed ZIP) is exactly the
 * performance regression Finding 11 flagged.
 */
export function decorateShortlistDisplayFacts(
  candidates: readonly RankedShortlistCandidate[],
  inputs: ShortlistDisplayInputs,
): DecoratedShortlistCandidate[] {
  const expresswayContextByKey = inputs.expresswayContextByKey ?? new Map<string, ExpresswayContextFact>();
  const schoolPoints = inputs.schoolPoints ?? [];
  const libraryPoints = inputs.libraryPoints ?? [];

  return candidates.map((candidate) => {
    const nearestRailDisplay = inputs.network
      ? null
      : candidate.lat != null && candidate.lon != null
        ? nearestStation(candidate.lat, candidate.lon, inputs.stations)
        : null;

    const contextKey =
      candidate.pin != null
        ? `pin:${candidate.pin}`
        : candidate.lat != null && candidate.lon != null
          ? `coord:${candidate.lat.toFixed(6)},${candidate.lon.toFixed(6)}|addr:${normalizeContextAddress(candidate.address)}`
          : null;
    const expresswayDisplay = contextKey ? (expresswayContextByKey.get(contextKey) ?? null) : null;

    const nearestSchool =
      candidate.lat != null && candidate.lon != null
        ? nearestAmenityPoint(candidate.lat, candidate.lon, schoolPoints)
        : null;
    const nearestLibrary =
      candidate.lat != null && candidate.lon != null
        ? nearestAmenityPoint(candidate.lat, candidate.lon, libraryPoints)
        : null;

    return { ...candidate, nearestRailDisplay, expresswayDisplay, nearestSchool, nearestLibrary };
  });
}
