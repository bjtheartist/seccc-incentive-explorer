import { describe, expect, it } from "vitest";
import {
  dedupeGoalIds,
  GATE_GOAL_CHIPS,
  GATE_LOOKING_CHIP_ID,
  GATE_SUBSTANTIVE_CHIPS,
  gateGoalChipsToGoalIds,
  gateGoalSelectionIsComplete,
  goalIdsToGateChipIds,
  MAX_GATE_GOAL_CHIPS,
  resolveGatePrepareGoals,
  toggleGateGoalChip,
  unmatchedGoalIds,
} from "../gate-goal-groups";
import {
  MAX_ENGINE_GOALS,
  MAX_PROJECT_GOALS,
  selectedProjectGoals,
  SITE_PROJECT_TYPE_OPTIONS,
} from "../report-wizard-config";

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

  it("has NO cap at all, even beyond the gate's own provable ceiling (gate review round 3, R3-1) — a synthetic 6-id set survives whole", () => {
    // Not necessarily reachable through today's 8 chips (the provable
    // ceiling test below pins that reachable number separately) — this
    // proves dedupeGoalIds itself is genuinely uncapped, so it never
    // becomes the truncation point again even if the chip system grows.
    const ids = dedupeGoalIds(["a", "b", "c", "d", "e", "f"]);
    expect(ids.length).toBe(6);
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

  it("a 5-id set (an existing pass-through goal plus a fresh 2-chip pick) survives whole ALL THE WAY TO THE ENGINE (gate review round 3, R3-1)", () => {
    // Sanity: this scenario is one below the gate's TRUE provable
    // ceiling (6, corrected in gate review round 4 — see the "provable
    // ceiling" describe block below); kept as a simpler, single-chip
    // probe alongside the full worst-case witness test there.
    expect(MAX_ENGINE_GOALS).toBeGreaterThanOrEqual(5);

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

    // R3-1's actual complaint: round 2 only proved the GATE's own combiner
    // kept all 5 — `lib/report-engine.ts`'s two call sites read through
    // `selectedProjectGoals()` instead, which silently dropped the 5th
    // back when MAX_ENGINE_GOALS was 4. Pin survival at THAT boundary,
    // not just the gate's internal one.
    expect(selectedProjectGoals({ projectGoals: normalizedGoals }).length).toBe(5);
    expect(new Set(selectedProjectGoals({ projectGoals: normalizedGoals }))).toEqual(
      new Set(incomingGoalIds),
    );
  });

  it("the reviewer's most-reachable R3-1 scenario: an ordinary 3-goal wizard run, one further chip tap, all 5 reach the engine", () => {
    // ["expansion","mixed-use","rehab"] seeds 3 DISTINCT chips
    // (expand-equip, housing-mixed-use, renovate). Tapping ANY chip
    // switches emission to the chip-derived mapping for ALL selected
    // chips (round 2 ruling #2) — 2 + 2 + 1 = 5 ids, dropping
    // "affordable-housing" (and with it qct/ahsap/nmtcEligible/landBank/
    // hudSection108) was the reviewer's exact reproduction.
    const seededGoals = ["expansion", "mixed-use", "rehab"];
    const seededChips = goalIdsToGateChipIds(seededGoals);
    expect(new Set(seededChips)).toEqual(
      new Set(["expand-equip", "housing-mixed-use", "renovate"]),
    );

    const postToggleEmission = gateGoalChipsToGoalIds(seededChips);
    expect(new Set(postToggleEmission)).toEqual(
      new Set(["expansion", "equipment", "mixed-use", "affordable-housing", "rehab"]),
    );

    const { normalizedGoals } = resolveGatePrepareGoals({
      incomingGoalIds: postToggleEmission,
      incomingCustomGoal: "",
      existingProjectGoals: seededGoals,
      existingCustomGoal: "",
    });
    expect(normalizedGoals.length).toBe(5);

    const engineGoals = selectedProjectGoals({ projectGoals: normalizedGoals });
    expect(engineGoals).toContain("affordable-housing");
    expect(engineGoals.length).toBe(5);
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

describe("MAX_ENGINE_GOALS — the provable ceiling, derived from GATE_GOAL_CHIPS (gate review round 3, R3-1; corrected in round 4, THE BLOCKER)", () => {
  /**
   * Round 3's version of this function treated a pass-through id (a raw
   * seed goal with no chip at all — only `vacant-acquisition` and `other`
   * qualify) as if it consumed one of the gate's chip "slots." It
   * doesn't: `ReportEmailGate.tsx` tracks the CHIP budget
   * (`goalChipCap` chips, freely chosen once any toggle happens — never
   * restricted to whichever chips the original seed happened to touch)
   * and the PASS-THROUGH budget (`unmatchedGoalIds`, uncapped by the
   * chip budget) as two INDEPENDENT numbers that both ride together in
   * `projectGoalIds()`. This version models both separately and
   * brute-forces every possible raw seed up to `MAX_PROJECT_GOALS` in
   * size, drawn from the real wizard option universe
   * (`SITE_PROJECT_TYPE_OPTIONS`) — not a hand-derived closed form — the
   * same verification technique the reviewer used to find round 3's
   * undercount.
   */
  const ALL_GOAL_IDS = SITE_PROJECT_TYPE_OPTIONS.map((option) => option.id);

  function* seedsUpToSize(ids: readonly string[], maxSize: number): Generator<string[]> {
    function* combinations(start: number, chosen: string[]): Generator<string[]> {
      yield chosen;
      for (let i = start; i < ids.length; i++) {
        if (chosen.length >= maxSize) return;
        yield* combinations(i + 1, [...chosen, ids[i]]);
      }
    }
    yield* combinations(0, []);
  }

  function reachableGoalCountForSeed(seed: readonly string[]): number {
    const passthroughCount = unmatchedGoalIds(seed).length;
    const seededChipCount = goalIdsToGateChipIds(seed).length;
    const goalChipCap = Math.max(MAX_GATE_GOAL_CHIPS, seededChipCount);

    // The chip budget is freely fillable, not restricted to the chips the
    // seed happened to touch — the worst case picks the highest-yield
    // chips available, up to the cap, from ALL substantive chips.
    const idCountsDesc = [...GATE_SUBSTANTIVE_CHIPS]
      .map((chip) => chip.goalIds.length)
      .sort((a, b) => b - a);
    const chipSum = idCountsDesc.slice(0, goalChipCap).reduce((sum, n) => sum + n, 0);

    return passthroughCount + chipSum;
  }

  function worstCaseReachableEngineGoalCount(): { max: number; witness: string[] } {
    let max = 0;
    let witness: string[] = [];
    for (const seed of seedsUpToSize(ALL_GOAL_IDS, MAX_PROJECT_GOALS)) {
      const total = reachableGoalCountForSeed(seed);
      if (total > max) {
        max = total;
        witness = seed;
      }
    }
    return { max, witness };
  }

  it("MAX_ENGINE_GOALS is at least the worst case computed from the CURRENT chip definitions, brute-forced over every possible seed", () => {
    const { max } = worstCaseReachableEngineGoalCount();
    expect(MAX_ENGINE_GOALS).toBeGreaterThanOrEqual(max);
  });

  it("today's worst case is exactly 6 (2 pass-through ids + both 2-id chips, from a 3-raw-id seed) — documents WHY MAX_ENGINE_GOALS is 6, not a magic number", () => {
    const { max, witness } = worstCaseReachableEngineGoalCount();
    expect(max).toBe(6);
    // The witness seed must carry BOTH pass-through ids — that's the
    // mechanism round 3 missed (a 3rd chip-matching id never lowers the
    // total below 6, since a single seeded chip still floors the cap at
    // MAX_GATE_GOAL_CHIPS).
    expect(witness).toEqual(expect.arrayContaining(["vacant-acquisition", "other"]));

    // Sanity on the inputs the formula depends on, so a chip-definition
    // or wizard-option change is caught here first, with an explicit
    // reason, rather than as an unexplained MAX_ENGINE_GOALS mismatch.
    const twoIdChipCount = GATE_SUBSTANTIVE_CHIPS.filter((chip) => chip.goalIds.length === 2).length;
    expect(twoIdChipCount).toBe(2);
    expect(GATE_GOAL_CHIPS.length).toBe(8); // 7 substantive + "Just looking around"
    const passthroughEligibleIds = ALL_GOAL_IDS.filter(
      (id) => unmatchedGoalIds([id]).length === 1,
    );
    expect(passthroughEligibleIds.sort()).toEqual(["other", "vacant-acquisition"]);
  });

  it("the reviewer's exact witness seed reproduces 6 directly", () => {
    expect(reachableGoalCountForSeed(["vacant-acquisition", "other", "expansion"])).toBe(6);
    expect(reachableGoalCountForSeed(["rehab", "vacant-acquisition", "other"])).toBe(6);
  });
});
