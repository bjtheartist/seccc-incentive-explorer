import { describe, expect, it, vi } from "vitest";
import {
  createDrawnAreaVacancyRequestLifecycle,
  drawnAreaVacancyRequestPath,
  fetchDrawnAreaVacancy,
  parseDrawnAreaVacancyResponse,
  vacancyCoverageDisclosure,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";

const COMPLETE_META: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-04T18:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-04T18:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-14T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-14T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 0, stale: 0, unknownDate: 0 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-15T04:38:00.000Z",
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
    caveats: [],
  },
  returnedCount: 0,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
};

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.65, 41.87],
      [-87.6, 41.87],
      [-87.6, 41.9],
      [-87.65, 41.9],
      [-87.65, 41.87],
    ],
  ],
};

function screenedFeature(
  index: number,
  licenseCheckState: "no_match" | "unavailable",
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.65 + index * 0.00001, 41.8] },
    properties: {
      id: `cols-${index}`,
      address: `${100 + index} S STATE ST`,
      source: "cols",
      status: "city_owned",
      propertyType: "vacant_land",
      canonicalType: "land",
      sourceRecordDate: null,
      freshnessClass: "unknown_date",
      explorerRefreshedAt: COMPLETE_META.explorerRefreshedAt,
      zoneMatches: [],
      incentiveCount: 0,
      licenseCheckState,
      currentLicenseMatches: [],
      licenseCheckedAt: COMPLETE_META.licenseScreening.checkedAt,
    },
  };
}

describe("drawn-area vacancy response", () => {
  it("accepts adaptive source calls while preserving root-group coverage semantics", () => {
    const features = Array.from({ length: 50 }, (_, index) =>
      screenedFeature(index, "no_match"),
    );
    const meta: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 50,
      freshness: {
        ...COMPLETE_META.freshness,
        returnedCounts: { recent: 0, stale: 0, unknownDate: 50 },
      },
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        candidateCount: 50,
        checkedCount: 50,
        sourceCallCount: 3,
        successfulBatches: 1,
      },
    };

    expect(parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features, meta }))
      .not.toBeNull();
  });

  it("accepts terminal saturation only as unavailable, never as a clean zero", () => {
    const features = [screenedFeature(0, "unavailable")];
    const meta: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 1,
      freshness: {
        ...COMPLETE_META.freshness,
        returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
      },
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        status: "unavailable",
        candidateCount: 1,
        sourceCallCount: 1,
        successfulBatches: 0,
        failedBatches: 1,
        partialReasons: ["source_batch_failure"],
      },
    };

    expect(parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features, meta }))
      .not.toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [screenedFeature(0, "no_match")],
        meta,
      }),
    ).toBeNull();
  });

  it("accepts bounded call-budget partial coverage with checked and unavailable groups", () => {
    const features = Array.from({ length: 100 }, (_, index) =>
      screenedFeature(index, index < 50 ? "no_match" : "unavailable"),
    );
    const meta: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 100,
      freshness: {
        ...COMPLETE_META.freshness,
        returnedCounts: { recent: 0, stale: 0, unknownDate: 100 },
      },
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        status: "partial",
        candidateCount: 100,
        checkedCount: 50,
        sourceCallCount: 40,
        successfulBatches: 1,
        failedBatches: 1,
        partialReasons: ["source_batch_failure"],
      },
    };

    expect(parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features, meta }))
      .not.toBeNull();
  });

  it("accepts coherent evidence across the Chicago/UTC license-day boundary", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.6, 41.8] },
      properties: {
        id: "311-clean-lot-SR21-1",
        address: "1 TEST ST",
        source: "311_clean_lot",
        status: "Completed",
        propertyType: "reported_vacant_lot",
        canonicalType: "land",
        sourceRecordDate: "2021-07-01T00:00:00.000Z",
        freshnessClass: "stale",
        explorerRefreshedAt: COMPLETE_META.explorerRefreshedAt,
        zoneMatches: [{ zoneKey: "energyCommunities", zoneName: "IRA Energy Community" }],
        incentiveCount: 1,
        licenseCheckState: "match",
        currentLicenseMatches: [
          {
            name: "Cafe",
            description: "Retail Food",
            status: "AAI",
            expirationDate: "2026-08-15",
          },
        ],
        licenseCheckedAt: COMPLETE_META.licenseScreening.checkedAt,
      },
    };
    const meta: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 1,
      freshness: {
        ...COMPLETE_META.freshness,
        returnedCounts: { recent: 0, stale: 1, unknownDate: 0 },
      },
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        candidateCount: 1,
        checkedCount: 1,
        matchedPropertyCount: 1,
        sourceCallCount: 1,
        successfulBatches: 1,
      },
    };
    expect(
      parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features: [feature], meta }),
    ).not.toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [{ ...feature, properties: { ...feature.properties, source: "new_source" } }],
        meta,
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [
          {
            ...feature,
            geometry: { type: "LineString", coordinates: [] },
          },
        ],
        meta,
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [
          {
            ...feature,
            properties: {
              ...feature.properties,
              zoneMatches: [
                { zoneKey: "tif", zoneName: "One" },
                { zoneKey: "tif", zoneName: "Duplicate" },
              ],
              incentiveCount: 2,
            },
          },
        ],
        meta,
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [
          {
            ...feature,
            properties: {
              ...feature.properties,
              propertyType: "vacant_building",
              canonicalType: "building",
            },
          },
        ],
        meta,
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [feature],
        meta: {
          ...meta,
          freshness: {
            ...meta.freshness,
            returnedCounts: { recent: 1, stale: 0, unknownDate: 0 },
          },
        },
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [feature],
        meta: {
          ...meta,
          licenseScreening: {
            ...meta.licenseScreening,
            matchedPropertyCount: 0,
          },
        },
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [
          {
            ...feature,
            properties: { ...feature.properties, freshnessClass: "recent" },
          },
        ],
        meta,
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        type: "FeatureCollection",
        features: [{ ...feature, properties: { ...feature.properties, canonicalType: "building" } }],
        meta,
      }),
    ).toBeNull();
  });

  it("accepts a feature collection only when explicit coverage metadata is valid", () => {
    const response = {
      type: "FeatureCollection",
      features: [],
      meta: COMPLETE_META,
    };
    expect(parseDrawnAreaVacancyResponse(response)).toEqual(response);
    expect(parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features: [] })).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        ...response,
        meta: { ...COMPLETE_META, coverageStatus: "unknown" },
      }),
    ).toBeNull();
    expect(parseDrawnAreaVacancyResponse({ ...response, features: null })).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        ...response,
        meta: { ...COMPLETE_META, returnedCount: 1 },
      }),
    ).toBeNull();
  });

  it.each([
    ["database source path", { ...COMPLETE_META, sourcePath: "/data/vacant-properties.json" }],
    ["database query limit", { ...COMPLETE_META, queryLimit: null }],
    ["drawn-area configured limit", { ...COMPLETE_META, configuredLimit: 500, queryLimit: 501 }],
    ["database fallback reason", { ...COMPLETE_META, fallbackReason: "database_query_failed" }],
    ["database partial status", { ...COMPLETE_META, coverageStatus: "partial" }],
    ["complete truncation flag", { ...COMPLETE_META, potentiallyTruncated: true }],
    [
      "truncated count below the limit",
      {
        ...COMPLETE_META,
        returnedCount: 9_999,
        coverageStatus: "truncated",
        potentiallyTruncated: true,
      },
    ],
    ["database as-of basis", { ...COMPLETE_META, asOfBasis: "static_export_generated_at" }],
    ["noncanonical as-of timestamp", { ...COMPLETE_META, asOf: "2026-08-04 18:00:00+00" }],
    ["invalid as-of timestamp", { ...COMPLETE_META, asOf: "not-a-timestamp" }],
  ])("rejects route-impossible %s metadata", (_case, meta) => {
    expect(
      parseDrawnAreaVacancyResponse({ type: "FeatureCollection", features: [], meta }),
    ).toBeNull();
  });

  it("accepts only coherent static fallback metadata", () => {
    const fallback: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      queryLimit: null,
      coverageStatus: "partial",
      fallbackReason: "database_query_failed",
      asOfBasis: "static_export_generated_at",
    };
    const response = { type: "FeatureCollection", features: [], meta: fallback };

    expect(parseDrawnAreaVacancyResponse(response)).toEqual(response);
    expect(
      parseDrawnAreaVacancyResponse({
        ...response,
        meta: { ...fallback, fallbackReason: null },
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        ...response,
        meta: { ...fallback, coverageStatus: "complete" },
      }),
    ).toBeNull();
    expect(
      parseDrawnAreaVacancyResponse({
        ...response,
        meta: { ...fallback, sourcePath: "database:vacant_properties" },
      }),
    ).toBeNull();
  });

  it("discloses partial fallback and truncation without describing a clean zero", () => {
    const partial = vacancyCoverageDisclosure({
      ...COMPLETE_META,
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOfBasis: "static_export_generated_at",
      queryLimit: null,
      coverageStatus: "partial",
      fallbackReason: "database_query_failed",
    });
    expect(partial).toContain("results are partial");
    expect(partial).toContain("primary database query failed");
    expect(partial).toContain("does not establish that no tracked vacancy exists");

    const truncated = vacancyCoverageDisclosure({
      ...COMPLETE_META,
      returnedCount: 10_000,
      coverageStatus: "truncated",
      potentiallyTruncated: true,
    });
    expect(truncated).toContain("10,000-record response limit");
    expect(vacancyCoverageDisclosure(COMPLETE_META)).toBeNull();
  });
});

describe("drawn-area vacancy fetch", () => {
  it("builds the polygon request and returns a validated result", async () => {
    const response = { type: "FeatureCollection", features: [], meta: COMPLETE_META };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchDrawnAreaVacancy(POLYGON, { fetchImpl })).resolves.toEqual(response);
    const url = new URL(drawnAreaVacancyRequestPath(POLYGON), "http://localhost");
    expect(url.pathname).toBe("/api/vacant");
    expect(JSON.parse(url.searchParams.get("polygon") ?? "")).toEqual(POLYGON);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("relays cancellation and times out without invalidating the caller signal", async () => {
    const abortingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const caller = new AbortController();
    const cancelled = fetchDrawnAreaVacancy(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      signal: caller.signal,
      timeoutMs: 1_000,
    });
    caller.abort(new DOMException("Polygon removed", "AbortError"));
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const currentRequest = new AbortController();
    const timedOut = fetchDrawnAreaVacancy(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      signal: currentRequest.signal,
      timeoutMs: 5,
    });
    await expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
    expect(currentRequest.signal.aborted).toBe(false);
  });

  it("clears the timeout after a successful response", async () => {
    vi.useFakeTimers();
    try {
      const response = { type: "FeatureCollection", features: [], meta: COMPLETE_META };
      let requestSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      await expect(
        fetchDrawnAreaVacancy(POLYGON, {
          fetchImpl: fetchImpl as typeof fetch,
          timeoutMs: 25,
        }),
      ).resolves.toEqual(response);
      await vi.advanceTimersByTimeAsync(25);
      expect(requestSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("drawn-area vacancy request lifecycle", () => {
  it("allows only the latest polygon response to publish", async () => {
    const lifecycle = createDrawnAreaVacancyRequestLifecycle();
    const polygonA = deferred<string>();
    const polygonB = deferred<string>();
    const published: string[] = [];

    const requestA = lifecycle.start();
    const completionA = polygonA.promise
      .then((value) => {
        if (requestA.isCurrent()) published.push(value);
      })
      .finally(requestA.release);

    const requestB = lifecycle.start();
    const completionB = polygonB.promise
      .then((value) => {
        if (requestB.isCurrent()) published.push(value);
      })
      .finally(requestB.release);

    expect(requestA.signal.aborted).toBe(true);
    polygonB.resolve("polygon B");
    await completionB;
    polygonA.resolve("polygon A");
    await completionA;

    expect(published).toEqual(["polygon B"]);
  });

  it("invalidates a deleted polygon even when its request resolves after abort", async () => {
    const lifecycle = createDrawnAreaVacancyRequestLifecycle();
    const delayed = deferred<string>();
    const published: string[] = [];
    const request = lifecycle.start();
    const completion = delayed.promise
      .then((value) => {
        if (request.isCurrent()) published.push(value);
      })
      .finally(request.release);

    lifecycle.cancel();
    expect(request.signal.aborted).toBe(true);
    delayed.resolve("deleted polygon");
    await completion;

    expect(request.isCurrent()).toBe(false);
    expect(published).toEqual([]);
  });
});
