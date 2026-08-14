// review5 S1 (CRITICAL): this module previously statically imported
// data/programs-internal.json — the full internal catalog, unconditionally
// bundled into EVERY page that transitively imports this module (any page
// reachable from /qualify), regardless of whether that visitor ever
// submits the survey. `scoreSurvey()` genuinely needs full record fidelity
// (requiredDocs, eligibilityRules, contacts, lastVerifiedAt, sourceUrl) to
// build its already-safe, structured `PublicMatchExplanation` via
// buildPublicMatchExplanation() — the DTO does not carry those fields, by
// PR1 design. Rather than bundle them anyway, scoreSurvey() is now async
// and fetches /api/programs/engine-source (the same explicitly-scoped,
// documented route the report engine and map snapshot use) ONLY at the
// moment a visitor actually submits — never bundled, never fetched
// speculatively. See app/api/programs/engine-source/route.ts and
// docs/eligibility-claims-acceptance.md's S1 resolution note.
import { buildPublicMatchExplanation } from "./match-transparency";
import { resolveAvailability } from "./program-gating";
import type {
  IntakeStatus,
  Program,
  ProgramMatch,
  SurveyAnswers,
  SurveyQuestion,
  SurveyResult,
} from "./types";

// ─── Question Definitions ────────────────────────────────────────────

// build-spec.md 2.6 (audit F12; consult item 10): the industry options
// retail, professional, construction, healthcare, and other were INERT —
// no rule in RULES.industry below ever used them to order programs, so
// answering one of them cost the user effort for zero effect while the
// results screen still read as if every answer mattered. Removed rather
// than retained-with-disclosure, per the spec's primary instruction ("do
// not invent new matching rules"): none of the five had a defensible
// non-ranking purpose to disclose.
export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "industry",
    step: 1,
    title: "What industry is your business in?",
    subtitle: "Select the closest match",
    type: "single",
    options: [
      { id: "ev", label: "EV / Clean Energy" },
      { id: "semiconductor", label: "Semiconductor" },
      { id: "dataCenter", label: "Data Center / Cloud" },
      { id: "manufacturing", label: "Manufacturing" },
      { id: "tech", label: "Tech / Software" },
      { id: "nonprofit", label: "Nonprofit" },
      { id: "hairBeauty", label: "Hair Care & Beauty" },
      { id: "clothing", label: "Clothing & Apparel" },
      { id: "autoServices", label: "Auto Services" },
      { id: "childcare", label: "Childcare & Education" },
      { id: "fitness", label: "Fitness & Recreation" },
      { id: "homeServices", label: "Home Services" },
      { id: "petServices", label: "Pet Services" },
    ],
  },
  {
    id: "property",
    step: 2,
    title: "What is your property situation?",
    subtitle: "This affects building & location programs",
    type: "single",
    options: [
      { id: "own", label: "Own commercial property" },
      { id: "lease5plus", label: "Lease 5+ years" },
      { id: "leaseShort", label: "Lease under 5 years" },
      { id: "buyBuild", label: "Looking to buy / build" },
      { id: "none", label: "No physical location" },
    ],
  },
  {
    id: "activities",
    step: 3,
    title: "What are you planning to do?",
    subtitle: "Select all that apply",
    type: "multi",
    options: [
      { id: "renovations", label: "Building renovations" },
      { id: "energy", label: "Energy efficiency upgrades" },
      { id: "hiring", label: "Hiring employees" },
      { id: "equipment", label: "Buying equipment / machinery" },
      { id: "capitalGains", label: "Investing capital gains" },
      { id: "expanding", label: "Expanding / relocating" },
      // "advice" ("Seeking advice") removed (review5 S7). Its only rule
      // routed to smallBizSource, which is forced into the universal-
      // navigation bucket regardless of any answer (see below) — so
      // selecting it never changed `matches`, and after this fix it can
      // no longer even change what reason text the universal bucket
      // shows. An option with zero remaining observable effect gets
      // removed, per the same F12 doctrine that removed the other inert
      // options above, rather than kept with a fabricated effect.
    ],
  },
  {
    id: "size",
    step: 4,
    title: "How big is your business?",
    subtitle: "Annual revenue range",
    type: "single",
    // under500k removed (build-spec.md 2.6 / audit F12) — no rule in
    // RULES.size ever used it.
    options: [
      { id: "preRevenue", label: "Pre-revenue / startup" },
      { id: "500kTo10m", label: "$500K – $10M / year" },
      { id: "over10m", label: "Over $10M / year" },
    ],
  },
];

// ─── Program Catalog ─────────────────────────────────────────────────

export const PROGRAMS: Record<string, { name: string; short: string }> = {
  sbif: { name: "Small Business Improvement Fund", short: "SBIF" },
  tif: { name: "TIF Works", short: "TIF" },
  cpace: { name: "C-PACE", short: "C-PACE" },
  class7a: { name: "Class 7a Property Tax Incentive", short: "Class 7a" },
  edge: { name: "EDGE Tax Credit", short: "EDGE" },
  rev: { name: "REV Illinois", short: "REV" },
  micro: { name: "Micro-Electronics Program", short: "Micro" },
  dataCenter: { name: "Data Center Tax Incentive", short: "Data Center" },
  landBank: { name: "Chicago Land Bank", short: "Land Bank" },
  federalOZ: { name: "Federal Opportunity Zone", short: "Federal OZ" },
  illinoisOZ: { name: "Illinois Opportunity Zone", short: "Illinois OZ" },
  enterprise: { name: "Enterprise Zone", short: "Enterprise" },
  highUnemployment: { name: "High-Impact Business (High Unemployment)", short: "High Unemployment" },
  catalystGrant: { name: "Catalyst Fund Grant", short: "Catalyst" },
  smallBizSource: { name: "Small Business Source", short: "SB Source" },
  workforceSolutions: { name: "Workforce Solutions", short: "Workforce" },
  ssa: { name: "Special Service Area", short: "SSA" },
};

// ─── Matching Rules ──────────────────────────────────────────────────

type Confidence = "high" | "medium" | "low";
type RuleMatch = { program: string; confidence: Confidence };

const RULES: Record<string, Record<string, RuleMatch[]>> = {
  industry: {
    ev: [{ program: "rev", confidence: "high" }, { program: "edge", confidence: "medium" }],
    semiconductor: [{ program: "micro", confidence: "high" }, { program: "edge", confidence: "medium" }],
    dataCenter: [{ program: "dataCenter", confidence: "high" }],
    manufacturing: [{ program: "edge", confidence: "medium" }, { program: "rev", confidence: "low" }, { program: "micro", confidence: "low" }],
    tech: [{ program: "dataCenter", confidence: "low" }],
    nonprofit: [{ program: "cpace", confidence: "medium" }],
    hairBeauty: [{ program: "sbif", confidence: "high" }, { program: "catalystGrant", confidence: "medium" }],
    clothing: [{ program: "sbif", confidence: "high" }, { program: "catalystGrant", confidence: "medium" }],
    autoServices: [{ program: "enterprise", confidence: "medium" }, { program: "sbif", confidence: "high" }],
    childcare: [{ program: "sbif", confidence: "high" }, { program: "catalystGrant", confidence: "medium" }],
    fitness: [{ program: "sbif", confidence: "high" }, { program: "catalystGrant", confidence: "medium" }],
    homeServices: [{ program: "enterprise", confidence: "medium" }, { program: "catalystGrant", confidence: "medium" }],
    petServices: [{ program: "sbif", confidence: "high" }, { program: "catalystGrant", confidence: "medium" }],
  },
  property: {
    own: [{ program: "sbif", confidence: "high" }, { program: "tif", confidence: "high" }, { program: "cpace", confidence: "high" }, { program: "class7a", confidence: "high" }],
    lease5plus: [{ program: "sbif", confidence: "high" }, { program: "tif", confidence: "high" }],
    leaseShort: [{ program: "tif", confidence: "medium" }],
    buyBuild: [{ program: "landBank", confidence: "high" }, { program: "class7a", confidence: "high" }, { program: "federalOZ", confidence: "medium" }, { program: "illinoisOZ", confidence: "medium" }],
    none: [{ program: "workforceSolutions", confidence: "medium" }],
  },
  activities: {
    renovations: [{ program: "sbif", confidence: "high" }, { program: "tif", confidence: "high" }, { program: "class7a", confidence: "medium" }, { program: "enterprise", confidence: "medium" }],
    energy: [{ program: "cpace", confidence: "high" }, { program: "enterprise", confidence: "medium" }],
    hiring: [{ program: "edge", confidence: "high" }, { program: "highUnemployment", confidence: "medium" }],
    equipment: [{ program: "enterprise", confidence: "medium" }, { program: "catalystGrant", confidence: "medium" }],
    capitalGains: [{ program: "federalOZ", confidence: "high" }, { program: "illinoisOZ", confidence: "high" }],
    expanding: [{ program: "landBank", confidence: "medium" }, { program: "edge", confidence: "medium" }, { program: "enterprise", confidence: "medium" }],
  },
  size: {
    preRevenue: [{ program: "smallBizSource", confidence: "high" }],
    "500kTo10m": [{ program: "catalystGrant", confidence: "high" }],
    over10m: [{ program: "edge", confidence: "medium" }, { program: "rev", confidence: "medium" }, { program: "micro", confidence: "medium" }],
  },
};

// ─── Internal Ordering ───────────────────────────────────────────────

/** Fetched fresh on each scoreSurvey() call — never bundled, never cached
 *  across calls (a stale cache could serve pre-correction facts after the
 *  catalog changes; this endpoint is short/cheap enough that re-fetching
 *  per submission is not a real cost). */
async function fetchProgramDetails(): Promise<Map<string, Program>> {
  const res = await fetch("/api/programs/engine-source");
  const programs = (await res.json()) as Program[];
  return new Map(programs.map((program) => [program.id, program]));
}

/** Short collapsed-row label from a program's intakeStatus (build-spec.md
 *  2.6: status must show BEFORE the card is opened, never only inside). */
function statusLabel(intakeStatus: IntakeStatus): string {
  switch (intakeStatus) {
    case "open":
      return "Open";
    case "rolling":
      return "Rolling";
    case "closed":
      return "Closed";
    case "lapsed":
      return "Lapsed";
    case "pending":
      return "Pending";
    case "unknown":
    default:
      return "Status not established";
  }
}

function matchStatus(program: Program): ProgramMatch["status"] {
  const intakeStatus: IntakeStatus = program.intakeStatus ?? "unknown";
  return { intakeStatus, label: statusLabel(intakeStatus) };
}

function toProgramMatch(
  programDetails: Map<string, Program>,
  programId: string,
  confidence: Confidence,
  reasons: string[],
): ProgramMatch | null {
  const program = programDetails.get(programId);
  if (!program) return null;
  return {
    programId,
    program: {
      name: program.name,
      short: PROGRAMS[programId]?.short ?? program.name,
      level: program.level,
    },
    explanation: buildPublicMatchExplanation(program, {
      basedOnUserAnswers: reasons,
    }),
    status: matchStatus(program),
  };
}

export async function scoreSurvey(answers: SurveyAnswers): Promise<SurveyResult> {
  const programDetails = await fetchProgramDetails();
  const matchMap: Record<string, { confidence: Confidence; reasons: string[] }> = {};
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  // Every answer key the caller actually gave, e.g. "industry", "activities:hiring".
  const usedAnswers: string[] = [];
  const unusedAnswers: string[] = [];

  const addMatch = (programId: string, confidence: Confidence, reason?: string) => {
    if (!matchMap[programId]) {
      matchMap[programId] = { confidence, reasons: [] };
    }
    if (rank[confidence] > rank[matchMap[programId].confidence]) {
      matchMap[programId].confidence = confidence;
    }
    if (reason) matchMap[programId].reasons.push(reason);
  };

  for (const question of SURVEY_QUESTIONS) {
    const answer = answers[question.id as keyof SurveyAnswers];
    if (!answer) continue;

    const questionRules = RULES[question.id] || {};

    if (question.type === "multi" && Array.isArray(answer)) {
      for (const optionId of answer) {
        const matches = questionRules[optionId] || [];
        const label = question.options.find((o) => o.id === optionId)?.label || optionId;
        const key = `${question.id}:${optionId}`;
        if (matches.length > 0) usedAnswers.push(key);
        else unusedAnswers.push(key);
        for (const m of matches) addMatch(m.program, m.confidence, label);
      }
    } else if (typeof answer === "string") {
      const matches = questionRules[answer] || [];
      const label = question.options.find((o) => o.id === answer)?.label || answer;
      const key = `${question.id}:${answer}`;
      if (matches.length > 0) usedAnswers.push(key);
      else unusedAnswers.push(key);
      for (const m of matches) addMatch(m.program, m.confidence, label);
    }
  }

  // build-spec.md 2.6: smallBizSource is universal navigation, not an
  // answer-derived result — separated from `matches` below regardless of
  // whether an answer ALSO happened to name it, so it never implies a
  // ranking decision the user's answers made.
  //
  // review5 S7: the confidence tier was correctly forced to "low" and the
  // program was correctly pulled out of `matches`, but the REASON TEXT
  // that accumulated in matchMap.smallBizSource (e.g. an answer's label,
  // via addMatch's `reason` param) was passed straight through to
  // toProgramMatch's `basedOnUserAnswers` — so the universal card could
  // still display "Pre-revenue / startup" or similar as if it were an
  // answer-derived reason, contradicting the comment right above it. The
  // universal bucket now NEVER carries answer-derived reasons — deleted
  // unconditionally, not merely captured-then-forwarded.
  delete matchMap.smallBizSource;
  const universalMatch = toProgramMatch(programDetails, "smallBizSource", "low", []);
  const universal: ProgramMatch[] = universalMatch ? [universalMatch] : [];

  const confidenceOrder: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const rankedMatches = Object.entries(matchMap)
    .map(([programId, data]) => ({
      programId,
      confidence: data.confidence,
      reasons: data.reasons,
    }))
    .sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

  // build-spec.md 2.6: gate through resolveAvailability — an expired
  // program never surfaces as a "starting point", matching every other
  // program-facing surface in the app.
  const today = new Date();
  const matches: ProgramMatch[] = rankedMatches.flatMap((match) => {
    const program = programDetails.get(match.programId);
    if (!program) return [];
    if (resolveAvailability(program, today).state === "expired") return [];
    const built = toProgramMatch(programDetails, match.programId, match.confidence, match.reasons);
    return built ? [built] : [];
  });

  return { matches, universal, usedAnswers, unusedAnswers };
}
