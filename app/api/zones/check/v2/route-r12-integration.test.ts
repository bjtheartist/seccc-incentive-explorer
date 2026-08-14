import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * review2 R12 test (d): "the route never emits unrequested layers."
 *
 * Mocks ONLY lib/redis's getRedisClient (not the whole zone-evidence-cache
 * module, unlike route.test.ts) so the REAL resolveZoneEvidenceV2Cached and
 * its REAL isValidStoredPayload validation run — this is the only test
 * that proves the R12 fix end-to-end through the actual route: a poisoned
 * Redis entry cached under a broader key set than the current request
 * must be rejected by the real validator, never relayed to the HTTP
 * response.
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
});

function checkRequest(params: string) {
  return new NextRequest(`http://localhost/api/zones/check/v2?${params}`);
}

describe("GET /api/zones/check/v2 — review2 R12 (d): never emits unrequested layers", () => {
  it("a poisoned cache entry (superset of the requested layers) never leaks its extra layer into the response", async () => {
    // Poisoned: cached under a broader set ["ccsa","enterprise","tif"],
    // this request only asks for "tif". The route must not serve "ccsa"
    // or "enterprise" evidence for a request that never asked about them.
    redisGet.mockResolvedValueOnce({
      layers: {
        tif: { state: "matched", name: "poisoned cache tif" },
        ccsa: { state: "matched", name: "should never appear" },
        enterprise: { state: "not_matched" },
      },
      checkedAt: "2020-01-01T00:00:00.000Z",
    });

    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.requestedLayers).toEqual(["tif"]);
    expect(Object.keys(body.layers)).toEqual(["tif"]);
    expect(body.layers.ccsa).toBeUndefined();
    expect(body.layers.enterprise).toBeUndefined();
    // The poisoned entry was rejected outright, so this real-data lookup
    // resolved for real rather than trusting the stale "tif" match either.
    expect(body.checkedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("a poisoned cache entry missing a requested layer also never leaks an unrequested extra it happens to carry", async () => {
    redisGet.mockResolvedValueOnce({
      layers: {
        tif: { state: "matched", name: "poisoned" },
        // missing "ssa" (one of the two requested keys) AND carries an
        // extra "hubzone" nobody asked about.
        hubzone: { state: "matched", name: "should never appear" },
      },
      checkedAt: "2020-01-01T00:00:00.000Z",
    });

    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif,ssa"));
    const body = await res.json();

    expect(body.requestedLayers).toEqual(["tif", "ssa"]);
    expect(Object.keys(body.layers).sort()).toEqual(["ssa", "tif"]);
    expect(body.layers.hubzone).toBeUndefined();
  });

  it("a genuinely exact-match cache entry (order-insensitive) IS served, unmodified", async () => {
    redisGet.mockResolvedValueOnce({
      layers: {
        ssa: { state: "not_matched" },
        tif: { state: "matched", name: "real cached hit" },
      },
      checkedAt: "2026-08-01T00:00:00.000Z",
    });

    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif,ssa"));
    const body = await res.json();

    expect(body.checkedAt).toBe("2026-08-01T00:00:00.000Z"); // proves it really was served from cache
    expect(body.layers.tif).toEqual({ state: "matched", name: "real cached hit" });
    expect(body.layers.ssa).toEqual({ state: "not_matched" });
    expect(Object.keys(body.layers).sort()).toEqual(["ssa", "tif"]);
  });
});
