import { describe, expect, it } from "vitest";
import { hasEntityMarkers } from "../owner-classify";

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
