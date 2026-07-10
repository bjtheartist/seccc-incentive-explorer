import { describe, expect, it } from "vitest";
import { INITIAL_WIZARD_STATE, type WizardState } from "@/lib/report-wizard-config";
import { deriveIsInstantMode } from "./page";

/**
 * RF1 (confirmed, 2026-07-10 report-workflow audit): this page previously
 * rendered <ReportDisplay onRefine={...} /> without ever passing
 * `isInstantMode`, and both ReportDisplay forks gate the "Refine with
 * Project Details" button on `isInstantMode && onRefine` (see
 * components/report/ReportDisplay.tsx and app/report/page.tsx's in-file
 * ReportDisplay). Since `onRefine` is always supplied here, `isInstantMode`
 * was the only variable controlling whether the button could ever render —
 * and it was always `undefined` (falsy), so refine was dead code on every
 * saved Workspace report regardless of what was actually saved.
 *
 * These tests exercise the same boolean this page now feeds into that gate.
 */
describe("deriveIsInstantMode (RF1 regression)", () => {
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
