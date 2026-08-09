import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RefineValuePanel } from "@/components/report/RefineValuePanel";
import { CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

function reportFixture(): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          { label: "Small Business Improvement Fund (SBIF)", value: "", programId: "sbif" },
          { label: "TIF District Funding", value: "", programId: "tif" },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
  };
}

describe("RefineValuePanel", () => {
  it("previews goal-based refinement without promising a deal total", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel report={reportFixture()} context="instant" onRefine={() => {}} />,
    );
    expect(html).toContain("Location-Only Snapshot");
    expect(html).toContain("Goal-Based Organization");
    expect(html).not.toMatch(/goal-based ranking/i);
    expect(html).toContain("Week-One Action Plan");
    expect(html).toContain("Document Gap Checklist");
    expect(html).toContain("does not add them up, predict an award, or guarantee eligibility");
    expect(html).not.toContain("Dollar Estimates");
    expect(html).not.toContain("Estimated Incentive Value");
    // Honest expectations for the full path (WU5).
    expect(html).toContain("3 short screens");
  });

  it("offers a goal-first quick refine with optional budget and timeline", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel
        report={reportFixture()}
        context="instant"
        onRefine={() => {}}
        onQuickRefine={() => {}}
      />,
    );
    expect(html).toContain("Quick Refine");
    expect(html).toContain("Project Goals");
    expect(html).toContain("0/3");
    expect(html).toContain("Something else");
    expect(html).toContain("Remodel or renovate");
    expect(html).toContain("Hire or retain employees");
    expect(html).toContain("Project Budget (Optional)");
    expect(html).toContain("Timeline (Optional)");
    expect(html).toContain("Generate Refined Report");
    expect(html).toContain("Add full project details instead");
  });

  it("falls back to the full-details CTA when quick refine is unavailable (workspace)", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel report={reportFixture()} context="workspace" onRefine={() => {}} />,
    );
    expect(html).toContain("Refine with Project Details");
    expect(html).not.toContain("Quick Refine");
  });

  it("renders a slim refine affordance in compact/compare mode (RF4)", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel
        report={reportFixture()}
        context="compare_a"
        onRefine={() => {}}
        compact
      />,
    );
    expect(html).toContain("Location-only snapshot");
    expect(html).toContain("goal-based organization");
    expect(html).not.toMatch(/goal-based ranking/i);
    expect(html).toContain("Refine");
    // Compact strip stays lightweight - no full value grid.
    expect(html).not.toContain("Week-One Action Plan");
  });
});
