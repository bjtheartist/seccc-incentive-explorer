import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  REPORT_TYPE_OPTIONS,
  WIZARD_STEPS,
  getStepsForReportType,
  isSnapshotWizardState,
  INITIAL_WIZARD_STATE,
} from "@/lib/report-wizard-config";
import {
  confirmedProgramsFromReport,
  estimateProgramsValue,
  programValueTeaser,
  CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { isAnalyticsEventType } from "@/lib/analytics-events";
import { REPORT_GENERATED_EVENTS } from "@/lib/analytics-dashboard";
import { generatedReportEventType } from "@/lib/report-generated-event";

// ─── Corridor Intelligence is a first-class report type (audit RF7/WU7) ──

describe("corridor intelligence report type", () => {
  it("appears in the selectable report type options", () => {
    const corridor = REPORT_TYPE_OPTIONS.find(
      (option) => option.id === "corridor-intelligence",
    );
    expect(corridor).toBeDefined();
    expect(corridor?.title).toBe("Corridor Intelligence");
    expect(corridor?.bestFor).toMatch(/lender|corridor|chamber/i);
  });

  it("appears in the report-type wizard step options", () => {
    const reportTypeStep = WIZARD_STEPS.find((step) => step.id === "report-type");
    expect(reportTypeStep?.options?.some((o) => o.id === "corridor-intelligence")).toBe(true);
  });

  it("has a complete wizard flow: type -> corridor geography -> review", () => {
    const steps = getStepsForReportType("corridor-intelligence").map((s) => s.id);
    expect(steps).toEqual(["report-type", "ci-corridor", "ci-review"]);
  });
});

// ─── New analytics events (trackEvent union + dashboard) ─────────────

describe("tier 1 analytics events", () => {
  it("declares the new refine/corridor event types", () => {
    expect(isAnalyticsEventType("corridor_report_generated")).toBe(true);
    expect(isAnalyticsEventType("refine_value_preview_shown")).toBe(true);
    expect(isAnalyticsEventType("inline_refine_used")).toBe(true);
  });

  it("counts corridor reports as generated reports in the dashboard", () => {
    expect(REPORT_GENERATED_EVENTS).toContain("corridor_report_generated");
  });

  it("maps corridor generations to their own event in the shared gate module", () => {
    const corridorReport = {
      ...reportFixture(),
      reportType: "corridor-intelligence" as const,
      sections: [],
    };
    expect(generatedReportEventType(corridorReport, false, false)).toBe(
      "corridor_report_generated",
    );
    // Snapshot/refined mapping unchanged (PR #51 double-fire fix semantics).
    expect(generatedReportEventType(reportFixture(), true, false)).toBe(
      "location_snapshot_generated",
    );
    expect(generatedReportEventType(reportFixture(), true, true)).toBe(
      "refined_report_generated",
    );
  });
});

// ─── Refine value helpers (audit RF6: preview real engine values) ─────

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
          { label: "No-id item", value: "" },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
  };
}

describe("refine value preview helpers", () => {
  it("extracts address-confirmed programs from a generated report", () => {
    expect(confirmedProgramsFromReport(reportFixture())).toEqual([
      { id: "sbif", name: "Small Business Improvement Fund (SBIF)" },
      { id: "tif", name: "TIF District Funding" },
    ]);
  });

  it("previews a hedged value teaser only for programs with modeled percentages", () => {
    expect(programValueTeaser("sbif")).toMatch(/90%/);
    // federalOZ is modeled at 0% — no dollar teaser should be claimed.
    expect(programValueTeaser("federalOZ")).toBeNull();
    expect(programValueTeaser("not-a-program")).toBeNull();
  });

  it("matches the refined report's benefit-estimate math (caps included)", () => {
    const estimate = estimateProgramsValue(
      [
        { id: "sbif", name: "SBIF" },
        { id: "tif", name: "TIF" },
      ],
      "500k-2m",
    );
    // SBIF: 90% of $1M capped at $250K; TIF: 25% of $1M = $250K.
    expect(estimate?.total).toBe(500_000);
    expect(estimate?.totalFormatted).toBe("$500K");
    expect(estimate?.items).toHaveLength(2);
  });

  it("returns null when the budget range is unknown or nothing is estimable", () => {
    expect(estimateProgramsValue([{ id: "sbif", name: "SBIF" }], "")).toBeNull();
    expect(estimateProgramsValue([{ id: "federalOZ", name: "OZ" }], "500k-2m")).toBeNull();
  });
});

// ─── Saved snapshot detection (audit RF1: workspace refine CTA) ──────

describe("isSnapshotWizardState", () => {
  it("treats a location-only site-incentives state as a snapshot", () => {
    expect(
      isSnapshotWizardState({
        ...INITIAL_WIZARD_STATE,
        reportType: "site-incentives",
        address: "9101 S Commercial Ave",
        lat: 41.73,
        lon: -87.55,
      }),
    ).toBe(true);
  });

  it("does not treat refined or non-site reports as snapshots", () => {
    expect(
      isSnapshotWizardState({
        ...INITIAL_WIZARD_STATE,
        reportType: "site-incentives",
        budgetRange: "500k-2m",
      }),
    ).toBe(false);
    expect(
      isSnapshotWizardState({ ...INITIAL_WIZARD_STATE, reportType: "dev-feasibility" }),
    ).toBe(false);
    expect(isSnapshotWizardState(undefined)).toBe(false);
  });
});

// ─── Fork sync regression (audit RF2 — forks intentionally NOT merged;
//     the shared refine surface must stay wired into both) ─────────────

describe("ReportDisplay forks keep the shared refine panel", () => {
  const root = process.cwd();
  const liveFork = readFileSync(join(root, "app/report/page.tsx"), "utf8");
  const workspaceFork = readFileSync(
    join(root, "components/report/ReportDisplay.tsx"),
    "utf8",
  );

  it("both forks render RefineValuePanel", () => {
    expect(liveFork).toContain("RefineValuePanel");
    expect(workspaceFork).toContain("RefineValuePanel");
  });

  it("both forks render the engine's benefit estimates (RF6)", () => {
    expect(liveFork).toContain("BenefitEstimatesBlock");
    expect(workspaceFork).toContain("BenefitEstimatesBlock");
  });

  it("the old undersell banner copy is gone from both forks", () => {
    const oldCopy = "does not yet account for your project goals";
    expect(liveFork).not.toContain(oldCopy);
    expect(workspaceFork).not.toContain(oldCopy);
  });
});
