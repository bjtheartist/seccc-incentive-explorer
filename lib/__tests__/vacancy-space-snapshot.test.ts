import { describe, expect, it } from "vitest";
import type { VacancyIndexExport } from "../vacancy-index";
import {
  assertVacancySpaceOnlyChange,
  assertVacancySpacePayloadBudget,
  buildParcelSpaceFactsByPin,
  overlayVacancySpaceFacts,
  VACANCY_SPACE_SOURCE_LABELS,
} from "../vacancy-space-snapshot";

function fixture(): VacancyIndexExport {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    sources: {
      trackedInventory: "inventory",
      vacantLandOwnership: "ownership",
      corridorMetrics: "corridors",
      zipBoundaries: "boundaries",
      transportNetwork: "transport",
      asOf: "2026-08-01",
    },
    editions: {
      "60617": {
        zip: "60617",
        neighborhood: "South Chicago",
        secondaryAreas: [],
        editionNumber: 1,
        headline: {
          vacantPropertyCount: 2,
          vacantLandCount: 1,
          vacantBuildingCount: 1,
          cityOwnedCount: 1,
          inIncentiveZoneCount: 2,
        },
        ownership: {
          vacantLandParcelsByOwnerType: null,
          vacantLandParcelTotal: null,
          trackedInventoryByOwnerType: [],
          reconciledVacantLandByOwnerType: null,
          reconciliation: null,
          structureBreakdown: null,
        },
        distress: { taxSaleExposedCount: 1, latestTaxSaleYear: 2015, violationMatchCount: 2 },
        exemptionAnomalies: null,
        sitePoints: [
          {
            lat: 41.7,
            lon: -87.5,
            ownerType: "city_public",
            propertyType: "vacant_land",
            markerNumber: 1,
            address: "1 TEST ST",
            pin: "21-32-211-039-0000",
            squareFeet: 12000,
            zoningClass: "C1-1",
            incentiveCount: 2,
            ownerConfidence: "pin_matched",
            clusterId: 1,
            saleYear: 2015,
            violation: false,
            ownerStructure: "government",
            ownerGeography: "in_state",
            pinMatch: "inventory",
          },
          {
            lat: 41.71,
            lon: -87.51,
            ownerType: "unknown",
            propertyType: "vacant_building",
            markerNumber: null,
            address: "2 TEST ST",
            pin: null,
            squareFeet: null,
            zoningClass: null,
            incentiveCount: 0,
            ownerConfidence: "needs_verification",
            clusterId: null,
            saleYear: null,
            violation: true,
            ownerStructure: "unresolved",
            ownerGeography: "unknown",
            pinMatch: "unmatched",
          },
        ],
        sitePointsTruncated: false,
        siteIndex: [],
        landPoints: [
          {
            lat: 41.7,
            lon: -87.5,
            ownerType: "city_public",
            address: "1 TEST ST",
            pin: "21322110390000",
            squareFeet: 12000,
            ownerConfidence: "pin_matched",
            saleYear: 2015,
            ownerStructure: "government",
            ownerGeography: "in_state",
          },
        ],
        landPointsTruncated: false,
        landPointsTotal: 1,
        directoryCount: 2,
        buildingPinMatch: null,
        boundary: null,
        centroid: { lat: 41.7, lon: -87.5 },
        transport: [],
        clusters: [],
        clustersNote: "source method",
        corridors: [],
        anchors: null,
      },
    },
    matrix: [],
  };
}

describe("vacancy space snapshot", () => {
  it("builds four separate fields and accepts available space only while verified and current", () => {
    const facts = buildParcelSpaceFactsByPin(
      [
        { pin: "21322110390000", metric: "lot_area", sqft: "12027.4", source_key: "county", source_year: 2024, verification_status: "published", measurement_scope: null, is_active: true, verified_at: null, reconfirm_after: null },
        { pin: "21322110390000", metric: "assessor_building_area", sqft: 5000, source_key: "county", source_year: "2024", verification_status: "published", measurement_scope: null, is_active: true, verified_at: null, reconfirm_after: null },
        { pin: "21322110390000", metric: "city_ground_footprint", sqft: 2500, source_key: "city", source_year: 2015, verification_status: "computed", measurement_scope: null, is_active: true, verified_at: null, reconfirm_after: null },
        { pin: "21322110390000", metric: "available_space", sqft: 2000, source_key: "owner_confirmation", source_year: 2026, verification_status: "verified", measurement_scope: "largest_contiguous_usable_interior_space", is_active: true, verified_at: "2026-08-01T00:00:00Z", reconfirm_after: "2026-09-01T00:00:00Z" },
        { pin: "20363230080000", metric: "available_space", sqft: 9999, source_key: "owner_confirmation", source_year: 2026, verification_status: "verified", measurement_scope: "largest_contiguous_usable_interior_space", is_active: true, verified_at: "2026-06-01T00:00:00Z", reconfirm_after: "2026-07-01T00:00:00Z" },
      ],
      new Date("2026-08-05T00:00:00Z"),
    );

    expect(facts.get("21322110390000")).toEqual({
      lotAreaSqft: 12027,
      assessorBuildingSqft: 5000,
      assessorBuildingYear: 2024,
      cityGroundFootprintSqft: 2500,
      cityGroundFootprintVintage: "Current as of August 2015",
      availableSpaceSqft: 2000,
      availableSpaceSource: "Owner confirmation",
      availableSpaceVerifiedAt: "2026-08-01T00:00:00.000Z",
      availableSpaceReconfirmAfter: "2026-09-01T00:00:00.000Z",
    });
    expect(facts.has("20363230080000")).toBe(false);
  });

  it("overlays exact string PINs only while preserving every other field", () => {
    const before = fixture();
    const facts = new Map([
      ["21322110390000", { lotAreaSqft: 12027, cityGroundFootprintSqft: 2400 }],
    ]);
    const { data, summary } = overlayVacancySpaceFacts(before, facts);

    expect(data.editions["60617"].sitePoints[0].space).toEqual(facts.get("21322110390000"));
    expect(data.editions["60617"].landPoints?.[0].space).toEqual(facts.get("21322110390000"));
    expect(data.editions["60617"].sitePoints[1].space).toBeUndefined();
    expect(data.editions["60617"].distress).toEqual(before.editions["60617"].distress);
    expect(data.sources).toMatchObject(VACANCY_SPACE_SOURCE_LABELS);
    expect(summary).toMatchObject({ siteRowsEnriched: 1, landRowsEnriched: 1, uniqueEnrichedPins: 1 });
    expect(() => assertVacancySpaceOnlyChange(before, data)).not.toThrow();
  });

  it("fails closed on unrelated changes and excessive payload growth", () => {
    const before = fixture();
    const { data } = overlayVacancySpaceFacts(before, new Map());
    const changed = structuredClone(data);
    changed.editions["60617"].headline.vacantPropertyCount = 99;
    expect(() => assertVacancySpaceOnlyChange(before, changed)).toThrow(/outside/);
    expect(() => assertVacancySpacePayloadBudget(before, data, 0.35)).not.toThrow();

    const bloated = structuredClone(data);
    bloated.editions["60617"].sitePoints[0].space = {
      availableSpaceSource: "x".repeat(10000),
    };
    expect(() => assertVacancySpacePayloadBudget(before, bloated, 0.35)).toThrow(/grew/);
  });
});
