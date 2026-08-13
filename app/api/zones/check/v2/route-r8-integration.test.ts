import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

/**
 * review2 R8 — end-to-end proof through the REAL route, with NOTHING
 * mocked (no lib/zone-evidence-cache mock, unlike route.test.ts). The test
 * environment has no DATABASE_URL and no Redis env vars, so this exercises
 * the exact real production code path for a static-only layer: real
 * hubzone.geojson, real resolveZoneEvidenceV2, cache-layer code running
 * with getRedisClient() === null (resolve, don't cache — the honest
 * behavior when Redis is unavailable).
 *
 * The review's own coordinate: (42.0047, -87.6901) matches BOTH qualified
 * tract 17031020500 and expired redesignated tract 17031020602 in the
 * shipped file (qualified comes first in file order) — the exact
 * shared-boundary scenario R8 fixes.
 */
function checkRequest(params: string) {
  return new NextRequest(`http://localhost/api/zones/check/v2?${params}`);
}

describe("GET /api/zones/check/v2 — review2 R8 end-to-end (no mocks)", () => {
  it("the shared-boundary HUBZone coordinate resolves to unknown/redesignated_area_expired with Cache-Control: no-store", async () => {
    const { GET } = await import("./route");
    const res = await GET(checkRequest("lat=42.0047&lon=-87.6901&layers=hubzone"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.layers.hubzone.state).toBe("unknown");
    expect(body.layers.hubzone.reason).toBe("redesignated_area_expired");
    expect(body.layers.hubzone.state).not.toBe("matched");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a repeated request (simulating what a cache hit would serve) is stable and still not-store", async () => {
    const { GET } = await import("./route");
    const res1 = await GET(checkRequest("lat=42.0047&lon=-87.6901&layers=hubzone"));
    const res2 = await GET(checkRequest("lat=42.0047&lon=-87.6901&layers=hubzone"));
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.layers.hubzone).toEqual(body2.layers.hubzone);
    expect(res2.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a real qualified-tract HUBZone point (control case) is publicly cacheable and plain matched", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
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
        turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
      ) {
        found = { lat: centroid.geometry.coordinates[1], lon: centroid.geometry.coordinates[0] };
        break;
      }
    }
    expect(found).not.toBeNull();

    const { GET } = await import("./route");
    const res = await GET(checkRequest(`lat=${found!.lat}&lon=${found!.lon}&layers=hubzone`));
    const body = await res.json();
    expect(body.layers.hubzone.state).toBe("matched");
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).not.toContain("no-store");
  });
});
