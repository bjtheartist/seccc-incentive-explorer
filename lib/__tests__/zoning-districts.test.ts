import { describe, expect, it } from "vitest";

import {
  ZONING_DISTRICT_FAMILIES,
  classifyZoneClass,
  matchesDistrictFilter,
  zoneClassPrefix,
} from "../zoning-districts";

describe("zoneClassPrefix", () => {
  it("takes the leading alphabetic run", () => {
    expect(zoneClassPrefix("C1-2")).toBe("C");
    expect(zoneClassPrefix("RS-3")).toBe("RS");
    expect(zoneClassPrefix("PMD 11")).toBe("PMD");
    expect(zoneClassPrefix("m1-2")).toBe("M");
    expect(zoneClassPrefix("  B3-5 ")).toBe("B");
  });

  it("returns null when the value does not start with letters", () => {
    expect(zoneClassPrefix("")).toBeNull();
    expect(zoneClassPrefix("1-2")).toBeNull();
    expect(zoneClassPrefix("-")).toBeNull();
  });
});

describe("classifyZoneClass", () => {
  it("classifies the district families", () => {
    expect(classifyZoneClass("RS-3")?.id).toBe("residential");
    expect(classifyZoneClass("RT-4")?.id).toBe("residential");
    expect(classifyZoneClass("RM-5")?.id).toBe("residential");
    expect(classifyZoneClass("B3-2")?.id).toBe("business");
    expect(classifyZoneClass("C1-3")?.id).toBe("commercial");
    expect(classifyZoneClass("M1-2")?.id).toBe("manufacturing");
    expect(classifyZoneClass("DX-7")?.id).toBe("downtown");
    expect(classifyZoneClass("POS-1")?.id).toBe("parks-open-space");
  });

  it("does not let a shorter prefix shadow a longer one", () => {
    // "PMD" must not fall through to a "P"-style match, and "RS" must not
    // be swallowed by a bare "R".
    expect(classifyZoneClass("PMD 11")?.id).toBe("planned-manufacturing");
    expect(classifyZoneClass("PD 1234")?.id).toBe("planned-development");
    expect(classifyZoneClass("POS-2")?.id).toBe("parks-open-space");
    expect(classifyZoneClass("RS-1")?.id).toBe("residential");
  });

  it("returns null rather than guessing for unknown or empty designations", () => {
    expect(classifyZoneClass(null)).toBeNull();
    expect(classifyZoneClass(undefined)).toBeNull();
    expect(classifyZoneClass("")).toBeNull();
    expect(classifyZoneClass("ZZ-9")).toBeNull();
    expect(classifyZoneClass("42")).toBeNull();
  });

  it("never classifies a bare letter that is not a real designation", () => {
    // "R" alone is not a Chicago district designation; only RS/RT/RM are.
    expect(classifyZoneClass("R-1")).toBeNull();
    expect(classifyZoneClass("D-1")).toBeNull();
  });
});

describe("matchesDistrictFilter", () => {
  it("matches everything when no families are selected", () => {
    expect(matchesDistrictFilter("C1-2", [])).toBe(true);
    expect(matchesDistrictFilter(null, [])).toBe(true);
    expect(matchesDistrictFilter("ZZ-9", [])).toBe(true);
  });

  it("matches only the selected families", () => {
    expect(matchesDistrictFilter("C1-2", ["commercial"])).toBe(true);
    expect(matchesDistrictFilter("C1-2", ["business"])).toBe(false);
    expect(matchesDistrictFilter("B3-2", ["business", "commercial"])).toBe(true);
  });

  it("excludes unclassified sites once a filter is applied", () => {
    // Including them would assert a family membership never established.
    expect(matchesDistrictFilter(null, ["commercial"])).toBe(false);
    expect(matchesDistrictFilter("ZZ-9", ["commercial"])).toBe(false);
  });
});

describe("family table integrity", () => {
  it("has unique ids", () => {
    const ids = ZONING_DISTRICT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique prefixes across all families", () => {
    const prefixes = ZONING_DISTRICT_FAMILIES.flatMap((f) => f.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("gives every family a label and a description", () => {
    for (const family of ZONING_DISTRICT_FAMILIES) {
      expect(family.label.length).toBeGreaterThan(0);
      expect(family.description.length).toBeGreaterThan(0);
      expect(family.prefixes.length).toBeGreaterThan(0);
    }
  });
});
