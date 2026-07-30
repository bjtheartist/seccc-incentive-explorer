/**
 * Case Workbench — CLIENT-SAFE case model (no fs). Mirrors the
 * lib/vacancy-portfolio.ts precedent: the server record loader
 * (lib/vacancy-cases-data.ts) re-exports everything here, so server code can
 * import from either module, while this module stays free of node:fs and the
 * vacancy-index loader — keeping it importable from a client component and
 * testable without a filesystem.
 *
 * A "case" is a decision the user is trying to move forward. Each case is a
 * pure PREDICATE over the tracked record set plus fixed editorial copy
 * (name / definition / caveat). Counts are derived, never stored: every
 * number on the workbench is recomputable from the same records.
 *
 * Honesty rails (shared with the rest of the vacancy section):
 *  - Records carry owner CATEGORIES only — never a name, taxpayer, or mailing
 *    address. The VacancyCaseRecord shape has no field for one, and the unit
 *    tests string-assert that no name-bearing key ever appears.
 *  - Land (the reconciled land universe) and reported buildings (the 311
 *    universe) stay two distinct universes: a case reports a land count and a
 *    building count, never a single summed total across the two.
 *  - Every case count is checkable against a STATED denominator: deriveCase
 *    Universe reports the two universe totals, the page prints them, and the
 *    tests bind the land total to the report's own deriveLandUniverse figure.
 *    Without the denominator on the page a reader benchmarks the counts against
 *    the only other published list (the per-ZIP directory file, which is the
 *    tracked COLS+311 operational list, NOT the land universe) and reasonably
 *    concludes a correct count is impossible.
 *  - The map preview shows only the MAPPED subset of a case's matches, and when
 *    that exceeds the cap it plots an EVENLY SAMPLED slice — never the first N,
 *    which would bias a "geographic spread" panel toward one end of the record
 *    order — with the sample size stated in the caption.
 */

import type { OwnerType } from "./owner-classify";
import { classifyOwnerSector, type OwnerSector } from "./owner-sector";
import type { OwnerGeography, OwnerStructure } from "./owner-taxonomy";

/** One tracked vacant record in a case's universe. Evidence fields ONLY — no
 *  rank, score, tier, or owner name. `universe` keeps land and reported
 *  buildings distinct so counts are never summed across the two. */
export interface VacancyCaseRecord {
  id: string;
  address: string;
  pin: string | null;
  universe: "land" | "building_report";
  ownerType: OwnerType;
  ownerStructure: OwnerStructure | null;
  ownerGeography: OwnerGeography | null;
  saleYear: number | null;
  violation: boolean;
  squareFeet: number | null;
  lat: number | null;
  lon: number | null;
}

/** One Opportunity Area for the workbench rail (a projection of the public,
 *  place-led deriveOpportunityAreas output — geography only, no ownership). */
export interface VacancyCaseArea {
  id: number;
  name: string;
  siteCount: number;
  mappedCount: number;
  corridor: string | null;
  scenario: string;
  needsChecking: string;
}

/** The five case keys. Stable URL contract (`?case=<key>`) and shared with the
 *  prototype's param names so older shared links keep resolving. */
export type CaseKey =
  | "public-land"
  | "private-outreach"
  | "ownership-check"
  | "building-review"
  | "tax-title";

export const CASE_KEYS: readonly CaseKey[] = [
  "public-land",
  "private-outreach",
  "ownership-check",
  "building-review",
  "tax-title",
] as const;

/** The default active case when `?case=` is absent or unrecognized. */
export const DEFAULT_CASE_KEY: CaseKey = "public-land";

/** Fixed editorial copy for one case. `definition` is the one-line "what this
 *  is"; `caveat` is the honest limit, and every caveat NAMES the record field
 *  its predicate keys off so the count is auditable from the caveat alone. */
export interface CaseType {
  key: CaseKey;
  /** Short mono label for the icon chip (2 chars, uppercase). */
  chip: string;
  name: string;
  definition: string;
  caveat: string;
}

/** The five case types, in display order (public-land first / default). Copy is
 *  fixed here so it never drifts per-ZIP; only the counts change. */
export const CASE_TYPES: readonly CaseType[] = [
  {
    key: "public-land",
    chip: "PL",
    name: "Public-land pathway",
    definition: "Start with land that has a public disposition pathway.",
    caveat: "Vacant land classified as City or public control. Verify current status before relying.",
  },
  {
    key: "private-outreach",
    chip: "PO",
    name: "Private-owner outreach",
    definition: "Sites where the next step is finding and contacting the record owner.",
    caveat:
      "Land uses the reconciled owner type; a reported building uses the taxpayer structure resolved from its matched parcel. Both come from taxpayer records and require verification.",
  },
  {
    key: "ownership-check",
    chip: "OF",
    name: "Ownership follow-up",
    definition: "Sites where the record holder is not yet identified.",
    caveat:
      "Neither the owner type nor the taxpayer structure has resolved for these records. Start with the county parcel record and deed history.",
  },
  {
    key: "building-review",
    chip: "BC",
    name: "Building condition review",
    definition: "Reported vacant buildings that need condition and status checks.",
    caveat: "Building vacancy comes from resident reports and is unverified.",
  },
  {
    key: "tax-title",
    chip: "TT",
    name: "Tax and title review",
    definition: "Sites with signals worth checking against county tax and title records.",
    caveat: "Signals are indicators, not determinations. County records are authoritative.",
  },
] as const;

const CASE_TYPE_BY_KEY: Record<CaseKey, CaseType> = CASE_TYPES.reduce(
  (acc, c) => {
    acc[c.key] = c;
    return acc;
  },
  {} as Record<CaseKey, CaseType>,
);

/** Look up a case's fixed copy by key. */
export function caseTypeFor(key: CaseKey): CaseType {
  return CASE_TYPE_BY_KEY[key];
}

/** Parse a raw `?case=` value into a known CaseKey, falling back to the
 *  default for anything missing or unrecognized (a tampered/stale URL can
 *  never select an out-of-range case). */
export function parseCaseParam(value: string | string[] | undefined): CaseKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return (CASE_KEYS as readonly string[]).includes(raw ?? "")
    ? (raw as CaseKey)
    : DEFAULT_CASE_KEY;
}

const KNOWN_PRIVATE: ReadonlySet<OwnerType> = new Set<OwnerType>([
  "local_private",
  "corporate_llc",
  "out_of_state",
]);

/**
 * A record's SECTOR, read off BOTH ownership axes the record already carries —
 * the same reconciliation the All Properties directory's PUBLIC / PRIVATE column
 * uses (lib/owner-sector.ts), so the workbench and the directory never disagree
 * about the same row.
 *
 * This matters most for the 311 reported-building universe. A 311 row's LEGACY
 * `ownerType` is "unknown" by construction — the 311 feed carries no ownership
 * at all — but the export resolves the row's parcel by exact address match and
 * writes the matched parcel's taxpayer STRUCTURE onto the record. Reading only
 * the legacy field therefore threw that enrichment away and reported every
 * reported building as "owner not yet identified", including the ones whose
 * taxpayer resolved to an individual, an entity, a trust, or a government body.
 */
export function recordSector(record: VacancyCaseRecord): OwnerSector {
  return classifyOwnerSector({
    ownerStructure: record.ownerStructure,
    ownerType: record.ownerType,
  });
}

/**
 * The single source of truth for which records belong to a case (pure,
 * deterministic). Every count on the workbench flows through this predicate,
 * so the caveat copy and the number can never drift.
 *
 *  - public-land      → land the report reconciles to City / public control.
 *                       Keyed on the LEGACY owner type on purpose: that field
 *                       carries the City-inventory signal, which is what a
 *                       public disposition pathway actually depends on, and it
 *                       is the same figure deriveLandUniverse publishes.
 *  - private-outreach → LAND with a known non-government owner type (again the
 *                       reconciled figure the report publishes), plus REPORTED
 *                       BUILDINGS whose matched-parcel taxpayer structure reads
 *                       private. Both halves are named in the caveat.
 *  - ownership-check  → records unresolved on BOTH axes (sector
 *                       "unclassified") — the pair the caveat names. Keying on
 *                       the legacy field alone swept in every address-matched
 *                       311 row whose taxpayer had in fact resolved.
 *  - building-review  → the 311 reported-building universe.
 *  - tax-title        → any record carrying a distress signal (a tax-sale year
 *                       on its parcel, or a matched vacant-building violation).
 */
export function caseMatches(key: CaseKey, record: VacancyCaseRecord): boolean {
  switch (key) {
    case "public-land":
      return record.universe === "land" && record.ownerType === "city_public";
    case "private-outreach":
      return record.universe === "land"
        ? KNOWN_PRIVATE.has(record.ownerType)
        : recordSector(record) === "private";
    case "ownership-check":
      return recordSector(record) === "unclassified";
    case "building-review":
      return record.universe === "building_report";
    case "tax-title":
      return record.saleYear != null || record.violation === true;
  }
}

/** One mapped point for the dot preview — coordinate + universe (for the dot
 *  color) only. No address, PIN, or owner detail travels to the SVG. */
export interface CasePoint {
  lat: number;
  lon: number;
  universe: "land" | "building_report";
}

/** A fully computed case: fixed copy + real counts + the capped mapped points
 *  for the geographic preview. `landCount + buildingCount === matches` always
 *  (the two universes partition the match set); the tests assert it. */
export interface DerivedCase {
  key: CaseKey;
  name: string;
  definition: string;
  caveat: string;
  chip: string;
  /** Total matching records (land + building). */
  matches: number;
  landCount: number;
  buildingCount: number;
  /** Matches that carry a usable coordinate (the dot preview's honest denom). */
  mappedTotal: number;
  /** Mapped points for the preview map — the whole mapped set when it fits in
   *  `pointCap`, otherwise an evenly spaced sample of exactly `pointCap`. */
  points: CasePoint[];
}

/** Default map-preview cap — enough to read the geographic spread, few enough
 *  to stay a lightweight preview beside the full property map. */
export const CASE_POINT_CAP = 400;

const hasCoord = (r: { lat: number | null; lon: number | null }): boolean =>
  Number.isFinite(r.lat) && Number.isFinite(r.lon);

/**
 * Pick at most `cap` points for the preview map. Under the cap this is the whole
 * mapped set. Over it, this takes an EVENLY SPACED sample across the full array
 * rather than `slice(0, cap)`.
 *
 * The slice was a real distortion, not a nicety: the record array is land first
 * (in reconciled-land order) then reported buildings, so the first 400 mapped
 * matches of a mixed case were all land — a panel captioned "geographic spread"
 * showed one universe and one end of the ZIP. Striding by `i * length / cap`
 * keeps the sample deterministic (same input, same dots, every render), keeps
 * indices strictly increasing (so no point is drawn twice), and always includes
 * the first and last mapped record.
 */
export function sampleCasePoints(mapped: readonly CasePoint[], cap: number): CasePoint[] {
  const limit = Math.max(0, Math.floor(cap));
  if (limit === 0) return [];
  if (mapped.length <= limit) return [...mapped];
  const out: CasePoint[] = [];
  for (let i = 0; i < limit; i += 1) {
    out.push(mapped[Math.floor((i * mapped.length) / limit)]);
  }
  return out;
}

/**
 * The universe totals a case's counts are measured against. Printed on the
 * workbench so `landCount <= land` and `buildingCount <= building` are visible
 * facts rather than claims a reader has to take on trust.
 *
 * `land` and `landTotal` are deliberately two numbers. `land` is what the
 * workbench can actually ENUMERATE — one record per parcel, which is what the
 * case predicates run over. `landTotal` is the edition's full reconciled
 * land-universe figure (deriveLandUniverse). They are equal on most editions,
 * but the export caps its published land points per edition, so on a large ZIP
 * the enumerable set is short of the true universe (60621: 2,000 of 2,971
 * points; 60636: 2,000 of 2,900). Collapsing the two would present a
 * several-hundred-parcel shortfall as a complete count.
 */
export interface CaseUniverse {
  /** Land records the workbench can enumerate — the case predicates' domain. */
  land: number;
  /** The edition's full reconciled land universe, or null when unavailable. */
  landTotal: number | null;
  building: number;
}

/** True when the edition publishes fewer land records than its land universe
 *  holds, so every land count on the page is a floor rather than a total. */
export function isLandUniverseTruncated(universe: CaseUniverse): boolean {
  return universe.landTotal != null && universe.landTotal > universe.land;
}

/** The tracked universe the cases partition (pure). `landTotal` comes from the
 *  edition (server side) and is left null when the caller has no edition. */
export function deriveCaseUniverse(
  records: readonly VacancyCaseRecord[],
  landTotal: number | null = null,
): CaseUniverse {
  let land = 0;
  let building = 0;
  for (const r of records) {
    if (r.universe === "land") land += 1;
    else building += 1;
  }
  return { land, landTotal, building };
}

/** Compute one case from the full record set (pure). */
export function deriveCase(
  key: CaseKey,
  records: readonly VacancyCaseRecord[],
  pointCap: number = CASE_POINT_CAP,
): DerivedCase {
  const type = caseTypeFor(key);
  const matched = records.filter((r) => caseMatches(key, r));
  let landCount = 0;
  let buildingCount = 0;
  const mapped: CasePoint[] = [];
  for (const r of matched) {
    if (r.universe === "land") landCount += 1;
    else buildingCount += 1;
    if (hasCoord(r)) {
      mapped.push({ lat: r.lat as number, lon: r.lon as number, universe: r.universe });
    }
  }
  return {
    key,
    name: type.name,
    definition: type.definition,
    caveat: type.caveat,
    chip: type.chip,
    matches: matched.length,
    landCount,
    buildingCount,
    mappedTotal: mapped.length,
    points: sampleCasePoints(mapped, pointCap),
  };
}

/** Compute all five cases, in CASE_TYPES order. */
export function deriveAllCases(
  records: readonly VacancyCaseRecord[],
  pointCap: number = CASE_POINT_CAP,
): DerivedCase[] {
  return CASE_KEYS.map((key) => deriveCase(key, records, pointCap));
}
