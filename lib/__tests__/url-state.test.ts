import { describe, expect, it } from "vitest";
import { INITIAL_WIZARD_STATE } from "../report-wizard-config";
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
