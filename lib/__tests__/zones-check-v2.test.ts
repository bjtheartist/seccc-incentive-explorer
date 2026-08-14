import { describe, expect, it, vi } from "vitest";
import { resolveZoneLayerEvidence, resolveZoneEvidenceV2 } from "../zones-check";
import { STATIC_ONLY_ZONE_KEYS, ZONE_LAYER_REGISTRY, ZONE_DATA_REVISION } from "../zone-layer-registry";

/**
 * Producer tests for Zone Evidence v2 (build-spec.md 1.3; review1 R2 + R5).
 * DATABASE_URL is unset in this test environment, so getSQL() returns null
 * by default and `opts.sql: null` below is the explicit, always-true
 * version of the same thing — every "static path" assertion here exercises
 * the real, unmodified shipped tif-districts.geojson, which (per
 * app/api/zones/check/route.test.ts's own regression comment) already
 * contains 4 malformed features (unclosed rings — T-55, T-64, T-180,
 * T-117) that make turf.booleanPointInPolygon throw regardless of query
 * point. That existing defect is exactly the fixture this suite needs to
 * prove "malformed geometry -> unknown, not not_matched" against real data
 * instead of a synthetic fixture.
 */

describe("resolveZoneLayerEvidence — static path (real shipped TIF geometry)", () => {
  it("a known match wins even though the layer also contains malformed features elsewhere", async () => {
    // Washington Park / T-178 centroid — a well-formed feature in the same
    // file as the 4 malformed ones.
    const evidence = await resolveZoneLayerEvidence(
      "tif",
      41.78638587082365,
      -87.6239725143245,
      { sql: null }
    );
    expect(evidence.state).toBe("matched");
    expect(evidence.name).toContain("Washington Park");
  });

  it("malformed geometry produces unknown/malformed_geometry, never not_matched", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Same point app/api/zones/check/route.test.ts uses to prove the v1
      // fallback logs (not throws) on the malformed rings; here no real
      // match exists for it either, so v1 would report `false`/omission
      // while v2 must report `unknown`.
      const evidence = await resolveZoneLayerEvidence("tif", 41.95, -87.7, { sql: null });
      expect(evidence.state).toBe("unknown");
      expect(evidence.reason).toBe("malformed_geometry");
      expect(evidence.state).not.toBe("not_matched");
      expect(
        warnSpy.mock.calls.some((args) =>
          String(args[0]).includes('[zones/check/v2] skipping malformed feature in zone "tif"')
        )
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a clean not-matched point (no match, no malformed feature, current revision) resolves to not_matched", async () => {
    // A static-only, current-revision layer with no malformed geometry, at
    // a point nowhere near any NOF corridor.
    expect(ZONE_LAYER_REGISTRY.nof.dataRevision).toBe(ZONE_DATA_REVISION); // sanity: current, not stale
    const evidence = await resolveZoneLayerEvidence("nof", 41.6, -88.0, { sql: null });
    expect(evidence.state).toBe("not_matched");
  });

  it("an unregistered key is unknown/layer_missing, never a thrown error", async () => {
    const evidence = await resolveZoneLayerEvidence("not-a-real-layer", 41.8, -87.6, {
      sql: null,
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("layer_missing");
  });
});

describe("resolveZoneLayerEvidence — static-file failure modes (registered key, injected loader — review1 R5)", () => {
  // All four scenarios use "tif" — a real registered key — with an
  // injected loadZoneFile, per review1 R5's critique that the prior test
  // suite only exercised failure paths against an UNREGISTERED key and so
  // never actually proved source_unavailable/layer_missing/malformed
  // behavior for a real layer's file-loading path.

  it("a loader that throws (missing file / invalid JSON) -> unknown/source_unavailable", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => {
        throw new Error("ENOENT: no such file");
      },
    });
    expect(evidence).toEqual({ state: "unknown", reason: "source_unavailable" });
  });

  it("a loader that resolves to malformed-shape JSON (not a FeatureCollection) -> unknown/source_unavailable", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({ not: "a feature collection" }),
    });
    expect(evidence).toEqual({ state: "unknown", reason: "source_unavailable" });
  });

  it("a well-formed but EMPTY collection -> unknown/layer_missing, never a confident not_matched", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({ type: "FeatureCollection", features: [] }),
    });
    expect(evidence).toEqual({ state: "unknown", reason: "layer_missing" });
  });

  it("null geometry on every feature -> unknown/malformed_geometry, never not_matched", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: null }],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
  });

  it("wrong geometry type (Point instead of Polygon) -> unknown/malformed_geometry", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
        ],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
  });

  it("none of the above ever produce not_matched or a thrown error", async () => {
    const scenarios: Array<() => Promise<unknown>> = [
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve(null),
      () => Promise.resolve({ type: "FeatureCollection", features: [] }),
      () =>
        Promise.resolve({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: null }],
        }),
    ];
    for (const loadZoneFile of scenarios) {
      const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
        sql: null,
        loadZoneFile,
      });
      expect(evidence.state).toBe("unknown");
      expect(evidence.state).not.toBe("not_matched");
    }
  });
});

describe("resolveZoneLayerEvidence — stale-revision static layers never assert a negative (review1 R2)", () => {
  it("microMarketRecovery is registered with a revision older than the current known-good snapshot", () => {
    expect(ZONE_LAYER_REGISTRY.microMarketRecovery.dataRevision).not.toBe(ZONE_DATA_REVISION);
  });

  it("a clean scan with zero matches on the stale microMarketRecovery boundary is unknown/stale_source, never not_matched", async () => {
    // A point nowhere near any of the 13 legacy MMRP polygons.
    const evidence = await resolveZoneLayerEvidence("microMarketRecovery", 41.6, -88.0, {
      sql: null,
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("stale_source");
    expect(evidence.state).not.toBe("not_matched");
  });

  it("a layer whose revision IS current can still assert not_matched (control case)", async () => {
    const evidence = await resolveZoneLayerEvidence("nof", 41.6, -88.0, { sql: null });
    expect(evidence).toEqual({ state: "not_matched" });
  });
});

describe("resolveZoneLayerEvidence — HUBZone redesignated tracts (review1 R2)", () => {
  it("a point inside a real, currently-shipped redesignated tract is never plain matched", async () => {
    // Tract 17031020602 — a real "category: redesignated" feature in the
    // shipped public/data/zones/hubzone.geojson (66 such features, matching
    // the catalog record's "66 redesignated tracts" claim). Centroid
    // computed with turf and self-verified to fall inside the polygon.
    const evidence = await resolveZoneLayerEvidence(
      "hubzone",
      42.00145844155844,
      -87.69358961038957,
      { sql: null }
    );
    expect(evidence.state).not.toBe("matched");
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("redesignated_area_expired");
  });

  it("a point inside a real, currently-shipped QUALIFIED tract is still a plain matched (control case)", async () => {
    // A "qualified" category HUBZone tract, not redesignated.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const data = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "zones", "hubzone.geojson"), "utf8")
    ) as { features: Array<{ properties: { category: string } }> };
    const qualifiedCount = data.features.filter((f) => f.properties.category === "qualified").length;
    expect(qualifiedCount).toBeGreaterThan(0);

    // Compute a self-verified centroid the same way the redesignated test does.
    const turf = await import("@turf/turf");
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "zones", "hubzone.geojson"), "utf8")
    ) as { features: GeoJSON.Feature[] };
    const qualified = raw.features.filter(
      (f) => (f.properties as Record<string, unknown>).category === "qualified"
    );
    let found: { lat: number; lon: number } | null = null;
    for (const feature of qualified) {
      const centroid = turf.centroid(feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
      const point = turf.point(centroid.geometry.coordinates);
      if (
        turf.booleanPointInPolygon(
          point,
          feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        )
      ) {
        found = { lat: centroid.geometry.coordinates[1], lon: centroid.geometry.coordinates[0] };
        break;
      }
    }
    expect(found).not.toBeNull();

    const evidence = await resolveZoneLayerEvidence("hubzone", found!.lat, found!.lon, { sql: null });
    expect(evidence.state).toBe("matched");
  });

  it("review1 R8: a shared-boundary point matching BOTH a qualified and a redesignated tract stays unknown, not plain matched", async () => {
    // Verified against the real shipped hubzone.geojson: at (lat 42.0047,
    // lon -87.6901), turf.booleanPointInPolygon matches qualified tract
    // 17031020500 BEFORE it matches expired redesignated tract
    // 17031020602, in file order. A first-match-wins scan would return
    // plain "matched" here; a full scan must find the redesignated match
    // too and downgrade the whole result.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const turf = await import("@turf/turf");
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "zones", "hubzone.geojson"), "utf8")
    ) as { features: GeoJSON.Feature[] };
    const point = turf.point([-87.6901, 42.0047]);
    const matchedAtPoint = raw.features.filter((f) => {
      try {
        return turf.booleanPointInPolygon(point, f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
      } catch {
        return false;
      }
    });
    // Sanity check on the fixture itself: this point really does hit both
    // categories, and the qualified one really does come first.
    expect(matchedAtPoint.map((f) => (f.properties as Record<string, unknown>).category)).toEqual([
      "qualified",
      "redesignated",
    ]);

    const evidence = await resolveZoneLayerEvidence("hubzone", 42.0047, -87.6901, { sql: null });
    expect(evidence.state).not.toBe("matched");
    expect(evidence).toEqual({
      state: "unknown",
      reason: "redesignated_area_expired",
      name: expect.stringContaining("17031020602"),
    });
  });

  it("review1 R8: the shared-boundary result is stable regardless of which match the scan would hit first", async () => {
    // Confirms the fix isn't order-dependent by checking resolveZoneEvidenceV2
    // (the batch entry point) too, not just the single-layer resolver.
    const { resolveZoneEvidenceV2 } = await import("../zones-check");
    const layers = await resolveZoneEvidenceV2(42.0047, -87.6901, ["hubzone"], { sql: null });
    expect(layers.hubzone.state).toBe("unknown");
    expect(layers.hubzone.reason).toBe("redesignated_area_expired");
  });
});

describe("checkStaticZoneV2 — review1 R10: malformed feature ENTRIES (not just malformed geometry) never throw", () => {
  it("features: [null] resolves to unknown/malformed_geometry, never source_unavailable and never a thrown/rejected promise", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [null],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
  });

  it("a scalar (string) feature entry resolves to unknown/malformed_geometry", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: ["not a feature object"],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
  });

  it("a number feature entry resolves to unknown/malformed_geometry", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [42],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
  });

  it("a null/scalar sibling never prevents a real match on a well-formed feature later in the array", async () => {
    const wellFormedTifFeature = {
      type: "Feature",
      properties: { name: "Synthetic TIF" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-87.61, 41.87],
            [-87.61, 41.89],
            [-87.59, 41.89],
            [-87.59, 41.87],
            [-87.61, 41.87],
          ],
        ],
      },
    };
    const evidence = await resolveZoneLayerEvidence("tif", 41.88, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [null, "garbage", wellFormedTifFeature],
      }),
    });
    expect(evidence).toEqual({ state: "matched", name: "Synthetic TIF" });
  });

  it("null/scalar siblings with no real match anywhere still resolve to malformed_geometry, never not_matched", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: null,
      loadZoneFile: async () => ({
        type: "FeatureCollection",
        features: [null, "garbage", { type: "Feature", properties: {}, geometry: null }],
      }),
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("malformed_geometry");
    expect(evidence.state).not.toBe("not_matched");
  });
});

describe("resolveZoneLayerEvidence — DB path (mocked at the getSQL boundary, per Hard Rule)", () => {
  it("matched: dbLayerQuery returns a row", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never, // truthy stand-in; only `Boolean(sql)` is consulted
      dbLayerQuery: async () => ({ name: "Fake TIF District" }),
    });
    expect(evidence).toEqual({ state: "matched", name: "Fake TIF District" });
  });

  it("DB query failure is unknown/source_unavailable, never a thrown error or a false match", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never,
      dbLayerQuery: async () => {
        throw new Error("connection reset");
      },
    });
    expect(evidence).toEqual({ state: "unknown", reason: "source_unavailable" });
  });

  it("zero DB rows AND the layer is not verified to exist -> unknown/layer_missing, never a confident not_matched", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never,
      dbLayerQuery: async () => null, // zero rows at this point
      dbLayerExists: async () => false, // ... and the layer has no rows anywhere
    });
    expect(evidence).toEqual({ state: "unknown", reason: "layer_missing" });
  });

  it("zero DB rows but the layer IS verified to exist (has rows elsewhere) -> genuine not_matched", async () => {
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never,
      dbLayerQuery: async () => null,
      dbLayerExists: async () => true,
    });
    expect(evidence).toEqual({ state: "not_matched" });
  });

  it("the existence check is only consulted after a zero-row point query, never before", async () => {
    const existsCheck = vi.fn(async () => true);
    await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never,
      dbLayerQuery: async () => ({ name: "matched before existence check needed" }),
      dbLayerExists: existsCheck,
    });
    expect(existsCheck).not.toHaveBeenCalled();
  });
});

describe("resolveZoneEvidenceV2 — layer independence", () => {
  it("a failed irrelevant layer does not flip or downgrade a known match on another layer", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
      dbLayerQuery: async (key) => {
        if (key === "tif") return { name: "Known Match TIF" };
        throw new Error("simulated outage for the irrelevant layer");
      },
    });
    expect(layers.tif).toEqual({ state: "matched", name: "Known Match TIF" });
    expect(layers.ssa).toEqual({ state: "unknown", reason: "source_unavailable" });
  });

  it("one failed relevant layer becomes unknown while unrelated layers are unaffected", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif", "ssa", "enterprise"], {
      sql: {} as never,
      dbLayerQuery: async (key) => {
        if (key === "ssa") throw new Error("simulated outage");
        return { name: `${key} match` };
      },
    });
    expect(layers.ssa).toEqual({ state: "unknown", reason: "source_unavailable" });
    expect(layers.tif).toEqual({ state: "matched", name: "tif match" });
    expect(layers.enterprise).toEqual({ state: "matched", name: "enterprise match" });
  });

  it("resolves every one of the 16 checkable zone keys registered in the layer registry", async () => {
    const keys = Object.keys(ZONE_LAYER_REGISTRY);
    expect(keys).toHaveLength(16);
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, keys, { sql: null });
    for (const key of keys) {
      expect(layers[key]).toBeDefined();
      expect(["matched", "not_matched", "unknown"]).toContain(layers[key].state);
    }
  });

  it("one layer's loader throwing synchronously never rejects the whole resolver", async () => {
    const layers = await resolveZoneEvidenceV2(41.8, -87.6, ["tif", "nof"], {
      sql: null,
      loadZoneFile: async (key) => {
        if (key === "tif") throw new Error("simulated catastrophic failure");
        return { type: "FeatureCollection", features: [] };
      },
    });
    expect(layers.tif.state).toBe("unknown");
    expect(layers.nof.state).toBe("unknown"); // empty collection -> layer_missing
    expect(layers.nof.reason).toBe("layer_missing");
  });
});

describe("STATIC_ONLY_ZONE_KEYS / registry consistency", () => {
  it("every static-only key is registered with source 'static-file'", () => {
    for (const key of STATIC_ONLY_ZONE_KEYS) {
      expect(ZONE_LAYER_REGISTRY[key]?.source).toBe("static-file");
    }
  });

  it("every non-static-only registered key is source 'db'", () => {
    for (const [key, entry] of Object.entries(ZONE_LAYER_REGISTRY)) {
      if (!STATIC_ONLY_ZONE_KEYS.has(key)) {
        expect(entry.source).toBe("db");
      }
    }
  });
});
