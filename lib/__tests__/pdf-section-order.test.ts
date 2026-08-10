import { describe, expect, it } from "vitest";
import { generateReportPdfBase64, orderSectionsForPdf, sanitizeForPdf } from "../pdf-report";
import {
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "../report-engine";
import type { GeneratedReport } from "../report-engine";
import { CAPITAL_PARTNER_SECTION_TITLE } from "../capital-partner-report";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "../support-organization-copy";
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
      section(SUPPORT_ORGANIZATIONS_SECTION_TITLE),
      section("Upcoming Deadlines Near This Address"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles).toEqual([
      "Eligible Incentive Programs",
      "Upcoming Deadlines Near This Address",
      SUPPORT_ORGANIZATIONS_SECTION_TITLE,
      "Additional Programs to Explore",
      "Required Documents",
      "Site Overview",
      "Incentive Zone Coverage & Program Interactions",
      "Neighborhood Economic Context",
    ]);
  });

  it("carries zoning and site facts into the seven-page builder's Supporting Context", async () => {
    // The report types that emit these two sections are routed away from
    // orderSectionsForPdf entirely, so ordering them here proves nothing. What
    // matters is that the seven-page builder — the real production path for
    // them — still finds both by name and prints them. Rename either section
    // in report-engine and this goes red; the previous ordering test would not.
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Test report",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "A focused report.",
      sections: [
        {
          title: "Zoning & Use Starting Point",
          items: [{ label: "Published Zoning District", value: "B3-2 on file" }],
        },
        {
          title: "Site Facts",
          items: [{ label: "Property PIN", value: "17-05-123-456-0000" }],
        },
        { title: GOAL_MATCH_PROGRAMS_SECTION_TITLE, items: [] },
      ],
      recommendedActions: [],
      metadata: { address: "100 E Test St, Chicago, IL", projectType: "hiring" },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: false,
    });
    const supportingContextPage = extracted.text[5];
    expect(supportingContextPage).toContain("Supporting Context");
    expect(supportingContextPage).toContain("Published Zoning District");
    expect(supportingContextPage).toContain("Property PIN");
  });

  it("puts support organizations first when confirmed programs are absent", () => {
    const input = [
      section("Market Signal Summary"),
      section(SUPPORT_ORGANIZATIONS_SECTION_TITLE),
      section("Data Sources"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles[0]).toBe(SUPPORT_ORGANIZATIONS_SECTION_TITLE);
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

  it("generates a seven-page action report — cover, five body pages, and a closing CTA page", async () => {
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
    // Cover -> Key Findings -> Review -> Contact -> Next Step -> Supporting Context -> CTA
    expect(extracted.totalPages).toBe(7);
    expect(extracted.text).toContain("CHICAGO INCENTIVE EXPLORER");
    // Cover: report title + address (spec addendum).
    expect(extracted.text).toContain("Chicago Business Incentive Report");
    expect(extracted.text).toContain("4200 S California Ave, Chicago, IL");
    expect(extracted.text).toContain("Review the Findings");
    expect(extracted.text).toContain("Who to Contact Next");
    expect(extracted.text).toContain("Take the Next Step");
    expect(extracted.text).toContain("Supporting Context");
    // Closing CTA page: the only contact surface is the chamber inbox — no
    // stale phone number or secchicago.org anywhere in the document.
    expect(extracted.text).toContain("Want a Hand with the Next Steps");
    expect(extracted.text).toContain("info@southeastchgochamber.org");
    expect(extracted.text).not.toContain("721-1999");
    expect(extracted.text).not.toContain("secchicago.org");
    expect(extracted.text).toContain("Page 7 of 7");
  });

  it("includes real document names (not a bare count) in Priority Documents", async () => {
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Test report",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "A focused report.",
      sections: [
        {
          title: CONFIRMED_PROGRAMS_SECTION_TITLE,
          items: [
            {
              label: "Test Program",
              value: "Benefit",
              detail: "A test program.",
            },
          ],
        },
        {
          title: "Required Documents",
          items: [
            {
              label: "Financial & Tax",
              value: "2 documents",
              detail: [
                "Last 2 years business tax returns — Test Program",
                "Profit and loss statement — Test Program",
              ].join("\n"),
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: {
        address: "100 E Test St, Chicago, IL",
        projectType: "hiring",
      },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: true,
    });
    expect(extracted.text).toContain("Last 2 years business tax returns");
    expect(extracted.text).toContain("Profit and loss statement");
  });

  it("explains the preparation-cost markers it prints", async () => {
    // report-engine emits "<doc> [$$$] — <programs>" and a "· $$" status on
    // readiness rows. This builder renders no section descriptions, so the
    // legend has to be drawn here or the dollar signs read as program money.
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Test report",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "A focused report.",
      sections: [
        {
          title: "Required Documents",
          items: [
            {
              label: "Project Plans",
              value: "2 documents",
              detail: [
                "Phase I environmental assessment [$$$] — Test Program",
                "W-9 [$] — Test Program",
              ].join("\n"),
            },
          ],
        },
        {
          title: "Document Readiness Checklist",
          items: [
            {
              label: "Business plan",
              value: "May be needed",
              preparationCost: { tier: "$$", basis: "Test basis." },
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: { address: "100 E Test St, Chicago, IL", projectType: "hiring" },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: false,
    });
    // Page 5 is "Take the Next Step" — the only page carrying the markers.
    const nextStepPage = extracted.text[4];
    expect(nextStepPage).toContain("[$$$]");
    expect(nextStepPage).toContain("Document preparation cost");
    expect(nextStepPage).toContain("usually self-provided or low/no fee");
    expect(nextStepPage).toContain("often requires specialized professional work");
    expect(nextStepPage).toContain("not program value");
  });

  it("counts the readiness rows that fit, not the ones it sliced", async () => {
    // On a dense page the footer guard drops checklist rows. The heading used
    // to promise "Top 8 items" over six printed ones.
    const docs = [
      "Phase I environmental assessment [$$$]",
      "Architectural plans [$$$]",
      "W-9 [$]",
      "Business plan [$]",
      "Certificate of good standing [$$]",
    ];
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Dense fixture",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "Dense.",
      sections: [
        {
          title: "Required Documents",
          items: ["Project Plans", "Financial & Tax", "Property & Site", "Business Registration"].map(
            (label) => ({
              label,
              value: `${docs.length} documents`,
              detail: docs.map((doc) => `${doc} — Program A, Program B`).join("\n"),
            }),
          ),
        },
        {
          title: "Document Readiness Checklist",
          items: Array.from({ length: 8 }, (_, index) => ({
            label: `Readiness item number ${index + 1}`,
            value: "May be needed",
            preparationCost: { tier: "$$" as const, basis: "Test basis." },
          })),
        },
      ],
      recommendedActions: Array.from({ length: 3 }, (_, index) => ({
        label: `Recommended action ${index + 1} with a fairly long label to wrap`,
        description:
          "A two-line description that should occupy the usual amount of vertical space on this card.",
        priority: "high" as const,
      })),
      metadata: { address: "4200 S California Ave, Chicago, IL", projectType: "hiring" },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: false,
    });
    const nextStepPage = extracted.text[4];
    const claimed = Number(nextStepPage.match(/READINESS CHECKLIST Top (\d+) items/)?.[1]);
    const printed = (nextStepPage.match(/Readiness item number \d+/g) ?? []).length;
    expect(claimed).toBeGreaterThan(0);
    expect(printed).toBe(claimed);
  });

  it("omits the preparation-cost legend when no tier is printed", async () => {
    const report: GeneratedReport = {
      title: "Site Incentive Analysis",
      subtitle: "Test report",
      reportType: "site-incentives",
      generatedAt: "2026-07-10T12:00:00.000Z",
      summary: "A focused report.",
      sections: [
        {
          title: "Required Documents",
          items: [
            {
              label: "Project Plans",
              value: "1 document",
              detail: "Site plan — Test Program",
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: { address: "100 E Test St, Chicago, IL", projectType: "hiring" },
    };

    const output = generateReportPdfBase64(report);
    const extracted = await extractText(new Uint8Array(Buffer.from(output.base64, "base64")), {
      mergePages: true,
    });
    expect(extracted.text).toContain("Site plan");
    expect(extracted.text).not.toContain("Document preparation cost");
  });
});

describe("sanitizeForPdf", () => {
  it("replaces glyphs jsPDF's standard fonts can't render, per spec defect 3", () => {
    expect(sanitizeForPdf("≤10 employees")).toBe("up to 10 employees");
    expect(sanitizeForPdf("Remediation costs ≥$100K")).toBe("Remediation costs at least $100K");
    expect(sanitizeForPdf("Rehab investment ≥50% of building market value")).toBe(
      "Rehab investment at least 50% of building market value",
    );
  });

  it("normalizes dash variants jsPDF's standard fonts can't render", () => {
    expect(sanitizeForPdf("value—range")).toBe("value-range");
    expect(sanitizeForPdf("value–range")).toBe("value-range");
    expect(sanitizeForPdf("value−range")).toBe("value-range");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeForPdf("Cook County Class 7a Property Tax Incentive")).toBe(
      "Cook County Class 7a Property Tax Incentive",
    );
  });
});
