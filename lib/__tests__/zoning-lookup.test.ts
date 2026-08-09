import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearZoningLookupCache,
  fetchZoningLookup,
  normalizeZoningLookup,
} from "../zoning-lookup";

const source = {
  id: "chicago-arcgis-zoning" as const,
  label: "City of Chicago ArcGIS zoning boundaries",
  url: "https://example.test/zoning/1",
  retrievedAt: "2026-08-08T12:00:00.000Z",
  recordUpdatedAt: "2026-07-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => clearZoningLookupCache());

afterEach(() => {
  clearZoningLookupCache();
  vi.unstubAllGlobals();
});

describe("zoning lookup client", () => {
  it("memoizes only a validated available response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "available",
        zoneClass: "B3-2",
        zoneType: null,
        source,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchZoningLookup(41.8, -87.6);
    const second = await fetchZoningLookup(41.8, -87.6);

    expect(first.status).toBe("available");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("&v=3");
  });

  it("parses a 503 unavailable body and does not substitute an expired success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "available",
          zoneClass: "M1-2",
          zoneType: null,
          source,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: "unavailable",
            zoneClass: null,
            zoneType: null,
            source: null,
            message: "Published Chicago zoning data is temporarily unavailable.",
          },
          503,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchZoningLookup(41.81, -87.61, { cacheTtlMs: 0 });
    const result = await fetchZoningLookup(41.81, -87.61, { cacheTtlMs: 0 });

    expect(result.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves a source-backed not_found result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "not_found",
          zoneClass: null,
          zoneType: null,
          source,
          message: "No published Chicago zoning district was returned.",
        }),
      ),
    );

    const result = await fetchZoningLookup(42.5, -88.5);

    expect(result.status).toBe("not_found");
  });

  it("does not merge nearby points across a parcel boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "available",
        zoneClass: "B3-2",
        zoneType: null,
        source,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchZoningLookup(41.800001, -87.600001);
    await fetchZoningLookup(41.800019, -87.600019);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).not.toBe(fetchMock.mock.calls[1][0]);
  });

  it("rejects malformed and whitespace-only available responses", () => {
    expect(
      normalizeZoningLookup({
        status: "available",
        zoneClass: "   ",
        zoneType: null,
        source,
      }).status,
    ).toBe("unavailable");
    expect(normalizeZoningLookup({ status: "available" }).status).toBe(
      "unavailable",
    );
  });
});
