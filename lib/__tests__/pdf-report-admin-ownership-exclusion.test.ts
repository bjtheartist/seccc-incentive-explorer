import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateReportPdf, generateReportPdfBase64 } from "../pdf-report";
import type { GeneratedReport } from "../report-engine";

/**
 * The admin-only ownership context panel (components/report/AdminOwnershipPanel.tsx,
 * fed by lib/owner-file-report-context.ts) is screen-only and must never
 * reach the PDF download or emailed report — see the panel's own header
 * comment and the "Internal ... Not included in shared/emailed reports"
 * disclaimer it renders. Both export entry points
 * (generateReportPdf/generateReportPdfBase64) take only a GeneratedReport,
 * and GeneratedReport has no ownership-context field, so there is no
 * parameter through which this data could be threaded in the first place.
 * These tests pin that contract down as an explicit regression guard.
 */

function baseReport(): GeneratedReport {
  return {
    title: "Corridor Intelligence Pilot — ZIP 60617",
    subtitle: "",
    reportType: "corridor-intelligence",
    generatedAt: new Date().toISOString(),
    summary: "",
    sections: [
      {
        title: "Market Signal Summary",
        description: "",
        items: [{ label: "Vacancy pressure", value: "12%" }],
      },
    ],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
  };
}

describe("PDF export excludes admin ownership context", () => {
  it("generateReportPdf and generateReportPdfBase64 accept only the report — no side channel for admin-only data", () => {
    expect(generateReportPdf.length).toBe(1);
    expect(generateReportPdfBase64.length).toBe(1);
  });

  it("does not leak an accidentally-attached ownership marker into the rendered PDF bytes", () => {
    const MARKER = "SECRET-OWNER-SHOULD-NEVER-APPEAR-IN-PDF-9f3c";
    // Simulates a hypothetical future wiring mistake: something merges
    // admin-only ownership context onto the report object before export.
    // GeneratedReport has no such field, so this requires a cast — the
    // point of the test is that even if it somehow got attached, the PDF
    // builder only reads the documented GeneratedReport shape and ignores it.
    const leaked = {
      ...baseReport(),
      adminOwnershipContext: { ownerName: MARKER },
    } as GeneratedReport & { adminOwnershipContext: unknown };

    const { base64 } = generateReportPdfBase64(leaked);
    const bytes = Buffer.from(base64, "base64").toString("latin1");
    expect(bytes).not.toContain(MARKER);
  });

  it("the PDF and email pipelines never import the admin ownership panel or its data module", () => {
    const files = [
      "lib/pdf-report.ts",
      "lib/report-email.ts",
      "app/api/email-report/route.ts",
    ];
    for (const file of files) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src, `${file} must not reference the admin ownership panel/module`).not.toMatch(
        /AdminOwnershipPanel|owner-file-report-context|owner-cluster-geo/
      );
    }
  });
});
