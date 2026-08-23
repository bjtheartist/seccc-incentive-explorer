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
 * Toggling rules (spec §A): up to `cap` substantive chips may be selected
 * together (defaults to `MAX_GATE_GOAL_CHIPS`, the board's own "pick up to
 * 2"); "Just looking around" is exclusive of the other 7 — selecting it
 * clears any substantive picks, and selecting a substantive chip while
 * "looking" is active clears "looking" first.
 *
 * Gate review round 2, NEW-2/ruling #3: `cap` is an explicit parameter,
 * not always the hardcoded constant, so a component seeded with MORE than
 * 2 pre-pressed chips (a legacy 3-goal wizard run) can pass its own seeded
 * count as the cap for this session — letting the visitor freely
 * deselect/reselect any of those chips without a re-add getting silently
 * and permanently blocked. A fresh visitor (no seed) still gets the
 * default 2. This never lets an entirely NEW, never-seeded chip exceed
 * the seeded count either, since the caller passes the SAME cap for every
 * call in a given render.
 */
export function toggleGateGoalChip(
  selected: readonly string[],
  chipId: string,
  cap: number = MAX_GATE_GOAL_CHIPS,
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
  if (withoutLooking.length >= cap) {
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

/**
 * Deduplicates a list of goal ids WITHOUT capping it (gate review round 1,
 * BLOCKER 1). `lib/report-wizard-config.ts`'s `selectedProjectGoals()`
 * slices to `MAX_PROJECT_GOALS = 3` — a real constraint for the OLD
 * 11-option, "pick up to 3" wizard selector, but wrong for the gate: 2
 * grouped chips ("Expand or buy equipment" + "Develop housing or
 * mixed-use") can carry 4 real goal ids, and `projectGoalsFit`/GOAL_RULES
 * have no inherent 3-goal limit — the cap was a UI-selection artifact of
 * a component the gate no longer uses. This is the gate's own combiner:
 * every id reachable from the visitor's actual selections must survive.
 */
export function dedupeGoalIds(ids: readonly string[]): string[] {
  // Gate review round 2, MINOR NEW-6/ruling #5: `selectedProjectGoals()`
  // (lib/report-wizard-config.ts) has always filtered falsy entries before
  // deduping; this combiner dropped that filter, letting an empty-string
  // goal id reach the engine unfiltered. Restored.
  return Array.from(new Set(ids.filter(Boolean)));
}

/**
 * Reverse mapping for PRE-PRESSING the gate's chips for DISPLAY when a
 * report already has project goals (a completed wizard run, a refined
 * report, a shared link) — spec guardrail: "keep goal ids stable
 * everywhere else... anything else that renders goal labels must keep
 * working" plus gate review round 1, BLOCKER 2 ("never lose typed
 * context").
 *
 * Gate review round 2, NEW-1/ruling #2 — display only, never emission:
 * this function is coarser than the raw goal ids (one chip can represent
 * two ids), so using its OUTPUT to compute what gets sent to the engine
 * silently ADDS an id the visitor never chose (`["expansion"]` seeds the
 * `expand-equip` chip, whose `goalIds` is `["expansion","equipment"]` —
 * `equipment` was never real). The fix: `ReportEmailGate.tsx` uses this
 * function ONLY to decide which chips render pressed; it keeps the
 * ORIGINAL goal-id array as separate state and emits that array VERBATIM
 * (order included — no dedup, no re-derivation) to `onPrepareReport`
 * until the visitor makes a real chip toggle. Only after a toggle does
 * emission switch to the chip-derived mapping (`gateGoalChipsToGoalIds`).
 */
export function goalIdsToGateChipIds(existingGoalIds: readonly string[]): string[] {
  const existing = new Set(existingGoalIds);
  const chipIds: string[] = [];
  for (const chip of GATE_SUBSTANTIVE_CHIPS) {
    if (chip.goalIds.some((id) => existing.has(id))) chipIds.push(chip.id);
  }
  return chipIds;
}

/** The existing goal ids that no gate chip represents — must be carried
 *  through untouched (see `goalIdsToGateChipIds` doc above). */
export function unmatchedGoalIds(existingGoalIds: readonly string[]): string[] {
  const allChipGoalIds = new Set(GATE_GOAL_CHIPS.flatMap((chip) => chip.goalIds));
  return existingGoalIds.filter((id) => !allChipGoalIds.has(id));
}

export interface GatePrepareGoalsInput {
  /** The ids `ReportEmailGate.tsx` is asking to prepare with — its own
   *  `projectGoalIds()` output (verbatim original pre-toggle, or
   *  chip-derived + passthrough post-toggle). */
  incomingGoalIds: readonly string[];
  incomingCustomGoal: string;
  /** The report's raw existing goal ids (already resolved from
   *  `metadata.projectGoals`, falling back to `[metadata.projectType]`,
   *  by the caller — this function only dedupes/compares). */
  existingProjectGoals: readonly string[];
  existingCustomGoal: string;
}

export interface GatePrepareGoalsResult {
  /** True when nothing actually changed relative to the existing report —
   *  the caller should return the existing report as-is, no regeneration. */
  isNoop: boolean;
  /** The full, uncapped, deduped goal-id set to write into
   *  `WizardState.projectGoals` / send to the report engine. */
  normalizedGoals: string[];
}

/**
 * `app/report/page.tsx`'s `handlePrepareGatedReport` calls this directly —
 * extracted (gate review round 2, R1-BLOCKER-1 carryover/ruling #6) so the
 * exact goal-truncation decision that function makes is unit-testable
 * without mounting the whole report page. Deliberately uses `dedupeGoalIds`
 * (truly uncapped), NOT `selectedProjectGoals()` (capped at
 * `MAX_ENGINE_GOALS = 4` in lib/report-wizard-config.ts): the gate's own
 * emission can exceed 4 when pass-through ids (goals with no chip
 * representation) ride alongside a fresh 2-chip pick — e.g. an existing
 * `vacant-acquisition` goal plus two freshly toggled chips is 5 real ids.
 * `lib/__tests__/gate-goal-groups.test.ts` pins this with a 5-id probe
 * that a reversion to the capped wizard function would fail.
 */
export function resolveGatePrepareGoals(
  input: GatePrepareGoalsInput,
): GatePrepareGoalsResult {
  const normalizedGoals = dedupeGoalIds(input.incomingGoalIds);
  const reportGoals = dedupeGoalIds(input.existingProjectGoals);
  const isNoop =
    JSON.stringify(reportGoals) === JSON.stringify(normalizedGoals) &&
    (input.existingCustomGoal || "") === input.incomingCustomGoal.trim();
  return { isNoop, normalizedGoals };
}
