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
  // wizard shape. On a real persona board the board header owns the switch-
  // to-All affordance, so the old chip row is intentionally hidden there.
  // RefineValuePanel keeps the diminished prop by design.
  it("chips gate on showPersonaLens and stay out of the board chrome in both forks", () => {
    expect(liveFork).toContain("{showPersonaLens && !showPersonaView && !compact && (");
    expect(workspaceFork).toContain("{showPersonaLens && !showPersonaView && !compact && (");
    expect(liveFork).toContain("{showPersonaLens && showPersonaView && !compact && (");
    expect(workspaceFork).toContain("{showPersonaLens && showPersonaView && !compact && (");
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
      expect(fork).toContain('boardPersona && boardPersona !== "looking" && (');
      expect(fork).toContain("sectionNumber={personaContactSectionNumber(boardPersona)}");
    }
  });

  it("both forks feed the shared executive-summary panel the lensed report (strict cards first, disclosure fill handled by the shared panel)", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("PersonaExecutiveSummary");
      expect(fork).toContain('report={boardPersona === "looking" ? report : lensed}');
    }
  });

  it("both forks feed the shared Also disclosure the collapsed lensed items, not a dead count-only line", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("<PersonaAlsoAtAddress items={personaAlsoSection.items} />");
      expect(fork).not.toContain("<PersonaAlsoAtAddress count=");
    }
  });

  it("Part-03 correction: both forks suppress raw support sections, and the live fork also suppresses both elevated support bands", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toMatch(
        /isSupportOrganizationSectionTitle\(section\.title\) &&\s*showPersonaView\s*\) \{\s*return \[\];/,
      );
    }
    expect(liveFork).toContain("{!showPersonaView && supportItems.length > 0 && !compact && (");
    expect(liveFork).toContain("{!showPersonaView && supportSection && supportItems.length > 0 && (");
  });

  it("both forks render shared ProgramCardExtras on the one expanded persona card", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("import { ProgramCardExtras }");
      expect(fork).toContain("<ProgramCardExtras item={item} />");
    }
  });

  it("both forks mount the shared board supplement renderer for owner/supporter documents", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("PersonaProgramSupplements");
      expect(fork).toContain("lensedReport={lensed}");
    }
  });

  it("both forks mount charts only through the shared supplements at their blessed board positions", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("PersonaNeighborhoodSupplement");
      expect(fork).toContain("PersonaProgramSupplements");
      expect(fork).not.toContain("<FundingWindowChart");
      expect(fork).not.toContain("<IncentiveHorizonChart");
      expect(fork).not.toContain("<CorridorInvestmentChart");
    }
  });

  // Gate finding 8 (major, regression): The Brief used to mount ONLY in
  // app/report/page.tsx — zero references anywhere in
  // components/report/ReportDisplay.tsx, the one shared component in this
  // list that had NO fork-parity assertion at all. Closed: the workspace/
  // saved-report fork now mounts the identical Brief (button, ask,
  // overlay, print-2up) off the same lensed report + persona.
  it("both forks render The Brief — the 'Build My Brief' trigger, the two-question ask, and the open overlay with BriefPage", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("import { BriefStageAsk }");
      expect(fork).toContain("import { BriefPage }");
      expect(fork).toContain(
        'showPersonaLens && persona !== DEFAULT_PERSONA && reportWizardState && (',
      );
      expect(fork).toContain("Build My Brief");
      expect(fork).toContain("briefState.askOpen && (");
      expect(fork).toContain("<BriefStageAsk\n");
      expect(fork).toContain("onComplete={handleBriefComplete}");
      expect(fork).toContain('briefState.open && briefState.stage && briefState.priority && (');
      expect(fork).toContain('id="brief-overlay"');
      expect(fork).toContain("<BriefPage\n                report={lensed}");
      expect(fork).toContain('id="brief-print-2up"');
    }
  });

  // Gate finding 11 + gate round 2 BLOCKER 11. Demoted, gate round 3
  // BLOCKER 11 RULING: this is a SOURCE-GREP check — it proves the three
  // components (ProgramCardFace, ReasonChips, ProgramCardExtras) are
  // MOUNTED in that order in both forks' source text, and that none of
  // them appear inside the accordion. It does NOT and cannot prove the
  // fine-grained board order WITHIN each component (cost signals before
  // "What it funds" before "Commonly required" inside Face; "Can combine
  // with" before next-step before "What to expect" before "Verify at the
  // source" inside Extras) — the earlier title's "in board order" claimed
  // more than this test actually checks. The real, render-level proof of
  // full board order lives in
  // components/report/__tests__/program-card-order.test.tsx.
  it("both forks MOUNT ProgramCardFace, then ReasonChips, then ProgramCardExtras on the card face, in that order, none inside the accordion (source-grep mount-order check — see program-card-order.test.tsx for the real render-level board-order proof)", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain("import { ReasonChips }");
      expect(fork).toContain("import { ProgramCardFace }");
      expect(fork).toContain("import { ProgramCardExtras }");
      // Board order: face, then reason chips, then the extras block —
      // ReasonChips no longer renders BEFORE ProgramCardFace (round 1).
      const faceIdx = fork.indexOf("<ProgramCardFace item={item} />");
      const chipsIdx = fork.indexOf("<ReasonChips explanation={item.matchExplanation} />");
      const extrasIdx = fork.indexOf("<ProgramCardExtras item={item} />");
      expect(faceIdx, `${fork === liveFork ? "live" : "workspace"} fork: ProgramCardFace present`).toBeGreaterThan(-1);
      expect(chipsIdx, "ReasonChips present").toBeGreaterThan(-1);
      expect(extrasIdx, "ProgramCardExtras present").toBeGreaterThan(-1);
      expect(faceIdx).toBeLessThan(chipsIdx);
      expect(chipsIdx).toBeLessThan(extrasIdx);
      // The accordion's gate no longer includes item.eligibilityRules —
      // that content moved to ProgramCardFace's "Commonly required".
      expect(fork).toContain(
        '{!showPersonaView && !isSupportNetworkItem && (item.matchExplanation || item.url || hasNavigationLinks) && (',
      );
      expect(fork).not.toContain("item.matchExplanation || item.eligibilityRules || item.url");
      // ProgramCardExtras must NOT appear inside the accordion's own
      // AccordionContent block — only once, on the face.
      const accordionContentStart = fork.indexOf("report-eligibility pl-4 border-l");
      const accordionContentEnd = fork.indexOf("</AccordionContent>", accordionContentStart);
      const accordionContent = fork.slice(accordionContentStart, accordionContentEnd);
      expect(accordionContent).not.toContain("<ProgramCardExtras");
      expect(accordionContent).not.toContain("<ReasonChips");
      expect(accordionContent).not.toContain("<ProgramCardFace");
    }
  });

  it("both forks render the looking board in its exact three-part sequence with no contact sheet", () => {
    for (const fork of [liveFork, workspaceFork]) {
      expect(fork).toContain('boardPersona === "looking" && renderGuidepostBand(1)');
      expect(fork).toContain('boardPersona === "looking" && (');
      expect(fork).toContain('<WhatsNotablePanel report={report} sectionNumber="03" />');
      expect(fork).toContain('sectionNumber="04"');
      expect(fork).toContain('fullPictureSectionNumber="05"');
      expect(fork).toContain('boardPersona && boardPersona !== "looking" && (');
    }
  });
});
