import programsData from "@/public/data/programs.json";
import { buildPublicMatchExplanation } from "./match-transparency";
import type {
  Program,
  ProgramMatch,
  SurveyAnswers,
  SurveyQuestion,
  SurveyResult,
} from "./types";

// ─── Question Definitions ────────────────────────────────────────────

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
      { id: "retail", label: "Retail / Restaurant / Service" },
      { id: "professional", label: "Professional Services" },
      { id: "construction", label: "Construction / Trades" },
      { id: "healthcare", label: "Healthcare / Wellness" },
      { id: "tech", label: "Tech / Software" },
      { id: "nonprofit", label: "Nonprofit" },
      { id: "hairBeauty", label: "Hair Care & Beauty" },
      { id: "clothing", label: "Clothing & Apparel" },
      { id: "autoServices", label: "Auto Services" },
      { id: "childcare", label: "Childcare & Education" },
      { id: "fitness", label: "Fitness & Recreation" },
      { id: "homeServices", label: "Home Services" },
      { id: "petServices", label: "Pet Services" },
      { id: "other", label: "Other" },
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
      { id: "advice", label: "Seeking advice" },
    ],
  },
  {
    id: "size",
    step: 4,
    title: "How big is your business?",
    subtitle: "Annual revenue range",
    type: "single",
    options: [
      { id: "preRevenue", label: "Pre-revenue / startup" },
      { id: "under500k", label: "Under $500K / year" },
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
    advice: [{ program: "smallBizSource", confidence: "high" }],
  },
  size: {
    preRevenue: [{ program: "smallBizSource", confidence: "high" }],
    "500kTo10m": [{ program: "catalystGrant", confidence: "high" }],
    over10m: [{ program: "edge", confidence: "medium" }, { program: "rev", confidence: "medium" }, { program: "micro", confidence: "medium" }],
  },
};

// ─── Internal Ordering ───────────────────────────────────────────────

const PROGRAM_DETAILS = new Map(
  (programsData as unknown as Program[]).map((program) => [program.id, program]),
);

export function scoreSurvey(answers: SurveyAnswers): SurveyResult {
  const matchMap: Record<string, { confidence: Confidence; reasons: string[] }> = {};
  const rank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

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
        for (const m of matches) addMatch(m.program, m.confidence, label);
      }
    } else if (typeof answer === "string") {
      const matches = questionRules[answer] || [];
      const label = question.options.find((o) => o.id === answer)?.label || answer;
      for (const m of matches) addMatch(m.program, m.confidence, label);
    }
  }

  // smallBizSource always matches
  if (!matchMap.smallBizSource) {
    addMatch("smallBizSource", "low");
  }

  const confidenceOrder: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
  const rankedMatches = Object.entries(matchMap)
    .map(([programId, data]) => ({
      programId,
      confidence: data.confidence,
      reasons: data.reasons,
    }))
    .sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

  const matches: ProgramMatch[] = rankedMatches.flatMap((match) => {
    const program = PROGRAM_DETAILS.get(match.programId);
    if (!program) return [];

    return [{
      programId: match.programId,
      program: {
        name: program.name,
        short: PROGRAMS[match.programId]?.short ?? program.name,
        level: program.level,
      },
      explanation: buildPublicMatchExplanation(program, {
        basedOnUserAnswers: match.reasons,
      }),
    }];
  });

  return { matches };
}
