import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock } = vi.hoisted(() => ({ cachedMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ cached: cachedMock }));

import { GET } from "./route";

interface CandidateOptions {
  lat?: string;
  lon?: string;
  displayName: string;
  houseNumber?: string;
  road?: string;
  city?: string;
}

function candidate({
  lat = "41.779444",
  lon = "-87.6548974",
  displayName,
  houseNumber,
  road,
  city = "Chicago",
}: CandidateOptions) {
  return {
    lat,
    lon,
    display_name: displayName,
    address: {
      house_number: houseNumber,
      road,
      city,
      state: "Illinois",
      country_code: "us",
    },
  };
}

beforeEach(() => {
  cachedMock.mockReset().mockImplementation(
    async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  );
});

describe("GET /api/geocode", () => {
  it("selects 1207 W 63rd instead of a first-listed W Eddy candidate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        candidate({
          lat: "41.946",
          lon: "-87.660",
          displayName: "1207, West Eddy Street, Chicago, Illinois, 60613",
          houseNumber: "1207",
          road: "West Eddy Street",
        }),
        candidate({
          displayName:
            "Go Green Community Fresh Market, 1207, West 63rd Street, West Englewood, Chicago, Illinois, 60636",
          houseNumber: "1207",
          road: "West 63rd Street",
        }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://localhost/api/geocode?address=1207%20W%2063rd"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      lat: 41.779444,
      lon: -87.6548974,
      matchQuality: "exact",
    });
    expect(body.displayName).toContain("West 63rd Street");
    expect(body.displayName).not.toContain("Eddy");

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstreamUrl.searchParams.get("addressdetails")).toBe("1");
    expect(upstreamUrl.searchParams.get("bounded")).toBe("1");
    expect(upstreamUrl.searchParams.get("countrycodes")).toBe("us");
    expect(Number(upstreamUrl.searchParams.get("limit"))).toBeGreaterThan(1);
    expect(upstreamUrl.searchParams.get("viewbox")).toBe(
      "-87.9401,42.0231,-87.5237,41.6445",
    );
  });

  it("uses a versioned cache key so stale fuzzy matches are bypassed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          candidate({
            displayName: "1207, West 63rd Street, Chicago, Illinois, 60636",
            houseNumber: "1207",
            road: "West 63rd Street",
          }),
        ],
      }),
    );

    await GET(
      new NextRequest("http://localhost/api/geocode?address=%201207%20%20W%2063rd%20"),
    );

    expect(cachedMock).toHaveBeenCalledWith(
      "geocode:v2:1207 w 63rd",
      2592000,
      expect.any(Function),
    );
  });

  it("rejects a street-level result when a house number was requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          candidate({
            displayName: "West 63rd Street, West Englewood, Chicago, Illinois",
            road: "West 63rd Street",
          }),
        ],
      }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/geocode?address=1207%20W%2063rd%20St"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Address not found");
  });

  it("does not substitute a different street or conflicting house number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          candidate({
            displayName: "1207, West Eddy Street, Chicago, Illinois, 60613",
            houseNumber: "1207",
            road: "West Eddy Street",
          }),
          candidate({
            displayName: "1209, West 63rd Street, Chicago, Illinois, 60636",
            houseNumber: "1209",
            road: "West 63rd Street",
          }),
        ],
      }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/geocode?address=1207%20W%2063rd"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Address not found");
    expect(JSON.stringify(body)).not.toContain("Eddy");
  });

  it("rejects candidates outside Chicago even when the address text matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          candidate({
            lat: "42.045",
            lon: "-87.687",
            displayName: "1207, West 63rd Street, Evanston, Illinois",
            houseNumber: "1207",
            road: "West 63rd Street",
            city: "Evanston",
          }),
        ],
      }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/geocode?address=1207%20W%2063rd"),
    );

    expect(response.status).toBe(404);
  });
});
