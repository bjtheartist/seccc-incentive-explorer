import { describe, expect, it } from "vitest";
import {
  featureContainsPoint,
  onRingBoundary,
  pointInRings,
  resolveRow,
  ringsBbox,
  type CountyParcelFeature,
  type Ring,
} from "../shortlist-parcel-identity-resolver";

/**
 * PARITY SUITE. The offline precompute writes a COMMITTED answer that the
 * runtime then trusts without re-checking, so it must never be more
 * permissive than the live /api/shortlist/resolve-parcel route. Every case
 * the live route answers "malformed" on must produce NO ENTRY here (`null`),
 * leaving the row to resolve live at request time.
 */

const CHECKED_AT = "2026-08-16T04:02:47.077Z";

/** A unit square with its lower-left corner at (x, y). */
function square(x: number, y: number, size = 1): Ring {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
}

function feature(overrides: Partial<CountyParcelFeature> = {}): CountyParcelFeature {
  const rings = overrides.rings ?? [square(0, 0)];
  return {
    rawPin: "16264270400000",
    address: "3040 S HOMAN AVE, CHICAGO, IL 60623",
    rings,
    bbox: overrides.bbox ?? ringsBbox(rings),
    ...overrides,
  };
}

function row(overrides: Partial<Parameters<typeof resolveRow>[0]> = {}) {
  return {
    canonicalKey: "site:aaa",
    pin: null,
    address: "3040 S HOMAN AVE",
    lat: 0.5,
    lon: 0.5,
    ...overrides,
  };
}

describe("pointInRings", () => {
  it("is true inside a simple polygon and false outside it", () => {
    expect(pointInRings(0.5, 0.5, [square(0, 0)])).toBe(true);
    expect(pointInRings(1.5, 0.5, [square(0, 0)])).toBe(false);
  });

  it("excludes a point inside a HOLE ring", () => {
    // 4x4 outer square with a 2x2 hole centred at (2, 2).
    const outer = square(0, 0, 4);
    const hole = square(1.5, 1.5, 1);
    expect(pointInRings(2, 2, [outer, hole])).toBe(false);
    // …while a point in the donut itself is still inside.
    expect(pointInRings(0.5, 0.5, [outer, hole])).toBe(true);
  });
});

describe("onRingBoundary", () => {
  it("detects a point lying on an edge and on a vertex", () => {
    expect(onRingBoundary(0.5, 0, [square(0, 0)])).toBe(true);
    expect(onRingBoundary(1, 1, [square(0, 0)])).toBe(true);
  });

  it("is false for a point clearly off the boundary", () => {
    expect(onRingBoundary(0.5, 0.5, [square(0, 0)])).toBe(false);
    expect(onRingBoundary(0.5, 0.01, [square(0, 0)])).toBe(false);
  });

  it("absorbs the County's 7-decimal geometry rounding on a real shared lot line (epsilon must exceed the grid)", () => {
    // Two Chatham-scale neighbours sharing the edge x = -87.6084000, with the
    // County's vertices rounded to 7 decimals. A survey point that truly sits
    // on that line can land up to ~7.1e-8° from the rounded segment.
    const west: Ring = [
      [-87.6085, 41.7235],
      [-87.6084, 41.7235],
      [-87.6084, 41.7236],
      [-87.6085, 41.7236],
      [-87.6085, 41.7235],
    ];
    const east: Ring = [
      [-87.6084, 41.7235],
      [-87.6083, 41.7235],
      [-87.6083, 41.7236],
      [-87.6084, 41.7236],
      [-87.6084, 41.7235],
    ];
    const lon = -87.6084 + 3.77e-8; // half a grid cell east of the rounded edge
    const lat = 41.72355;
    expect(onRingBoundary(lon, lat, [west])).toBe(true);
    expect(onRingBoundary(lon, lat, [east])).toBe(true);
    // A point well inside the east lot is never "on" the boundary.
    expect(onRingBoundary(-87.60835, lat, [west])).toBe(false);
    // With a sub-grid epsilon the same point would be missed — the guard this test exists for.
    expect(onRingBoundary(lon, lat, [west], 1e-9)).toBe(false);
  });
});

describe("featureContainsPoint", () => {
  it("counts the boundary as inside, matching esriSpatialRelIntersects", () => {
    const parcel = feature();
    expect(featureContainsPoint(0.5, 0.5, parcel)).toBe(true);
    expect(featureContainsPoint(1, 0.5, parcel)).toBe(true); // exactly on the right edge
    expect(featureContainsPoint(1.5, 0.5, parcel)).toBe(false);
  });

  it("is evaluated PER FEATURE, so two overlapping parcels do not cancel each other", () => {
    const left = feature({ rings: [square(0, 0, 2)] });
    const right = feature({ rings: [square(1, 0, 2)] });
    // A point in the overlap belongs to BOTH — a pooled even-odd test would
    // have flipped twice and reported neither.
    expect(featureContainsPoint(1.5, 1, left)).toBe(true);
    expect(featureContainsPoint(1.5, 1, right)).toBe(true);
  });
});

describe("resolveRow", () => {
  it("resolves a single containing parcel whose address matches", () => {
    expect(resolveRow(row(), [feature()], CHECKED_AT)).toEqual({
      status: "resolved",
      pin: "16264270400000",
      countyAddress: "3040 S HOMAN AVE, CHICAGO, IL 60623",
      checkedAt: CHECKED_AT,
    });
  });

  it("reports no_intersection when the point is in no parcel at all", () => {
    expect(resolveRow(row({ lat: 9, lon: 9 }), [feature()], CHECKED_AT)).toEqual({
      status: "no_match",
      reason: "no_intersection",
      checkedAt: CHECKED_AT,
    });
  });

  it("reports address_mismatch for a single parcel publishing a different address", () => {
    const other = feature({ address: "9999 N NOWHERE AVE, CHICAGO, IL 60623" });
    expect(resolveRow(row(), [other], CHECKED_AT)).toEqual({
      status: "no_match",
      reason: "address_mismatch",
      checkedAt: CHECKED_AT,
    });
  });

  it("calls a point on a SHARED LOT LINE ambiguous — both parcels intersect it", () => {
    const west = feature({ rings: [square(0, 0)], rawPin: "16264270400000" });
    const east = feature({ rings: [square(1, 0)], rawPin: "16264270410000" });
    // x = 1 is the boundary both squares share.
    expect(resolveRow(row({ lon: 1, lat: 0.5 }), [west, east], CHECKED_AT)).toEqual({
      status: "ambiguous",
      candidateCount: 2,
      checkedAt: CHECKED_AT,
    });
  });

  it("writes NO ENTRY when any containing feature has an unparseable PIN14", () => {
    const bad = feature({ rawPin: "not-a-pin" });
    expect(resolveRow(row(), [bad], CHECKED_AT)).toBeNull();
    // Even alongside a perfectly good match — skipping the bad one could
    // turn a genuinely ambiguous point into a confident single answer.
    expect(resolveRow(row(), [feature(), bad], CHECKED_AT)).toBeNull();
    expect(resolveRow(row(), [feature({ rawPin: null }), feature()], CHECKED_AT)).toBeNull();
  });

  it("writes NO ENTRY when duplicate-PIN features disagree on the address", () => {
    const first = feature();
    const second = feature({ address: "3100 S HOMAN AVE, CHICAGO, IL 60623" });
    expect(resolveRow(row(), [first, second], CHECKED_AT)).toBeNull();
  });

  it("accepts duplicate-PIN features that AGREE on the address", () => {
    const first = feature();
    const second = feature({ rings: [square(0, 0, 2)] });
    expect(resolveRow(row(), [first, second], CHECKED_AT)).toMatchObject({ status: "resolved" });
  });

  it("writes NO ENTRY for a blank County street address — unusable, not a mismatch", () => {
    expect(resolveRow(row(), [feature({ address: "" })], CHECKED_AT)).toBeNull();
    expect(resolveRow(row(), [feature({ address: "  ,  " })], CHECKED_AT)).toBeNull();
  });

  it("writes NO ENTRY for a row with no usable coordinate", () => {
    expect(resolveRow(row({ lat: null }), [feature()], CHECKED_AT)).toBeNull();
    expect(resolveRow(row({ lon: null }), [feature()], CHECKED_AT)).toBeNull();
  });

  it("does not match a point inside a parcel's HOLE", () => {
    const donut = feature({ rings: [square(0, 0, 4), square(1.5, 1.5, 1)] });
    expect(resolveRow(row({ lat: 2, lon: 2 }), [donut], CHECKED_AT)).toMatchObject({
      status: "no_match",
      reason: "no_intersection",
    });
  });
});
