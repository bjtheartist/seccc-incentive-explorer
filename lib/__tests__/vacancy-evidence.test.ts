import { describe, expect, it } from "vitest";
import {
  buildVacancyFreshnessMetadata,
  canonicalVacancyType,
  chicagoCalendarDay,
  classifyVacancyFreshness,
  includeVacancyForFreshnessFilter,
  normalizeChicagoSourceCalendarDate,
  vacancyFreshnessCutoff,
} from "@/lib/vacancy-evidence";

const REFERENCE = "2026-08-14T12:00:00.000Z";

function feature(properties: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.6, 41.8] },
    properties,
  };
}

describe("vacancy evidence semantics", () => {
  it("uses the Chicago civil day across the UTC/local-midnight boundary", () => {
    expect(chicagoCalendarDay("2026-08-15T04:38:00.000Z")).toBe("2026-08-14");
    expect(chicagoCalendarDay("2026-08-15T05:01:00.000Z")).toBe("2026-08-15");
  });

  it("preserves a timezone-less late-evening 311 source calendar day", () => {
    expect(
      normalizeChicagoSourceCalendarDate("2026-08-13T22:30:05.000"),
    ).toBe("2026-08-13T00:00:00.000Z");
    expect(normalizeChicagoSourceCalendarDate("2026-02-30T22:30:05.000")).toBeNull();
    expect(normalizeChicagoSourceCalendarDate("not-a-date")).toBeNull();
  });

  it("classifies original source dates at the shared three-year cutoff", () => {
    expect(vacancyFreshnessCutoff(REFERENCE)).toBe("2023-08-14T12:00:00.000Z");
    expect(classifyVacancyFreshness("2026-01-01", REFERENCE)).toBe("recent");
    expect(classifyVacancyFreshness("2023-08-14T12:00:00.000Z", REFERENCE)).toBe(
      "recent",
    );
    expect(classifyVacancyFreshness("2023-08-14T11:59:59.999Z", REFERENCE)).toBe(
      "stale",
    );
    expect(classifyVacancyFreshness(null, REFERENCE)).toBe("unknown_date");
    expect(classifyVacancyFreshness("not-a-date", REFERENCE)).toBe("unknown_date");
  });

  it("canonicalizes every production property type without losing clean lots", () => {
    expect(canonicalVacancyType("vacant_land")).toBe("land");
    expect(canonicalVacancyType("reported_vacant_lot")).toBe("land");
    expect(canonicalVacancyType("vacant_building")).toBe("building");
    expect(canonicalVacancyType("vacant_storefront")).toBe("storefront");
    expect(canonicalVacancyType("future_type")).toBe("other");
  });

  it("keeps stale and unknown evidence discoverable but out of recent defaults", () => {
    const recent = feature({ source: "dpd_vacant", freshnessClass: "recent" });
    const stale = feature({ source: "311_clean_lot", freshnessClass: "stale" });
    const inventory = feature({
      source: "cols",
      status: "city_owned",
      freshnessClass: "unknown_date",
    });

    expect(includeVacancyForFreshnessFilter(recent, "current_screening")).toBe(true);
    expect(includeVacancyForFreshnessFilter(stale, "current_screening")).toBe(false);
    expect(includeVacancyForFreshnessFilter(inventory, "current_screening")).toBe(true);
    expect(includeVacancyForFreshnessFilter(recent, "recent_reports")).toBe(true);
    expect(includeVacancyForFreshnessFilter(inventory, "recent_reports")).toBe(false);
    expect(includeVacancyForFreshnessFilter(stale, "all_records")).toBe(true);
    expect(includeVacancyForFreshnessFilter(inventory, "all_records")).toBe(true);
  });

  it("treats only current COLS holdings and CCLBA public inventory as current", () => {
    const held = feature({
      source: "cols",
      propertyStatus: "Owned by City",
      freshnessClass: "unknown_date",
    });
    const sold = feature({
      source: "cols",
      propertyStatus: "Sold",
      status: "city_owned",
      freshnessClass: "unknown_date",
    });
    const unknown = feature({
      source: "cols",
      propertyStatus: null,
      status: "city_owned",
      freshnessClass: "unknown_date",
    });
    const landBank = feature({
      source: "cclba",
      freshnessClass: "unknown_date",
    });
    expect(includeVacancyForFreshnessFilter(held, "current_screening")).toBe(true);
    expect(includeVacancyForFreshnessFilter(sold, "current_screening")).toBe(false);
    expect(includeVacancyForFreshnessFilter(unknown, "current_screening")).toBe(false);
    expect(includeVacancyForFreshnessFilter(landBank, "current_screening")).toBe(true);
  });

  it("publishes coherent returned-set counts", () => {
    const metadata = buildVacancyFreshnessMetadata(
      [
        feature({ freshnessClass: "recent" }),
        feature({ freshnessClass: "stale" }),
        feature({ freshnessClass: "unknown_date" }),
      ],
      REFERENCE,
    );
    expect(metadata).toMatchObject({
      policyVersion: "source-record-date-v1",
      referenceDate: REFERENCE,
      cutoffDate: "2023-08-14T12:00:00.000Z",
      returnedCounts: { recent: 1, stale: 1, unknownDate: 1 },
    });
  });
});
