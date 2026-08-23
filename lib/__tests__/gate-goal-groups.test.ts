import { describe, expect, it } from "vitest";
import {
  dedupeGoalIds,
  GATE_LOOKING_CHIP_ID,
  gateGoalChipsToGoalIds,
  gateGoalSelectionIsComplete,
  goalIdsToGateChipIds,
  MAX_GATE_GOAL_CHIPS,
  toggleGateGoalChip,
  unmatchedGoalIds,
} from "../gate-goal-groups";

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

  it("dedupes repeats", () => {
    expect(dedupeGoalIds(["rehab", "rehab", "energy"])).toEqual(["rehab", "energy"]);
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
