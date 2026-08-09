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

const zbaSource = {
  id: "chicago-zba-arcgis" as const,
  label: "City of Chicago Zoning Board of Appeals case layer",
  url: "https://example.test/zba/16",
  boardUrl: "https://example.test/zba",
  retrievedAt: "2026-08-08T12:00:00.000Z",
  sourceUpdatedAt: null,
  freshnessNote: "The City layer does not publish a refresh timestamp.",
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
    const fetchMock = vi.fn().mockImplementation(async () =>
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
    expect(fetchMock.mock.calls[0][0]).toContain("&v=4");
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

  it("does not memoize current zoning when the nested ZBA source is unavailable", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse({
        status: "available",
        zoneClass: "B3-2",
        zoneType: null,
        source,
        zba: {
          status: "unavailable",
          cases: [],
          source: zbaSource,
          message: "The City ZBA source could not be checked.",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchZoningLookup(41.82, -87.62);
    const second = await fetchZoningLookup(41.82, -87.62);

    expect(first.zba?.status).toBe("unavailable");
    expect(second.zba?.status).toBe("unavailable");
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

  describe("vintage passthrough", () => {
    const vintage = {
      retrievedAt: "2026-08-09T19:44:37.946Z",
      answeredBy: "chicago-arcgis-zoning",
      comparabilityNote: "The two City mirrors publish freshness at different scopes.",
      mirrors: [
        {
          id: "chicago-arcgis-zoning",
          label: "City of Chicago ArcGIS zoning boundaries",
          answered: true,
          field: "UPDATE_TIMESTAMP",
          scope: "record",
          updatedAt: "2023-02-03T15:53:28.000Z",
          note: "Polygon-scoped.",
        },
        {
          id: "chicago-data-portal-zoning",
          label: "City of Chicago Data Portal zoning boundaries",
          answered: false,
          field: "rowsUpdatedAt",
          scope: "dataset",
          updatedAt: "2026-07-29T15:21:09.000Z",
          note: "Dataset-scoped.",
          statedTimePeriod: "Current as of June 2026",
        },
      ],
    };

    it("keeps both mirrors on an available response", () => {
      const result = normalizeZoningLookup({
        status: "available",
        zoneClass: "PD 677",
        zoneType: null,
        source,
        vintage,
      });

      expect(result.status).toBe("available");
      expect(result.vintage?.mirrors).toHaveLength(2);
      expect(result.vintage?.mirrors[1].statedTimePeriod).toBe(
        "Current as of June 2026",
      );
    });

    it("keeps provenance on an unavailable response", () => {
      const result = normalizeZoningLookup({
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        vintage: { ...vintage, answeredBy: null },
      });

      expect(result.status).toBe("unavailable");
      expect(result.vintage?.answeredBy).toBeNull();
      expect(result.vintage?.mirrors).toHaveLength(2);
    });

    it("drops a vintage block that does not describe its mirrors", () => {
      const result = normalizeZoningLookup({
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        vintage: { retrievedAt: "2026-08-09T19:44:37.946Z", mirrors: [{ id: "made-up" }] },
      });

      expect(result.status).toBe("unavailable");
      expect(result.vintage).toBeUndefined();
    });
  });
});
