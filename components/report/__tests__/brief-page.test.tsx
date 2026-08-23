import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefPage } from "@/components/report/BriefPage";
import { CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

function reportFixture(): GeneratedReport {
  return {
    title: "Test",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [{ label: "SBIF", value: "", programId: "sbif" }],
      },
    ],
    recommendedActions: [],
    metadata: { address: "7939 S Cottage Grove Ave", zoneClass: "B3-2", zoneType: "Community Shopping" },
  };
}

describe("BriefPage", () => {
  it("always renders the non-suppressible screening sentence and verified-date line", () => {
    const html = renderToStaticMarkup(
      <BriefPage
        report={reportFixture()}
        persona="growing"
        stage="launch-ready"
        priority="renovation"
        reportUrl="https://example.com/report"
      />,
    );
    expect(html).toContain("SCREENING FROM PUBLIC RECORDS");
    expect(html).toContain("NOT AN ELIGIBILITY DETERMINATION");
    expect(html).toMatch(/DATA VERIFIED/);
    expect(html).toMatch(/GENERATED \d{4}-\d{2}-\d{2}/);
  });

  it("renders the SEEKING chip and stage label from the two-question answers", () => {
    const html = renderToStaticMarkup(
      <BriefPage
        report={reportFixture()}
        persona="growing"
        stage="launch-ready"
        priority="renovation"
        reportUrl="https://example.com/report"
      />,
    );
    expect(html).toContain("Seeking: build-out financing");
    expect(html).toContain("Getting launch-ready");
  });

  it("never renders a Documents to Gather block — the Brief carries no documents section", () => {
    const html = renderToStaticMarkup(
      <BriefPage
        report={reportFixture()}
        persona="growing"
        stage="launch-ready"
        priority="renovation"
        reportUrl="https://example.com/report"
      />,
    );
    expect(html).not.toContain("Documents to Gather");
    expect(html).not.toContain("Track in Business File");
  });

  it("renders the full-report link prominently (the QR is decorative only)", () => {
    const html = renderToStaticMarkup(
      <BriefPage
        report={reportFixture()}
        persona="growing"
        stage="launch-ready"
        priority="renovation"
        reportUrl="https://example.com/r/abc"
      />,
    );
    expect(html).toContain('href="https://example.com/r/abc"');
  });
});
