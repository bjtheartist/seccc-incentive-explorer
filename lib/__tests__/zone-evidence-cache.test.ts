import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * lib/zone-evidence-cache.ts caching tests (build-spec.md 1.3 binding
 * caching rule). Mocks lib/redis's getRedisClient at the module boundary
 * (no live Redis, per the Hard Rules) to assert content-aware TTL
 * selection: fully-covered results get the normal 7-day TTL, any
 * unknown-bearing result gets the <= 5 minute cap.
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
    expect(redisSet).toHaveBeenCalledTimes(1);
    const [, , setOpts] = redisSet.mock.calls[0];
    expect(setOpts).toEqual({ ex: FULL_COVERAGE_TTL_SECONDS });
    expect(FULL_COVERAGE_TTL_SECONDS).toBe(604_800);
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

  it("a cache hit short-circuits re-resolution entirely", async () => {
    const cachedPayload = { layers: { tif: { state: "matched", name: "cached" } }, hadUnknown: false };
    redisGet.mockResolvedValueOnce(cachedPayload);

    const dbLayerQuery = vi.fn(async () => ({ name: "should not be called" }));
    const { resolveZoneEvidenceV2Cached } = await import("../zone-evidence-cache");
    const result = await resolveZoneEvidenceV2Cached("rev-1", 41.8, -87.6, ["tif"], {
      sql: {} as never,
      dbLayerQuery,
    });

    expect(result).toEqual(cachedPayload);
    expect(dbLayerQuery).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
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
