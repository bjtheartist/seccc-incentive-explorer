import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { fetchMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

vi.mock("@/lib/redis", () => ({
  cached: vi.fn(
    async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
  ),
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
}));

import { GET } from "./route";

const BOUNDS = "-87.75,41.75,-87.55,41.95";

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
    source_as_of: "2026-08-05T12:00:00.000Z",
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
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/vacant", () => {
  it("returns database records with complete source coverage metadata", async () => {
    sqlMock.mockResolvedValue([vacantRow()]);

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
          },
        },
      ],
      meta: {
        sourceMode: "database",
        sourcePath: "database:vacant_properties",
        asOf: "2026-08-05T12:00:00.000Z",
        asOfBasis: "latest_queried_row_updated_at",
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
    expect(query).toContain("ST_Intersects");
    expect(values).toContain(6);
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
      asOfBasis: "latest_queried_row_updated_at",
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
      staticFeature("fallback-1", [-87.6278, 41.8819]),
    ]);
    expect(body.meta).toEqual({
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOf: null,
      asOfBasis: null,
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
  });
});
