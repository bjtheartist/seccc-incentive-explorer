import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/redis", () => ({
  roundCoord: (value: number) => value,
  cached: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
}));

import { GET } from "./route";

beforeEach(() => {
  getSQLMock.mockReset().mockReturnValue(sqlMock);
  sqlMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
  );
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
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("reads the current Cook County parcel service schema when the DB misses", async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
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
  });
});
