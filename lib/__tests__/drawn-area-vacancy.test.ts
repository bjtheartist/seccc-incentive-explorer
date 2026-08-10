import { describe, expect, it } from "vitest";
import {
  createDrawnAreaVacancyRequestLifecycle,
  parseDrawnAreaVacancyResponse,
  vacancyCoverageDisclosure,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";

const COMPLETE_META: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-04T18:00:00.000Z",
  asOfBasis: "latest_queried_row_updated_at",
  returnedCount: 0,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
};

describe("drawn-area vacancy response", () => {
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
