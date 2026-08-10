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
    // Moves with the server cache key, or a warm entry serves the old shape.
    expect(fetchMock.mock.calls[0][0]).toContain("&v=5");
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
    const arcgisMirror = {
      id: "chicago-arcgis-zoning",
      label: "City of Chicago ArcGIS zoning boundaries",
      queryOutcome: "answered",
      datasetOutcome: "not_published",
      record: {
        field: "UPDATE_TIMESTAMP",
        updatedAt: "2023-02-03T15:53:28.000Z",
        scope: "record",
      },
      dataset: null,
      note: "Polygon-scoped.",
    };

    const socrataMirror = {
      id: "chicago-data-portal-zoning",
      label: "City of Chicago Data Portal zoning boundaries",
      queryOutcome: "not_queried",
      datasetOutcome: "published",
      record: null,
      dataset: {
        field: "rowsUpdatedAt",
        updatedAt: "2026-07-29T15:21:09.000Z",
        scope: "dataset",
      },
      note: "Dataset-scoped.",
      statedTimePeriod: "Current as of June 2026",
    };

    const vintage = {
      retrievedAt: "2026-08-09T19:44:37.946Z",
      answeredBy: "chicago-arcgis-zoning",
      answerKind: "zoning",
      comparabilityNote: "The two City mirrors publish freshness at different scopes.",
      mirrors: [arcgisMirror, socrataMirror],
    };

    const unansweredVintage = {
      ...vintage,
      answeredBy: null,
      answerKind: null,
      mirrors: [
        { ...arcgisMirror, queryOutcome: "failed", record: null },
        { ...socrataMirror, queryOutcome: "failed" },
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
        vintage: unansweredVintage,
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

    /**
     * Defect 6. The guard was enforced only on the unavailable branch, so the
     * two paths that actually carry zoning data spread the candidate verbatim
     * and published whatever arrived — contradicting the guard's own docstring.
     */
    it("enforces the guard on the branches that carry zoning data", () => {
      const available = normalizeZoningLookup({
        status: "available",
        zoneClass: "B3-2",
        zoneType: null,
        source,
        vintage: { bogus: true, mirrors: "not-an-array" },
      });

      expect(available.status).toBe("available");
      expect(available.vintage).toBeUndefined();

      const notFound = normalizeZoningLookup({
        status: "not_found",
        zoneClass: null,
        zoneType: null,
        source,
        message: "No published Chicago zoning district was returned.",
        vintage: "not even an object",
      });

      expect(notFound.status).toBe("not_found");
      expect(notFound.vintage).toBeUndefined();
    });

    /**
     * Defect 7. `mirrors.every(...)` is vacuously true for [], so a block
     * describing NO mirror satisfied a guard whose whole purpose is refusing
     * partial provenance. Both published mirrors must be present by id.
     */
    it.each([
      ["no mirrors at all", []],
      ["only ArcGIS", [arcgisMirror]],
      ["only the Data Portal", [socrataMirror]],
      ["two copies of one mirror", [arcgisMirror, arcgisMirror]],
    ])("rejects a vintage block describing %s", (_label, mirrors) => {
      const result = normalizeZoningLookup({
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        vintage: { ...vintage, mirrors },
      });

      expect(result.vintage).toBeUndefined();
    });

    it("keeps a block that does describe both mirrors", () => {
      const result = normalizeZoningLookup({
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        vintage: unansweredVintage,
      });

      expect(result.vintage?.mirrors).toHaveLength(2);
    });

    /** A record timestamp may not ride on a mirror that returned no record. */
    it("rejects a record timestamp on a mirror that did not answer", () => {
      const result = normalizeZoningLookup({
        status: "unavailable",
        zoneClass: null,
        zoneType: null,
        source: null,
        message: "Published Chicago zoning data is temporarily unavailable.",
        vintage: {
          ...unansweredVintage,
          mirrors: [
            {
              ...arcgisMirror,
              queryOutcome: "failed",
              record: {
                field: "UPDATE_TIMESTAMP",
                updatedAt: "2023-02-03T15:53:28.000Z",
                scope: "record",
              },
            },
            { ...socrataMirror, queryOutcome: "failed" },
          ],
        },
      });

      expect(result.vintage).toBeUndefined();
    });
  });
});

describe("zoning vintage — guard symmetry and source agreement", () => {
  const mirror = (over: Record<string, unknown> = {}) => ({
    id: "chicago-arcgis-zoning",
    label: "City ArcGIS zoning",
    queryOutcome: "answered",
    datasetOutcome: "published",
    record: null,
    dataset: null,
    note: "n",
    ...over,
  });
  const vintage = (over: Record<string, unknown> = {}) => ({
    retrievedAt: "2026-08-09T00:00:00.000Z",
    comparabilityNote: "c",
    answeredBy: "chicago-arcgis-zoning",
    answerKind: "zoning",
    mirrors: [
      mirror(),
      mirror({ id: "chicago-data-portal-zoning", label: "Data Portal" }),
    ],
    ...over,
  });
  const source = {
    id: "chicago-arcgis-zoning",
    label: "City ArcGIS zoning",
    url: "https://example.org",
    retrievedAt: "2026-08-09T00:00:00.000Z",
    recordUpdatedAt: null,
  };

  it("drops a DATASET timestamp attributed to metadata the block says was never read", () => {
    // Mirror of the existing record-slot rule. Without the dataset-slot check a
    // block can publish a freshness value for an endpoint it admits it could
    // not reach — a source speaking while stating it was silent.
    const bad = vintage({
      mirrors: [
        mirror({
          datasetOutcome: "unreachable",
          dataset: { field: "rowsUpdatedAt", updatedAt: "2026-07-29T00:00:00.000Z", scope: "dataset" },
        }),
        mirror({ id: "chicago-data-portal-zoning", label: "Data Portal" }),
      ],
    });
    const out = normalizeZoningLookup({ status: "available", zoneClass: "B3-2", source, vintage: bad });
    expect("vintage" in out).toBe(false);
  });

  it("keeps a dataset timestamp when the metadata WAS published", () => {
    const good = vintage({
      mirrors: [
        mirror({
          datasetOutcome: "published",
          dataset: { field: "rowsUpdatedAt", updatedAt: "2026-07-29T00:00:00.000Z", scope: "dataset" },
        }),
        mirror({ id: "chicago-data-portal-zoning", label: "Data Portal" }),
      ],
    });
    const out = normalizeZoningLookup({ status: "available", zoneClass: "B3-2", source, vintage: good });
    expect("vintage" in out).toBe(true);
  });

  it("drops a block whose answeredBy contradicts the response's own source", () => {
    const out = normalizeZoningLookup({
      status: "available",
      zoneClass: "B3-2",
      source,
      vintage: vintage({ answeredBy: "chicago-data-portal-zoning" }),
    });
    expect("vintage" in out).toBe(false);
  });

  // The two cases below are the ones a permissive guard lets through. Naming a
  // DIFFERENT mirror (the test above) is rejected by any form of the check; a
  // block that names NO mirror, or that names the wrong FINDING, is not. Both
  // arrive only from a poisoned cache entry or an edge-cached body, which is
  // exactly why the client re-checks rather than trusting the route.

  it.each([
    [
      "publishes a zone class",
      {
        status: "available",
        zoneClass: "B3-2",
        source,
      },
    ],
    [
      "determines no zoning applies",
      {
        status: "not_found",
        zoneClass: null,
        source,
        message: "No published Chicago zoning district was returned.",
      },
    ],
  ])(
    "drops a block claiming no mirror answered from a response that %s",
    (_label, response) => {
      // answeredBy null is not a benign gap beside a classification: it is
      // provenance stating the lookup established nothing, printed under a
      // finding this same payload attributes to a named source.
      const out = normalizeZoningLookup({
        ...response,
        vintage: vintage({ answeredBy: null, answerKind: null }),
      });

      expect(out.status).toBe(response.status);
      expect("vintage" in out).toBe(false);
    },
  );

  it.each([
    [
      "a confirmed absence under a returned zone class",
      {
        status: "available",
        zoneClass: "B3-2",
        source,
      },
      "no_zoning",
    ],
    [
      "a returned polygon under a not_found determination",
      {
        status: "not_found",
        zoneClass: null,
        source,
        message: "No published Chicago zoning district was returned.",
      },
      "zoning",
    ],
  ])("drops a block reporting %s", (_label, response, answerKind) => {
    const out = normalizeZoningLookup({
      ...response,
      vintage: vintage({ answerKind }),
    });

    expect(out.status).toBe(response.status);
    expect("vintage" in out).toBe(false);
  });

  // Positive control: the two "drops" cases above would pass vacuously if the
  // not_found branch had simply stopped carrying provenance altogether.
  it("keeps a block that agrees with a not_found determination", () => {
    const out = normalizeZoningLookup({
      status: "not_found",
      zoneClass: null,
      source,
      message: "No published Chicago zoning district was returned.",
      vintage: vintage({ answerKind: "no_zoning" }),
    });

    expect(out.status).toBe("not_found");
    expect(out.vintage?.answeredBy).toBe("chicago-arcgis-zoning");
    expect(out.vintage?.mirrors).toHaveLength(2);
  });
});
