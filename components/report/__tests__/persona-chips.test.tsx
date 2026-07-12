import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonaChips } from "@/components/report/PersonaChips";
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
          { label: "SBIF", value: "", programId: "sbif" },
          { label: "Federal OZ", value: "", programId: "federalOZ" },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
  };
}

describe("PersonaChips", () => {
  it("renders the VIEWING AS row with all four lenses", () => {
    const html = renderToStaticMarkup(
      <PersonaChips persona="all" onSelect={() => {}} report={reportFixture()} />,
    );
    expect(html).toContain("Viewing As");
    expect(html).toContain("All");
    expect(html).toContain("Starting a business");
    expect(html).toContain("Growing / property owner");
    expect(html).toContain("Developer or investor");
    // Descriptive framing only — never an eligibility claim on the chips.
    expect(html).not.toContain("eligible");
    expect(html).not.toContain("qualify");
  });

  it("marks the active lens as pressed", () => {
    const html = renderToStaticMarkup(
      <PersonaChips
        persona="developer"
        onSelect={() => {}}
        report={reportFixture()}
      />,
    );
    // The selected chip carries aria-pressed="true"; exactly one is active.
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) || []).length).toBe(3);
  });

  it("hides from print (export renders the canonical 'All' view)", () => {
    const html = renderToStaticMarkup(
      <PersonaChips persona="all" onSelect={() => {}} report={reportFixture()} />,
    );
    expect(html).toContain("print:hidden");
  });
});
