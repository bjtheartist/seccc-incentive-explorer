// ─── Persona intake inference (owner ruling A1 + adversarial review #6) ──
// A1: intake is an inferred chip row inside ReportEmailGate, never a
// blocking screen. This module is the pure "infer-or-ask" mapping the
// review specified — the chip row shows a PRE-SELECTED chip the visitor can
// confirm or correct with one tap; it is always optional and never blocks
// submit or "Continue Without Email".
//
// Gate round 2, MAJOR 25 + RULING: this module's ONLY inference input in
// production always carries a real reportType (see the function doc below
// for why the "looking" branch is therefore unreachable there). The real,
// reachable path to the "looking" persona for an actual visitor is the
// explicit "Just looking" chip in PERSONA_CHIPS' visible row — a genuine
// user action, not something this inference produces.

import type { PersonaId } from "@/lib/personas";

const DEVELOPMENT_GOALS = new Set([
  "new-construction",
  "mixed-use",
  "affordable-housing",
  "vacant-acquisition",
]);

const SUPPORTER_REPORT_TYPES = new Set(["dev-feasibility", "corridor-intelligence"]);

export interface PersonaInferenceInput {
  industry?: string | null;
  projectGoals?: readonly string[] | null;
  projectType?: string | null;
  reportType?: string | null;
}

/**
 * Infer the pre-selected persona chip from what the visitor has already
 * told the report — never a new question, never a blocking gate.
 *
 *   industry ∈ {realEstate} OR goal ∈ development goals → developer
 *   reportType ∈ {dev-feasibility, corridor-intelligence} → supporter
 *     (these report types are typically run by an intermediary — a lender,
 *     chamber staffer, or corridor stakeholder — evaluating on someone
 *     else's behalf, not a business owner acting for themselves)
 *   goal = relocation → starting
 *   no industry, no goal, no reportType at all → looking
 *   any real goal answered, even one not otherwise matched above → growing
 *
 * Gate round 2, MAJOR 25 + RULING (corrects gate finding 9/10's framing,
 * which read as though this branch were a real reachable UX path — it
 * isn't): the `looking` branch above is exercised as a pure-function unit
 * case in lib/__tests__/persona-inference.test.ts, but is DEAD in
 * production. Its only real caller, components/report/ReportEmailGate.tsx,
 * always passes `reportType: report.reportType`, and
 * `GeneratedReport.reportType` (lib/report-engine.ts) is a required,
 * non-optional field — so `!input.reportType` can never be true at the
 * real call site, and this branch can never actually fire against a real
 * visitor. `looking` is a genuine, additive PersonaId (lib/personas.ts)
 * and "Just looking" IS a live, reachable option — but the real path to
 * it is the explicit chip tap in PERSONA_CHIPS' visible row (both the
 * ReportEmailGate intake row and the on-report PersonaChips switcher),
 * never this inference. This branch is kept only as conservative,
 * defensive fallback logic — never claim `growing` with zero signal
 * behind it — not as a claim that inference itself ever reaches a
 * visitor this way.
 */
export function inferPersonaFromIntake(input: PersonaInferenceInput): PersonaId {
  const goals = new Set([...(input.projectGoals ?? []), input.projectType ?? ""].filter(Boolean));

  if (input.industry === "realEstate" || [...goals].some((goal) => DEVELOPMENT_GOALS.has(goal))) {
    return "developer";
  }
  if (input.reportType && SUPPORTER_REPORT_TYPES.has(input.reportType)) {
    return "supporter";
  }
  if (goals.has("relocation")) {
    return "starting";
  }
  if (goals.size === 0 && !input.industry && !input.reportType) {
    return "looking";
  }
  return "growing";
}
