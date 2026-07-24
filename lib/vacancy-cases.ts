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
 *  - The dot preview shows only the MAPPED subset of a case's matches, capped,
 *    with an honest "N of M mapped matches shown" line — the count is the full
 *    match count, the dots are what actually carries a coordinate.
 */

import type { OwnerType } from "./owner-classify";
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
    caveat: "Ownership types come from taxpayer records and require verification.",
  },
  {
    key: "ownership-check",
    chip: "OF",
    name: "Ownership follow-up",
    definition: "Sites where the record holder is not yet identified.",
    caveat:
      "Ownership is not yet classified from taxpayer records. Start with the county parcel record and deed history.",
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
 * The single source of truth for which records belong to a case (pure,
 * deterministic). Every count on the workbench flows through this predicate,
 * so the caveat copy and the number can never drift.
 *
 *  - public-land      → land the report reconciles to City / public control.
 *  - private-outreach → land with a KNOWN non-government owner type.
 *  - ownership-check  → any record whose owner type is "Not yet classified"
 *                       (ownerType unknown) — the field the caveat names.
 *  - building-review  → the 311 reported-building universe.
 *  - tax-title        → any record carrying a distress signal (a tax-sale year
 *                       on its parcel, or a matched vacant-building violation).
 */
export function caseMatches(key: CaseKey, record: VacancyCaseRecord): boolean {
  switch (key) {
    case "public-land":
      return record.universe === "land" && record.ownerType === "city_public";
    case "private-outreach":
      return record.universe === "land" && KNOWN_PRIVATE.has(record.ownerType);
    case "ownership-check":
      return record.ownerType === "unknown";
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
  /** Mapped points for the SVG, capped at `pointCap`. */
  points: CasePoint[];
}

/** Default dot-preview cap — enough to read the geographic spread, few enough
 *  to render as inline SVG without weight. */
export const CASE_POINT_CAP = 400;

const hasCoord = (r: { lat: number | null; lon: number | null }): boolean =>
  Number.isFinite(r.lat) && Number.isFinite(r.lon);

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
    points: mapped.slice(0, Math.max(0, pointCap)),
  };
}

/** Compute all five cases, in CASE_TYPES order. */
export function deriveAllCases(
  records: readonly VacancyCaseRecord[],
  pointCap: number = CASE_POINT_CAP,
): DerivedCase[] {
  return CASE_KEYS.map((key) => deriveCase(key, records, pointCap));
}
