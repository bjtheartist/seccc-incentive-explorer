import { describe, expect, it } from "vitest";
import {
  dedupeGoalIds,
  GATE_LOOKING_CHIP_ID,
  gateGoalChipsToGoalIds,
  gateGoalSelectionIsComplete,
  goalIdsToGateChipIds,
  MAX_GATE_GOAL_CHIPS,
  resolveGatePrepareGoals,
  toggleGateGoalChip,
  unmatchedGoalIds,
} from "../gate-goal-groups";
import { MAX_ENGINE_GOALS, selectedProjectGoals } from "../report-wizard-config";

// ─── Gate goal grouping — pure-function tests (gate review round 1) ─────
// The reviewer's falsification pass proved the ORIGINAL suite blind to
// exclusivity and the 2-chip cap (findings 4 and 9): injecting
// `[...selected, GATE_LOOKING_CHIP_ID]` in place of `[GATE_LOOKING_CHIP_ID]`,
// and `if (false)` for the MAX_GATE_GOAL_CHIPS guard, both passed 16/16.
// These tests exercise `toggleGateGoalChip` directly — no component, no
// render — so both mutants fail here.

describe("toggleGateGoalChip", () => {
  it("selects up to MAX_GATE_GOAL_CHIPS substantive chips", () => {
    let selected: string[] = [];
    selected = toggleGateGoalChip(selected, "renovate");
    expect(selected).toEqual(["renovate"]);
    selected = toggleGateGoalChip(selected, "hire-train");
    expect(selected).toEqual(["renovate", "hire-train"]);
  });

  it("ignores a 3rd substantive chip once the cap is reached (kills the `if (false)` cap-guard mutant)", () => {
    let selected = ["renovate", "hire-train"];
    expect(selected.length).toBe(MAX_GATE_GOAL_CHIPS);
    selected = toggleGateGoalChip(selected, "energy");
    expect(selected).toEqual(["renovate", "hire-train"]);
  });

  it("deselecting one of two chips makes room for a new one", () => {
    let selected = ["renovate", "hire-train"];
    selected = toggleGateGoalChip(selected, "renovate");
    expect(selected).toEqual(["hire-train"]);
    selected = toggleGateGoalChip(selected, "energy");
    expect(selected).toEqual(["hire-train", "energy"]);
  });

  it("'Just looking around' REPLACES any substantive selection, not adds to it (kills the spread-mutant)", () => {
    const selected = ["renovate", "hire-train"];
    const next = toggleGateGoalChip(selected, GATE_LOOKING_CHIP_ID);
    expect(next).toEqual([GATE_LOOKING_CHIP_ID]);
    expect(next).not.toContain("renovate");
    expect(next).not.toContain("hire-train");
    expect(next.length).toBe(1);
  });

  it("selecting a substantive chip while 'Just looking around' is active clears looking first", () => {
    const selected = [GATE_LOOKING_CHIP_ID];
    const next = toggleGateGoalChip(selected, "energy");
    expect(next).toEqual(["energy"]);
  });

  it("clicking 'Just looking around' again toggles it off", () => {
    const next = toggleGateGoalChip([GATE_LOOKING_CHIP_ID], GATE_LOOKING_CHIP_ID);
    expect(next).toEqual([]);
  });

  it("unknown chip ids are a no-op", () => {
    const selected = ["renovate"];
    expect(toggleGateGoalChip(selected, "not-a-real-chip")).toEqual(["renovate"]);
  });

  describe("explicit cap parameter (gate review round 2, NEW-2 — recoverable seeded state)", () => {
    it("a 3-chip seed lets the visitor deselect and re-select ANY of the 3 freely, with cap=3", () => {
      let selected = ["renovate", "hire-train", "energy"];
      // Reviewer's exact reproduction: deselect "Energy & building
      // upgrades" then re-click it — must NOT be stranded.
      selected = toggleGateGoalChip(selected, "energy", 3);
      expect(selected).toEqual(["renovate", "hire-train"]);
      selected = toggleGateGoalChip(selected, "energy", 3);
      expect(selected).toEqual(["renovate", "hire-train", "energy"]);
    });

    it("a fresh visitor (no seed) still gets the default 2-chip cap even when a cap of 2 is passed explicitly", () => {
      let selected = toggleGateGoalChip([], "renovate", 2);
      selected = toggleGateGoalChip(selected, "hire-train", 2);
      selected = toggleGateGoalChip(selected, "energy", 2);
      expect(selected).toEqual(["renovate", "hire-train"]);
    });

    it("omitting cap defaults to MAX_GATE_GOAL_CHIPS (unchanged behavior for every existing caller)", () => {
      let selected = ["renovate", "hire-train"];
      selected = toggleGateGoalChip(selected, "energy");
      expect(selected).toEqual(["renovate", "hire-train"]);
    });
  });
});

describe("gateGoalChipsToGoalIds", () => {
  it("flattens a single-id chip", () => {
    expect(gateGoalChipsToGoalIds(["renovate"])).toEqual(["rehab"]);
  });

  it("flattens a two-id grouped chip", () => {
    expect(gateGoalChipsToGoalIds(["expand-equip"]).sort()).toEqual(
      ["equipment", "expansion"].sort(),
    );
  });

  it("BLOCKER 1 (gate review round 1): two 2-id chips together carry ALL 4 ids — none dropped", () => {
    // The reviewer's exact reproduction: "Develop housing or mixed-use" +
    // "Expand or buy equipment".
    const ids = gateGoalChipsToGoalIds(["expand-equip", "housing-mixed-use"]);
    expect(new Set(ids)).toEqual(
      new Set(["expansion", "equipment", "mixed-use", "affordable-housing"]),
    );
    expect(ids.length).toBe(4);
  });

  it("'Just looking around' carries zero goal ids", () => {
    expect(gateGoalChipsToGoalIds([GATE_LOOKING_CHIP_ID])).toEqual([]);
  });
});

describe("dedupeGoalIds", () => {
  it("does not cap at 3 (BLOCKER 1) — a 4-id set survives whole", () => {
    const ids = dedupeGoalIds(["expansion", "equipment", "mixed-use", "affordable-housing"]);
    expect(ids.length).toBe(4);
  });

  it("does not cap at 4 either — a genuinely larger set (chip picks + a passthrough id) survives whole", () => {
    const ids = dedupeGoalIds([
      "expansion",
      "equipment",
      "mixed-use",
      "affordable-housing",
      "vacant-acquisition",
    ]);
    expect(ids.length).toBe(5);
  });

  it("dedupes repeats", () => {
    expect(dedupeGoalIds(["rehab", "rehab", "energy"])).toEqual(["rehab", "energy"]);
  });

  it("filters falsy entries (gate review round 2, NEW-6 — the filter selectedProjectGoals() has always had)", () => {
    expect(dedupeGoalIds(["rehab", "", "energy"])).toEqual(["rehab", "energy"]);
  });
});

describe("gateGoalSelectionIsComplete", () => {
  it("false for an empty selection", () => {
    expect(gateGoalSelectionIsComplete([])).toBe(false);
  });

  it("true once any chip — including 'Just looking around' — is selected", () => {
    expect(gateGoalSelectionIsComplete([GATE_LOOKING_CHIP_ID])).toBe(true);
    expect(gateGoalSelectionIsComplete(["renovate"])).toBe(true);
  });
});

describe("goalIdsToGateChipIds (BLOCKER 2 — seeding the gate from existing goals)", () => {
  it("seeds the matching chip for a single existing goal id", () => {
    expect(goalIdsToGateChipIds(["hiring"])).toEqual(["hire-train"]);
  });

  it("seeds a grouped chip when only ONE of its two ids is present", () => {
    expect(goalIdsToGateChipIds(["expansion"])).toEqual(["expand-equip"]);
  });

  it("seeds multiple chips for multiple existing goals", () => {
    expect(goalIdsToGateChipIds(["hiring", "energy"]).sort()).toEqual(
      ["hire-train", "energy"].sort(),
    );
  });

  it("ids with no chip representation seed nothing", () => {
    expect(goalIdsToGateChipIds(["vacant-acquisition", "other"])).toEqual([]);
  });
});

describe("unmatchedGoalIds (BLOCKER 2 — never lose typed context)", () => {
  it("returns ids with no chip representation untouched", () => {
    expect(unmatchedGoalIds(["vacant-acquisition"])).toEqual(["vacant-acquisition"]);
    expect(unmatchedGoalIds(["other"])).toEqual(["other"]);
  });

  it("returns empty when every id maps onto a chip", () => {
    expect(unmatchedGoalIds(["hiring", "rehab"])).toEqual([]);
  });

  it("preserves an unmatched id alongside matched ones", () => {
    expect(unmatchedGoalIds(["hiring", "vacant-acquisition"])).toEqual(["vacant-acquisition"]);
  });
});

describe("resolveGatePrepareGoals — the R1-BLOCKER-1 pin (gate review round 2, ruling #6)", () => {
  // Round 1 fixed the truncation but never executed the real handler path
  // — `onPrepareReport` is a `vi.fn()` in every ReportEmailGate test, so
  // `app/report/page.tsx`'s `handlePrepareGatedReport` (now a thin wrapper
  // around this exact function) never actually ran. These tests call the
  // REAL function `handlePrepareGatedReport` calls.

  it("the reviewer's exact 4-id reproduction: no existing goals, 2 fresh chips worth of ids, all 4 survive", () => {
    const { isNoop, normalizedGoals } = resolveGatePrepareGoals({
      incomingGoalIds: ["expansion", "equipment", "mixed-use", "affordable-housing"],
      incomingCustomGoal: "",
      existingProjectGoals: [],
      existingCustomGoal: "",
    });
    expect(isNoop).toBe(false);
    expect(new Set(normalizedGoals)).toEqual(
      new Set(["expansion", "equipment", "mixed-use", "affordable-housing"]),
    );
    expect(normalizedGoals.length).toBe(4);
  });

  it("a 5-id set (an existing pass-through goal plus a fresh 2-chip pick) survives whole — MAX_ENGINE_GOALS would truncate this to 4", () => {
    // Sanity: confirm this scenario genuinely exceeds MAX_ENGINE_GOALS —
    // if the engine's own cap ever changes, this test should fail loudly
    // rather than silently stop proving anything.
    expect(MAX_ENGINE_GOALS).toBeLessThan(5);

    const incomingGoalIds = [
      "expansion",
      "equipment",
      "mixed-use",
      "affordable-housing",
      "vacant-acquisition",
    ];
    const { normalizedGoals } = resolveGatePrepareGoals({
      incomingGoalIds,
      incomingCustomGoal: "",
      existingProjectGoals: ["vacant-acquisition"],
      existingCustomGoal: "",
    });
    expect(normalizedGoals.length).toBe(5);
    expect(new Set(normalizedGoals)).toEqual(new Set(incomingGoalIds));

    // Proves this is a REAL divergence, not a coincidence of this
    // particular input: the wizard's own capped reader truncates it.
    expect(selectedProjectGoals({ projectGoals: incomingGoalIds }).length).toBe(
      MAX_ENGINE_GOALS,
    );
  });

  it("an untouched report (same goals, same order, same customGoal) is a no-op — no regeneration", () => {
    const { isNoop } = resolveGatePrepareGoals({
      incomingGoalIds: ["hiring", "rehab"],
      incomingCustomGoal: "",
      existingProjectGoals: ["hiring", "rehab"],
      existingCustomGoal: "",
    });
    expect(isNoop).toBe(true);
  });

  it("customGoal text is part of the no-op comparison", () => {
    const { isNoop } = resolveGatePrepareGoals({
      incomingGoalIds: ["other"],
      incomingCustomGoal: "a different plan",
      existingProjectGoals: ["other"],
      existingCustomGoal: "the original plan",
    });
    expect(isNoop).toBe(false);
  });
});
