import { describe, expect, it } from "vitest";
import { INITIAL_WIZARD_STATE } from "../report-wizard-config";
import type { WizardState } from "../report-wizard-config";
import { decodeWizardState, encodeWizardState } from "../url-state";

describe("wizard URL state", () => {
  it("round-trips up to three goals and custom goal text", () => {
    const query = encodeWizardState({
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "4200 S California Ave",
      lat: 41.8169,
      lon: -87.6949,
      projectGoals: ["hiring", "equipment", "other"],
      projectType: "hiring",
      customGoal: "Open a shared commercial kitchen",
    });
    const decoded = decodeWizardState(new URLSearchParams(query));

    expect(query).toContain("pt=hiring");
    expect(query).toContain("pg=");
    expect(query).toContain("cg=Open+a+shared+commercial+kitchen");
    expect(query).not.toContain("bud=");
    expect(decoded?.projectType).toBe("hiring");
    expect(decoded?.projectGoals).toEqual(["hiring", "equipment", "other"]);
    expect(decoded?.customGoal).toBe("Open a shared commercial kitchen");
    expect(decoded?.budgetRange).toBe("");
    expect(decoded?.timeline).toBe("");
  });

  it("shares a report saved before customGoal existed", () => {
    // Reproduces app/workspace/reports/[id]: persisted JSON cast straight to
    // WizardState, so `customGoal` is missing rather than "". Spreading
    // INITIAL_WIZARD_STATE (as every other case here does) would hide this.
    const { customGoal: _omitted, ...legacyState } = {
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives" as const,
      address: "4200 S California Ave",
      projectGoals: ["hiring"],
      projectType: "hiring",
    };

    const query = encodeWizardState(legacyState as WizardState);

    expect(query).toContain("pt=hiring");
    expect(query).not.toContain("cg=");
    expect(decodeWizardState(new URLSearchParams(query))?.projectType).toBe("hiring");
  });

  it("keeps legacy single-goal links working", () => {
    const decoded = decodeWizardState(new URLSearchParams("wv=2&rt=si&pt=rehab"));
    expect(decoded?.projectType).toBe("rehab");
    expect(decoded?.projectGoals).toEqual(["rehab"]);
  });

  it("caps malformed shared state at three string goals", () => {
    const encodedGoals = btoa(JSON.stringify(["hiring", "equipment", "rehab", "energy", 42]));
    const decoded = decodeWizardState(new URLSearchParams(`wv=2&rt=si&pg=${encodedGoals}`));
    expect(decoded?.projectGoals).toEqual(["hiring", "equipment", "rehab"]);
    expect(decoded?.projectType).toBe("hiring");
  });
});
