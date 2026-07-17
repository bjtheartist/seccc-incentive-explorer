import { describe, expect, it } from "vitest";
import {
  hasEntityMarkers,
  normalizeOwnerType,
  presentOwnerTypesInOrder,
  OWNER_TYPE_ORDER,
} from "../owner-classify";

describe("hasEntityMarkers", () => {
  it("matches PUBLIC_PATTERNS entities", () => {
    expect(hasEntityMarkers("CITY OF CHICAGO")).toBe(true);
    expect(hasEntityMarkers("COOK COUNTY")).toBe(true);
    expect(hasEntityMarkers("CHICAGO HOUSING AUTHORITY")).toBe(true);
  });

  it("matches CORPORATE_PATTERNS entities", () => {
    expect(hasEntityMarkers("ACME PROPERTIES LLC")).toBe(true);
    expect(hasEntityMarkers("SMITH HOLDINGS INC")).toBe(true);
    expect(hasEntityMarkers("RIVER TRUST")).toBe(true);
  });

  it("matches the additional institutional/organizational markers", () => {
    expect(hasEntityMarkers("FIRST BAPTIST CHURCH")).toBe(true);
    expect(hasEntityMarkers("SOUTH SIDE COMMUNITY BANK")).toBe(true);
    expect(hasEntityMarkers("ST. MARY FOUNDATION")).toBe(true);
    expect(hasEntityMarkers("CHICAGO STATE UNIVERSITY")).toBe(true);
    expect(hasEntityMarkers("MERCY HOSPITAL")).toBe(true);
    expect(hasEntityMarkers("LAKESIDE CONDOMINIUM ASSOCIATION")).toBe(true);
    expect(hasEntityMarkers("SOUTHSIDE LAND TRUST")).toBe(true);
    expect(hasEntityMarkers("VFW POST 1234")).toBe(true);
  });

  it("does not treat a bare surname 'Post' as an entity marker (avoids a false positive on an individual)", () => {
    expect(hasEntityMarkers("JOHN POST")).toBe(false);
    expect(hasEntityMarkers("EMILY POST")).toBe(false);
  });

  it("returns false for a plain individual person name", () => {
    expect(hasEntityMarkers("JANE SMITH")).toBe(false);
    expect(hasEntityMarkers("MARIA GONZALEZ")).toBe(false);
  });

  it("returns false for null, undefined, and empty/whitespace-only names", () => {
    expect(hasEntityMarkers(null)).toBe(false);
    expect(hasEntityMarkers(undefined)).toBe(false);
    expect(hasEntityMarkers("")).toBe(false);
    expect(hasEntityMarkers("   ")).toBe(false);
  });

  it("uses word boundaries so common name substrings don't false-positive (e.g. 'Bankston' vs 'bank')", () => {
    expect(hasEntityMarkers("JOHN BANKSTON")).toBe(false);
    expect(hasEntityMarkers("MARY POSTLETHWAITE")).toBe(false);
  });
});

describe("normalizeOwnerType", () => {
  it("passes through every known OwnerType unchanged", () => {
    for (const type of OWNER_TYPE_ORDER) {
      expect(normalizeOwnerType(type)).toBe(type);
    }
  });

  it("defaults null, undefined, and an unrecognized string to 'unknown'", () => {
    expect(normalizeOwnerType(null)).toBe("unknown");
    expect(normalizeOwnerType(undefined)).toBe("unknown");
    expect(normalizeOwnerType("not_a_real_type")).toBe("unknown");
    expect(normalizeOwnerType("")).toBe("unknown");
  });
});

describe("presentOwnerTypesInOrder", () => {
  it("returns an empty array for an empty input (nothing loaded yet, not a stray Unknown row)", () => {
    expect(presentOwnerTypesInOrder([])).toEqual([]);
  });

  it("dedupes and orders present types per OWNER_TYPE_ORDER regardless of input order", () => {
    const result = presentOwnerTypesInOrder([
      "local_private",
      "unknown",
      "corporate_llc",
      "corporate_llc",
      "local_private",
    ]);
    expect(result).toEqual(["corporate_llc", "local_private", "unknown"]);
  });

  it("normalizes null/unrecognized entries to 'unknown' so a missing ownerType still shows a key row", () => {
    expect(presentOwnerTypesInOrder([null, undefined, "not_a_real_type"])).toEqual(["unknown"]);
  });

  it("includes every present type across all five categories in canonical order", () => {
    const result = presentOwnerTypesInOrder([
      "unknown",
      "city_public",
      "local_private",
      "out_of_state",
      "corporate_llc",
    ]);
    expect(result).toEqual(OWNER_TYPE_ORDER);
  });
});
