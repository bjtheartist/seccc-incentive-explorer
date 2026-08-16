import { describe, expect, it } from "vitest";
import {
  isChicagoParcelCoordinate,
  parcelAddressesMatch,
  parseCandidateParcelResolution,
} from "../site-matchmaker-parcel-resolution";

const checkedAt = "2026-08-15T20:00:00.000Z";

describe("parcel resolution contract", () => {
  it("accepts dashed and leading-zero string PINs while rejecting numeric and malformed PINs", () => {
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: "01-23-456-789-0000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt,
    })).toMatchObject({ status: "resolved", pin: "01234567890000", pinSource: "coordinate_exact" });
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: 1234567890000,
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt,
    })).toBeNull();
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: "123",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt,
    })).toBeNull();
  });

  it("rejects incoherent provenance and timestamps", () => {
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: "16264270400000",
      source: "legacy_nearest",
      matchMethod: "within_50m",
      checkedAt,
    })).toBeNull();
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: "16264270400000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt: "not-a-date",
    })).toBeNull();
    expect(parseCandidateParcelResolution({
      status: "resolved",
      pin: "16264270400000",
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
      checkedAt: "August 15, 2026",
    })).toBeNull();
  });

  it("parses no-match and ambiguity without accepting clean zero ambiguity", () => {
    const provenance = {
      source: "cook_county_current_parcels",
      matchMethod: "exact_intersection",
    } as const;
    expect(parseCandidateParcelResolution({ status: "no_match", reason: "no_intersection", checkedAt, ...provenance })).toEqual({
      status: "no_match", reason: "no_intersection", checkedAt, ...provenance,
    });
    expect(parseCandidateParcelResolution({ status: "ambiguous", candidateCount: 2, checkedAt, ...provenance })).toEqual({
      status: "ambiguous", candidateCount: 2, checkedAt, ...provenance,
    });
    expect(parseCandidateParcelResolution({ status: "ambiguous", candidateCount: 1, checkedAt, ...provenance })).toBeNull();
    expect(parseCandidateParcelResolution({ status: "no_match", reason: "no_intersection", checkedAt })).toBeNull();
    expect(parseCandidateParcelResolution({ status: "ambiguous", candidateCount: 2, checkedAt })).toBeNull();
  });

  it("requires an exact normalized street-address match", () => {
    expect(parcelAddressesMatch("3040 S HOMAN AVE", "3040 S HOMAN AVE, CHICAGO IL 60623")).toBe(true);
    expect(parcelAddressesMatch("3040 S HOMAN AVE", "3042 S HOMAN AVE, CHICAGO IL 60623")).toBe(false);
  });

  it("accepts only finite coordinates inside the broad Chicago boundary", () => {
    expect(isChicagoParcelCoordinate(41.83776, -87.70998)).toBe(true);
    expect(isChicagoParcelCoordinate(0, 0)).toBe(false);
    expect(isChicagoParcelCoordinate(Number.NaN, -87.7)).toBe(false);
    expect(isChicagoParcelCoordinate(41.83776, -88.4)).toBe(false);
  });
});
