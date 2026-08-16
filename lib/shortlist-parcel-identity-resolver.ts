/**
 * The PURE geometry + decision core of the offline parcel-identity
 * precompute (scripts/resolve-shortlist-universe-parcels.ts).
 *
 * Plain TypeScript — no "server-only", no fs, no network — so the script
 * (run by `tsx`, outside Next's bundler) and the unit tests can both import
 * it, and so the rules below are TESTABLE rather than buried in a script
 * nobody runs in CI.
 *
 * PARITY DOCTRINE: this resolver must be AT LEAST AS STRICT as the live
 * /api/shortlist/resolve-parcel route. A precomputed answer is written to a
 * committed file and then trusted by the runtime without re-checking, so
 * anywhere the live route would refuse to answer ("malformed"), this must
 * write NO ENTRY AT ALL — leaving the row to the live route at request time,
 * which is always allowed to be more forgiving than a permanent record.
 * Concretely, `null` (no entry) is returned when:
 *   • ANY intersecting feature has an unparseable PIN14 — never skipped past,
 *     because the skipped feature might have been the one that made this
 *     point ambiguous;
 *   • two features share a PIN but publish DIFFERENT addresses;
 *   • the single matched parcel publishes a blank/unusable street address —
 *     that is an unusable County record, not an address mismatch.
 *
 * CONTAINMENT: `esriSpatialRelIntersects` (what the live route asks the
 * County for) includes the BOUNDARY. Even-odd alone does not, and it was
 * previously run over every feature's rings POOLED, which also cancels
 * containment when two parcels overlap. Both are fixed here: containment is
 * evaluated per feature, and a point lying on any ring segment counts as
 * inside — so a point on a shared lot line belongs to BOTH parcels and comes
 * back `ambiguous`, exactly as the live route would report it.
 */

import { normalizePin14 } from "./cook-viewer";
import {
  normalizedParcelStreetAddress,
  parcelAddressesMatch,
} from "./site-matchmaker-parcel-resolution";

export type Ring = Array<[number, number]>;

export interface CountyParcelFeature {
  /** RAW PIN14 exactly as the County published it — normalized here, not by
   *  the caller, because an unparseable one must poison the whole row. */
  rawPin: unknown;
  /** The County's published street address, already joined with city/state/ZIP. */
  address: string;
  rings: Ring[];
  bbox: [number, number, number, number];
}

export interface ResolverRow {
  canonicalKey: string;
  pin: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export type ParcelIdentityEntry =
  | { status: "resolved"; pin: string; countyAddress: string; checkedAt: string }
  | { status: "no_match"; reason: "no_intersection" | "address_mismatch"; checkedAt: string }
  | { status: "ambiguous"; candidateCount: number; checkedAt: string };

/** Degrees. The script requests County geometry at 7 decimals, so ring
 *  vertices sit on a 1e-7° grid (~1.1 cm of latitude) and a true shared lot
 *  line can be displaced from its rounded representation by up to ~7.1e-8°.
 *  One full grid cell (1e-7°) therefore catches every genuine shared-boundary
 *  point while staying ~5 orders of magnitude inside a Chicago lot width, so
 *  it can never manufacture a false ambiguity between neighbours. */
export const BOUNDARY_EPSILON_DEGREES = 1e-7;

/** Even-odd ray cast over one feature's rings. Outer rings and holes are
 *  both included, which is what makes a point inside a hole come back
 *  false. Boundary points are NOT reliably detected here — see
 *  `onRingBoundary`, which callers must OR with this. */
export function pointInRings(lon: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

/** True when the point lies ON any ring segment (within epsilon) — the
 *  boundary case `esriSpatialRelIntersects` counts as intersecting and
 *  even-odd does not. */
export function onRingBoundary(
  lon: number,
  lat: number,
  rings: Ring[],
  epsilon: number = BOUNDARY_EPSILON_DEGREES,
): boolean {
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const dx = xj - xi;
      const dy = yj - yi;
      const lengthSquared = dx * dx + dy * dy;
      // Degenerate segment: compare against the vertex itself.
      if (lengthSquared === 0) {
        if (Math.abs(lon - xi) <= epsilon && Math.abs(lat - yi) <= epsilon) return true;
        continue;
      }
      // Closest point on the segment, clamped to its ends.
      const t = Math.max(0, Math.min(1, ((lon - xi) * dx + (lat - yi) * dy) / lengthSquared));
      const nearestX = xi + t * dx;
      const nearestY = yi + t * dy;
      if (Math.hypot(lon - nearestX, lat - nearestY) <= epsilon) return true;
    }
  }
  return false;
}

/** Containment with the boundary INCLUDED, evaluated for ONE feature. */
export function featureContainsPoint(
  lon: number,
  lat: number,
  feature: Pick<CountyParcelFeature, "rings" | "bbox">,
  epsilon: number = BOUNDARY_EPSILON_DEGREES,
): boolean {
  const [xmin, ymin, xmax, ymax] = feature.bbox;
  // The bbox is a cheap reject only — padded by epsilon so a boundary point
  // sitting exactly on the envelope edge is never discarded before the real
  // test runs.
  if (
    lon < xmin - epsilon ||
    lon > xmax + epsilon ||
    lat < ymin - epsilon ||
    lat > ymax + epsilon
  ) {
    return false;
  }
  return pointInRings(lon, lat, feature.rings) || onRingBoundary(lon, lat, feature.rings, epsilon);
}

export function ringsBbox(rings: Ring[]): [number, number, number, number] {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

/**
 * The precompute's decision for ONE universe row.
 *
 * Returns `null` for every condition the live route answers "malformed" on
 * (see this file's header) — the row then simply carries no precomputed
 * identity and resolves live when a reader opens it.
 */
export function resolveRow(
  row: ResolverRow,
  features: readonly CountyParcelFeature[],
  checkedAt: string,
): ParcelIdentityEntry | null {
  const lon = row.lon;
  const lat = row.lat;
  if (typeof lon !== "number" || typeof lat !== "number") return null;

  const unique = new Map<string, string>();
  for (const feature of features) {
    if (!featureContainsPoint(lon, lat, feature)) continue;
    // STRICTNESS, not tolerance: a feature at this point whose PIN cannot be
    // parsed makes the whole point untrustworthy. Skipping it could turn a
    // genuinely ambiguous point into a confident single match.
    const pin = normalizePin14(typeof feature.rawPin === "string" ? feature.rawPin : null);
    if (!pin) return null;
    if (normalizedParcelStreetAddress(feature.address).length < 6) return null;
    const previous = unique.get(pin);
    if (
      previous !== undefined &&
      normalizedParcelStreetAddress(previous) !== normalizedParcelStreetAddress(feature.address)
    ) {
      // The same parcel published under two different addresses — the live
      // route calls this malformed; a permanent record must not guess.
      return null;
    }
    unique.set(pin, feature.address);
  }

  if (unique.size === 0) return { status: "no_match", reason: "no_intersection", checkedAt };
  if (unique.size > 1) return { status: "ambiguous", candidateCount: unique.size, checkedAt };

  const [pin, countyAddress] = [...unique.entries()][0];
  if (!parcelAddressesMatch(row.address, countyAddress)) {
    return { status: "no_match", reason: "address_mismatch", checkedAt };
  }
  return { status: "resolved", pin, countyAddress, checkedAt };
}
