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
import type {
  OwnerGeography,
  OwnerStructure,
  OwnerStructureCount,
  StructureGeographyCell,
} from "./owner-taxonomy";

/**
 * How a tracked row's PIN was established, for the directory's "back-search"
 * (CookViewer/Clerk) pathway. `inventory` = a City-Owned Land Server row that
 * carries its 14-digit PIN natively; `address_matched` = a 311 building row
 * whose normalized address matched EXACTLY ONE parcel at export time (the PIN,
 * structure, and geography are taken from that parcel); `unmatched` = a 311 row
 * with no unique parcel match (pin stays null, structure/geography unresolved).
 */
export type PinMatchKind = "inventory" | "address_matched" | "unmatched";

// ── Data contract ────────────────────────────────────────────────────────

export type VacancyPriorityTier = "high" | "medium" | "low";
export type VacancyPropertyType = "vacant_land" | "vacant_building";
export type TransportKind = "expressway" | "rail";

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
 * lists all five owner types in OWNER_TYPE_ORDER (honest zeros).
 * `corridorName` is the containing or nearest named
 * corridor within ~400 m, else `null`.
 */
export interface VacancyCluster {
  id: number; // 1..N, ordered by count desc then centroid lat/lon
  centroid: { lat: number; lon: number };
  bbox: VacancyBbox;
  count: number;
  ownerTypeCounts: OwnerTypeCount[];
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

/**
 * The six consolidated occupancy-premised exemption EAV amounts carried on one
 * parcel for a given tax year, mirroring the parcel_exemptions table (the
 * PTAXSIM veteran columns are already summed into `vet`). Every value is an EAV
 * amount in dollars; `0` means the exemption is not present. These exemptions
 * are ALL occupancy-premised — each presumes the parcel is the claimant's
 * principal residence.
 */
export interface ExemptionEavs {
  homeowner: number;
  senior: number;
  freeze: number;
  disabled: number;
  vet: number;
  longtime: number;
}

/** The two anomaly universes, kept strictly separate (never conflated):
 *   • `land`     — an occupancy exemption on a class-1xx vacant LAND parcel:
 *                  IMPOSSIBLE-ON-ITS-FACE (a lot cannot be a principal residence).
 *   • `building` — an occupancy exemption on a vacant-classed / 311 vacant
 *                  BUILDING: PLAUSIBLE-BUT-STALE (a home that has since emptied).
 */
export type ExemptionUniverse = "land" | "building";

/**
 * One parcel considered for the exemption-anomaly overlay: its universe, its
 * exemption EAVs, and the latest recorded transfer date (null when the parcel
 * has no MyDec transfer on record — MyDec coverage begins ~2009, so a null is a
 * FLOOR, not a proof of no sale). Pure input to deriveExemptionAnomalies —
 * carries no owner name or mailing address (those never reach the aggregation).
 */
export interface ExemptionAnomalyParcel {
  pin: string;
  universe: ExemptionUniverse;
  exemptions: ExemptionEavs;
  /** Latest recorded transfer date (YYYY-MM-DD) or null. */
  latestTransferDate: string | null;
}

/** One universe's anomaly split: how many anomalous parcels in total (`any`),
 * how many carry a senior/senior-freeze exemption (`senior` ⊆ `any`), and how
 * many have had no recorded transfer in ≥10 years (`noTransfer10y` ⊆ `any`). */
export interface ExemptionAnomalySplit {
  any: number;
  senior: number;
  noTransfer10y: number;
}

/**
 * Per-edition exemption-anomaly AGGREGATES (public-safe — counts only, never
 * pins). `null` on the edition when the parcel_exemptions table was absent on
 * the refresh branch (degrade to "not yet available", never a fabricated zero).
 * The two universes are kept separate by design. Every count is a FLOOR:
 * unmatched 311 rows are invisible, MyDec transfers only reach ~2009, and the
 * exemption data lags to its tax year.
 */
export interface ExemptionAnomalies {
  /** The exemption tax year these anomalies are measured at (the latest year in
   * PTAXSIM — 2024 as of the pinned version). */
  taxYear: number;
  /** Occupancy exemptions on class-1xx vacant LAND (impossible-on-its-face). */
  landImpossible: ExemptionAnomalySplit;
  /** Occupancy exemptions on vacant BUILDINGS (plausible-but-stale). */
  buildingStale: ExemptionAnomalySplit;
  /** Total exemption EAV across the LAND anomalies only (condos excluded — the
   * land universe is class-1xx by construction). Presented as an order-of-
   * magnitude figure, never to the dollar. `null` when no land anomaly exists. */
  exemptEavLandTotal: number | null;
}

/**
 * The additive v2 two-axis ownership breakdown for one edition. Computed at
 * export time ALONGSIDE the legacy owner-type series (deriveLandUniverse and the
 * legacy city-fold logic are untouched — this never re-derives them):
 *   • `landUniverse`          — the reconciled vacant-land parcels tallied by
 *                                STRUCTURE (a City-inventory PIN match counts as
 *                                government), honest zeros. `null` exactly when
 *                                the raw parcels series is `null`.
 *   • `landUniverseByGeography`— the same parcels as a full STRUCTURE × GEOGRAPHY
 *                                cross-tab (the two-axis table). `null` with the
 *                                same availability as `landUniverse`.
 *   • `trackedInventory`      — the tracked operational list (COLS + 311) tallied
 *                                by STRUCTURE, always available (COLS rows are
 *                                government; unmatched 311 rows are unresolved).
 */
export interface OwnershipStructureBreakdown {
  landUniverse: OwnerStructureCount[] | null;
  landUniverseByGeography: StructureGeographyCell[] | null;
  trackedInventory: OwnerStructureCount[];
}

/** Per-edition 311-building parcel-matching tally (see PinMatchKind): how many
 * 311 building rows resolved to a unique parcel (`matched`) vs did not
 * (`unmatched`). `null` when the parcels table was absent on the refresh branch
 * (no matching could run) — never a fabricated zero. COLS inventory rows are not
 * counted here (they carry their PIN natively). */
export interface BuildingPinMatchStats {
  matched: number;
  unmatched: number;
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

/**
 * How firmly a map dot's owner type is established, for the site card's honesty
 * line (never a name): `pin_matched` = the parcel PIN is in the City's own land
 * inventory (authoritative city_public); `needs_verification` = owner type is
 * unknown; `inferred` = a taxpayer-record classification we accept but have not
 * PIN-confirmed. See ownerConfidenceForPoint for the derivation.
 */
export type OwnerConfidence = "pin_matched" | "inferred" | "needs_verification";

/** A single vacant site as a map dot. `markerNumber` is 1–12 on the featured
 * site-index sites and `null` on the rest. The internal ordering rubric that
 * selects them NEVER serializes — public rows carry source evidence only,
 * never a rank, score, or derived bucket. */
export interface VacancySitePoint {
  lat: number;
  lon: number;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  markerNumber: number | null;
  /** Street address from the tracked row; `null` when the row carried none. */
  address: string | null;
  /** Digits-only 14-digit PIN for a COLS inventory row; `null` for 311 rows
   * (which carry no PIN — honest) and any COLS row without a real 14-digit PIN. */
  pin: string | null;
  /** Lot size in square feet (COLS rows carry it; 311 rows do not -> null). */
  squareFeet: number | null;
  /** Chicago zoning district code (COLS rows only; 311 rows -> null). */
  zoningClass: string | null;
  /** Number of incentive geographies this site intersects (0 when none). */
  incentiveCount: number;
  /** Owner-type confidence (see OwnerConfidence): COLS City-inventory rows are
   * `pin_matched`, unknown-owner rows `needs_verification`, else `inferred`. */
  ownerConfidence: OwnerConfidence;
  /** The kept proximity-cluster id (1..12) this point landed in, or `null` when
   * it fell in no cluster or in one ranked outside the edition's kept top 12. */
  clusterId: number | null;
  /** Latest tax-sale year when this point's parcel (a COLS row's PIN) is in the
   * scavenger/annual sale set; `null` for 311 rows (which carry no PIN — honest)
   * and when the tax-sale tables were absent on the refresh branch. */
  saleYear: number | null;
  /** True when this tracked row's normalized address matched ≥1 vacant-building-
   * violation record (the same match the edition-level violationMatchCount
   * counts); `false` when the violations table was absent on the branch. */
  violation: boolean;
  /** v2 STRUCTURE axis (from the taxpayer name of the resolved parcel): COLS
   * inventory rows are `government`; 311 rows take the matched parcel's structure
   * when `pinMatch === "address_matched"`, else `unresolved`. */
  ownerStructure: OwnerStructure;
  /** v2 GEOGRAPHY axis — FROM THE TAXPAYER MAILING ADDRESS, always surfaced as
   * such. COLS rows are `in_state`; 311 rows take the matched parcel's geography
   * when matched, else `unknown`. */
  ownerGeography: OwnerGeography;
  /** How this row's PIN was established (see PinMatchKind). Gives every tracked
   * row its back-search pathway: `inventory`/`address_matched` carry a real PIN
   * (CookViewer + Clerk links resolve), `unmatched` has none. */
  pinMatch: PinMatchKind;
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
  /** Parcel street address from `parcels.address`; `null` when the column was
   * null for this parcel. */
  address: string | null;
  /** Digits-only parcel PIN (every assessor parcel has one; may be "" if the
   * source row's PIN was blank). */
  pin: string;
  /** Lot size in square feet from `parcels.land_sqft`; `null` when the column
   * was null (historically common — emitted null-safe, never coerced to 0). */
  squareFeet: number | null;
  /** Owner-type confidence (see OwnerConfidence): City-inventory PIN match is
   * `pin_matched`, unknown taxpayer type `needs_verification`, else `inferred`.
   * Land parcels are not clustered, so they carry no clusterId. */
  ownerConfidence: OwnerConfidence;
  saleYear: number | null;
  /** v2 STRUCTURE axis, from the parcel's taxpayer name (a City-inventory PIN
   * match forces `government`, mirroring the reconciled owner type). */
  ownerStructure: OwnerStructure;
  /** v2 GEOGRAPHY axis — FROM THE TAXPAYER MAILING ADDRESS (a City-inventory PIN
   * match forces `in_state`). Always surfaced as "taxpayer mailing". */
  ownerGeography: OwnerGeography;
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
  /** The kept proximity-cluster id this row's mapped site landed in, or `null`
   * when unmapped / in no kept cluster. Lets the directory restore an
   * Opportunity-Area filter from a URL. */
  clusterId: number | null;
  /** Same pin-derived tax-sale flag the matching sitePoint carries; `null` for
   * 311 rows (no PIN) and when the tax-sale tables were absent on the branch. */
  saleYear: number | null;
  /** Same address-match violation flag the matching sitePoint carries; `false`
   * when the violations table was absent on the branch. */
  violation: boolean;
  /** Digits-only 14-digit PIN from either source (COLS inventory or a
   * uniquely address-matched 311 parcel); `null` when unmatched. Lights the
   * directory's Verify column (CookViewer/Clerk back-search). */
  pin: string | null;
  /** v2 STRUCTURE axis (same derivation as the matching sitePoint). */
  ownerStructure: OwnerStructure;
  /** v2 GEOGRAPHY axis — FROM THE TAXPAYER MAILING ADDRESS. */
  ownerGeography: OwnerGeography;
}

/**
 * The lazy-loaded per-ZIP site directory file. Holds EVERY tracked row with a
 * non-empty address, in a deterministic decision-first order (internal ordering
 * applied at export time, then address asc — the criteria are not serialized),
 * plus an honest count of the rows dropped for a missing/empty address.
 */
export interface VacancyDirectoryFile {
  zip: string;
  neighborhood: string;
  generatedAt: string;
  rows: VacancyDirectoryRow[];
  /** Tracked rows dropped from `rows` for a missing/empty address (honest). */
  excludedNoAddressCount: number;
}

/** One row of the page-04 site index (the featured sites — selected by an
 * internal deterministic ordering at export time; the criteria never
 * serialize). */
export interface VacancySiteIndexRow {
  markerNumber: number | null;
  address: string;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  zoningClass: string | null; // COLS only; 311 rows have none -> null -> "PENDING"
  squareFeet: number | null;
  incentiveCount: number;
  nextStep: string;
  lat: number;
  lon: number;
  /** Digits-only 14-digit PIN (COLS inventory or a uniquely address-matched 311
   * parcel); `null` when unmatched. Lets the web report's Verify column link out
   * without re-joining by coordinate. */
  pin: string | null;
  /** v2 STRUCTURE axis (same derivation as the matching sitePoint). */
  ownerStructure: OwnerStructure;
  /** v2 GEOGRAPHY axis — FROM THE TAXPAYER MAILING ADDRESS. */
  ownerGeography: OwnerGeography;
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
    /** The additive v2 two-axis breakdown (structure, and structure × geography);
     * `null` only when NO ownership series/tracked context could be built at all.
     * Its `landUniverse`/`landUniverseByGeography` share the raw parcels series'
     * availability; `trackedInventory` is always present. */
    structureBreakdown: OwnershipStructureBreakdown | null;
  };
  /** Phase-2 distress overlays for this edition, or `null` when no distress
   * source table was present on the refresh branch (degrade gracefully). */
  distress: VacancyDistressSignals | null;
  /** Exemption-anomaly AGGREGATES (public-safe, counts only). `null` when the
   * parcel_exemptions table was absent on the refresh branch. Parcel-level
   * detail is NEVER in this file — it lives in the private referral packet
   * (data/private/exemption-anomalies.json), served only behind the admin gate. */
  exemptionAnomalies: ExemptionAnomalies | null;
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
  /** Per-edition 311-building parcel-matching counts (see BuildingPinMatchStats);
   * `null` when the parcels table was absent on the refresh branch. Sanity-check
   * the matched rate after an export — a low rate signals a normalization
   * mismatch between the 311 and parcel address forms. */
  buildingPinMatch: BuildingPinMatchStats | null;
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

// ── Priority rubric (pure, EXPORT-SIDE INTERNAL) ───────────────────────────
//
// The rubric below orders sites at export time (which sites lead the
// directory, which become the featured site index). It is INTERNAL: the
// score, tier, and rubric copy must never be serialized into a public
// artifact (vacancy-index.json, the directory files, the shareable PDF) or
// shipped to the browser. Public rows carry only the resulting order and
// source evidence fields.

/** Fields computeSitePriority / nextStepForSite read off a site. */
export interface VacancySiteScoreFields {
  incentiveCount: number;
  squareFeet: number | null;
  ownerType: OwnerType;
  status: string | null;
  propertyType: VacancyPropertyType;
}

/**
 * Priority score + tier for one vacant site (internal ordering only — never
 * printed or serialized):
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

// ── Reconciled land universe (pure derivation) ─────────────────────────────

/** One owner-type row of the reconciled land-universe ownership table. */
export interface LandUniverseOwnerRow {
  ownerType: OwnerType;
  count: number;
}

/** The reconciliation arithmetic behind the land universe — a small ledger the
 * report renders line by line. `inventoryTotal + assessorOnly === total`, and
 * `inventoryTotal === pinMatches + inventoryOnly`. */
export interface LandUniverseComponents {
  /** City-inventory vacant-land parcels (= headline.vacantLandCount). */
  inventoryTotal: number;
  /** Assessor-classed vacant-land parcels (= ownership.vacantLandParcelTotal). */
  assessorTotal: number;
  /** Parcels present in BOTH land sources (= reconciliation.cityPinMatches). */
  pinMatches: number;
  /** City-inventory parcels the Assessor does not class as vacant land
   * (= inventoryTotal − pinMatches, verified against inventoryUnmatchedCount). */
  inventoryOnly: number;
  /** Assessor parcels absent from the City inventory (= assessorTotal − pinMatches). */
  assessorOnly: number;
}

/**
 * The reconciled LAND universe: the deduplicated union of the City land
 * inventory and the Assessor's vacant-land classification, with a five-row
 * ownership table that partitions that union. This is the single "who controls
 * the vacant land" claim — distinct from the tracked operational list (COLS +
 * 311) and from the 311-reported buildings (unverified ownership).
 *
 * Arithmetic (South Chicago / 60617 as the worked example):
 *   inventory 864 + assessor 1735 − both 132 = 2467 unique land parcels.
 * Ownership table over that 2467: City/Public = inventory (864) + the assessor
 * parcels already classed public that are NOT in the City inventory
 * (reconciled city 135 − pinMatches 132 = 3) = 867; the four private/unknown
 * rows keep their reconciled counts. The table sums to the union total.
 */
export interface LandUniverse {
  /** Deduplicated union parcel count (= inventoryTotal + assessorOnly). */
  total: number;
  /** Five ownership rows in OWNER_TYPE_ORDER; sums to `total`. */
  byOwnerType: LandUniverseOwnerRow[];
  components: LandUniverseComponents;
}

/**
 * Derive the reconciled land universe for one edition (pure). Returns `null`
 * exactly when the ownership source series or the reconciliation is missing
 * (the same availability the raw parcels series carries) — the report degrades
 * to the tracked-inventory context rather than fabricating a universe.
 *
 * The City/Public union row folds in `pinMatches` (parcels present in both land
 * sources), NOT the taxpayer-reclassification count: pinMatches is the overlap
 * that both the ledger subtraction and the ownership partition must use for the
 * table to close on the union total. (`reconciliation.reclassifiedCount`
 * equals pinMatches on eight of the nine committed editions and diverges by two
 * only on 60624, where using pinMatches is the arithmetically correct closing
 * value — see the footnote copy: "City-inventory parcels plus additional public
 * parcels identified through assessor taxpayer records", i.e. reconciled city
 * minus the matches already counted inside the inventory.)
 *
 * Enforces the arithmetic identities at call time and THROWS on any violation:
 * an identity break means upstream data corruption, and a loud failure is
 * safer than a silently wrong "who controls" claim.
 */
export function deriveLandUniverse(edition: VacancyIndexEdition): LandUniverse | null {
  const { headline, ownership } = edition;
  const reconciled = ownership.reconciledVacantLandByOwnerType;
  const reconciliation = ownership.reconciliation;

  // Null iff the ownership source series / reconciliation could not be built.
  if (
    ownership.vacantLandParcelsByOwnerType == null ||
    reconciliation == null ||
    reconciled == null ||
    ownership.vacantLandParcelTotal == null
  ) {
    return null;
  }

  const inventoryTotal = headline.vacantLandCount;
  const assessorTotal = ownership.vacantLandParcelTotal;
  const pinMatches = reconciliation.cityPinMatches;
  const inventoryOnly = inventoryTotal - pinMatches;
  const assessorOnly = assessorTotal - pinMatches;
  const total = inventoryTotal + assessorOnly; // = inventory + assessor − both

  const rec = new Map<OwnerType, number>();
  for (const r of reconciled) rec.set(normalizeOwnerType(r.ownerType), r.count);
  const reconciledCity = rec.get("city_public") ?? 0;

  // City/Public over the union = all City-inventory parcels + assessor parcels
  // already classed public that fall outside the inventory (reconciledCity minus
  // the overlap already counted in inventoryTotal).
  const cityUnion = inventoryTotal + (reconciledCity - pinMatches);

  const byOwnerType: LandUniverseOwnerRow[] = OWNER_TYPE_ORDER.map((ownerType) =>
    ownerType === "city_public"
      ? { ownerType, count: cityUnion }
      : { ownerType, count: rec.get(ownerType) ?? 0 },
  );

  // ── Dev-time identity enforcement (throw on corruption) ──
  const reconciledSum = reconciled.reduce((s, r) => s + r.count, 0);
  const ownerSum = byOwnerType.reduce((s, r) => s + r.count, 0);
  const problems: string[] = [];

  for (const [name, v] of [
    ["inventoryTotal", inventoryTotal],
    ["assessorTotal", assessorTotal],
    ["pinMatches", pinMatches],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) problems.push(`${name} not a non-negative integer (${v})`);
  }
  if (pinMatches > inventoryTotal) problems.push(`pinMatches ${pinMatches} exceeds inventoryTotal ${inventoryTotal}`);
  if (pinMatches > assessorTotal) problems.push(`pinMatches ${pinMatches} exceeds assessorTotal ${assessorTotal}`);
  if (inventoryOnly !== reconciliation.inventoryUnmatchedCount) {
    problems.push(
      `inventoryOnly ${inventoryOnly} (inventoryTotal − pinMatches) != reported inventoryUnmatchedCount ${reconciliation.inventoryUnmatchedCount}`,
    );
  }
  if (reconciledSum !== assessorTotal) {
    problems.push(`reconciled series sums to ${reconciledSum}, not assessorTotal ${assessorTotal}`);
  }
  if (reconciledCity < pinMatches) {
    problems.push(`reconciled city_public ${reconciledCity} is below pinMatches ${pinMatches}`);
  }
  for (const row of byOwnerType) {
    if (!Number.isInteger(row.count) || row.count < 0) {
      problems.push(`byOwnerType ${row.ownerType} not a non-negative integer (${row.count})`);
    }
  }
  // The governing identity: the union total is the ledger total AND the
  // ownership table total — no leading with two competing figures.
  if (total !== inventoryTotal + assessorOnly) {
    problems.push(`total ${total} != inventoryTotal + assessorOnly ${inventoryTotal + assessorOnly}`);
  }
  if (total !== ownerSum) {
    problems.push(`ownership table sums to ${ownerSum}, not the union total ${total}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `deriveLandUniverse: land-universe identity violation for ZIP ${edition.zip} — ${problems.join("; ")}`,
    );
  }

  return {
    total,
    byOwnerType,
    components: { inventoryTotal, assessorTotal, pinMatches, inventoryOnly, assessorOnly },
  };
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
 * counted rather than coerced to a placeholder. `priorityScore` is the
 * INTERNAL ordering input — it decides the emitted row order but is never
 * copied onto the public row. */
export interface DirectoryInputSite {
  address: string | null | undefined;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  /** Internal ordering input (export-side only; not emitted). */
  priorityScore: number;
  clusterId: number | null;
  saleYear: number | null;
  violation: boolean;
  /** v2 back-search + two-axis fields threaded onto the directory row. */
  pin: string | null;
  ownerStructure: OwnerStructure;
  ownerGeography: OwnerGeography;
}

/**
 * Directory ordering: internal priorityScore desc, then address asc (plain
 * lexical). The same total order the site index leads with, but keyed on
 * address rather than the id tiebreak (the directory never exposes ids).
 * Deterministic across export runs; the score itself never serializes.
 */
export function compareDirectoryInputs(
  a: Pick<DirectoryInputSite, "priorityScore"> & { address: string },
  b: Pick<DirectoryInputSite, "priorityScore"> & { address: string },
): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/**
 * Build the site directory rows from the tracked scored sites: keep every site
 * whose address is non-empty (after trim), drop and count the rest, and order
 * by compareDirectoryInputs — the internal score orders the rows but is NOT
 * emitted onto them. Pure — unit-tested without a DB. The `excludedNoAddress
 * Count` is the honest "records without a usable address omitted" figure the
 * web report footer prints.
 */
export function buildDirectoryRows(
  sites: readonly DirectoryInputSite[],
): { rows: VacancyDirectoryRow[]; excludedNoAddressCount: number } {
  const kept: (DirectoryInputSite & { address: string })[] = [];
  let excludedNoAddressCount = 0;
  for (const s of sites) {
    const address = (s.address ?? "").trim();
    if (!address) {
      excludedNoAddressCount += 1;
      continue;
    }
    kept.push({ ...s, address });
  }
  kept.sort(compareDirectoryInputs);
  const rows: VacancyDirectoryRow[] = kept.map((s) => ({
    address: s.address,
    ownerType: s.ownerType,
    propertyType: s.propertyType,
    clusterId: s.clusterId,
    saleYear: s.saleYear,
    violation: s.violation,
    pin: s.pin,
    ownerStructure: s.ownerStructure,
    ownerGeography: s.ownerGeography,
  }));
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

/**
 * How firmly ONE point's owner type is established, for the site card's honesty
 * line. First match wins:
 *   1. PIN in the City land inventory        -> "pin_matched" (authoritative)
 *   2. otherwise, owner type is "unknown"     -> "needs_verification"
 *   3. otherwise (a known taxpayer type)      -> "inferred"
 * Pure — the per-point analogue of reconcileOwnerTypeForPin: a `pin_matched`
 * point is exactly one reconcileOwnerTypeForPin sends to city_public.
 */
export function ownerConfidenceForPoint(
  pin: string | null | undefined,
  ownerType: OwnerType,
  inventoryPins: ReadonlySet<string>,
): OwnerConfidence {
  if (pin && inventoryPins.has(pin)) return "pin_matched";
  if (ownerType === "unknown") return "needs_verification";
  return "inferred";
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

// ── Exemption-anomaly aggregation (pure) ───────────────────────────────────

/** True when a parcel carries ANY occupancy-premised exemption (EAV > 0). Each
 * of the six exemptions presumes the parcel is a principal residence, so any of
 * them on a vacant parcel is a record anomaly warranting official review. */
export function hasOccupancyExemption(e: ExemptionEavs): boolean {
  return (
    e.homeowner > 0 ||
    e.senior > 0 ||
    e.freeze > 0 ||
    e.disabled > 0 ||
    e.vet > 0 ||
    e.longtime > 0
  );
}

/** True when a parcel carries a senior OR senior-freeze exemption (EAV > 0) —
 * the senior subset flagged separately (elderly-claimant occupancy exemptions
 * on a vacant parcel warrant particular review). */
export function isSeniorExemption(e: ExemptionEavs): boolean {
  return e.senior > 0 || e.freeze > 0;
}

/** Sum of all six occupancy-exemption EAV amounts on one parcel. */
export function totalExemptionEav(e: ExemptionEavs): number {
  return e.homeowner + e.senior + e.freeze + e.disabled + e.vet + e.longtime;
}

/** True when the parcel has had NO recorded transfer in ≥10 years relative to
 * `taxYear`: either no MyDec transfer on record at all (null — a floor, since
 * MyDec coverage begins ~2009), or the latest transfer year is < taxYear − 10.
 * A blank/unparseable date is treated as "no transfer". */
export function noTransferInDecade(
  latestTransferDate: string | null,
  taxYear: number,
): boolean {
  if (!latestTransferDate) return true;
  const year = Number(latestTransferDate.slice(0, 4));
  if (!Number.isFinite(year)) return true;
  return year < taxYear - 10;
}

/**
 * Aggregate the exemption-anomaly overlay from a list of anomaly-candidate
 * parcels. Only parcels that actually carry an occupancy exemption
 * (hasOccupancyExemption) count — the caller may pass a wider list; non-
 * anomalies are ignored here so the derivation is self-contained. The two
 * universes (land = impossible-on-its-face; building = plausible-but-stale) are
 * tallied separately and NEVER conflated. `exemptEavLandTotal` sums the EAV of
 * the land anomalies only (condos excluded by construction — the land universe
 * is class-1xx) and is `null` when there is no land anomaly. Pure — unit-tests
 * without a DB. Every count is a FLOOR (see ExemptionAnomalies).
 */
export function deriveExemptionAnomalies(
  parcels: readonly ExemptionAnomalyParcel[],
  taxYear: number,
): ExemptionAnomalies {
  const land: ExemptionAnomalySplit = { any: 0, senior: 0, noTransfer10y: 0 };
  const building: ExemptionAnomalySplit = { any: 0, senior: 0, noTransfer10y: 0 };
  let landEavTotal = 0;
  let landAnomalyCount = 0;

  for (const p of parcels) {
    if (!hasOccupancyExemption(p.exemptions)) continue;
    const split = p.universe === "land" ? land : building;
    split.any += 1;
    if (isSeniorExemption(p.exemptions)) split.senior += 1;
    if (noTransferInDecade(p.latestTransferDate, taxYear)) split.noTransfer10y += 1;
    if (p.universe === "land") {
      landAnomalyCount += 1;
      landEavTotal += totalExemptionEav(p.exemptions);
    }
  }

  return {
    taxYear,
    landImpossible: land,
    buildingStale: building,
    exemptEavLandTotal: landAnomalyCount > 0 ? landEavTotal : null,
  };
}

// ── Printed-copy constants ─────────────────────────────────────────────────

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

// Re-export the v2 taxonomy types so consumers that already pull from
// lib/vacancy-index can reach them without a second import (the client-safe
// module lib/owner-taxonomy is the canonical home for the runtime values).
export type {
  OwnerGeography,
  OwnerStructure,
  OwnerStructureCount,
  StructureGeographyCell,
} from "./owner-taxonomy";

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
 * cluster aggregates. `taxSale` is `saleYear != null`. */
export interface ClusterInputSite {
  lat: number;
  lon: number;
  ownerType: OwnerType;
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
 *
 * This variant also returns `membership`: an array aligned with `rows` giving,
 * per input site, the FINAL cluster id (1..N in the returned order) it landed
 * in, or `null` when the site fell in no kept cluster (noise, or a sub-minSize
 * piece). The export threads it onto each VacancySitePoint's `clusterId`.
 * clusterVacantSites is the thin, membership-free wrapper below.
 */
export function clusterVacantSitesWithMembership(
  rows: readonly ClusterInputSite[],
  opts: { linkMeters?: number; minSize?: number; maxExtentMeters?: number } = {},
): { clusters: VacancyCluster[]; membership: (number | null)[] } {
  const linkMeters = opts.linkMeters ?? 100;
  const minSize = opts.minSize ?? 5;
  const maxExtentMeters = opts.maxExtentMeters ?? 500;
  const n = rows.length;
  if (n === 0) return { clusters: [], membership: [] };

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

  // Each kept piece is carried with its input indices so membership can be
  // resolved after the final sort/renumber.
  const built: { cluster: Omit<VacancyCluster, "id">; idxs: number[] }[] = [];
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
    }
    const count = ordered.length;
    built.push({
      cluster: {
        centroid: { lat: sumLat / count, lon: sumLon / count },
        bbox: [minLon, minLat, maxLon, maxLat],
        count,
        ownerTypeCounts: tallyOwnerTypeCounts(ownerTypes),
        taxSaleCount,
        violationCount,
        vacantLandCount,
        vacantBuildingCount,
        corridorName: null,
      },
      idxs,
    });
  }

  built.sort(
    (a, b) =>
      b.cluster.count - a.cluster.count ||
      a.cluster.centroid.lat - b.cluster.centroid.lat ||
      a.cluster.centroid.lon - b.cluster.centroid.lon,
  );

  const membership: (number | null)[] = new Array(n).fill(null);
  const clusters = built.map((entry, i) => {
    const id = i + 1;
    for (const idx of entry.idxs) membership[idx] = id;
    return { id, ...entry.cluster };
  });
  return { clusters, membership };
}

/**
 * Membership-free proximity clustering — the canonical entry point for callers
 * that only need the clusters (the PDF/comparison paths and every unit test).
 * Delegates to clusterVacantSitesWithMembership; see that function for the full
 * method (union-find, extent cap, deterministic ordering).
 */
export function clusterVacantSites(
  rows: readonly ClusterInputSite[],
  opts: { linkMeters?: number; minSize?: number; maxExtentMeters?: number } = {},
): VacancyCluster[] {
  return clusterVacantSitesWithMembership(rows, opts).clusters;
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

// Per-ZIP directory-file cache (same undefined/null convention as `cache`).
const directoryCache = new Map<string, VacancyDirectoryFile | null>();

/**
 * Read and parse one ZIP's committed site-directory file
 * (public/data/vacancy-directory/{zip}.json) once per process. Static-only,
 * mirroring loadVacancyIndex: returns `null` when the file is absent or
 * unparseable so callers render an empty state rather than throwing. The zip
 * is validated to digits before touching the filesystem.
 */
export function loadVacancyDirectory(zip: string): VacancyDirectoryFile | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const cached = directoryCache.get(zip);
  if (cached !== undefined) return cached;

  let parsed: VacancyDirectoryFile | null = null;
  try {
    const filePath = path.join(process.cwd(), "public/data/vacancy-directory", `${zip}.json`);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      parsed =
        raw && typeof raw === "object" && Array.isArray((raw as VacancyDirectoryFile).rows)
          ? (raw as VacancyDirectoryFile)
          : null;
    }
  } catch {
    parsed = null;
  }

  directoryCache.set(zip, parsed);
  return parsed;
}
