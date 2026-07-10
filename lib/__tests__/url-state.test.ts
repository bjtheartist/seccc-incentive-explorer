import { describe, expect, it } from "vitest";
import { INITIAL_WIZARD_STATE } from "../report-wizard-config";
import { decodeWizardState, encodeWizardState } from "../url-state";

describe("wizard URL state", () => {
  it("round-trips the primary goal when optional refine fields are empty", () => {
    const query = encodeWizardState({
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "4200 S California Ave",
      lat: 41.8169,
      lon: -87.6949,
      projectType: "hiring",
    });
    const decoded = decodeWizardState(new URLSearchParams(query));

    expect(query).toContain("pt=hiring");
    expect(query).not.toContain("bud=");
    expect(decoded?.projectType).toBe("hiring");
    expect(decoded?.budgetRange).toBe("");
    expect(decoded?.timeline).toBe("");
  });
});
