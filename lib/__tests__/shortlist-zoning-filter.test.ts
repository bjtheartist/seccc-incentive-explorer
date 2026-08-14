import { describe, expect, it } from "vitest";
import type { RankedShortlistCandidate } from "../shortlist-engine";
import {
  SHORTLIST_ZONING_AMBIGUOUS,
  SHORTLIST_ZONING_UNCLASSIFIED,
  SHORTLIST_ZONING_UNRESOLVED,
  candidateMatchesShortlistZoningFilters,
  shortlistDistrictTypeFilterOptions,
  shortlistDistrictTypeFilterValue,
  shortlistExactZoningFilterOptions,
  shortlistExactZoningFilterValue,
  shortlistFamilyFilterOptions,
  shortlistFamilyFilterValue,
} from "../shortlist-zoning-filter";

function candidate(
  key: string,
  zoningDistrict: string | null,
  zoningStatus: RankedShortlistCandidate["zoningStatus"] = "resolved",
): RankedShortlistCandidate {
  return {
    key,
    address: `${key} TEST ST`,
    pin: key,
    lat: 41.75,
    lon: -87.605,
    propertyType: "vacant_building",
    screenedPropertyType: "vacant_building",
    buildingSqft: 4000,
    lotSqft: null,
    zoningDistrict,
    zoningStatus,
    badge: "aligned",
    badgeNote: "Broad district-family screen.",
    ownerLabel: "Ownership unverified",
    incentiveCount: 0,
    saleYear: null,
    violation: false,
    conflictingPropertyTypes: false,
    overlays: {
      ssa: { present: false, name: null, unknown: false },
      ccsa: { present: false, name: null, unknown: false },
      tif: { present: false, name: null, unknown: false },
      nof: { present: false, name: null, unknown: false },
    },
    transitScore: null,
    score: 0,
    recordCompletenessScore: 0,
  };
}

describe("shortlist zoning hierarchy", () => {
  it.each([
    ["C1-2", "commercial", "C1", "zoning-code:C1-2"],
    ["C1-5", "commercial", "C1", "zoning-code:C1-5"],
    ["B3-2", "commercial", "B3", "zoning-code:B3-2"],
    ["M2-2", "manufacturing", "M2", "zoning-code:M2-2"],
    ["RS-2", "residential", "RS", "zoning-code:RS-2"],
    ["RT-4A", "residential", "RT", "zoning-code:RT-4A"],
    ["RM4.5", "residential", "RM", "zoning-code:RM-4.5"],
    ["DX-5", "downtown", "DX", "zoning-code:DX-5"],
    ["PD 123", "pd", "PD", "zoning-code:PD 123"],
    ["PMD 4", "pd", "PMD", "zoning-code:PMD 4"],
    ["POS-2", "parks", "POS", "zoning-code:POS-2"],
    ["T", "transport", "T", "zoning-code:T"],
  ])("classifies %s as family %s, type %s, and exact equality value %s", (code, family, subtype, exact) => {
    const row = candidate(code, code);
    expect(shortlistFamilyFilterValue(row)).toBe(family);
    expect(shortlistDistrictTypeFilterValue(row)).toBe(subtype);
    expect(shortlistExactZoningFilterValue(row)).toBe(exact);
  });

  it.each([
    ["RM4.5", "zoning-code:RM-4.5"],
    [" RM4-.5 ", "zoning-code:RM-4.5"],
    ["pmd-4", "zoning-code:PMD 4"],
    [" pmd13 ", "zoning-code:PMD 13"],
  ])("collapses the allow-listed alias %s without changing card data", (published, exact) => {
    const row = candidate(published, published);
    expect(shortlistExactZoningFilterValue(row)).toBe(exact);
    expect(row.zoningDistrict).toBe(published);
  });

  it("treats unresolved, ambiguous, empty, and unclassified designations explicitly", () => {
    expect(shortlistFamilyFilterValue(candidate("u", null, "unresolved"))).toBe(
      SHORTLIST_ZONING_UNRESOLVED,
    );
    expect(shortlistFamilyFilterValue(candidate("a", "C1-2", "ambiguous"))).toBe(
      SHORTLIST_ZONING_AMBIGUOUS,
    );
    expect(shortlistFamilyFilterValue(candidate("empty", "   ", "resolved"))).toBe(
      SHORTLIST_ZONING_UNRESOLVED,
    );
    expect(shortlistFamilyFilterValue(candidate("x", "ZX-1", "resolved"))).toBe(
      SHORTLIST_ZONING_UNCLASSIFIED,
    );
    expect(shortlistDistrictTypeFilterValue(candidate("x", "ZX-1", "resolved"))).toBe(
      SHORTLIST_ZONING_UNCLASSIFIED,
    );
    expect(shortlistExactZoningFilterValue(candidate("x", "ZX-1", "resolved"))).toBe(
      "zoning-code:ZX-1",
    );
  });
});

describe("linked shortlist zoning options", () => {
  const candidates = [
    candidate("b1", "B3-2"),
    candidate("b2", "B3-2"),
    candidate("c1", "C1-1"),
    candidate("c2", "C1-2"),
    candidate("r1", "RS-2"),
    candidate("pd", "PD 123"),
    candidate("pmd", "PMD-4"),
    candidate("u", null, "unresolved"),
    candidate("a", null, "ambiguous"),
    candidate("x", "ZX-1"),
  ];

  it("builds all present families and explicit missing-data statuses with counts", () => {
    expect(shortlistFamilyFilterOptions(candidates)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "commercial", count: 4 }),
        expect.objectContaining({ value: "residential", count: 1 }),
        expect.objectContaining({ value: "pd", count: 2 }),
        expect.objectContaining({ value: SHORTLIST_ZONING_UNRESOLVED, count: 1 }),
        expect.objectContaining({ value: SHORTLIST_ZONING_AMBIGUOUS, count: 1 }),
        expect.objectContaining({ value: SHORTLIST_ZONING_UNCLASSIFIED, count: 1 }),
      ]),
    );
  });

  it("narrows district types by family and preserves PD versus PMD", () => {
    expect(shortlistDistrictTypeFilterOptions(candidates, "commercial").map((o) => o.value)).toEqual([
      "B3",
      "C1",
    ]);
    expect(shortlistDistrictTypeFilterOptions(candidates, "pd").map((o) => o.value)).toEqual([
      "PD",
      "PMD",
    ]);
    expect(shortlistDistrictTypeFilterOptions(candidates, SHORTLIST_ZONING_UNRESOLVED)).toEqual([]);
  });

  it("narrows exact-code options by both family and type", () => {
    expect(shortlistExactZoningFilterOptions(candidates, "commercial", "C1")).toEqual([
      expect.objectContaining({ value: "zoning-code:C1-1", count: 1 }),
      expect.objectContaining({ value: "zoning-code:C1-2", count: 1 }),
    ]);
    expect(shortlistExactZoningFilterOptions(candidates, "pd", "PMD")).toEqual([
      expect.objectContaining({ value: "zoning-code:PMD 4", count: 1 }),
    ]);
    expect(
      shortlistExactZoningFilterOptions(
        candidates,
        SHORTLIST_ZONING_UNCLASSIFIED,
        SHORTLIST_ZONING_UNCLASSIFIED,
      ),
    ).toEqual([expect.objectContaining({ value: "zoning-code:ZX-1", count: 1 })]);
  });
});

describe("candidateMatchesShortlistZoningFilters", () => {
  const ranked = [
    candidate("first", "C1-1"),
    candidate("second", "C1-2"),
    candidate("third", "RS-2"),
    candidate("fourth", null, "unresolved"),
  ];

  it("combines family, type, and exact equality as an order-preserving filter", () => {
    expect(
      ranked
        .filter((row) =>
          candidateMatchesShortlistZoningFilters(
            row,
            "commercial",
            "C1",
            "zoning-code:C1-2",
          ),
        )
        .map((row) => row.key),
    ).toEqual(["second"]);
  });

  it("does not treat exact codes as prefix matches or bypass incompatible parents", () => {
    expect(
      candidateMatchesShortlistZoningFilters(
        ranked[0],
        "commercial",
        "C1",
        "zoning-code:C1",
      ),
    ).toBe(false);
    expect(
      candidateMatchesShortlistZoningFilters(
        ranked[2],
        "commercial",
        "",
        "zoning-code:RS-2",
      ),
    ).toBe(false);
  });

  it("supports explicit unresolved selection and the all/reset state", () => {
    expect(
      ranked
        .filter((row) =>
          candidateMatchesShortlistZoningFilters(
            row,
            SHORTLIST_ZONING_UNRESOLVED,
            "",
            "",
          ),
        )
        .map((row) => row.key),
    ).toEqual(["fourth"]);
    expect(
      ranked.filter((row) => candidateMatchesShortlistZoningFilters(row, "", "", "")),
    ).toEqual(ranked);
  });
});
