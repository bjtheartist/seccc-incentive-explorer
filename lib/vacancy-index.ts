/**
 * Vacancy Opportunity Index — export-side data contract, pure aggregation
 * functions, printed-copy constants, and the static-only loader.
 *
 * Shipped as a shareable, anonymized per-neighborhood PDF (owner TYPE only —
 * never owner names or mailing addresses). One edition per pilot ZIP
 * (lib/pilot-zips.ts). The pipeline is:
 *
 *   scripts/export-vacancy-index.ts (disposable Neon refresh branch)
 *     -> public/data/vacancy-index.json (anonymized, committed)
 *     -> loadVacancyIndex() here (static-only, no DB fallback)
 *     -> buildVacancyIndexPdfInput() (added by the integration pass, once the
 *        PDF agent lands lib/vacancy-index-pdf.ts's input type)
 *     -> the gated download button on the admin Owner Files pages.
 *
 * Honesty rails (non-negotiable, mirror the corridor-owners/DataPendingRow
 * doctrine): nulls survive as nulls end-to-end and are NEVER coerced to 0 —
 * an unavailable series is `null` ("not yet available"), while a genuine `0`
 * from a query that actually ran (e.g. a zero-count owner type in a
 * distribution) is honest and DOES appear. No fabricated projections or
 * scores.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { OwnerType } from "./owner-classify";
import { OWNER_TYPE_ORDER, normalizeOwnerType } from "./owner-classify";

// ── Data contract ────────────────────────────────────────────────────────

export type VacancyPriorityTier = "high" | "medium" | "low";
export type VacancyPropertyType = "vacant_land" | "vacant_building";
export type TransportKind = "expressway" | "rail";

/**
 * One owner-type tally in an ownership distribution. A `count` of `0` is a
 * real, honest zero (the query ran and this type simply wasn't present) — the
 * distributions in this export list every OwnerType in OWNER_TYPE_ORDER, so a
 * zero-count type still renders rather than silently disappearing. A series
 * that could not be built at all is represented as a `null` series, never an
 * empty/all-zero array.
 */
export interface OwnerTypeCount {
  ownerType: OwnerType;
  count: number;
}

/** One matrix cell: a raw metric `value` and its 1–5 within-cohort quintile
 * `dots`. Both are `null` when the metric is unavailable for the edition
 * (`dots` is non-null exactly when `value` is non-null). */
export interface VacancyMatrixCell {
  value: number | null;
  dots: number | null;
}

/**
 * One row of the nine-edition comparison matrix (D4). Five metric cells, each
 * a {value, dots} pair. `healthScore` is deliberately EXCLUDED (composite-score
 * copy doctrine, lib/corridor-citywide.ts). The dot ratings rank the nine
 * pilot editions against each other (quintiles) — see MATRIX_METHOD_NOTE.
 */
export interface VacancyMatrixRow {
  zip: string;
  neighborhood: string;
  editionNumber: number;
  trackedVacantCount: VacancyMatrixCell;
  vacancyRate: VacancyMatrixCell;
  localOwnershipShare: VacancyMatrixCell;
  incentiveCoverage: VacancyMatrixCell;
  cityOwnedShare: VacancyMatrixCell;
}

/** A single vacant site as a map dot. `markerNumber` is 1–12 on the top-12
 * priority sites and `null` on the rest. */
export interface VacancySitePoint {
  lat: number;
  lon: number;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  priorityTier: VacancyPriorityTier;
  markerNumber: number | null;
}

/** One row of the page-04 site index (top-N by priority ranking). */
export interface VacancySiteIndexRow {
  markerNumber: number | null;
  address: string;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  zoningClass: string | null; // COLS only; 311 rows have none -> null -> "PENDING"
  squareFeet: number | null;
  incentiveCount: number;
  priorityScore: number;
  priorityTier: VacancyPriorityTier;
  nextStep: string;
  lat: number;
  lon: number;
}

/**
 * Per-edition anonymized payload. `boundary` (simplified ZIP ring + bbox) and
 * `transport` (clipped expressway/rail lines) are embedded so the client makes
 * ONE fetch and the PDF builder stays pure with zero network access (D8).
 */
export interface VacancyIndexEdition {
  zip: string;
  neighborhood: string;
  secondaryAreas: string[];
  editionNumber: number; // 1–9 in PILOT_ZIPS order
  headline: {
    vacantPropertyCount: number;
    vacantLandCount: number;
    vacantBuildingCount: number;
    cityOwnedCount: number;
    inIncentiveZoneCount: number;
    priorityMix: { high: number; medium: number; low: number };
  };
  ownership: {
    /** COMPLETE vacant-land ownership from `parcels` (D2a); `null` = the
     * query could not run on the refresh branch, never an all-zero fiction. */
    vacantLandParcelsByOwnerType: OwnerTypeCount[] | null;
    vacantLandParcelTotal: number | null;
    /** Tracked-inventory (COLS + 311) counts by owner type (D2b) — a
     * different universe from the parcels series, always available. */
    trackedInventoryByOwnerType: OwnerTypeCount[];
  };
  sitePoints: VacancySitePoint[]; // capped 2000, priority-ordered
  sitePointsTruncated: boolean;
  siteIndex: VacancySiteIndexRow[]; // top 15 (band 10–20, set at export)
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  centroid: { lat: number; lon: number };
  transport: { kind: TransportKind; points: [number, number][] }[];
}

/** Human-readable source + as-of labels for the sheet footers. */
export interface VacancyIndexSources {
  trackedInventory: string;
  vacantLandOwnership: string;
  corridorMetrics: string;
  zipBoundaries: string;
  transportNetwork: string;
  asOf: string;
}

export interface VacancyIndexExport {
  generatedAt: string;
  sources: VacancyIndexSources;
  editions: Record<string, VacancyIndexEdition>; // always all nine keys after a full run
  matrix: VacancyMatrixRow[]; // 9 rows × 5 metric cells
}

// ── Priority rubric (pure) ─────────────────────────────────────────────────

/** Fields computeSitePriority / nextStepForSite read off a site. */
export interface VacancySiteScoreFields {
  incentiveCount: number;
  squareFeet: number | null;
  ownerType: OwnerType;
  status: string | null;
  propertyType: VacancyPropertyType;
}

/**
 * Priority score + tier for one vacant site (printed verbatim as
 * PRIORITY_RUBRIC_NOTE on page 04):
 *   + min(incentiveCount, 4)
 *   + 2 if squareFeet >= 10000, + 1 if >= 5000, + 0 if null / 0 / < 5000
 *   + 2 if ownerType === "city_public" OR status === "city_owned"
 *   + 1 if a vacant_building with an active 311 case (status "reported_open")
 * Tiers: high >= 6, medium 3–5, low 0–2. A null/0 square-foot value scores 0
 * for the size term (unknown size never inflates priority).
 */
export function computeSitePriority(
  site: VacancySiteScoreFields
): { score: number; tier: VacancyPriorityTier } {
  let score = 0;

  // Incentive coverage, capped at 4 (guard against a stray negative).
  score += Math.max(0, Math.min(site.incentiveCount, 4));

  // Size term — null or 0 (or < 5000) scores 0.
  const sqft = site.squareFeet;
  if (sqft != null && Number.isFinite(sqft)) {
    if (sqft >= 10000) score += 2;
    else if (sqft >= 5000) score += 1;
  }

  // City-owned / public land is the most actionable (disposition path).
  if (site.ownerType === "city_public" || site.status === "city_owned") score += 2;

  // A vacant building with a live 311 complaint.
  if (site.propertyType === "vacant_building" && site.status === "reported_open") score += 1;

  return { score, tier: priorityTierForScore(score) };
}

/** Map a priority score to its tier (high >= 6, medium 3–5, low 0–2). */
export function priorityTierForScore(score: number): VacancyPriorityTier {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

/**
 * The incentive-aware next step for a site, keyed on owner type (six branches).
 * Individual (local_private) owners are never routed to an automated letter —
 * the entity-owner boundary the Owner File workflow enforces.
 */
export function nextStepForSite(
  site: Pick<VacancySiteScoreFields, "ownerType" | "propertyType">
): string {
  switch (site.ownerType) {
    case "city_public":
      return "City/CCLBA disposition inquiry";
    case "corporate_llc":
      return "Entity outreach — open the admin Owner File";
    case "out_of_state":
      return "Entity outreach — open the admin Owner File; identify local agent";
    case "local_private":
      return "Direct owner contact (individual owner — no automated letter)";
    case "unknown":
    default:
      return site.propertyType === "vacant_building"
        ? "Verify ownership via Assessor/Recorder; check 311 case status"
        : "Verify ownership via Cook County Assessor";
  }
}

// ── Ranking (pure) ─────────────────────────────────────────────────────────

/** Minimal shape rankSites needs. */
export interface RankableSite {
  id: string;
  priorityScore: number;
  incentiveCount: number;
  squareFeet: number | null;
}

/**
 * Deterministic total ordering:
 *   priorityScore desc -> incentiveCount desc -> squareFeet desc (nulls last)
 *   -> id asc.
 * A null square-foot value always sorts after any known size (never wins a
 * tiebreak by being "unknown"). The final id tiebreak makes the order stable
 * and reproducible across export runs.
 */
export function compareRankableSites(a: RankableSite, b: RankableSite): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (b.incentiveCount !== a.incentiveCount) return b.incentiveCount - a.incentiveCount;

  const sa = a.squareFeet;
  const sb = b.squareFeet;
  const aNull = sa == null || !Number.isFinite(sa);
  const bNull = sb == null || !Number.isFinite(sb);
  if (aNull && !bNull) return 1; // a's size unknown -> after b
  if (bNull && !aNull) return -1; // b's size unknown -> after a
  if (!aNull && !bNull && sb !== sa) return (sb as number) - (sa as number);

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Rank a copy of `sites` by compareRankableSites (non-mutating). */
export function rankSites<T extends RankableSite>(sites: readonly T[]): T[] {
  return [...sites].sort(compareRankableSites);
}

// ── Quintile dots (pure) ───────────────────────────────────────────────────

/**
 * Assign each value a 1–5 within-cohort quintile "dot" rating by rank across
 * the non-null values (higher value -> more dots). Ties share a bin. A `null`
 * value maps to `null` dots (and is excluded from the cohort size).
 *
 * Uses each value's tie-group mid-rank at the Hazen plotting position
 * ((midRank - 0.5) / n), so equal values always share a bin, the assignment is
 * symmetric, an all-equal cohort settles on the middle bin, and a lone value
 * lands in the middle rather than claiming the top. For nine distinct values
 * the spread is [1,1,2,2,3,4,4,5,5].
 */
export function assignQuantileDots(values: readonly (number | null)[]): (number | null)[] {
  const nonNull = values.filter((v): v is number => v != null && Number.isFinite(v));
  const n = nonNull.length;

  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return null;
    if (n === 0) return null; // unreachable given v is non-null, but keeps this total

    let lessThan = 0;
    let equal = 0;
    for (const u of nonNull) {
      if (u < v) lessThan += 1;
      else if (u === v) equal += 1;
    }
    // Mid-rank of the tie group, 1..n; Hazen plotting position keeps it centered.
    const midRank = lessThan + (equal + 1) / 2;
    const bin = Math.ceil(((midRank - 0.5) / n) * 5);
    return Math.min(5, Math.max(1, bin));
  });
}

// ── Owner-type distribution (pure) ─────────────────────────────────────────

/**
 * Tally a flat list of owner types into an OwnerTypeCount[] covering ALL five
 * types in OWNER_TYPE_ORDER — a type absent from the input honestly renders as
 * count 0 (the query ran; the type simply wasn't present), never dropped. Each
 * input value is narrowed via normalizeOwnerType (null/unrecognized ->
 * "unknown"). Callers use `null` (not this function's output) to represent a
 * series that could not be built at all.
 */
export function tallyOwnerTypeCounts(
  ownerTypes: readonly (string | null | undefined)[]
): OwnerTypeCount[] {
  const counts = new Map<OwnerType, number>();
  for (const key of OWNER_TYPE_ORDER) counts.set(key, 0);
  for (const raw of ownerTypes) {
    const key = normalizeOwnerType(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return OWNER_TYPE_ORDER.map((ownerType) => ({ ownerType, count: counts.get(ownerType) ?? 0 }));
}

// ── Printed-copy constants ─────────────────────────────────────────────────

/** The priority rubric, printed verbatim on page 04. */
export const PRIORITY_RUBRIC_NOTE =
  "Priority score = min(incentive programs, 4) + size (+2 if lot >= 10,000 sq ft, " +
  "+1 if >= 5,000, +0 if unknown or smaller) + 2 if city-owned or public land " +
  "+ 1 if a vacant building with an active 311 case. Tiers: HIGH >= 6, MEDIUM 3–5, " +
  "LOW 0–2. Unknown lot size scores 0 for the size term and renders as \"—\". " +
  "Sites are ranked by priority score, then incentive count, then lot size " +
  "(largest first, unknown last).";

/** The quintile-methodology note printed beneath the comparison matrix. */
export const MATRIX_METHOD_NOTE =
  "Dot ratings rank the nine pilot editions against each other (quintiles). " +
  "They are not citywide scores or grades.";

/**
 * The edition-geography disclaimer printed on every sheet (D1): the export
 * assigns rows to a ZIP by point-in-polygon, and ZIP boundaries don't line up
 * exactly with the community areas neighborhoods are named for.
 */
export function editionGeographyNote(zip: string, neighborhood: string): string {
  return `Edition geography: ZIP ${zip} (primarily ${neighborhood}). ZIP and community-area boundaries do not align exactly.`;
}

// ── Static-only loader (D7) ────────────────────────────────────────────────

const VACANCY_INDEX_PATH = path.join(process.cwd(), "public/data/vacancy-index.json");

// Module-level cache, read once per process.
// `undefined` = not attempted yet; `null` = attempted and the file is absent
// or unparseable (the expected state until the first export is committed).
let cache: VacancyIndexExport | null | undefined = undefined;

/**
 * Read and parse the committed export once per process. Static-only: there is
 * NO database fallback for this bulk data (unlike loadStaticOwnerClusters,
 * whose live query path exists for refresh branches). Returns `null` when the
 * file has not been generated yet, so callers render an empty state rather
 * than throwing. Mirrors loadCorridorCitywideData (existsSync + readFileSync +
 * memo).
 */
export function loadVacancyIndex(): VacancyIndexExport | null {
  if (cache !== undefined) return cache;

  try {
    if (!existsSync(VACANCY_INDEX_PATH)) {
      cache = null;
      return cache;
    }
    const raw = readFileSync(VACANCY_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    cache =
      parsed && typeof parsed === "object" && "editions" in (parsed as object)
        ? (parsed as VacancyIndexExport)
        : null;
  } catch {
    cache = null;
  }

  return cache;
}

/** The edition for one ZIP, or `null` if the export is missing or the ZIP is
 * not one of the nine pilot editions. */
export function getVacancyIndexEdition(zip: string): VacancyIndexEdition | null {
  const data = loadVacancyIndex();
  if (!data) return null;
  return data.editions[zip] ?? null;
}
