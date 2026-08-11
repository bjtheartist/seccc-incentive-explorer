import { describe, expect, it } from "vitest";

import {
  ZONING_DISTRICT_FAMILIES,
  classifyZoneClass,
  matchesDistrictFilter,
  summarizeDistricts,
  zoneClassPrefix,
} from "../zoning-districts";

describe("zoneClassPrefix", () => {
  it("takes the whole leading alphabetic run", () => {
    expect(zoneClassPrefix("C1-2")).toBe("C");
    expect(zoneClassPrefix("RS-3")).toBe("RS");
    expect(zoneClassPrefix("PMD 11")).toBe("PMD");
    expect(zoneClassPrefix("m1-2")).toBe("M");
    expect(zoneClassPrefix("  B3-5 ")).toBe("B");
    expect(zoneClassPrefix("T")).toBe("T");
  });

  it("returns null when the value does not start with letters", () => {
    expect(zoneClassPrefix("")).toBeNull();
    expect(zoneClassPrefix("1-2")).toBeNull();
    expect(zoneClassPrefix("-")).toBeNull();
  });
});

describe("classifyZoneClass", () => {
  it("classifies designations into the shared ZONING_CATEGORIES families", () => {
    expect(classifyZoneClass("RS-3")?.id).toBe("residential");
    expect(classifyZoneClass("RT-4")?.id).toBe("residential");
    expect(classifyZoneClass("RM-5")?.id).toBe("residential");
    // Business and commercial share one category in ZONING_CATEGORIES.
    expect(classifyZoneClass("B3-2")?.id).toBe("commercial");
    expect(classifyZoneClass("C1-3")?.id).toBe("commercial");
    expect(classifyZoneClass("M1-2")?.id).toBe("manufacturing");
    expect(classifyZoneClass("DX-7")?.id).toBe("downtown");
    expect(classifyZoneClass("POS-1")?.id).toBe("parks");
    expect(classifyZoneClass("T")?.id).toBe("transport");
    // PD and PMD likewise share one category.
    expect(classifyZoneClass("PD 12")?.id).toBe("pd");
    expect(classifyZoneClass("PMD 11")?.id).toBe("pd");
  });

  it("matches the whole alphabetic run, not a leading slice", () => {
    // This is the difference from buildZoningColorExpression: a future
    // "CX-1" must NOT be absorbed into commercial by its first letter.
    expect(classifyZoneClass("CX-1")).toBeNull();
    expect(classifyZoneClass("MX-2")).toBeNull();
    expect(classifyZoneClass("BQ-3")).toBeNull();
  });

  it("returns null rather than guessing for unknown or empty designations", () => {
    expect(classifyZoneClass(null)).toBeNull();
    expect(classifyZoneClass(undefined)).toBeNull();
    expect(classifyZoneClass("")).toBeNull();
    expect(classifyZoneClass("ZZ-9")).toBeNull();
    expect(classifyZoneClass("42")).toBeNull();
  });

  it("does not classify a bare letter that is not a real designation", () => {
    // "R" alone is not a Chicago designation; only RS/RT/RM are.
    expect(classifyZoneClass("R-1")).toBeNull();
    expect(classifyZoneClass("D-1")).toBeNull();
  });
});

/**
 * Validated 2026-08-10 against the City of Chicago ArcGIS zoning layer
 * (ExternalApps/Zoning/MapServer/1), returnDistinctValues on ZONE_CLASS:
 * 1,528 distinct designations resolving to exactly these 14 prefixes.
 *
 * This fixture is the drift alarm for ZONING_CATEGORIES, which also
 * drives map fill colours and the legend. If the City publishes a new
 * prefix, this fails instead of parcels quietly taking the fallback
 * colour and dropping out of filtered lists.
 */
const OBSERVED_PREFIXES_2026_08_10 = [
  "B", "C", "DC", "DR", "DS", "DX", "M",
  "PD", "PMD", "POS", "RM", "RS", "RT", "T",
] as const;

describe("coverage of the live zoning layer", () => {
  it("classifies every prefix observed in the City layer", () => {
    const unclassified = OBSERVED_PREFIXES_2026_08_10.filter(
      (prefix) => classifyZoneClass(`${prefix}-1`) === null,
    );
    expect(unclassified).toEqual([]);
  });

  it("declares no prefix the City layer does not publish", () => {
    const declared = ZONING_DISTRICT_FAMILIES.flatMap((f) => [...f.prefixes]).sort();
    const observed = [...OBSERVED_PREFIXES_2026_08_10].sort();
    expect(declared).toEqual(observed);
  });

  it("handles real designations from the layer, including malformed ones", () => {
    // Verbatim values pulled from the layer on 2026-08-10.
    expect(classifyZoneClass("B1-1.5")?.id).toBe("commercial");
    expect(classifyZoneClass("C1-1.5")?.id).toBe("commercial");
    expect(classifyZoneClass("RT-4A")?.id).toBe("residential");
    expect(classifyZoneClass("RM-4.5")?.id).toBe("residential");
    // "RM4-.5" is published with the hyphen misplaced. It must still
    // classify as residential rather than falling through to null.
    expect(classifyZoneClass("RM4-.5")?.id).toBe("residential");
    // Space-separated designations.
    expect(classifyZoneClass("PD 0")?.id).toBe("pd");
    expect(classifyZoneClass("PD 1000")?.id).toBe("pd");
    expect(classifyZoneClass("PMD 11")?.id).toBe("pd");
    // "T" is published bare, with no suffix at all.
    expect(classifyZoneClass("T")?.id).toBe("transport");
    expect(classifyZoneClass("POS-3")?.id).toBe("parks");
    expect(classifyZoneClass("DC-16")?.id).toBe("downtown");
    expect(classifyZoneClass("DR-10")?.id).toBe("downtown");
    expect(classifyZoneClass("DS-5")?.id).toBe("downtown");
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
    expect(matchesDistrictFilter("C1-2", ["residential"])).toBe(false);
    expect(matchesDistrictFilter("RS-1", ["residential", "commercial"])).toBe(true);
  });

  it("excludes unclassified sites once a filter is applied", () => {
    // Including them would assert a family membership never established.
    expect(matchesDistrictFilter(null, ["commercial"])).toBe(false);
    expect(matchesDistrictFilter("ZZ-9", ["commercial"])).toBe(false);
  });
});

describe("summarizeDistricts", () => {
  it("counts by family and reports unclassified separately", () => {
    const { byFamily, unclassified } = summarizeDistricts([
      "B3-2", "C1-2", "RS-3", "ZZ-9", null, "PD 4",
    ]);
    expect(byFamily.get("commercial")).toBe(2);
    expect(byFamily.get("residential")).toBe(1);
    expect(byFamily.get("pd")).toBe(1);
    expect(unclassified).toBe(2);
  });

  it("returns zeroes for an empty candidate set", () => {
    const { byFamily, unclassified } = summarizeDistricts([]);
    expect(byFamily.size).toBe(0);
    expect(unclassified).toBe(0);
  });
});

describe("family table integrity", () => {
  it("has unique ids", () => {
    const ids = ZONING_DISTRICT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique prefixes across all families", () => {
    const prefixes = ZONING_DISTRICT_FAMILIES.flatMap((f) => [...f.prefixes]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("gives every family a label, prefixes, and a colour", () => {
    for (const family of ZONING_DISTRICT_FAMILIES) {
      expect(family.label.length).toBeGreaterThan(0);
      expect(family.prefixes.length).toBeGreaterThan(0);
      expect(family.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
