import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_TYPE_ORDER } from "../owner-classify";
import {
  addressHasViolation,
  assignQuantileDots,
  bboxIntersects,
  buildDirectoryRows,
  CLUSTERS_NOTE,
  clusterVacantSites,
  compareDirectoryRows,
  compareRankableSites,
  computeSitePriority,
  corridorRefsIntersectingBbox,
  countAddressesInSet,
  editionGeographyNote,
  getVacancyIndexEdition,
  haversineMeters,
  latestSaleYearForPin,
  loadVacancyIndex,
  MATRIX_METHOD_NOTE,
  nearestCorridorName,
  nextStepForSite,
  PORTFOLIO_LABELS,
  PORTFOLIO_ORDER,
  PORTFOLIO_RUBRIC_NOTE,
  portfolioForSite,
  priorityTierForScore,
  rankSites,
  reconcileOwnerTypeForPin,
  reconcileVacantLandOwnership,
  tallyOwnerTypeCounts,
  tallyPortfolioCounts,
  taxSaleExposureForVacantPins,
  type ClusterInputSite,
  type CorridorPolygon,
  type DirectoryInputSite,
  type RankableSite,
  type VacancyDirectoryFile,
  type VacancyDirectoryRow,
  type VacancyIndexExport,
  type VacancyPortfolio,
  type VacancyPriorityTier,
  type VacancyPropertyType,
} from "../vacancy-index";
import type { OwnerType } from "../owner-classify";

// ── Pure-function units ──────────────────────────────────────────────────────

/** A site that scores 0 on every rubric term (the baseline to isolate terms). */
function zeroSite() {
  return {
    incentiveCount: 0,
    squareFeet: null as number | null,
    ownerType: "local_private" as OwnerType,
    status: "reported" as string | null,
    propertyType: "vacant_land" as VacancyPropertyType,
  };
}

describe("computeSitePriority", () => {
  it("scores 0 for a site that triggers no rubric term (tier low)", () => {
    const { score, tier } = computeSitePriority(zeroSite());
    expect(score).toBe(0);
    expect(tier).toBe("low");
  });

  it("adds min(incentiveCount, 4), capping at 4", () => {
    expect(computeSitePriority({ ...zeroSite(), incentiveCount: 0 }).score).toBe(0);
    expect(computeSitePriority({ ...zeroSite(), incentiveCount: 3 }).score).toBe(3);
    expect(computeSitePriority({ ...zeroSite(), incentiveCount: 4 }).score).toBe(4);
    expect(computeSitePriority({ ...zeroSite(), incentiveCount: 9 }).score).toBe(4);
  });

  it("adds +2 for sqft >= 10000, +1 for >= 5000, +0 below / at 0 / null", () => {
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 15000 }).score).toBe(2);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 10000 }).score).toBe(2);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 9999 }).score).toBe(1);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 5000 }).score).toBe(1);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 4999 }).score).toBe(0);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: 0 }).score).toBe(0);
    expect(computeSitePriority({ ...zeroSite(), squareFeet: null }).score).toBe(0);
  });

  it("adds +2 for city_public owner OR city_owned status (not stacked)", () => {
    expect(computeSitePriority({ ...zeroSite(), ownerType: "city_public" }).score).toBe(2);
    expect(computeSitePriority({ ...zeroSite(), status: "city_owned" }).score).toBe(2);
    // Both conditions true -> still a single +2, never +4.
    expect(
      computeSitePriority({ ...zeroSite(), ownerType: "city_public", status: "city_owned" }).score,
    ).toBe(2);
  });

  it("adds +1 only for a vacant_building with an active 311 case (reported_open)", () => {
    expect(
      computeSitePriority({ ...zeroSite(), propertyType: "vacant_building", status: "reported_open" }).score,
    ).toBe(1);
    // vacant_building without the open case -> no bonus.
    expect(
      computeSitePriority({ ...zeroSite(), propertyType: "vacant_building", status: "reported" }).score,
    ).toBe(0);
    // vacant_land with an open case -> no bonus.
    expect(
      computeSitePriority({ ...zeroSite(), propertyType: "vacant_land", status: "reported_open" }).score,
    ).toBe(0);
  });

  it("combines terms and assigns the tier at the boundary (>= 6 high)", () => {
    // 4 (incentive) + 2 (sqft>=10k) = 6 -> high
    const high = computeSitePriority({ ...zeroSite(), incentiveCount: 4, squareFeet: 12000 });
    expect(high.score).toBe(6);
    expect(high.tier).toBe("high");
    // 2 (incentive) + 1 (sqft>=5k) = 3 -> medium
    const med = computeSitePriority({ ...zeroSite(), incentiveCount: 2, squareFeet: 6000 });
    expect(med.score).toBe(3);
    expect(med.tier).toBe("medium");
  });
});

describe("priorityTierForScore boundaries", () => {
  it("maps scores to tiers at the exact cutoffs", () => {
    expect(priorityTierForScore(0)).toBe("low");
    expect(priorityTierForScore(2)).toBe("low");
    expect(priorityTierForScore(3)).toBe("medium");
    expect(priorityTierForScore(5)).toBe("medium");
    expect(priorityTierForScore(6)).toBe("high");
    expect(priorityTierForScore(99)).toBe("high");
  });
});

describe("nextStepForSite (all six branches)", () => {
  it("routes city_public to a disposition inquiry", () => {
    expect(nextStepForSite({ ownerType: "city_public", propertyType: "vacant_land" })).toBe(
      "City/CCLBA disposition inquiry",
    );
  });
  it("routes corporate_llc to entity outreach via the Owner File", () => {
    expect(nextStepForSite({ ownerType: "corporate_llc", propertyType: "vacant_land" })).toBe(
      "Entity outreach — open the admin Owner File",
    );
  });
  it("routes out_of_state to entity outreach plus a local-agent step", () => {
    expect(nextStepForSite({ ownerType: "out_of_state", propertyType: "vacant_building" })).toBe(
      "Entity outreach — open the admin Owner File; identify local agent",
    );
  });
  it("routes local_private to direct contact with no automated letter", () => {
    expect(nextStepForSite({ ownerType: "local_private", propertyType: "vacant_land" })).toBe(
      "Direct owner contact (individual owner — no automated letter)",
    );
  });
  it("routes an unknown-owner vacant_building to assessor + 311 verification", () => {
    expect(nextStepForSite({ ownerType: "unknown", propertyType: "vacant_building" })).toBe(
      "Verify ownership via Assessor/Recorder; check 311 case status",
    );
  });
  it("routes an unknown-owner vacant_land to assessor verification", () => {
    expect(nextStepForSite({ ownerType: "unknown", propertyType: "vacant_land" })).toBe(
      "Verify ownership via Cook County Assessor",
    );
  });
});

describe("assignQuantileDots", () => {
  it("preserves nulls at their index and excludes them from the cohort", () => {
    const dots = assignQuantileDots([null, 5, 10, null, 1]);
    expect(dots[0]).toBeNull();
    expect(dots[3]).toBeNull();
    // Non-null values ranked among {1,5,10}: 1 lowest, 5 median, 10 highest.
    expect(dots[4]).toBe(1);
    expect(dots[1]).toBe(3);
    expect(dots[2]).toBe(5);
  });

  it("gives tied values the same bin", () => {
    const dots = assignQuantileDots([10, 10, 20]);
    expect(dots[0]).toBe(dots[1]); // the two 10s share a bin
    expect(dots[2]!).toBeGreaterThan(dots[0]!); // 20 ranks higher
  });

  it("settles an all-equal cohort on the middle bin", () => {
    expect(assignQuantileDots([7, 7, 7, 7, 7])).toEqual([3, 3, 3, 3, 3]);
  });

  it("handles small-N and empty/all-null cohorts", () => {
    expect(assignQuantileDots([])).toEqual([]);
    expect(assignQuantileDots([null, null])).toEqual([null, null]);
    expect(assignQuantileDots([42])).toEqual([3]); // single value -> middle bin
  });

  it("spreads nine distinct values into symmetric quintiles ranked by value", () => {
    // Ascending input.
    expect(assignQuantileDots([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
    // Descending input -> dots follow the VALUE, not the index position.
    expect(assignQuantileDots([90, 80, 70, 60, 50, 40, 30, 20, 10])).toEqual([
      5, 5, 4, 4, 3, 2, 2, 1, 1,
    ]);
  });

  it("keeps every dot within 1..5", () => {
    const dots = assignQuantileDots([3, 1, 4, 1, 5, 9, 2, 6]);
    for (const d of dots) {
      expect(d).not.toBeNull();
      expect(d!).toBeGreaterThanOrEqual(1);
      expect(d!).toBeLessThanOrEqual(5);
    }
  });
});

describe("rankSites (deterministic ordering)", () => {
  const site = (over: Partial<RankableSite> & { id: string }): RankableSite => ({
    priorityScore: 0,
    incentiveCount: 0,
    squareFeet: null,
    ...over,
  });

  it("orders by priorityScore desc first", () => {
    const ranked = rankSites([site({ id: "a", priorityScore: 5 }), site({ id: "b", priorityScore: 6 })]);
    expect(ranked.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("breaks a score tie by incentiveCount desc", () => {
    const ranked = rankSites([
      site({ id: "a", priorityScore: 4, incentiveCount: 1 }),
      site({ id: "b", priorityScore: 4, incentiveCount: 3 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("breaks a score+incentive tie by sqft desc with nulls last", () => {
    const ranked = rankSites([
      site({ id: "nullsqft", priorityScore: 4, incentiveCount: 2, squareFeet: null }),
      site({ id: "small", priorityScore: 4, incentiveCount: 2, squareFeet: 500 }),
      site({ id: "big", priorityScore: 4, incentiveCount: 2, squareFeet: 9000 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(["big", "small", "nullsqft"]);
  });

  it("falls back to id asc on a full tie", () => {
    const ranked = rankSites([
      site({ id: "zebra", priorityScore: 3, incentiveCount: 1, squareFeet: 100 }),
      site({ id: "alpha", priorityScore: 3, incentiveCount: 1, squareFeet: 100 }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(["alpha", "zebra"]);
  });

  it("does not mutate its input", () => {
    const input = [site({ id: "b", priorityScore: 1 }), site({ id: "a", priorityScore: 2 })];
    const copy = [...input];
    rankSites(input);
    expect(input).toEqual(copy);
  });

  it("compareRankableSites sorts nulls last within a size tiebreak", () => {
    expect(
      compareRankableSites(
        { id: "x", priorityScore: 1, incentiveCount: 0, squareFeet: null },
        { id: "y", priorityScore: 1, incentiveCount: 0, squareFeet: 10 },
      ),
    ).toBeGreaterThan(0);
  });
});

describe("compareDirectoryRows / buildDirectoryRows", () => {
  const dirSite = (over: Partial<DirectoryInputSite>): DirectoryInputSite => ({
    address: "100 N Main St",
    ownerType: "unknown" as OwnerType,
    propertyType: "vacant_land" as VacancyPropertyType,
    priorityTier: "low" as VacancyPriorityTier,
    priorityScore: 0,
    saleYear: null,
    violation: false,
    ...over,
  });

  it("compareDirectoryRows sorts priorityScore desc then address asc", () => {
    const a: VacancyDirectoryRow = {
      address: "900 W End Ave",
      ownerType: "unknown",
      propertyType: "vacant_land",
      priorityTier: "low",
      priorityScore: 2,
      saleYear: null,
      violation: false,
    };
    const b: VacancyDirectoryRow = { ...a, address: "100 A St", priorityScore: 5 };
    const c: VacancyDirectoryRow = { ...a, address: "050 A St", priorityScore: 5 };
    // Higher score first.
    expect(compareDirectoryRows(a, b)).toBeGreaterThan(0);
    expect(compareDirectoryRows(b, a)).toBeLessThan(0);
    // Same score -> address asc.
    expect(compareDirectoryRows(b, c)).toBeGreaterThan(0); // "100" after "050"
    expect(compareDirectoryRows(c, c)).toBe(0);
  });

  it("keeps rows with a usable address, sorted, and counts the excluded ones", () => {
    const { rows, excludedNoAddressCount } = buildDirectoryRows([
      dirSite({ address: "300 Low St", priorityScore: 1 }),
      dirSite({ address: "  ", priorityScore: 9 }), // whitespace -> excluded
      dirSite({ address: null, priorityScore: 9 }), // null -> excluded
      dirSite({ address: "100 High St", priorityScore: 6 }),
      dirSite({ address: "200 High St", priorityScore: 6 }),
    ]);
    expect(excludedNoAddressCount).toBe(2);
    expect(rows.map((r) => r.address)).toEqual(["100 High St", "200 High St", "300 Low St"]);
    // Address is trimmed on the way in and only allowed keys survive.
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([
        "address",
        "ownerType",
        "priorityScore",
        "priorityTier",
        "propertyType",
        "saleYear",
        "violation",
      ]);
    }
  });

  it("trims surrounding whitespace on retained addresses", () => {
    const { rows, excludedNoAddressCount } = buildDirectoryRows([
      dirSite({ address: "  742 Evergreen Terrace  " }),
    ]);
    expect(excludedNoAddressCount).toBe(0);
    expect(rows[0].address).toBe("742 Evergreen Terrace");
  });

  it("returns an empty directory (no throw) for an all-excluded input", () => {
    const { rows, excludedNoAddressCount } = buildDirectoryRows([
      dirSite({ address: null }),
      dirSite({ address: "" }),
    ]);
    expect(rows).toEqual([]);
    expect(excludedNoAddressCount).toBe(2);
  });
});

describe("tallyOwnerTypeCounts", () => {
  it("lists all five owner types in order, with honest zero counts", () => {
    const counts = tallyOwnerTypeCounts(["corporate_llc", "corporate_llc", "unknown", null]);
    expect(counts.map((c) => c.ownerType)).toEqual(OWNER_TYPE_ORDER);
    const byType = Object.fromEntries(counts.map((c) => [c.ownerType, c.count]));
    expect(byType.corporate_llc).toBe(2);
    expect(byType.unknown).toBe(2); // the null normalizes to "unknown"
    expect(byType.out_of_state).toBe(0); // absent type still renders as a real 0
    expect(byType.local_private).toBe(0);
    expect(byType.city_public).toBe(0);
  });
});

describe("reconcileVacantLandOwnership", () => {
  const byType = (series: { ownerType: OwnerType; count: number }[]) =>
    Object.fromEntries(series.map((c) => [c.ownerType, c.count])) as Record<OwnerType, number>;

  it("covers all five owner types in order with honest zeros", () => {
    const { series } = reconcileVacantLandOwnership([], new Set());
    expect(series.map((c) => c.ownerType)).toEqual(OWNER_TYPE_ORDER);
    for (const c of series) expect(c.count).toBe(0);
  });

  it("empty inventory leaves every classification untouched (no reclassification)", () => {
    const rows = [
      { pin: "1", ownerType: "corporate_llc" },
      { pin: "2", ownerType: "local_private" },
      { pin: "3", ownerType: "city_public" },
    ];
    const { series, stats } = reconcileVacantLandOwnership(rows, new Set());
    const counts = byType(series);
    expect(counts.corporate_llc).toBe(1);
    expect(counts.local_private).toBe(1);
    expect(counts.city_public).toBe(1);
    expect(stats.cityPinMatches).toBe(0);
    expect(stats.reclassifiedCount).toBe(0);
    expect(stats.inventoryUnmatchedCount).toBe(0);
  });

  it("reclassifies matched non-city parcels to city_public and counts them", () => {
    const rows = [
      { pin: "10", ownerType: "corporate_llc" }, // in inventory -> reclassified
      { pin: "11", ownerType: "local_private" }, // in inventory -> reclassified
      { pin: "12", ownerType: "city_public" }, // in inventory but ALREADY city -> matched, not reclassified
      { pin: "13", ownerType: "out_of_state" }, // not in inventory -> unchanged
    ];
    const inventory = new Set(["10", "11", "12"]);
    const { series, stats } = reconcileVacantLandOwnership(rows, inventory);
    const counts = byType(series);
    expect(counts.city_public).toBe(3); // 10, 11, 12 all city now
    expect(counts.corporate_llc).toBe(0);
    expect(counts.local_private).toBe(0);
    expect(counts.out_of_state).toBe(1); // 13 kept
    expect(stats.cityPinMatches).toBe(3); // 10, 11, 12
    expect(stats.reclassifiedCount).toBe(2); // 10, 11 (12 was already city)
    expect(stats.inventoryUnmatchedCount).toBe(0); // every inventory pin has an assessor parcel
  });

  it("full overlap reclassifies the whole taxpayer series to city_public", () => {
    const rows = [
      { pin: "a", ownerType: "corporate_llc" },
      { pin: "b", ownerType: "unknown" },
    ];
    const { series, stats } = reconcileVacantLandOwnership(rows, new Set(["a", "b"]));
    expect(byType(series).city_public).toBe(2);
    expect(stats.cityPinMatches).toBe(2);
    expect(stats.reclassifiedCount).toBe(2);
    expect(stats.inventoryUnmatchedCount).toBe(0);
  });

  it("counts inventory pins with no assessor parcel as inventoryUnmatchedCount", () => {
    // South-Chicago shape: many City-inventory pins, few assessor vacant parcels.
    const rows = [{ pin: "100", ownerType: "corporate_llc" }];
    const inventory = new Set(["100", "200", "300", "400"]); // 3 have no assessor row
    const { stats } = reconcileVacantLandOwnership(rows, inventory);
    expect(stats.cityPinMatches).toBe(1); // only 100 matched
    expect(stats.reclassifiedCount).toBe(1); // 100 was corporate -> city
    expect(stats.inventoryUnmatchedCount).toBe(3); // 200, 300, 400
  });

  it("normalizes unrecognized/blank taxpayer types to unknown and ignores blank pins", () => {
    const rows = [
      { pin: "", ownerType: "corporate_llc" }, // blank pin never matches inventory
      { pin: "x", ownerType: null }, // null -> unknown
      { pin: "y", ownerType: "bogus_value" }, // unrecognized -> unknown
    ];
    const { series, stats } = reconcileVacantLandOwnership(rows, new Set(["z"]));
    const counts = byType(series);
    expect(counts.corporate_llc).toBe(1); // blank-pin row kept its type
    expect(counts.unknown).toBe(2);
    expect(stats.cityPinMatches).toBe(0);
    expect(stats.inventoryUnmatchedCount).toBe(1); // z had no assessor parcel
  });
});

describe("reconcileOwnerTypeForPin (per-point classifier)", () => {
  it("returns city_public when the pin is in the inventory, overriding the taxpayer type", () => {
    const inv = new Set(["123"]);
    expect(reconcileOwnerTypeForPin("123", "corporate_llc", inv)).toBe("city_public");
    expect(reconcileOwnerTypeForPin("123", "local_private", inv)).toBe("city_public");
    expect(reconcileOwnerTypeForPin("123", null, inv)).toBe("city_public");
  });

  it("keeps the normalized taxpayer type when the pin is not in the inventory", () => {
    const inv = new Set(["123"]);
    expect(reconcileOwnerTypeForPin("999", "corporate_llc", inv)).toBe("corporate_llc");
    expect(reconcileOwnerTypeForPin("999", "bogus_value", inv)).toBe("unknown");
    expect(reconcileOwnerTypeForPin("999", null, inv)).toBe("unknown");
  });

  it("never matches a blank/nullish pin", () => {
    expect(reconcileOwnerTypeForPin("", "corporate_llc", new Set([""]))).toBe("corporate_llc");
    expect(reconcileOwnerTypeForPin(null, "local_private", new Set(["1"]))).toBe("local_private");
  });

  it("agrees with reconcileVacantLandOwnership's tally on the same rows", () => {
    const rows = [
      { pin: "10", ownerType: "corporate_llc" },
      { pin: "13", ownerType: "out_of_state" },
    ];
    const inv = new Set(["10"]);
    const perPoint = rows.map((r) => reconcileOwnerTypeForPin(r.pin, r.ownerType, inv));
    expect(perPoint).toEqual(["city_public", "out_of_state"]);
    const { series } = reconcileVacantLandOwnership(rows, inv);
    const byType = Object.fromEntries(series.map((c) => [c.ownerType, c.count]));
    expect(byType.city_public).toBe(1);
    expect(byType.out_of_state).toBe(1);
  });
});

describe("latestSaleYearForPin (per-point tax-sale flag)", () => {
  const map = new Map<string, number[]>([
    ["a", [2019, 2021, 2015]],
    ["b", []], // record exists but no parseable year
  ]);

  it("returns the max year for a matched pin", () => {
    expect(latestSaleYearForPin("a", map)).toBe(2021);
  });

  it("returns null for a record with no parseable year", () => {
    expect(latestSaleYearForPin("b", map)).toBeNull();
  });

  it("returns null for an unmatched, blank, or nullish pin", () => {
    expect(latestSaleYearForPin("z", map)).toBeNull();
    expect(latestSaleYearForPin("", map)).toBeNull();
    expect(latestSaleYearForPin(null, map)).toBeNull();
  });

  it("returns null when the tables were absent (map null)", () => {
    expect(latestSaleYearForPin("a", null)).toBeNull();
  });
});

describe("addressHasViolation (per-point violation flag)", () => {
  const set = new Set(["100nmainst", "200noakst"]);

  it("is true for a matching normalized address", () => {
    expect(addressHasViolation("100nmainst", set)).toBe(true);
  });

  it("is false for a non-matching or blank address", () => {
    expect(addressHasViolation("999nowhere", set)).toBe(false);
    expect(addressHasViolation("", set)).toBe(false);
  });

  it("is false (never fabricated) when the set is absent", () => {
    expect(addressHasViolation("100nmainst", null)).toBe(false);
  });
});

describe("taxSaleExposureForVacantPins", () => {
  it("returns null fields when the tables are absent (map null)", () => {
    expect(taxSaleExposureForVacantPins(new Set(["1"]), null)).toEqual({
      taxSaleExposedCount: null,
      latestTaxSaleYear: null,
    });
  });

  it("counts membership (even a null-year record) and finds the latest year", () => {
    const map = new Map<string, number[]>([
      ["a", [2019, 2021]],
      ["b", []], // record exists but no parseable year
      ["c", [2015]],
    ]);
    const res = taxSaleExposureForVacantPins(new Set(["a", "b", "d"]), map);
    expect(res.taxSaleExposedCount).toBe(2); // a and b (d absent)
    expect(res.latestTaxSaleYear).toBe(2021);
  });

  it("is an honest zero when the map ran but no vacant pin matched", () => {
    const map = new Map<string, number[]>([["x", [2020]]]);
    expect(taxSaleExposureForVacantPins(new Set(["y", "z"]), map)).toEqual({
      taxSaleExposedCount: 0,
      latestTaxSaleYear: null,
    });
  });
});

describe("countAddressesInSet", () => {
  it("returns null when the violation set is absent", () => {
    expect(countAddressesInSet(["abc"], null)).toBeNull();
  });

  it("counts one per matching row (repeats count), skipping blanks", () => {
    const set = new Set(["100nmainst", "200noakst"]);
    const rows = ["100nmainst", "100nmainst", "999nowhere", "", "200noakst"];
    expect(countAddressesInSet(rows, set)).toBe(3); // two hits on main + one on oak
  });

  it("is an honest zero when the set ran but nothing matched", () => {
    expect(countAddressesInSet(["a", "b"], new Set(["c"]))).toBe(0);
  });
});

describe("printed-copy constants", () => {
  it("MATRIX_METHOD_NOTE states the quintiles-are-not-grades caveat", () => {
    expect(MATRIX_METHOD_NOTE).toContain("quintiles");
    expect(MATRIX_METHOD_NOTE).toContain("not citywide scores or grades");
  });
  it("editionGeographyNote names the ZIP, neighborhood, and the boundary caveat", () => {
    const note = editionGeographyNote("60624", "West Garfield Park");
    expect(note).toContain("ZIP 60624");
    expect(note).toContain("West Garfield Park");
    expect(note).toContain("do not align exactly");
  });
});

// ── Portfolios (D1) ──────────────────────────────────────────────────────────

describe("portfolioForSite (every branch)", () => {
  const base = {
    ownerType: "corporate_llc" as OwnerType,
    priorityTier: "high" as VacancyPriorityTier,
    saleYear: null as number | null,
    violation: false,
  };

  it("routes an unknown owner to verify regardless of priority or tax sale", () => {
    expect(portfolioForSite({ ...base, ownerType: "unknown" })).toBe("verify");
    expect(portfolioForSite({ ...base, ownerType: "unknown", priorityTier: "low", saleYear: 2020 })).toBe("verify");
  });

  it("routes a tax-sale-exposed non-city parcel to verify (title risk before outreach)", () => {
    expect(portfolioForSite({ ...base, ownerType: "corporate_llc", saleYear: 2019 })).toBe("verify");
    expect(portfolioForSite({ ...base, ownerType: "local_private", saleYear: 2021 })).toBe("verify");
    // A tax-sale-exposed CITY parcel is NOT diverted to verify (city carve-out).
    expect(portfolioForSite({ ...base, ownerType: "city_public", saleYear: 2019 })).toBe("move_now");
  });

  it("routes city_public at high|medium priority to move_now", () => {
    expect(portfolioForSite({ ...base, ownerType: "city_public", priorityTier: "high" })).toBe("move_now");
    expect(portfolioForSite({ ...base, ownerType: "city_public", priorityTier: "medium" })).toBe("move_now");
  });

  it("routes a known private/entity owner at high|medium priority to organize_next", () => {
    for (const ownerType of ["local_private", "corporate_llc", "out_of_state"] as OwnerType[]) {
      expect(portfolioForSite({ ...base, ownerType, priorityTier: "high" })).toBe("organize_next");
      expect(portfolioForSite({ ...base, ownerType, priorityTier: "medium" })).toBe("organize_next");
    }
  });

  it("routes everything else to long_term (low-priority known owners, low-priority city)", () => {
    expect(portfolioForSite({ ...base, ownerType: "corporate_llc", priorityTier: "low" })).toBe("long_term");
    expect(portfolioForSite({ ...base, ownerType: "local_private", priorityTier: "low" })).toBe("long_term");
    expect(portfolioForSite({ ...base, ownerType: "out_of_state", priorityTier: "low" })).toBe("long_term");
    expect(portfolioForSite({ ...base, ownerType: "city_public", priorityTier: "low" })).toBe("long_term");
  });

  it("violation does not change the bucket (not a determinant in the current rubric)", () => {
    expect(portfolioForSite({ ...base, ownerType: "corporate_llc", priorityTier: "low", violation: true })).toBe(
      "long_term",
    );
    expect(portfolioForSite({ ...base, ownerType: "city_public", priorityTier: "high", violation: true })).toBe(
      "move_now",
    );
  });

  it("labels, order, and rubric note are coherent", () => {
    expect(PORTFOLIO_ORDER).toEqual(["move_now", "organize_next", "verify", "long_term"]);
    expect(PORTFOLIO_LABELS).toEqual({
      move_now: "Move now",
      organize_next: "Organize next",
      verify: "Verify",
      long_term: "Long-term",
    });
    for (const label of Object.values(PORTFOLIO_LABELS)) expect(PORTFOLIO_RUBRIC_NOTE).toContain(label);
  });
});

describe("tallyPortfolioCounts", () => {
  it("covers all four portfolios with honest zeros", () => {
    const counts = tallyPortfolioCounts(["verify", "verify", "move_now"] as VacancyPortfolio[]);
    expect(counts).toEqual({ move_now: 1, organize_next: 0, verify: 2, long_term: 0 });
  });
});

// ── Spatial helpers ──────────────────────────────────────────────────────────

describe("haversineMeters", () => {
  it("is ~0 for identical points and symmetric", () => {
    expect(haversineMeters(41.85, -87.65, 41.85, -87.65)).toBeCloseTo(0, 5);
    expect(haversineMeters(41.85, -87.65, 41.86, -87.64)).toBeCloseTo(
      haversineMeters(41.86, -87.64, 41.85, -87.65),
      6,
    );
  });

  it("measures a ~111 m north step of 0.001° latitude", () => {
    const d = haversineMeters(41.85, -87.65, 41.851, -87.65);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
  });
});

describe("bboxIntersects", () => {
  it("detects overlap, touching, and separation", () => {
    expect(bboxIntersects([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
    expect(bboxIntersects([0, 0, 2, 2], [2, 2, 4, 4])).toBe(true); // touching counts
    expect(bboxIntersects([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false);
    expect(bboxIntersects([0, 0, 1, 1], [0.5, 5, 1.5, 6])).toBe(false); // lat-disjoint
  });
});

describe("corridorRefsIntersectingBbox / nearestCorridorName", () => {
  // A unit square corridor around (−87.65, 41.85), ±0.01°.
  const square: CorridorPolygon = {
    name: "Test Corridor",
    kind: "commercial",
    bbox: [-87.66, 41.84, -87.64, 41.86],
    rings: [
      [
        [-87.66, 41.84],
        [-87.64, 41.84],
        [-87.64, 41.86],
        [-87.66, 41.86],
        [-87.66, 41.84],
      ],
    ],
  };
  const faraway: CorridorPolygon = {
    name: "Faraway SSA",
    kind: "ssa",
    bbox: [-87.5, 41.7, -87.49, 41.71],
    rings: [
      [
        [-87.5, 41.7],
        [-87.49, 41.7],
        [-87.49, 41.71],
        [-87.5, 41.71],
        [-87.5, 41.7],
      ],
    ],
  };

  it("lists corridors whose bbox overlaps and dedupes by name", () => {
    const dupe = { ...square, kind: "industrial" as const };
    const refs = corridorRefsIntersectingBbox([square, dupe, faraway], [-87.655, 41.845, -87.645, 41.855]);
    expect(refs).toEqual([{ name: "Test Corridor", kind: "commercial" }]);
  });

  it("returns the containing corridor's name for an interior point", () => {
    expect(nearestCorridorName(41.85, -87.65, [square, faraway])).toBe("Test Corridor");
  });

  it("returns the nearest corridor within maxMeters for an exterior point", () => {
    // ~100 m east of the square's right edge (0.001° lon ≈ 83 m at this lat).
    expect(nearestCorridorName(41.85, -87.639, [square], 400)).toBe("Test Corridor");
  });

  it("returns null when nothing is within maxMeters", () => {
    // ~1 km east — outside the 400 m threshold.
    expect(nearestCorridorName(41.85, -87.628, [square], 400)).toBeNull();
    expect(nearestCorridorName(41.85, -87.65, [], 400)).toBeNull();
  });
});

// ── Vacancy clusters (D2) ────────────────────────────────────────────────────

describe("clusterVacantSites", () => {
  const site = (
    lat: number,
    lon: number,
    over: Partial<ClusterInputSite> = {},
  ): ClusterInputSite => ({
    lat,
    lon,
    ownerType: "unknown",
    portfolio: "long_term",
    taxSale: false,
    violation: false,
    propertyType: "vacant_building",
    ...over,
  });

  // Two tight groups ~4 km apart, plus two isolated noise points.
  const groupA = Array.from({ length: 6 }, (_, i) => site(41.8500 + i * 0.0002, -87.6500 + i * 0.0002));
  const groupB = Array.from({ length: 5 }, (_, i) => site(41.8800 + i * 0.0002, -87.6200 + i * 0.0002));
  const noise = [site(41.9000, -87.7000), site(41.7000, -87.5500)];

  it("finds two clusters, drops sub-minSize noise", () => {
    const clusters = clusterVacantSites([...groupA, ...noise, ...groupB]);
    expect(clusters).toHaveLength(2);
    // Ordered by count desc: groupA (6) before groupB (5).
    expect(clusters[0].count).toBe(6);
    expect(clusters[1].count).toBe(5);
    expect(clusters[0].id).toBe(1);
    expect(clusters[1].id).toBe(2);
    // Every plotted site is land or building accounted for.
    for (const c of clusters) {
      expect(c.vacantLandCount + c.vacantBuildingCount).toBe(c.count);
      expect(c.bbox[0]).toBeLessThanOrEqual(c.bbox[2]);
      expect(c.bbox[1]).toBeLessThanOrEqual(c.bbox[3]);
      expect(c.corridorName).toBeNull(); // filled by the export, not this fn
    }
  });

  it("is deterministic under input shuffling (same clusters, same order)", () => {
    const input = [...groupA, ...noise, ...groupB];
    const shuffled = [...input].reverse();
    const a = clusterVacantSites(input);
    const b = clusterVacantSites(shuffled);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("honors a custom minSize (drops a group that no longer qualifies)", () => {
    // minSize 6 keeps only groupA.
    const clusters = clusterVacantSites([...groupA, ...groupB], { minSize: 6 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(6);
  });

  it("honors a tighter linkMeters (splits a loose group)", () => {
    // Points spaced ~50 m apart; a 10 m link can't join them → no cluster.
    const loose = Array.from({ length: 6 }, (_, i) => site(41.85 + i * 0.0005, -87.65));
    expect(clusterVacantSites(loose, { linkMeters: 10 })).toHaveLength(0);
  });

  it("aggregates owner types, portfolios, and distress within a cluster", () => {
    const rows = [
      site(41.85, -87.65, { ownerType: "city_public", portfolio: "move_now", taxSale: true, propertyType: "vacant_land" }),
      site(41.8501, -87.6501, { ownerType: "corporate_llc", portfolio: "organize_next", violation: true }),
      site(41.8502, -87.6502, { ownerType: "unknown", portfolio: "verify" }),
      site(41.8503, -87.6503, { ownerType: "local_private", portfolio: "long_term" }),
      site(41.8504, -87.6504, { ownerType: "unknown", portfolio: "verify", taxSale: true }),
    ];
    const [c] = clusterVacantSites(rows);
    expect(c.count).toBe(5);
    expect(c.taxSaleCount).toBe(2);
    expect(c.violationCount).toBe(1);
    expect(c.vacantLandCount).toBe(1);
    expect(c.vacantBuildingCount).toBe(4);
    expect(c.portfolioCounts).toEqual({ move_now: 1, organize_next: 1, verify: 2, long_term: 1 });
    // ownerTypeCounts lists all five owner types (honest zeros).
    expect(c.ownerTypeCounts.map((o) => o.ownerType)).toEqual(OWNER_TYPE_ORDER);
    const byOwner = Object.fromEntries(c.ownerTypeCounts.map((o) => [o.ownerType, o.count]));
    expect(byOwner.city_public).toBe(1);
    expect(byOwner.corporate_llc).toBe(1);
    expect(byOwner.unknown).toBe(2);
  });

  it("returns an empty array for empty input", () => {
    expect(clusterVacantSites([])).toEqual([]);
  });

  // ── Extent cap (anti-chaining) ──

  /** Bbox extents in metres (lat axis, lon axis via cos(midLat)). */
  const bboxExtentsMeters = (bbox: [number, number, number, number]) => {
    const [w, s, e, n] = bbox;
    const midLat = (s + n) / 2;
    return {
      latM: (n - s) * 111320,
      lonM: (e - w) * 111320 * Math.cos((midLat * Math.PI) / 180),
    };
  };

  // A straight north–south chain: 24 points at 50 m spacing (~1,150 m long),
  // placed well away from groupA/groupB/noise so it stays its own linkage
  // group. Every adjacent pair links at the default 100 m, so single-linkage
  // would union the whole chain into one blob without the extent cap.
  const LAT_STEP_50M = 50 / 111320;
  const chain = Array.from({ length: 24 }, (_, i) => site(41.95 + i * LAT_STEP_50M, -87.73));

  it("splits an over-extent chain into sub-areas, each within maxExtentMeters", () => {
    const clusters = clusterVacantSites(chain);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    const EPS = 1; // metre slack on the extent assertion
    let accounted = 0;
    for (const c of clusters) {
      const { latM, lonM } = bboxExtentsMeters(c.bbox);
      expect(latM).toBeLessThanOrEqual(500 + EPS);
      expect(lonM).toBeLessThanOrEqual(500 + EPS);
      expect(c.count).toBeGreaterThanOrEqual(5); // every kept piece >= minSize
      accounted += c.count;
    }
    // Every point is either in a >= minSize piece or dropped, never duplicated.
    expect(accounted).toBeLessThanOrEqual(chain.length);
    // For this even chain the floor(n/2) bisection yields 4 pieces of 6 —
    // all >= minSize, so nothing drops.
    expect(accounted).toBe(24);
    expect(clusters.map((c) => c.count)).toEqual([6, 6, 6, 6]);
  });

  it("honors a custom maxExtentMeters (no split when the cap allows the chain)", () => {
    const clusters = clusterVacantSites(chain, { maxExtentMeters: 2000 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(24);
  });

  it("is deterministic under input shuffling WITH splitting engaged", () => {
    const input = [...chain, ...groupA, ...noise];
    const shuffled = [...input].reverse();
    const a = clusterVacantSites(input);
    const b = clusterVacantSites(shuffled);
    expect(a.length).toBeGreaterThanOrEqual(5); // 4 chain pieces + groupA
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("CLUSTERS_NOTE discloses the link distance, extent cap, and analytical boundary", () => {
    expect(CLUSTERS_NOTE).toContain("100");
    expect(CLUSTERS_NOTE).toContain("500");
    expect(CLUSTERS_NOTE).toContain("sub-areas");
    expect(CLUSTERS_NOTE).toContain("analytical");
    expect(CLUSTERS_NOTE).toContain("five");
  });
});

// ── Committed-export guards ──────────────────────────────────────────────────
// These mirror lib/__tests__/corridor-owners.test.ts's committed-export guard.
// They stay skipped until scripts/export-vacancy-index.ts is run on a refresh
// branch and public/data/vacancy-index.json is committed; then they hard-run.

const EXPORT_PATH = path.join(process.cwd(), "public/data/vacancy-index.json");
const EXPORT_EXISTS = existsSync(EXPORT_PATH);

const DIRECTORY_DIR = path.join(process.cwd(), "public/data/vacancy-directory");
const DIRECTORY_60617_PATH = path.join(DIRECTORY_DIR, "60617.json");
const DIRECTORY_EXISTS = existsSync(DIRECTORY_60617_PATH);

const PILOT_ZIP_KEYS = [
  "60617",
  "60619",
  "60649",
  "60624",
  "60623",
  "60644",
  "60651",
  "60621",
  "60636",
];

/** The complete set of keys any object in the export is allowed to carry.
 * A stray key (e.g. a leaked ownerName) trips this walk as well as the
 * forbidden-substring scan below. */
const ALLOWED_KEYS = new Set<string>([
  // top level
  "generatedAt",
  "sources",
  "editions",
  "matrix",
  // sources
  "trackedInventory",
  "vacantLandOwnership",
  "corridorMetrics",
  "zipBoundaries",
  "transportNetwork",
  "asOf",
  // edition
  "zip",
  "neighborhood",
  "secondaryAreas",
  "editionNumber",
  "headline",
  "ownership",
  "sitePoints",
  "sitePointsTruncated",
  "siteIndex",
  "landPoints",
  "landPointsTruncated",
  "landPointsTotal",
  "directoryCount",
  "boundary",
  "centroid",
  "transport",
  // spatial-intelligence layer (D2/D3)
  "clusters",
  "clustersNote",
  "corridors",
  "anchors",
  // cluster
  "id",
  "portfolioCounts",
  "taxSaleCount",
  "violationCount",
  "vacantLandCount",
  "vacantBuildingCount",
  "corridorName",
  "ownerTypeCounts",
  "move_now",
  "organize_next",
  "verify",
  "long_term",
  // corridor ref / anchor
  "name",
  "category",
  // headline
  "vacantPropertyCount",
  "vacantLandCount",
  "vacantBuildingCount",
  "cityOwnedCount",
  "inIncentiveZoneCount",
  "priorityMix",
  "high",
  "medium",
  "low",
  // ownership
  "vacantLandParcelsByOwnerType",
  "vacantLandParcelTotal",
  "trackedInventoryByOwnerType",
  "reconciledVacantLandByOwnerType",
  "reconciliation",
  "cityPinMatches",
  "reclassifiedCount",
  "inventoryUnmatchedCount",
  "ownerType",
  "count",
  // distress
  "distress",
  "taxSaleExposedCount",
  "latestTaxSaleYear",
  "violationMatchCount",
  // site point / site index row
  "lat",
  "lon",
  "propertyType",
  "priorityTier",
  "markerNumber",
  "address",
  "zoningClass",
  "squareFeet",
  "incentiveCount",
  "priorityScore",
  "nextStep",
  "saleYear",
  "violation",
  // boundary / centroid / transport
  "rings",
  "bbox",
  "kind",
  "points",
  // matrix
  "editionNumber",
  "trackedVacantCount",
  "vacancyRate",
  "localOwnershipShare",
  "reportedBuildingShare",
  "cityOwnedShare",
  "value",
  "dots",
]);

function walkKeys(node: unknown, offenders: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walkKeys(item, offenders);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      // `editions` is a ZIP-keyed map — its immediate keys are data (ZIP
      // codes), not field names; validate the format and walk the values.
      if (key === "editions" && value && typeof value === "object" && !Array.isArray(value)) {
        for (const [zipKey, edition] of Object.entries(value)) {
          if (!/^\d{5}$/.test(zipKey)) offenders.add(zipKey);
          walkKeys(edition, offenders);
        }
        continue;
      }
      if (!ALLOWED_KEYS.has(key)) offenders.add(key);
      walkKeys(value, offenders);
    }
  }
}

describe.skipIf(!EXPORT_EXISTS)("committed vacancy-index.json", () => {
  const raw = EXPORT_EXISTS
    ? require("../../public/data/vacancy-index.json") // eslint-disable-line @typescript-eslint/no-require-imports
    : null;
  const data = raw as VacancyIndexExport;

  it("loads via the static loader and exposes every pilot edition", () => {
    const loaded = loadVacancyIndex();
    expect(loaded).not.toBeNull();
    for (const zip of PILOT_ZIP_KEYS) {
      expect(getVacancyIndexEdition(zip), `edition ${zip}`).not.toBeNull();
    }
  });

  it("contains none of the six forbidden owner-identifying substrings", () => {
    const serialized = JSON.stringify(data);
    for (const forbidden of [
      "ownerName",
      "owner_name",
      "ownerMailingAddress",
      "owner_mailing_address",
      "clusterKey",
      '"pins"',
    ]) {
      expect(serialized.includes(forbidden), `forbidden substring present: ${forbidden}`).toBe(false);
    }
  });

  it("carries only allowed keys (guards against field creep)", () => {
    const offenders = new Set<string>();
    walkKeys(data, offenders);
    expect([...offenders], "unexpected keys in export").toEqual([]);
  });

  it("has all nine pilot ZIP editions", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      expect(data.editions[zip], `missing edition ${zip}`).toBeTruthy();
    }
  });

  it("uses only the five OwnerType enum values everywhere an ownerType appears", () => {
    const valid = new Set<string>(OWNER_TYPE_ORDER);
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      for (const p of edition.sitePoints) expect(valid.has(p.ownerType)).toBe(true);
      for (const r of edition.siteIndex) expect(valid.has(r.ownerType)).toBe(true);
      for (const c of edition.ownership.trackedInventoryByOwnerType) expect(valid.has(c.ownerType)).toBe(true);
      if (edition.ownership.vacantLandParcelsByOwnerType) {
        for (const c of edition.ownership.vacantLandParcelsByOwnerType) expect(valid.has(c.ownerType)).toBe(true);
      }
      if (edition.ownership.reconciledVacantLandByOwnerType) {
        for (const c of edition.ownership.reconciledVacantLandByOwnerType) expect(valid.has(c.ownerType)).toBe(true);
      }
    }
  });

  it("keeps reconciled ownership null exactly when the raw parcels series is null, with sane stats", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      const raw = edition.ownership.vacantLandParcelsByOwnerType;
      const reconciled = edition.ownership.reconciledVacantLandByOwnerType;
      const reconciliation = edition.ownership.reconciliation;
      // Array-or-null, never undefined.
      expect(reconciled === null || Array.isArray(reconciled)).toBe(true);
      // Reconciliation is null iff the raw parcels series is null.
      expect(reconciled === null).toBe(raw === null);
      expect((reconciliation === null) === (raw === null)).toBe(true);
      if (reconciliation !== null) {
        expect(Number.isInteger(reconciliation.cityPinMatches)).toBe(true);
        expect(reconciliation.cityPinMatches).toBeGreaterThanOrEqual(0);
        expect(reconciliation.reclassifiedCount).toBeGreaterThanOrEqual(0);
        // Reclassified is a subset of the matched parcels.
        expect(reconciliation.reclassifiedCount).toBeLessThanOrEqual(reconciliation.cityPinMatches);
        expect(reconciliation.inventoryUnmatchedCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("carries landPoints null exactly when the raw parcels series is null, total matching, only {lat,lon,ownerType,saleYear} keys", () => {
    const valid = new Set<string>(OWNER_TYPE_ORDER);
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      const raw = edition.ownership.vacantLandParcelsByOwnerType;
      const lp = edition.landPoints;
      // Array-or-null, never undefined; null iff the raw parcels series is null.
      expect(lp === null || Array.isArray(lp)).toBe(true);
      expect(lp === null).toBe(raw === null);
      expect(typeof edition.landPointsTruncated).toBe("boolean");
      if (lp === null) {
        expect(edition.landPointsTotal).toBeNull();
      } else {
        // Full universe count matches the raw parcels total.
        expect(edition.landPointsTotal).toBe(edition.ownership.vacantLandParcelTotal);
        // Capped at 2000 and never more than the universe.
        expect(lp.length).toBeLessThanOrEqual(2000);
        expect(edition.landPointsTotal === null || lp.length <= edition.landPointsTotal).toBe(true);
        for (const p of lp) {
          expect(Object.keys(p).sort()).toEqual(["lat", "lon", "ownerType", "saleYear"]);
          expect(typeof p.lat).toBe("number");
          expect(typeof p.lon).toBe("number");
          expect(valid.has(p.ownerType)).toBe(true);
          expect(p.saleYear === null || typeof p.saleYear === "number").toBe(true);
        }
      }
    }
  });

  it("carries per-point distress on sitePoints (saleYear number-or-null, violation boolean)", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      for (const p of edition.sitePoints) {
        expect(p.saleYear === null || typeof p.saleYear === "number", `${zip} sitePoint.saleYear`).toBe(true);
        expect(typeof p.violation, `${zip} sitePoint.violation`).toBe("boolean");
      }
    }
  });

  it("carries distress as an object-or-null with number-or-null fields (never undefined)", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      const distress = edition.distress;
      expect(distress === null || typeof distress === "object").toBe(true);
      if (distress !== null) {
        for (const key of ["taxSaleExposedCount", "latestTaxSaleYear", "violationMatchCount"] as const) {
          const v = distress[key];
          expect(v === null || typeof v === "number", `${zip} distress.${key}`).toBe(true);
        }
      }
    }
  });

  it("has a nine-row matrix whose dots are 1..5 exactly when the value is non-null", () => {
    expect(data.matrix).toHaveLength(9);
    const metricKeys = [
      "trackedVacantCount",
      "vacancyRate",
      "localOwnershipShare",
      "reportedBuildingShare",
      "cityOwnedShare",
    ] as const;
    for (const row of data.matrix) {
      for (const key of metricKeys) {
        const cell = row[key];
        if (cell.value === null) {
          expect(cell.dots, `${row.zip} ${key} dots when value null`).toBeNull();
        } else {
          expect(typeof cell.value).toBe("number");
          expect(Number.isInteger(cell.dots), `${row.zip} ${key} dots integer`).toBe(true);
          expect(cell.dots!).toBeGreaterThanOrEqual(1);
          expect(cell.dots!).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("never leaves an array-or-null field undefined", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      expect(Array.isArray(edition.secondaryAreas)).toBe(true);
      expect(Array.isArray(edition.sitePoints)).toBe(true);
      expect(Array.isArray(edition.siteIndex)).toBe(true);
      expect(Array.isArray(edition.transport)).toBe(true);
      expect(Array.isArray(edition.ownership.trackedInventoryByOwnerType)).toBe(true);
      // Explicitly array-or-null, never undefined.
      const series = edition.ownership.vacantLandParcelsByOwnerType;
      expect(series === null || Array.isArray(series)).toBe(true);
      expect(edition.boundary === null || typeof edition.boundary === "object").toBe(true);
      expect(edition.ownership.vacantLandParcelTotal === null || typeof edition.ownership.vacantLandParcelTotal === "number").toBe(true);
    }
  });

  it("carries directoryCount as a non-negative integer on every edition", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      expect(Number.isInteger(edition.directoryCount), `${zip} directoryCount integer`).toBe(true);
      expect(edition.directoryCount, `${zip} directoryCount >= 0`).toBeGreaterThanOrEqual(0);
      // Never more than the full tracked universe (rows w/o a usable address drop out).
      expect(edition.directoryCount).toBeLessThanOrEqual(edition.headline.vacantPropertyCount);
    }
  });

  // ── Spatial layer (D2/D3): EXPECTED-RED until the export re-runs. ──

  it("carries clusters as a well-formed, count-desc array (<= 12) with a note", () => {
    const validOwner = new Set<string>(OWNER_TYPE_ORDER);
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      expect(Array.isArray(edition.clusters), `${zip} clusters is array`).toBe(true);
      expect(edition.clusters.length, `${zip} <= 12 clusters`).toBeLessThanOrEqual(12);
      expect(typeof edition.clustersNote, `${zip} clustersNote string`).toBe("string");
      let prevCount = Infinity;
      edition.clusters.forEach((c, i) => {
        expect(c.id, `${zip} cluster id`).toBe(i + 1); // 1..N by sort order
        expect(c.count).toBeGreaterThanOrEqual(5); // minSize
        expect(c.count).toBeLessThanOrEqual(prevCount); // count desc
        prevCount = c.count;
        expect(c.vacantLandCount + c.vacantBuildingCount, `${zip} cluster land+building = count`).toBe(c.count);
        expect(c.taxSaleCount).toBeGreaterThanOrEqual(0);
        expect(c.violationCount).toBeGreaterThanOrEqual(0);
        expect(c.bbox[0]).toBeLessThanOrEqual(c.bbox[2]);
        expect(c.bbox[1]).toBeLessThanOrEqual(c.bbox[3]);
        expect(c.corridorName === null || typeof c.corridorName === "string").toBe(true);
        for (const o of c.ownerTypeCounts) expect(validOwner.has(o.ownerType)).toBe(true);
        for (const key of ["move_now", "organize_next", "verify", "long_term"] as const) {
          expect(Number.isInteger(c.portfolioCounts[key]), `${zip} portfolioCounts.${key}`).toBe(true);
        }
      });
    }
  });

  it("carries corridors as a name/kind array (deduped, valid kinds)", () => {
    const validKind = new Set(["ssa", "commercial", "industrial"]);
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      expect(Array.isArray(edition.corridors), `${zip} corridors is array`).toBe(true);
      const names = new Set<string>();
      for (const c of edition.corridors) {
        expect(typeof c.name).toBe("string");
        expect(validKind.has(c.kind), `${zip} corridor kind ${c.kind}`).toBe(true);
        expect(names.has(c.name), `${zip} corridor dedupe ${c.name}`).toBe(false);
        names.add(c.name);
      }
    }
  });

  it("carries anchors as an array-or-null of {name,category,lat,lon}", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      const edition = data.editions[zip];
      if (!edition) continue;
      const anchors = edition.anchors;
      expect(anchors === null || Array.isArray(anchors), `${zip} anchors array-or-null`).toBe(true);
      if (anchors === null) continue;
      expect(anchors.length, `${zip} non-null anchors non-empty`).toBeGreaterThan(0);
      for (const a of anchors) {
        expect(Object.keys(a).sort()).toEqual(["category", "lat", "lon", "name"]);
        expect(typeof a.name).toBe("string");
        expect(typeof a.category).toBe("string");
        expect(typeof a.lat).toBe("number");
        expect(typeof a.lon).toBe("number");
      }
    }
  });
});

// ── Committed per-ZIP site-directory file guards ─────────────────────────────
// EXPECTED-RED until scripts/export-vacancy-index.ts re-runs and writes
// public/data/vacancy-directory/{zip}.json for all nine editions; gated on the
// 60617 file's existence so they hard-run only after the orchestrator exports.

/** Every key any object in a directory file is allowed to carry. */
const DIRECTORY_ALLOWED_KEYS = new Set<string>([
  // file
  "zip",
  "neighborhood",
  "generatedAt",
  "rows",
  "excludedNoAddressCount",
  // row
  "address",
  "ownerType",
  "propertyType",
  "priorityTier",
  "priorityScore",
  "saleYear",
  "violation",
]);

function walkDirectoryKeys(node: unknown, offenders: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walkDirectoryKeys(item, offenders);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (!DIRECTORY_ALLOWED_KEYS.has(key)) offenders.add(key);
      walkDirectoryKeys(value, offenders);
    }
  }
}

describe.skipIf(!DIRECTORY_EXISTS)("committed vacancy-directory/{zip}.json files", () => {
  const loadDirectory = (zip: string): VacancyDirectoryFile =>
    JSON.parse(readFileSync(path.join(DIRECTORY_DIR, `${zip}.json`), "utf8")) as VacancyDirectoryFile;

  const mainExport = EXPORT_EXISTS
    ? (JSON.parse(readFileSync(EXPORT_PATH, "utf8")) as VacancyIndexExport)
    : null;

  it("has a directory file for every pilot ZIP when the main export has nine editions", () => {
    if (mainExport && Object.keys(mainExport.editions).length === 9) {
      for (const zip of PILOT_ZIP_KEYS) {
        expect(existsSync(path.join(DIRECTORY_DIR, `${zip}.json`)), `directory file ${zip}`).toBe(true);
      }
    }
  });

  it("contains none of the forbidden owner-identifying substrings", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      if (!existsSync(path.join(DIRECTORY_DIR, `${zip}.json`))) continue;
      const serialized = JSON.stringify(loadDirectory(zip));
      for (const forbidden of [
        "ownerName",
        "owner_name",
        "ownerMailingAddress",
        "owner_mailing_address",
        "clusterKey",
        '"pins"',
      ]) {
        expect(serialized.includes(forbidden), `${zip}: forbidden substring ${forbidden}`).toBe(false);
      }
    }
  });

  it("carries only allowed keys (guards against field creep / leaks)", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      if (!existsSync(path.join(DIRECTORY_DIR, `${zip}.json`))) continue;
      const offenders = new Set<string>();
      walkDirectoryKeys(loadDirectory(zip), offenders);
      expect([...offenders], `${zip}: unexpected keys`).toEqual([]);
    }
  });

  it("has a well-formed header, a non-negative excluded count, and count agreeing with the main export", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      if (!existsSync(path.join(DIRECTORY_DIR, `${zip}.json`))) continue;
      const dir = loadDirectory(zip);
      expect(dir.zip).toBe(zip);
      expect(typeof dir.neighborhood).toBe("string");
      expect(typeof dir.generatedAt).toBe("string");
      expect(Array.isArray(dir.rows)).toBe(true);
      expect(Number.isInteger(dir.excludedNoAddressCount)).toBe(true);
      expect(dir.excludedNoAddressCount).toBeGreaterThanOrEqual(0);
      // rows.length is exactly the edition's directoryCount headline.
      if (mainExport?.editions[zip]) {
        expect(dir.rows.length).toBe(mainExport.editions[zip].directoryCount);
      }
    }
  });

  it("rows are sorted (priorityScore desc, address asc) — spot-check the first 50", () => {
    for (const zip of PILOT_ZIP_KEYS) {
      if (!existsSync(path.join(DIRECTORY_DIR, `${zip}.json`))) continue;
      const rows = loadDirectory(zip).rows.slice(0, 50);
      for (let i = 1; i < rows.length; i++) {
        expect(compareDirectoryRows(rows[i - 1], rows[i]), `${zip} row ${i} order`).toBeLessThanOrEqual(0);
      }
    }
  });

  it("every row has a non-empty address, a valid ownerType, and honest distress flags", () => {
    const validOwner = new Set<string>(OWNER_TYPE_ORDER);
    const validTier = new Set(["high", "medium", "low"]);
    const validType = new Set(["vacant_land", "vacant_building"]);
    for (const zip of PILOT_ZIP_KEYS) {
      if (!existsSync(path.join(DIRECTORY_DIR, `${zip}.json`))) continue;
      for (const row of loadDirectory(zip).rows) {
        expect(typeof row.address === "string" && row.address.trim().length > 0, `${zip} address`).toBe(true);
        expect(validOwner.has(row.ownerType), `${zip} ownerType ${row.ownerType}`).toBe(true);
        expect(validType.has(row.propertyType), `${zip} propertyType`).toBe(true);
        expect(validTier.has(row.priorityTier), `${zip} priorityTier`).toBe(true);
        expect(Number.isFinite(row.priorityScore), `${zip} priorityScore`).toBe(true);
        expect(row.saleYear === null || typeof row.saleYear === "number", `${zip} saleYear`).toBe(true);
        expect(typeof row.violation, `${zip} violation`).toBe("boolean");
      }
    }
  });
});
