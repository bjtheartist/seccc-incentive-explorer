import { describe, expect, it } from "vitest";
import {
  normalizeCountyArea,
  normalizeCountyClass,
  normalizeCountyTaxYear,
} from "../county-parcel-facts";

/**
 * These three run on BOTH the live per-PIN County read
 * (app/api/shortlist/enrich/route.ts) and the offline precompute
 * (scripts/resolve-shortlist-universe-parcels.ts). If they ever diverge, the
 * same parcel renders differently depending on which path answered — which
 * is exactly the class of bug the shared module exists to make impossible.
 */

describe("normalizeCountyClass", () => {
  it("keeps a published class code as trimmed text", () => {
    expect(normalizeCountyClass("517")).toBe("517");
    expect(normalizeCountyClass("  EX  ")).toBe("EX");
    expect(normalizeCountyClass("100")).toBe("100");
  });

  it("treats blanks and non-strings as unknown, never as a class", () => {
    expect(normalizeCountyClass("")).toBeNull();
    expect(normalizeCountyClass("   ")).toBeNull();
    expect(normalizeCountyClass(null)).toBeNull();
    expect(normalizeCountyClass(undefined)).toBeNull();
    // A numeric class would lose its leading zeros and its "EX" siblings —
    // the County publishes class as TEXT and so does this.
    expect(normalizeCountyClass(517)).toBeNull();
  });
});

describe("normalizeCountyArea", () => {
  it("accepts positive numbers and numeric strings", () => {
    expect(normalizeCountyArea(3125)).toBe(3125);
    expect(normalizeCountyArea("3125")).toBe(3125);
  });

  it("treats sentinel zero, negatives, and junk as unpublished, never as real area", () => {
    expect(normalizeCountyArea(0)).toBeNull();
    expect(normalizeCountyArea("0")).toBeNull();
    expect(normalizeCountyArea(-25)).toBeNull();
    expect(normalizeCountyArea("")).toBeNull();
    expect(normalizeCountyArea("not a number")).toBeNull();
    expect(normalizeCountyArea(null)).toBeNull();
    expect(normalizeCountyArea(Number.NaN)).toBeNull();
    expect(normalizeCountyArea(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("normalizeCountyTaxYear", () => {
  it("renders every County encoding of a year as a clean four digits", () => {
    expect(normalizeCountyTaxYear(2024)).toBe("2024");
    expect(normalizeCountyTaxYear("2024")).toBe("2024");
    // The encoding that once leaked a "2026.0" into the UI.
    expect(normalizeCountyTaxYear("2024.0")).toBe("2024");
    expect(normalizeCountyTaxYear("2024.000")).toBe("2024");
    expect(normalizeCountyTaxYear(" 2024 ")).toBe("2024");
  });

  it("rejects anything that is not a plausible year rather than passing text through", () => {
    expect(normalizeCountyTaxYear("")).toBeNull();
    expect(normalizeCountyTaxYear("   ")).toBeNull();
    expect(normalizeCountyTaxYear("24")).toBeNull();
    expect(normalizeCountyTaxYear("2024.5")).toBeNull();
    expect(normalizeCountyTaxYear("TAXYR")).toBeNull();
    expect(normalizeCountyTaxYear(null)).toBeNull();
    expect(normalizeCountyTaxYear(Number.NaN)).toBeNull();
    expect(normalizeCountyTaxYear({ year: 2024 })).toBeNull();
  });
});
