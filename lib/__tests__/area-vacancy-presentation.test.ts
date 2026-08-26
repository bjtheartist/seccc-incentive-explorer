import { describe, expect, it } from "vitest";
import {
  filterAreaVacancyFeatures,
  isOfficialCclbaPublishedInventorySource,
  summarizeAreaVacancyTypes,
  vacancySourceLabel,
} from "@/lib/area-vacancy-presentation";

function feature(properties: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.6, 41.8] },
    properties,
  };
}

describe("drawn-area vacancy presentation", () => {
  it("keeps the type breakdown equal to total for actual and unknown types", () => {
    const counts = summarizeAreaVacancyTypes([
      feature({ propertyType: "vacant_land" }),
      feature({ propertyType: "reported_vacant_lot" }),
      feature({ propertyType: "vacant_building" }),
      feature({ propertyType: "vacant_storefront" }),
      feature({ propertyType: "new_upstream_type" }),
    ]);
    expect(counts).toEqual({
      land: 2,
      building: 1,
      storefront: 1,
      other: 1,
      total: 5,
    });
    expect(counts.land + counts.building + counts.storefront + counts.other).toBe(
      counts.total,
    );
  });

  it("applies freshness and license-conflict filters without hiding City inventory", () => {
    const features = [
      feature({ source: "cols", status: "city_owned", freshnessClass: "unknown_date", licenseCheckState: "no_match" }),
      feature({ source: "dpd_vacant", freshnessClass: "recent", licenseCheckState: "match" }),
      feature({ source: "311_clean_lot", freshnessClass: "stale", licenseCheckState: "match" }),
    ];
    expect(filterAreaVacancyFeatures(features, "current_screening", "all")).toHaveLength(2);
    expect(filterAreaVacancyFeatures(features, "current_screening", "conflicts")).toHaveLength(1);
    expect(filterAreaVacancyFeatures(features, "all_records", "conflicts")).toHaveLength(2);
  });

  it("labels a source-only CCLBA row neutrally, not as loaded inventory", () => {
    expect(vacancySourceLabel("cclba")).toBe(
      "Cook County Land Bank Authority public record",
    );
  });

  it("uses the official inventory label only for a proved official row", () => {
    expect(
      vacancySourceLabel("cclba", {
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
        sourceUrl: "https://public-cclba.epropertyplus.com/",
      }),
    ).toBe("Cook County Land Bank Authority Published Property Inventory");
    expect(
      vacancySourceLabel("cclba", {
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
      }),
    ).toBe("Cook County Land Bank Authority public record");
  });

  it("requires both the official dataset id and exact HTTPS portal URL", () => {
    expect(isOfficialCclbaPublishedInventorySource({ source: "cclba" })).toBe(false);
    expect(
      isOfficialCclbaPublishedInventorySource({
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
      }),
    ).toBe(false);
    expect(
      isOfficialCclbaPublishedInventorySource({
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
        sourceUrl: "http://public-cclba.epropertyplus.com/",
      }),
    ).toBe(false);
    expect(
      isOfficialCclbaPublishedInventorySource({
        source: "cclba",
        sourceDatasetId: "epropertyplus-published-properties",
        sourceUrl: "https://public-cclba.epropertyplus.com/",
      }),
    ).toBe(true);
  });
});
