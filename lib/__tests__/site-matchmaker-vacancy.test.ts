import { describe, expect, it } from "vitest";
import {
  applyCurrentAvailableSpaceToSitePoints,
  decodeSiteMatchmakerVacancyHandoff,
  prefilterVacancyRecords,
} from "@/lib/site-matchmaker-vacancy";
import type { SiteMatchCriteria } from "@/lib/site-matchmaker";
import { siteMatchAreaForProperty, vacancySpaceFacts } from "@/lib/parcel-space";
import type { VacancyPropertyType, VacancySitePoint } from "@/lib/vacancy-index";

interface RecordStub {
  id: string;
  propertyType: VacancyPropertyType | null;
  squareFeet: number | null;
}

function criteria(overrides: Partial<SiteMatchCriteria> = {}): SiteMatchCriteria {
  return {
    zip: "60617",
    projectUse: "retail-service",
    propertyType: "existing-building",
    minSquareFeet: null,
    maxSquareFeet: null,
    context: "commercial-corridor",
    transportation: ["cta-bus"],
    transportationDistance: "half-mile",
    walkability: "important",
    pedestrianActivity: "preferred",
    amenities: ["grocery"],
    ...overrides,
  };
}

const selectors = {
  propertyType: (record: RecordStub) => record.propertyType,
  squareFeet: (record: RecordStub) => record.squareFeet,
};

describe("Site Matchmaker vacancy handoff", () => {
  it("decodes a ready, canonical handoff using the route ZIP", () => {
    const handoff = decodeSiteMatchmakerVacancyHandoff(
      "60617",
      new URLSearchParams(
        "source=site-matchmaker&sm_v=1&sm_use=retail-service&sm_property=existing-building&sm_min_sqft=1500&sm_max_sqft=5000&sm_context=commercial-corridor&sm_transport=cta-bus&sm_transport_distance=half-mile&sm_walkability=important&sm_pedestrian_activity=preferred&sm_amenities=grocery",
      ),
    );

    expect(handoff).toMatchObject({
      criteria: {
        zip: "60617",
        projectUse: "retail-service",
        propertyType: "existing-building",
        minSquareFeet: 1_500,
        maxSquareFeet: 5_000,
      },
      footprintBoundActive: true,
    });
    expect(handoff?.summary.propertyType).toBe("Existing building");
    expect(handoff?.summary.transportationDistance).toBe("Within 1/2 mile");
    expect(handoff?.summary.walkability).toBe("Important");
    expect(handoff?.summary.pedestrianActivity).toBe("Preferred");
  });

  it("does not activate for ordinary map URLs, aliases, or incomplete criteria", () => {
    expect(
      decodeSiteMatchmakerVacancyHandoff(
        "60617",
        new URLSearchParams("sm_use=retail-service&sm_property=existing-building"),
      ),
    ).toBeNull();
    expect(
      decodeSiteMatchmakerVacancyHandoff(
        "60617",
        new URLSearchParams(
          "source=site-matchmaker&project=retail-service&propertyType=existing-building",
        ),
      ),
    ).toBeNull();
    expect(
      decodeSiteMatchmakerVacancyHandoff(
        "60617",
        new URLSearchParams("source=site-matchmaker&sm_use=retail-service"),
      ),
    ).toBeNull();
  });
});

describe("supported vacancy prefilter", () => {
  const records: RecordStub[] = [
    { id: "building-in-range", propertyType: "vacant_building", squareFeet: 3_000 },
    { id: "building-too-small", propertyType: "vacant_building", squareFeet: 900 },
    { id: "building-size-unknown", propertyType: "vacant_building", squareFeet: null },
    { id: "land-in-range", propertyType: "vacant_land", squareFeet: 4_000 },
    { id: "unknown-type", propertyType: null, squareFeet: 4_000 },
  ];

  it("keeps in-range and unassessed buildings while omitting known out-of-range records", () => {
    const result = prefilterVacancyRecords(
      records,
      criteria({ minSquareFeet: 1_500, maxSquareFeet: 5_000 }),
      selectors,
    );

    expect(result.records.map((record) => record.id)).toEqual([
      "building-in-range",
      "building-size-unknown",
    ]);
    expect(result).toMatchObject({
      loadedCount: 5,
      keptCount: 2,
      propertyUniverseCount: 3,
      omittedPropertyTypeCount: 2,
      unassessedUnknownSizeCount: 1,
      confirmedFootprintCount: 1,
      omittedOutsideFootprintCount: 1,
    });
  });

  it("keeps vacant land with unpublished size when no footprint bound is active", () => {
    const result = prefilterVacancyRecords(
      [
        { id: "known-land", propertyType: "vacant_land", squareFeet: 4_000 },
        { id: "unknown-land", propertyType: "vacant_land", squareFeet: null },
        { id: "building", propertyType: "vacant_building", squareFeet: 4_000 },
      ],
      criteria({ propertyType: "vacant-land" }),
      selectors,
    );

    expect(result.records.map((record) => record.id)).toEqual(["known-land", "unknown-land"]);
    expect(result.unassessedUnknownSizeCount).toBe(0);
  });

  it("treats either as both published property types and keeps unknown sizes unassessed", () => {
    const result = prefilterVacancyRecords(
      records,
      criteria({ propertyType: "either", maxSquareFeet: 3_500 }),
      selectors,
    );

    expect(result.records.map((record) => record.id)).toEqual([
      "building-in-range",
      "building-too-small",
      "building-size-unknown",
    ]);
    expect(result.unassessedUnknownSizeCount).toBe(1);
    expect(result.confirmedFootprintCount).toBe(2);
    expect(result.omittedOutsideFootprintCount).toBe(1);
    expect(result.omittedPropertyTypeCount).toBe(1);
  });

  it("applies live verified space before deciding which building pins remain plotted", () => {
    const point: VacancySitePoint = {
      lat: 41.73,
      lon: -87.55,
      ownerType: "corporate_llc",
      propertyType: "vacant_building",
      markerNumber: null,
      address: "100 E MAIN ST",
      pin: "20-12-345-678-9012",
      squareFeet: null,
      space: { assessorBuildingSqft: 9_000 },
      zoningClass: "B3-2",
      incentiveCount: 2,
      ownerConfidence: "inferred",
      clusterId: null,
      saleYear: null,
      violation: false,
      ownerStructure: "entity",
      ownerGeography: "in_state",
      pinMatch: "address_matched",
    };
    const refreshed = applyCurrentAvailableSpaceToSitePoints(
      [point],
      [
        {
          pin: "20123456789012",
          availableSpaceSqft: 900,
          source: "Owner confirmation",
          verifiedAt: "2026-08-01T00:00:00.000Z",
          reconfirmAfter: "2099-01-01T00:00:00.000Z",
        },
      ],
      true,
    );
    const result = prefilterVacancyRecords(
      refreshed,
      criteria({ minSquareFeet: 1_500, maxSquareFeet: 5_000 }),
      {
        propertyType: (record) => record.propertyType,
        squareFeet: (record) =>
          siteMatchAreaForProperty(
            record.propertyType,
            vacancySpaceFacts(record.propertyType, record.space, record.squareFeet),
          ).sqft,
      },
    );

    expect(refreshed[0].space?.availableSpaceSqft).toBe(900);
    expect(result.records).toEqual([]);
    expect(result.omittedOutsideFootprintCount).toBe(1);
    expect(result.unassessedUnknownSizeCount).toBe(0);
  });
});
