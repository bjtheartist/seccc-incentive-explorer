import { describe, expect, it } from "vitest";
import {
  decodeSiteMatchmakerVacancyHandoff,
  prefilterVacancyRecords,
} from "@/lib/site-matchmaker-vacancy";
import type { SiteMatchCriteria } from "@/lib/site-matchmaker";
import type { VacancyPropertyType } from "@/lib/vacancy-index";

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

  it("keeps only existing buildings inside the published footprint range", () => {
    const result = prefilterVacancyRecords(
      records,
      criteria({ minSquareFeet: 1_500, maxSquareFeet: 5_000 }),
      selectors,
    );

    expect(result.records.map((record) => record.id)).toEqual(["building-in-range"]);
    expect(result).toMatchObject({
      loadedCount: 5,
      keptCount: 1,
      propertyUniverseCount: 3,
      omittedPropertyTypeCount: 2,
      omittedUnknownSizeCount: 1,
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
    expect(result.omittedUnknownSizeCount).toBe(0);
  });

  it("treats either as both published property types and omits unknown sizes", () => {
    const result = prefilterVacancyRecords(
      records,
      criteria({ propertyType: "either", maxSquareFeet: 3_500 }),
      selectors,
    );

    expect(result.records.map((record) => record.id)).toEqual([
      "building-in-range",
      "building-too-small",
    ]);
    expect(result.omittedUnknownSizeCount).toBe(1);
    expect(result.omittedOutsideFootprintCount).toBe(1);
    expect(result.omittedPropertyTypeCount).toBe(1);
  });
});
