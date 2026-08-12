/**
 * Local zoning-district resolution against a bulk snapshot of the City's
 * ArcGIS zoning boundary layer (gisapps.chicago.gov/.../Zoning/MapServer/1),
 * clipped to the nine pilot-ZIP envelopes.
 *
 * Per the gpt5.6 matchmaker consult (Q2): do not make one Socrata/ArcGIS
 * point request per tracked site (thousands of requests, throttling risk,
 * partial-completion risk). Pull the boundary geometry once
 * (scripts/fetch-zoning-snapshot.ts), then resolve every canonical site's
 * district locally, in-process, against this snapshot.
 *
 * Pure module — no network, no fs. The fetch script builds a
 * `ZoningSnapshot` from the ArcGIS response and calls into here for
 * geometry validation/repair and point resolution; the universe export
 * script calls `resolveDistrictAtPoint` per canonical site.
 */

export type Ring = Array<[number, number]>; // [lon, lat] pairs, closed (first === last)
export type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

/** One zoning polygon as published by the ArcGIS layer. `rings` is the FLAT
 * esriJSON ring list for this feature (exterior + hole rings mixed, not
 * grouped by polygon) — see `pointInEsriRings` for why that is safe to test
 * directly without regrouping by winding order. */
export interface ZoningSnapshotFeature {
  globalId: string;
  zoneClass: string | null;
  zoneType: number | null;
  pdNum: number | null;
  pmdSubArea: string | null;
  updateTimestamp: string | null;
  ordinanceNum: string | null;
  ordinanceDate: string | null;
  clerkDocNo: string | null;
  rings: Ring[];
  bbox: Bbox;
}

export interface ZoningSnapshotSource {
  url: string;
  /** ISO timestamp this snapshot was pulled. */
  vintage: string;
  /** sha256 of the sorted, normalized feature list — the source-mutation
   * guard: two pulls of the same underlying data hash identically. */
  checksum: string;
}

export interface ZoningSnapshot {
  schemaVersion: 1;
  source: ZoningSnapshotSource;
  /** Pilot ZIPs this snapshot was clipped to. */
  zips: string[];
  featureCount: number;
  features: ZoningSnapshotFeature[];
}

// ── Ring geometry: validation, repair, point-in-polygon ────────────────────

function isFiniteCoord(pt: unknown): pt is [number, number] {
  return (
    Array.isArray(pt) &&
    pt.length >= 2 &&
    Number.isFinite(pt[0]) &&
    Number.isFinite(pt[1])
  );
}

/**
 * Validate a single ring and deterministically repair the one common,
 * benign defect (an unclosed ring — first point != last point, a frequent
 * ArcGIS JSON export quirk) by appending the first point. Returns `null`
 * when the ring cannot be trusted even after repair: fewer than 4 points,
 * a non-finite coordinate, or (post-repair) fewer than 3 distinct vertices.
 * Callers must treat `null` as a fatal geometry defect for the export
 * (fail-closed), never as "skip this ring silently".
 */
export function validateAndRepairRing(ring: unknown): Ring | null {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const points: [number, number][] = [];
  for (const raw of ring) {
    if (!isFiniteCoord(raw)) return null;
    points.push([raw[0], raw[1]]);
  }
  const first = points[0];
  const last = points[points.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const repaired = closed ? points : [...points, [first[0], first[1]] as [number, number]];
  // After closing, a valid ring needs at least 3 distinct vertices (a
  // triangle) plus the repeated closing point = 4 entries minimum.
  if (repaired.length < 4) return null;
  return repaired;
}

/** Bounding box of a set of already-validated rings. */
export function ringsBbox(rings: readonly Ring[]): Bbox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
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

/**
 * Point-in-polygon-with-holes test over a FLAT esriJSON ring list (exterior
 * and hole rings mixed, not grouped by polygon). This is safe without
 * regrouping: for a valid, non-self-intersecting nested ring set (which is
 * what a real GIS layer publishes), a point is inside the polygon iff it
 * falls inside an ODD number of the rings tested independently — exteriors
 * and their nested holes cancel out under the parity rule regardless of
 * winding order. A single ArcGIS "feature" can bundle multiple disjoint
 * exteriors (e.g. a PD split across two lots) plus their holes; parity
 * still resolves correctly because holes only ever nest inside their own
 * exterior, never straddle two.
 */
export function pointInEsriRings(lon: number, lat: number, rings: readonly Ring[]): boolean {
  let count = 0;
  for (const ring of rings) {
    if (pointInRing(lon, lat, ring)) count += 1;
  }
  return count % 2 === 1;
}

function bboxContainsPoint(bbox: Bbox, lat: number, lon: number): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

// ── Bbox grid index ─────────────────────────────────────────────────────────

export interface ZoningBboxIndex {
  cellSizeDeg: number;
  cells: Map<string, number[]>;
}

function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

/** Build a uniform-grid bbox index over the snapshot's features so a point
 * lookup only tests the small number of polygons whose bbox could possibly
 * contain it, instead of scanning every feature in the (citywide-adjacent)
 * snapshot. Default cell size ~0.01deg (~1.1km at Chicago's latitude) —
 * comfortably larger than a zoning parcel, small enough to keep buckets
 * tight. */
export function buildZoningBboxIndex(
  features: readonly ZoningSnapshotFeature[],
  cellSizeDeg = 0.01,
): ZoningBboxIndex {
  const cells = new Map<string, number[]>();
  features.forEach((feature, i) => {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    const gx0 = Math.floor(minLon / cellSizeDeg);
    const gx1 = Math.floor(maxLon / cellSizeDeg);
    const gy0 = Math.floor(minLat / cellSizeDeg);
    const gy1 = Math.floor(maxLat / cellSizeDeg);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = cellKey(gx, gy);
        const arr = cells.get(key);
        if (arr) arr.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  return { cellSizeDeg, cells };
}

function candidateFeatureIndices(index: ZoningBboxIndex, lat: number, lon: number): number[] {
  const gx = Math.floor(lon / index.cellSizeDeg);
  const gy = Math.floor(lat / index.cellSizeDeg);
  return index.cells.get(cellKey(gx, gy)) ?? [];
}

// ── District resolution ──────────────────────────────────────────────────

export type DistrictResolutionState = "resolved" | "unresolved" | "ambiguous";

export interface DistrictResolution {
  state: DistrictResolutionState;
  /** The single matched feature — present only when `state === "resolved"`.
   * Never populated on "ambiguous" (multiple candidates) — a `$limit=1`
   * arbitrary pick is explicitly disallowed by the consult. */
  district: ZoningSnapshotFeature | null;
  /** How many polygons the point fell inside (0, 1, or >1) — carried onto
   * the "ambiguous" state so the universe row can be honest about it. */
  candidateCount: number;
}

/**
 * Resolve which zoning district (if any) contains a point, using the bbox
 * index to shortlist candidates and full point-in-polygon to confirm.
 * A point in 0 polygons is `unresolved`; a point in >1 polygons is
 * `ambiguous` (never an arbitrary pick, per the consult's Q2 correction) —
 * both are explicit states the universe row carries, never silently
 * collapsed to "none mapped".
 */
export function resolveDistrictAtPoint(
  lat: number,
  lon: number,
  features: readonly ZoningSnapshotFeature[],
  index: ZoningBboxIndex,
): DistrictResolution {
  const matches: ZoningSnapshotFeature[] = [];
  for (const i of candidateFeatureIndices(index, lat, lon)) {
    const feature = features[i];
    if (!bboxContainsPoint(feature.bbox, lat, lon)) continue;
    if (pointInEsriRings(lon, lat, feature.rings)) matches.push(feature);
  }
  if (matches.length === 0) return { state: "unresolved", district: null, candidateCount: 0 };
  if (matches.length === 1) return { state: "resolved", district: matches[0], candidateCount: 1 };
  return { state: "ambiguous", district: null, candidateCount: matches.length };
}

// ── ArcGIS esriJSON normalization ──────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalize one ArcGIS esriJSON polygon feature into a `ZoningSnapshotFeature`.
 * Returns `null` when the feature lacks a GLOBALID/geometry, OR when ANY of
 * its rings fails validation even after the deterministic repair attempt —
 * the caller (fetch-zoning-snapshot.ts) treats that as fatal for the whole
 * export ("fail closed", never "drop the bad ring and keep going" — a
 * partially-missing polygon would silently misreport its neighborhood as
 * unresolved instead of surfacing a real data defect).
 */
export function normalizeArcGisZoningFeature(value: unknown): ZoningSnapshotFeature | null {
  if (!isRecord(value) || !isRecord(value.attributes) || !isRecord(value.geometry)) return null;
  const attributes = value.attributes;
  const globalId = nullableText(attributes.GLOBALID);
  if (!globalId) return null;

  const rawRings = value.geometry.rings;
  if (!Array.isArray(rawRings) || rawRings.length === 0) return null;

  const rings: Ring[] = [];
  for (const rawRing of rawRings) {
    const repaired = validateAndRepairRing(rawRing);
    if (!repaired) return null; // fail-closed: any bad ring invalidates the feature
    rings.push(repaired);
  }

  return {
    globalId,
    zoneClass: nullableText(attributes.ZONE_CLASS),
    zoneType: nullableNumber(attributes.ZONE_TYPE),
    pdNum: nullableNumber(attributes.PD_NUM),
    pmdSubArea: nullableText(attributes.PMD_SUB_AREA),
    updateTimestamp:
      typeof attributes.UPDATE_TIMESTAMP === "number"
        ? new Date(attributes.UPDATE_TIMESTAMP).toISOString()
        : nullableText(attributes.UPDATE_TIMESTAMP),
    ordinanceNum: nullableText(attributes.ORDINANCE_NUM),
    ordinanceDate:
      typeof attributes.ORDINANCE_DATE === "number"
        ? new Date(attributes.ORDINANCE_DATE).toISOString()
        : nullableText(attributes.ORDINANCE_DATE),
    clerkDocNo: nullableText(attributes.CLERK_DOCNO),
    rings,
    bbox: ringsBbox(rings),
  };
}

/** Dedupe features collapsed across overlapping ZIP-envelope pulls, keeping
 * the first occurrence (deterministic: callers process ZIPs and pages in a
 * fixed order and results arrive GLOBALID-ordered per page). */
export function dedupeZoningFeatures(
  features: readonly ZoningSnapshotFeature[],
): ZoningSnapshotFeature[] {
  const seen = new Set<string>();
  const out: ZoningSnapshotFeature[] = [];
  for (const feature of features) {
    if (seen.has(feature.globalId)) continue;
    seen.add(feature.globalId);
    out.push(feature);
  }
  return out;
}
