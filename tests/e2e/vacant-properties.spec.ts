import { test, expect } from "@playwright/test";

test.describe("Vacant Properties - API Tests", () => {
  test("vacant API returns GeoJSON with zone_matches", async ({ request }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&limit=5"
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBeGreaterThan(0);

    const feature = data.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toHaveLength(2);
    expect(feature.properties).toHaveProperty("id");
    expect(feature.properties).toHaveProperty("address");
    expect(feature.properties).toHaveProperty("propertyType");
    expect(feature.properties).toHaveProperty("zoneMatches");
    expect(feature.properties).toHaveProperty("incentiveCount");
    expect(Array.isArray(feature.properties.zoneMatches)).toBe(true);
  });

  test("vacant API respects limit parameter", async ({ request }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&limit=2"
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.features.length).toBeLessThanOrEqual(2);
  });

  test("vacant API requires bounds parameter", async ({ request }) => {
    const res = await request.get("/api/vacant");
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("bounds");
  });

  test("vacant API rejects invalid bounds", async ({ request }) => {
    const res = await request.get("/api/vacant?bounds=abc,def,ghi,jkl");
    expect(res.status()).toBe(400);
  });

  test("vacant properties have incentive zone cross-references", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&limit=10"
    );
    const data = await res.json();
    const withZones = data.features.filter(
      (f: { properties: { incentiveCount: number } }) =>
        f.properties.incentiveCount > 0
    );
    expect(withZones.length).toBeGreaterThan(0);
  });

  test("parcel API returns data with expected fields", async ({ request }) => {
    const res = await request.get("/api/parcel?lat=41.744&lon=-87.5775");
    expect([200, 204]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("pin");
      expect(data).toHaveProperty("address");
      expect(data).toHaveProperty("classCode");
      expect(data).toHaveProperty("isCommercial");
      expect(data).toHaveProperty("isVacant");
    }
  });

  test("vacant API returns properties sorted by incentive count", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&limit=20"
    );
    const data = await res.json();
    const counts = data.features.map(
      (f: { properties: { incentiveCount: number } }) =>
        f.properties.incentiveCount
    );
    // Verify descending order
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  test("static fallback file exists and is valid GeoJSON", async ({
    request,
  }) => {
    const res = await request.get("/data/vacant-properties.json");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBeGreaterThan(0);
    expect(data.features.length).toBeLessThanOrEqual(2000);
  });

  test("vacant properties include ownership fields", async ({ request }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&limit=5"
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.features.length).toBeGreaterThan(0);
    const feature = data.features[0];
    expect(feature.properties).toHaveProperty("ownerName");
    expect(feature.properties).toHaveProperty("ownerType");
  });

  test("vacant API supports ownerType filter", async ({ request }) => {
    const res = await request.get(
      "/api/vacant?bounds=-87.7,41.7,-87.5,41.8&ownerType=city_public&limit=5"
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    if (data.features.length > 0) {
      for (const f of data.features) {
        expect(f.properties.ownerType).toBe("city_public");
      }
    }
  });
});

/**
 * UI tests require WebGL (Mapbox GL) and must be run with --headed flag.
 * Headless Chromium does not support WebGL, so these tests are skipped by default.
 * Run with: npx playwright test --headed
 */
