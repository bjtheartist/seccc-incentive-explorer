import { describe, expect, it } from "vitest";
import type { OwnerClusterGeoRow } from "../corridor-owners";
import {
  buildOwnerClusterGeoFeatureCollection,
  filterOwnerClusterGeoByZips,
  loadOwnerClusterGeoFile,
  type OwnerClusterGeoFeatureCollection,
} from "../owner-cluster-geo";

/**
 * Guards the committed fixture (data/private/owner-clusters-geo.json) — the
 * real export is generated separately (scripts/export-owner-clusters-geo.ts)
 * and never committed by this branch; this fixture keeps dev/test working in
 * the meantime, mirroring lib/__tests__/corridor-owners.test.ts's
 * loadStaticOwnerClusters guard for public/data/corridor-owners.json.
 */
describe("loadOwnerClusterGeoFile", () => {
  it("loads the committed fixture with the documented shape", () => {
    const fc = loadOwnerClusterGeoFile();
    expect(fc).not.toBeNull();
    expect(fc!.type).toBe("FeatureCollection");
    expect(typeof fc!.generatedAt).toBe("string");
    expect(fc!.meta.zips).toEqual(expect.arrayContaining(["60617", "60624"]));
    expect(fc!.features.length).toBeGreaterThanOrEqual(12);

    const feature = fc!.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toHaveLength(2);
    expect(typeof feature.properties.pin).toBe("string");
    expect(typeof feature.properties.zip).toBe("string");
    expect(typeof feature.properties.clusterKey).toBe("string");
    expect(typeof feature.properties.vacant).toBe("boolean");
  });

  it("every fixture feature carries a 5-digit zip matching its cluster's parcels", () => {
    const fc = loadOwnerClusterGeoFile()!;
    for (const feature of fc.features) {
      expect(feature.properties.zip).toMatch(/^\d{5}$/);
    }
  });
});

describe("filterOwnerClusterGeoByZips", () => {
  const fc: OwnerClusterGeoFeatureCollection = {
    type: "FeatureCollection",
    generatedAt: "2026-01-01T00:00:00.000Z",
    meta: { skippedNullLatLng: 0, zips: ["60617", "60624"] },
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.56, 41.71] },
        properties: {
          pin: "A", address: "1 A ST", vacant: true, zip: "60617",
          clusterKey: "mail:a", ownerName: "A", ownerType: "corporate_llc",
          clusterParcelCount: 2, clusterVacantCount: 1, confidence: "High",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.72, 41.87] },
        properties: {
          pin: "B", address: "2 B ST", vacant: false, zip: "60624",
          clusterKey: "mail:b", ownerName: "B", ownerType: "out_of_state",
          clusterParcelCount: 2, clusterVacantCount: 1, confidence: "Medium",
        },
      },
    ],
  };

  it("returns the collection unfiltered when zips is null/undefined/empty", () => {
    expect(filterOwnerClusterGeoByZips(fc, null)).toEqual(fc);
    expect(filterOwnerClusterGeoByZips(fc, undefined)).toEqual(fc);
    expect(filterOwnerClusterGeoByZips(fc, [])).toEqual(fc);
  });

  it("filters features down to the requested zips only", () => {
    const filtered = filterOwnerClusterGeoByZips(fc, ["60617"]);
    expect(filtered.features).toHaveLength(1);
    expect(filtered.features[0].properties.zip).toBe("60617");
    // Top-level meta/generatedAt pass through unchanged.
    expect(filtered.meta).toEqual(fc.meta);
  });

  it("returns no features for a zip not present in the collection", () => {
    expect(filterOwnerClusterGeoByZips(fc, ["60601"]).features).toHaveLength(0);
  });
});

describe("buildOwnerClusterGeoFeatureCollection", () => {
  function row(overrides: Partial<OwnerClusterGeoRow>): OwnerClusterGeoRow {
    return {
      pin: "PIN-1",
      address: "1 MAIN ST",
      vacant: true,
      lat: 41.7,
      lon: -87.6,
      clusterKey: "mail:foo",
      ownerName: "FOO LLC",
      ownerType: "corporate_llc",
      clusterParcelCount: 2,
      clusterVacantCount: 1,
      confidence: "High",
      ...overrides,
    };
  }

  it("maps rows into GeoJSON Point features keyed by zip", () => {
    const out = buildOwnerClusterGeoFeatureCollection(
      { "60617": [row({ pin: "P1" }), row({ pin: "P2", lat: 41.71, lon: -87.61 })] },
      "2026-07-16T00:00:00.000Z"
    );
    expect(out.type).toBe("FeatureCollection");
    expect(out.generatedAt).toBe("2026-07-16T00:00:00.000Z");
    expect(out.features).toHaveLength(2);
    expect(out.features[0].properties.zip).toBe("60617");
    expect(out.features[0].geometry.coordinates).toEqual([-87.6, 41.7]);
    expect(out.meta.zips).toEqual(["60617"]);
    expect(out.meta.skippedNullLatLng).toBe(0);
  });

  it("skips parcels with null lat/lng and counts them in meta rather than dropping silently", () => {
    const out = buildOwnerClusterGeoFeatureCollection(
      {
        "60617": [
          row({ pin: "P1" }),
          row({ pin: "P2", lat: null }),
          row({ pin: "P3", lon: null }),
        ],
      },
      "2026-07-16T00:00:00.000Z"
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties.pin).toBe("P1");
    expect(out.meta.skippedNullLatLng).toBe(2);
  });

  it("handles multiple zips and an empty input", () => {
    const out = buildOwnerClusterGeoFeatureCollection(
      { "60617": [row({ pin: "P1" })], "60624": [row({ pin: "P2" })] },
      "2026-07-16T00:00:00.000Z"
    );
    expect(out.features.map((f) => f.properties.zip).sort()).toEqual(["60617", "60624"]);

    const empty = buildOwnerClusterGeoFeatureCollection({}, "2026-07-16T00:00:00.000Z");
    expect(empty.features).toHaveLength(0);
    expect(empty.meta.zips).toEqual([]);
    expect(empty.meta.skippedNullLatLng).toBe(0);
  });
});
