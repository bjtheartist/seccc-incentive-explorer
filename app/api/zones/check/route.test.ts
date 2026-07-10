import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

/**
 * Regression coverage for ED2 (confirmed in the 2026-07-10 report-workflow
 * audit): the city's shipped tif-districts.geojson contains 4 malformed
 * features (unclosed rings — T-55, T-64, T-180, T-117) that made
 * turf.booleanPointInPolygon throw "First and last coordinates in a ring
 * must be the same" regardless of the query point. Because DATABASE_URL is
 * unset in the test environment, getSQL() returns null and every request
 * here exercises the real static-zone-file code path (the same path the
 * "fallback" re-invokes in prod when the primary PostGIS query throws or
 * DATABASE_URL is unset) — so these tests hit the exact previously-broken
 * function against the real, unmodified shipped GeoJSON.
 */

function checkRequest(lat: number, lon: number) {
  return new NextRequest(
    `http://localhost/api/zones/check?lat=${lat}&lon=${lon}`
  );
}

describe("GET /api/zones/check (static fallback)", () => {
  it("does not 500 for a point that previously tripped the malformed TIF rings (regression)", async () => {
    // This request used to throw inside checkStaticZones, get caught, and
    // then throw the exact same way in the route's own fallback branch,
    // producing a hard 500 for any query point.
    const res = await GET(checkRequest(41.8781, -87.6298));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("does not 500 for several other arbitrary Chicago-area points", async () => {
    const points: [number, number][] = [
      [41.7355, -87.5512],
      [41.7, -87.6],
      [41.9, -87.65],
      [41.65, -87.6],
    ];

    for (const [lat, lon] of points) {
      const res = await GET(checkRequest(lat, lon));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    }
  });

  it("still resolves a real TIF district match for a well-formed geometry", async () => {
    // Centroid of T-178 (Washington Park), a well-formed feature in the same
    // shipped file as the 4 malformed ones — proves the fix skips only the
    // bad features and doesn't blind the lookup to everything.
    const res = await GET(checkRequest(41.78638587082365, -87.6239725143245));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ key: string; name: string }>;
    const tifMatch = body.find((m) => m.key === "tif");
    expect(tifMatch).toBeDefined();
  });

  it("logs a warning instead of throwing when it skips a malformed feature", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await GET(checkRequest(41.95, -87.7));
      expect(warnSpy).toHaveBeenCalled();
      const warnedAboutBadGeometry = warnSpy.mock.calls.some((args) =>
        String(args[0]).includes("[zones/check] skipping malformed feature")
      );
      expect(warnedAboutBadGeometry).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
