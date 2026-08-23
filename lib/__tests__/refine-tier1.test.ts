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
  CONFIRMED_PROGRAMS_SECTION_TITLE,
} from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { isAnalyticsEventType } from "@/lib/analytics-events";
import { REPORT_GENERATED_EVENTS } from "@/lib/analytics-dashboard";
import { generatedReportEventType } from "@/lib/report-generated-event";
import { derivePersonaLensVisible } from "@/lib/workspace";

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

// ─── Refine value helpers ───────────────────────────────────────────

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

  it("neither fork renders modeled deal-total estimates", () => {
    expect(liveFork).not.toContain("BenefitEstimatesBlock");
    expect(workspaceFork).not.toContain("BenefitEstimatesBlock");
    expect(liveFork).not.toContain("Estimated Incentive Value");
    expect(workspaceFork).not.toContain("Estimated Incentive Value");
  });

  it("the old undersell banner copy is gone from both forks", () => {
    const oldCopy = "does not yet account for your project goals";
    expect(liveFork).not.toContain(oldCopy);
    expect(workspaceFork).not.toContain(oldCopy);
  });

  // ─── Tier 1b: ONE shared persona chip component wired into BOTH forks ──
  it("both forks render the shared PersonaChips component", () => {
    expect(liveFork).toContain("PersonaChips");
    expect(workspaceFork).toContain("PersonaChips");
  });

  // Live-smoke regression (2026-07-12): the email gate forces every real
  // instant-flow user into a goal-refined report, and both call sites pass
  // isInstantMode diminished by hasRefinedInstantReport — chips gated on that
  // prop were unreachable in practice (visible behind the modal backdrop,
  // gone after the gate). The chips must gate on a dedicated showPersonaLens
  // prop fed from page-level (URL-derived) instant mode / the saved-report
  // wizard shape. RefineValuePanel keeps the diminished prop by design.
  it("chips gate on showPersonaLens (never the diminished isInstantMode) in both forks", () => {
    expect(liveFork).toContain("{showPersonaLens && !compact && (");
    expect(workspaceFork).toContain("{showPersonaLens && !compact && (");
    expect(liveFork).not.toContain("{isInstantMode && !compact && (");
    expect(workspaceFork).not.toContain("{isInstantMode && !compact && (");
  });

  it("the live flow feeds showPersonaLens from derivePersonaLensVisible(wizardState) — not isInstantMode, dead on every shared/goal-refined link (BLOCKER #2)", () => {
    // Fresh-context adversarial review, finding #2: `isInstantMode` gated the
    // chips off on every shared link (`?persona=` arrived, but no chips, no
    // lens) and on every goal-refined report (the shape the email gate funnels
    // every real user into). The prop must derive from wizardState the same
    // way the (already-correct) workspace fork does.
    expect(liveFork).toContain("showPersonaLens={derivePersonaLensVisible(wizardState)}");
    expect(liveFork).not.toContain("showPersonaLens={isInstantMode}");
    expect(liveFork).not.toContain(
      "showPersonaLens={isInstantMode && !hasRefinedInstantReport}",
    );
  });

  it("share-mode regression: a shared link with a non-default wizardState.reportType shows the lens (derivePersonaLensVisible is reportType-driven, not instant-mode-driven)", () => {
    expect(derivePersonaLensVisible({ ...INITIAL_WIZARD_STATE, reportType: "site-incentives" })).toBe(true);
    expect(derivePersonaLensVisible({ ...INITIAL_WIZARD_STATE, reportType: "dev-feasibility" })).toBe(false);
    expect(derivePersonaLensVisible(undefined)).toBe(false);
  });

  it("the saved-report page feeds showPersonaLens from the site-report wizard shape", () => {
    const savedReportPage = readFileSync(
      join(root, "app/workspace/reports/[id]/page.tsx"),
      "utf8",
    );
    expect(savedReportPage).toContain(
      "showPersonaLens={derivePersonaLensVisible(wizardState)}",
    );
  });

  it("neither fork applies an invisible lens when the chips are hidden", () => {
    // A stored session persona must never silently reorder a report that
    // cannot render the chip row.
    const guard =
      "showPersonaLens ? applyPersonaLens(report, persona).report : report";
    expect(liveFork).toContain(guard);
    expect(workspaceFork).toContain(guard);
  });

  it("both forks drive the on-screen body from the persona-lensed report", () => {
    expect(liveFork).toContain("lensed.sections");
    expect(workspaceFork).toContain("lensed.sections");
    expect(liveFork).toContain("lensed.actionRoadmap");
    expect(workspaceFork).toContain("lensed.actionRoadmap");
  });

  it("both forks export the PDF from the canonical report (print = 'All')", () => {
    // The lens only re-shapes the on-screen `lensed` copy; PDF/export must read
    // the untouched `report` so a forwarded/printed snapshot is the full view.
    expect(liveFork).toContain("generateReportPdf(report)");
    expect(workspaceFork).toContain("generateReportPdf(report)");
    expect(liveFork).not.toContain("generateReportPdf(lensed)");
    expect(workspaceFork).not.toContain("generateReportPdf(lensed)");
  });

  // ─── spec v2: guidepost bands + Contact Sheet, both forks ─────────────
  it("both forks render the guidepost band via the shared guidepostPartForSection lookup, never a hardcoded persona check", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("guidepostPartForSection(section, persona)");
      expect(fork).toContain("renderGuidepostBand(guidepostPart)");
    }
  });

  it("both forks render the shared ContactSheet component, gated to a real persona lens (never on 'all')", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("import { ContactSheet }");
      expect(fork).toContain("showPersonaLens && persona !== DEFAULT_PERSONA && (");
      expect(fork).toContain("<ContactSheet report={lensed} persona={persona} />");
    }
  });
});
