import { describe, expect, it } from "vitest";
import { generateReportPdfBase64, orderSectionsForPdf } from "../pdf-report";
import {
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "../report-engine";
import type { GeneratedReport } from "../report-engine";
import { CAPITAL_PARTNER_SECTION_TITLE } from "../capital-partner-report";
import { extractText } from "unpdf";

function section(title: string): GeneratedReport["sections"][number] {
  return { title, items: [] };
}

describe("orderSectionsForPdf", () => {
  it("puts action sections before preparation and supporting context", () => {
    const input = [
      section("Site Overview"),
      section("Neighborhood Economic Context"),
      section("Incentive Zone Coverage & Program Interactions"),
      section("Eligible Incentive Programs"),
      section("Additional Programs to Explore"),
      section("Required Documents"),
      section("Your Support Network"),
      section("Upcoming Deadlines Near This Address"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles).toEqual([
      "Eligible Incentive Programs",
      "Upcoming Deadlines Near This Address",
      "Your Support Network",
      "Additional Programs to Explore",
      "Required Documents",
      "Site Overview",
      "Incentive Zone Coverage & Program Interactions",
      "Neighborhood Economic Context",
    ]);
  });

  it("puts Your Support Network first when Eligible Incentive Programs is absent", () => {
    const input = [
      section("Market Signal Summary"),
      section("Your Support Network"),
      section("Data Sources"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles[0]).toBe("Your Support Network");
    expect(titles).toHaveLength(3);
  });

  it("places Your Support Network after both goal-ranked confirmed sections", () => {
    const input = [
      section("Site Overview"),
      section(GOAL_MATCH_PROGRAMS_SECTION_TITLE),
      section("Additional Programs to Explore"),
      section(OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE),
      section("Your Support Network"),
    ];

    expect(orderSectionsForPdf(input).map((item) => item.title)).toEqual([
      GOAL_MATCH_PROGRAMS_SECTION_TITLE,
      OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
      "Your Support Network",
      "Additional Programs to Explore",
      "Site Overview",
    ]);
  });

  it("places the financing resource before the support network", () => {
    const input = [
      section("Site Overview"),
      section("Your Support Network"),
      section("Eligible Incentive Programs"),
      section(CAPITAL_PARTNER_SECTION_TITLE),
      section("Required Documents"),
    ];

    expect(orderSectionsForPdf(input).map((item) => item.title)).toEqual([
      "Eligible Incentive Programs",
      CAPITAL_PARTNER_SECTION_TITLE,
      "Your Support Network",
      "Required Documents",
      "Site Overview",
    ]);
  });

  it("returns sections unchanged when there is no Support Network section", () => {
    const input = [section("A"), section("B"), section("C")];
    expect(orderSectionsForPdf(input).map((s) => s.title)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      section("Eligible Incentive Programs"),
      section("Required Documents"),
      section("Your Support Network"),
    ];
    const before = input.map((s) => s.title);
    orderSectionsForPdf(input);
    expect(input.map((s) => s.title)).toEqual(before);
  });

  it("generates a five-page action report with the new brand and workflow", async () => {
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Test report",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "A focused report.",
      sections: [
        {
          title: "Site Overview",
          items: [
            {
              label: "Transportation & Site Access",
              value: "Strong public transit access",
              detailGroups: [
                { id: "cta-rail", label: "CTA rail", items: ["Western (Orange Line) · 0.9 mi"] },
                { id: "drive", label: "Drive access", items: ["Stevenson Expy (I-55) · 1.0 mi"] },
              ],
              detailCaveat: "Distances are straight-line proximity signals.",
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: {
        address: "4200 S California Ave, Chicago, IL",
        projectType: "hiring",
      },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: true,
    });
    expect(output.filename).toBe(
      "chicago-incentive-report-4200-s-california-ave-chicago-il.pdf",
    );
    expect(output.base64.length).toBeGreaterThan(1_000);
    expect(extracted.totalPages).toBe(5);
    expect(extracted.text).toContain("CHICAGO INCENTIVE EXPLORER");
    expect(extracted.text).toContain("Review the Findings");
    expect(extracted.text).toContain("Who to Contact Next");
    expect(extracted.text).toContain("Take the Next Step");
  });
});
