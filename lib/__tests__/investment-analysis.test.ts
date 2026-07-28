import { describe, expect, it } from "vitest";
import { assertNoBannedFigureKeys, findBannedFigureKeys, type CommunityInvestmentRecord } from "../community-investment";
import {
  analyzeCommunityArea,
  buildInvestmentIndex,
  median,
  SINCE_YEAR,
} from "../investment-analysis";

const GEN = "2026-07-27T00:00:00.000Z";

/** Minimal record factory (mirrors the community-investment test fixture). */
function rec(over: Partial<CommunityInvestmentRecord> & { id: string }): CommunityInvestmentRecord {
  return {
    source: "nof-small",
    funderType: "government",
    funderName: "City of Chicago",
    recipient: "Test Grantee",
    amountAwarded: 100000,
    logLine: null,
    year: 2022,
    geometry: { kind: "point", lat: 41.7, lng: -87.6 },
    address: "1 MAIN ST",
    status: "completed",
    communityArea: "Alpha",
    links: [],
    ...over,
  };
}

/**
 * Fixture universe:
 *   Alpha — 100k (2021 gov), 200k (2022 gov), 50k (2023 phil), 999k (2019 phil, PRE-2020),
 *           a null-year dev project (counted, not dollared),
 *           a null-year foundation grant carrying 30k (null year → excluded from dollars).
 *   Beta  — 500k (2020 gov).
 *   Citywide — a 1,000,000 philanthropic record with citywide geometry and NO communityArea.
 */
const RECORDS: CommunityInvestmentRecord[] = [
  rec({ id: "a1", funderType: "government", source: "nof-small", year: 2021, amountAwarded: 100000, communityArea: "Alpha" }),
  rec({ id: "a2", funderType: "government", source: "sbif", year: 2022, amountAwarded: 200000, communityArea: "Alpha" }),
  rec({ id: "a3", funderType: "philanthropic", source: "foundation", year: 2023, amountAwarded: 50000, communityArea: "Alpha", funderName: "Field Foundation" }),
  rec({ id: "a4", funderType: "philanthropic", source: "foundation", year: 2019, amountAwarded: 999000, communityArea: "Alpha", funderName: "Field Foundation" }),
  rec({ id: "a5", funderType: "private_development", source: "development", year: null, amountAwarded: null, communityArea: "Alpha", funderName: "Private development", recipient: "Big Project" }),
  rec({ id: "a6", funderType: "philanthropic", source: "foundation", year: null, amountAwarded: 30000, communityArea: "Alpha", funderName: "Undated Fund" }),
  rec({ id: "b1", funderType: "government", source: "cdg", year: 2020, amountAwarded: 500000, communityArea: "Beta" }),
  rec({ id: "cw", funderType: "philanthropic", source: "foundation", year: 2021, amountAwarded: 1000000, geometry: { kind: "citywide" }, communityArea: undefined, funderName: "Intermediary" }),
];

describe("median", () => {
  it("returns 0 for empty, the middle for odd, the mean of two middles for even", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("buildInvestmentIndex", () => {
  const index = buildInvestmentIndex(RECORDS, GEN);

  it("excludes citywide (no-community-area) records from every community total", () => {
    // Only Alpha + Beta appear; the $1,000,000 citywide record contributes to neither.
    expect(index.rows.map((r) => r.communityArea).sort()).toEqual(["Alpha", "Beta"]);
    expect(index.communityCount).toBe(2);
    // citywideTotal = Alpha 350k + Beta 500k = 850k (NOT 1.85M).
    expect(index.citywideTotal).toBe(850000);
  });

  it("ranks communities by awarded dollars, high → low", () => {
    expect(index.rows.map((r) => [r.communityArea, r.totalAwarded])).toEqual([
      ["Beta", 500000],
      ["Alpha", 350000],
    ]);
  });
});

describe("analyzeCommunityArea — Alpha", () => {
  const index = buildInvestmentIndex(RECORDS, GEN);
  const a = analyzeCommunityArea(RECORDS, "Alpha", GEN, index)!;

  it("sums only in-window (year >= 2020), non-null awarded dollars — pre-2020 excluded", () => {
    // 100k + 200k + 50k = 350k; the 2019 $999k and the null-year $30k are NOT counted.
    expect(a.totalAwarded).toBe(350000);
    expect(SINCE_YEAR).toBe(2020);
  });

  it("counts null-year records as unYeared without dollaring them", () => {
    // inView = 2021, 2022, 2023, dev(null), foundation(null) = 5; the 2019 row is dropped.
    expect(a.recordCount).toBe(5);
    expect(a.unYeared).toBe(2);
  });

  it("funder-type shares sum to 1 and the donut slice dollars sum to the hero total", () => {
    const shareSum = a.byFunderType.reduce((s, f) => s + f.share, 0);
    expect(shareSum).toBeCloseTo(1, 10);
    const dollarSum = a.byFunderType.reduce((s, f) => s + f.awardedDollars, 0);
    expect(dollarSum).toBe(a.totalAwarded);
  });

  it("breaks funder types down with dollars + counts (private development carries a count, zero dollars)", () => {
    const byType = Object.fromEntries(a.byFunderType.map((f) => [f.funderType, f]));
    expect(byType.government.awardedDollars).toBe(300000);
    expect(byType.government.count).toBe(2);
    expect(byType.philanthropic.awardedDollars).toBe(50000); // null-year 30k excluded
    expect(byType.philanthropic.count).toBe(2); // 2023 grant + null-year grant
    expect(byType.private_development.awardedDollars).toBe(0);
    expect(byType.private_development.count).toBe(1);
    expect(byType.private_development.share).toBe(0);
  });

  it("zero-fills the year trend 2020..latest and omits the un-yeared rows", () => {
    expect(a.byYear.map((y) => [y.year, y.awardedDollars])).toEqual([
      [2020, 0],
      [2021, 100000],
      [2022, 200000],
      [2023, 50000],
    ]);
    expect(a.span).toEqual({ min: 2021, max: 2023 });
    expect(a.latestYear).toBe(2023);
  });

  it("lists development by count only (dollars null by design)", () => {
    const dev = a.bySource.find((s) => s.source === "development")!;
    expect(dev.awardedDollars).toBe(0);
    expect(dev.count).toBe(1);
  });

  it("ranks top recipients by dollars, in-window only", () => {
    expect(a.topRecipients.map((r) => r.amountAwarded)).toEqual([200000, 100000, 50000]);
  });

  it("computes equity against the community-sited citywide total", () => {
    expect(a.equity.rank).toBe(2);
    expect(a.equity.totalCAs).toBe(2);
    expect(a.equity.citywideMedianCA).toBe(425000); // median(350k, 500k)
    expect(a.equity.thisVsMedian).toBeCloseTo(350000 / 425000, 10);
    expect(a.equity.citywideTotal).toBe(850000);
    expect(a.equity.share).toBeCloseTo(350000 / 850000, 10);
  });

  it("produces an output shape free of banned derived-figure keys", () => {
    expect(findBannedFigureKeys(a)).toEqual([]);
    expect(() => assertNoBannedFigureKeys(a)).not.toThrow();
    expect(() => assertNoBannedFigureKeys(buildInvestmentIndex(RECORDS, GEN))).not.toThrow();
  });
});

describe("analyzeCommunityArea — edge cases", () => {
  it("returns null for a community with no since-2020 record", () => {
    // Gamma has only a pre-2020 record → nothing in the since-2020 view.
    const recs = [rec({ id: "g1", year: 2018, amountAwarded: 100000, communityArea: "Gamma" })];
    expect(analyzeCommunityArea(recs, "Gamma", GEN)).toBeNull();
  });

  it("returns null for an unknown community", () => {
    expect(analyzeCommunityArea(RECORDS, "Nowhere", GEN)).toBeNull();
  });
});

// Regression: review finding — 999.5K..999.99K must roll to $1.0M, never "$1000K".
import { formatCompactDollars } from "../../components/investment/format";

describe("formatCompactDollars boundary rollover", () => {
  it("rolls 999,750 over to $1.0M instead of $1000K", () => {
    expect(formatCompactDollars(999_750)).toBe("$1.0M");
  });
  it("keeps 999,400 as $999K", () => {
    expect(formatCompactDollars(999_400)).toBe("$999K");
  });
  it("negative boundary mirrors", () => {
    expect(formatCompactDollars(-999_900)).toBe("$-1.0M");
  });
});
