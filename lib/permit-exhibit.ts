/**
 * PERMIT HISTORY EXHIBIT — evidence spine (build-spec: Permit History Exhibit
 * master spec, "PR 1 — evidence spine").
 *
 * `buildPermitExhibit({ pin, radiusFt })` assembles the traceable public
 * record for a subject parcel + radius: every permit linked to the parcel
 * (S1), permits in the surrounding area (S2), the parcel's TODAY boundary
 * context (S3), and the coverage/methods facts the footer needs (S4). It
 * NEVER argues, scores, or opines on a zoning outcome — see the exact
 * `PERMIT_EXHIBIT_LIMITS` copy below, which is the product's UPL-safety
 * rail, not decoration.
 *
 * ── Reuse, not fork ──
 *
 * This module is deliberately built ON TOP of established repo primitives
 * rather than reimplementing them:
 *   - Point-in-polygon against a County parcel: {@link featureContainsPoint}
 *     / {@link ringsBbox} from lib/shortlist-parcel-identity-resolver.ts —
 *     the same PIP the offline parcel-identity precompute uses.
 *   - Address normalization: {@link normalizePermitAddress} from
 *     lib/permit-match.ts — byte-identical to the private
 *     `normalizedSourceAddress` in lib/permit-area.ts (same regex), but
 *     EXPORTED, documented, and paired with {@link NORMALIZED_ADDRESS_SQL}
 *     so the SQL and the TypeScript cannot drift. Reusing the exported twin
 *     instead of the private one satisfies "never invent a second
 *     normalization" without duplicating an unexported function.
 *   - Proximity radius + haversine: {@link SPATIAL_MATCH_RADIUS_M} and
 *     {@link haversineMetres} from lib/permit-match.ts — the SAME 25 m
 *     tertiary-tier radius the vacant-parcel permit matcher already uses,
 *     not a newly invented number.
 *   - TIF + zone overlays at a point: {@link resolveZonesAtPoint} from
 *     lib/zones-check.ts — the exact resolver the report engine relies on.
 *   - Parcel polygon + situs address by PIN: the same CookViewer
 *     `parcel_current_beta` FeatureServer app/api/parcel/route.ts already
 *     queries (`COOK_COUNTY_CURRENT_PARCELS_QUERY_URL`), extended here to
 *     request geometry for a PIN lookup (the live route currently only
 *     requests geometry for its buffer/point searches, never for a plain
 *     PIN query — see {@link fetchExhibitParcel}).
 *   - Ring validation/repair: {@link validateAndRepairRing} from
 *     lib/zoning-snapshot.ts — the same defensive repair for the common
 *     ArcGIS "unclosed ring" export quirk.
 *   - Permit type taxonomy: {@link permitMapTypeForSource} from
 *     lib/permit-map.ts.
 *   - Source dataset identity: {@link PERMIT_AREA_SOURCE_LABEL} /
 *     {@link PERMIT_AREA_SOURCE_URL} / {@link PERMIT_AREA_PORTAL_URL} from
 *     lib/permit-area.ts — the SAME City Building Permits (ydr8-5enu)
 *     identity the neighborhood permit-activity brief already publishes.
 *
 * Two genuinely NEW pieces of integration exist because no importable lib
 * function already did this exact job:
 *   1. {@link resolveZoningDistrictAtPoint} — a minimal, single-mirror,
 *      live point query against the City's ArcGIS zoning layer. The only
 *      existing zoning-district-at-a-point logic lives inline in
 *      app/api/zoning/route.ts (a Next.js route handler, not an importable
 *      module, and it runs a heavier dual-mirror + vintage-comparability
 *      protocol this exhibit does not need). This function mirrors that
 *      route's ArcGIS query shape field-for-field (same URL, same
 *      `outFields`) so a future consolidation is a straight extraction, but
 *      it is new code, not a reused function — flagged here rather than
 *      silently duplicated.
 *   2. {@link fetchExhibitParcel} — CookViewer's PIN-lookup path
 *      (`resolveByPin` in app/api/parcel/route.ts) never requests geometry.
 *      This function reuses the exact same service URL and PIN-normalize
 *      helper, adding `returnGeometry=true` because the exhibit's whole
 *      point-in-polygon rail depends on having the polygon, not just the
 *      attributes.
 *
 * ── The exhibit is evidence, never a total ──
 *
 * `reported_cost` enters the SELECT for this route only, per spec — the
 * analysis route's (app/api/permit-area/route.ts) pinned exclusion test
 * stays untouched. It is exposed on each row as `estimatedCostSelfReported`
 * and is NEVER summed, averaged, or rolled up anywhere in this module.
 * {@link PERMIT_EXHIBIT_COST_LABEL} is the only sanctioned label for it.
 * lib/__tests__/permit-exhibit.test.ts pins both halves of that rule: the
 * mirror test on this route's own SQL (no `reported_cost` anywhere, still
 * excluded from the ANALYSIS route) and a walker over the built exhibit
 * object asserting no field is a cost aggregate.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";
import { getSQL } from "@/lib/db";
import {
  COOK_COUNTY_CURRENT_PARCELS_QUERY_URL,
  formatPin14,
  normalizePin14,
} from "@/lib/cook-viewer";
import {
  PERMIT_AREA_PORTAL_URL,
  PERMIT_AREA_SOURCE_LABEL,
  PERMIT_AREA_SOURCE_URL,
} from "@/lib/permit-area";
import {
  MIN_NORMALIZED_ADDRESS_LENGTH,
  NORMALIZED_ADDRESS_SQL,
  PERMIT_SINCE_DATE,
  SPATIAL_MATCH_RADIUS_M,
  haversineMetres,
  normalizePermitAddress,
} from "@/lib/permit-match";
import { permitMapTypeForSource, type PermitMapTypeKey } from "@/lib/permit-map";
import {
  featureContainsPoint,
  ringsBbox,
  type Ring,
} from "@/lib/shortlist-parcel-identity-resolver";
import { validateAndRepairRing } from "@/lib/zoning-snapshot";
import { resolveZonesAtPoint, type ZoneMatch } from "@/lib/zones-check";

// ════════════════════════════════════════════════════════════════════════
// Verbatim, claim-surface-registered copy (S4 methods & limits; S3 honest
// limit). Every user-facing sentence this module owns lives HERE, named,
// so lib/public-claim-surfaces.ts and its tests can register and pin them —
// no consumer should ever hand-author a substitute string.
// ════════════════════════════════════════════════════════════════════════

/** S1 — the exact, non-negotiable label for `reported_cost` at every
 *  appearance in this exhibit. Distinct from lib/permit-match-lines.ts's
 *  `PERMIT_COST_LABEL` ("(Applicant Estimate)") on purpose: that is the
 *  vacant-parcel card's own per-value suffix convention; the spec pins THIS
 *  exhibit's field label to this exact sentence. */
export const PERMIT_EXHIBIT_COST_LABEL = "Estimated cost (self-reported to City)";

/** S1's subsection heading for the weakest, non-parcel-matching tier. A
 *  proximity row must render ONLY under this heading, never intermingled
 *  with pin_parcel/address_exact rows. */
export const PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE =
  "Nearby, not matched to this parcel";

/** S3's honest limit, verbatim except for the interpolated snapshot date.
 *  Use {@link formatBoundaryContextLimitNote} to render it. */
export const PERMIT_EXHIBIT_BOUNDARY_LIMIT_TEMPLATE =
  "Boundary context is as of {date}. District boundaries in effect at each " +
  "permit's issue date are not yet reconstructable from this tool; verify " +
  "era-specific zoning with the City's ordinance record.";

export function formatBoundaryContextLimitNote(asOfDate: string): string {
  return PERMIT_EXHIBIT_BOUNDARY_LIMIT_TEMPLATE.replace("{date}", asOfDate);
}

/** S4's three methods-and-limits sentences, verbatim from the spec. */
export const PERMIT_EXHIBIT_LIMITS = [
  "A permit shows work was authorized. It does not show that a use occurred or continued. Business licenses, certificates of occupancy, utility records, photographs, and sworn affidavits are the usual companion evidence.",
  "The absence of a permit is not evidence of absence: the City's electronic permit record thins sharply before the mid-2000s, and unpermitted work occurs.",
  "This exhibit is a derivative of the public record, not the record itself. Verify every row against the City's own dataset at the linked source.",
] as const;

/** S4's exhibit-id footer sentence, verbatim except for the interpolated id. */
export function formatExhibitIdFooter(exhibitId: string): string {
  return (
    `Exhibit ${exhibitId}. Regenerating after a data refresh may include newer permits; ` +
    "the snapshot date above identifies this exhibit's data vintage."
  );
}

/** S4's coverage note. Adapted from lib/permit-area.ts's
 *  `PERMIT_AREA_COVERAGE_NOTE` phrasing/spirit ("with the existing
 *  coverage-note language" per spec) but NOT copied verbatim: this
 *  exhibit's coverage differs in two material ways permit-area's note does
 *  not need to state — it draws the FULL ingested history rather than the
 *  since-{@link PERMIT_SINCE_DATE} analysis window, and it includes
 *  address-only rows inferred from a sibling geocoded record at the same
 *  address (see {@link buildPermitExhibit}'s area-query doc comment). */
export const PERMIT_EXHIBIT_COVERAGE_NOTE =
  "Area results include every geocoded City building-permit filing within the selected radius, across the " +
  "full ingested history (not limited to a rolling window). A record without its own map location is included " +
  "only when a sibling filing at the same normalized street address WAS geocoded inside the radius, and is " +
  "flagged address-only rather than located-in-radius; every other unlocated record in the source is excluded, " +
  "never silently assumed to be inside or outside the shape.";

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

export type PermitExhibitMatchMethod = "pin_parcel" | "address_exact" | "proximity";

/** Human labels for the three S1 match methods. */
export const PERMIT_EXHIBIT_MATCH_METHOD_LABELS: Record<PermitExhibitMatchMethod, string> = {
  pin_parcel: "On this parcel (point in polygon)",
  address_exact: "Matched street address",
  proximity: `Nearby, within ${SPATIAL_MATCH_RADIUS_M} m — not matched to this parcel`,
};

/** Confidence attached to each S1 match method. Mirrors the fixed-per-tier
 *  shape of lib/permit-match.ts's `METHOD_BASE_CONFIDENCE`, with pin_parcel
 *  (a real geometric containment test, not a self-reported PIN string)
 *  graded `high` — stronger than that module's `pin_exact` tier, which
 *  trusts the PERMIT'S OWN reported PIN field. */
export const PERMIT_EXHIBIT_MATCH_CONFIDENCE: Record<
  PermitExhibitMatchMethod,
  "high" | "medium" | "low"
> = {
  pin_parcel: "high",
  address_exact: "medium",
  proximity: "low",
};

/** One S1 (subject-parcel) or S2 (area) permit row's shared anatomy. Field
 *  names below `issueDate`…`matchMethod` are FROZEN by the master spec and
 *  the PR-2 integration contract — do not rename or restructure them.
 *  Everything else on this interface is additive. */
export interface PermitExhibitSubjectRow {
  /** City permit number (`building_permits.permit_id`). FROZEN name. */
  permitNumber: string;
  /** Human permit-type label. FROZEN name. */
  type: string;
  /** ISO date (`YYYY-MM-DD`), or null when the source never published one.
   *  FROZEN name. */
  issueDate: string | null;
  /** The applicant's own estimate, in dollars, or null when not published.
   *  NEVER sum/average this — see {@link PERMIT_EXHIBIT_COST_LABEL}. FROZEN
   *  name. */
  estimatedCostSelfReported: number | null;
  /** `permit_status`, trimmed, or null. FROZEN name. */
  status: string | null;
  /** FROZEN name; FROZEN 3-value union. Each row carries EXACTLY one —
   *  see {@link classifyPermitExhibitMatch}. */
  matchMethod: PermitExhibitMatchMethod;

  // ── Additive ──
  /** Stable taxonomy key for `type`, or null for an unrecognized source
   *  value (still rendered via `type`, never dropped). */
  typeKey: PermitMapTypeKey | null;
  /** The permit type exactly as the source published it. */
  rawType: string | null;
  workDescription: string | null;
  /** `permit_milestone` — qualifies `status` but is never merged into it,
   *  matching lib/permit-match-lines.ts's own rule that the two fields stay
   *  separate. */
  milestone: string | null;
  matchConfidence: "high" | "medium" | "low";
  /** Deep link to the City record — see {@link buildPermitSourceRecordUrl}.
   *  A row-level Socrata SoQL explorer link keyed on `permit_` (verified
   *  live), never a fabricated URL the source does not actually support. */
  sourceRecordUrl: string | null;
}

export type PermitExhibitAreaLocation = "point" | "address_only";

/** An S2 (area) row. Same shared anatomy as {@link PermitExhibitSubjectRow}
 *  minus `matchMethod` (S1's 3-tier vocabulary does not apply to the area
 *  query, which is scoped by the user-selected radius, not by parcel
 *  identity) plus `locatedVia`, S2's own "match method vs the RADIUS"
 *  vocabulary per spec. */
export interface PermitExhibitAreaRow
  extends Omit<PermitExhibitSubjectRow, "matchMethod" | "matchConfidence"> {
  /** `"point"` — the permit's own geocoded point falls inside the radius
   *  circle. `"address_only"` — the permit itself carries no geocode, but a
   *  sibling filing at the same normalized address WAS geocoded inside the
   *  radius; this row's own location was never verified and must always be
   *  disclosed as such, never intermingled with `"point"` rows as if it
   *  were a location match. */
  locatedVia: PermitExhibitAreaLocation;
}

export interface PermitExhibitYearCount {
  year: number;
  count: number;
}

export interface PermitExhibitTypeCount {
  key: PermitMapTypeKey | null;
  label: string;
  count: number;
}

export type PermitExhibitZoningDistrictStatus = "resolved" | "not_found" | "unavailable";

/** Live, single-mirror zoning-district resolution — see
 *  {@link resolveZoningDistrictAtPoint}'s doc comment for why this is new
 *  integration code rather than a reused function. */
export interface PermitExhibitZoningDistrict {
  status: PermitExhibitZoningDistrictStatus;
  zoneClass: string | null;
  /** The polygon's own `UPDATE_TIMESTAMP`, when published. Describes only
   *  the matched polygon, never a dataset-wide vintage — mirrors the
   *  record/dataset distinction app/api/zoning/route.ts already draws. */
  recordUpdatedAt: string | null;
  sourceLabel: string;
  sourceUrl: string;
}

export interface PermitExhibitZoningArchiveVintageRange {
  earliest: string | null;
  latest: string | null;
  snapshotCount: number;
}

export interface PermitExhibitBoundaryContext {
  /** ISO date this boundary context was resolved — always "today" (the
   *  resolution is LIVE, not a stored snapshot), interpolated into
   *  {@link limitNote}. */
  asOfDate: string;
  /** The subject parcel's County-published situs address — the SAME value
   *  as `meta.subjectParcel.situsAddress`, duplicated here as a convenience
   *  for a page-header/S3 renderer that only reaches into boundaryContext. */
  parcelAddress: string | null;
  zoningDistrict: PermitExhibitZoningDistrict;
  tifDistricts: { key: string; name: string }[];
  /** Every other matched overlay (Opportunity Zone, Enterprise Zone, SSA,
   *  landmark district, …) from {@link resolveZonesAtPoint} — the same
   *  layers the rest of the app resolves, reused verbatim. */
  overlays: { key: string; name: string }[];
  /** What dated zoning-boundary archive material exists, from the Archive
   *  half of this PR (scripts/archive-zoning-snapshot.ts). Best-effort:
   *  null-range when the archive index cannot be read, never fatal to the
   *  exhibit build. */
  archiveVintageRange: PermitExhibitZoningArchiveVintageRange;
  /** S3's honest limit, pre-formatted with `asOfDate`. */
  limitNote: string;
}

export interface PermitExhibitMatchMethodBreakdown {
  pinParcel: number;
  addressExact: number;
  proximity: number;
}

export interface PermitExhibitCoverage {
  matchMethodBreakdown: PermitExhibitMatchMethodBreakdown;
  area: {
    /** S2 rows located via their own geocoded point. */
    geolocatedCount: number;
    /** S2 rows included only via a sibling address match (`locatedVia ===
     *  "address_only"`) — this exhibit's operational definition of
     *  "unlocated count for the radius area" per spec S4. See
     *  {@link PERMIT_EXHIBIT_COVERAGE_NOTE} for why this is the honest,
     *  computable reading rather than a citywide ungeocoded count. */
    unlocatedCount: number;
    totalCount: number;
  };
  coverageNote: string;
}

export interface PermitExhibitFilters {
  /** When non-empty, every row (subject AND area) and every aggregate is
   *  restricted to these permit-type keys. Rows whose type has no known key
   *  are excluded once a filter is active — an unmapped type can never be
   *  silently included in a scoped result. */
  permitTypeKeys?: readonly PermitMapTypeKey[];
}

export interface PermitExhibitQueryParams {
  /** 14-digit, digits-only. */
  pin: string;
  pinFormatted: string;
  radiusFt: number;
  filters: PermitExhibitFilters;
}

export interface PermitExhibitMeta {
  /** ISO date this exhibit was generated. FROZEN name. */
  snapshotDate: string;
  /** MAX(fetched_at) across every subject + area row observed — the
   *  ingest sync vintage, mirroring `sourceRefresh.asOf` in
   *  lib/permit-area.ts. Null when zero rows were observed (never a
   *  fabricated "now"). FROZEN name. This is the `snapshotVintage` input to
   *  {@link computePermitExhibitId} — NOT `snapshotDate` above, which is
   *  wall-clock generation time and would make the id non-deterministic
   *  across otherwise-identical same-day rebuilds. */
  datasetLastUpdate: string | null;
  /** FROZEN name. See {@link computePermitExhibitId}. */
  exhibitId: string;
  /** Printed verbatim per spec. FROZEN name. */
  queryParams: PermitExhibitQueryParams;

  // ── Additive ──
  sourceLabel: string;
  sourceUrl: string;
  sourcePortalUrl: string;
  /** This exhibit deliberately queries the FULL ingested history rather
   *  than the permit-area analysis route's since-{@link PERMIT_SINCE_DATE}
   *  window — stated explicitly per spec ("if they differ — state which in
   *  the meta"). In this codebase the two happen to share the same floor
   *  today (the ingest itself never fetches earlier rows), but this field
   *  documents the INTENT so a future change to the ingest window cannot
   *  silently narrow the exhibit without the meta saying so. */
  historyWindow: "full_ingested_history";
  ingestFloorDate: string;
  costLabel: string;
  limitsBlock: readonly string[];
  exhibitIdFooter: string;
  subjectParcel: {
    pin: string;
    pinFormatted: string;
    situsAddress: string | null;
  };
}

export interface PermitExhibitArea {
  byYear: PermitExhibitYearCount[];
  byType: PermitExhibitTypeCount[];
  rows: PermitExhibitAreaRow[];
}

/** The frozen top-level envelope:
 *  `{ subject, area: { byYear, byType, rows }, boundaryContext, coverage, meta }`. */
export interface PermitExhibitResult {
  subject: PermitExhibitSubjectRow[];
  area: PermitExhibitArea;
  boundaryContext: PermitExhibitBoundaryContext;
  coverage: PermitExhibitCoverage;
  meta: PermitExhibitMeta;
}

export type PermitExhibitErrorCode =
  | "invalid_pin"
  | "invalid_radius"
  | "parcel_not_found"
  | "parcel_geometry_unavailable"
  | "parcel_source_unavailable"
  | "database_unavailable";

/** Thrown, never returned — "junk → typed error" per spec. Callers
 *  `catch` and branch on `.code`. */
export class PermitExhibitBuildError extends Error {
  readonly code: PermitExhibitErrorCode;
  constructor(code: PermitExhibitErrorCode, message: string) {
    super(message);
    this.name = "PermitExhibitBuildError";
    this.code = code;
  }
}

export const PERMIT_EXHIBIT_ALLOWED_RADIUS_FT = [250, 500, 1000] as const;
export type PermitExhibitRadiusFt = (typeof PERMIT_EXHIBIT_ALLOWED_RADIUS_FT)[number];
export const PERMIT_EXHIBIT_DEFAULT_RADIUS_FT: PermitExhibitRadiusFt = 500;

// ════════════════════════════════════════════════════════════════════════
// Pure helpers (unit-testable without a database or network)
// ════════════════════════════════════════════════════════════════════════

const FEET_PER_METER = 3.280839895;

export function radiusFeetToMeters(radiusFt: number): number {
  return radiusFt / FEET_PER_METER;
}

/** Great-circle distance between two bbox corners, i.e. the bbox's own
 *  diagonal — used only to size the S1 candidate-widening query, never to
 *  classify a match. */
function bboxDiagonalMeters(bbox: readonly [number, number, number, number]): number {
  return haversineMetres(bbox[1], bbox[0], bbox[3], bbox[2]);
}

const SUBJECT_CANDIDATE_RADIUS_FLOOR_M = 150;
const SUBJECT_CANDIDATE_RADIUS_CEILING_M = 2000;
const SUBJECT_CANDIDATE_RADIUS_MARGIN_M = 100;

/** How wide a net the S1 (subject-parcel) candidate query casts before
 *  exact-classifying each row. Sized from the PARCEL'S OWN geometry (its
 *  bbox diagonal), not the user-selected area radius — pin_parcel /
 *  address_exact / proximity matching is about the parcel's identity, not
 *  the reader's chosen viewing radius, so a small S2 radius must never
 *  shrink the S1 candidate net below what the parcel itself needs. */
export function subjectCandidateRadiusMeters(
  parcelBbox: readonly [number, number, number, number],
): number {
  const needed = bboxDiagonalMeters(parcelBbox) + SUBJECT_CANDIDATE_RADIUS_MARGIN_M;
  return Math.min(
    SUBJECT_CANDIDATE_RADIUS_CEILING_M,
    Math.max(SUBJECT_CANDIDATE_RADIUS_FLOOR_M, needed),
  );
}

/** Shoelace-formula centroid of a simple polygon's EXTERIOR ring (rings[0]).
 *  Falls back to the bbox center for a degenerate ring (fewer than 4 points
 *  or ~zero signed area) — a centroid is only ever used to seed a live
 *  point lookup and a radius circle, never as an authoritative geometry, so
 *  a bbox-center fallback is an honest, harmless degradation. */
export function polygonCentroid(
  rings: readonly Ring[],
  bbox: readonly [number, number, number, number],
): { lat: number; lon: number } {
  const bboxCenter = { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 };
  const exterior = rings[0];
  if (!exterior || exterior.length < 4) return bboxCenter;

  // Translate to a LOCAL origin (the bbox center) before the shoelace sums.
  // Chicago-scale absolute coordinates (~-87.6, ~41.7) are enormous next to
  // a typical parcel's extent (~1e-4 degrees); summing x0*y1 - x1*y0 in
  // ABSOLUTE coordinates subtracts near-equal large products and destroys
  // almost all precision (catastrophic cancellation). Caught by
  // lib/__tests__/permit-exhibit.test.ts: an untranslated version of this
  // function placed a real 25x125 ft lot's "centroid" measurably OUTSIDE
  // the lot. Translating first and adding the origin back at the end keeps
  // every summed term the same tiny order of magnitude as the polygon
  // itself, eliminating the cancellation.
  const originLon = bboxCenter.lon;
  const originLat = bboxCenter.lat;

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < exterior.length - 1; i += 1) {
    const x0 = exterior[i][0] - originLon;
    const y0 = exterior[i][1] - originLat;
    const x1 = exterior[i + 1][0] - originLon;
    const y1 = exterior[i + 1][1] - originLat;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) return bboxCenter;
  return { lon: originLon + cx / (6 * area), lat: originLat + cy / (6 * area) };
}

/** GeoJSON circle polygon around a centroid, per spec's explicit direction
 *  to reuse "the polygon query path with a circle polygon (N-gon
 *  approximation)" — i.e. the SAME `ST_Intersects(geom,
 *  ST_GeomFromGeoJSON(...))` pattern app/api/permit-area/route.ts already
 *  uses for the drawn-area tool, rather than a simpler-but-different
 *  `ST_DWithin` distance query. 64 steps keeps the N-gon error well under a
 *  meter at Chicago's latitude for the radii this tool offers (250–1000 ft). */
export function radiusCirclePolygon(
  lat: number,
  lon: number,
  radiusMeters: number,
): GeoJSON.Polygon {
  const feature = turf.circle([lon, lat], radiusMeters / 1000, {
    steps: 64,
    units: "kilometers",
  });
  return feature.geometry as GeoJSON.Polygon;
}

/** THE canonical S1 match classifier — pin_parcel ⊃ address_exact ⊃
 *  proximity, checked strongest-first so a row can only ever earn ONE
 *  method. Pure and exported so exclusivity is pinnable without a database:
 *  lib/__tests__/permit-exhibit.test.ts feeds it fixtures directly. */
export function classifyPermitExhibitMatch(
  row: { lat: number | null; lon: number | null; normalizedAddress: string },
  parcel: {
    rings: readonly Ring[];
    bbox: readonly [number, number, number, number];
    centroid: { lat: number; lon: number };
  },
  normalizedSitusAddress: string,
): PermitExhibitMatchMethod | null {
  if (row.lat != null && row.lon != null) {
    if (featureContainsPoint(row.lon, row.lat, { rings: parcel.rings as Ring[], bbox: parcel.bbox as [number, number, number, number] })) {
      return "pin_parcel";
    }
  }

  if (
    normalizedSitusAddress.length >= MIN_NORMALIZED_ADDRESS_LENGTH &&
    normalizedSitusAddress !== "unknown" &&
    row.normalizedAddress === normalizedSitusAddress
  ) {
    return "address_exact";
  }

  if (row.lat != null && row.lon != null) {
    const distance = haversineMetres(parcel.centroid.lat, parcel.centroid.lon, row.lat, row.lon);
    if (distance <= SPATIAL_MATCH_RADIUS_M) return "proximity";
  }

  return null;
}

function canonicalFilters(filters: PermitExhibitFilters): string {
  const keys = [...(filters.permitTypeKeys ?? [])].sort();
  return JSON.stringify({ permitTypeKeys: keys });
}

/** Stable hash of {pin, radiusFt, filters, snapshotVintage} per spec.
 *  `snapshotVintage` MUST be the dataset's own sync vintage
 *  (`meta.datasetLastUpdate`), not wall-clock generation time — see
 *  {@link PermitExhibitMeta.datasetLastUpdate}'s doc comment. Deterministic
 *  both directions: identical inputs (including vintage) always produce the
 *  same id; changing ANY input, including vintage alone, always changes it
 *  (barring an astronomically unlikely sha256 collision). */
export function computePermitExhibitId(input: {
  pin: string;
  radiusFt: number;
  filters: PermitExhibitFilters;
  snapshotVintage: string | null;
}): string {
  const canonical = JSON.stringify({
    pin: input.pin,
    radiusFt: input.radiusFt,
    filters: canonicalFilters(input.filters),
    snapshotVintage: input.snapshotVintage ?? "unknown",
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 20);
}

function aggregateByYear(rows: readonly { issueDate: string | null }[]): PermitExhibitYearCount[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const year = row.issueDate ? Number(row.issueDate.slice(0, 4)) : NaN;
    if (!Number.isInteger(year)) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, count]) => ({ year, count }));
}

function aggregateByType(
  rows: readonly { typeKey: PermitMapTypeKey | null; type: string }[],
): PermitExhibitTypeCount[] {
  const counts = new Map<string, PermitExhibitTypeCount>();
  for (const row of rows) {
    const bucketKey = row.typeKey ?? `raw:${row.type}`;
    const existing = counts.get(bucketKey);
    if (existing) existing.count += 1;
    else counts.set(bucketKey, { key: row.typeKey, label: row.type, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

// ════════════════════════════════════════════════════════════════════════
// Parcel resolution (CookViewer) — see file-header doc comment for why this
// is new (geometry-requesting) integration atop an existing service/URL.
// ════════════════════════════════════════════════════════════════════════

export interface ExhibitParcel {
  pin: string;
  situsAddress: string | null;
  rings: Ring[];
  bbox: [number, number, number, number];
  centroid: { lat: number; lon: number };
}

interface CookViewerFeatureRaw {
  attributes?: Record<string, unknown>;
  geometry?: { rings?: unknown[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const PARCEL_LOOKUP_OUT_FIELDS = "PIN14,street_address,city_state_zip";

/** Resolve a 14-digit PIN to its County-published polygon + situs address,
 *  live. Reuses `COOK_COUNTY_CURRENT_PARCELS_QUERY_URL` and PIN-string
 *  handling exactly as app/api/parcel/route.ts does; the one difference
 *  from that route's own `resolveByPin` is `returnGeometry=true`, which
 *  that route never sets for a PIN query because it never needed the
 *  polygon. `null` return = the PIN is well-formed but the County has no
 *  matching feature (parcel_not_found); a thrown error = the source itself
 *  failed (parcel_source_unavailable). A feature with unusable/malformed
 *  geometry is FAIL-CLOSED to `null` as well — a permit "matched" against a
 *  polygon this module could not actually validate would be a worse defect
 *  than reporting no parcel. */
export async function fetchExhibitParcel(
  pin: string,
  fetchImpl: typeof fetch,
): Promise<ExhibitParcel | null> {
  const url = new URL(COOK_COUNTY_CURRENT_PARCELS_QUERY_URL);
  url.searchParams.set("where", `PIN14='${pin}'`);
  url.searchParams.set("outFields", PARCEL_LOOKUP_OUT_FIELDS);
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("geometryPrecision", "7");
  url.searchParams.set("f", "json");

  const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CookViewer parcel query failed with HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!isRecord(payload) || isRecord(payload.error)) {
    throw new Error("CookViewer parcel query returned an error");
  }

  const features = Array.isArray(payload.features) ? (payload.features as CookViewerFeatureRaw[]) : [];
  if (features.length === 0) return null;

  const feature = features[0];
  const attributes = feature.attributes ?? {};
  const street = typeof attributes.street_address === "string" ? attributes.street_address.trim() : "";
  const cityStateZip =
    typeof attributes.city_state_zip === "string" ? attributes.city_state_zip.trim() : "";
  const situsAddress =
    [street, cityStateZip].filter((part) => part.length > 0).join(", ") || null;

  const rawRings = feature.geometry?.rings;
  if (!Array.isArray(rawRings) || rawRings.length === 0) return null;

  const rings: Ring[] = [];
  for (const rawRing of rawRings) {
    const repaired = validateAndRepairRing(rawRing);
    if (!repaired) return null; // fail-closed on any unrepairable ring
    rings.push(repaired as Ring);
  }

  const bbox = ringsBbox(rings);
  return { pin, situsAddress, rings, bbox, centroid: polygonCentroid(rings, bbox) };
}

// ════════════════════════════════════════════════════════════════════════
// Zoning district (live, single-mirror) — see file-header doc comment.
// ════════════════════════════════════════════════════════════════════════

const ZONING_ARCGIS_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1";
const ZONING_ARCGIS_SOURCE_LABEL = "City of Chicago ArcGIS zoning boundaries";

export async function resolveZoningDistrictAtPoint(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch,
): Promise<PermitExhibitZoningDistrict> {
  const base = { sourceLabel: ZONING_ARCGIS_SOURCE_LABEL, sourceUrl: ZONING_ARCGIS_LAYER_URL };
  try {
    const url = new URL(`${ZONING_ARCGIS_LAYER_URL}/query`);
    url.searchParams.set("geometry", `${lon},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "ZONE_CLASS,UPDATE_TIMESTAMP");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", "1");
    url.searchParams.set("f", "json");

    const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000) });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || isRecord(payload.error)) {
      return { status: "unavailable", zoneClass: null, recordUpdatedAt: null, ...base };
    }

    const features = Array.isArray(payload.features) ? payload.features : [];
    if (features.length === 0) {
      return { status: "not_found", zoneClass: null, recordUpdatedAt: null, ...base };
    }

    const first = features[0];
    const attributes = isRecord(first) && isRecord(first.attributes) ? first.attributes : {};
    const zoneClass =
      typeof attributes.ZONE_CLASS === "string" && attributes.ZONE_CLASS.trim().length > 0
        ? attributes.ZONE_CLASS.trim()
        : null;
    if (!zoneClass) {
      return { status: "not_found", zoneClass: null, recordUpdatedAt: null, ...base };
    }

    const recordUpdatedAt =
      typeof attributes.UPDATE_TIMESTAMP === "number"
        ? new Date(attributes.UPDATE_TIMESTAMP).toISOString()
        : null;
    return { status: "resolved", zoneClass, recordUpdatedAt, ...base };
  } catch {
    return { status: "unavailable", zoneClass: null, recordUpdatedAt: null, ...base };
  }
}

// ════════════════════════════════════════════════════════════════════════
// Zoning archive index (best-effort; see scripts/archive-zoning-snapshot.ts)
// ════════════════════════════════════════════════════════════════════════

const ZONING_ARCHIVE_INDEX_RELATIVE_PATH = ["data", "archive", "zoning", "index.json"] as const;

async function defaultReadZoningArchiveVintageRange(): Promise<PermitExhibitZoningArchiveVintageRange> {
  const empty: PermitExhibitZoningArchiveVintageRange = {
    earliest: null,
    latest: null,
    snapshotCount: 0,
  };
  try {
    const filePath = path.join(process.cwd(), ...ZONING_ARCHIVE_INDEX_RELATIVE_PATH);
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.snapshots)) return empty;
    const vintages = parsed.snapshots
      .map((entry) => (isRecord(entry) && typeof entry.vintage === "string" ? entry.vintage : null))
      .filter((v): v is string => v !== null)
      .sort();
    if (vintages.length === 0) return empty;
    return {
      earliest: vintages[0],
      latest: vintages[vintages.length - 1],
      snapshotCount: vintages.length,
    };
  } catch {
    return empty;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SQL row shape + mapping
// ════════════════════════════════════════════════════════════════════════

/** The exact SQL text both queries in {@link buildPermitExhibit} inline
 *  literally (neon's `sql` tag treats every `${}` substitution as a bound
 *  PARAMETER, never raw SQL text, so `NORMALIZED_ADDRESS_SQL` cannot be
 *  interpolated into the template directly — it can only be compared
 *  against, which is what this guard rail does). Mirrors
 *  scripts/sync-vacant-properties.ts's own drift guard for the identical
 *  expression, but as a pure string-equality check at module load rather
 *  than a runtime DB probe, since no live database is required to catch a
 *  divergence here. */
const INLINE_NORMALIZED_ADDRESS_SQL =
  "regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g')";
if (INLINE_NORMALIZED_ADDRESS_SQL !== NORMALIZED_ADDRESS_SQL) {
  throw new Error(
    "lib/permit-exhibit.ts's inline SQL address normalization has drifted from " +
      "lib/permit-match.ts's NORMALIZED_ADDRESS_SQL — fix the SQL text inline above to match.",
  );
}

interface RawPermitRow {
  permit_id: unknown;
  permit_type: unknown;
  address: unknown;
  issue_date: unknown;
  permit_status: unknown;
  permit_milestone: unknown;
  work_type: unknown;
  work_description: unknown;
  reported_cost: unknown;
  lat: unknown;
  lon: unknown;
  fetched_at: unknown;
  normalized_address: unknown;
}

interface RawAreaPermitRow extends RawPermitRow {
  located_via: unknown;
}

const PERMIT_SOURCE_EXPLORE_BASE_URL =
  "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/explore/query";

/** Per-permit deep link into the Chicago Data Portal's own row-level SoQL
 *  explorer, keyed on `permit_` — Socrata's own "Row Identifier" for this
 *  dataset (its published metadata labels that column "Row Identifier:
 *  PERMIT#"), so it is a stable per-record key, not a guessed URL param.
 *  Verified live in a real browser on 2026-08-25 — filtering
 *  `` `permit_` = "101046020" `` returns "Showing row 1 of 1" against the
 *  real ydr8-5enu dataset. Jointly confirmed with the PR-2 surface
 *  builder, who found this same pattern independently while wiring the
 *  UI; consolidated here so both surfaces share ONE builder rather than
 *  two copies of the same URL-construction logic. */
export function buildPermitSourceRecordUrl(permitNumber: string): string {
  const escaped = permitNumber.replace(/"/g, '\\"');
  const soql =
    "SELECT `id`, `permit_`, `permit_type`, `issue_date`, `work_description`, `reported_cost` " +
    `WHERE \`permit_\` = "${escaped}"`;
  return `${PERMIT_SOURCE_EXPLORE_BASE_URL}/${encodeURIComponent(soql)}/page/filter`;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface MappedPermitRow {
  permitNumber: string;
  type: string;
  typeKey: PermitMapTypeKey | null;
  rawType: string | null;
  workDescription: string | null;
  issueDate: string | null;
  estimatedCostSelfReported: number | null;
  status: string | null;
  milestone: string | null;
  sourceRecordUrl: string | null;
  lat: number | null;
  lon: number | null;
  normalizedAddress: string;
  fetchedAt: string | null;
}

function mapRawPermitRow(row: RawPermitRow): MappedPermitRow | null {
  const permitNumber = textOrNull(row.permit_id);
  if (!permitNumber) return null; // a permit with no id is not a citable record
  const rawType = textOrNull(row.permit_type);
  const knownType = permitMapTypeForSource(rawType);
  return {
    permitNumber,
    type: knownType?.label ?? rawType ?? "Not recorded",
    typeKey: knownType?.key ?? null,
    rawType,
    workDescription: textOrNull(row.work_description),
    issueDate: textOrNull(row.issue_date),
    estimatedCostSelfReported: nullableFiniteNumber(row.reported_cost),
    status: textOrNull(row.permit_status),
    milestone: textOrNull(row.permit_milestone),
    sourceRecordUrl: buildPermitSourceRecordUrl(permitNumber),
    lat: nullableFiniteNumber(row.lat),
    lon: nullableFiniteNumber(row.lon),
    normalizedAddress: textOrNull(row.normalized_address) ?? "",
    fetchedAt: textOrNull(row.fetched_at),
  };
}

function applyTypeFilter<T extends { typeKey: PermitMapTypeKey | null }>(
  rows: readonly T[],
  filters: PermitExhibitFilters,
): T[] {
  const keys = filters.permitTypeKeys;
  if (!keys || keys.length === 0) return [...rows];
  const allowed = new Set<PermitMapTypeKey>(keys);
  return rows.filter((row) => row.typeKey !== null && allowed.has(row.typeKey));
}

// ════════════════════════════════════════════════════════════════════════
// buildPermitExhibit
// ════════════════════════════════════════════════════════════════════════

export interface BuildPermitExhibitOptions {
  pin: string;
  radiusFt?: PermitExhibitRadiusFt;
  filters?: PermitExhibitFilters;
  /** Injectable so tests never need a live database — mock at this
   *  boundary, per the repo-wide convention. Defaults to `getSQL()`. */
  sql?: ReturnType<typeof getSQL>;
  /** Injectable for CookViewer + zoning ArcGIS calls. Defaults to global
   *  `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Injectable archive-index reader. Defaults to reading
   *  data/archive/zoning/index.json off disk. */
  readZoningArchiveVintageRange?: () => Promise<PermitExhibitZoningArchiveVintageRange>;
}

export async function buildPermitExhibit(
  options: BuildPermitExhibitOptions,
): Promise<PermitExhibitResult> {
  const pin = normalizePin14(options.pin);
  if (!pin) {
    throw new PermitExhibitBuildError(
      "invalid_pin",
      `"${options.pin}" is not a valid 14-digit Cook County PIN.`,
    );
  }

  const radiusFt = options.radiusFt ?? PERMIT_EXHIBIT_DEFAULT_RADIUS_FT;
  if (!(PERMIT_EXHIBIT_ALLOWED_RADIUS_FT as readonly number[]).includes(radiusFt)) {
    throw new PermitExhibitBuildError(
      "invalid_radius",
      `radiusFt must be one of ${PERMIT_EXHIBIT_ALLOWED_RADIUS_FT.join(", ")}; received ${radiusFt}.`,
    );
  }

  const filters: PermitExhibitFilters = options.filters ?? {};
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const readArchiveVintageRange =
    options.readZoningArchiveVintageRange ?? defaultReadZoningArchiveVintageRange;

  const sql = options.sql !== undefined ? options.sql : getSQL();
  if (!sql) {
    throw new PermitExhibitBuildError("database_unavailable", "DATABASE_URL is not configured.");
  }

  let parcel: ExhibitParcel | null;
  try {
    parcel = await fetchExhibitParcel(pin, fetchImpl);
  } catch (err) {
    throw new PermitExhibitBuildError(
      "parcel_source_unavailable",
      `Cook County parcel lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parcel) {
    throw new PermitExhibitBuildError(
      "parcel_not_found",
      `No Cook County parcel record was found for PIN ${formatPin14(pin)}.`,
    );
  }

  // CookViewer publishes situsAddress as "STREET, CITY, STATE ZIP" (see
  // fetchExhibitParcel), but building_permits.address is STREET ONLY — the
  // City permits source never carries city/state/zip. Comparing the FULL
  // situs address against a permit's street-only address would normalize to
  // two different strings for the SAME address and address_exact would
  // never fire for any real row. Strip to the street line first, exactly
  // the same pattern app/api/parcel/route.ts's own (route-local, not
  // importable) `parcelStreetAddress` helper uses — take everything before
  // the first comma. Caught by lib/__tests__/permit-exhibit.test.ts, whose
  // first draft made this exact mistake.
  const situsStreetAddress = parcel.situsAddress?.split(",")[0]?.trim() ?? null;
  const normalizedSitusAddress = normalizePermitAddress(situsStreetAddress);
  const candidateRadiusM = subjectCandidateRadiusMeters(parcel.bbox);
  const radiusMeters = radiusFeetToMeters(radiusFt);
  const radiusPolygon = radiusCirclePolygon(parcel.centroid.lat, parcel.centroid.lon, radiusMeters);
  const radiusPolygonJson = JSON.stringify(radiusPolygon);

  // ── S1 candidates: within an adaptive net sized to the PARCEL'S OWN
  // geometry, OR sharing the parcel's normalized situs address (a genuine
  // address_exact match must never be excluded just because it sits outside
  // the geometric net — see subjectCandidateRadiusMeters's doc comment). ──
  const subjectCandidateRows = (await sql`
    WITH candidates AS MATERIALIZED (
      SELECT
        permit_id, permit_type, address, issue_date::text AS issue_date,
        permit_status, permit_milestone, work_type, work_description,
        reported_cost, lat, lon, fetched_at::text AS fetched_at,
        regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS normalized_address
      FROM building_permits
      WHERE
        (
          geom IS NOT NULL
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${parcel.centroid.lon}, ${parcel.centroid.lat}), 4326)::geography,
            ${candidateRadiusM}
          )
        )
        OR (
          ${normalizedSitusAddress} <> ''
          AND regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') = ${normalizedSitusAddress}
        )
    )
    SELECT * FROM candidates
  `) as unknown as RawPermitRow[];

  // ── S2: point-in-radius, plus address-only siblings. See
  // PERMIT_EXHIBIT_COVERAGE_NOTE for exactly what "address-only" means. ──
  const areaRows = (await sql`
    WITH point_matches AS MATERIALIZED (
      SELECT
        permit_id, permit_type, address, issue_date::text AS issue_date,
        permit_status, permit_milestone, work_type, work_description,
        reported_cost, lat, lon, fetched_at::text AS fetched_at,
        regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS normalized_address
      FROM building_permits
      WHERE geom IS NOT NULL
        AND ST_Intersects(
          geom,
          ST_SetSRID(ST_GeomFromGeoJSON(${radiusPolygonJson}), 4326)::geography
        )
    ),
    address_only AS (
      SELECT
        permit_id, permit_type, address, issue_date::text AS issue_date,
        permit_status, permit_milestone, work_type, work_description,
        reported_cost, lat, lon, fetched_at::text AS fetched_at,
        regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS normalized_address
      FROM building_permits
      WHERE geom IS NULL
        AND regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') IN (
          SELECT DISTINCT normalized_address FROM point_matches WHERE normalized_address <> ''
        )
    )
    SELECT *, 'point'::text AS located_via FROM point_matches
    UNION ALL
    SELECT *, 'address_only'::text AS located_via FROM address_only
  `) as unknown as RawAreaPermitRow[];

  // ── S1: classify strongest-first, drop non-matches (the candidate net is
  // deliberately wider than genuine matches). ──
  const subjectMapped = subjectCandidateRows
    .map(mapRawPermitRow)
    .filter((row): row is MappedPermitRow => row !== null);

  const subjectRowsUnfiltered: PermitExhibitSubjectRow[] = [];
  for (const row of subjectMapped) {
    const method = classifyPermitExhibitMatch(row, parcel, normalizedSitusAddress);
    if (!method) continue;
    subjectRowsUnfiltered.push({
      permitNumber: row.permitNumber,
      type: row.type,
      typeKey: row.typeKey,
      rawType: row.rawType,
      workDescription: row.workDescription,
      issueDate: row.issueDate,
      estimatedCostSelfReported: row.estimatedCostSelfReported,
      status: row.status,
      milestone: row.milestone,
      matchMethod: method,
      matchConfidence: PERMIT_EXHIBIT_MATCH_CONFIDENCE[method],
      sourceRecordUrl: row.sourceRecordUrl,
    });
  }
  const subject = applyTypeFilter(subjectRowsUnfiltered, filters).sort((a, b) => {
    const aDate = a.issueDate ?? "";
    const bDate = b.issueDate ?? "";
    if (aDate !== bDate) return aDate.localeCompare(bDate); // oldest first
    return a.permitNumber.localeCompare(b.permitNumber);
  });

  // ── S2 ──
  const areaMapped = areaRows
    .map((row) => {
      const mapped = mapRawPermitRow(row);
      if (!mapped) return null;
      const locatedVia: PermitExhibitAreaLocation =
        textOrNull(row.located_via) === "address_only" ? "address_only" : "point";
      const areaRow: PermitExhibitAreaRow = {
        permitNumber: mapped.permitNumber,
        type: mapped.type,
        typeKey: mapped.typeKey,
        rawType: mapped.rawType,
        workDescription: mapped.workDescription,
        issueDate: mapped.issueDate,
        estimatedCostSelfReported: mapped.estimatedCostSelfReported,
        status: mapped.status,
        milestone: mapped.milestone,
        sourceRecordUrl: mapped.sourceRecordUrl,
        locatedVia,
      };
      return { areaRow, fetchedAt: mapped.fetchedAt };
    })
    .filter((entry): entry is { areaRow: PermitExhibitAreaRow; fetchedAt: string | null } => entry !== null);

  const areaRowsFiltered = applyTypeFilter(
    areaMapped.map((entry) => entry.areaRow),
    filters,
  ).sort((a, b) => {
    const aDate = a.issueDate ?? "";
    const bDate = b.issueDate ?? "";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return a.permitNumber.localeCompare(b.permitNumber);
  });

  const area: PermitExhibitArea = {
    byYear: aggregateByYear(areaRowsFiltered),
    byType: aggregateByType(areaRowsFiltered),
    rows: areaRowsFiltered,
  };

  // ── Boundary context (S3) + zoning archive index — run together. ──
  const [tifAndOverlays, zoningDistrict, archiveVintageRange] = await Promise.all([
    resolveZonesAtPoint(parcel.centroid.lat, parcel.centroid.lon),
    resolveZoningDistrictAtPoint(parcel.centroid.lat, parcel.centroid.lon, fetchImpl),
    readArchiveVintageRange(),
  ]);
  const tifDistricts = (tifAndOverlays as ZoneMatch[])
    .filter((zone) => zone.key === "tif")
    .map((zone) => ({ key: zone.key, name: zone.name }));
  const overlays = (tifAndOverlays as ZoneMatch[])
    .filter((zone) => zone.key !== "tif")
    .map((zone) => ({ key: zone.key, name: zone.name }));

  const asOfDate = now().toISOString().slice(0, 10);
  const boundaryContext: PermitExhibitBoundaryContext = {
    asOfDate,
    parcelAddress: parcel.situsAddress,
    zoningDistrict,
    tifDistricts,
    overlays,
    archiveVintageRange,
    limitNote: formatBoundaryContextLimitNote(asOfDate),
  };

  // ── Coverage (S4) ──
  const matchMethodBreakdown: PermitExhibitMatchMethodBreakdown = {
    pinParcel: subject.filter((row) => row.matchMethod === "pin_parcel").length,
    addressExact: subject.filter((row) => row.matchMethod === "address_exact").length,
    proximity: subject.filter((row) => row.matchMethod === "proximity").length,
  };
  const areaGeolocatedCount = areaRowsFiltered.filter((row) => row.locatedVia === "point").length;
  const areaUnlocatedCount = areaRowsFiltered.filter((row) => row.locatedVia === "address_only").length;
  const coverage: PermitExhibitCoverage = {
    matchMethodBreakdown,
    area: {
      geolocatedCount: areaGeolocatedCount,
      unlocatedCount: areaUnlocatedCount,
      totalCount: areaGeolocatedCount + areaUnlocatedCount,
    },
    coverageNote: PERMIT_EXHIBIT_COVERAGE_NOTE,
  };

  // ── Meta ──
  const allFetchedAt = [
    ...subjectMapped.map((row) => row.fetchedAt),
    ...areaMapped.map((entry) => entry.fetchedAt),
  ].filter((value): value is string => value !== null);
  const datasetLastUpdate =
    allFetchedAt.length > 0
      ? allFetchedAt.reduce((latest, current) => (current > latest ? current : latest))
      : null;

  const exhibitId = computePermitExhibitId({
    pin,
    radiusFt,
    filters,
    snapshotVintage: datasetLastUpdate,
  });

  const meta: PermitExhibitMeta = {
    snapshotDate: asOfDate,
    datasetLastUpdate,
    exhibitId,
    queryParams: {
      pin,
      pinFormatted: formatPin14(pin) ?? pin,
      radiusFt,
      filters,
    },
    sourceLabel: PERMIT_AREA_SOURCE_LABEL,
    sourceUrl: PERMIT_AREA_SOURCE_URL,
    sourcePortalUrl: PERMIT_AREA_PORTAL_URL,
    historyWindow: "full_ingested_history",
    ingestFloorDate: PERMIT_SINCE_DATE,
    costLabel: PERMIT_EXHIBIT_COST_LABEL,
    limitsBlock: PERMIT_EXHIBIT_LIMITS,
    exhibitIdFooter: formatExhibitIdFooter(exhibitId),
    subjectParcel: {
      pin,
      pinFormatted: formatPin14(pin) ?? pin,
      situsAddress: parcel.situsAddress,
    },
  };

  return { subject, area, boundaryContext, coverage, meta };
}
