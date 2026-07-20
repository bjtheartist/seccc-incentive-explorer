import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_TYPE_ORDER } from "../owner-classify";
import {
  assignQuantileDots,
  compareRankableSites,
  computeSitePriority,
  editionGeographyNote,
  getVacancyIndexEdition,
  loadVacancyIndex,
  MATRIX_METHOD_NOTE,
  nextStepForSite,
  priorityTierForScore,
  rankSites,
  tallyOwnerTypeCounts,
  type RankableSite,
  type VacancyIndexExport,
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

// ── Committed-export guards ──────────────────────────────────────────────────
// These mirror lib/__tests__/corridor-owners.test.ts's committed-export guard.
// They stay skipped until scripts/export-vacancy-index.ts is run on a refresh
// branch and public/data/vacancy-index.json is committed; then they hard-run.

const EXPORT_PATH = path.join(process.cwd(), "public/data/vacancy-index.json");
const EXPORT_EXISTS = existsSync(EXPORT_PATH);

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
  "boundary",
  "centroid",
  "transport",
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
  "ownerType",
  "count",
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
});
