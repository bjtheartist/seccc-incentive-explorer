// ─── Persona intake inference (owner ruling A1 + adversarial review #6) ──
// A1: intake is an inferred chip row inside ReportEmailGate, never a
// blocking screen. This module is the pure "infer-or-ask" mapping the
// review specified — the chip row shows a PRE-SELECTED chip the visitor can
// confirm or correct with one tap; it is always optional and never blocks
// submit or "Continue Without Email".

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
 *   otherwise → growing
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
  return "growing";
}
