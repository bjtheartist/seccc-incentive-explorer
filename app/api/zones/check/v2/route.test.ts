import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the NEW /api/zones/check/v2 endpoint (build-spec.md
 * 1.3). Mocks lib/zone-evidence-cache's resolveZoneEvidenceV2Cached at the
 * module boundary so these tests assert the route's own contract (schema
 * shape, header selection) independent of real geometry/DB — the producer
 * logic itself is covered by lib/__tests__/zones-check-v2.test.ts and
 * lib/__tests__/zone-evidence-cache.test.ts.
 */

const resolveMock = vi.fn();

vi.mock("@/lib/zone-evidence-cache", () => ({
  resolveZoneEvidenceV2Cached: (...args: unknown[]) => resolveMock(...args),
}));

function checkRequest(params: string) {
  return new NextRequest(`http://localhost/api/zones/check/v2?${params}`);
}

beforeEach(() => {
  resolveMock.mockReset();
});

describe("GET /api/zones/check/v2", () => {
  it("requires lat and lon", async () => {
    const { GET } = await import("./route");
    const res = await GET(checkRequest(""));
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric lat/lon", async () => {
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=abc&lon=-87.6"));
    expect(res.status).toBe(400);
  });

  it("returns the v2 envelope shape with no redundant checked[]/unknown[] arrays", async () => {
    resolveMock.mockResolvedValue({
      layers: {
        tif: { state: "matched", name: "Some TIF" },
        nof: { state: "not_matched" },
      },
      hadUnknown: false,
      checkedAt: "2026-08-01T00:00:00.000Z",
    });

    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif,nof"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.schemaVersion).toBe(2);
    expect(typeof body.dataRevision).toBe("string");
    expect(typeof body.checkedAt).toBe("string");
    expect(body.requestedLayers).toEqual(["tif", "nof"]);
    expect(body.layers).toEqual({
      tif: { state: "matched", name: "Some TIF" },
      nof: { state: "not_matched" },
    });
    expect(Object.hasOwn(body, "checked")).toBe(false);
    expect(Object.hasOwn(body, "unknown")).toBe(false);
  });

  it("echoes the cache's own checkedAt verbatim rather than stamping a fresh now() (review1 R3)", async () => {
    const originalCheckedAt = "2020-01-01T00:00:00.000Z"; // deliberately ancient / not "now"
    resolveMock.mockResolvedValue({
      layers: { tif: { state: "matched", name: "Some TIF" } },
      hadUnknown: false,
      checkedAt: originalCheckedAt,
    });
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif"));
    const body = await res.json();
    expect(body.checkedAt).toBe(originalCheckedAt);
  });

  it("fully-covered response is publicly cacheable (no no-store)", async () => {
    resolveMock.mockResolvedValue({
      layers: { tif: { state: "matched", name: "Some TIF" } },
      hadUnknown: false,
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif"));
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).not.toContain("no-store");
    expect(cacheControl).toContain("s-maxage=604800");
  });

  it("any-unknown response sets Cache-Control: no-store", async () => {
    resolveMock.mockResolvedValue({
      layers: {
        tif: { state: "matched", name: "Some TIF" },
        ssa: { state: "unknown", reason: "source_unavailable" },
      },
      hadUnknown: true,
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6&layers=tif,ssa"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("defaults to every checkable layer when `layers` is omitted", async () => {
    resolveMock.mockResolvedValue({
      layers: {},
      hadUnknown: false,
      checkedAt: "2026-08-01T00:00:00.000Z",
    });
    const { GET } = await import("./route");
    await GET(checkRequest("lat=41.8&lon=-87.6"));
    const [, , , requestedLayers] = resolveMock.mock.calls[0];
    expect(requestedLayers.length).toBeGreaterThan(10);
  });

  it("does not 500 when the resolver throws — returns a clean 500 JSON error", async () => {
    resolveMock.mockRejectedValue(new Error("boom"));
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=41.8&lon=-87.6"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
