import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FundingWindowChart } from "@/components/report/FundingWindowChart";
import { IncentiveHorizonChart } from "@/components/report/IncentiveHorizonChart";
import type { GeneratedReport } from "@/lib/report-engine";

function reportWithDeadlines(items: GeneratedReport["sections"][number]["items"]): GeneratedReport {
  return {
    title: "Test",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [{ title: "Upcoming Deadlines Near This Address", description: "", items }],
    recommendedActions: [],
    metadata: {},
  };
}

const IN_30_DAYS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const IN_120_DAYS = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
const IN_100_DAYS = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
const IN_300_DAYS = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

describe("FundingWindowChart", () => {
  it("renders nothing when the address has no real SBIF window (never an empty chart shell)", () => {
    const html = renderToStaticMarkup(<FundingWindowChart report={reportWithDeadlines([])} />);
    expect(html).toBe("");
  });

  it("renders an SVG interval bar from real resolved dates, amber inside 60 days, with a hover title", () => {
    const report = reportWithDeadlines([
      {
        label: "SBIF application window — Test TIF",
        value: "x",
        deadlineKind: "sbif_window",
        deadlineDate: IN_30_DAYS,
        deadlineWindowEnd: IN_120_DAYS,
      },
    ]);
    const html = renderToStaticMarkup(<FundingWindowChart report={report} />);
    expect(html).toContain('data-testid="funding-window-chart"');
    expect(html).toContain("<svg");
    expect(html).toContain("<title>");
    expect(html).toContain('fill="#A45B00"'); // amber (gate finding 22: contrast-fixed from the earlier #F59E0B)
    expect(html).toContain("opens within 60 days");
  });

  // Gate finding 15 (regression, real bug this fixes): the plot clamps to
  // a fixed 150-day-out edge, but deadlines are resolved across a 365-day
  // range — a window opening in 300 days used to render at the SAME
  // clamped x-position as one opening in 150 days, with no date text
  // anywhere to tell them apart. Two separate charts (rather than two rows
  // in one) prove each prints ITS OWN real date, not a shared/generic one.
  it("prints each window's REAL date so a 300-day-out window is never visually indistinguishable from a 150-day-out one", () => {
    const near = renderToStaticMarkup(
      <FundingWindowChart
        report={reportWithDeadlines([
          { label: "Near window", value: "x", deadlineKind: "sbif_window", deadlineDate: IN_100_DAYS, deadlineWindowEnd: IN_100_DAYS },
        ])}
      />,
    );
    const far = renderToStaticMarkup(
      <FundingWindowChart
        report={reportWithDeadlines([
          { label: "Far window", value: "x", deadlineKind: "sbif_window", deadlineDate: IN_300_DAYS, deadlineWindowEnd: IN_300_DAYS },
        ])}
      />,
    );
    expect(near).toContain(shortDate(IN_100_DAYS));
    expect(far).toContain(shortDate(IN_300_DAYS));
    expect(near).not.toContain(shortDate(IN_300_DAYS));
    expect(far).not.toContain(shortDate(IN_100_DAYS));
    // The far (clamped) window also carries a visible clamp marker the
    // near one does not.
    expect(far).toContain("››");
    expect(near).not.toContain("››");
  });
});

describe("IncentiveHorizonChart", () => {
  it("renders nothing when the address has no real TIF expiration or program deadline", () => {
    const html = renderToStaticMarkup(<IncentiveHorizonChart report={reportWithDeadlines([])} />);
    expect(html).toBe("");
  });

  it("renders markers for TIF expiration and program deadlines with a hover title", () => {
    const report = reportWithDeadlines([
      { label: "87th/Cottage Grove TIF expires", value: "x", deadlineKind: "tif_expiration", deadlineDate: IN_120_DAYS },
    ]);
    const html = renderToStaticMarkup(<IncentiveHorizonChart report={report} />);
    expect(html).toContain('data-testid="incentive-horizon-chart"');
    expect(html).toContain("<svg");
    expect(html).toContain("<title>");
    expect(html).toContain("87th/Cottage Grove TIF expires");
  });

  // Gate finding 15: named the real dataset instead of a vague phrase.
  it("names the real TIF Annual Reports source in its footer", () => {
    const report = reportWithDeadlines([
      { label: "87th/Cottage Grove TIF expires", value: "x", deadlineKind: "tif_expiration", deadlineDate: IN_120_DAYS },
    ]);
    const html = renderToStaticMarkup(<IncentiveHorizonChart report={report} />);
    expect(html).toMatch(/City of Chicago TIF Annual Reports/);
  });
});
