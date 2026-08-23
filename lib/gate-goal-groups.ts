// ─── Email-gate goal grouping (email-gate redesign, spec §A) ───────────
// The gate's "What brings you here?" row shows 8 UI chips — fewer, plainer
// buckets than the 10-goal wizard list (lib/report-wizard-config.ts's
// SITE_PROJECT_TYPE_OPTIONS) a first-time visitor has never seen before.
// Grouping is presentation-only: every underlying goal id stays exactly
// what it already is everywhere else in the app (GOAL_RULES, the wizard,
// saved-report goal labels) — a grouped chip just feeds 1-2 of those ids
// into the same `projectGoals` array the rest of the app already reads.
//
// "Just looking around" is the one exception: it carries zero goal ids on
// purpose (spec §A: "none — no goal filter; pairs with looking persona
// behavior"), matching the existing "looking" persona lens, which shows a
// screening overview rather than a goal-filtered slice.

export interface GateGoalChip {
  /** Stable id for THIS chip (gate-local — not a goal id). */
  id: string;
  /** Exact board copy. */
  label: string;
  /** Underlying report-wizard goal id(s) this chip feeds into. Empty for "just looking". */
  goalIds: readonly string[];
}

export const GATE_LOOKING_CHIP_ID = "looking-around";

/** Exact order + copy from the blessed board (R6GateBlessed.dc.html). */
export const GATE_GOAL_CHIPS: readonly GateGoalChip[] = [
  { id: "renovate", label: "Renovate or build out", goalIds: ["rehab"] },
  { id: "expand-equip", label: "Expand or buy equipment", goalIds: ["expansion", "equipment"] },
  { id: "open-relocate", label: "Open or relocate", goalIds: ["relocation"] },
  { id: "hire-train", label: "Hire or train staff", goalIds: ["hiring"] },
  { id: "energy", label: "Energy & building upgrades", goalIds: ["energy"] },
  { id: "build-new", label: "Build new", goalIds: ["new-construction"] },
  {
    id: "housing-mixed-use",
    label: "Develop housing or mixed-use",
    goalIds: ["mixed-use", "affordable-housing"],
  },
  { id: GATE_LOOKING_CHIP_ID, label: "Just looking around", goalIds: [] },
] as const;

export const GATE_SUBSTANTIVE_CHIPS: readonly GateGoalChip[] = GATE_GOAL_CHIPS.filter(
  (chip) => chip.id !== GATE_LOOKING_CHIP_ID,
);

/** "Pick up to 2" substantive chips, per the board's own helper copy. */
export const MAX_GATE_GOAL_CHIPS = 2;

function chipById(id: string): GateGoalChip | undefined {
  return GATE_GOAL_CHIPS.find((chip) => chip.id === id);
}

/**
 * Toggling rules (spec §A): up to 2 substantive chips may be selected
 * together; "Just looking around" is exclusive of the other 7 — selecting
 * it clears any substantive picks, and selecting a substantive chip while
 * "looking" is active clears "looking" first.
 */
export function toggleGateGoalChip(
  selected: readonly string[],
  chipId: string,
): string[] {
  const chip = chipById(chipId);
  if (!chip) return [...selected];

  if (chip.id === GATE_LOOKING_CHIP_ID) {
    return selected.includes(GATE_LOOKING_CHIP_ID) ? [] : [GATE_LOOKING_CHIP_ID];
  }

  const withoutLooking = selected.filter((id) => id !== GATE_LOOKING_CHIP_ID);
  if (withoutLooking.includes(chipId)) {
    return withoutLooking.filter((id) => id !== chipId);
  }
  if (withoutLooking.length >= MAX_GATE_GOAL_CHIPS) {
    return withoutLooking;
  }
  return [...withoutLooking, chipId];
}

/** Flattens the selected gate chips into the real, deduplicated goal ids. */
export function gateGoalChipsToGoalIds(selected: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const chipId of selected) {
    const chip = chipById(chipId);
    if (!chip) continue;
    for (const goalId of chip.goalIds) ids.add(goalId);
  }
  return Array.from(ids);
}

/** Mandatory rule (spec anatomy item 3): at least one chip picked — the
 *  looking chip alone counts, since it is itself a real, honest answer. */
export function gateGoalSelectionIsComplete(selected: readonly string[]): boolean {
  return selected.length > 0;
}
