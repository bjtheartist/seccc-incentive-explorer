import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  cachedMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/redis", () => ({
  roundCoord: (value: number) => value,
  cached: cachedMock,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("PARCEL_DB_LOOKUPS_ENABLED", "false");
  cachedMock
    .mockReset()
    .mockImplementation(async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
      loader(),
    );
  getSQLMock.mockReset().mockReturnValue(sqlMock);
  sqlMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/parcel", () => {
  it("rejects malformed PINs instead of coercing them", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/parcel?pin=123&lat=41.8&lon=-87.6"),
    );
    expect(response.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("uses an exact PIN query when a clicked parcel supplies one", async () => {
    vi.stubEnv("PARCEL_DB_LOOKUPS_ENABLED", "true");
    sqlMock
      .mockResolvedValueOnce([
        {
          pin: "20123456789012",
          address: "100 E TEST ST",
          zip: "60617",
          class_code: "5-17",
          class_description: "Commercial building",
          tax_code: "73001",
          township: "Hyde Park",
          land_sqft: 10_000,
          bldg_sqft: 7_500,
          bldg_age: 40,
          land_value: 100_000,
          bldg_value: 200_000,
          total_value: 300_000,
          parcel_type: null,
          is_commercial: true,
          is_industrial: false,
          is_vacant: false,
          owner_name: null,
          owner_mailing_address: null,
          owner_type: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?pin=20-12-345-678-9012&lat=41.8&lon=-87.6",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pin).toBe("20123456789012");
    expect(body.space).toMatchObject({ lotAreaSqft: 10_000, assessorBuildingSqft: 7_500 });
    const parcelQuery = String(sqlMock.mock.calls[0][0]);
    expect(parcelQuery).toContain("WHERE pin =");
    expect(parcelQuery).not.toContain("ST_DWithin");
    expect(sqlMock.mock.calls[0].slice(1)).toContain("20123456789012");
    expect(cachedMock.mock.calls[0][0]).toBe(
      "parcel:v5:db-first:pin:20123456789012",
    );
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("uses CookViewer directly when the intentionally empty parcel DB source is not enabled", async () => {
    sqlMock.mockResolvedValue([]);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("parcel_current_beta/FeatureServer/0/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                attributes: {
                  PIN14: "20363230080000",
                  street_address: "8525 S EUCLID AVE",
                  city_state_zip: "CHICAGO, IL 60617",
                  township_name: "HYDE PARK",
                  BCLASS: "203",
                  TAXDIST: "73001",
                  LANDSF: 3_999,
                  BLDGSQFT: 1_080,
                  BLDGAGE: 102,
                  CURRENTVALUE_TOTAL: 40_000,
                  CURRENTVALUE_LAND: 10_000,
                  CURRENTVALUE_BLDG: 30_000,
                  TAXYR: 2024,
                },
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://localhost/api/parcel?pin=20363230080000"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      pin: "20363230080000",
      address: "8525 S EUCLID AVE, CHICAGO, IL 60617",
      classCode: "203",
      landSqft: 3_999,
      bldgSqft: 1_080,
      bldgAge: 102,
      totalValue: "$40,000",
      parcelType: null,
      space: {
        lotAreaSqft: 3_999,
        assessorBuildingSqft: 1_080,
        assessorBuildingYear: 2024,
      },
    });
    const countyUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("parcel_current_beta/FeatureServer/0/query"));
    expect(countyUrl).toContain("LANDSF%2CBLDGSQFT%2CBLDGAGE");
    expect(countyUrl).not.toContain("MapServer%2F44");
    const sqlQueries = sqlMock.mock.calls.map((call) => String(call[0]));
    expect(sqlQueries.some((query) => query.includes("FROM parcels"))).toBe(false);
    expect(sqlQueries.some((query) => query.includes("FROM parcel_space_measurements"))).toBe(true);
    expect(cachedMock.mock.calls[0][0]).toBe(
      "parcel:v5:cookviewer:pin:20363230080000",
    );
  });

  /* ── Address guard ──
     A parcel resolved from a point can belong to a different address than the
     one the user searched (geocoded points land in the street right-of-way;
     city vacancy-record coordinates can sit inside a neighboring parcel).
     Every resolution is stamped with how it relates to the request. */

  const cottageGroveAttributes = {
    PIN14: "25023150220000",
    street_address: "9300 S COTTAGE GROVE AVE",
    city_state_zip: "CHICAGO, IL 60619",
    township_name: "HYDE PARK",
    BCLASS: "593",
    TAXDIST: "70014",
    LANDSF: 168_839,
    BLDGSQFT: null,
    BLDGAGE: 119,
    CURRENTVALUE_TOTAL: 753_750,
    CURRENTVALUE_LAND: 168_839,
    CURRENTVALUE_BLDG: 584_911,
    TAXYR: 2024,
  };
  const drexelAttributes = {
    PIN14: "25023090250000",
    street_address: "9336 S DREXEL AVE",
    city_state_zip: "CHICAGO, IL 60619",
    township_name: "HYDE PARK",
    BCLASS: "203",
    TAXDIST: "70014",
    LANDSF: 4_000,
    BLDGSQFT: 1_200,
    BLDGAGE: 100,
    CURRENTVALUE_TOTAL: 90_000,
    CURRENTVALUE_LAND: 20_000,
    CURRENTVALUE_BLDG: 70_000,
    TAXYR: 2024,
  } as const;

  function stubCookViewer(options: {
    containment: Array<Record<string, unknown>>;
    buffered?: Array<{ attributes: Record<string, unknown>; geometry?: unknown }>;
  }) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("parcel_current_beta/FeatureServer/0/query")) {
        const isBuffered = url.includes("distance=");
        const features = isBuffered
          ? options.buffered ?? []
          : options.containment.map((attributes) => ({ attributes }));
        return { ok: true, status: 200, json: async () => ({ features }) } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("falls back to CookViewer when an explicitly enabled parcel DB has schema drift", async () => {
    vi.stubEnv("PARCEL_DB_LOOKUPS_ENABLED", "true");
    sqlMock
      .mockRejectedValueOnce(
        Object.assign(new Error('column "zip" does not exist'), { code: "42703" }),
      )
      .mockResolvedValueOnce([]);
    stubCookViewer({ containment: [cottageGroveAttributes] });

    const response = await GET(
      new NextRequest("http://localhost/api/parcel?pin=25023150220000"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pin).toBe("25023150220000");
    expect(body.addressMatch).toBe("pin");
    expect(cachedMock.mock.calls[0][0]).toBe(
      "parcel:v5:db-first:pin:25023150220000",
    );
  });

  it("marks a point resolution 'verified' when the parcel's published address matches the requested one", async () => {
    sqlMock.mockResolvedValue([]);
    stubCookViewer({ containment: [cottageGroveAttributes] });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?lat=41.725449&lon=-87.601905&address=9300%20S%20Cottage%20Grove%20Ave",
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pin).toBe("25023150220000");
    expect(body.addressMatch).toBe("verified");
  });

  it("flags a mismatch instead of presenting a neighboring parcel as the searched address", async () => {
    sqlMock.mockResolvedValue([]);
    stubCookViewer({
      containment: [cottageGroveAttributes],
      buffered: [
        { attributes: cottageGroveAttributes, geometry: { rings: [[[-87.6019, 41.7254]]] } },
        { attributes: drexelAttributes, geometry: { rings: [[[-87.6006, 41.7258]]] } },
      ],
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?lat=41.725449&lon=-87.601905&address=9300%20S%20Drexel%20Ave",
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    // The containing parcel is still returned — it IS the parcel at this
    // location — but stamped as not matching the searched address.
    expect(body.pin).toBe("25023150220000");
    expect(body.addressMatch).toBe("mismatch");
    expect(body.requestedAddress).toBe("9300 S Drexel Ave");
  });

  it("rescues a street-right-of-way point via the address-verified buffer search", async () => {
    sqlMock.mockResolvedValue([]);
    const fetchMock = stubCookViewer({
      containment: [],
      buffered: [
        { attributes: cottageGroveAttributes, geometry: { rings: [[[-87.6019, 41.7254]]] } },
        { attributes: drexelAttributes, geometry: { rings: [[[-87.6006, 41.7258]]] } },
      ],
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?lat=41.72585&lon=-87.60055&address=9336%20S%20Drexel%20Ave",
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pin).toBe("25023090250000");
    expect(body.addressMatch).toBe("verified");
    // The CookViewer service ignores the geometry's embedded spatialReference
    // on distance-buffered queries and silently returns zero features without
    // an explicit inSR (verified live 2026-08-20).
    const bufferedUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("distance="));
    expect(bufferedUrl).toContain("inSR=4326");
  });

  it("reduces a geocoder display name to its street line before matching", async () => {
    sqlMock.mockResolvedValue([]);
    stubCookViewer({
      containment: [],
      buffered: [{ attributes: drexelAttributes, geometry: { rings: [[[-87.6006, 41.7258]]] } }],
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?lat=41.72585&lon=-87.60055&address=" +
          encodeURIComponent(
            "9336, South Drexel Avenue, Burnside, Chicago, Hyde Park Township, Cook County, Illinois, 60619, United States",
          ),
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.pin).toBe("25023090250000");
    expect(body.addressMatch).toBe("verified");
  });

  it("never returns an unverified buffer neighbor and never queries the retired Socrata Parcel Universe", async () => {
    sqlMock.mockResolvedValue([]);
    const fetchMock = stubCookViewer({
      containment: [],
      buffered: [{ attributes: drexelAttributes, geometry: { rings: [[[-87.6006, 41.7258]]] } }],
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/parcel?lat=41.72585&lon=-87.60055&address=9300%20S%20Drexel%20Ave",
      ),
    );
    // Buffer candidates exist but none match — with no containing parcel
    // either, an honest empty beats a wrong neighbor.
    expect(response.status).toBe(204);
    const socrataCall = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("nj4t-kc8j"));
    expect(socrataCall).toBeUndefined();
  });

  it("stamps pure map-point lookups as 'point' resolutions", async () => {
    sqlMock.mockResolvedValue([]);
    stubCookViewer({ containment: [cottageGroveAttributes] });

    const response = await GET(
      new NextRequest("http://localhost/api/parcel?lat=41.725449&lon=-87.601905"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.addressMatch).toBe("point");
  });
});
