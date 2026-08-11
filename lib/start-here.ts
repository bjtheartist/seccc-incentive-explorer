/**
 * Canonical "start here" action model.
 *
 * Historically the report engine computed three action structures independently:
 *   1. `executiveSummary.topActions` — built by `computeTopActions` in
 *      confidence-engine.ts.
 *   2. `actionRoadmap` — built inline inside each report-type generator in
 *      report-engine.ts (call scripts, tiers, documents, preparation cost).
 *   3. `recommendedActions` — also built inline inside each generator
 *      (label/description/priority).
 *
 * Each one re-derived "what is the top program / top action" from the same
 * underlying `ProgramCheckResult[]`, using its own ad hoc filtering and
 * ordering. Nothing enforced that they agreed, and the discovery-only
 * boundary (an unresolved zoning/use question must outrank a financing
 * action) was only encoded in one of the three.
 *
 * `buildStartHere` is the single place that ranking now happens. It is a
 * pure function: no I/O, no report-shape knowledge, just
 * `ProgramCheckResult[]` (+ an optional unresolved-zoning question) in,
 * `StartHere` out. `lib/confidence-engine.ts` and `lib/report-engine.ts`
 * both import it — this module must never import either of them, or the
 * module graph cycles.
 *
 * Phase A (this file's introduction) is additive only: `computeTopActions`
 * is refactored to derive its legacy `TopAction[]` shape from
 * `buildStartHere`'s output, and the report-engine generators share the
 * `selectTopPrograms` primitive this module exports — but no existing
 * legacy report field changes value. See lib/report-engine.ts's
 * `GeneratedReport.startHere` for how the canonical model is attached.
 */

import type { ProgramCheckResult, ProgramContact } from "./types";

/**
 * What kind of action this is. Used only to decide how to *render* the
 * action (call button vs. link vs. booking CTA) — never to imply a
 * determination about the reader's eligibility.
 */
export type StartHereActionKind =
  | "call-agency"
  | "confirm-with-agency"
  | "book-advising"
  | "confirm-zoning-use"
  | "gather-information";

export interface StartHereAction {
  label: string;
  description: string;
  kind: StartHereActionKind;
  programId?: string;
  contact?: ProgramContact;
  officialUrl?: string;
  /** Populated by the caller (report-engine.ts) once preparation-cost
   *  classification runs; buildStartHere never sets this itself. */
  preparationCost?: unknown;
}

export interface StartHereEvidence {
  fact: string;
  sourceLabel: string;
}

export interface StartHere {
  /** ONE low-regret action. Always present — falls back to a generic
   *  "talk to a support organization" action when nothing else applies. */
  primary: StartHereAction;
  /** Up to two more actions of the same shape. */
  secondary: StartHereAction[];
  /** Up to three short supporting facts, each attributed to a source. */
  evidence: StartHereEvidence[];
  /**
   * Data gaps and open determinations, stated as questions. This is where
   * the discovery-only boundary lives: an unconfirmed zoning/use question
   * always surfaces here, and forces `primary` toward confirming it instead
   * of leading with a financing action (see `buildStartHere`).
   */
  unresolvedQuestions: string[];
  /** The report type this was built for (`GeneratedReport["reportType"]`,
   *  passed through as a plain string so this module needs no import from
   *  report-engine.ts). */
  audience: string;
}

/** A zoning/use question that has not been confirmed. When present, it
 *  outranks every financing/program action for the `primary` slot. */
export interface UnresolvedZoningQuestion {
  /** Phrased as a question — this is what goes into `unresolvedQuestions`. */
  question: string;
  /** Label for the action that would resolve the question. */
  confirmationLabel: string;
  confirmationDescription: string;
}

export interface BuildStartHereInput {
  /** Program relevance results, already ordered by the caller (most
   *  address/goal-relevant first) — buildStartHere does not re-rank them. */
  results: ProgramCheckResult[];
  /** The report type this StartHere is built for. */
  audience: string;
  /** An unresolved zoning/use question, when one exists for this report. */
  unresolvedZoning?: UnresolvedZoningQuestion;
  /** Short supporting facts to surface (already trimmed/prioritized by the
   *  caller — buildStartHere only applies the 3-item cap). */
  evidenceFacts?: StartHereEvidence[];
}

/**
 * Slice the first `limit` items. A named primitive rather than an inline
 * `.slice(0, n)` at each call site so report-engine.ts's generators and
 * `buildStartHere` share exactly one "pick the top N" implementation —
 * the actual mechanism by which they can no longer silently diverge.
 */
export function selectTopPrograms<T>(programs: T[], limit: number): T[] {
  return programs.slice(0, limit);
}

/**
 * Programs whose relevance carries address-specific (or answer-matched)
 * evidence — i.e. not a bare "not mapped" / "depends on context" result.
 * Mirrors the filter `computeTopActions` used before this refactor.
 */
function addressLinkedResults(results: ProgramCheckResult[]): ProgramCheckResult[] {
  return results.filter(
    (r) => r.relevance !== "not_mapped_at_location" && r.relevance !== "context_dependent",
  );
}

/**
 * Build up to two candidate actions from the top address-linked results:
 * a phone call when the program publishes one, otherwise a "confirm with
 * the agency" action when it publishes a URL, otherwise nothing for that
 * result (its slot is skipped, not backfilled). This exactly reproduces
 * the loop body `computeTopActions` used to run inline.
 */
function candidateActionsFromResults(results: ProgramCheckResult[]): StartHereAction[] {
  const candidates: StartHereAction[] = [];
  for (const result of selectTopPrograms(addressLinkedResults(results), 2)) {
    const contact = result.program.contacts?.[0];
    if (contact?.phone) {
      candidates.push({
        label: `Call ${contact.agency || contact.abbreviation} about ${result.program.name}`,
        description: result.program.summary,
        kind: "call-agency",
        programId: result.programId,
        contact,
      });
    } else if (contact?.url) {
      candidates.push({
        label: `Confirm with the administering agency whether ${result.program.name} applies to this project`,
        description: result.program.summary,
        kind: "confirm-with-agency",
        programId: result.programId,
        contact,
        officialUrl: contact.url,
      });
    }
  }
  return candidates;
}

/** The always-available low-regret fallback: free business advising,
 *  when the catalog carries a Small Business Source-shaped program. */
function advisingFallback(results: ProgramCheckResult[]): StartHereAction | null {
  const sbs = results.find((r) => r.programId === "smallBizSource");
  if (!sbs) return null;
  const contact: ProgramContact | undefined = sbs.program.contacts?.[0];
  return {
    label: "Book free business advising",
    description: sbs.program.summary,
    kind: "book-advising",
    programId: "smallBizSource",
    contact,
  };
}

/** Generic last-resort primary when nothing else applies at all — no
 *  address-linked program with a usable contact, and no advising program in
 *  the catalog. Still "low-regret": it names a next step, not a verdict. */
function genericFallbackAction(): StartHereAction {
  return {
    label: "Confirm your project details with a local business support organization",
    description:
      "No address-linked program or advising contact was found in the mapped data. A local support organization can help identify the right next step.",
    kind: "gather-information",
  };
}

/** Up to one unresolved-verification question per chosen action, drawn from
 *  the program's own published (but unconfirmed) requirements. */
function verificationQuestionsForActions(
  actions: StartHereAction[],
  results: ProgramCheckResult[],
): string[] {
  const questions: string[] = [];
  for (const action of actions) {
    if (!action.programId) continue;
    const result = results.find((r) => r.programId === action.programId);
    if (result?.notVerified?.length) {
      questions.push(`Does ${result.program.name} still require: ${result.notVerified[0]}?`);
    }
  }
  return questions;
}

/**
 * Build the canonical StartHere model.
 *
 * Priority logic (the tested invariant): an unresolved zoning/use question
 * always outranks financing/program actions for the `primary` slot — a
 * visitor is never pointed at money before an unresolved foundational
 * question. When no such question exists, `primary` prefers an action that
 * connects to a human (a phone call to an administering agency, or a
 * booked advising session) over a generic task, by construction: the
 * candidate pool is built call-first, then agency-confirmation, then
 * advising, and only falls through to a generic "gather information" step
 * when none of those apply.
 */
export function buildStartHere(input: BuildStartHereInput): StartHere {
  const candidates = candidateActionsFromResults(input.results);
  const fallback = advisingFallback(input.results);
  const pool: StartHereAction[] = [...candidates];
  if (fallback && pool.length < 3) pool.push(fallback);

  let primary: StartHereAction;
  let secondary: StartHereAction[];
  const unresolvedQuestions: string[] = [];

  if (input.unresolvedZoning) {
    primary = {
      label: input.unresolvedZoning.confirmationLabel,
      description: input.unresolvedZoning.confirmationDescription,
      kind: "confirm-zoning-use",
    };
    unresolvedQuestions.push(input.unresolvedZoning.question);
    secondary = selectTopPrograms(pool, 2);
  } else if (pool.length > 0) {
    primary = pool[0];
    secondary = pool.slice(1, 3);
  } else {
    primary = genericFallbackAction();
    secondary = [];
  }

  for (const question of verificationQuestionsForActions([primary, ...secondary], input.results)) {
    if (unresolvedQuestions.length >= 3) break;
    unresolvedQuestions.push(question);
  }

  const evidence = (input.evidenceFacts ?? []).slice(0, 3);

  return {
    primary,
    secondary,
    evidence,
    unresolvedQuestions: unresolvedQuestions.slice(0, 3),
    audience: input.audience,
  };
}

/** Every action in a StartHere, primary first — the natural iteration order
 *  for adapters that flatten it back into a legacy list shape. */
export function startHereActionsInOrder(startHere: StartHere): StartHereAction[] {
  return [startHere.primary, ...startHere.secondary];
}
