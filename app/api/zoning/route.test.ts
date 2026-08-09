import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { cachedMock } = vi.hoisted(() => ({ cachedMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({
  cached: cachedMock,
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
}));

vi.mock("@/lib/socrata", () => ({
  socrataHeaders: () => ({ "X-App-Token": "test-token" }),
}));

import { GET } from "./route";

function request(query = "lat=41.73035&lon=-87.55024"): NextRequest {
  return new NextRequest(`http://localhost/api/zoning?${query}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  cachedMock.mockReset().mockImplementation(
    async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
      loader(),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/zoning", () => {
  it("queries ArcGIS feature layer 1 in WGS84 and returns official fields", async () => {
    const updatedAt = Date.UTC(2026, 5, 16);
    const ordinanceDate = Date.UTC(2024, 1, 21);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        features: [
          {
            attributes: {
              ZONE_CLASS: "PD 1376",
              ZONE_TYPE: 1,
              PD_NUM: 1376,
              PMD_SUB_AREA: null,
              PEDSTREET_AREANAME: "Commercial Avenue",
              ORDINANCE_NUM: "O2024-1000",
              ORDINANCE_DATE: ordinanceDate,
              UPDATE_TIMESTAMP: updatedAt,
              CLERK_DOCNO: "O2024-1000",
              CLERK_URL: "https://example.test/clerk/O2024-1000",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "available",
      zoneClass: "PD 1376",
      zoneType: null,
      zoneTypeCode: 1,
      pdNumber: 1376,
      pedestrianStreetAreaName: "Commercial Avenue",
      ordinanceNumber: "O2024-1000",
      ordinanceDate: new Date(ordinanceDate).toISOString(),
      clerkDocumentNumber: "O2024-1000",
      clerkUrl: "https://example.test/clerk/O2024-1000",
      recordUpdatedAt: new Date(updatedAt).toISOString(),
      source: {
        id: "chicago-arcgis-zoning",
        recordUpdatedAt: new Date(updatedAt).toISOString(),
      },
    });

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstreamUrl.pathname.endsWith("/MapServer/1/query")).toBe(true);
    expect(upstreamUrl.searchParams.get("inSR")).toBe("4326");
    expect(upstreamUrl.searchParams.get("geometry")).toBe(
      "-87.55024,41.73035",
    );
    expect(upstreamUrl.searchParams.get("returnGeometry")).toBe("false");
    expect(upstreamUrl.searchParams.get("resultRecordCount")).toBe("1");
    expect(upstreamUrl.searchParams.get("outFields")).toContain("CLERK_URL");
    expect(cachedMock).toHaveBeenCalledWith(
      "zoning:v3:41.73035:-87.55024",
      604800,
      expect.any(Function),
    );
  });

  it("detects an ArcGIS error inside HTTP 200 and uses intersects fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 400, message: "Unable to complete operation" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          type: "FeatureCollection",
          features: [
            {
              properties: {
                zone_class: "B3-2",
                zone_type: "1",
                pd_num: "0",
                edit_date: "2026-06-16T00:00:00.000",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "available",
      zoneClass: "B3-2",
      zoneType: null,
      source: { id: "chicago-data-portal-zoning" },
    });
    const fallbackUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(fallbackUrl.searchParams.get("$where")).toBe(
      "intersects(the_geom,'POINT(-87.55024 41.73035)')",
    );
    expect(fallbackUrl.toString()).not.toContain("within_circle");
  });

  it("returns a typed not_found result after a successful empty lookup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ features: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ type: "FeatureCollection", features: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("lat=42.5&lon=-88.5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "not_found",
      zoneClass: null,
      zoneType: null,
      source: { id: "chicago-arcgis-zoning" },
    });
    expect(response.headers.get("Cache-Control")).toContain("s-maxage");
  });

  it("returns an uncached 503 when both authoritative sources fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "ArcGIS unavailable" }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: "Socrata unavailable" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "unavailable",
      zoneClass: null,
      zoneType: null,
      source: null,
      message: "Published Chicago zoning data is temporarily unavailable.",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    "",
    "lat=abc&lon=-87.6",
    "lat=41.8&lon=not-a-number",
    "lat=91&lon=-87.6",
    "lat=41.8&lon=-181",
  ])("rejects invalid coordinates without contacting upstream: %s", async (query) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cachedMock).not.toHaveBeenCalled();
  });
});
