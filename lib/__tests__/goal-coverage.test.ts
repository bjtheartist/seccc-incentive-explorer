import { describe, expect, it } from "vitest";
import {
  GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS,
  GOAL_RULES,
  PLACE_BASED_EXEMPT_PROGRAM_IDS,
  SPECIALIZED_INDUSTRY_PROGRAM_IDS,
} from "../project-fit";
import { GATE_GOAL_CHIPS } from "../gate-goal-groups";
import { getAllPrograms } from "../programs-data";

// ─── Goal coverage (email-gate redesign, spec §B) ───────────────────────
// "No dead chips, ever." Three falsifiable assertions:
//   (a) every gate chip's underlying goal id(s) resolve to a GOAL_RULES
//       entry with a non-empty strongProgramIds set — a chip that maps to
//       nothing real is a dead chip.
//   (b) every program id in the live registry is either goal-reachable
//       (explicit strong/relatedProgramIds membership somewhere in
//       GOAL_RULES) or lives in one of the three documented,
//       goal-independent exemption sets — no third, silent option.
//   (c) every id referenced INSIDE GOAL_RULES actually exists in the
//       registry — no invented ids.
// This test fails on any future drift in either direction: a new program
// added to the catalog with no goal mapping and no exemption entry, or a
// GOAL_RULES id that stops existing in the catalog.

describe("goal coverage (email-gate redesign)", () => {
  const allProgramIds = getAllPrograms().map((program) => program.id);
  const allProgramIdSet = new Set(allProgramIds);

  it("(a) every gate chip's goal id(s) have a GOAL_RULES entry with a non-empty strongProgramIds set", () => {
    const dead: string[] = [];
    for (const chip of GATE_GOAL_CHIPS) {
      for (const goalId of chip.goalIds) {
        const rule = GOAL_RULES[goalId];
        if (!rule || rule.strongProgramIds.size === 0) {
          dead.push(`${chip.label} → ${goalId}`);
        }
      }
    }
    expect(dead, `dead gate chip goal mapping(s): ${dead.join(", ")}`).toEqual([]);
  });

  it("(b) every program id in the registry is goal-reachable or in a documented exemption set", () => {
    const reachable = new Set<string>();
    for (const rule of Object.values(GOAL_RULES)) {
      for (const id of rule.strongProgramIds) reachable.add(id);
      for (const id of rule.relatedProgramIds) reachable.add(id);
    }
    for (const id of SPECIALIZED_INDUSTRY_PROGRAM_IDS) reachable.add(id);
    for (const id of PLACE_BASED_EXEMPT_PROGRAM_IDS) reachable.add(id);
    for (const id of GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS) reachable.add(id);

    const orphans = allProgramIds.filter((id) => !reachable.has(id));
    expect(
      orphans,
      `orphaned program id(s) — neither goal-reachable nor exempt: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("(c) every id referenced inside GOAL_RULES exists in the program registry", () => {
    const invented: string[] = [];
    for (const [goalId, rule] of Object.entries(GOAL_RULES)) {
      for (const id of [...rule.strongProgramIds, ...rule.relatedProgramIds]) {
        if (!allProgramIdSet.has(id)) invented.push(`${goalId}: ${id}`);
      }
    }
    expect(invented, `GOAL_RULES id(s) not in the registry: ${invented.join(", ")}`).toEqual([]);
  });

  it("the three exemption sets never overlap each other (each exempt program has exactly one documented reason)", () => {
    const sets: Record<string, ReadonlySet<string>> = {
      specializedIndustry: SPECIALIZED_INDUSTRY_PROGRAM_IDS,
      placeBasedExempt: PLACE_BASED_EXEMPT_PROGRAM_IDS,
      goalIndependentExempt: GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS,
    };
    const overlaps: string[] = [];
    const names = Object.keys(sets);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        for (const id of sets[names[i]]) {
          if (sets[names[j]].has(id)) overlaps.push(`${id}: ${names[i]} ∩ ${names[j]}`);
        }
      }
    }
    expect(overlaps, `exemption sets overlap: ${overlaps.join(", ")}`).toEqual([]);
  });
});
