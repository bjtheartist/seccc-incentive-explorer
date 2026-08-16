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

  it("tolerates a missing or synonymous street suffix but never a different number, direction, or street", () => {
    // Live production case: candidate record omits the suffix, County publishes it.
    expect(parcelAddressesMatch("9410 S CHAMPLAIN", "9410 S CHAMPLAIN AVE, CHICAGO, IL 60619")).toBe(true);
    expect(parcelAddressesMatch("9410 S CHAMPLAIN AVE", "9410 S CHAMPLAIN")).toBe(true);
    expect(parcelAddressesMatch("9410 S CHAMPLAIN AVENUE", "9410 S CHAMPLAIN AVE")).toBe(true);
    expect(parcelAddressesMatch("100 W 79TH STREET", "100 W 79TH ST")).toBe(true);
    // Both sides publish a suffix and they disagree → not the same street.
    expect(parcelAddressesMatch("9410 S CHAMPLAIN AVE", "9410 S CHAMPLAIN ST")).toBe(false);
    // Different house number / direction / street name still fail.
    expect(parcelAddressesMatch("9410 S CHAMPLAIN", "9412 S CHAMPLAIN AVE")).toBe(false);
    expect(parcelAddressesMatch("9410 N CHAMPLAIN", "9410 S CHAMPLAIN AVE")).toBe(false);
    // Suffix-looking street names (Avenue L) are not stripped into a false match.
    expect(parcelAddressesMatch("10500 S AVENUE L", "10500 S AVENUE")).toBe(false);
    expect(parcelAddressesMatch("10500 S AVENUE L", "10500 S AVENUE L")).toBe(true);
  });

  it("accepts a County-published unit designator on the same lot, but never a conflicting unit", () => {
    // Live production cases: the only intersecting parcel carries a unit tag.
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD 2, CHICAGO, IL 60623")).toBe(true);
    expect(parcelAddressesMatch("2105 S DRAKE AVE", "2105 S DRAKE AVE 2FL")).toBe(true);
    expect(parcelAddressesMatch("3144 W 16TH ST", "3144 W 16TH ST 1")).toBe(true);
    expect(parcelAddressesMatch("7219 S WOODLAWN AVE", "7219 S WOODLAWN AVE UNIT 2")).toBe(true);
    expect(parcelAddressesMatch("7219 S WOODLAWN AVE UNIT 2", "7219 S WOODLAWN AVE 2")).toBe(true);
    expect(parcelAddressesMatch("7219 S WOODLAWN AVE UNIT 1", "7219 S WOODLAWN AVE 2")).toBe(false);
    // A trailing token without a digit or unit label is street name, not a unit.
    expect(parcelAddressesMatch("100 W PARK AVE WEST", "100 W PARK AVE")).toBe(false);
    // Long trailing text is not a unit designator.
    expect(parcelAddressesMatch("3729 W 23RD ST", "3729 W 23RD ST REAR BUILDING LOT")).toBe(false);
    // "FL 2" and "2FL" are the same unit; different unit tokens are not.
    expect(parcelAddressesMatch("7219 S WOODLAWN AVE FL 2", "7219 S WOODLAWN AVE 2FL")).toBe(true);
    expect(parcelAddressesMatch("7219 S WOODLAWN AVE 3B", "7219 S WOODLAWN AVE 3A")).toBe(false);
  });

  it("never treats a directional or alphabetic street-name token as a unit (reviewer refutation set)", () => {
    // S Stony Island Ave East, S Doty Ave East, W Normal Pkwy North are distinct streets.
    expect(parcelAddressesMatch("7827 S STONY ISLAND AVE", "7827 S STONY ISLAND AVE EAST 2")).toBe(false);
    expect(parcelAddressesMatch("10700 S DOTY AVE", "10700 S DOTY AV EAST 1")).toBe(false);
    expect(parcelAddressesMatch("442 W NORMAL PKWY", "442 W NORMAL PKWY NORTH 2")).toBe(false);
    expect(parcelAddressesMatch("442 W NORMAL PKWY", "442 W NORMAL PARKWAY NORTH 2")).toBe(false);
    expect(parcelAddressesMatch("100 W PARK AVE WEST 2", "100 W PARK AVE")).toBe(false);
    // Two-token unit tails are not units.
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD 2 FL")).toBe(false);
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD STE 101 B")).toBe(false);
  });

  it("keeps Avenue-letter street names whole, with or without a unit tag", () => {
    expect(parcelAddressesMatch("9832 S AVENUE L", "9832 S AVENUE L 2")).toBe(true);
    expect(parcelAddressesMatch("9534 S AVENUE M", "9534 S AVENUE M 1")).toBe(true);
    expect(parcelAddressesMatch("9832 S AVENUE L 2", "9832 S AVE")).toBe(false);
    expect(parcelAddressesMatch("9832 S AVENUE L", "9832 S AVENUE M")).toBe(false);
    expect(parcelAddressesMatch("9832 S AVENUE L", "9832 S AVENUE L EAST 2")).toBe(false);
  });

  it("does not strip a bare trailing CHICAGO street name, only city/state/ZIP blocks", () => {
    expect(parcelAddressesMatch("5936 W CHICAGO", "5936 W CHICAGO AVE, CHICAGO, IL 60651")).toBe(true);
    expect(parcelAddressesMatch("5936 W CHICAGO", "5936 W ST 2")).toBe(false);
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD, CHICAGO, IL 60623-1234")).toBe(true);
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD, CHICAGO 60623")).toBe(true);
    // A bare ZIP is never a unit designator.
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD 60804")).toBe(false);
  });

  it("strips a bare trailing CHICAGO city token only after a street suffix (round-2 regression set)", () => {
    expect(parcelAddressesMatch("6333 S GREEN ST", "6333 S GREEN ST CHICAGO")).toBe(true);
    expect(parcelAddressesMatch("70 EAST LAKE STREET", "70 EAST LAKE STREET CHICAGO")).toBe(true);
    expect(parcelAddressesMatch("9410 S CHAMPLAIN AVE", "9410 S CHAMPLAIN AVE, CHICAGO")).toBe(true);
    expect(parcelAddressesMatch("7401 S SOUTH CHICAGO AVE", "7401 S SOUTH CHICAGO AVE, CHICAGO")).toBe(true);
    expect(parcelAddressesMatch("7558 S SOUTH CHICAGO AVE", "7558 S SOUTH CHICAGO AVE CHICAGO")).toBe(true);
    expect(parcelAddressesMatch("180 N LA SALLE ST STE 2505", "180 N LA SALLE ST STE 2505 CHICAGO")).toBe(true);
    // Street-name CHICAGO is preserved when no suffix precedes it.
    expect(parcelAddressesMatch("7401 S SOUTH CHICAGO", "7401 S SOUTH CHICAGO AVE, CHICAGO, IL 60619")).toBe(true);
    expect(parcelAddressesMatch("3634 W CHICAGO", "3634 W CHICAGO AVE")).toBe(true);
    // Suburban city text is never stripped → conservative reject.
    expect(parcelAddressesMatch("4320 W CERMAK RD", "4320 W CERMAK RD, CICERO, IL 60804")).toBe(false);
  });

  it("canonicalizes AVE/AV/AVENUE inside Avenue-letter names, and only when preceded by a direction", () => {
    expect(parcelAddressesMatch("9832 S AVE L", "9832 S AVENUE L")).toBe(true);
    expect(parcelAddressesMatch("13550 S AV O", "13550 S AVENUE O 2")).toBe(true);
    // "S DOBSON AVE F": not preceded by a direction, so "F" is not a street letter; conservative reject.
    expect(parcelAddressesMatch("8228 S DOBSON AVE", "8228 S DOBSON AVE F")).toBe(false);
  });

  it("splits on the LAST suffix token so embedded synonyms (S DR MARTIN LUTHER KING JR DR, W ST PAUL AVE) work", () => {
    expect(parcelAddressesMatch("1234 S DR MARTIN LUTHER KING JR", "1234 S DR MARTIN LUTHER KING JR DR")).toBe(true);
    expect(parcelAddressesMatch("1234 S DR MARTIN LUTHER KING JR DR", "1234 S DR MARTIN LUTHER KING JR DR 2")).toBe(true);
    expect(parcelAddressesMatch("2000 W ST PAUL", "2000 W ST PAUL AVE 3")).toBe(true);
    expect(parcelAddressesMatch("1234 S DR MARTIN LUTHER KING JR", "1234 S DR MARTIN LUTHER")).toBe(false);
  });

  it("supports non-directional addresses as long as the core keeps a street name", () => {
    expect(parcelAddressesMatch("5236 KENMORE", "5236 KENMORE AVENUE")).toBe(true);
    expect(parcelAddressesMatch("540 BRIAR PLACE", "540 BRIAR PL")).toBe(true);
    expect(parcelAddressesMatch("4138 5TH AVE", "4138 5TH AVE 2")).toBe(true);
    expect(parcelAddressesMatch("5236 KENMORE", "5236 KENWOOD AVENUE")).toBe(false);
    expect(parcelAddressesMatch("1234 W AVENUE 44", "1234 W AVENUE 45")).toBe(false);
  });

  it("canonicalizes only the leading direction word, and rejects a core that is just number + direction", () => {
    expect(parcelAddressesMatch("70 EAST LAKE STREET SUITE 720", "70 E LAKE ST STE 720")).toBe(true);
    expect(parcelAddressesMatch("1300 SOUTH DUSABLE LAKE SHORE DRIVE", "1300 S DUSABLE LAKE SHORE DR")).toBe(true);
    expect(parcelAddressesMatch("7401 SOUTH SOUTH CHICAGO AVE", "7401 S SOUTH CHICAGO AVE")).toBe(true);
    // A later direction word is street name, not canonicalized: S SOUTH CHICAGO ≠ S S CHICAGO.
    expect(parcelAddressesMatch("7401 S S CHICAGO AVE", "7401 S SOUTH CHICAGO AVE")).toBe(false);
    expect(parcelAddressesMatch("1940 S", "1940 S AVE")).toBe(false);
    expect(parcelAddressesMatch("1234 W AVENUE 44", "1234 W AVE")).toBe(false);
  });

  it("keeps the pre-existing exact-match semantics for very short addresses", () => {
    expect(parcelAddressesMatch("1 N AVE", "1 N AVE")).toBe(true);
    expect(parcelAddressesMatch("12 E DR", "12 E DR")).toBe(true);
    // A core without a street name never matches across differing strings.
    expect(parcelAddressesMatch("1 N AVE", "1 N ST")).toBe(false);
  });

  it("documents the accepted residual: a suffix-less numbered street matches ST or PL on the same block", () => {
    // Geometry (exact point-in-parcel) is what disambiguates W 63rd St from W 63rd Pl;
    // the address check only guards against a DIFFERENT number/direction/name.
    expect(parcelAddressesMatch("6300 W 63RD", "6300 W 63RD PL")).toBe(true);
    expect(parcelAddressesMatch("6300 W 63RD ST", "6300 W 63RD PL")).toBe(false);
  });

  it("accepts only finite coordinates inside the broad Chicago boundary", () => {
    expect(isChicagoParcelCoordinate(41.83776, -87.70998)).toBe(true);
    expect(isChicagoParcelCoordinate(0, 0)).toBe(false);
    expect(isChicagoParcelCoordinate(Number.NaN, -87.7)).toBe(false);
    expect(isChicagoParcelCoordinate(41.83776, -88.4)).toBe(false);
  });
});
