import { describe, expect, it } from "vitest";
import {
  buildChecklist,
  deriveIsInstantMode,
  derivePersonaLensVisible,
  goalLabel,
  GOAL_OPTIONS,
  isGoalType,
  normalizeChecklist,
} from "../workspace";
import { INITIAL_WIZARD_STATE, type WizardState } from "../report-wizard-config";

describe("workspace goals", () => {
  it("defines all MVP goal options", () => {
    expect(GOAL_OPTIONS.map((goal) => goal.id)).toEqual([
      "improve-storefront",
      "buy-equipment",
      "hire-staff",
      "expand-location",
      "open-relocate",
      "acquire-vacant-property",
      "development-feasibility",
    ]);
  });

  it("builds a default checklist for every goal", () => {
    for (const goal of GOAL_OPTIONS) {
      const checklist = buildChecklist(goal.id);
      expect(checklist.length).toBeGreaterThan(0);
      expect(checklist.every((item) => item.completed === false)).toBe(true);
      expect(goalLabel(goal.id)).toBe(goal.label);
    }
  });

  it("validates goal types", () => {
    expect(isGoalType("buy-equipment")).toBe(true);
    expect(isGoalType("not-a-goal")).toBe(false);
  });

  it("normalizes persisted checklist items", () => {
    expect(
      normalizeChecklist([
        { id: "a", label: "Collect bids", completed: true },
        { label: "Call partner" },
        { id: "bad" },
        null,
      ])
    ).toEqual([
      { id: "a", label: "Collect bids", completed: true },
      { id: "item-2", label: "Call partner", completed: false },
    ]);
  });
});

describe("deriveIsInstantMode (RF1 regression)", () => {
  // RF1 (confirmed, 2026-07-10 report-workflow audit):
  // app/workspace/reports/[id]/page.tsx previously rendered
  // <ReportDisplay onRefine={...} /> without ever passing `isInstantMode`,
  // and both ReportDisplay forks gate the "Refine with Project Details"
  // button on `isInstantMode && onRefine` (see
  // components/report/ReportDisplay.tsx and app/report/page.tsx's in-file
  // ReportDisplay). Since `onRefine` is always supplied on that page,
  // `isInstantMode` was the only variable controlling whether the button
  // could ever render — and it was always `undefined` (falsy), so refine
  // was dead code on every saved Workspace report regardless of what was
  // actually saved. These tests exercise the same boolean the page now
  // feeds into that gate.

  it("is true for a saved report that was never refined (bare instant snapshot)", () => {
    // Exactly the shape MapView/AddressSearch produce for an instant
    // snapshot: reportType + address/lat/lon set, no refine-only fields.
    const instantWizardState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "3039 E 91st St, Chicago, IL",
      lat: 41.7327,
      lon: -87.5563,
    };

    expect(deriveIsInstantMode(instantWizardState)).toBe(true);
  });

  it("is false once the report has been refined with project details", () => {
    const refinedWizardState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "3039 E 91st St, Chicago, IL",
      lat: 41.7327,
      lon: -87.5563,
      industry: "retail",
      budgetRange: "100k-500k",
      timeline: "0-6-months",
    };

    expect(deriveIsInstantMode(refinedWizardState)).toBe(false);
  });

  it("is false for non-site-incentives report types (vacancy/corridor were never an instant flow)", () => {
    const vacancyWizardState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      reportType: "dev-feasibility",
    };

    expect(deriveIsInstantMode(vacancyWizardState)).toBe(false);
  });

  it("is false when there is no saved wizard state at all", () => {
    expect(deriveIsInstantMode(undefined)).toBe(false);
  });
});

describe("derivePersonaLensVisible (Tier 1b, BM4)", () => {
  // Deliberately BROADER than deriveIsInstantMode: persona (audience) and
  // goal (project outcome) are orthogonal lenses, so the chips stay on
  // goal-refined site reports — the shape the email gate funnels every real
  // instant-flow user into.

  it("is true for a bare instant snapshot", () => {
    expect(
      derivePersonaLensVisible({
        ...INITIAL_WIZARD_STATE,
        reportType: "site-incentives",
        address: "3039 E 91st St, Chicago, IL",
        lat: 41.7327,
        lon: -87.5563,
      }),
    ).toBe(true);
  });

  it("stays true on a goal-refined site report (where deriveIsInstantMode is false)", () => {
    const refinedWizardState: WizardState = {
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "3039 E 91st St, Chicago, IL",
      lat: 41.7327,
      lon: -87.5563,
      industry: "retail",
      budgetRange: "100k-500k",
      timeline: "0-6-months",
    };
    expect(deriveIsInstantMode(refinedWizardState)).toBe(false);
    expect(derivePersonaLensVisible(refinedWizardState)).toBe(true);
  });

  it("is false for non-site report types and missing state", () => {
    expect(
      derivePersonaLensVisible({
        ...INITIAL_WIZARD_STATE,
        reportType: "dev-feasibility",
      }),
    ).toBe(false);
    expect(derivePersonaLensVisible(undefined)).toBe(false);
  });
});
