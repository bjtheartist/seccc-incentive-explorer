import { describe, expect, it } from "vitest";
import { INITIAL_WIZARD_STATE } from "../report-wizard-config";
import type { WizardState } from "../report-wizard-config";
import { decodeWizardState, encodeWizardState } from "../url-state";

describe("wizard URL state", () => {
  it("stamps wv=2 on every encoded link, including an otherwise-empty state", () => {
    // decodeWizardState returns null outright when `wv` is absent, so the
    // encoder emitting it is what makes a shared link decodable at all. Every
    // other case here decodes a hand-written `wv=2` string; nothing pinned the
    // ENCODE side, so a dropped stamp would have silently produced links that
    // decode to null.
    expect(encodeWizardState(INITIAL_WIZARD_STATE)).toContain("wv=2");

    const populated = encodeWizardState({
      ...INITIAL_WIZARD_STATE,
      reportType: "site-incentives",
      address: "4200 S California Ave",
      projectGoals: ["hiring"],
      projectType: "hiring",
    });
    expect(populated).toContain("wv=2");
    // And the stamp survives the round trip the decoder gates on.
    expect(decodeWizardState(new URLSearchParams(populated))).not.toBeNull();
  });

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

  it("drops unknown and duplicate goal ids from a crafted pg, keeping known ids and other/customGoal", () => {
    // NEW-R4-3: pg is attacker-writable — junk strings must not become goal
    // ids that ride the gate's pass-through budget into the engine.
    const encodedGoals = btoa(
      JSON.stringify(["constructor", "hiring", "hiring", "not-a-goal", "other"])
    );
    const decoded = decodeWizardState(
      new URLSearchParams(`wv=2&rt=si&pg=${encodedGoals}&cg=Community+kitchen`)
    );
    expect(decoded?.projectGoals).toEqual(["hiring", "other"]);
    expect(decoded?.projectType).toBe("hiring");
    expect(decoded?.customGoal).toBe("Community kitchen");
  });

  it("decodes an all-junk pg to no goals at all", () => {
    const encodedGoals = btoa(JSON.stringify(["aaa", "bbb", "ccc"]));
    const decoded = decodeWizardState(new URLSearchParams(`wv=2&rt=si&pg=${encodedGoals}`));
    expect(decoded?.projectGoals).toEqual([]);
    expect(decoded?.projectType).toBe("");
  });

  it("ignores an unknown pt so junk never becomes the fallback goal", () => {
    const decoded = decodeWizardState(new URLSearchParams("wv=2&rt=si&pt=nonsense"));
    expect(decoded?.projectType).toBe("");
    expect(decoded?.projectGoals).toEqual([]);
  });

  it("never casts an unknown rt into reportType, while legacy full names still map", () => {
    expect(decodeWizardState(new URLSearchParams("wv=2&rt=junk"))?.reportType).toBeNull();
    expect(
      decodeWizardState(new URLSearchParams("wv=2&rt=location-incentives"))?.reportType
    ).toBe("site-incentives");
    expect(decodeWizardState(new URLSearchParams("wv=2&rt=ci"))?.reportType).toBe(
      "corridor-intelligence"
    );
  });
});
