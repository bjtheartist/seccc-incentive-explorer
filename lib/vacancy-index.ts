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
 * Intervention portfolio for one vacant site — the four coordinated-action
 * buckets the spatial layer sorts sites into (see PORTFOLIO_RUBRIC_NOTE).
 */

/** A named corridor (kind distinguishes the three source layers). */
export type CorridorKind = "ssa" | "commercial" | "industrial";
export interface CorridorRef {
  name: string;
  kind: CorridorKind;
}

/**
 * A community-impact anchor as a map point. Placed at its COMMUNITY-AREA
 * centroid — the source dataset (data/exports/chicago-neighborhood-economics)
 * is community-area-native and carries NO per-anchor coordinate, so lat/lon is
 * an area-level locator, never an exact address. Anonymization-safe: public
 * institutional names only.
 */
export interface VacancyAnchor {
  name: string;
  category: string;
  lat: number;
  lon: number;
}

/** [minLon, minLat, maxLon, maxLat] — the w,s,e,n convention the edition
 * boundary and cluster bboxes both use. */
export type VacancyBbox = [number, number, number, number];

/**
 * One proximity cluster of tracked vacant sites (D2). Boundaries are analytical
 * (single-linkage over ~150 m), never parcel-contiguous. `ownerTypeCounts`
 * lists all five owner types in OWNER_TYPE_ORDER (honest zeros); `portfolioCounts`
 * carries all four portfolios. `corridorName` is the containing or nearest named
 * corridor within ~400 m, else `null`.
 */
export interface VacancyCluster {
  id: number; // 1..N, ordered by count desc then centroid lat/lon
  centroid: { lat: number; lon: number };
  bbox: VacancyBbox;
  count: number;
  ownerTypeCounts: OwnerTypeCount[];
  portfolioCounts: Record<VacancyPortfolio, number>;
  taxSaleCount: number;
  violationCount: number;
  vacantLandCount: number;
  vacantBuildingCount: number;
  corridorName: string | null;
}

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

/**
 * Reconciliation of the raw assessor vacant-land ownership series against the
 * City's own land inventory (the COLS/aksk-kvfp dataset). Stale taxpayer-of-
 * record data undercounts City/Public ownership badly (South Chicago shows
 * City/Public = 3 in taxpayer records vs 864 in the City inventory), so the
 * reconciled series treats any assessor vacant-land parcel whose PIN is in the
 * City inventory as authoritative city_public. These three integers explain the
 * shift. `null` (on the edition) when the raw parcels series is `null`.
 */
export interface VacantLandReconciliation {
  /** Assessor vacant-land parcels whose PIN matched the City inventory. */
  cityPinMatches: number;
  /** Of those matches, how many had a non-city taxpayer classification and were
   * therefore reclassified to city_public (the count the source note prints). */
  reclassifiedCount: number;
  /** City-inventory PINs with no assessor vacant-land parcel match at all. */
  inventoryUnmatchedCount: number;
}

/**
 * Per-edition distress-signal tallies (Phase-2 overlay — mirrors the
 * lib/corridor-owners.ts join conventions). Every field is `null` until the
 * source table exists on the refresh branch (try/catch → null, never a silent
 * 0); the whole object is `null` only when NO distress source loaded. A genuine
 * `0` from a join that actually ran is honest and DOES appear.
 */
export interface VacancyDistressSignals {
  /** Vacant parcels (COLS inventory PINs ∪ assessor vacant PINs, deduped)
   * appearing in the scavenger or annual tax-sale records. `null` = tax-sale
   * tables absent on the branch. */
  taxSaleExposedCount: number | null;
  /** Most recent tax_sale_year across any matched vacant parcel; `null` = no
   * match, or the tax-sale tables were absent. */
  latestTaxSaleYear: number | null;
  /** Tracked vacant properties (COLS + 311 rows) with ≥1 vacant-building-
   * violation record at the same normalized address. `null` = the
   * vacant_building_violations table was absent on the branch. */
  violationMatchCount: number | null;
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
  reportedBuildingShare: VacancyMatrixCell;
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
  /** Latest tax-sale year when this point's parcel (a COLS row's PIN) is in the
   * scavenger/annual sale set; `null` for 311 rows (which carry no PIN — honest)
   * and when the tax-sale tables were absent on the refresh branch. */
  saleYear: number | null;
  /** True when this tracked row's normalized address matched ≥1 vacant-building-
   * violation record (the same match the edition-level violationMatchCount
   * counts); `false` when the violations table was absent on the branch. */
  violation: boolean;
}

/**
 * One reconciled assessor vacant-land parcel as a map dot: its coordinate and
 * its RECONCILED owner type (city_public from the City-inventory PIN match,
 * otherwise the taxpayer-record classification). `saleYear` is the latest
 * tax-sale year when the parcel's PIN is in the scavenger/annual sale set (else
 * `null`, and `null` when the tax-sale tables were absent). Building violations
 * are intentionally NOT flagged on land parcels (a building violation on vacant
 * land is semantically wrong).
 */
export interface VacancyLandPoint {
  lat: number;
  lon: number;
  ownerType: OwnerType;
  saleYear: number | null;
}

/**
 * One row of the full site directory (the web report's online index — EVERY
 * tracked vacant property with a usable address, not just the top-N site
 * index). Anonymized: owner TYPE only, never owner names or mailing addresses.
 * Written to a per-ZIP directory file (public/data/vacancy-directory/{zip}.json)
 * that lazy-loads on the client so the main export JSON stays lean.
 */
export interface VacancyDirectoryRow {
  address: string;
  /** Tracked-universe (COLS + 311) classification — city_public / unknown mostly. */
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  priorityTier: VacancyPriorityTier;
  priorityScore: number;
  /** Same pin-derived tax-sale flag the matching sitePoint carries; `null` for
   * 311 rows (no PIN) and when the tax-sale tables were absent on the branch. */
  saleYear: number | null;
  /** Same address-match violation flag the matching sitePoint carries; `false`
   * when the violations table was absent on the branch. */
  violation: boolean;
}

/**
 * The lazy-loaded per-ZIP site directory file. Holds EVERY tracked row with a
 * non-empty address, sorted priorityScore desc then address asc, plus an
 * honest count of the rows dropped for a missing/empty address.
 */
export interface VacancyDirectoryFile {
  zip: string;
  neighborhood: string;
  generatedAt: string;
  rows: VacancyDirectoryRow[];
  /** Tracked rows dropped from `rows` for a missing/empty address (honest). */
  excludedNoAddressCount: number;
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
    /** RAW COMPLETE vacant-land ownership from `parcels` (D2a), straight from
     * taxpayer-of-record classification; `null` = the query could not run on
     * the refresh branch, never an all-zero fiction. Kept for the methodology
     * comparison line; the reconciled series below is what the panels render. */
    vacantLandParcelsByOwnerType: OwnerTypeCount[] | null;
    vacantLandParcelTotal: number | null;
    /** Tracked-inventory (COLS + 311) counts by owner type (D2b) — a
     * different universe from the parcels series, always available. */
    trackedInventoryByOwnerType: OwnerTypeCount[];
    /** RECONCILED vacant-land ownership: city_public taken from the City's own
     * land inventory (PIN-matched, authoritative), the remainder keeping its
     * taxpayer-record classification. `null` exactly when the raw parcels
     * series above is `null` (same availability). */
    reconciledVacantLandByOwnerType: OwnerTypeCount[] | null;
    /** How the reconciliation moved the numbers; `null` exactly when the raw
     * parcels series is `null`. */
    reconciliation: VacantLandReconciliation | null;
  };
  /** Phase-2 distress overlays for this edition, or `null` when no distress
   * source table was present on the refresh branch (degrade gracefully). */
  distress: VacancyDistressSignals | null;
  sitePoints: VacancySitePoint[]; // capped 2000, priority-ordered
  sitePointsTruncated: boolean;
  siteIndex: VacancySiteIndexRow[]; // top 15 (band 10–20, set at export)
  /** Reconciled assessor vacant-land parcels as map dots (view 2 of the web
   * map's owner-type toggle), colored by reconciled owner type. Deterministic
   * pin-asc order, capped 2000. `null` exactly when the raw parcels series
   * (ownership.vacantLandParcelsByOwnerType) is `null` — identical availability. */
  landPoints: VacancyLandPoint[] | null;
  landPointsTruncated: boolean;
  /** Full vacant-land universe count (= ownership.vacantLandParcelTotal);
   * landPoints may be fewer (2000 cap, or parcels lacking coordinates). `null`
   * exactly when landPoints is `null`. */
  landPointsTotal: number | null;
  /** Total rows written to this edition's lazy-loaded site directory file
   * (public/data/vacancy-directory/{zip}.json) — every tracked row WITH a
   * usable address. Drives the collapsed "Browse all N tracked addresses" row
   * on the web report without loading the directory itself. Always a number
   * once the edition builds (the directory is written alongside it). */
  directoryCount: number;
  boundary: { rings: [number, number][][]; bbox: [number, number, number, number] } | null;
  centroid: { lat: number; lon: number };
  transport: { kind: TransportKind; points: [number, number][] }[];
  /** Spatial-intelligence layer (D2/D3). Proximity clusters over the FULL
   * tracked universe (pre-cap), top 12 by count; ALWAYS an array once the
   * edition builds (empty when no cluster reaches the minimum size), never
   * null — see CLUSTERS_NOTE for the method. */
  clusters: VacancyCluster[];
  /** The printable clustering-method note (= CLUSTERS_NOTE). */
  clustersNote: string;
  /** Named corridors (SSA / commercial CCSA / industrial) whose polygon bbox
   * overlaps this edition's bbox, deduped by name. Always an array. */
  corridors: CorridorRef[];
  /** Community-impact anchors in this edition's community areas (primary +
   * secondary), placed at their COMMUNITY-AREA centroid (the source dataset is
   * community-area-native and carries no per-anchor coordinate — the lat/lon is
   * an area-level locator, NOT an exact address). `null` when no anchor matched
   * any of the edition's community areas. */
  anchors: VacancyAnchor[] | null;
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

// ── Site directory (pure) ──────────────────────────────────────────────────

/** Minimal shape buildDirectoryRows reads off a scored tracked site. `address`
 * is the RAW value (nullable) so a missing/empty address can be excluded and
 * counted rather than coerced to a placeholder. */
export interface DirectoryInputSite {
  address: string | null | undefined;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  priorityTier: VacancyPriorityTier;
  priorityScore: number;
  saleYear: number | null;
  violation: boolean;
}

/**
 * Directory ordering: priorityScore desc, then address asc (plain lexical).
 * The same total order the site index leads with, but keyed on address rather
 * than the id tiebreak (the directory never exposes ids). Deterministic across
 * export runs.
 */
export function compareDirectoryRows(a: VacancyDirectoryRow, b: VacancyDirectoryRow): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/**
 * Build the site directory rows from the tracked scored sites: keep every site
 * whose address is non-empty (after trim), drop and count the rest, and sort by
 * compareDirectoryRows. Pure — unit-tested without a DB. The `excludedNoAddress
 * Count` is the honest "records without a usable address omitted" figure the
 * web report footer prints.
 */
export function buildDirectoryRows(
  sites: readonly DirectoryInputSite[],
): { rows: VacancyDirectoryRow[]; excludedNoAddressCount: number } {
  const rows: VacancyDirectoryRow[] = [];
  let excludedNoAddressCount = 0;
  for (const s of sites) {
    const address = (s.address ?? "").trim();
    if (!address) {
      excludedNoAddressCount += 1;
      continue;
    }
    rows.push({
      address,
      ownerType: s.ownerType,
      propertyType: s.propertyType,
      priorityTier: s.priorityTier,
      priorityScore: s.priorityScore,
      saleYear: s.saleYear,
      violation: s.violation,
    });
  }
  rows.sort(compareDirectoryRows);
  return { rows, excludedNoAddressCount };
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

// ── Reconciled vacant-land ownership (pure) ────────────────────────────────

/**
 * Reconcile a raw assessor vacant-land ownership list against the City's own
 * land inventory. Source precedence: any assessor vacant-land parcel whose PIN
 * appears in `inventoryPins` is authoritative city_public (the City knows it
 * owns the parcel even when the stale taxpayer record classifies it otherwise);
 * every other parcel keeps its taxpayer-record classification (normalized via
 * normalizeOwnerType).
 *
 * PINs on BOTH sides must already be normalized to the same convention
 * (digits-only `parcels.pin`, per lib/ingest/pin-batch.ts) — this function does
 * NOT normalize, mirroring taxSaleSignalsForCluster's caller-normalizes
 * contract in lib/corridor-owners.ts. The `series` covers all five owner types
 * in OWNER_TYPE_ORDER (honest zeros included). Pure — unit-tests without a DB.
 */
/**
 * Reconcile ONE parcel's owner type: a parcel whose PIN is in the City's land
 * inventory is authoritative city_public (the City knows it owns the parcel
 * even when the stale taxpayer record classifies it otherwise); otherwise keep
 * the taxpayer-record classification (normalized via normalizeOwnerType). A
 * blank PIN never matches. Pure — the per-point classifier the export uses to
 * color each land dot, and the same rule reconcileVacantLandOwnership tallies.
 */
export function reconcileOwnerTypeForPin(
  pin: string | null | undefined,
  rawOwnerType: string | null | undefined,
  inventoryPins: ReadonlySet<string>,
): OwnerType {
  if (pin && inventoryPins.has(pin)) return "city_public";
  return normalizeOwnerType(rawOwnerType);
}

export function reconcileVacantLandOwnership(
  assessorRows: readonly { pin: string; ownerType: string | null | undefined }[],
  inventoryPins: ReadonlySet<string>,
): { series: OwnerTypeCount[]; stats: VacantLandReconciliation } {
  const counts = new Map<OwnerType, number>();
  for (const key of OWNER_TYPE_ORDER) counts.set(key, 0);

  const assessorPins = new Set<string>();
  let cityPinMatches = 0;
  let reclassifiedCount = 0;

  for (const row of assessorRows) {
    const pin = row.pin;
    if (pin) assessorPins.add(pin);
    const original = normalizeOwnerType(row.ownerType);
    const effective = reconcileOwnerTypeForPin(pin, row.ownerType, inventoryPins);
    if (pin && inventoryPins.has(pin)) {
      cityPinMatches += 1;
      if (original !== "city_public") reclassifiedCount += 1;
    }
    counts.set(effective, (counts.get(effective) ?? 0) + 1);
  }

  let inventoryUnmatchedCount = 0;
  for (const pin of inventoryPins) {
    if (!assessorPins.has(pin)) inventoryUnmatchedCount += 1;
  }

  const series = OWNER_TYPE_ORDER.map((ownerType) => ({ ownerType, count: counts.get(ownerType) ?? 0 }));
  return { series, stats: { cityPinMatches, reclassifiedCount, inventoryUnmatchedCount } };
}

// ── Distress aggregation (pure) ────────────────────────────────────────────

/**
 * Tax-sale exposure for a deduped set of vacant PINs. A PIN counts as exposed
 * when it appears at all in `saleYearsByPin` (a key exists for any PIN with a
 * scavenger/annual tax-sale record — even one with no parseable year, whose
 * value is an empty array), mirroring taxSaleSignalsForCluster's
 * membership-not-year test. `latestTaxSaleYear` is the max year across matched
 * PINs. `saleYearsByPin === null` (tables absent) → both fields `null`.
 */
export function taxSaleExposureForVacantPins(
  vacantPins: ReadonlySet<string>,
  saleYearsByPin: ReadonlyMap<string, readonly number[]> | null,
): { taxSaleExposedCount: number | null; latestTaxSaleYear: number | null } {
  if (saleYearsByPin === null) return { taxSaleExposedCount: null, latestTaxSaleYear: null };
  let exposed = 0;
  let latest: number | null = null;
  for (const pin of vacantPins) {
    const years = saleYearsByPin.get(pin);
    if (years === undefined) continue; // no tax-sale record for this PIN
    exposed += 1;
    for (const year of years) {
      if (Number.isFinite(year) && (latest === null || year > latest)) latest = year;
    }
  }
  return { taxSaleExposedCount: exposed, latestTaxSaleYear: latest };
}

/**
 * Latest tax-sale year for ONE parcel's PIN, or `null` when the PIN is blank,
 * has no tax-sale record, has only null-year records, or the tables were absent
 * (`saleYearsByPin === null`). The per-point analogue of
 * taxSaleExposureForVacantPins — colors a single map dot's distress flag.
 */
export function latestSaleYearForPin(
  pin: string | null | undefined,
  saleYearsByPin: ReadonlyMap<string, readonly number[]> | null,
): number | null {
  if (!pin || saleYearsByPin === null) return null;
  const years = saleYearsByPin.get(pin);
  if (years === undefined) return null;
  let latest: number | null = null;
  for (const year of years) {
    if (Number.isFinite(year) && (latest === null || year > latest)) latest = year;
  }
  return latest;
}

/**
 * Count how many of `normAddresses` (one normalized address per tracked vacant
 * row — may repeat) are present in `addressSet` (normalized addresses of
 * vacant-building violations). Blank addresses never match. `addressSet ===
 * null` (table absent) → `null`, never a silent 0.
 */
export function countAddressesInSet(
  normAddresses: readonly string[],
  addressSet: ReadonlySet<string> | null,
): number | null {
  if (addressSet === null) return null;
  let matches = 0;
  for (const addr of normAddresses) {
    if (addr && addressSet.has(addr)) matches += 1;
  }
  return matches;
}

/**
 * True when ONE tracked row's normalized address matched a vacant-building-
 * violation record. A blank address never matches; `addressSet === null` (table
 * absent) → `false`, never a fabricated flag. The per-point analogue of
 * countAddressesInSet — flags a single tracked map dot.
 */
export function addressHasViolation(
  normAddress: string,
  addressSet: ReadonlySet<string> | null,
): boolean {
  if (addressSet === null || !normAddress) return false;
  return addressSet.has(normAddress);
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

// ── Intervention portfolios (pure, D1) ─────────────────────────────────────

/** Display labels for the four portfolios. */
import {
  PORTFOLIO_LABELS,
  PORTFOLIO_ORDER,
  PORTFOLIO_RUBRIC_NOTE,
  portfolioForSite,
  tallyPortfolioCounts,
  type VacancyPortfolio,
} from "./vacancy-portfolio";

export {
  PORTFOLIO_LABELS,
  PORTFOLIO_ORDER,
  PORTFOLIO_RUBRIC_NOTE,
  portfolioForSite,
  tallyPortfolioCounts,
};
export type { VacancyPortfolio };

// ── Spatial helpers (pure) ──────────────────────────────────────────────────

/** Great-circle distance in metres between two lon/lat points. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when two [minLon,minLat,maxLon,maxLat] boxes overlap (touching counts). */
export function bboxIntersects(a: VacancyBbox, b: VacancyBbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Ray-cast point-in-ring test. `ring` is [lon,lat] pairs. */
function pointInLonLatRing(lon: number, lat: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Metres from a query point to a segment, via a local equirectangular
 * projection centred on the query point (accurate at the ~400 m scale used
 * for corridor labelling). Segment endpoints are [lon,lat]. */
function distancePointToSegmentMeters(
  lat: number,
  lon: number,
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const ax = (aLon - lon) * mPerDegLon;
  const ay = (aLat - lat) * mPerDegLat;
  const bx = (bLon - lon) * mPerDegLon;
  const by = (bLat - lat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (-ax * dx + -ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(cx, cy);
}

/**
 * A corridor polygon parsed for spatial tests: its name, kind, bounding box,
 * and outer ring(s) as [lon,lat] pairs. Built by the export from the corridor
 * geojsons; kept here so the spatial helpers stay pure and unit-testable.
 */
export interface CorridorPolygon {
  name: string;
  kind: CorridorKind;
  bbox: VacancyBbox;
  rings: [number, number][][];
}

/**
 * The named corridors whose bbox overlaps `bbox`, deduped by name (first kind
 * wins on a name collision). A bbox-overlap test is deliberately sufficient
 * here — an edition lists a corridor as "nearby context", not as a strict
 * geometric containment, so the cheap rectangle test is the intended contract.
 */
export function corridorRefsIntersectingBbox(
  corridors: readonly CorridorPolygon[],
  bbox: VacancyBbox,
): CorridorRef[] {
  const seen = new Set<string>();
  const out: CorridorRef[] = [];
  for (const c of corridors) {
    if (!bboxIntersects(c.bbox, bbox)) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: c.name, kind: c.kind });
  }
  return out;
}

/**
 * Name of the corridor CONTAINING the point, else the NEAREST corridor whose
 * edge is within `maxMeters` (default 400), else `null`. Containment is checked
 * first in array order (first hit wins); the nearest fallback breaks ties by
 * array order (strict `<`), so the result is deterministic.
 */
export function nearestCorridorName(
  lat: number,
  lon: number,
  corridors: readonly CorridorPolygon[],
  maxMeters = 400,
): string | null {
  for (const c of corridors) {
    for (const ring of c.rings) {
      if (pointInLonLatRing(lon, lat, ring)) return c.name;
    }
  }
  const padLat = maxMeters / 111320;
  const padLon = maxMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  let best: string | null = null;
  let bestD = maxMeters;
  for (const c of corridors) {
    if (
      lon < c.bbox[0] - padLon ||
      lon > c.bbox[2] + padLon ||
      lat < c.bbox[1] - padLat ||
      lat > c.bbox[3] + padLat
    ) {
      continue;
    }
    for (const ring of c.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distancePointToSegmentMeters(
          lat,
          lon,
          ring[i][0],
          ring[i][1],
          ring[j][0],
          ring[j][1],
        );
        if (d < bestD) {
          bestD = d;
          best = c.name;
        }
      }
    }
  }
  return best;
}

// ── Vacancy clusters (pure, D2) ─────────────────────────────────────────────

/** The printable clustering-method note (honest about the analytical boundary
 * AND the extent cap that divides contiguous vacancy fields into sub-areas —
 * without the cap, dense-vacancy ZIPs chain into one useless multi-thousand-site
 * blob). */
export const CLUSTERS_NOTE =
  "Proximity clusters: tracked sites within ~100 m linked; contiguous areas " +
  "larger than ~500 m are divided into sub-areas for intervention planning; " +
  "minimum five sites. Boundaries are analytical, not parcel-contiguous.";

/** One tracked site fed to clusterVacantSites — coordinate plus the flags the
 * cluster aggregates. `taxSale` is `saleYear != null`; `portfolio` is
 * portfolioForSite's output. */
export interface ClusterInputSite {
  lat: number;
  lon: number;
  ownerType: OwnerType;
  portfolio: VacancyPortfolio;
  taxSale: boolean;
  violation: boolean;
  propertyType: VacancyPropertyType;
}

/**
 * Deterministic single-linkage proximity clustering via a grid-bucketed
 * union-find, with an EXTENT CAP that divides oversized contiguous groups into
 * sub-areas. Two sites link when their haversine distance is <= `linkMeters`;
 * the grid (cell ≈ linkMeters) restricts the pairwise test to the same and
 * adjacent cells, so any two points within `linkMeters` are guaranteed to be
 * compared.
 *
 * Extent cap (`maxExtentMeters`, default 500): single-linkage chains degenerate
 * blobs in dense-vacancy ZIPs (a contiguous vacancy field can union thousands
 * of sites — useless for sub-corridor intervention planning), so after grouping
 * and BEFORE the minSize filter, any group whose bbox exceeds `maxExtentMeters`
 * on either axis (lon extent measured in metres via cos(midLat)) is recursively
 * bisected: points sorted along the LONGER geographic axis (ties broken by the
 * other axis, then original index), split at floor(n/2), both halves recursed.
 * Pieces smaller than `minSize` after splitting are dropped (same noise rule).
 *
 * Ordering is stable and input-order-independent: clusters are sorted by count
 * desc, then centroid lat asc, then centroid lon asc, and numbered 1..N. The
 * transitive closure a single-linkage partition produces is independent of the
 * scan order, the bisection sorts on coordinates, and each piece aggregates in
 * canonical coordinate order — so a shuffled input yields byte-identical output.
 *
 * `corridorName` is left `null` here (this function has no corridor geometry);
 * the export fills it in via nearestCorridorName (D3).
 */
export function clusterVacantSites(
  rows: readonly ClusterInputSite[],
  opts: { linkMeters?: number; minSize?: number; maxExtentMeters?: number } = {},
): VacancyCluster[] {
  const linkMeters = opts.linkMeters ?? 100;
  const minSize = opts.minSize ?? 5;
  const maxExtentMeters = opts.maxExtentMeters ?? 500;
  const n = rows.length;
  if (n === 0) return [];

  // Union-find (path halving; union toward the smaller root for stability).
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };

  // Grid buckets. Cell ≈ linkMeters at Chicago's latitude.
  const REF_LAT = 41.85;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((REF_LAT * Math.PI) / 180);
  const cellLat = linkMeters / mPerDegLat;
  const cellLon = linkMeters / mPerDegLon;
  const rowOf = (i: number) => Math.floor(rows[i].lat / cellLat);
  const colOf = (i: number) => Math.floor(rows[i].lon / cellLon);
  const key = (r: number, c: number) => `${r}:${c}`;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(rowOf(i), colOf(i));
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  }

  for (let i = 0; i < n; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const arr = buckets.get(key(r + dr, c + dc));
        if (!arr) continue;
        for (const j of arr) {
          if (j <= i) continue; // each unordered pair once
          if (haversineMeters(rows[i].lat, rows[i].lon, rows[j].lat, rows[j].lon) <= linkMeters) {
            union(i, j);
          }
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  // ── Extent cap: recursively bisect any group whose bbox exceeds
  //    maxExtentMeters on either axis (BEFORE the minSize filter). ──
  const splitGroup = (idxs: number[]): number[][] => {
    if (idxs.length < 2) return [idxs];
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const i of idxs) {
      const { lat, lon } = rows[i];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const midLat = (minLat + maxLat) / 2;
    const latExtentM = (maxLat - minLat) * mPerDegLat;
    const lonExtentM = (maxLon - minLon) * mPerDegLat * Math.cos((midLat * Math.PI) / 180);
    if (latExtentM <= maxExtentMeters && lonExtentM <= maxExtentMeters) return [idxs];

    // Bisect along the LONGER geographic axis; ties broken by the other axis,
    // then original index (stable, coordinate-driven → shuffle-invariant for
    // distinct coordinates).
    const byLat = latExtentM >= lonExtentM;
    const sorted = [...idxs].sort((a, b) =>
      byLat
        ? rows[a].lat - rows[b].lat || rows[a].lon - rows[b].lon || a - b
        : rows[a].lon - rows[b].lon || rows[a].lat - rows[b].lat || a - b,
    );
    const mid = Math.floor(sorted.length / 2);
    return [...splitGroup(sorted.slice(0, mid)), ...splitGroup(sorted.slice(mid))];
  };

  const pieces: number[][] = [];
  for (const idxs of groups.values()) pieces.push(...splitGroup(idxs));

  const built: Omit<VacancyCluster, "id">[] = [];
  for (const idxs of pieces) {
    if (idxs.length < minSize) continue;
    // Aggregate in a canonical coordinate order so the centroid's floating-point
    // summation is identical regardless of the input row order (the partition
    // itself is already order-independent).
    const ordered = [...idxs].sort(
      (a, b) => rows[a].lat - rows[b].lat || rows[a].lon - rows[b].lon,
    );
    let sumLat = 0;
    let sumLon = 0;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let taxSaleCount = 0;
    let violationCount = 0;
    let vacantLandCount = 0;
    let vacantBuildingCount = 0;
    const ownerTypes: OwnerType[] = [];
    const portfolios: VacancyPortfolio[] = [];
    for (const i of ordered) {
      const row = rows[i];
      sumLat += row.lat;
      sumLon += row.lon;
      if (row.lon < minLon) minLon = row.lon;
      if (row.lon > maxLon) maxLon = row.lon;
      if (row.lat < minLat) minLat = row.lat;
      if (row.lat > maxLat) maxLat = row.lat;
      if (row.taxSale) taxSaleCount += 1;
      if (row.violation) violationCount += 1;
      if (row.propertyType === "vacant_land") vacantLandCount += 1;
      else vacantBuildingCount += 1;
      ownerTypes.push(row.ownerType);
      portfolios.push(row.portfolio);
    }
    const count = ordered.length;
    built.push({
      centroid: { lat: sumLat / count, lon: sumLon / count },
      bbox: [minLon, minLat, maxLon, maxLat],
      count,
      ownerTypeCounts: tallyOwnerTypeCounts(ownerTypes),
      portfolioCounts: tallyPortfolioCounts(portfolios),
      taxSaleCount,
      violationCount,
      vacantLandCount,
      vacantBuildingCount,
      corridorName: null,
    });
  }

  built.sort(
    (a, b) =>
      b.count - a.count ||
      a.centroid.lat - b.centroid.lat ||
      a.centroid.lon - b.centroid.lon,
  );
  return built.map((c, i) => ({ id: i + 1, ...c }));
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
