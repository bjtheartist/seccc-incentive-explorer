import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import type { GeneratedReport } from "@/lib/report-engine";

const report: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-07-10T12:00:00.000Z",
  summary: "",
  sections: [],
  recommendedActions: [],
  metadata: {
    address: "4200 S California Ave, Chicago, IL",
  },
};

describe("ReportEmailGate", () => {
  it("makes email optional while keeping the primary goal checkpoint", () => {
    const html = renderToStaticMarkup(
      <ReportEmailGate
        report={report}
        source="test"
        onPrepareReport={async () => report}
        onReportReady={() => {}}
      />,
    );

    expect(html).toContain("<dialog");
    expect(html).toContain('data-testid="report-email-gate"');
    expect(html).toContain("Your report is ready");
    expect(html).toContain("Primary Goal");
    expect(html).toContain("Hire or retain employees");
    expect(html).toContain("Email Address (Optional)");
    expect(html).toContain("Email and View Report");
    expect(html).toContain("Continue Without Email");
    expect(html).toContain("Chamber follow-up happens only when you request it");
  });
});
