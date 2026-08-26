/**
 * lib/permit-exhibit-types.ts — the rendering-facing shape of a Permit
 * History Exhibit, kept in lockstep with PR1's frozen evidence-spine
 * contract (see the master spec, "PR 1 — evidence spine"):
 *
 *   buildPermitExhibit({ pin, radiusFt }) => {
 *     subject: rows[],
 *     area: { byYear, byType, rows[] },
 *     boundaryContext,
 *     coverage,
 *     meta: { snapshotDate, datasetLastUpdate, exhibitId, queryParams },
 *   }
 *
 * PR1 owns lib/permit-exhibit.ts and is the source of truth once it lands
 * (see lib/permit-exhibit-source.ts for the Phase A -> Phase B swap). This
 * file exists so PR2 (this branch) can build the full surface — page,
 * sections, gate, print route, tests — against a stable local type before
 * the spine branch exists. Every field name here is chosen to match the
 * frozen contract literally; the only ADDITIVE judgment calls (documented
 * inline) are the shape of `boundaryContext` and `coverage`, which the
 * spec names but does not fully enumerate.
 */

/** A permit row's confidence in belonging to the subject parcel or radius. */
export type PermitExhibitMatchMethod = "pin_parcel" | "address_exact" | "proximity";

/**
 * One permit record as it appears on the exhibit. Field names and the cost
 * label are pinned by the spec:
 *   - `estimatedCostSelfReported` renders ONLY under the label "Estimated
 *     cost (self-reported to City)" — never summed, never averaged.
 *   - `matchMethod` governs section placement (S1: pin_parcel/address_exact
 *     in the main table, proximity in its own "Nearby, not matched to this
 *     parcel" subsection — never intermingled).
 */
export interface PermitExhibitRow {
  issueDate: string;
  permitNumber: string;
  type: string;
  workDescription: string | null;
  estimatedCostSelfReported: number | null;
  status: string | null;
  matchMethod: PermitExhibitMatchMethod;
}

export interface PermitExhibitYearCount {
  year: number;
  count: number;
}

export interface PermitExhibitTypeCount {
  type: string;
  count: number;
}

/** S2 — area context: radius aggregation (counts only, no cost) + records. */
export interface PermitExhibitArea {
  byYear: PermitExhibitYearCount[];
  byType: PermitExhibitTypeCount[];
  rows: PermitExhibitRow[];
}

/**
 * S3 — boundary-as-of context for the subject parcel TODAY. JUDGMENT CALL:
 * the frozen contract names `boundaryContext` as an opaque field; this repo
 * carries the subject parcel's address here too (rather than inventing a
 * second top-level field) since every value in this object describes "the
 * subject parcel as of {asOfDate}" — the address is part of that same
 * as-of description. Phase B's wiring step (lib/permit-exhibit-source.ts)
 * is the single place that reconciles this against PR1's actual shape.
 */
export interface PermitExhibitBoundaryContext {
  parcelAddress: string | null;
  zoningDistrict: string | null;
  tifDistricts: string[];
  overlays: string[];
  /** The zoning snapshot date the S3 honest-limit line names. */
  asOfDate: string;
}

/** S4 — coverage arithmetic: match-method breakdown + unlocated count. */
export interface PermitExhibitCoverage {
  totalSourceRowsInRadius: number;
  geolocatedRows: number;
  unlocatedCount: number;
  matchMethodCounts: {
    pinParcel: number;
    addressExact: number;
    proximity: number;
  };
}

export interface PermitExhibitQueryParams {
  pin: string;
  radiusFt: number;
  [key: string]: string | number | boolean;
}

export interface PermitExhibitMeta {
  snapshotDate: string;
  datasetLastUpdate: string;
  exhibitId: string;
  queryParams: PermitExhibitQueryParams;
}

export interface PermitExhibitResult {
  subject: PermitExhibitRow[];
  area: PermitExhibitArea;
  boundaryContext: PermitExhibitBoundaryContext;
  coverage: PermitExhibitCoverage;
  meta: PermitExhibitMeta;
}

/** Typed failure the PIN/radius validation and the spine's own lookup can
 *  surface — used to render an honest unavailable state, never a false
 *  empty exhibit. */
export type PermitExhibitLoadError =
  | { kind: "invalid_pin" }
  | { kind: "invalid_radius" }
  | { kind: "parcel_not_found" }
  | { kind: "unavailable" };

export type PermitExhibitLoadResult =
  | { ok: true; data: PermitExhibitResult }
  | { ok: false; error: PermitExhibitLoadError };

export const PERMIT_EXHIBIT_RADIUS_OPTIONS_FT = [250, 500, 1000] as const;
export type PermitExhibitRadiusFt = (typeof PERMIT_EXHIBIT_RADIUS_OPTIONS_FT)[number];
export const PERMIT_EXHIBIT_DEFAULT_RADIUS_FT: PermitExhibitRadiusFt = 500;

export function isPermitExhibitRadiusFt(value: number): value is PermitExhibitRadiusFt {
  return (PERMIT_EXHIBIT_RADIUS_OPTIONS_FT as readonly number[]).includes(value);
}
