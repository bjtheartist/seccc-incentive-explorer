import { describe, expect, it } from "vitest";
import { POLICE_DISTRICT_NAMES, policeDistrictLabel } from "@/lib/police-districts";

describe("POLICE_DISTRICT_NAMES", () => {
  it("has exactly the 22 current geographic patrol districts (13, 21, 23 retired in the 2012 consolidation, never reused)", () => {
    const numbers = Object.keys(POLICE_DISTRICT_NAMES).map(Number).sort((a, b) => a - b);
    expect(numbers).toHaveLength(22);
    expect(numbers).not.toContain(13);
    expect(numbers).not.toContain(21);
    expect(numbers).not.toContain(23);
    // District 31 is a real row in the City's boundary layer but is not a
    // geographic patrol district — lib/district-lookup.ts excludes it at
    // the query level (DIST_NUM != '31'), so it must never appear here.
    expect(numbers).not.toContain(31);
  });
});

describe("policeDistrictLabel", () => {
  it("formats a known district with its ordinal and name", () => {
    expect(policeDistrictLabel("6")).toBe("6th (Gresham)");
    expect(policeDistrictLabel("1")).toBe("1st (Central)");
    expect(policeDistrictLabel("22")).toBe("22nd (Morgan Park)");
    expect(policeDistrictLabel("11")).toBe("11th (Harrison)");
  });

  it("falls back to the bare ordinal for an unrecognized district — never a guessed name", () => {
    expect(policeDistrictLabel("99")).toBe("99th");
  });
});
