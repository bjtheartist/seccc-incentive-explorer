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
    expect(html).toContain('fill="#F59E0B"'); // amber
    expect(html).toContain("opens within 60 days");
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
});
