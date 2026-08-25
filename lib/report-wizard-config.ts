// ─── Report Wizard Configuration ────────────────────────────────────
// Pure TypeScript config/types for the multi-step report wizard.
// Two generated report types plus routed analysis entry points. The retired
// Corridor Intelligence type remains decodable for old shared links, but is no
// longer promoted in the report picker.

// ─── Core Types ─────────────────────────────────────────────────────

export type ReportType = "site-incentives" | "dev-feasibility" | "corridor-intelligence";
export type AnalysisOptionId = ReportType | "permit-activity" | "public-investment";

export interface ReportTypeOption {
  id: AnalysisOptionId;
  title: string;
  subtitle: string;
  bestFor: string;
  icon: string; // emoji
  href?: string;
  availability?: "beta";
  hidden?: boolean;
}

export interface StepOption {
  id: string;
  label: string;
  description?: string;
}

export interface WizardStepConfig {
  id: string;
  title: string;
  subtitle: string;
  appliesTo: ReportType[];
  inputType: "report-type" | "address" | "neighborhood" | "project-intake" | "single" | "multi" | "combobox" | "review";
  stateKey: keyof WizardState;
  options?: StepOption[];
}

export interface WizardState {
  reportType: ReportType | null;
  address: string;
  lat: number | null;
  lon: number | null;
  neighborhood: string;
  industry: string;
  budgetRange: string;
  /** Up to three selected project goals. `projectType` mirrors the first. */
  projectGoals: string[];
  projectType: string;
  /** Plain-language goal supplied when `other` is selected. */
  customGoal: string;
  proposedUse: string;
  fundingCommitted: string;
  remainingGap: string;
  timeline: string;
  siteControl: string;
  documentsAvailable: string[];
  jobsImpact: string;
  supportNeeded: string[];
  creditsToAnalyze: string[];
  compareAddress?: string;
  compareLat?: number | null;
  compareLon?: number | null;
}

// ─── Initial State ──────────────────────────────────────────────────

export const INITIAL_WIZARD_STATE: WizardState = {
  reportType: null,
  address: "",
  lat: null,
  lon: null,
  neighborhood: "",
  industry: "",
  budgetRange: "",
  projectGoals: [],
  projectType: "",
  customGoal: "",
  proposedUse: "",
  fundingCommitted: "",
  remainingGap: "",
  timeline: "",
  siteControl: "",
  documentsAvailable: [],
  jobsImpact: "",
  supportNeeded: [],
  creditsToAnalyze: [],
};

// ─── Report Type Options (Step 1) ───────────────────────────────────

export const REPORT_TYPE_OPTIONS: ReportTypeOption[] = [
  {
    id: "site-incentives",
    title: "Site Incentive Analysis",
    subtitle:
      "You have a location. See which programs may apply, how to verify fit, and who to call.",
    bestFor:
      "Best for business owners with an address, lease, property, or planned investment.",
    icon: "\uD83D\uDCCD",
  },
  {
    id: "dev-feasibility",
    title: "Vacancy Analysis",
    subtitle:
      "Evaluate vacant properties or corridors for ownership, zoning, incentive fit, and next steps.",
    bestFor:
      "Best for corridor managers, developers, and partners evaluating vacant land or buildings.",
    icon: "\uD83C\uDFDA\uFE0F",
  },
  {
    id: "corridor-intelligence",
    title: "Corridor Intelligence",
    subtitle:
      "Directional market and resilience signals for an area \u2014 ownership, vacancy, and business activity across a corridor.",
    bestFor:
      "Best for lenders, brokers, corridor managers, and chamber staff evaluating an area rather than one address.",
    icon: "\uD83E\uDDED",
    hidden: true,
  },
  {
    id: "permit-activity",
    title: "Permit Activity Analysis",
    subtitle:
      "See recorded permit volume, project mix, and recent activity by community area.",
    bestFor:
      "Best for neighborhood partners, developers, and public-sector teams tracking visible investment activity.",
    icon: "\uD83C\uDFD7\uFE0F",
    href: "/permit-activity",
  },
  {
    id: "public-investment",
    title: "Public Investment Analysis",
    subtitle:
      "Explore public and philanthropic funding patterns, recipients, geography, and capital flows.",
    bestFor:
      "Beta feature currently being tested. Request early access to help shape it.",
    icon: "\uD83C\uDFDB\uFE0F",
    href: "/public-investment-analysis",
    availability: "beta",
  },
];

// ─── Shared Option Lists ────────────────────────────────────────────

const INDUSTRY_OPTIONS: StepOption[] = [
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
  { id: "realEstate", label: "Real Estate / Development" },
  { id: "food", label: "Food & Beverage Production" },
  { id: "logistics", label: "Transportation & Logistics" },
  { id: "arts", label: "Arts & Entertainment" },
  { id: "hairBeauty", label: "Hair Care & Beauty" },
  { id: "clothing", label: "Clothing & Apparel" },
  { id: "autoServices", label: "Auto Services" },
  { id: "childcare", label: "Childcare & Education" },
  { id: "fitness", label: "Fitness & Recreation" },
  { id: "homeServices", label: "Home Services" },
  { id: "petServices", label: "Pet Services" },
];

export const BUDGET_RANGE_OPTIONS: StepOption[] = [
  { id: "under-100k", label: "Under $100K" },
  { id: "100k-500k", label: "$100K\u2013$500K" },
  { id: "500k-2m", label: "$500K\u2013$2M" },
  { id: "2m-10m", label: "$2M\u2013$10M" },
  { id: "over-10m", label: "Over $10M" },
];

export const SITE_PROJECT_TYPE_OPTIONS: StepOption[] = [
  {
    id: "rehab",
    label: "Remodel or renovate",
    description: "Renovating or adaptively reusing an existing structure.",
  },
  {
    id: "expansion",
    label: "Expand current operations",
    description: "Growing into more space, adding capacity, or expanding operations.",
  },
  {
    id: "equipment",
    label: "Buy equipment",
    description: "Buying machinery, fixtures, vehicles, technology, or other equipment.",
  },
  {
    id: "hiring",
    label: "Hire or retain employees",
    description: "Creating or retaining jobs, training staff, or building a hiring plan.",
  },
  {
    id: "relocation",
    label: "Open or relocate",
    description: "Opening a new location or moving into a new commercial space.",
  },
  {
    id: "energy",
    label: "Energy / building systems",
    description: "HVAC, efficiency, solar, water, or other building-system improvements.",
  },
  {
    id: "new-construction",
    label: "New construction",
    description: "Ground-up development on vacant or cleared land.",
  },
  {
    id: "mixed-use",
    label: "Mixed-use development",
    description: "Combining residential, commercial, or institutional uses.",
  },
  {
    id: "affordable-housing",
    label: "Affordable housing",
    description: "Residential with income-restricted units.",
  },
  {
    id: "vacant-acquisition",
    label: "Acquire vacant property",
    description: "Purchasing city-owned or privately held vacant land for development.",
  },
  {
    id: "other",
    label: "Something else",
    description: "Describe a goal that is not represented above.",
  },
];

export const MAX_PROJECT_GOALS = 3;

/**
 * The maximum goal-id SET the engine itself (GOAL_RULES, projectGoalsFit,
 * the report generator, `lib/report-engine.ts`'s two `selectedProjectGoals`
 * call sites) is ever asked to carry — gate review round 2, NEW-3/ruling
 * #4; raised to 5 in round 3, MAJOR finding R3-1; corrected to 6 in round
 * 4, THE BLOCKER, after round 3's derivation turned out to still
 * undercount. `MAX_PROJECT_GOALS` above is the WIZARD's own "pick up to
 * 3" fresh-selection UI limit (unchanged, still governs how many NEW
 * goals `ProjectGoalSelector` lets a visitor add in one sitting) — it is
 * NOT an engine constraint.
 *
 * This is the PROVABLE ceiling, not a guess — but it took two attempts to
 * get the derivation right. Round 3's version treated a pass-through id
 * (a raw goal with no chip at all — only `vacant-acquisition` and `other`
 * qualify) as if it consumed one of the gate's chip "slots." It doesn't:
 * `ReportEmailGate.tsx` tracks TWO INDEPENDENT budgets that both ride
 * together in `projectGoalIds()` once any chip is toggled —
 *   1. the CHIP budget: up to `goalChipCap` chips
 *      (`Math.max(MAX_GATE_GOAL_CHIPS, <chips the seed happened to hit>)`,
 *      never below 2) — freely chosen, not restricted to whichever chips
 *      the original seed touched, so the worst case fills every slot with
 *      the highest-yield chips available (the two 2-id chips, "Expand or
 *      buy equipment" and "Develop housing or mixed-use," first);
 *   2. the PASS-THROUGH budget: `unmatchedGoalIds(originalGoalIds)`,
 *      completely uncapped by the chip budget.
 * Worst witnessed case: a 3-raw-id seed carrying BOTH pass-through ids
 * (`vacant-acquisition`, `other`) plus one chip-matching id still only
 * floors `goalChipCap` at 2 (1 seeded chip doesn't raise it) — so the
 * visitor can then freely pick both 2-id chips (2 + 2 = 4) *on top of*
 * the 2 pass-through ids already riding along = 6.
 * `lib/__tests__/gate-goal-groups.test.ts`'s "provable ceiling" describe
 * block now models both budgets separately and brute-forces every
 * possible seed up to `MAX_PROJECT_GOALS` in size (not a hand-derived
 * closed form) to find the true max, asserting `MAX_ENGINE_GOALS` is at
 * least that — so a future chip regrouping breaks that test, prompting a
 * deliberate bump here, instead of quietly reintroducing silent
 * truncation in production reports. Gate review round 5, NEW-R5-2: the
 * same file's re-gate fixed-point block goes further — a saved report
 * stores this capped set in `metadata.projectGoals` and
 * `reportEmailGateKey` re-seeds a fresh gate from it at the next address,
 * so the test iterates emission → capped storage → re-seed to a fixed
 * point and asserts the max over that FULL universe still equals this
 * constant.
 */
export const MAX_ENGINE_GOALS = 6;

export function selectedProjectGoals(
  state: { projectGoals?: readonly string[]; projectType?: string | null },
): string[] {
  const candidates = state.projectGoals?.length
    ? state.projectGoals
    : state.projectType
      ? [state.projectType]
      : [];

  return Array.from(new Set(candidates.filter(Boolean))).slice(0, MAX_ENGINE_GOALS);
}

export function projectGoalDisplayLabel(
  goalId: string,
  customGoal?: string,
): string {
  if (goalId === "other" && customGoal?.trim()) return customGoal.trim();
  return PROJECT_TYPE_LABELS[goalId] || goalId;
}

/**
 * Whether a wizard/report-metadata shape already carries a complete goal
 * selection — at least one goal, and a written custom goal when "other" is
 * among them. Single source of truth for the "are goals done" check
 * (previously duplicated inline in ReportEmailGate); also backs the
 * shared-link fix (spec v2 deliverable 7): a decoded `pg=` on a framed link
 * satisfies this the same way a visitor's own selection would, so a
 * recipient with a complete goal set already on the URL is never re-blocked
 * by the gate.
 */
export function projectGoalsAreComplete(
  state: { projectGoals?: readonly string[]; projectType?: string | null; customGoal?: string | null },
): boolean {
  const goals = selectedProjectGoals(state);
  return goals.length > 0 && (!goals.includes("other") || Boolean(state.customGoal?.trim()));
}

export function selectedProjectGoalLabels(
  state: {
    projectGoals?: readonly string[];
    projectType?: string | null;
    customGoal?: string | null;
  },
): string[] {
  return selectedProjectGoals(state).map((goalId) =>
    projectGoalDisplayLabel(goalId, state.customGoal ?? undefined),
  );
}

export const VACANCY_PROJECT_TYPE_OPTIONS: StepOption[] = [
  {
    id: "rehab",
    label: "Rehabilitation / renovation",
    description: "Reuse or improve an existing vacant building.",
  },
  {
    id: "vacant-acquisition",
    label: "Purchase or acquire property",
    description: "Acquire vacant land, a vacant building, or a site under consideration.",
  },
  {
    id: "expansion",
    label: "Expansion",
    description: "Grow an existing business, organization, or project into the site.",
  },
  {
    id: "new-construction",
    label: "New construction",
    description: "Build a new project on vacant or cleared land.",
  },
];

export const PROPOSED_USE_OPTIONS: StepOption[] = [
  { id: "commercial", label: "Commercial" },
  { id: "mixed-use", label: "Mixed-use" },
  { id: "community-cultural", label: "Community / cultural" },
  { id: "housing", label: "Housing" },
  { id: "industrial-maker", label: "Industrial / maker space" },
  { id: "not-sure", label: "Not sure yet" },
];

export const PROJECT_TYPE_LABELS = Object.fromEntries(
  [...VACANCY_PROJECT_TYPE_OPTIONS, ...SITE_PROJECT_TYPE_OPTIONS].map((option) => [option.id, option.label])
) as Record<string, string>;

export const PROPOSED_USE_LABELS = Object.fromEntries(
  PROPOSED_USE_OPTIONS.map((option) => [option.id, option.label])
) as Record<string, string>;

const CREDIT_OPTIONS: StepOption[] = [
  {
    id: "nrhpDistricts",
    label: "Federal Historic Tax Credit (20%)",
    description: "20% credit on qualified rehabilitation expenditures for certified historic structures.",
  },
  {
    id: "nmtcEligible",
    label: "NMTC (39% over 7 years)",
    description: "New Markets Tax Credit providing 39% of the investment as credits over seven years.",
  },
  {
    id: "federalOZ",
    label: "Opportunity Zone capital gains",
    description: "Deferral and potential reduction of capital gains taxes through Qualified Opportunity Fund investment.",
  },
  {
    id: "qct",
    label: "LIHTC / QCT boost",
    description: "Low-Income Housing Tax Credits with a 130% basis boost in Qualified Census Tracts.",
  },
  {
    id: "tif",
    label: "TIF funding",
    description: "Tax Increment Financing to fund public improvements and eligible project costs.",
  },
  {
    id: "enterprise",
    label: "Enterprise Zone exemptions",
    description: "State sales tax exemptions, utility tax exemptions, and investment tax credits.",
  },
  {
    id: "edge",
    label: "EDGE tax credits",
    description: "Income tax credits for job creation and retention through the EDGE program.",
  },
  {
    id: "cpace",
    label: "C-PACE financing",
    description: "Commercial Property Assessed Clean Energy financing for energy efficiency and renewable energy.",
  },
  {
    id: "class7a",
    label: "Class 7a property tax reduction",
    description: "Cook County property tax classification reducing assessment level for qualifying commercial properties.",
  },
];

export const FUNDING_COMMITTED_OPTIONS: StepOption[] = [
  { id: "none", label: "None yet" },
  { id: "under-25", label: "Under 25%" },
  { id: "25-50", label: "25%–50%" },
  { id: "50-75", label: "50%–75%" },
  { id: "over-75", label: "Over 75%" },
  { id: "not-sure", label: "Not sure" },
];

export const REMAINING_GAP_OPTIONS: StepOption[] = [
  { id: "none", label: "No known gap" },
  { id: "under-50k", label: "Under $50K" },
  { id: "50k-250k", label: "$50K–$250K" },
  { id: "250k-1m", label: "$250K–$1M" },
  { id: "over-1m", label: "Over $1M" },
  { id: "not-sure", label: "Not sure yet" },
];

export const TIMELINE_OPTIONS: StepOption[] = [
  { id: "immediate", label: "Immediate / this month" },
  { id: "1-3-months", label: "1–3 months" },
  { id: "3-6-months", label: "3–6 months" },
  { id: "6-12-months", label: "6–12 months" },
  { id: "over-12-months", label: "12+ months" },
  { id: "not-sure", label: "Not sure" },
];

export const SITE_CONTROL_OPTIONS: StepOption[] = [
  { id: "own", label: "Own the property" },
  { id: "lease", label: "Lease the space" },
  { id: "under-contract", label: "Under contract / LOI" },
  { id: "evaluating", label: "Still evaluating sites" },
  { id: "not-sure", label: "Not sure" },
];

export const JOBS_IMPACT_OPTIONS: StepOption[] = [
  { id: "none", label: "No jobs planned" },
  { id: "retain", label: "Retain existing jobs" },
  { id: "1-5", label: "Create 1–5 jobs" },
  { id: "6-20", label: "Create 6–20 jobs" },
  { id: "20-plus", label: "Create 20+ jobs" },
  { id: "not-sure", label: "Not sure" },
];

export const SUPPORT_NEEDED_OPTIONS: StepOption[] = [
  { id: "grant", label: "Grant" },
  { id: "tax-savings", label: "Tax savings" },
  { id: "financing", label: "Financing" },
  { id: "advising", label: "Advising" },
  { id: "not-sure", label: "Not sure" },
];

export const DOCUMENT_READINESS_OPTIONS: StepOption[] = [
  { id: "none-yet", label: "None yet / not sure" },
  { id: "project-budget", label: "Project budget" },
  { id: "scope-of-work", label: "Scope of work" },
  { id: "contractor-bids", label: "Contractor bids" },
  { id: "ownership-or-lease", label: "Proof of ownership or lease" },
  { id: "permits-drawings", label: "Permits / drawings" },
  { id: "financial-statements", label: "Financial statements" },
  { id: "tax-clearance", label: "Tax clearance" },
  { id: "w9", label: "W-9" },
  { id: "insurance", label: "Insurance" },
  { id: "hiring-projections", label: "Hiring projections" },
  { id: "award-letters", label: "Existing award letters" },
  { id: "timeline", label: "Timeline" },
];

export function optionLabel(options: StepOption[], value: string): string {
  return options.find((option) => option.id === value)?.label || value;
}

// ─── Wizard Steps ───────────────────────────────────────────────────

export const WIZARD_STEPS: WizardStepConfig[] = [
  // ── Shared: Report type selection ─────────────────────────────────
  {
    id: "report-type",
    title: "What kind of report do you want to generate?",
    subtitle: "Choose the analysis that fits your situation.",
    appliesTo: ["site-incentives", "dev-feasibility", "corridor-intelligence"],
    inputType: "report-type",
    stateKey: "reportType",
    options: REPORT_TYPE_OPTIONS
      .filter((opt) => !opt.hidden && !opt.href)
      .map((opt) => ({
        id: opt.id,
        label: opt.title,
        description: opt.subtitle,
      })),
  },

  // ── Site Incentive Analysis flow ──────────────────────────────────

  {
    id: "si-address",
    title: "What\u2019s your address?",
    subtitle: "We\u2019ll check which incentive zones cover your location.",
    appliesTo: ["site-incentives"],
    inputType: "address",
    stateKey: "address",
  },
  {
    id: "si-industry",
    title: "What\u2019s your industry?",
    subtitle: "Optional: add an industry to narrow the report, or continue without it.",
    appliesTo: ["site-incentives"],
    inputType: "combobox",
    stateKey: "industry",
    options: [
      ...INDUSTRY_OPTIONS,
      { id: "skip", label: "Skip \u2014 show all programs" },
    ],
  },
  {
    id: "si-project-intake",
    title: "Tell us about the project",
    subtitle: "Choose up to three goals you want the report to support. The remaining details are optional.",
    appliesTo: ["site-incentives"],
    inputType: "project-intake",
    stateKey: "projectType",
  },
  {
    id: "si-documents",
    title: "Which documents do you already have?",
    subtitle: "Optional: select what is ready today. The report will flag what may still be useful.",
    appliesTo: ["site-incentives"],
    inputType: "multi",
    stateKey: "documentsAvailable",
    options: DOCUMENT_READINESS_OPTIONS,
  },
  {
    id: "si-review",
    title: "Review & Generate",
    subtitle: "Confirm your selections and generate your incentive report.",
    appliesTo: ["site-incentives"],
    inputType: "review",
    stateKey: "reportType",
  },

  // ── Vacancy Analysis flow ─────────────────────────────────────────

  {
    id: "df-location",
    title: "Where in Chicago?",
    subtitle: "Pick a neighborhood to explore, or enter a specific address for parcel-level detail.",
    appliesTo: ["dev-feasibility"],
    inputType: "neighborhood",
    stateKey: "neighborhood",
  },
  {
    id: "df-project-intake",
    title: "What are you considering for this site?",
    subtitle: "Optional: answer what you know, or skip ahead if you are still exploring.",
    appliesTo: ["dev-feasibility"],
    inputType: "project-intake",
    stateKey: "projectType",
  },
  {
    id: "df-documents",
    title: "Which documents do you already have?",
    subtitle: "Optional: select what is ready today. The report will flag what may still be useful.",
    appliesTo: ["dev-feasibility"],
    inputType: "multi",
    stateKey: "documentsAvailable",
    options: DOCUMENT_READINESS_OPTIONS,
  },
  {
    id: "df-credits",
    title: "Which incentive pathways do you want to review?",
    subtitle: "We\u2019ve pre-selected pathways based on zone coverage. Add or remove as needed.",
    appliesTo: ["dev-feasibility"],
    inputType: "multi",
    stateKey: "creditsToAnalyze",
    options: CREDIT_OPTIONS,
  },
  {
    id: "df-review",
    title: "Review & Generate",
    subtitle: "Confirm your selections and generate your vacancy report.",
    appliesTo: ["dev-feasibility"],
    inputType: "review",
    stateKey: "reportType",
  },

  // ── Corridor Intelligence flow ───────────────────────────────────

  {
    id: "ci-corridor",
    title: "Which corridor geography?",
    subtitle: "V1 uses ZIP-based corridor metrics while neighborhood and district boundaries are added.",
    appliesTo: ["corridor-intelligence"],
    inputType: "single",
    stateKey: "neighborhood",
    options: [
      {
        id: "60617",
        label: "60617 — South Chicago / Calumet Area",
        description: "Good for Southeast corridor resilience and intervention testing.",
      },
      {
        id: "60619",
        label: "60619 — Chatham / Greater Grand Crossing Area",
        description: "Good for ownership, vacancy, and business activity comparison.",
      },
      {
        id: "60649",
        label: "60649 — South Shore / Woodlawn Area",
        description: "Good for lakefront corridor and commercial district signals.",
      },
    ],
  },
  {
    id: "ci-review",
    title: "Review & Generate",
    subtitle: "Generate a directional corridor intelligence report.",
    appliesTo: ["corridor-intelligence"],
    inputType: "review",
    stateKey: "reportType",
  },
];

// ─── Credit Auto-Suggestion ─────────────────────────────────────────

const ZONE_TO_CREDITS: Record<string, string[]> = {
  nrhpDistricts: ["nrhpDistricts"],
  landmarkDistricts: ["nrhpDistricts"],
  nmtcEligible: ["nmtcEligible"],
  federalOZ: ["federalOZ"],
  qct: ["qct"],
  tif: ["tif"],
  enterprise: ["enterprise"],
  edge: ["edge"],
};

/** Returns credit IDs to pre-check based on active zones at a location. */
export function suggestCreditsFromZones(
  zones: Record<string, boolean>
): string[] {
  const suggested = new Set<string>();
  // Always suggest these (no zone requirement)
  suggested.add("cpace");
  suggested.add("class7a");

  for (const [zoneKey, creditIds] of Object.entries(ZONE_TO_CREDITS)) {
    if (zones[zoneKey]) {
      for (const id of creditIds) suggested.add(id);
    }
  }
  return Array.from(suggested);
}

// ─── Helpers ────────────────────────────────────────────────────────

export function getStepsForReportType(type: ReportType): WizardStepConfig[] {
  return WIZARD_STEPS.filter((step) => step.appliesTo.includes(type));
}

export function getStepValue(
  state: WizardState,
  stepId: string,
): string | string[] {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return "";
  const value = state[step.stateKey];
  if (value === null) return "";
  return value as string | string[];
}

export function setStepValue(
  state: WizardState,
  stepId: string,
  value: string | string[],
): WizardState {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return state;
  return { ...state, [step.stateKey]: value };
}

export function setAddressValue(
  state: WizardState,
  address: string,
  lat: number | null,
  lon: number | null,
): WizardState {
  return { ...state, address, lat, lon };
}

export function getStepCount(type: ReportType): number {
  return getStepsForReportType(type).length;
}

export function getStepIndex(type: ReportType, stepId: string): number {
  return getStepsForReportType(type).findIndex((s) => s.id === stepId);
}

export function isStepComplete(
  state: WizardState,
  stepId: string,
): boolean {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return false;

  if (step.inputType === "review") return true;
  if (step.inputType === "report-type") return state.reportType !== null;

  // Address step: need address + coordinates
  if (step.inputType === "address") {
    return state.address.trim().length > 0 && state.lat !== null && state.lon !== null;
  }

  // Neighborhood step: need either a neighborhood OR a specific address
  if (step.inputType === "neighborhood") {
    const hasNeighborhood = state.neighborhood.trim().length > 0;
    const hasAddress = state.address.trim().length > 0 && state.lat !== null && state.lon !== null;
    return hasNeighborhood || hasAddress;
  }

  const value = state[step.stateKey];

  if (step.inputType === "project-intake") {
    return true;
  }

  if (step.id === "si-industry") return true;

  if (step.inputType === "single" || step.inputType === "combobox") {
    return typeof value === "string" && value.length > 0;
  }

  if (step.inputType === "multi") {
    if (step.id === "si-documents" || step.id === "df-documents") return true;
    return Array.isArray(value) && value.length > 0;
  }

  return false;
}

export function getReportTypeOption(
  type: ReportType,
): ReportTypeOption | undefined {
  return REPORT_TYPE_OPTIONS.find((opt) => opt.id === type);
}

/**
 * A saved wizard state is a location-only snapshot when it's a
 * site-incentives report generated with none of the refine-path inputs.
 * Used to re-offer "Refine" on saved Workspace reports (audit RF1: the
 * Workspace viewer never passed isInstantMode, so the refine CTA was dead
 * code on every saved snapshot).
 */
export function isSnapshotWizardState(
  state?: Partial<WizardState> | null,
): boolean {
  if (!state || state.reportType !== "site-incentives") return false;
  return (
    !state.industry &&
    !state.projectType &&
    !(state.projectGoals && state.projectGoals.length > 0) &&
    !state.customGoal &&
    !state.proposedUse &&
    !state.budgetRange &&
    !state.timeline &&
    !state.siteControl &&
    !state.jobsImpact &&
    !(state.documentsAvailable && state.documentsAvailable.length > 0) &&
    !(state.supportNeeded && state.supportNeeded.length > 0)
  );
}
