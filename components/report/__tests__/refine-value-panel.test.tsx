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
  it("previews the value refine unlocks, with hedged estimate language (RF6/WU5)", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel report={reportFixture()} context="instant" onRefine={() => {}} />,
    );
    expect(html).toContain("Location-Only Snapshot");
    expect(html).toContain("Dollar Estimates");
    expect(html).toContain("Week-One Action Plan");
    expect(html).toContain("Document Gap Checklist");
    // Concrete but hedged teaser from the engine's modeled assumptions.
    expect(html).toContain("Small Business Improvement Fund (SBIF)");
    expect(html).toMatch(/90%/);
    // Product boundary: estimates, never eligibility determinations.
    expect(html).toContain("planning estimates, not eligibility determinations");
    expect(html).toContain("verification with its administrator");
    // Honest expectations for the full path (WU5).
    expect(html).toContain("3 short screens");
  });

  it("offers the inline two-field quick refine when the pipeline supports it (BM1)", () => {
    const html = renderToStaticMarkup(
      <RefineValuePanel
        report={reportFixture()}
        context="instant"
        onRefine={() => {}}
        onQuickRefine={() => {}}
      />,
    );
    expect(html).toContain("Quick Refine");
    expect(html).toContain("Project Budget");
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
    expect(html).toContain("Refine");
    // Compact strip stays lightweight — no full value grid.
    expect(html).not.toContain("Week-One Action Plan");
  });
});
