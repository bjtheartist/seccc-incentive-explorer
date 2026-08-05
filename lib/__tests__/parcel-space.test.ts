import { describe, expect, it } from "vitest";
import {
  compactParcelSpaceFacts,
  currentParcelSpaceFacts,
  replaceAvailableSpaceFacts,
  siteMatchAreaForProperty,
  vacancySpaceFacts,
} from "../parcel-space";

describe("parcel space facts", () => {
  it("keeps the four source measurements separate and removes non-positive values", () => {
    expect(
      compactParcelSpaceFacts({
        lotAreaSqft: 10_000.4,
        assessorBuildingSqft: 8_000,
        cityGroundFootprintSqft: 4_250,
        availableSpaceSqft: 2_000,
        assessorBuildingYear: 2024,
      }),
    ).toEqual({
      lotAreaSqft: 10_000,
      assessorBuildingSqft: 8_000,
      cityGroundFootprintSqft: 4_250,
      availableSpaceSqft: 2_000,
      assessorBuildingYear: 2024,
    });
    expect(compactParcelSpaceFacts({ lotAreaSqft: 0, assessorBuildingSqft: -1 })).toBeUndefined();
  });

  it("does not expose a positive source sliver as zero square feet", () => {
    expect(compactParcelSpaceFacts({ cityGroundFootprintSqft: 0.49 })).toBeUndefined();
    expect(compactParcelSpaceFacts({ cityGroundFootprintSqft: 0.5 })).toEqual({
      cityGroundFootprintSqft: 1,
    });
  });

  it("uses a legacy square-foot field only as vacant-land lot area", () => {
    expect(vacancySpaceFacts("vacant_land", undefined, 6_000)).toEqual({ lotAreaSqft: 6_000 });
    expect(vacancySpaceFacts("vacant_building", undefined, 6_000)).toBeUndefined();
  });

  it("merges a legacy land area when another new space fact is already present", () => {
    expect(
      vacancySpaceFacts(
        "vacant_land",
        { cityGroundFootprintSqft: 1_250 },
        6_000,
      ),
    ).toEqual({ lotAreaSqft: 6_000, cityGroundFootprintSqft: 1_250 });
    expect(
      vacancySpaceFacts("vacant_land", { lotAreaSqft: 7_000 }, 6_000),
    ).toEqual({ lotAreaSqft: 7_000 });
  });

  it("does not treat assessor or ground-footprint area as available building space", () => {
    const descriptiveOnly = {
      assessorBuildingSqft: 12_000,
      cityGroundFootprintSqft: 5_500,
    };
    expect(siteMatchAreaForProperty("vacant_building", descriptiveOnly)).toEqual({
      kind: "verified_available_space",
      sqft: null,
    });
    expect(
      siteMatchAreaForProperty("vacant_building", {
        ...descriptiveOnly,
        availableSpaceSqft: 2_500,
        availableSpaceSource: "Owner confirmation",
        availableSpaceVerifiedAt: "2026-08-01T00:00:00.000Z",
        availableSpaceReconfirmAfter: "2099-01-01T00:00:00.000Z",
      }),
    ).toEqual({ kind: "verified_available_space", sqft: 2_500 });
  });

  it("treats stale or undated reported availability as unknown", () => {
    expect(
      siteMatchAreaForProperty("vacant_building", { availableSpaceSqft: 2_500 }),
    ).toEqual({ kind: "verified_available_space", sqft: null });
    expect(
      siteMatchAreaForProperty("vacant_building", {
        availableSpaceSqft: 2_500,
        availableSpaceReconfirmAfter: "2020-01-01T00:00:00.000Z",
      }),
    ).toEqual({ kind: "verified_available_space", sqft: null });
  });

  it("removes the complete public availability bundle when verification expires", () => {
    expect(
      currentParcelSpaceFacts(
        {
          assessorBuildingSqft: 8_000,
          availableSpaceSqft: 2_500,
          availableSpaceSource: "Owner confirmation",
          availableSpaceVerifiedAt: "2026-04-01T00:00:00.000Z",
          availableSpaceReconfirmAfter: "2026-07-01T00:00:00.000Z",
        },
        new Date("2026-08-05T00:00:00.000Z"),
      ),
    ).toEqual({ assessorBuildingSqft: 8_000 });
  });

  it("clears an absent authoritative availability record without losing public-record facts", () => {
    expect(
      replaceAvailableSpaceFacts(
        {
          lotAreaSqft: 10_000,
          availableSpaceSqft: 2_500,
          availableSpaceSource: "Owner confirmation",
          availableSpaceVerifiedAt: "2026-08-01T00:00:00.000Z",
          availableSpaceReconfirmAfter: "2026-09-01T00:00:00.000Z",
        },
        null,
      ),
    ).toEqual({ lotAreaSqft: 10_000 });
  });

  it("uses lot area for land even when a building-area record is also present", () => {
    expect(
      siteMatchAreaForProperty("vacant_land", {
        lotAreaSqft: 9_000,
        assessorBuildingSqft: 3_000,
      }),
    ).toEqual({ kind: "lot_area", sqft: 9_000 });
  });
});
