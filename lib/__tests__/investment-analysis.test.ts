import { describe, expect, it } from "vitest";
import { assertNoBannedFigureKeys, findBannedFigureKeys, type CommunityInvestmentRecord } from "../community-investment";
import {
  analyzeCommunityArea,
  buildFlowRows,
  buildInvestmentIndex,
  computeInvestmentFindings,
  median,
  SINCE_YEAR,
  summarizeMajorDevelopments,
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
    capitalClass: "grant",
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

// ── Major private developments summary (announced capital — a SEPARATE measure) ─

describe("summarizeMajorDevelopments", () => {
  const dev = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({
      source: "development",
      funderType: "private_development",
      funderName: "Developer",
      amountAwarded: null,
      announcedInvestment: null,
      status: "under_construction",
      ...over,
    });

  const DEV_RECORDS: CommunityInvestmentRecord[] = [
    dev({ id: "d1", recipient: "Megasite A", announcedInvestment: 7_000_000_000, communityArea: "Alpha", links: ["https://a.example"] }),
    dev({ id: "d2", recipient: "Megasite B", announcedInvestment: 500_000_000, communityArea: "Alpha" }),
    dev({ id: "d3", recipient: "Beta Tower", announcedInvestment: 1_000_000_000, communityArea: "Beta" }),
    dev({ id: "d4", recipient: "Fire Stadium (subset)", announcedInvestment: null, communityArea: "Alpha" }), // excluded (null)
    dev({ id: "d5", recipient: "Advocate multi-site", announcedInvestment: 1_000_000_000, geometry: { kind: "citywide" }, communityArea: undefined }),
    // A legacy KML development with no announced figure — excluded.
    dev({ id: "d6", recipient: "Community POP Court", announcedInvestment: null, communityArea: "Alpha" }),
    // A NON-development record with a stray amount — never counted here.
    rec({ id: "g1", source: "cdg", funderType: "government", amountAwarded: 250_000, communityArea: "Alpha" }),
  ];

  it("citywide: counts + totals only developments with a real announced figure, ranked desc", () => {
    const s = summarizeMajorDevelopments(DEV_RECORDS);
    expect(s.count).toBe(4); // d1, d2, d3, d5 (d4/d6 null, g1 non-dev)
    expect(s.totalAnnounced).toBe(7_000_000_000 + 500_000_000 + 1_000_000_000 + 1_000_000_000);
    expect(s.developments.map((d) => d.recipient)).toEqual([
      "Megasite A", // 7B
      "Advocate multi-site", // 1B (name tiebreak: "Advocate" < "Beta")
      "Beta Tower", // 1B
      "Megasite B", // 500M
    ]);
    expect(s.developments[0].sourceLink).toBe("https://a.example");
  });

  it("scopes to a community area (point-stamped) and honors a limit", () => {
    const s = summarizeMajorDevelopments(DEV_RECORDS, { communityArea: "Alpha", limit: 1 });
    // Alpha has d1 (7B) and d2 (500M); citywide d5 has no communityArea and is excluded.
    expect(s.count).toBe(2);
    expect(s.totalAnnounced).toBe(7_500_000_000);
    expect(s.developments).toHaveLength(1); // limited
    expect(s.developments[0].recipient).toBe("Megasite A");
  });

  it("never combines announcedInvestment with amountAwarded (no banned figure key)", () => {
    const s = summarizeMajorDevelopments(DEV_RECORDS);
    expect(findBannedFigureKeys(s)).toEqual([]);
  });
});

// ── HERO INVARIANT: megadev integration must not move the awarded total ───────

describe("awarded hero is unchanged by megadev announced capital", () => {
  it("citywideTotal equals an amountAwarded-only recompute even with billions in announced dev capital", () => {
    const withDevs: CommunityInvestmentRecord[] = [
      ...RECORDS,
      rec({ id: "m1", source: "development", funderType: "private_development", year: 2024, amountAwarded: null, announcedInvestment: 7_000_000_000, communityArea: "Alpha", recipient: "1901" }),
      rec({ id: "m2", source: "development", funderType: "private_development", year: 2022, amountAwarded: null, announcedInvestment: 9_000_000_000, communityArea: "Beta", recipient: "IQMP" }),
    ];
    const index = buildInvestmentIndex(withDevs, GEN);

    // The awarded hero (citywideTotal) sums only real awarded dollars — the
    // $16B announced never enters it.
    const awardedOnlyInWindow = withDevs
      .filter((r) => r.communityArea != null && r.year != null && r.year >= SINCE_YEAR && r.amountAwarded != null)
      .reduce((s, r) => s + (r.amountAwarded as number), 0);
    expect(index.citywideTotal).toBe(awardedOnlyInWindow);

    // And it matches the hero with the developments removed entirely.
    const withoutDevs = buildInvestmentIndex(RECORDS, GEN);
    expect(index.citywideTotal).toBe(withoutDevs.citywideTotal);
  });
});

// ── NMTC: CA-stamped citywide tax-credit capital appears in CA lists, never plots ─

describe("credit capital in community analysis (NMTC CA-stamped-citywide behavior)", () => {
  // An NMTC-shaped record: citywide geometry (never plots) but a communityArea
  // stamped from its 2020 tract centroid, carrying tax-credit capital in creditAmount.
  const nmtc = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({
      source: "nmtc",
      funderType: "government",
      capitalClass: "tax_credit",
      amountAwarded: null,
      creditAmount: 5_000_000,
      geometry: { kind: "citywide" },
      status: "awarded",
      year: 2021,
      ...over,
    });

  it("a CA-stamped citywide credit record joins its community's index row without moving the awarded total", () => {
    const recs: CommunityInvestmentRecord[] = [
      ...RECORDS,
      nmtc({ id: "n1", communityArea: "Alpha", creditAmount: 5_000_000 }),
      nmtc({ id: "n2", communityArea: "Alpha", creditAmount: 3_000_000, year: 2010 }), // pre-2020 but credit is all-time
    ];
    const index = buildInvestmentIndex(recs, GEN);
    const alpha = index.rows.find((r) => r.communityArea === "Alpha")!;
    // Awarded total for Alpha is UNCHANGED by the credit records (still 350k).
    expect(alpha.totalAwarded).toBe(350_000);
    // But their credit capital surfaces in the CA list (all-time: 5M + 3M).
    expect(alpha.creditCapital).toBe(8_000_000);
    // The awarded citywide total across communities is unchanged by credit capital.
    expect(index.citywideTotal).toBe(buildInvestmentIndex(RECORDS, GEN).citywideTotal);
  });

  it("analyzeCommunityArea surfaces creditCapital (all-time) while keeping totalAwarded grant-only", () => {
    const recs: CommunityInvestmentRecord[] = [...RECORDS, nmtc({ id: "n1", communityArea: "Alpha", creditAmount: 12_000_000 })];
    const a = analyzeCommunityArea(recs, "Alpha", GEN)!;
    expect(a.totalAwarded).toBe(350_000); // grant-only, unchanged
    expect(a.creditCapital).toBe(12_000_000);
    expect(findBannedFigureKeys(a)).toEqual([]);
  });
});

// ── New status/compare measures on the analysis ──────────────────────────────

describe("analysis carries the non-grant capital measures + median award", () => {
  it("Alpha: medianAward is the median in-window award; non-grant classes are 0 here", () => {
    const a = analyzeCommunityArea(RECORDS, "Alpha", GEN)!;
    // In-window awarded amounts (>0): 100k, 200k, 50k → median 100k.
    expect(a.medianAward).toBe(100000);
    // RECORDS carry no announced/TIF/federal capital in Alpha.
    expect(a.announcedCapital).toBe(0);
    expect(a.authorizedTif).toBe(0);
    expect(a.federalProgram).toBe(0);
  });

  it("surfaces authorizedTif / federalProgram / announcedCapital from the right fields, never summed into totalAwarded", () => {
    const recs: CommunityInvestmentRecord[] = [
      ...RECORDS,
      rec({
        id: "tif1",
        source: "tif",
        capitalClass: "tif_subsidy",
        funderType: "government",
        amountAwarded: null,
        authorizedAmount: 12_000_000,
        year: 2023,
        communityArea: "Alpha",
      }),
      rec({
        id: "hud1",
        source: "cdbg-home",
        capitalClass: "federal_program",
        funderType: "government",
        amountAwarded: null,
        authorizedAmount: 4_000_000,
        year: 2022,
        communityArea: "Alpha",
      }),
      rec({
        id: "dev1",
        source: "development",
        capitalClass: "grant",
        funderType: "private_development",
        amountAwarded: null,
        announcedInvestment: 800_000_000,
        year: null,
        communityArea: "Alpha",
        recipient: "Megasite",
      }),
    ];
    const a = analyzeCommunityArea(recs, "Alpha", GEN)!;
    expect(a.authorizedTif).toBe(12_000_000);
    expect(a.federalProgram).toBe(4_000_000);
    expect(a.announcedCapital).toBe(800_000_000);
    // The awarded total is grant-only — unchanged by any of the above.
    expect(a.totalAwarded).toBe(350_000);
    expect(findBannedFigureKeys(a)).toEqual([]);
  });
});

// ── GRANT-CLASS FIREWALL: non-grant capital never enters awarded breakdowns ───

describe("analyzeCommunityArea grant-class firewall (SourceBars / recordCount)", () => {
  // Alpha's 5 grant records + one of each non-grant capital class, all stamped to
  // Alpha and in the since-2020 view (amountAwarded null by design).
  const WITH_CAPITAL: CommunityInvestmentRecord[] = [
    ...RECORDS,
    rec({ id: "tif1", source: "tif", capitalClass: "tif_subsidy", funderType: "government", amountAwarded: null, authorizedAmount: 44_000_000, year: 2023, communityArea: "Alpha", recipient: "TIF RDA" }),
    rec({ id: "hud1", source: "cdbg-home", capitalClass: "federal_program", funderType: "government", amountAwarded: null, authorizedAmount: 2_000_000, year: 2022, communityArea: "Alpha", recipient: "CDBG activity" }),
    rec({ id: "lih1", source: "lihtc", capitalClass: "tax_credit", funderType: "government", amountAwarded: null, creditAmount: 1_500_000, year: 2021, communityArea: "Alpha", recipient: "LIHTC placement" }),
  ];

  const a = analyzeCommunityArea(WITH_CAPITAL, "Alpha", GEN)!;

  it("bySource excludes the non-grant capital sources entirely (no $0 program bars)", () => {
    const sources = a.bySource.map((s) => s.source);
    expect(sources).not.toContain("tif");
    expect(sources).not.toContain("cdbg-home");
    expect(sources).not.toContain("lihtc");
    expect(sources).not.toContain("nmtc");
    // The grant sources it should surface are still present.
    expect(sources).toContain("nof-small");
    expect(sources).toContain("development");
  });

  it("recordCount + unYeared count grant-class records only (not TIF/CDBG/LIHTC)", () => {
    // Grant-class in-view for Alpha is unchanged from the base fixture (5), even
    // though three non-grant capital records are now stamped to Alpha.
    expect(a.recordCount).toBe(5);
    expect(a.unYeared).toBe(2);
  });

  it("byFunderType counts government grant records only (non-grant government excluded)", () => {
    const gov = a.byFunderType.find((f) => f.funderType === "government")!;
    // a1 + a2 only — the TIF/CDBG/LIHTC government records are NOT counted.
    expect(gov.count).toBe(2);
    expect(gov.awardedDollars).toBe(300000);
  });

  it("keeps the non-grant capital totals (from `mine`) intact beside the firewall", () => {
    expect(a.authorizedTif).toBe(44_000_000);
    expect(a.federalProgram).toBe(2_000_000);
    expect(a.creditCapital).toBe(1_500_000);
    // The awarded total stays grant-only.
    expect(a.totalAwarded).toBe(350000);
  });
});

describe("historical recovery analysis firewall", () => {
  const withRecovery: CommunityInvestmentRecord[] = [
    ...RECORDS,
    rec({
      id: "rrf-history",
      source: "sba-rrf",
      funderName: "SBA Restaurant Revitalization Fund",
      amountAwarded: null,
      year: 2021,
      status: "disbursed",
      communityArea: "Alpha",
      recovery: {
        sourceId: "sba-rrf",
        historicalAmount: {
          value: 450_000,
          currency: "USD",
          assistanceType: "grant",
        },
      },
    }),
  ];

  it("does not change ordinary rankings, counts, trends, or source bars", () => {
    expect(buildInvestmentIndex(withRecovery, GEN)).toEqual(
      buildInvestmentIndex(RECORDS, GEN),
    );
    const analysis = analyzeCommunityArea(withRecovery, "Alpha", GEN)!;
    expect(analysis.recordCount).toBe(5);
    expect(analysis.totalAwarded).toBe(350_000);
    expect(analysis.bySource.map((entry) => entry.source)).not.toContain("sba-rrf");
  });
});

describe("computeInvestmentFindings", () => {
  const a = analyzeCommunityArea(RECORDS, "Alpha", GEN)!;
  const findings = computeInvestmentFindings(a);

  it("returns exactly three plain-sentence findings", () => {
    expect(findings).toHaveLength(3);
    for (const f of findings) expect(f.length).toBeGreaterThan(10);
  });

  it("names the largest funder, the biggest swing, and the equity gap", () => {
    // City of Chicago funds a1 (100k) + a2 (200k) = 300k of the 350k total.
    expect(findings[0]).toContain("City of Chicago");
    expect(findings[0]).toContain("largest single funder");
    // Sharpest swing: 2022 (200k) → 2023 (50k) is a drop of 150k.
    expect(findings[1]).toContain("drop");
    expect(findings[1]).toContain("$150,000");
    expect(findings[1]).toContain("2022 to 2023");
    // Equity: 350k vs median 425k → below the typical community; rank 2 of 2.
    expect(findings[2]).toContain("below the typical community");
    expect(findings[2]).toContain("2 of 2");
  });

  it("never emits a banned derived-figure phrase", () => {
    for (const f of findings) expect(f).not.toMatch(FORBIDDEN_FINDINGS);
  });
});

const FORBIDDEN_FINDINGS = /\b(received|available|remaining|unspent)\b/i;

describe("buildFlowRows", () => {
  it("flattens in-window, dollar-valued rows sorted by awarded desc; excludes null/pre-2020/dev", () => {
    const alpha = RECORDS.filter((r) => r.communityArea === "Alpha");
    const rows = buildFlowRows(alpha);
    // a2 200k, a1 100k, a3 50k. a4 (2019), a5 (dev null), a6 (null year) excluded.
    expect(rows.map((r) => r.amountAwarded)).toEqual([200000, 100000, 50000]);
    for (const r of rows) {
      expect(r.id).toBeTruthy();
      expect(r.year).toBeGreaterThanOrEqual(SINCE_YEAR);
      expect(r.amountAwarded).toBeGreaterThan(0);
    }
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
