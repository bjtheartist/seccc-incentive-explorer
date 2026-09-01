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

/**
 * R1 finding 3 — geocoder hardening, and the client-side half of finding 1.
 *
 * Before this, the Nominatim calls had NO timeout and NO retry: a hung
 * connection sat until the platform killed the request, and the reader watched
 * a spinner. And every failure — outage or genuine miss — reached the client
 * the same way, so /report told people to "try a more specific Chicago
 * address" when the fault was entirely ours.
 */
describe("GET /api/geocode — timeout, retry, and an honest failure status", () => {
  const NOT_FOUND_QUERY = "http://localhost/api/geocode?address=1207%20W%2063rd";

  function chicagoMatch() {
    return {
      ok: true,
      status: 200,
      json: async () => [
        candidate({
          displayName: "1207, West 63rd Street, Chicago, Illinois, 60636",
          houseNumber: "1207",
          road: "West 63rd Street",
        }),
      ],
    };
  }

  it("gives every upstream request a 5s abort deadline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chicagoMatch());
    vi.stubGlobal("fetch", fetchMock);

    await GET(new NextRequest(NOT_FOUND_QUERY));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // The Nominatim usage policy asks for an identifying agent; keep it.
    expect(init.headers).toMatchObject({ "User-Agent": expect.stringContaining("Chicago") });
  });

  it("retries a 5xx EXACTLY once, then answers 503 with status 'unavailable'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(NOT_FOUND_QUERY));
    const body = await response.json();

    // Two attempts total — never a retry storm against a free public service.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    // And never the reader-blaming 404 shape.
    expect(body.error).not.toContain("not found");
  });

  it("retries a transport failure once, then answers 503 'unavailable'", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(NOT_FOUND_QUERY));
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
  });

  it("succeeds on the SECOND attempt when the first one fails — the retry is real", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(chicagoMatch());
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(NOT_FOUND_QUERY));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx — a real answer from the service is not re-asked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await GET(new NextRequest(NOT_FOUND_QUERY));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a service that ANSWERS with no Chicago match is 404 'not_found' — distinctly NOT the outage status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));

    const response = await GET(new NextRequest(NOT_FOUND_QUERY));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.status).toBe("not_found");
    expect(body.status).not.toBe("unavailable");
  });

  it("the reverse path degrades to a null ZIP MARKED as unavailable, never a bare null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const response = await GET(
      new NextRequest("http://localhost/api/geocode?lat=41.75&lon=-87.62"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.zip).toBeNull();
    // The marker is what stops a downstream reader treating this as "this
    // point has no ZIP" (R1 finding 4's rule, applied to the reverse path).
    expect(body.status).toBe("unavailable");
  });
});

/**
 * The Mapbox forward fallback is feature-detected: it adds no required
 * configuration, and with no token in the environment the route's behaviour
 * must be EXACTLY timeout + retry + honest error.
 */
describe("GET /api/geocode — optional Mapbox forward fallback", () => {
  const QUERY = "http://localhost/api/geocode?address=1207%20W%2063rd";

  it("is not consulted at all when no token is configured", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(QUERY));

    expect(response.status).toBe(503);
    // Two Nominatim attempts and nothing else — no api.mapbox.com call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("api.mapbox.com")),
    ).toBe(false);
    vi.unstubAllEnvs();
  });

  it("answers from Mapbox when Nominatim is down and a token IS present", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "pk.test-token");
    const fetchMock = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes("api.mapbox.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [
              {
                center: [-87.6548974, 41.779444],
                place_name: "1207 W 63rd St, Chicago, Illinois 60636, United States",
                address: "1207",
                text: "West 63rd Street",
              },
            ],
          }),
        };
      }
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(QUERY));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ lat: 41.779444, lon: -87.6548974, matchQuality: "exact" });
    // Nominatim was still tried twice first; Mapbox is a fallback, not a bypass.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("nominatim")).length,
    ).toBe(2);
    vi.unstubAllEnvs();
  });

  it("a Mapbox failure does NOT rescue the route into a false answer — it stays a 503", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "pk.test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
        if (String(url).includes("api.mapbox.com")) {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        throw new TypeError("fetch failed");
      }),
    );

    const response = await GET(new NextRequest(QUERY));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    vi.unstubAllEnvs();
  });
});
