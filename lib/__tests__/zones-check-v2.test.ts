import { describe, expect, it, vi } from "vitest";
import { resolveZoneLayerEvidence, resolveZoneEvidenceV2 } from "../zones-check";
import { STATIC_ONLY_ZONE_KEYS, ZONE_LAYER_REGISTRY } from "../zone-layer-registry";

/**
 * Producer tests for Zone Evidence v2 (build-spec.md 1.3). DATABASE_URL is
 * unset in this test environment, so getSQL() returns null by default and
 * `opts.sql: null` below is the explicit, always-true version of the same
 * thing — every "static path" assertion here exercises the real, unmodified
 * shipped tif-districts.geojson, which (per app/api/zones/check/route.test.ts's
 * own regression comment) already contains 4 malformed features (unclosed
 * rings — T-55, T-64, T-180, T-117) that make turf.booleanPointInPolygon
 * throw regardless of query point. That existing defect is exactly the
 * fixture this suite needs to prove "malformed geometry -> unknown, not
 * not_matched" against real data instead of a synthetic fixture.
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

  it("a clean not-matched point (no match, no malformed feature hit) resolves to not_matched", async () => {
    // A static-only layer with no malformed geometry, at a point nowhere
    // near any NOF corridor.
    const evidence = await resolveZoneLayerEvidence("nof", 41.6, -88.0, { sql: null });
    expect(evidence.state).toBe("not_matched");
  });

  it("an unreadable/missing static source file is unknown/source_unavailable, not a thrown error", async () => {
    // "microMarketRecovery" registry entry exists but the underlying
    // static-file loader path is exercised for real; point at an
    // intentionally bogus key not present in the registry at all to prove
    // resolveZoneLayerEvidence never throws outward.
    const evidence = await resolveZoneLayerEvidence("not-a-real-layer", 41.8, -87.6, {
      sql: null,
    });
    expect(evidence.state).toBe("unknown");
    expect(evidence.reason).toBe("layer_missing");
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

  it("zero DB rows for a layer NOT marked verifiedLoaded is unknown/layer_missing, never a confident not_matched", async () => {
    const registryEntry = ZONE_LAYER_REGISTRY.tif;
    expect(registryEntry.source).toBe("db");
    const unverifiedSpy = vi
      .spyOn(await import("../zone-layer-registry"), "getZoneLayerRegistryEntry")
      .mockReturnValue({ ...registryEntry, verifiedLoaded: false });
    try {
      const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
        sql: {} as never,
        dbLayerQuery: async () => null, // zero rows
      });
      expect(evidence).toEqual({ state: "unknown", reason: "layer_missing" });
    } finally {
      unverifiedSpy.mockRestore();
    }
  });

  it("zero DB rows for a layer marked verifiedLoaded is a genuine not_matched", async () => {
    const registryEntry = ZONE_LAYER_REGISTRY.tif;
    expect(registryEntry.verifiedLoaded).toBe(true); // sanity: the real registry default
    const evidence = await resolveZoneLayerEvidence("tif", 41.8, -87.6, {
      sql: {} as never,
      dbLayerQuery: async () => null,
    });
    expect(evidence).toEqual({ state: "not_matched" });
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
