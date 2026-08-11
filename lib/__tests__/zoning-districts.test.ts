import { describe, expect, it } from "vitest";

import {
  ZONE_SUBTYPES,
  ZONING_DISTRICT_FAMILIES,
  classifyZoneClass,
  isMalformedZoneClass,
  matchesDistrictFilter,
  normalizeZoneClass,
  subtypeById,
  subtypeMatchesSelection,
  subtypesForFamily,
  summarizeDistricts,
  zoneClassPrefix,
  zoneSubtype,
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

describe("normalizeZoneClass", () => {
  it("repairs the five designations the City publishes malformed", () => {
    // Each canonical twin also appears in the layer, so these are
    // demonstrable duplicates rather than inferred corrections.
    expect(normalizeZoneClass("RM4-.5")).toBe("RM-4.5");
    expect(normalizeZoneClass("RM4.5")).toBe("RM-4.5");
    expect(normalizeZoneClass("RM5.5")).toBe("RM-5.5");
    expect(normalizeZoneClass("PMD-4")).toBe("PMD 4");
    expect(normalizeZoneClass("PMD13")).toBe("PMD 13");
  });

  it("leaves valid designations untouched, including real variants", () => {
    // RT-4A is a real district, not a malformation. T is genuinely bare.
    // PD spacing is the published convention.
    for (const value of ["B3-2", "RT-4A", "RT-3.5", "T", "PD 0", "POS-3", "RM-4.5"]) {
      expect(normalizeZoneClass(value)).toBe(value);
    }
  });

  it("does not invent repairs for unknown malformations", () => {
    // An unlisted oddity is never rewritten — it stays as-is and will
    // simply fail to classify rather than being guessed into a bucket.
    expect(normalizeZoneClass("QQ9-.7")).toBe("QQ9-.7");
    expect(classifyZoneClass("QQ9-.7")).toBeNull();
  });

  it("flags whether a designation needed repair", () => {
    expect(isMalformedZoneClass("RM4-.5")).toBe(true);
    expect(isMalformedZoneClass("RM-4.5")).toBe(false);
    expect(isMalformedZoneClass(null)).toBe(false);
  });

  it("collapses duplicate spellings so a code filter lists one option", () => {
    const published = ["RM-4.5", "RM4.5", "RM4-.5"];
    const canonical = new Set(published.map((v) => normalizeZoneClass(v)));
    expect([...canonical]).toEqual(["RM-4.5"]);
  });
});

describe("zoneSubtype", () => {
  it("keeps the use digit for B, C and M, where it selects the use type", () => {
    expect(zoneSubtype("B1-1")).toBe("B1");
    expect(zoneSubtype("B3-5")).toBe("B3");
    expect(zoneSubtype("C1-5")).toBe("C1");
    expect(zoneSubtype("C3-1")).toBe("C3");
    expect(zoneSubtype("M2-1")).toBe("M2");
  });

  it("drops the bulk digit, so intensity does not split a use type", () => {
    // B3-1 and B3-5 permit the same activities at different densities.
    expect(zoneSubtype("B3-1")).toBe(zoneSubtype("B3-5"));
    expect(zoneSubtype("C1-1")).toBe(zoneSubtype("C1-5"));
  });

  it("uses the letters alone where they already carry the use type", () => {
    expect(zoneSubtype("RS-3")).toBe("RS");
    expect(zoneSubtype("RT-4A")).toBe("RT");
    expect(zoneSubtype("RM-6.5")).toBe("RM");
    expect(zoneSubtype("DX-7")).toBe("DX");
    expect(zoneSubtype("DR-3")).toBe("DR");
    expect(zoneSubtype("POS-2")).toBe("POS");
    expect(zoneSubtype("T")).toBe("T");
  });

  it("normalizes before extracting", () => {
    expect(zoneSubtype("RM4-.5")).toBe("RM");
    expect(zoneSubtype("PMD13")).toBe("PMD");
  });

  it("returns null for unclassifiable designations", () => {
    expect(zoneSubtype("ZZ-9")).toBeNull();
    expect(zoneSubtype("")).toBeNull();
    expect(zoneSubtype(null)).toBeNull();
  });
});

describe("ZONE_SUBTYPES", () => {
  it("labels sub-types from the per-code descriptions", () => {
    expect(subtypeById("B1")?.label).toBe("Neighborhood Shopping");
    expect(subtypeById("B3")?.label).toBe("Community Shopping");
    expect(subtypeById("C2")?.label).toBe("Motor Vehicle-Related Commercial");
    expect(subtypeById("M1")?.label).toBe("Limited Manufacturing/Business Park");
    expect(subtypeById("DC")?.label).toBe("Downtown Core");
  });

  it("marks PD and PMD as answerable only by their ordinance", () => {
    expect(subtypeById("PD")?.requiresOrdinanceLookup).toBe(true);
    expect(subtypeById("PMD")?.requiresOrdinanceLookup).toBe(true);
    // Every ordinary district answers from the designation itself.
    for (const subtype of ZONE_SUBTYPES) {
      if (subtype.id === "PD" || subtype.id === "PMD") continue;
      expect(subtype.requiresOrdinanceLookup).toBe(false);
    }
  });

  it("groups sub-types under their family", () => {
    expect(subtypesForFamily("residential").sort()).toEqual(["RM", "RS", "RT"]);
    expect(subtypeById("B3")?.familyId).toBe("commercial");
    expect(subtypeById("PD")?.familyId).toBe("pd");
  });

  it("gives every sub-type a non-empty label", () => {
    for (const subtype of ZONE_SUBTYPES) {
      expect(subtype.label.length).toBeGreaterThan(0);
      expect(subtype.label).not.toMatch(/\($/);
    }
  });
});

describe("subtypeMatchesSelection", () => {
  it("matches an exact sub-type selection", () => {
    expect(subtypeMatchesSelection("B3", "B3")).toBe(true);
    expect(subtypeMatchesSelection("B1", "B3")).toBe(false);
  });

  it("matches a family roll-up selection", () => {
    expect(subtypeMatchesSelection("B3", "commercial")).toBe(true);
    expect(subtypeMatchesSelection("C1", "commercial")).toBe(true);
    expect(subtypeMatchesSelection("RS", "commercial")).toBe(false);
  });

  it("never matches an unclassified candidate", () => {
    expect(subtypeMatchesSelection(null, "commercial")).toBe(false);
    expect(subtypeMatchesSelection(null, "B3")).toBe(false);
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
