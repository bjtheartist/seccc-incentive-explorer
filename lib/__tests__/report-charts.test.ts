import { describe, expect, it } from "vitest";
import {
  buildCorridorInvestmentChartData,
  buildFundingWindowChartData,
  buildIncentiveHorizonChartData,
} from "@/lib/report-charts";
import type { GeneratedReport } from "@/lib/report-engine";

function reportWithDeadlines(items: GeneratedReport["sections"][number]["items"]): GeneratedReport {
  return {
    title: "Test",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [
      {
        title: "Upcoming Deadlines Near This Address",
        description: "",
        items,
      },
    ],
    recommendedActions: [],
    metadata: {},
  };
}

const IN_30_DAYS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const IN_120_DAYS = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);

describe("buildFundingWindowChartData", () => {
  it("returns null (renders nothing) when the address has no SBIF window in the deadlines section", () => {
    expect(buildFundingWindowChartData(reportWithDeadlines([]))).toBeNull();
    expect(
      buildFundingWindowChartData(
        reportWithDeadlines([
          { label: "TIF", value: "x", deadlineKind: "tif_expiration", deadlineDate: IN_30_DAYS },
        ]),
      ),
    ).toBeNull();
  });

  it("marks a window opening within 60 days as amber, using the REAL resolved start/end dates", () => {
    const report = reportWithDeadlines([
      {
        label: "SBIF application window — Test TIF",
        value: "opens soon",
        deadlineKind: "sbif_window",
        deadlineDate: IN_30_DAYS,
        deadlineWindowEnd: IN_120_DAYS,
      },
    ]);
    const rows = buildFundingWindowChartData(report);
    expect(rows).toHaveLength(1);
    expect(rows![0].startDate).toBe(IN_30_DAYS);
    expect(rows![0].endDate).toBe(IN_120_DAYS);
    expect(rows![0].amber).toBe(true);
  });

  it("does not mark a window further than 60 days out as amber", () => {
    const report = reportWithDeadlines([
      {
        label: "SBIF window",
        value: "later",
        deadlineKind: "sbif_window",
        deadlineDate: IN_120_DAYS,
      },
    ]);
    expect(buildFundingWindowChartData(report)![0].amber).toBe(false);
  });

  // Gate finding 6 (regression, real bug this fixes): a window already
  // open (started in the past, not yet closed) is the MOST urgent state —
  // the old `daysToStart >= 0` check excluded it entirely.
  it("marks an already-open window (daysToStart < 0, end still in the future) as amber", () => {
    const openedLastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const report = reportWithDeadlines([
      {
        label: "SBIF window — open now",
        value: "open",
        deadlineKind: "sbif_window",
        deadlineDate: openedLastWeek,
        deadlineWindowEnd: IN_30_DAYS,
      },
    ]);
    expect(buildFundingWindowChartData(report)![0].amber).toBe(true);
  });

  it("does not mark a window that has already fully closed as amber", () => {
    const closedLastMonth = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const report = reportWithDeadlines([
      {
        label: "SBIF window — closed",
        value: "closed",
        deadlineKind: "sbif_window",
        deadlineDate: closedLastMonth,
        deadlineWindowEnd: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
      },
    ]);
    expect(buildFundingWindowChartData(report)![0].amber).toBe(false);
  });
});

describe("buildCorridorInvestmentChartData (gate finding 5)", () => {
  function reportWithCorridorInvestment(
    corridorInvestment: GeneratedReport["corridorInvestment"],
  ): GeneratedReport {
    return { ...reportWithDeadlines([]), corridorInvestment };
  }

  it("returns null when the report carries no corridorInvestment context", () => {
    expect(buildCorridorInvestmentChartData(reportWithCorridorInvestment(undefined))).toBeNull();
    expect(buildCorridorInvestmentChartData(reportWithCorridorInvestment(null))).toBeNull();
  });

  it("returns null when the context carries an empty series — never a zero-filled chart", () => {
    const report = reportWithCorridorInvestment({ communityArea: "Chatham", series: [], source: "FFIEC" });
    expect(buildCorridorInvestmentChartData(report)).toBeNull();
  });

  it("maps the REAL resolved series to year/dollars rows, sorted ascending, carrying the real source citation", () => {
    const report = reportWithCorridorInvestment({
      communityArea: "Chatham",
      source: "FFIEC CRA Aggregate Table A1-1 small-business loan ORIGINATIONS, Cook County tracts → community areas (2022–2024)",
      series: [
        { year: 2024, smallBusinessLoanCount: 40, smallBusinessLoanDollars: 9_000_000 },
        { year: 2022, smallBusinessLoanCount: 30, smallBusinessLoanDollars: 5_000_000 },
        { year: 2023, smallBusinessLoanCount: 35, smallBusinessLoanDollars: 7_000_000 },
      ],
    });
    const data = buildCorridorInvestmentChartData(report);
    expect(data?.communityArea).toBe("Chatham");
    expect(data?.source).toMatch(/FFIEC/);
    expect(data?.rows).toEqual([
      { year: 2022, dollars: 5_000_000 },
      { year: 2023, dollars: 7_000_000 },
      { year: 2024, dollars: 9_000_000 },
    ]);
  });
});

describe("buildIncentiveHorizonChartData", () => {
  it("returns null when nothing in the deadlines section is a TIF expiration or program deadline", () => {
    expect(buildIncentiveHorizonChartData(reportWithDeadlines([]))).toBeNull();
  });

  it("includes TIF expirations and program deadlines (e.g. the real federal OZ 2028 sunset) — excludes SBIF windows", () => {
    const report = reportWithDeadlines([
      { label: "87th/Cottage Grove TIF expires", value: "x", deadlineKind: "tif_expiration", deadlineDate: IN_120_DAYS },
      { label: "Federal Opportunity Zones — OZ 1.0 sunset", value: "x", deadlineKind: "program_deadline", deadlineDate: "2028-12-31" },
      { label: "SBIF window", value: "x", deadlineKind: "sbif_window", deadlineDate: IN_30_DAYS },
    ]);
    const rows = buildIncentiveHorizonChartData(report);
    expect(rows).toHaveLength(2);
    expect(rows!.map((r) => r.label)).toEqual([
      "87th/Cottage Grove TIF expires",
      "Federal Opportunity Zones — OZ 1.0 sunset",
    ]);
  });
});
