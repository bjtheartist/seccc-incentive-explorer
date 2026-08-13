import { describe, expect, it } from "vitest";
import {
  buildZoningBboxIndex,
  dedupeZoningFeatures,
  normalizeArcGisZoningFeature,
  pointInEsriRings,
  resolveDistrictAtPoint,
  ringsBbox,
  validateAndRepairRing,
  type ZoningSnapshotFeature,
} from "../zoning-snapshot";

// A 1deg x 1deg square, [lon, lat] winding: (0,0) (1,0) (1,1) (0,1) closed.
const SQUARE_RING: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

function feature(overrides: Partial<ZoningSnapshotFeature> = {}): ZoningSnapshotFeature {
  const rings = overrides.rings ?? [SQUARE_RING];
  return {
    globalId: "G1",
    zoneClass: "B3-2",
    zoneType: null,
    pdNum: null,
    pmdSubArea: null,
    updateTimestamp: null,
    ordinanceNum: null,
    ordinanceDate: null,
    clerkDocNo: null,
    rings,
    bbox: ringsBbox(rings),
    ...overrides,
  };
}

describe("validateAndRepairRing", () => {
  it("accepts an already-closed ring unchanged", () => {
    const repaired = validateAndRepairRing(SQUARE_RING);
    expect(repaired).toEqual(SQUARE_RING);
  });

  it("deterministically closes an unclosed ring by repeating the first point", () => {
    const unclosed = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const repaired = validateAndRepairRing(unclosed);
    expect(repaired).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it("rejects a ring with fewer than 4 points", () => {
    expect(validateAndRepairRing([[0, 0], [1, 1]])).toBeNull();
  });

  it("rejects a ring with a non-finite coordinate", () => {
    expect(validateAndRepairRing([[0, 0], [1, 0], [NaN, 1], [0, 1]])).toBeNull();
  });

  it("rejects non-array input", () => {
    expect(validateAndRepairRing(null)).toBeNull();
    expect(validateAndRepairRing("not a ring")).toBeNull();
  });
});

describe("pointInEsriRings", () => {
  it("finds a point inside a simple exterior ring", () => {
    expect(pointInEsriRings(0.5, 0.5, [SQUARE_RING])).toBe(true);
  });

  it("excludes a point outside the ring", () => {
    expect(pointInEsriRings(2, 2, [SQUARE_RING])).toBe(false);
  });

  it("excludes a point inside a hole (parity rule over mixed rings)", () => {
    const hole: [number, number][] = [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
    ];
    // Point inside the hole should be excluded; point outside the hole but
    // inside the exterior should be included.
    expect(pointInEsriRings(0.5, 0.5, [SQUARE_RING, hole])).toBe(false);
    expect(pointInEsriRings(0.1, 0.1, [SQUARE_RING, hole])).toBe(true);
  });
});

describe("normalizeArcGisZoningFeature", () => {
  it("normalizes a well-formed esriJSON feature", () => {
    const raw = {
      attributes: {
        GLOBALID: "{ABC-123}",
        ZONE_CLASS: "B3-2",
        ZONE_TYPE: 3,
        PD_NUM: null,
        PMD_SUB_AREA: null,
        UPDATE_TIMESTAMP: 1700000000000,
        ORDINANCE_NUM: "O2024-1",
      },
      geometry: { rings: [SQUARE_RING] },
    };
    const result = normalizeArcGisZoningFeature(raw);
    expect(result).not.toBeNull();
    expect(result!.globalId).toBe("{ABC-123}");
    expect(result!.zoneClass).toBe("B3-2");
    expect(result!.zoneType).toBe(3);
    expect(result!.ordinanceNum).toBe("O2024-1");
    expect(result!.rings).toHaveLength(1);
  });

  it("returns null when GLOBALID is missing", () => {
    expect(
      normalizeArcGisZoningFeature({ attributes: {}, geometry: { rings: [SQUARE_RING] } }),
    ).toBeNull();
  });

  it("returns null (fail-closed) when any ring is invalid even after repair", () => {
    const raw = {
      attributes: { GLOBALID: "G2" },
      geometry: { rings: [[[0, 0], [1, 1]]] }, // too few points, unrepairable
    };
    expect(normalizeArcGisZoningFeature(raw)).toBeNull();
  });

  it("repairs an unclosed ring rather than rejecting it", () => {
    const raw = {
      attributes: { GLOBALID: "G3" },
      geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
    };
    const result = normalizeArcGisZoningFeature(raw);
    expect(result).not.toBeNull();
    expect(result!.rings[0][result!.rings[0].length - 1]).toEqual([0, 0]);
  });
});

describe("dedupeZoningFeatures", () => {
  it("keeps the first occurrence of a repeated globalId", () => {
    const a = feature({ globalId: "G1", zoneClass: "B3-2" });
    const b = feature({ globalId: "G1", zoneClass: "SHOULD_NOT_WIN" });
    const c = feature({ globalId: "G2" });
    const out = dedupeZoningFeatures([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.globalId === "G1")!.zoneClass).toBe("B3-2");
  });
});

describe("resolveDistrictAtPoint", () => {
  it("resolves a point inside exactly one polygon", () => {
    const features = [feature({ globalId: "G1" })];
    const index = buildZoningBboxIndex(features);
    const result = resolveDistrictAtPoint(0.5, 0.5, features, index);
    expect(result.state).toBe("resolved");
    expect(result.district?.globalId).toBe("G1");
    expect(result.candidateCount).toBe(1);
  });

  it("returns unresolved for a point in zero polygons — never silently 'none mapped'", () => {
    const features = [feature({ globalId: "G1" })];
    const index = buildZoningBboxIndex(features);
    const result = resolveDistrictAtPoint(10, 10, features, index);
    expect(result.state).toBe("unresolved");
    expect(result.district).toBeNull();
    expect(result.candidateCount).toBe(0);
  });

  it("returns ambiguous (never an arbitrary pick) for a point in two overlapping polygons", () => {
    const overlapping: [number, number][] = [
      [0.2, 0.2],
      [1.2, 0.2],
      [1.2, 1.2],
      [0.2, 1.2],
      [0.2, 0.2],
    ];
    const features = [
      feature({ globalId: "G1" }),
      feature({ globalId: "G2", rings: [overlapping], bbox: ringsBbox([overlapping]) }),
    ];
    const index = buildZoningBboxIndex(features);
    // (0.5, 0.5) is inside both the unit square and the overlapping square.
    const result = resolveDistrictAtPoint(0.5, 0.5, features, index);
    expect(result.state).toBe("ambiguous");
    expect(result.district).toBeNull();
    expect(result.candidateCount).toBe(2);
  });

  it("bbox index scopes candidates so a far-away polygon never gets tested", () => {
    const near = feature({ globalId: "NEAR" });
    const far: [number, number][] = [
      [50, 50],
      [51, 50],
      [51, 51],
      [50, 51],
      [50, 50],
    ];
    const farFeature = feature({ globalId: "FAR", rings: [far], bbox: ringsBbox([far]) });
    const index = buildZoningBboxIndex([near, farFeature]);
    const result = resolveDistrictAtPoint(0.5, 0.5, [near, farFeature], index);
    expect(result.state).toBe("resolved");
    expect(result.district?.globalId).toBe("NEAR");
  });
});
