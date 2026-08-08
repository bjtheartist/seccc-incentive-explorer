import { describe, expect, it } from "vitest";
import {
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
