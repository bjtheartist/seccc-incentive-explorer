import { describe, expect, it } from "vitest";
import {
  assertStaticFallbackCclbaPublication,
  normalizeStaticFallbackTimestamp,
  STATIC_FALLBACK_LIMIT,
  STATIC_FALLBACK_TYPE_QUOTAS,
  staticFallbackReservedCount,
} from "@/lib/vacancy-static-fallback";

const COVERAGE = {
  status: "available" as const,
  source: "cclba" as const,
  sourceDatasetId: "epropertyplus-published-properties" as const,
  sourceUrl: "https://public-cclba.epropertyplus.com/" as const,
  publishedCountyTotal: 3,
  chicagoTotal: 2,
  locatedChicagoTotal: 2,
  unlocatedChicagoTotal: 0,
  sourceAsOf: null,
  retrievedAt: "2026-08-27T13:16:50.978Z",
};

function cclbaRow(sourceRowId: string) {
  return {
    id: `cclba-${sourceRowId}`,
    source: "cclba",
    source_row_id: sourceRowId,
    source_dataset_id: "epropertyplus-published-properties",
    source_url: "https://public-cclba.epropertyplus.com/",
    source_retrieved_at: "2026-08-27 13:16:50.978+00",
  };
}

describe("vacancy static fallback representation", () => {
  it("reserves deterministic capacity for every published evidence class", () => {
    expect(STATIC_FALLBACK_TYPE_QUOTAS).toEqual({
      vacant_land: 600,
      reported_vacant_lot: 600,
      vacant_building: 600,
      vacant_storefront: 100,
    });
    expect(Object.values(STATIC_FALLBACK_TYPE_QUOTAS).every((quota) => quota > 0)).toBe(
      true,
    );
    expect(staticFallbackReservedCount()).toBeLessThan(STATIC_FALLBACK_LIMIT);
  });

  it("canonicalizes the Postgres timestamp shape before coverage validation", () => {
    expect(
      normalizeStaticFallbackTimestamp("2026-08-27 13:16:50.978+00"),
    ).toBe("2026-08-27T13:16:50.978Z");
  });

  it("requires every located CCLBA row in the bounded fallback", () => {
    expect(() =>
      assertStaticFallbackCclbaPublication(
        [cclbaRow("1002952"), cclbaRow("1002953")],
        COVERAGE,
      ),
    ).not.toThrow();

    expect(() =>
      assertStaticFallbackCclbaPublication([cclbaRow("1002952")], COVERAGE),
    ).toThrow("selected 1 of 2 located CCLBA rows");

    expect(() =>
      assertStaticFallbackCclbaPublication(
        [cclbaRow("1002952")],
        {
          status: "unavailable",
          source: "cclba",
          sourceDatasetId: "epropertyplus-published-properties",
          sourceUrl: "https://public-cclba.epropertyplus.com/",
          reason: "malformed_metadata",
        },
      ),
    ).toThrow("without available source coverage");
  });

  it("rejects detached or duplicate CCLBA provenance", () => {
    expect(() =>
      assertStaticFallbackCclbaPublication(
        [cclbaRow("1002952"), cclbaRow("1002952")],
        COVERAGE,
      ),
    ).toThrow("duplicate CCLBA identities");

    expect(() =>
      assertStaticFallbackCclbaPublication(
        [
          cclbaRow("1002952"),
          { ...cclbaRow("1002953"), source_url: "https://example.com" },
        ],
        COVERAGE,
      ),
    ).toThrow("provenance contract failed");

    expect(() =>
      assertStaticFallbackCclbaPublication(
        [
          cclbaRow("1002952"),
          {
            ...cclbaRow("1002953"),
            source_retrieved_at: "2026-08-26 13:16:50.978+00",
          },
        ],
        COVERAGE,
      ),
    ).toThrow("retrieval snapshot drifted");
  });
});
