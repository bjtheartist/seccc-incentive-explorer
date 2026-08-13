import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * lib/zone-evidence-cache.ts caching tests (build-spec.md 1.3 binding
 * caching rule; review1 R3). Mocks lib/redis's getRedisClient at the module
 * boundary (no live Redis, per the Hard Rules) to assert content-aware TTL
 * selection, checkedAt preservation across a cache hit, and that
 * `hadUnknown` is always recomputed from `layers` rather than trusted from
 * storage.
 */

const redisGet = vi.fn();
const redisSet = vi.fn();

vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return {
    ...actual,
    getRedisClient: () => ({ get: redisGet, set: redisSet }),
  };
});

beforeEach(() => {
  redisGet.mockReset();
  redisSet.mockReset();
  redisGet.mockResolvedValue(null); // default: cache miss
});

describe("resolveZoneEvidenceV2Cached", () => {
  it("caches a fully-covered result with the normal 7-day TTL", async () => {
    const { resolveZoneEvidenceV2Cached, FULL_COVERAGE_TTL_SECONDS } = await import(
      "../zone-evidence-cache"
    );
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => ({ name: "Fully covered match" }),
    });

    expect(result.hadUnknown).toBe(false);
    expect(typeof result.checkedAt).toBe("string");
    expect(redisSet).toHaveBeenCalledTimes(1);
    const [, storedRaw, setOpts] = redisSet.mock.calls[0];
    expect(setOpts).toEqual({ ex: FULL_COVERAGE_TTL_SECONDS });
    expect(FULL_COVERAGE_TTL_SECONDS).toBe(604_800);
    // hadUnknown is never persisted — see module doc comment.
    const stored = JSON.parse(storedRaw);
    expect(Object.hasOwn(stored, "hadUnknown")).toBe(false);
    expect(stored.checkedAt).toBe(result.checkedAt);
  });

  it("caps the TTL at <= 5 minutes when any layer is unknown", async () => {
    const { resolveZoneEvidenceV2Cached, UNKNOWN_BEARING_TTL_SECONDS } = await import(
      "../zone-evidence-cache"
    );
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => {
        throw new Error("outage");
      },
    });

    expect(result.hadUnknown).toBe(true);
    expect(redisSet).toHaveBeenCalledTimes(1);
    const [, , setOpts] = redisSet.mock.calls[0];
    expect(setOpts).toEqual({ ex: UNKNOWN_BEARING_TTL_SECONDS });
    expect(UNKNOWN_BEARING_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("a cache hit short-circuits re-resolution AND preserves the original checkedAt (review1 R3)", async () => {
    const originalCheckedAt = "2026-08-01T00:00:00.000Z"; // deliberately NOT "now"
    const cachedPayload = {
      layers: { tif: { state: "matched", name: "cached" } },
      checkedAt: originalCheckedAt,
    };
    redisGet.mockResolvedValueOnce(cachedPayload);

    const dbLayerQuery = vi.fn(async () => ({ name: "should not be called" }));
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery,
    });

    expect(result.checkedAt).toBe(originalCheckedAt);
    expect(result.checkedAt).not.toBe(new Date().toISOString().slice(0, 10)); // not re-stamped to today
    expect(result.layers).toEqual(cachedPayload.layers);
    expect(result.hadUnknown).toBe(false);
    expect(dbLayerQuery).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("an unknown-bearing hit gets recomputed hadUnknown:true even when a stored hadUnknown boolean lies (review1 R3)", async () => {
    // Simulates a corrupted/hand-edited cache entry: the layers clearly
    // contain an unknown result, but an embedded `hadUnknown` field claims
    // false. The cache must never trust that stored boolean.
    const lyingCachedPayload = {
      layers: {
        tif: { state: "matched", name: "ok" },
        ssa: { state: "unknown", reason: "source_unavailable" },
      },
      checkedAt: "2026-08-01T00:00:00.000Z",
      hadUnknown: false, // the lie
    };
    redisGet.mockResolvedValueOnce(lyingCachedPayload);

    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
    });

    expect(result.hadUnknown).toBe(true); // recomputed from layers, not the stored lie
  });

  it("a structurally invalid cached payload is discarded and re-resolved rather than trusted", async () => {
    redisGet.mockResolvedValueOnce({ garbage: true }); // no layers, no checkedAt
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => ({ name: "freshly resolved" }),
    });
    expect(result.layers.tif).toEqual({ state: "matched", name: "freshly resolved" });
    expect(redisSet).toHaveBeenCalledTimes(1); // the fresh result gets cached
  });

  it("a cached payload with an invalid layer state is discarded and re-resolved", async () => {
    redisGet.mockResolvedValueOnce({
      layers: { tif: { state: "definitely-in-zone" } }, // not a valid ZoneLayerState
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => ({ name: "freshly resolved" }),
    });
    expect(result.layers.tif).toEqual({ state: "matched", name: "freshly resolved" });
  });

  it("cache keys are namespaced under zones:check:v3: (distinct from v1's zones:check:v2:)", async () => {
    const { zoneEvidenceV2CacheKey, ZONE_EVIDENCE_V2_NAMESPACE } = await import(
      "../zone-evidence-cache"
    );
    expect(ZONE_EVIDENCE_V2_NAMESPACE).toBe("zones:check:v3:");
    const key = zoneEvidenceV2CacheKey(2, "rev-1", 41.8, -87.6, ["tif", "ssa"]);
    expect(key.startsWith("zones:check:v3:2:rev-1:")).toBe(true);
    // requestedLayers is part of the key so different layer sets never collide
    const otherKey = zoneEvidenceV2CacheKey(2, "rev-1", 41.8, -87.6, ["tif"]);
    expect(key).not.toBe(otherKey);
    // key order doesn't matter — sorted before joining
    const reordered = zoneEvidenceV2CacheKey(2, "rev-1", 41.8, -87.6, ["ssa", "tif"]);
    expect(key).toBe(reordered);
  });

  it("redis read/write failures degrade gracefully (resolve, don't cache) rather than throwing", async () => {
    redisGet.mockRejectedValueOnce(new Error("redis down"));
    redisSet.mockRejectedValueOnce(new Error("redis down"));
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery: async () => ({ name: "still works" }),
    });
    expect(result.layers.tif).toEqual({ state: "matched", name: "still works" });
  });
});

describe("review1 R9: a partial cache hit is never trusted as a full-coverage hit", () => {
  it("a stored payload missing a requested key is rejected and the point is re-resolved for ALL requested keys", async () => {
    // Simulates exactly the review's scenario: a stale/foreign cache entry
    // for ["tif","ssa"] that only actually has a "tif" evidence entry.
    redisGet.mockResolvedValueOnce({
      layers: { tif: { state: "matched", name: "stale partial hit" } },
      checkedAt: "2020-01-01T00:00:00.000Z",
    });
    const dbLayerQuery = vi.fn(async (key: string) => ({ name: `${key} freshly resolved` }));
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
      dbLayerQuery,
    });

    // Both keys were actually re-resolved — the partial hit was discarded,
    // not "completed" or trusted for the layer it did have.
    expect(dbLayerQuery).toHaveBeenCalledWith("tif", 41.8, -87.6);
    expect(dbLayerQuery).toHaveBeenCalledWith("ssa", 41.8, -87.6);
    expect(result.layers.tif).toEqual({ state: "matched", name: "tif freshly resolved" });
    expect(result.layers.ssa).toEqual({ state: "matched", name: "ssa freshly resolved" });
    expect(result.checkedAt).not.toBe("2020-01-01T00:00:00.000Z"); // proves it was re-resolved, not reused
  });

  it("a partial hit never short-circuits as full coverage: hadUnknown is computed over the FRESH result, not the stale partial one", async () => {
    redisGet.mockResolvedValueOnce({
      layers: { tif: { state: "matched", name: "stale" } }, // missing "ssa" entirely
      checkedAt: "2020-01-01T00:00:00.000Z",
    });
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
      dbLayerQuery: async (key) => {
        if (key === "ssa") throw new Error("ssa genuinely unavailable");
        return { name: "tif match" };
      },
    });
    expect(result.hadUnknown).toBe(true); // ssa really did fail on re-resolution
    expect(result.layers.ssa.state).toBe("unknown");
  });

  it("a stored payload containing every requested key (plus no extras missing) IS still accepted as a valid hit", async () => {
    const validHit = {
      layers: {
        tif: { state: "matched", name: "cached" },
        ssa: { state: "not_matched" },
      },
      checkedAt: "2026-08-01T00:00:00.000Z",
    };
    redisGet.mockResolvedValueOnce(validHit);
    const dbLayerQuery = vi.fn();
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif", "ssa"], {
      sql: {} as never,
      dbLayerQuery,
    });
    expect(dbLayerQuery).not.toHaveBeenCalled(); // genuinely a hit, not silently re-resolved
    expect(result.checkedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(result.layers).toEqual(validHit.layers);
  });

  it("requesting a SUBSET of a previously-cached larger key set still requires all of the subset's keys, not the original superset's", async () => {
    // A hit cached for ["tif","ssa","enterprise"] is a valid hit for a
    // later request asking only for ["tif"] -- the subset check passes.
    redisGet.mockResolvedValueOnce({
      layers: {
        tif: { state: "matched", name: "cached" },
        ssa: { state: "not_matched" },
        enterprise: { state: "not_matched" },
      },
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const dbLayerQuery = vi.fn();
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery,
    });
    expect(dbLayerQuery).not.toHaveBeenCalled();
    expect(result.layers.tif).toEqual({ state: "matched", name: "cached" });
  });
});

describe("review1 R8 propagation: the HUBZone shared-boundary downgrade survives the cache layer, miss and hit", () => {
  const R8_LAT = 42.0047;
  const R8_LON = -87.6901;

  it("cache MISS: resolving the real coordinate through the cache layer (real hubzone.geojson, no mocked loader) produces unknown/redesignated_area_expired", async () => {
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", R8_LAT, R8_LON, ["hubzone"], {
      sql: null, // hubzone is static-only regardless; matches the real no-DB test environment
    });
    expect(result.layers.hubzone).toEqual({
      state: "unknown",
      reason: "redesignated_area_expired",
      name: expect.stringContaining("17031020602"),
    });
    expect(result.hadUnknown).toBe(true);
    // an unknown-bearing result gets the short TTL, never the 7-day one
    expect(redisSet).toHaveBeenCalledTimes(1);
    const [, storedRaw, setOpts] = redisSet.mock.calls[0];
    const { UNKNOWN_BEARING_TTL_SECONDS } = await import("../zone-evidence-cache");
    expect(setOpts).toEqual({ ex: UNKNOWN_BEARING_TTL_SECONDS });

    // cache HIT: feed the exact bytes just written back in as the next read.
    redisGet.mockResolvedValueOnce(JSON.parse(storedRaw));
    const hitResult = await resolveZoneEvidenceV2Cached("rev-1", R8_LAT, R8_LON, ["hubzone"], {
      sql: null,
    });
    expect(hitResult.layers.hubzone).toEqual({
      state: "unknown",
      reason: "redesignated_area_expired",
      name: expect.stringContaining("17031020602"),
    });
    expect(hitResult.hadUnknown).toBe(true); // recomputed on the hit path too, not just carried over
    expect(hitResult.checkedAt).toBe(result.checkedAt); // hit preserves the original resolution timestamp
  });
});
