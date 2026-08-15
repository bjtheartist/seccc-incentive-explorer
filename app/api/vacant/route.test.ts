import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock, fetchMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  cachedMock: vi.fn(),
  fetchMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

vi.mock("@/lib/redis", () => ({
  cached: cachedMock,
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
}));

import { GET } from "./route";

const BOUNDS = "-87.75,41.75,-87.55,41.95";
const NOT_REQUESTED_LICENSE_SCREENING = {
  policyVersion: "issued-exact-address-v4",
  sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
  status: "not_requested",
  checkedAt: null,
  candidateCount: 0,
  checkedCount: 0,
  matchedPropertyCount: 0,
  capped: false,
  addressCap: 500,
  sourceCallCount: 0,
  successfulBatches: 0,
  failedBatches: 0,
  malformedRowCount: 0,
  partialReasons: [],
  caveats: [
    "An issued, unexpired BACP license at the exact published address is a conflict signal, not proof that the property is occupied.",
    "No exact-address match is not evidence that a property is unoccupied; address formatting and change-of-location records can limit matching.",
  ],
};

function vacantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cols-1",
    source: "cols",
    address: "123 S STATE ST",
    lat: 41.8819,
    lon: -87.6278,
    property_type: "vacant_land",
    ward: "42",
    community_area: "LOOP",
    zoning_class: "DX-7",
    square_feet: 5000,
    status: "city_owned",
    zone_matches: [{ zoneKey: "tif", zoneName: "Central Loop" }],
    incentive_count: 1,
    owner_name: "CITY OF CHICAGO",
    owner_type: "public",
    source_record_date: null,
    explorer_refreshed_at: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function staticFeature(id: string, coordinates: [number, number]): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: {
      id,
      source: "cols",
      address: `${id} S STATE ST`,
      propertyType: "vacant_land",
      zoneMatches: [],
    },
  };
}

function resolvedCacheTTL(callIndex: number, result: unknown): number {
  const ttl = cachedMock.mock.calls[callIndex]?.[1] as
    | number
    | ((value: unknown) => number);
  return typeof ttl === "function" ? ttl(result) : ttl;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
  fetchMock.mockReset();
  cachedMock.mockReset().mockImplementation(
    async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  );
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/vacant", () => {
  it("screens polygon results for issued, unexpired exact-address conflicts", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({
        source: "dpd_vacant",
        property_type: "vacant_building",
        source_record_date: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            address: "123 S STATE ST",
            doing_business_as_name: "State Street Cafe",
            license_description: "Retail Food",
            license_status: "AAI",
            expiration_date: "2027-01-01T00:00:00.000",
          },
        ]),
        { status: 200 },
      ),
    );
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[
        [-87.7, 41.8],
        [-87.6, 41.8],
        [-87.6, 41.9],
        [-87.7, 41.8],
      ]],
    };
    const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?${params.toString()}`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      licenseCheckState: "match",
      currentLicenseMatches: [
        {
          name: "State Street Cafe",
          status: "AAI",
          expirationDate: "2027-01-01",
        },
      ],
      licenseCheckedAt: "2026-08-14T12:00:00.000Z",
    });
    expect(body.meta.licenseScreening).toMatchObject({
      policyVersion: "issued-exact-address-v4",
      status: "available",
      candidateCount: 1,
      checkedCount: 1,
      matchedPropertyCount: 1,
      sourceCallCount: 1,
      successfulBatches: 1,
      failedBatches: 0,
    });
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      "license_status='AAI'",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=21600, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(0, body)).toBe(86_400);
    expect(resolvedCacheTTL(1, body)).toBe(21_600);
  });

  it("short-caches an unavailable polygon license lookup for recovery", async () => {
    sqlMock.mockResolvedValue([vacantRow()]);
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[
        [-87.7, 41.8],
        [-87.6, 41.8],
        [-87.6, 41.9],
        [-87.7, 41.8],
      ]],
    };
    const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?${params.toString()}`),
    );
    const body = await response.json();

    expect(body.meta.licenseScreening.status).toBe("unavailable");
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(1, body)).toBe(300);
  });

  it("returns database records with complete source coverage metadata", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({ explorer_refreshed_at: "2026-08-05 12:00:00+00" }),
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-87.6278, 41.8819] },
          properties: {
            id: "cols-1",
            source: "cols",
            address: "123 S STATE ST",
            propertyType: "vacant_land",
            ward: "42",
            communityArea: "LOOP",
            zoningClass: "DX-7",
            squareFeet: 5000,
            status: "city_owned",
            zoneMatches: [{ zoneKey: "tif", zoneName: "Central Loop" }],
            incentiveCount: 1,
            ownerName: "CITY OF CHICAGO",
            ownerType: "public",
            canonicalType: "land",
            sourceRecordDate: null,
            freshnessClass: "unknown_date",
            explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
          },
        },
      ],
      meta: {
        sourceMode: "database",
        sourcePath: "database:vacant_properties",
        asOf: "2026-08-05T12:00:00.000Z",
        asOfBasis: "explorer_refresh_timestamp",
        explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
        freshness: {
          policyVersion: "source-record-date-v1",
          referenceDate: "2026-08-14T00:00:00.000Z",
          recentWithinYears: 3,
          cutoffDate: "2023-08-14T00:00:00.000Z",
          retainedWithinYears: 5,
          retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
          retentionCutoffBasis: "current_request_reference_policy",
          returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
        },
        licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
        returnedCount: 1,
        configuredLimit: 5,
        queryLimit: 6,
        coverageStatus: "complete",
        potentiallyTruncated: false,
        fallbackReason: null,
      },
    });

    const query = String(sqlMock.mock.calls[0][0]);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(query).toContain("updated_at::text");
    expect(query).toContain("to_jsonb(vp)->>'source_record_date'");
    expect(query).toContain("ST_Intersects");
    expect(values).toContain(6);
    expect(cachedMock.mock.calls[0]?.[0]).toContain("vacant:v5:");
  });

  it("normalizes an empty legacy zone name to its canonical zone key", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({
        zone_matches: [{ zoneKey: "illinoisOZ", zoneName: "" }],
        incentive_count: 1,
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.meta.sourceMode).toBe("database");
    expect(body.features[0].properties.zoneMatches).toEqual([
      { zoneKey: "illinoisOZ", zoneName: "illinoisOZ" },
    ]);
  });

  it("anchors freshness to Chicago today before the UTC-day rollover", async () => {
    vi.setSystemTime(new Date("2026-08-15T04:38:00.000Z"));
    sqlMock.mockResolvedValue([vacantRow()]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.meta.freshness).toMatchObject({
      referenceDate: "2026-08-14T00:00:00.000Z",
      cutoffDate: "2023-08-14T00:00:00.000Z",
      retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    });
  });

  it("discloses truncation when a sentinel row exceeds the configured limit", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({ id: "cols-1" }),
      vacantRow({ id: "cols-2", address: "125 S STATE ST" }),
      vacantRow({ id: "sentinel", address: "127 S STATE ST" }),
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=2`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toHaveLength(2);
    expect(body.features.map((feature: GeoJSON.Feature) => feature.properties?.id)).not.toContain(
      "sentinel",
    );
    expect(body.meta).toEqual({
      sourceMode: "database",
      sourcePath: "database:vacant_properties",
      asOf: "2026-08-05T12:00:00.000Z",
      asOfBasis: "explorer_refresh_timestamp",
      explorerRefreshedAt: "2026-08-05T12:00:00.000Z",
      freshness: {
        policyVersion: "source-record-date-v1",
        referenceDate: "2026-08-14T00:00:00.000Z",
        recentWithinYears: 3,
        cutoffDate: "2023-08-14T00:00:00.000Z",
        retainedWithinYears: 5,
        retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
        retentionCutoffBasis: "current_request_reference_policy",
        returnedCounts: { recent: 0, stale: 0, unknownDate: 2 },
      },
      licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
      returnedCount: 2,
      configuredLimit: 2,
      queryLimit: 3,
      coverageStatus: "truncated",
      potentiallyTruncated: true,
      fallbackReason: null,
    });
  });

  it("marks a static response as partial after a database query failure", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          generatedAt: "2026-08-13T09:00:00.000Z",
          features: [
            staticFeature("fallback-1", [-87.6278, 41.8819]),
            staticFeature("outside", [-88.1, 41.8819]),
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toEqual([
      {
        ...staticFeature("fallback-1", [-87.6278, 41.8819]),
        properties: {
          ...staticFeature("fallback-1", [-87.6278, 41.8819]).properties,
          canonicalType: "land",
          sourceRecordDate: null,
          freshnessClass: "unknown_date",
          explorerRefreshedAt: "2026-08-13T09:00:00.000Z",
          status: "Not recorded",
          zoneMatches: [],
          incentiveCount: 0,
        },
      },
    ]);
    expect(body.meta).toEqual({
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOf: "2026-08-13T09:00:00.000Z",
      asOfBasis: "static_export_generated_at",
      explorerRefreshedAt: "2026-08-13T09:00:00.000Z",
      freshness: {
        policyVersion: "source-record-date-v1",
        referenceDate: "2026-08-14T00:00:00.000Z",
        recentWithinYears: 3,
        cutoffDate: "2023-08-14T00:00:00.000Z",
        retainedWithinYears: 5,
        retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
        retentionCutoffBasis: "current_request_reference_policy",
        returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
      },
      licenseScreening: NOT_REQUESTED_LICENSE_SCREENING,
      returnedCount: 1,
      configuredLimit: 5,
      queryLimit: null,
      coverageStatus: "partial",
      potentiallyTruncated: false,
      fallbackReason: "database_query_failed",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/data/vacant-properties.json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=0",
    );
    expect(resolvedCacheTTL(0, body)).toBe(300);
  });

  it("fails over instead of publishing an incoherent source/property pair", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({
        id: "bad-source-pair",
        source: "311_clean_lot",
        property_type: "vacant_building",
      }),
    ]);
    fetchMock.mockResolvedValue(new Response("missing", { status: 503 }));

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features).toEqual([]);
    expect(body.meta).toMatchObject({
      sourceMode: "static_fallback",
      coverageStatus: "partial",
      fallbackReason: "database_query_failed",
    });
  });

  it("classifies clean-lot reports from their original source date", async () => {
    sqlMock.mockResolvedValue([
      vacantRow({
        id: "311-clean-lot-SR21-1",
        source: "311_clean_lot",
        property_type: "reported_vacant_lot",
        status: "Completed",
        source_record_date: "2021-07-01T10:00:00.000Z",
      }),
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/vacant?bounds=${BOUNDS}&limit=5`),
    );
    const body = await response.json();

    expect(body.features[0].properties).toMatchObject({
      source: "311_clean_lot",
      propertyType: "reported_vacant_lot",
      canonicalType: "land",
      status: "Completed",
      sourceRecordDate: "2021-07-01T10:00:00.000Z",
      freshnessClass: "stale",
    });
    expect(body.meta.freshness.returnedCounts).toEqual({
      recent: 0,
      stale: 1,
      unknownDate: 0,
    });
  });
});
