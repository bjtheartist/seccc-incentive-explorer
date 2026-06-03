import type { Program, ExecutiveSummary, ParcelData, DistrictData, StackingRule, CommunityAsset, Stats } from "./types";
import { isClass7aEligible } from "./parcel-classes";
import { ZONE_LABELS, ZONE_DESCRIPTIONS, describeZoneClass } from "./constants";
import { getIndustryById } from "./industries-data";
import { generateExecutiveSummary, computeStackingNarrative, runConfidenceEngine, isStaleProgramData } from "./confidence-engine";
import type { EligibilityConfidence, ProgramCheckResult } from "./types";
import { ZONE_LEARN_MORE } from "./constants";
import { censusNarrative, CHICAGO_MEDIANS } from "./census-narrative";
import {
  BUDGET_RANGE_OPTIONS,
  DOCUMENT_READINESS_OPTIONS,
  FUNDING_COMMITTED_OPTIONS,
  JOBS_IMPACT_OPTIONS,
  PROPOSED_USE_LABELS,
  PROJECT_TYPE_LABELS,
  REMAINING_GAP_OPTIONS,
  SITE_CONTROL_OPTIONS,
  SUPPORT_NEEDED_OPTIONS,
  TIMELINE_OPTIONS,
  optionLabel,
} from "./report-wizard-config";

// ─── Local Types ────────────────────────────────────────────────────

type ReportType =
  | "site-incentives"
  | "dev-feasibility"
  | "corridor-intelligence"
  // Legacy types kept for backward compatibility with shared URLs
  | "location-incentives"
  | "best-location"
  | "program-explorer"
  | "developer-analysis";

interface WizardState {
  reportType: ReportType | null;
  address: string;
  lat: number | null;
  lon: number | null;
  neighborhood: string;
  industry: string;
  budgetRange: string;
  projectType: string;
  proposedUse: string;
  fundingCommitted: string;
  remainingGap: string;
  timeline: string;
  siteControl: string;
  documentsAvailable: string[];
  jobsImpact: string;
  supportNeeded: string[];
  creditsToAnalyze: string[];
  // Legacy fields (kept for backward compat, unused in new flows)
  activities?: string[];
  incentiveInterests?: string[];
  locationPriorities?: string[];
  governmentLevels?: string[];
  benefitTypes?: string[];
}

// ─── Output Types ───────────────────────────────────────────────────

export interface ReportSection {
  title: string;
  description?: string;
  table?: {
    columns: string[];
    rows: string[][];
  };
  items: ReportItem[];
}

export interface ReportItem {
  label: string;
  value: string;
  detail?: string;
  programId?: string;
  color?: string;
  whoQualifies?: string;
  eligibilityRules?: { description: string; required: boolean }[];
  url?: string;
  level?: string;
  confidenceLevel?: EligibilityConfidence;
  confidenceLabel?: string;
  whyOneLine?: string;
  notVerified?: string[];
  matchedRules?: string[];
  lastVerifiedAt?: string | null;
  isStale?: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
  applicationPortals?: Program["applicationPortals"];
  verificationSteps?: Program["verificationSteps"];
  status?: Program["status"];
}

export interface DataSourceCitation {
  id: string;
  label: string;
  description: string;
  url?: string;
}

export interface NeighborhoodEconomicContext {
  geographyLabel?: string;
  businessContinuity?: {
    baselineYear?: number | null;
    comparisonYear?: number | null;
    baselineActive?: number | null;
    comparisonActive?: number | null;
    retained?: number | null;
    newSinceBaseline?: number | null;
    continuityRate?: number | null;
    sourceLabel?: string;
  };
  jobsPayroll?: {
    baselineYear?: number | null;
    comparisonYear?: number | null;
    baselineEstablishments?: number | null;
    comparisonEstablishments?: number | null;
    baselineEmployment?: number | null;
    comparisonEmployment?: number | null;
    employmentGrowthRate?: number | null;
    baselineAnnualPayroll?: number | null;
    comparisonAnnualPayroll?: number | null;
    payrollGrowthRate?: number | null;
    sourceLabel?: string;
  };
  spendingPower?: {
    residentSpendingPowerProxy?: number | null;
    medianHouseholdIncome?: number | null;
    population?: number | null;
    sourceLabel?: string;
  };
  reinvestment?: {
    permitCount?: number | null;
    reportedCost?: number | null;
    windowLabel?: string | null;
    sourceLabel?: string;
  };
  property?: {
    parcelCount?: number | null;
    vacantParcelCount?: number | null;
    commercialParcelCount?: number | null;
    industrialParcelCount?: number | null;
    distinctOwners?: number | null;
    localOwnershipShare?: number | null;
    assessedValueBaseline?: number | null;
    assessedValueComparison?: number | null;
    assessedValueChangeRate?: number | null;
    assessedValueYearBaseline?: number | null;
    assessedValueYearComparison?: number | null;
    sourceLabel?: string;
  };
  leakage?: {
    estimatedLeakageRate?: number | null;
    capturableDemand?: number | null;
    localCapacity?: number | null;
    assumptions?: string[];
    sourceLabel?: string;
  };
  multiplier?: {
    localOutputEstimateLow?: number | null;
    localOutputEstimateHigh?: number | null;
    multiplierLow?: number | null;
    multiplierHigh?: number | null;
    anchorDrivers?: string[];
    assumptions?: string[];
    sourceLabel?: string;
  };
  anchors?: Array<{
    name: string;
    type?: string;
    category?: string;
    totalScore?: number | null;
    impactTier?: string;
    confidence?: string;
    multiplierChannels?: string;
    rationale?: string;
    validationNeeded?: string;
    leakageCaveat?: string;
    sourceUrls?: string[];
  }>;
  anchorGeography?: string;
  limitations?: string[];
}

export interface BenefitEstimate {
  programId: string;
  programName: string;
  estimatedValue: number;
  label: string;
  color?: string;
}

export interface ActionRoadmapItem {
  tier: "do-this-week" | "start-gathering" | "worth-exploring";
  programId?: string;
  programName?: string;
  label: string;
  description: string;
  contact?: { agency: string; phone?: string; email?: string; role?: string };
  callScript?: string;
  documents?: string[];
}

export interface GeneratedReport {
  title: string;
  subtitle: string;
  reportType: ReportType;
  generatedAt: string;
  summary: string;
  sections: ReportSection[];
  recommendedActions: {
    label: string;
    description: string;
    priority: "high" | "medium" | "low";
  }[];
  metadata: {
    address?: string;
    lat?: number;
    lon?: number;
    industry?: string;
    budgetRange?: string;
    projectType?: string;
    proposedUse?: string;
    medianIncome?: number;
    medianHomeValue?: number;
    zoneClass?: string;
    zoneType?: string;
    corridorType?: string;
    corridorId?: string;
    corridorLabel?: string;
  };
  executiveSummary?: ExecutiveSummary;
  benefitEstimates?: {
    total: number;
    totalFormatted: string;
    budgetRange: string;
    items: BenefitEstimate[];
  };
  actionRoadmap?: ActionRoadmapItem[];
  verdict?: {
    signal: "strong" | "moderate" | "limited";
    headline: string;
    subheadline: string;
    topReasons: string[];
  };
  marketContext?: {
    incomeNarrative: string;
    homeValueNarrative: string;
    populationNarrative: string;
    walkabilityNarrative: string;
    zoneCoverageNarrative: string;
    qualificationNarrative: string;
    isQCT: boolean;
    isLMI: boolean;
    comparisons: {
      income?: { location: number; city: number; pct: number };
      homeValue?: { location: number; city: number; pct: number };
      population?: { location: number; city: number; pct: number };
      walkScore?: { location: number; city: number; pct: number };
    };
  };
  stackingAnalysis?: {
    narrative: string;
    percentileLabel: string;
    zoneCount: number;
    combinations: { zones: string[]; benefit: string }[];
    rules: { programA: string; programB: string; relationship: string; reason: string }[];
  };
  communityAssets?: {
    edos: { name: string; address: string }[];
    bsos: { name: string; address: string }[];
    narrative: string;
  };
  neighborhoodEconomics?: NeighborhoodEconomicContext;
  dataSources?: DataSourceCitation[];
}

// ─── Budget Median Mapping ──────────────────────────────────────────

const BUDGET_MEDIANS: Record<string, number> = {
  "Under $100K": 50_000,
  "$100K-$500K": 300_000,
  "$500K-$2M": 1_000_000,
  "$2M-$10M": 5_000_000,
  "Over $10M": 15_000_000,
  // Wizard step option IDs (kebab-case) mapped to same values
  "under-100k": 50_000,
  "100k-500k": 300_000,
  "500k-2m": 1_000_000,
  "2m-10m": 5_000_000,
  "over-10m": 15_000_000,
};

/**
 * Credit percentage assumptions per program type.
 * These are simplified estimates for reporting purposes.
 */
const CREDIT_PERCENTAGES: Record<string, { pct: number; label: string; cap?: number }> = {
  federalOZ: { pct: 0, label: "Tax deferral/exclusion depends on Qualified Opportunity Fund structure" },
  illinoisOZ: { pct: 0, label: "Illinois OZ record is a discovery/stacking reference, not a separate state credit" },
  tif: { pct: 0.25, label: "Up to 25% of rehab costs" },
  sbif: { pct: 0.9, label: "Up to 90% reimbursement; caps vary by property type", cap: 250_000 },
  enterprise: { pct: 0.1, label: "~10% via sales/utility tax exemptions" },
  edge: { pct: 0.1, label: "~10% income tax credit over agreement term" },
  rev: { pct: 0.2, label: "Up to 20% income tax credit" },
  micro: { pct: 0.2, label: "Up to 20% income tax credit" },
  dataCenter: { pct: 0.1, label: "~10% via sales tax exemptions on equipment" },
  cpace: { pct: 0.15, label: "~15% savings via long-term PACE financing" },
  class7a: { pct: 0.35, label: "~35% property tax reduction over 12 years" },
  landBank: { pct: 0.3, label: "~30% savings on discounted land acquisition" },
  highUnemployment: { pct: 0.08, label: "~8% via WOTC and workforce credits" },
  catalystGrant: { pct: 0.2, label: "Up to 20% grant on eligible costs" },
  nmtcEligible: { pct: 0.39, label: "Up to 39% NMTC over 7 years" },
  nrhpDistricts: { pct: 0.2, label: "20% Federal Historic Tax Credit" },
  landmarkDistricts: { pct: 0.1, label: "~10% local preservation incentive" },
  smallBizSource: { pct: 0, label: "Free advising (no direct credit)" },
  workforceSolutions: { pct: 0, label: "Training/upskilling grant; award size varies by NOFO and project" },
  ssa: { pct: 0.02, label: "~2% via shared marketing/services" },
};

// ─── Helpers ────────────────────────────────────────────────────────

export function formatDollars(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Estimate the dollar value of a credit program for a given budget range.
 */
export function estimateCreditValue(
  creditId: string,
  budgetRange: string,
): string {
  const median = BUDGET_MEDIANS[budgetRange];
  if (!median) return "Budget range not specified";

  const creditInfo = CREDIT_PERCENTAGES[creditId];
  if (!creditInfo || creditInfo.pct === 0) {
    return creditInfo?.label || "Contact for details";
  }

  const raw = median * creditInfo.pct;
  const capped = creditInfo.cap ? Math.min(raw, creditInfo.cap) : raw;
  const pctDisplay = Math.round(creditInfo.pct * 100);

  return `${pctDisplay}% of ${formatDollars(median)} = ${formatDollars(capped)}`;
}

function getIndustryName(industryId: string): string {
  const industry = getIndustryById(industryId);
  return industry?.name || industryId || "General Business";
}

/**
 * Check whether a program is relevant to a given industry.
 * Uses the INDUSTRIES data to see if the program appears in the industry's topPrograms.
 */
function isProgramRelevantToIndustry(
  program: Program,
  industryId: string,
): boolean {
  if (!industryId) return true;
  const industry = getIndustryById(industryId);
  if (!industry) return true; // Unknown industry — show everything
  // Citywide / discovery-only programs (no zone gate) are general-purpose by nature.
  // Don't industry-filter them out — they stay relevant across sectors.
  if (!program.zoneKey) return true;
  return industry.topPrograms.includes(program.id) || industry.topPrograms.includes(program.zoneKey);
}

const DOCUMENT_KEYWORDS: Record<string, string[]> = {
  "project-budget": ["budget", "cost", "estimate"],
  "scope-of-work": ["scope", "work", "project plan", "proposal"],
  "contractor-bids": ["bid", "contractor", "quote"],
  "ownership-or-lease": ["lease", "deed", "ownership", "owner", "property", "title", "site control"],
  "permits-drawings": ["permit", "drawing", "architect", "plan", "zoning"],
  "financial-statements": ["financial", "bank", "revenue", "income", "profit", "balance"],
  "tax-clearance": ["tax clearance", "tax certificate", "tax"],
  w9: ["w-9", "w9"],
  insurance: ["insurance", "certificate of insurance", "bond"],
  "hiring-projections": ["employee", "payroll", "workforce", "hire", "job"],
  "award-letters": ["award", "commitment", "grant agreement", "letter"],
  timeline: ["timeline", "schedule"],
};

function programsRequiringDocument(programs: Program[], docId: string): string[] {
  const keywords = DOCUMENT_KEYWORDS[docId] || [];
  if (keywords.length === 0) return [];

  return programs
    .filter((program) =>
      program.requiredDocs?.some((doc) => {
        const normalized = doc.toLowerCase();
        return keywords.some((keyword) => normalized.includes(keyword));
      })
    )
    .map((program) => program.name);
}

function buildProjectIntakeSection(state: WizardState): ReportSection | null {
  const items: ReportItem[] = [];
  const isVacancy = state.reportType === "dev-feasibility" || state.reportType === "best-location";

  if (state.projectType) {
    items.push({
      label: isVacancy ? "Project Focus" : "Project Type",
      value: PROJECT_TYPE_LABELS[state.projectType] || state.projectType,
    });
  }
  if (state.proposedUse) {
    items.push({
      label: "Proposed Use",
      value: PROPOSED_USE_LABELS[state.proposedUse] || state.proposedUse,
    });
  }
  if (isVacancy) {
    if (state.supportNeeded.length > 0) {
      const supportLabels = state.supportNeeded
        .map((id) => SUPPORT_NEEDED_OPTIONS.find((option) => option.id === id)?.label)
        .filter((label): label is string => Boolean(label));
      if (supportLabels.length > 0) {
        items.push({
          label: "Support Most Helpful",
          value: supportLabels.join(", "),
        });
      }
    }

    if (items.length === 0) return null;
    return {
      title: "Vacancy Project Intake",
      description: "Optional scoping answers used to tailor vacancy analysis and next-step language.",
      items,
    };
  }

  if (state.budgetRange) {
    items.push({
      label: "Total Project Budget",
      value: optionLabel([...BUDGET_RANGE_OPTIONS, { id: "skip", label: "Still estimating" }], state.budgetRange),
    });
  }
  if (state.fundingCommitted) {
    items.push({ label: "Funding Already Committed", value: optionLabel(FUNDING_COMMITTED_OPTIONS, state.fundingCommitted) });
  }
  if (state.remainingGap) {
    items.push({ label: "Remaining Gap", value: optionLabel(REMAINING_GAP_OPTIONS, state.remainingGap) });
  }
  if (state.timeline) {
    items.push({ label: "Timeline", value: optionLabel(TIMELINE_OPTIONS, state.timeline) });
  }
  if (state.siteControl) {
    items.push({ label: "Own vs. Lease", value: optionLabel(SITE_CONTROL_OPTIONS, state.siteControl) });
  }
  if (state.jobsImpact) {
    items.push({ label: "Jobs Created or Retained", value: optionLabel(JOBS_IMPACT_OPTIONS, state.jobsImpact) });
  }
  if (state.supportNeeded.length > 0) {
    const supportLabels = state.supportNeeded
      .map((id) => SUPPORT_NEEDED_OPTIONS.find((option) => option.id === id)?.label)
      .filter((label): label is string => Boolean(label));
    if (supportLabels.length > 0) {
      items.push({
        label: "Support Needed",
        value: supportLabels.join(", "),
      });
    }
  }

  if (items.length === 0) return null;
  return {
    title: "Project Intake",
    description: "Project-scoping answers used to tailor the screening, readiness checklist, and next steps.",
    items,
  };
}

function buildDocumentReadinessSection(programs: Program[], state: WizardState): ReportSection {
  const available = new Set(state.documentsAvailable.filter((id) => id !== "none-yet"));
  const items: ReportItem[] = DOCUMENT_READINESS_OPTIONS
    .filter((doc) => doc.id !== "none-yet")
    .map((doc) => {
      const requiringPrograms = programsRequiringDocument(programs, doc.id);
      const isReady = available.has(doc.id);
      return {
        label: doc.label,
        value: isReady ? "Ready" : requiringPrograms.length > 0 ? "May be needed" : "Good to have",
        detail:
          requiringPrograms.length > 0
            ? `Commonly requested for: ${requiringPrograms.slice(0, 4).join(", ")}${requiringPrograms.length > 4 ? ` and ${requiringPrograms.length - 4} more` : ""}.`
            : "No matched program requirement found in the current data, but this can still help during intake or advising.",
      };
    });

  return {
    title: "Document Readiness Checklist",
    description:
      "Practical document checklist based on your answers and the programs matched to this project. Marked items are not a guarantee of eligibility; they help prepare the next conversation.",
    items,
  };
}

function hasProjectReadinessContext(state: WizardState): boolean {
  return Boolean(
    state.projectType ||
      state.proposedUse ||
      state.budgetRange ||
      state.fundingCommitted ||
      state.remainingGap ||
      state.timeline ||
      state.siteControl ||
      state.jobsImpact ||
      state.supportNeeded.length > 0 ||
      state.documentsAvailable.length > 0
  );
}

/**
 * Address-confirmed matches are programs tied to a zone this address actually
 * falls inside. No-zone programs remain useful discovery/navigation items, but
 * they should not inflate location eligibility counts.
 */
function hasAddressZoneMatch(
  program: Program,
  zones?: Record<string, boolean>,
): boolean {
  return !!program.zoneKey && !!zones?.[program.zoneKey];
}

function filterAddressMatchedPrograms(
  programs: Program[],
  zones?: Record<string, boolean>,
): Program[] {
  if (!zones) return [];
  return programs.filter((p) => hasAddressZoneMatch(p, zones));
}

function filterDiscoveryPrograms(programs: Program[]): Program[] {
  return programs.filter((p) => !p.zoneKey);
}

function confidenceRank(confidence?: EligibilityConfidence): number {
  switch (confidence) {
    case "appears_eligible":
      return 0;
    case "location_eligible":
      return 1;
    case "may_qualify":
      return 2;
    case "worth_exploring":
      return 3;
    case "not_applicable":
      return 5;
    default:
      return 4;
  }
}

function programReportItem(
  program: Program,
  confidenceMap?: Map<string, ProgramCheckResult>,
): ReportItem {
  const cr = confidenceMap?.get(program.id);
  return {
    label: program.name,
    value: program.benefitRange || "Contact for details",
    detail: program.summary,
    programId: program.id,
    whoQualifies: program.whoQualifies,
    eligibilityRules: program.eligibilityRules?.map((r: { description: string; required: boolean }) => ({
      description: r.description,
      required: r.required,
    })),
    url: program.url,
    level: program.level,
    confidenceLevel: cr?.confidence,
    confidenceLabel: cr?.confidenceLabel,
    whyOneLine: cr?.whyOneLine,
    notVerified: cr?.notVerified,
    matchedRules: cr?.matchedRules,
    lastVerifiedAt: program.lastVerifiedAt,
    isStale: isStaleProgramData(program),
    sourceLabel: program.zoneKey ? (ZONE_LABELS[program.zoneKey] || program.zoneKey) : "Official source",
    sourceUrl: program.sourceUrl || (program.zoneKey ? ZONE_LEARN_MORE[program.zoneKey] : undefined),
    applicationPortals: program.applicationPortals,
    verificationSteps: program.verificationSteps,
    status: program.status,
  };
}

function sortProgramItems(
  programs: Program[],
  zones?: Record<string, boolean>,
  confidenceMap?: Map<string, ProgramCheckResult>,
): Program[] {
  return [...programs].sort((a, b) => {
    const zoneDiff = Number(!hasAddressZoneMatch(a, zones)) - Number(!hasAddressZoneMatch(b, zones));
    if (zoneDiff !== 0) return zoneDiff;
    const confidenceDiff = confidenceRank(confidenceMap?.get(a.id)?.confidence) - confidenceRank(confidenceMap?.get(b.id)?.confidence);
    if (confidenceDiff !== 0) return confidenceDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Group programs by government level.
 */
function groupByLevel(
  programs: Program[],
): Record<string, Program[]> {
  const groups: Record<string, Program[]> = {};
  for (const p of programs) {
    if (!groups[p.level]) groups[p.level] = [];
    groups[p.level].push(p);
  }
  return groups;
}

/**
 * Count how many active zones the user is in.
 */
function countActiveZones(zones?: Record<string, boolean>): number {
  if (!zones) return 0;
  return Object.values(zones).filter(Boolean).length;
}


// ─── Data Source Citations ──────────────────────────────────────────

const DATA_SOURCES: Record<string, DataSourceCitation> = {
  census: {
    id: "census",
    label: "U.S. Census Bureau",
    description: "American Community Survey 5-Year Estimates — median income, home value, population, and demographic indicators.",
    url: "https://data.census.gov",
  },
  zones: {
    id: "zones",
    label: "City of Chicago & Illinois DCEO",
    description: "Incentive zone boundaries including TIF districts, Enterprise Zones, Opportunity Zones, and state incentive areas.",
    url: "https://data.cityofchicago.org",
  },
  zoning: {
    id: "zoning",
    label: "Chicago ArcGIS MapServer",
    description: "Real-time zoning classification data from the City of Chicago GIS system.",
    url: "https://gisapps.chicago.gov/arcgis/rest/services",
  },
  parcel: {
    id: "parcel",
    label: "Cook County Assessor",
    description: "Property assessment records including PINs, class codes, assessed values, and building characteristics.",
    url: "https://www.cookcountyassessoril.gov",
  },
  zbp: {
    id: "zbp",
    label: "U.S. Census ZIP Business Patterns",
    description: "ZIP-level establishment, employment, and annual payroll signals for neighborhood economic context.",
    url: "https://www.census.gov/programs-surveys/cbp/data/datasets.html",
  },
  lehdLodes: {
    id: "lehdLodes",
    label: "U.S. Census LEHD/LODES",
    description: "Workplace and resident job-flow data planned for commute, wage-band, and employment context.",
    url: "https://lehd.ces.census.gov/data/",
  },
  buildingPermits: {
    id: "buildingPermits",
    label: "City of Chicago Building Permits",
    description: "Permit activity and reported-cost signals for neighborhood reinvestment context.",
    url: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
  },
  assessorValues: {
    id: "assessorValues",
    label: "Cook County Assessor Open Data",
    description: "Parcel universe, ownership, assessment, and value-change signals for property context.",
    url: "https://datacatalog.cookcountyil.gov/",
  },
};

function collectDataSources(ctx: ReportContext): DataSourceCitation[] {
  const sources: DataSourceCitation[] = [];
  if (ctx.census) sources.push(DATA_SOURCES.census);
  if (ctx.zones) sources.push(DATA_SOURCES.zones);
  if (ctx.cityZoning) sources.push(DATA_SOURCES.zoning);
  if (ctx.parcel) sources.push(DATA_SOURCES.parcel);
  if (ctx.neighborhoodEconomics?.jobsPayroll) sources.push(DATA_SOURCES.zbp);
  if (ctx.neighborhoodEconomics?.reinvestment) sources.push(DATA_SOURCES.buildingPermits);
  if (ctx.neighborhoodEconomics?.property) sources.push(DATA_SOURCES.assessorValues);
  return sources;
}

// ─── Builder Functions (Pyramid Principle) ──────────────────────────

/**
 * Compute a verdict signal from zone count, program count, QCT/LMI status.
 */
function computeVerdict(
  zones: Record<string, boolean> | undefined,
  programs: Program[],
  ctx: ReportContext,
): GeneratedReport["verdict"] {
  const zoneCount = zones ? Object.values(zones).filter(Boolean).length : 0;
  const eligible = filterAddressMatchedPrograms(programs, zones);
  const programCount = eligible.length;

  const censusResult = ctx.census?.medianIncome != null
    ? censusNarrative({
        tractId: ctx.census.tractId || "",
        medianIncome: ctx.census.medianIncome,
        medianHomeValue: ctx.census.medianHomeValue ?? null,
        population: ctx.census.population ?? null,
        walkScore: ctx.census.walkScore ?? null,
      })
    : null;
  const isQCT = censusResult?.isLikelyQCT || !!(zones?.qct);
  const isLMI = censusResult?.isLMI || false;

  const stacking = zones ? computeStackingNarrative(zones, ctx.zoneNames || {}) : null;
  const comboCount = stacking?.combinations.length || 0;

  let signal: "strong" | "moderate" | "limited";
  if (zoneCount >= 4 && programCount >= 5) signal = "strong";
  else if (zoneCount >= 2 && programCount >= 3) signal = "moderate";
  else signal = "limited";

  const headline =
    signal === "strong"
      ? "This location has strong incentive coverage"
      : signal === "moderate"
        ? "This location has moderate incentive coverage"
        : "This location has limited incentive coverage";

  const subheadline =
    signal === "strong"
      ? "Multiple overlapping zones create significant cost-offset opportunities."
      : signal === "moderate"
        ? "Several programs apply here — review eligibility to maximize benefits."
        : "Fewer zone-based programs, but county-wide options may still apply.";

  const topReasons: string[] = [];
  topReasons.push(`${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} at this location`);
  topReasons.push(`${programCount} program${programCount !== 1 ? "s" : ""} potentially available`);
  if (comboCount > 0) topReasons.push(`${comboCount} beneficial stacking combination${comboCount !== 1 ? "s" : ""} identified`);
  if (isQCT) topReasons.push("Located in a Qualified Census Tract — enhanced federal credits");
  if (isLMI && !isQCT) topReasons.push("Low-to-moderate income area — qualifies for place-based programs");

  return { signal, headline, subheadline, topReasons: topReasons.slice(0, 5) };
}

/**
 * Build market context narratives from census data + walkability + zone coverage.
 */
function buildMarketContext(
  ctx: ReportContext,
  zones: Record<string, boolean> | undefined,
): GeneratedReport["marketContext"] {
  if (!ctx.census?.medianIncome) return undefined;

  const cn = censusNarrative({
    tractId: ctx.census.tractId || "",
    medianIncome: ctx.census.medianIncome,
    medianHomeValue: ctx.census.medianHomeValue ?? null,
    population: ctx.census.population ?? null,
    walkScore: ctx.census.walkScore ?? null,
  });

  const walkScore = ctx.census.walkScore;
  const epaAttribution = " (Source: EPA Smart Location Database — scores land use diversity, intersection density, and transit proximity.)";
  let walkabilityNarrative = "Walkability data not available for this location.";
  if (walkScore != null) {
    if (walkScore >= 15) walkabilityNarrative = `EPA Walkability Index ${walkScore}/20 — highly walkable area with strong pedestrian infrastructure and transit access.${epaAttribution}`;
    else if (walkScore >= 10) walkabilityNarrative = `EPA Walkability Index ${walkScore}/20 — above average walkability with moderate transit access.${epaAttribution}`;
    else walkabilityNarrative = `EPA Walkability Index ${walkScore}/20 — car-dependent area; consider drive-in or destination-based business models.${epaAttribution}`;
  }

  const zoneCount = zones ? Object.values(zones).filter(Boolean).length : 0;
  let zoneCoverageNarrative: string;
  if (zoneCount >= 4) zoneCoverageNarrative = `With ${zoneCount} active incentive zones, this location is in a high-coverage area — established programs target this neighborhood for investment.`;
  else if (zoneCount >= 2) zoneCoverageNarrative = `${zoneCount} incentive zones overlap at this location, providing moderate program coverage.`;
  else if (zoneCount === 1) zoneCoverageNarrative = "One incentive zone covers this location. Broader non-zone programs supplement zone-based options.";
  else zoneCoverageNarrative = "No incentive zones overlap at this location. Broader non-zone programs may still be worth exploring.";

  // Build comparison data (location vs city)
  const comparisons: NonNullable<GeneratedReport["marketContext"]>["comparisons"] = {};
  if (ctx.census.medianIncome != null) {
    comparisons.income = {
      location: ctx.census.medianIncome,
      city: CHICAGO_MEDIANS.income,
      pct: Math.round((ctx.census.medianIncome / CHICAGO_MEDIANS.income) * 100),
    };
  }
  if (ctx.census.medianHomeValue != null) {
    comparisons.homeValue = {
      location: ctx.census.medianHomeValue,
      city: CHICAGO_MEDIANS.homeValue,
      pct: Math.round((ctx.census.medianHomeValue / CHICAGO_MEDIANS.homeValue) * 100),
    };
  }
  if (ctx.census.population != null) {
    comparisons.population = {
      location: ctx.census.population,
      city: CHICAGO_MEDIANS.populationPerTract,
      pct: Math.round((ctx.census.population / CHICAGO_MEDIANS.populationPerTract) * 100),
    };
  }
  if (walkScore != null) {
    comparisons.walkScore = {
      location: walkScore,
      city: CHICAGO_MEDIANS.walkScore,
      pct: Math.round((walkScore / CHICAGO_MEDIANS.walkScore) * 100),
    };
  }

  return {
    incomeNarrative: cn.incomeNarrative || "Income data not available.",
    homeValueNarrative: cn.homeValueNarrative || "Home value data not available.",
    populationNarrative: cn.populationNarrative || "Population data not available.",
    walkabilityNarrative,
    zoneCoverageNarrative,
    qualificationNarrative: cn.qualificationNarrative,
    isQCT: cn.isLikelyQCT,
    isLMI: cn.isLMI,
    comparisons,
  };
}

function formatChangeRate(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return "Not available";
  const pct = Math.round(Number(value) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function buildNeighborhoodEconomicContextSection(
  ctx: ReportContext,
  zones: Record<string, boolean> | undefined,
  marketContext?: GeneratedReport["marketContext"],
): ReportSection | undefined {
  if (!marketContext && !ctx.neighborhoodEconomics) return undefined;

  const cmp = marketContext?.comparisons ?? {};
  const items: ReportItem[] = [];
  const zoneCount = countActiveZones(zones);
  const economics = ctx.neighborhoodEconomics;
  const geographyLabel = economics?.geographyLabel || "this neighborhood";

  // ACS income/home/population are for the address's CENSUS TRACT. Business,
  // jobs, permit, parcel, spending-power, leakage, and multiplier figures below
  // are aggregated for the ZIP. Label each so the two geographies aren't
  // mistaken for the same place.
  if (marketContext?.incomeNarrative) {
    items.push({
      label: "Median Household Income",
      value: ctx.census?.medianIncome != null ? `Measured (census tract): $${ctx.census.medianIncome.toLocaleString()}` : "Measured: ACS context",
      // incomeNarrative already states the % of the city median — no extra suffix.
      detail: marketContext.incomeNarrative,
      sourceLabel: "American Community Survey (census tract)",
    });
  }

  if (marketContext?.homeValueNarrative) {
    const vs = cmp.homeValue ? ` (${cmp.homeValue.pct}% of city median $${cmp.homeValue.city.toLocaleString()})` : "";
    items.push({
      label: "Home Value Context",
      value: ctx.census?.medianHomeValue != null ? `Measured (census tract): $${ctx.census.medianHomeValue.toLocaleString()}` : "Measured: ACS context",
      detail: `${marketContext.homeValueNarrative}${vs}`,
      sourceLabel: "American Community Survey (census tract)",
    });
  }

  if (marketContext?.populationNarrative) {
    const vs = cmp.population ? ` (${cmp.population.pct}% of city avg ${cmp.population.city.toLocaleString()} per tract)` : "";
    items.push({
      label: "Population Base",
      value: ctx.census?.population != null ? `Measured (census tract): ${ctx.census.population.toLocaleString()} residents` : "Measured: ACS context",
      detail: `${marketContext.populationNarrative}${vs}`,
      sourceLabel: "American Community Survey (census tract)",
    });
  }

  if (marketContext) {
    const vs = cmp.walkScore ? ` (city avg: ${cmp.walkScore.city}/20)` : "";
    items.push({
      label: "Access & Walkability",
      value: ctx.census?.walkScore != null ? `Measured: ${ctx.census.walkScore}/20` : "Measured: not available",
      detail: `${marketContext.walkabilityNarrative}${vs}`,
      sourceLabel: "EPA Smart Location Database",
    });
    items.push({
      label: "Incentive Coverage",
      value: `Measured: ${zoneCount} zone${zoneCount !== 1 ? "s" : ""}`,
      detail: marketContext.zoneCoverageNarrative,
      sourceLabel: "Incentive zone boundary lookup",
    });
    if (marketContext.qualificationNarrative && (marketContext.isQCT || marketContext.isLMI)) {
      items.push({
        label: "Neighborhood Qualification",
        value: marketContext.isQCT ? "Modeled / needs verification: likely QCT income range" : "Modeled / needs verification: likely LMI range",
        detail: marketContext.qualificationNarrative,
        sourceLabel: "ACS income vs. modeled HUD thresholds — verify on the official HUD QCT list",
      });
    }
  }

  const continuity = economics?.businessContinuity;
  if (continuity) {
    const years = continuity.baselineYear && continuity.comparisonYear
      ? `${continuity.baselineYear}-${continuity.comparisonYear}`
      : "measured window";
    const counts = [
      continuity.baselineActive != null ? `${formatNumber(continuity.baselineActive)} active at baseline` : null,
      continuity.comparisonActive != null ? `${formatNumber(continuity.comparisonActive)} active at comparison` : null,
      continuity.retained != null ? `${formatNumber(continuity.retained)} retained` : null,
      continuity.newSinceBaseline != null ? `${formatNumber(continuity.newSinceBaseline)} new since baseline` : null,
    ].filter(Boolean).join("; ");
    items.push({
      label: "Business Continuity",
      value: continuity.continuityRate != null ? `Measured public record: ${formatRate(continuity.continuityRate)} retained signal` : "Measured public record: license activity",
      detail: `Business continuity is calculated from license records across the ${years}. ${counts || "Counts are not available in this report context."} This is a license-based signal, not proof that a specific business closed, moved, or stayed at one exact storefront.`,
      sourceLabel: continuity.sourceLabel || "Chicago business licenses",
    });
  } else {
    items.push({
      label: "Business Continuity",
      value: "Measured public record (loads with license history)",
      detail: "The continuity score compares active business-license entities in a baseline year with active entities in a later year. It should be read as a neighborhood-level continuity signal, not a verified closure list.",
      sourceLabel: "Chicago business licenses",
    });
  }

  const jobsPayroll = economics?.jobsPayroll;
  if (jobsPayroll) {
    const years = jobsPayroll.baselineYear && jobsPayroll.comparisonYear
      ? `${jobsPayroll.baselineYear}-${jobsPayroll.comparisonYear}`
      : "available ZBP years";
    const details = [
      jobsPayroll.baselineEstablishments != null || jobsPayroll.comparisonEstablishments != null
        ? `establishments: ${formatNumber(jobsPayroll.baselineEstablishments)} to ${formatNumber(jobsPayroll.comparisonEstablishments)}`
        : null,
      jobsPayroll.baselineEmployment != null || jobsPayroll.comparisonEmployment != null
        ? `employment: ${formatNumber(jobsPayroll.baselineEmployment)} to ${formatNumber(jobsPayroll.comparisonEmployment)}`
        : null,
      jobsPayroll.baselineAnnualPayroll != null || jobsPayroll.comparisonAnnualPayroll != null
        ? `annual payroll: ${formatMoneyShort(jobsPayroll.baselineAnnualPayroll)} to ${formatMoneyShort(jobsPayroll.comparisonAnnualPayroll)}`
        : null,
    ].filter(Boolean).join("; ");
    const benchmarkYears = jobsPayroll.baselineYear && jobsPayroll.comparisonYear
      ? ` (${jobsPayroll.baselineYear}–${jobsPayroll.comparisonYear})`
      : "";
    items.push({
      label: "Jobs & Payroll",
      value: `Benchmark${benchmarkYears}: jobs ${formatChangeRate(jobsPayroll.employmentGrowthRate)} / payroll ${formatChangeRate(jobsPayroll.payrollGrowthRate)}`,
      detail: `Census ZIP Business Patterns provides establishment, employment, and annual payroll context for ${geographyLabel} across ${years}. ${details || "The report has a ZBP source record but incomplete values."} ZBP is the latest official jobs/payroll benchmark, not a 2024 current-condition figure; read it as a trend benchmark.`,
      sourceLabel: jobsPayroll.sourceLabel || "Census ZIP Business Patterns",
      sourceUrl: DATA_SOURCES.zbp.url,
      confidenceLabel: "Source",
    });
  } else {
    items.push({
      label: "Jobs & Payroll",
      value: "Benchmark when ZBP geography is matched",
      detail: "Census ZIP Business Patterns can add establishment counts, employment, and annual payroll by ZIP. This report does not yet have a matched ZBP record for the address context.",
      sourceLabel: "Census ZIP Business Patterns",
      sourceUrl: DATA_SOURCES.zbp.url,
      confidenceLabel: "Source",
    });
  }

  const spendingPower = economics?.spendingPower;
  if (spendingPower?.residentSpendingPowerProxy != null) {
    items.push({
      label: "Resident Spending-Power Proxy",
      value: `Modeled / needs verification (${geographyLabel}): ${formatMoneyShort(spendingPower.residentSpendingPowerProxy)}`,
      detail: `This proxy estimates total annual purchasing capacity across ${geographyLabel} (resident households × income). It is a ZIP-wide figure — not the census-tract income above, and not actual sales captured by local businesses.`,
      sourceLabel: spendingPower.sourceLabel || "ACS-derived model",
    });
  }

  const reinvestment = economics?.reinvestment;
  if (reinvestment) {
    const permitValue = reinvestment.permitCount != null ? `${formatNumber(reinvestment.permitCount)} permits` : "permit count not available";
    const reportedCost = reinvestment.reportedCost != null ? `${formatMoneyShort(reinvestment.reportedCost)} reported cost` : "reported cost not available";
    items.push({
      label: "Reinvestment Signals",
      value: `Measured public record: ${permitValue}`,
      detail: `Building permit activity shows visible reinvestment where permits are filed. Current read for ${geographyLabel}: ${reportedCost}${reinvestment.windowLabel ? ` during ${reinvestment.windowLabel}` : ""}. Reported cost is applicant-reported and should be treated as directional.`,
      sourceLabel: reinvestment.sourceLabel || "City of Chicago Building Permits",
      sourceUrl: DATA_SOURCES.buildingPermits.url,
      confidenceLabel: "Source",
    });
  } else {
    items.push({
      label: "Reinvestment Signals",
      value: "Measured public record (loads with permit history)",
      detail: "Building permits can show where visible reinvestment is happening, including reported project cost and permit volume. This address report is not yet carrying the permit-history signal.",
      sourceLabel: "City of Chicago Building Permits",
      sourceUrl: DATA_SOURCES.buildingPermits.url,
      confidenceLabel: "Source",
    });
  }

  const property = economics?.property;
  if (property) {
    const ownerSignal = property.distinctOwners != null
      ? `${formatNumber(property.distinctOwners)} distinct owner records`
      : property.parcelCount != null
        ? `${formatNumber(property.parcelCount)} parcels`
        : "parcel context loaded";
    const valueYears = property.assessedValueYearBaseline && property.assessedValueYearComparison
      ? ` (${property.assessedValueYearBaseline}→${property.assessedValueYearComparison})`
      : "";
    const valueSignal = property.assessedValueComparison != null
      ? `total certified assessed value${valueYears}: ${property.assessedValueBaseline != null ? `${formatMoneyShort(property.assessedValueBaseline)} → ` : ""}${formatMoneyShort(property.assessedValueComparison)}${property.assessedValueChangeRate != null ? ` (${formatChangeRate(property.assessedValueChangeRate)})` : ""}`
      : null;
    const propertyMix = [
      valueSignal,
      property.vacantParcelCount != null ? `${formatNumber(property.vacantParcelCount)} vacant-class parcels` : null,
      property.commercialParcelCount != null ? `${formatNumber(property.commercialParcelCount)} commercial parcels` : null,
      property.industrialParcelCount != null ? `${formatNumber(property.industrialParcelCount)} industrial parcels` : null,
      property.localOwnershipShare != null ? `${formatRate(property.localOwnershipShare)} local/private ownership signal` : null,
    ].filter(Boolean).join("; ");
    const headlineValue = property.assessedValueChangeRate != null
      ? `Measured public record (${geographyLabel}): assessed value ${formatChangeRate(property.assessedValueChangeRate)}`
      : `Measured public record (${geographyLabel}): ${ownerSignal}`;
    const valueYearSpan = property.assessedValueYearBaseline && property.assessedValueYearComparison
      ? `between ${property.assessedValueYearBaseline} and ${property.assessedValueYearComparison}`
      : "over time";
    items.push({
      label: "Property Ownership / Value Change",
      value: headlineValue,
      detail: `Cook County assessed-value records show how the public property assessment for ${geographyLabel} changed ${valueYearSpan} (${propertyMix || "parcel and assessed-value aggregates"}). This is a useful public-record signal for property context, but it is not the same as sale price, private market value, or owner equity — large changes may reflect reassessment cycles, appeals, property improvements, classification changes, or updated assessor methodology. ZIP-level totals only; no owner names or addresses are shown.`,
      sourceLabel: property.sourceLabel || "Cook County Assessor / parcel records",
      sourceUrl: DATA_SOURCES.assessorValues.url,
      confidenceLabel: "Source",
    });
  } else if (ctx.parcel?.totalValue) {
    items.push({
      label: "Property Ownership / Value Change",
      value: "Measured: site-level assessment",
      detail: `This report includes a site-level assessed value from Cook County, but not neighborhood ownership concentration or historical value-change yet. Current site value: ${ctx.parcel.totalValue}.`,
      sourceLabel: "Cook County Assessor",
    });
  } else {
    items.push({
      label: "Property Ownership / Value Change",
      value: "Measured when assessor history is loaded",
      detail: "Cook County parcel, sales, and assessed-value history can add ownership and value-change context. Sensitive owner/address-level details should stay out of public reports unless reviewed with partners.",
      sourceLabel: "Cook County Assessor open data",
      sourceUrl: DATA_SOURCES.assessorValues.url,
      confidenceLabel: "Source",
    });
  }

  // Local retail demand: we estimate the defensible demand figure, not a
  // misleading capture/leakage rate (mirrors the web card).
  const leakage = economics?.leakage;
  if (leakage?.capturableDemand != null) {
    items.push({
      label: "Local Retail Demand",
      value: `Modeled / needs verification: ${formatMoneyShort(leakage.capturableDemand)}/yr`,
      detail: `Resident spending that local retail, food, and personal-services businesses in ${geographyLabel} could capture — modeled as ~32% of aggregate resident income (ACS). How much actually stays local vs. leaks out needs retail-category sales data we don't yet have, so we don't publish a capture or leakage rate.`,
      sourceLabel: leakage.sourceLabel || "Modeled from ACS spending power",
    });
  } else {
    items.push({
      label: "Local Retail Demand",
      value: "Modeled / needs verification",
      detail: "Locally-servable resident demand (and any spending leakage) is modeled from spending power and local business capacity. This report is missing the spending-power inputs needed to model it.",
    });
  }

  const multiplier = economics?.multiplier;
  if (multiplier?.localOutputEstimateLow != null && multiplier.localOutputEstimateHigh != null) {
    const drivers = multiplier.anchorDrivers && multiplier.anchorDrivers.length > 0
      ? ` Likely local drivers: ${multiplier.anchorDrivers.join(", ")}.`
      : "";
    items.push({
      label: "Multiplier Potential",
      value: `Modeled / needs verification: ${formatMoneyShort(multiplier.localOutputEstimateLow)}–${formatMoneyShort(multiplier.localOutputEstimateHigh)} local output`,
      detail: `Estimates the local economic output a neighborhood's businesses support — a function of who employs the most, who generates the most revenue, and who re-spends locally / draws outside demand / stays put.${drivers} ${(multiplier.assumptions ?? []).join(" ")}`,
      sourceLabel: multiplier.sourceLabel || "Scenario-planning estimate",
    });
  } else {
    items.push({
      label: "Multiplier Potential",
      value: "Modeled / needs verification",
      detail: "Multiplier potential estimates which assets or project types could increase local economic output. It should be framed as a scenario-planning tool, not a guaranteed job, sales, or tax-revenue impact.",
    });
  }

  // Anchors render in their own dedicated section (buildLocalImpactAnchorsSection).
  // Limitations are consolidated into a single concise note rather than a stack
  // of rows; the web report shows it as one footnote.
  items.push({
    label: "How to read this",
    value: "Context, not proof",
    detail:
      "Figures are ZIP-level aggregates for context — not address-level proof. License continuity is a neighborhood signal, not a closure list; ZIP Business Patterns is a 2020–2023 benchmark, not current-year; spending power, leakage, and multiplier are modeled estimates to verify with partners.",
  });

  return {
    title: "Neighborhood Economic Context",
    description: "Market, workforce, property, and spending-power signals for this location — labeled measured, modeled, or benchmark.",
    items,
  };
}

/**
 * Local Impact Anchors — a dedicated section naming the curated, source-cited
 * anchor businesses for the community area. Rendered as cards in the web report.
 */
function buildLocalImpactAnchorsSection(ctx: ReportContext): ReportSection | undefined {
  const anchors = ctx.neighborhoodEconomics?.anchors;
  if (!anchors || anchors.length === 0) return undefined;

  const items: ReportItem[] = anchors.map((a) => ({
    label: a.name,
    value: [a.totalScore != null ? `Score ${a.totalScore}` : null, a.impactTier].filter(Boolean).join(" · ") || "Anchor",
    detail: a.rationale || a.type || "",
    sourceLabel: a.type,
    sourceUrl: a.sourceUrls && a.sourceUrls.length > 0 ? a.sourceUrls[0] : undefined,
  }));

  return {
    title: "Local Impact Anchors",
    description: "Local Impact Anchors are institutions, employers, and destination clusters that can shape neighborhood activity. They help point to where jobs, visitors, training pathways, purchasing, partnerships, and local business demand may already be concentrated.",
    items,
  };
}

/**
 * Build stacking analysis from computeStackingNarrative + real stacking rules.
 */
function buildStackingAnalysis(
  zones: Record<string, boolean> | undefined,
  zoneNames: Record<string, string> | undefined,
  eligibleProgramIds: string[],
  stackingRules?: StackingRule[],
): GeneratedReport["stackingAnalysis"] {
  if (!zones) return undefined;

  const stacking = computeStackingNarrative(zones, zoneNames || {});

  const combinations = stacking.combinations.map((c) => ({
    zones: c.zones,
    benefit: c.benefit,
  }));

  // Filter stacking rules to only those between eligible programs
  const rules: GeneratedReport["stackingAnalysis"] extends undefined ? never : NonNullable<GeneratedReport["stackingAnalysis"]>["rules"] = [];
  if (stackingRules) {
    for (const rule of stackingRules) {
      if (eligibleProgramIds.includes(rule.programId) && eligibleProgramIds.includes(rule.otherProgramId)) {
        rules.push({
          programA: rule.programId,
          programB: rule.otherProgramId,
          relationship: rule.relationship,
          reason: rule.reason,
        });
      }
    }
  }

  return {
    narrative: stacking.narrative,
    percentileLabel: stacking.percentileLabel,
    zoneCount: stacking.zoneCount,
    combinations,
    rules,
  };
}

/**
 * Build community assets section from EDOs/BSOs.
 */
function buildCommunityAssets(
  assets?: CommunityAsset[],
): GeneratedReport["communityAssets"] {
  if (!assets || assets.length === 0) return undefined;

  const edos = assets.filter((a) => a.type === "EDO").map((a) => ({ name: a.name, address: a.address }));
  const bsos = assets.filter((a) => a.type === "BSO").map((a) => ({ name: a.name, address: a.address }));

  if (edos.length === 0 && bsos.length === 0) return undefined;

  const parts: string[] = [];
  if (edos.length > 0) parts.push(`${edos.length} economic development organization${edos.length !== 1 ? "s" : ""}`);
  if (bsos.length > 0) parts.push(`${bsos.length} business support organization${bsos.length !== 1 ? "s" : ""}`);
  const narrative = `${parts.join(" and ")} serve your area and can provide free advising, application assistance, and connections to funding.`;

  return { edos, bsos, narrative };
}

// ─── Report Generators ──────────────────────────────────────────────

function generateLocationIncentives(
  state: WizardState,
  programs: Program[],
  ctx: ReportContext = {},
): GeneratedReport {
  const { zones, zoneNames } = ctx;
  const addressMatched = filterAddressMatchedPrograms(programs, zones);
  const discoveryPrograms = filterDiscoveryPrograms(programs);
  const eligible = [...addressMatched, ...discoveryPrograms];
  const industryRelevant = state.industry
    ? eligible.filter((p) => isProgramRelevantToIndustry(p, state.industry))
    : eligible;

  // Split into address-confirmed and discovery-only programs.
  const zoneBased = industryRelevant.filter((p) => p.zoneKey && zones?.[p.zoneKey]);
  const discoveryOnly = industryRelevant.filter((p) => !p.zoneKey);

  const zoneCount = countActiveZones(zones);

  // ── Confidence engine (run once, reuse for exec summary) ──
  const confidenceResults = zones
    ? runConfidenceEngine(programs, zones, zoneNames || {}, undefined, ctx.parcel)
    : [];
  const confidenceMap = new Map<string, ProgramCheckResult>();
  for (const r of confidenceResults) confidenceMap.set(r.programId, r);
  const confirmedPrograms = sortProgramItems(zoneBased, zones, confidenceMap);
  const exploratoryPrograms = sortProgramItems(discoveryOnly, zones, confidenceMap);

  // ── Builder outputs ──
  const verdict = computeVerdict(zones, programs, ctx);
  const marketContext = buildMarketContext(ctx, zones);
  const eligibleIds = confirmedPrograms.map((p) => p.id);
  const stackingAnalysis = buildStackingAnalysis(zones, zoneNames, eligibleIds, ctx.stackingRules);
  const communityAssetsData = buildCommunityAssets(ctx.communityAssets);
  const dataSources = collectDataSources(ctx);

  // ── Sections: Overview → Market → Stacking → Programs → Documents → Support → Next Steps ──
  const sections: ReportSection[] = [];
  const projectIntakeSection = buildProjectIntakeSection(state);
  if (projectIntakeSection) sections.push(projectIntakeSection);

  // §01 Neighborhood Economic Context
  const neighborhoodEconomicSection = buildNeighborhoodEconomicContextSection(ctx, zones, marketContext);
  if (neighborhoodEconomicSection) sections.push(neighborhoodEconomicSection);
  const localImpactAnchorsSection = buildLocalImpactAnchorsSection(ctx);
  if (localImpactAnchorsSection) sections.push(localImpactAnchorsSection);

  // §02 Incentive Density & Stacking
  if (stackingAnalysis) {
    const stackingItems: ReportItem[] = [];
    stackingItems.push({ label: "Incentive Density", value: stackingAnalysis.percentileLabel, detail: stackingAnalysis.narrative });
    for (const combo of stackingAnalysis.combinations) {
      stackingItems.push({ label: combo.zones.join(" + "), value: "Can stack", detail: combo.benefit });
    }
    for (const rule of stackingAnalysis.rules) {
      stackingItems.push({ label: `${rule.programA} + ${rule.programB}`, value: rule.relationship === "can" ? "Can stack" : rule.relationship === "cannot" ? "Cannot stack" : "Conditional", detail: rule.reason });
    }
    if (stackingItems.length > 0) {
      sections.push({
        title: "Incentive Density & Stacking",
        description: "How your overlapping incentive zones compare to other Chicago locations and which programs can be combined.",
        items: stackingItems,
      });
    }
  }

  // §03 Eligible Incentive Programs — address-confirmed by zone match
  if (confirmedPrograms.length > 0) {
    sections.push({
      title: "Eligible Incentive Programs",
      description: "Programs matched to this address through active incentive-zone boundaries, ordered by eligibility confidence.",
      items: confirmedPrograms.map((p) => programReportItem(p, confidenceMap)),
    });
  }

  if (exploratoryPrograms.length > 0) {
    sections.push({
      title: "Additional Programs to Explore",
      description: "Programs not confirmed by this address alone, but useful as official next steps based on your profile.",
      items: exploratoryPrograms.slice(0, 8).map((p) => programReportItem(p, confidenceMap)),
    });
  }

  // §04 Required Documents (categorized, with program attribution) — inserted before Support Network
  {
    // Build a map: document → { category, programs[] }
    const docMap: Record<string, { category: string; programs: Set<string> }> = {};
    for (const p of confirmedPrograms) {
      for (const doc of p.requiredDocs) {
        let category = "General";
        const dl = doc.toLowerCase();
        if (dl.includes("tax") || dl.includes("financial") || dl.includes("bank") || dl.includes("revenue") || dl.includes("income") || dl.includes("profit")) category = "Financial & Tax";
        else if (dl.includes("license") || dl.includes("permit") || dl.includes("certificate") || dl.includes("registration") || dl.includes("incorporation") || dl.includes("articles")) category = "Business Registration";
        else if (dl.includes("lease") || dl.includes("deed") || dl.includes("property") || dl.includes("title") || dl.includes("survey") || dl.includes("parcel")) category = "Property & Site";
        else if (dl.includes("plan") || dl.includes("proposal") || dl.includes("scope") || dl.includes("budget") || dl.includes("estimate") || dl.includes("project")) category = "Project Plans";
        else if (dl.includes("employee") || dl.includes("payroll") || dl.includes("workforce") || dl.includes("hire") || dl.includes("job")) category = "Workforce";
        else if (dl.includes("insurance") || dl.includes("bond")) category = "Insurance & Compliance";
        if (!docMap[doc]) docMap[doc] = { category, programs: new Set() };
        docMap[doc].programs.add(p.name);
      }
    }
    // Group by category
    const grouped: Record<string, { doc: string; programs: string[] }[]> = {};
    for (const [doc, { category, programs }] of Object.entries(docMap)) {
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push({ doc, programs: Array.from(programs) });
    }
    const categoryEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
    if (categoryEntries.length > 0) {
      const docItems: ReportItem[] = categoryEntries.map(([cat, docs]) => ({
        label: cat,
        value: `${docs.length} document${docs.length !== 1 ? "s" : ""}`,
        detail: docs.map((d) => `${d.doc} — ${d.programs.join(", ")}`).join("\n"),
      }));
      sections.push({
        title: "Required Documents",
        description: `${Object.keys(docMap).length} documents across address-confirmed programs, organized by category. Each document lists which program(s) require it.`,
        items: docItems,
      });
    }
  }

  if (hasProjectReadinessContext(state)) {
    sections.push(buildDocumentReadinessSection(confirmedPrograms, state));
  }

  // §05 Your Support Network
  if (communityAssetsData) {
    const assetItems: ReportItem[] = [];
    assetItems.push({ label: "Community Support", value: `${communityAssetsData.edos.length + communityAssetsData.bsos.length} organizations`, detail: communityAssetsData.narrative });
    for (const edo of communityAssetsData.edos) {
      assetItems.push({ label: edo.name, value: "EDO", detail: edo.address });
    }
    for (const bso of communityAssetsData.bsos) {
      assetItems.push({ label: bso.name, value: "BSO", detail: bso.address });
    }
    sections.push({
      title: "Your Support Network",
      description: "Local organizations that provide free advising and application assistance.",
      items: assetItems,
    });
  }

  // ── Benefit Estimates ──────────────────────────────────────────────
  let benefitEstimates: GeneratedReport["benefitEstimates"] | undefined;

  if (state.budgetRange) {
    const budgetMedian = BUDGET_MEDIANS[state.budgetRange];
    if (budgetMedian) {
      let totalEstimate = 0;
      const items: BenefitEstimate[] = [];

      for (const p of confirmedPrograms) {
        const creditInfo = CREDIT_PERCENTAGES[p.id];
        if (!creditInfo || creditInfo.pct === 0) continue;
        const raw = budgetMedian * creditInfo.pct;
        const capped = creditInfo.cap ? Math.min(raw, creditInfo.cap) : raw;
        totalEstimate += capped;
        items.push({
          programId: p.id,
          programName: p.name,
          estimatedValue: capped,
          label: creditInfo.label,
          
        });
      }

      if (items.length > 0) {
        benefitEstimates = {
          total: totalEstimate,
          totalFormatted: formatDollars(totalEstimate),
          budgetRange: state.budgetRange,
          items,
        };
      }
    }
  }

  // ── Action Roadmap ("Your Next Steps") ──────────────────────────
  const actionRoadmap: ActionRoadmapItem[] = [];
  const topPrograms = confirmedPrograms.slice(0, 2);

  // Tier 1: "Do This Week" — top 2 programs with full contact + call script
  for (const p of topPrograms) {
    const contact = p.contacts?.[0];
    const addressDisplay = state.address || "my address";
    const zoneName = p.zoneKey ? (zoneNames?.[p.zoneKey] || ZONE_LABELS[p.zoneKey] || p.zoneKey) : "";
    const callScript = contact
      ? `"Hi, I'm at ${addressDisplay}${zoneName ? ` in ${zoneName}` : ""}. I'd like to learn about ${p.name} for my ${getIndustryName(state.industry).toLowerCase()}${getIndustryName(state.industry).toLowerCase().includes("business") ? "" : " business"}."`
      : undefined;

    actionRoadmap.push({
      tier: "do-this-week",
      programId: p.id,
      programName: p.name,
      label: p.fastestConfirmingStep || `Contact ${contact?.agency || "program administrator"} about ${p.name}`,
      description: p.summary,
      contact: contact ? { agency: contact.agency, phone: contact.phone, email: contact.email, role: contact.role } : undefined,
      callScript,
    });
  }

  // Tier 3: "Worth Exploring" — remaining programs beyond top 2
  const lowerPriority = [...confirmedPrograms.slice(2), ...exploratoryPrograms].slice(0, 3);
  for (const p of lowerPriority) {
    const contact = p.contacts?.[0];
    actionRoadmap.push({
      tier: "worth-exploring",
      programId: p.id,
      programName: p.name,
      label: `Explore ${p.name}`,
      description: p.summary,
      contact: contact ? { agency: contact.agency, phone: contact.phone, email: contact.email, role: contact.role } : undefined,
    });
  }

  // Recommended actions
  const recommendedActions: GeneratedReport["recommendedActions"] = topPrograms.map(
    (p) => ({
      label: `Apply for ${p.name}`,
      description:
        p.fastestConfirmingStep ||
        `Contact the program administrator to begin the ${p.name} application process.`,
      priority: "high" as const,
    }),
  );

  recommendedActions.push({
    label: "Book free business advising",
    description:
      "Schedule a free session with Cook County Small Business Source or SECCC to review all options.",
    priority: "medium",
  });

  if (topPrograms.length < 2 && exploratoryPrograms.length > 0) {
    recommendedActions.splice(recommendedActions.length - 1, 0, {
      label: `Explore ${exploratoryPrograms[0].name}`,
      description: exploratoryPrograms[0].summary,
      priority: "medium",
    });
  }

  const addressDisplay = state.address || "your location";
  const stackingContext = stackingAnalysis
    ? ` Your ${stackingAnalysis.zoneCount}-zone overlap places you in the ${stackingAnalysis.percentileLabel} of Chicago locations for incentive density.`
    : "";
  const dollarSummary = benefitEstimates
    ? ` Based on a ${state.budgetRange} budget, we estimate ~${benefitEstimates.totalFormatted} in total potential incentives.`
    : "";

  return {
    title: `Site Incentive Analysis — ${addressDisplay}`,
    subtitle: `Location-based analysis for ${getIndustryName(state.industry)}`,
    reportType: "location-incentives",
    generatedAt: new Date().toISOString(),
    summary: `${verdict?.headline || "Incentive analysis complete"}. Your address at ${addressDisplay} falls within ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""}, matching ${confirmedPrograms.length} address-confirmed program${confirmedPrograms.length !== 1 ? "s" : ""}.${exploratoryPrograms.length > 0 ? ` ${exploratoryPrograms.length} additional program${exploratoryPrograms.length !== 1 ? "s" : ""} appear as discovery next steps.` : ""}${stackingContext}${dollarSummary} The sections below are organized from key findings to detailed evidence.`,
    sections,
    recommendedActions: recommendedActions.slice(0, 4),
    metadata: {
      address: state.address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      industry: getIndustryName(state.industry),
      budgetRange: state.budgetRange || undefined,
      projectType: state.projectType || undefined,
    },
    benefitEstimates,
    actionRoadmap,
    verdict,
    marketContext,
    stackingAnalysis,
    communityAssets: communityAssetsData,
    dataSources,
  };
}

function generateBestLocation(
  state: WizardState,
  programs: Program[],
  ctx: ReportContext = {},
): GeneratedReport {
  const { zones, zoneNames, parcel, cityZoning } = ctx;
  const projectType = state.projectType || "acquisition";
  const projectLabels: Record<string, string> = {
    acquisition: "Acquisition & Hold",
    "rehab": "Rehabilitation / Renovation",
    "expansion": "Expansion",
    "new-construction": "New Construction",
    "mixed-use": "Mixed-Use Development",
    "mixed-use-conversion": "Mixed-Use Development",
    "affordable-housing": "Affordable Housing",
    "vacant-acquisition": "Acquire Vacant Property",
  };
  const projectLabel = projectLabels[projectType] || projectType;
  const address = state.address || state.neighborhood || "Selected Site";

  const activeZones = zones
    ? Object.entries(zones).filter(([, v]) => v).map(([k]) => k)
    : [];
  const zoneCount = activeZones.length;

  // ── Confidence engine ──
  const confidenceResults = zones
    ? runConfidenceEngine(programs, zones, zoneNames || {}, undefined, ctx.parcel)
    : [];
  const confidenceMap = new Map<string, ProgramCheckResult>();
  for (const r of confidenceResults) confidenceMap.set(r.programId, r);
  const sitePrograms = sortProgramItems(filterAddressMatchedPrograms(programs, zones), zones, confidenceMap);
  const exploratoryPrograms = sortProgramItems(filterDiscoveryPrograms(programs), zones, confidenceMap);

  // ── Builder outputs ──
  const verdict = computeVerdict(zones, programs, ctx);
  const marketContext = buildMarketContext(ctx, zones);
  const eligibleIds = sitePrograms.map((p) => p.id);
  const stackingAnalysis = buildStackingAnalysis(zones, zoneNames, eligibleIds, ctx.stackingRules);
  const dataSources = collectDataSources(ctx);

  const sections: ReportSection[] = [];
  const projectIntakeSection = buildProjectIntakeSection(state);
  if (projectIntakeSection) sections.push(projectIntakeSection);

  // §01 Site Description & Property Profile
  if (parcel && parcel.pin) {
    const propertyItems: ReportItem[] = [
      {
        label: "Property PIN",
        value: parcel.pin,
        detail: `Cook County Assessor record — cookcountyassessoril.gov/pin/${parcel.pin}`,
        url: `https://www.cookcountyassessoril.gov/pin/${parcel.pin}`,
      },
      {
        label: "Building Classification",
        value: `${parcel.classCode} — ${parcel.classDescription}`,
        detail: parcel.isVacant
          ? "Vacant land — eligible for new construction or Land Bank programs"
          : parcel.isCommercial
            ? "Commercial property — may qualify for Class 7a assessment reduction"
            : parcel.isIndustrial
              ? "Industrial property — eligible for industrial development incentives"
              : "Residential property classification",
      },
    ];
    if (parcel.totalValue) {
      propertyItems.push({
        label: "Assessed Value",
        value: parcel.totalValue,
        detail: [
          parcel.landValue && `Land: ${parcel.landValue}`,
          parcel.bldgValue && `Building: ${parcel.bldgValue}`,
        ].filter(Boolean).join(" · "),
      });
    }
    if (parcel.landSqft || parcel.bldgSqft) {
      propertyItems.push({
        label: "Site Dimensions",
        value: [
          parcel.landSqft && `${parcel.landSqft.toLocaleString()} sq ft lot`,
          parcel.bldgSqft && `${parcel.bldgSqft.toLocaleString()} sq ft bldg`,
        ].filter(Boolean).join(" · "),
        detail: parcel.bldgAge != null ? `Building age: ${parcel.bldgAge} years` : undefined,
      });
    }
    if (parcel.taxCode || parcel.township) {
      propertyItems.push({
        label: "Tax Code / Township",
        value: [parcel.taxCode, parcel.township].filter(Boolean).join(" · "),
      });
    }
    sections.push({
      title: "Site Description & Property Profile",
      description: "Property data from Cook County Assessor records for due diligence and application reference.",
      items: propertyItems,
    });
  }

  // §02 Zoning & Regulatory Review
  if (cityZoning?.zoneClass) {
    const zoningItems: ReportItem[] = [
      {
        label: "City Zoning Classification",
        value: cityZoning.zoneClass,
        detail: `${describeZoneClass(cityZoning.zoneClass)}${cityZoning.zoneType ? ` — ${cityZoning.zoneType} zoning` : ""}. Determines permitted land uses, density, and building requirements.`,
      },
    ];
    // Add zone-specific guidance
    const zoneClass = cityZoning.zoneClass;
    if (zoneClass.startsWith("RS") || zoneClass.startsWith("RT") || zoneClass.startsWith("RM")) {
      zoningItems.push({ label: "Use Compatibility", value: "Residential zone", detail: "Commercial uses may require a zoning change or special use permit. Verify compatibility with your intended project type." });
    } else if (zoneClass.startsWith("C") || zoneClass.startsWith("B")) {
      zoningItems.push({ label: "Use Compatibility", value: "Commercial zone", detail: "Most business uses are permitted by right. Check specific subcategory for any restrictions on your intended use." });
    } else if (zoneClass.startsWith("M")) {
      zoningItems.push({ label: "Use Compatibility", value: "Manufacturing zone", detail: "Manufacturing, warehouse, and some commercial uses are permitted. Retail may be restricted depending on the subcategory." });
    }
    sections.push({
      title: "Zoning & Regulatory Review",
      description: "City zoning classification and use compatibility for your project type.",
      items: zoningItems,
    });
  }

  // §03 Neighborhood Economic Context
  const neighborhoodEconomicSection = buildNeighborhoodEconomicContextSection(ctx, zones, marketContext);
  if (neighborhoodEconomicSection) sections.push(neighborhoodEconomicSection);
  const localImpactAnchorsSection = buildLocalImpactAnchorsSection(ctx);
  if (localImpactAnchorsSection) sections.push(localImpactAnchorsSection);

  // §04 Incentive Zone Coverage & Stacking
  if (zoneCount > 0) {
    const zoneItems: ReportItem[] = activeZones.map((key) => {
      const matchingPrograms = programs.filter((p) => p.zoneKey === key);
      return {
        label: ZONE_LABELS[key] || key,
        value: zoneNames?.[key] || (matchingPrograms.length > 0
          ? `${matchingPrograms.length} program${matchingPrograms.length !== 1 ? "s" : ""}`
          : "Active"),
        detail: (ZONE_DESCRIPTIONS[key] ? ZONE_DESCRIPTIONS[key] + " " : "") + (matchingPrograms.map((p) =>
          `${p.name}${p.benefitRange ? ` (${p.benefitRange})` : ""}`
        ).join("; ") || ""),
      };
    });
    // Add stacking info
    if (stackingAnalysis) {
      zoneItems.push({ label: "Incentive Density", value: stackingAnalysis.percentileLabel, detail: stackingAnalysis.narrative });
      for (const combo of stackingAnalysis.combinations) {
        zoneItems.push({ label: combo.zones.join(" + "), value: "Can stack", detail: combo.benefit });
      }
    }
    sections.push({
      title: `Incentive Zone Coverage & Stacking (${zoneCount} zones)`,
      description: "Active incentive zones at this location and how they can be combined.",
      items: zoneItems,
    });
  }

  // §05 Vacancy Opportunity Assessment
  const feasibilityItems: ReportItem[] = [];

  if (projectType === "rehab" || projectType === "mixed-use-conversion") {
    if (parcel?.bldgAge != null && parcel.bldgAge >= 50 && activeZones.includes("nrhpDistricts")) {
      feasibilityItems.push({
        label: "Historic Tax Credit potential",
        value: "Strong — 50+ year building in historic district",
        detail: "Building age and National Register district status may qualify for 20% Federal Historic Tax Credit on certified rehabilitation.",
      });
    } else if (parcel?.bldgAge != null && parcel.bldgAge >= 50) {
      feasibilityItems.push({
        label: "Historic Tax Credit potential",
        value: "Possible — building is 50+ years old",
        detail: "Building age may qualify for historic designation. Check if individual listing or district expansion is feasible.",
      });
    }
    if (activeZones.includes("tif") || activeZones.includes("sbif")) {
      feasibilityItems.push({
        label: "Renovation funding",
        value: "TIF/SBIF eligible",
        detail: "This site is in a TIF district and/or SBIF-eligible area — rehabilitation costs may be partially reimbursed. Confirm current caps and open funding rounds before applying.",
      });
    }
  }

  if (
    projectType === "new-construction" ||
    projectType === "acquisition" ||
    projectType === "vacant-acquisition"
  ) {
    if (parcel?.isVacant) {
      feasibilityItems.push({
        label: "Vacant land status",
        value: "Confirmed vacant parcel",
        detail: "Parcel classified as vacant land. May qualify for Land Bank acquisition or reduced-price city sale programs.",
      });
    }
    if (parcel?.isCommercial && isClass7aEligible(parcel.classCode)) {
      feasibilityItems.push({
        label: "Class 7a eligibility",
        value: "Potentially eligible",
        detail: `Property class ${parcel.classCode} may qualify for Class 7a assessment reduction (10% of market value for 12 years for commercial/industrial rehab).`,
      });
    }
  }

  if (activeZones.includes("federalOZ")) {
    feasibilityItems.push({
      label: "Opportunity Zone",
      value: "Active Federal OZ",
      detail: "Qualified Opportunity Fund treatment may be relevant at this site. Confirm OZ 1.0/OZ 2.0 timing and investment structure with an official source or tax advisor.",
    });
  }
  if (activeZones.includes("enterprise")) {
    feasibilityItems.push({
      label: "Enterprise Zone",
      value: "Active",
      detail: "Sales tax exemption on building materials, utility tax exemption, and investment tax credits available for this site.",
    });
  }

  // Risk signals
  if (verdict?.signal === "limited") {
    feasibilityItems.push({ label: "Risk Signal", value: "Limited incentive coverage", detail: "Fewer address-confirmed programs are available. Broader county, state, federal, and utility programs may still be worth exploring." });
  }

  if (feasibilityItems.length === 0) {
    feasibilityItems.push({
      label: "Baseline vacancy fit",
      value: `${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} active`,
      detail: `This site has ${zoneCount > 0 ? "incentive coverage that can offset project costs" : "limited zone coverage — county-wide programs may still apply"}.`,
    });
  }

  sections.push({
    title: `${projectLabel} Vacancy Fit`,
    description: "Vacancy-focused assessment of incentive eligibility, risk signals, and financing opportunities.",
    items: feasibilityItems,
  });

  // §06 Available Programs
  if (sitePrograms.length > 0) {
    sections.push({
      title: `Available Programs (${sitePrograms.length})`,
      description: "Programs matched to this site through active incentive-zone boundaries, ordered by confidence.",
      items: sitePrograms.slice(0, 8).map((p) => programReportItem(p, confidenceMap)),
    });
  }

  if (exploratoryPrograms.length > 0) {
    sections.push({
      title: "Additional Programs to Explore",
      description: "Programs not confirmed by this address alone, but useful as official next steps for the project.",
      items: exploratoryPrograms.slice(0, 8).map((p) => programReportItem(p, confidenceMap)),
    });
  }

  if (hasProjectReadinessContext(state)) {
    sections.push(buildDocumentReadinessSection(sitePrograms, state));
  }

  // §07 Decision Factors
  const priorities = state.locationPriorities || [];
  if (priorities.length > 0) {
    const priorityAssessments: Record<string, (p: ParcelData | undefined, z: string[]) => ReportItem> = {
      "tax-incentive-value": (p, z) => ({
        label: "Tax Incentive Value",
        value: z.length >= 3 ? "High" : z.length >= 1 ? "Moderate" : "Limited",
        detail: `${z.length} incentive zone${z.length !== 1 ? "s" : ""} at this site.${p?.isCommercial ? " Commercial classification may unlock additional property tax incentives." : ""}`,
        
      }),
      "zoning-compatibility": (_p, _z) => ({
        label: "Zoning Compatibility",
        value: "Check city zoning",
        detail: "Verify that the current city zoning classification supports your intended use. See Zoning & Regulatory Review section.",
      }),
      "property-condition": (p) => ({
        label: "Property Condition",
        value: p?.bldgAge != null ? `${p.bldgAge}-year-old building` : "No building data",
        detail: p?.bldgAge != null
          ? p.bldgAge >= 50
            ? "Older structure — factor in renovation costs, but may qualify for historic tax credits."
            : p.bldgAge >= 20
              ? "Moderate age — assess mechanical systems and envelope condition."
              : "Relatively new construction — lower renovation risk."
          : "Building age not available in parcel records. Inspect the site to assess condition.",
        
      }),
      "assessed-value": (p) => ({
        label: "Assessed Value / Carrying Cost",
        value: p?.totalValue || "Not available",
        detail: p?.totalValue
          ? `Current assessed value sets the baseline property tax burden. ${p.landValue ? `Land portion: ${p.landValue}.` : ""}`
          : "Assessed value not available in parcel records.",
        
      }),
      "neighborhood-demand": () => ({
        label: "Neighborhood Demand",
        value: "See Neighborhood Economic Context",
        detail: "Review the income, home value, population, business-continuity, jobs/payroll, and property-context signals to gauge local market demand.",
      }),
      "grant-eligibility": (_p, z) => ({
        label: "Grant Eligibility",
        value: (z.includes("tif") || z.includes("sbif"))
          ? "TIF/SBIF eligible"
          : z.includes("microMarketRecovery")
            ? "Micro Market eligible"
            : "Limited direct grants",
        detail: (z.includes("tif") || z.includes("sbif"))
          ? "This site qualifies for TIF funding and/or SBIF grant reimbursement for eligible improvements."
          : "No direct grant programs identified at this location. Consider county-wide programs.",
        
      }),
    };

    sections.push({
      title: "Decision Factors",
      description: "Your selected evaluation criteria assessed against site data.",
      items: priorities.map((p) => {
        const assessor = priorityAssessments[p];
        if (assessor) return assessor(parcel, activeZones);
        return {
          label: p.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          value: "Evaluate on-site",
          detail: "This factor requires on-site inspection or additional research.",
        };
      }),
    });
  }

  // ── Action Roadmap (new for best-location) ──
  const actionRoadmap: ActionRoadmapItem[] = [];
  const topSitePrograms = sitePrograms.slice(0, 2);
  for (const p of topSitePrograms) {
    const contact = p.contacts?.[0];
    actionRoadmap.push({
      tier: "do-this-week",
      programId: p.id,
      programName: p.name,
      label: p.fastestConfirmingStep || `Contact ${contact?.agency || "program administrator"} about ${p.name}`,
      description: p.summary,
      contact: contact ? { agency: contact.agency, phone: contact.phone, email: contact.email, role: contact.role } : undefined,
    });
  }
  if (topSitePrograms.length === 0 && exploratoryPrograms.length > 0) {
    const p = exploratoryPrograms[0];
    const contact = p.contacts?.[0];
    actionRoadmap.push({
      tier: "worth-exploring",
      programId: p.id,
      programName: p.name,
      label: p.fastestConfirmingStep || `Explore ${p.name}`,
      description: p.summary,
      contact: contact ? { agency: contact.agency, phone: contact.phone, email: contact.email, role: contact.role } : undefined,
    });
  }
  if (parcel?.pin) {
    actionRoadmap.push({
      tier: "start-gathering",
      label: "Pull full Assessor record",
      description: `Look up PIN ${parcel.pin} on the Cook County Assessor website for tax history, exemptions, and appeal status.`,
    });
  }

  // Recommended actions
  const recommendedActions: GeneratedReport["recommendedActions"] = [];
  if (parcel?.pin) {
    recommendedActions.push({
      label: "Review full Assessor record",
      description: `Look up PIN ${parcel.pin} on the Cook County Assessor website for tax history, exemptions, and appeal status.`,
      priority: "high",
    });
  }
  if (zoneCount > 0) {
    recommendedActions.push({
      label: "Confirm zone boundaries on the map",
      description: "Use the Chicago Incentive Explorer map to visually verify that the parcel falls within the listed incentive zones.",
      priority: "high",
    });
  }
  if (projectType === "rehab" && parcel?.bldgAge != null && parcel.bldgAge >= 50) {
    recommendedActions.push({
      label: "Check historic designation eligibility",
      description: "Contact the Illinois SHPO to determine if the building qualifies for the National Register and federal Historic Tax Credit.",
      priority: "high",
    });
  }
  recommendedActions.push({
    label: "Schedule a site visit",
    description: "Walk the property and surrounding blocks to assess physical condition, access, visibility, and neighborhood character.",
    priority: "medium",
  });
  recommendedActions.push({
    label: "Book free business advising",
    description: "Schedule a session with SECCC or Small Business Source to review this site evaluation and discuss next steps.",
    priority: "medium",
  });

  // Summary
  const summaryParts: string[] = [];
  if (parcel?.pin) {
    summaryParts.push(`PIN ${parcel.pin} (${parcel.classDescription})`);
  }
  summaryParts.push(`${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} active at this site`);
  summaryParts.push(`${sitePrograms.length} address-confirmed program${sitePrograms.length !== 1 ? "s" : ""}`);
  if (exploratoryPrograms.length > 0) {
    summaryParts.push(`${exploratoryPrograms.length} additional discovery program${exploratoryPrograms.length !== 1 ? "s" : ""}`);
  }
  if (parcel?.totalValue) {
    summaryParts.push(`assessed at ${parcel.totalValue}`);
  }

  return {
    title: `Vacancy Analysis — ${address}`,
    subtitle: `${projectLabel} Analysis`,
    reportType: "best-location",
    generatedAt: new Date().toISOString(),
    summary: `${verdict?.headline || "Site assessment complete"}. ${summaryParts.join(". ")}. ${projectType === "rehab" && parcel?.bldgAge != null && parcel.bldgAge >= 50 ? "The building's age may unlock historic tax credits. " : ""}The sections below are organized from key findings to detailed evidence.`,
    sections,
    recommendedActions,
    metadata: {
      address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      projectType,
      budgetRange: state.budgetRange || undefined,
      proposedUse: state.proposedUse || undefined,
    },
    verdict,
    marketContext,
    stackingAnalysis,
    actionRoadmap: actionRoadmap.length > 0 ? actionRoadmap : undefined,
    dataSources,
  };
}

function generateProgramExplorer(
  state: WizardState,
  programs: Program[],
): GeneratedReport {
  const levels = state.governmentLevels;
  const benefitTypes = state.benefitTypes;

  // Filter by government levels if specified
  let filtered = programs;
  if (levels && levels.length > 0) {
    filtered = filtered.filter((p) => levels.includes(p.level));
  }

  // Filter by benefit types if specified
  if (benefitTypes && benefitTypes.length > 0) {
    filtered = filtered.filter((p) => {
      const benefitText = p.benefits.join(" ").toLowerCase();
      return benefitTypes.some((bt) => {
        switch (bt) {
          case "tax-credit":
            return benefitText.includes("tax credit") || benefitText.includes("income tax");
          case "tax-exemption":
            return benefitText.includes("exemption") || benefitText.includes("tax reduction");
          case "grant":
            return benefitText.includes("grant") || benefitText.includes("reimbursement") || benefitText.includes("up to $");
          case "financing":
            return benefitText.includes("financing") || benefitText.includes("loan") || benefitText.includes("pace");
          case "property-tax":
            return benefitText.includes("property tax") || benefitText.includes("assessment");
          case "workforce":
            return benefitText.includes("hiring") || benefitText.includes("training") || benefitText.includes("workforce");
          default:
            return true;
        }
      });
    });
  }

  // Group by level in order: Federal, State, County, City, Utility
  const grouped = groupByLevel(filtered);
  const levelOrder: Array<Program["level"]> = ["Federal", "State", "County", "City", "Utility"];

  const sections: ReportSection[] = [];
  for (const level of levelOrder) {
    const levelPrograms = grouped[level];
    if (!levelPrograms || levelPrograms.length === 0) continue;
    sections.push({
      title: `${level}-Level Programs`,
      items: levelPrograms.map((p) => programReportItem(p)),
    });
  }

  // If no programs matched the filters, show a fallback section
  if (sections.length === 0) {
    sections.push({
      title: "No Programs Match Current Filters",
      items: [
        {
          label: "Broaden your search",
          value: "Try selecting additional government levels or benefit types",
          detail:
            "The current filter combination did not match any programs. Consider expanding your criteria to see more options.",
        },
      ],
    });
  }

  const levelsDisplay =
    levels && levels.length > 0 ? levels.join(", ") : "all levels";

  const recommendedActions: GeneratedReport["recommendedActions"] = [
    {
      label: "Check your address for zone eligibility",
      description:
        "Many programs require your property to be in a specific zone. Use the address checker to verify which programs apply to your location.",
      priority: "high",
    },
    {
      label: "Complete the pre-qualification survey",
      description:
        "Answer 4 quick questions to see which programs best match your industry, property, and planned activities.",
      priority: "high",
    },
    {
      label: "Book free business advising",
      description:
        "A business advisor can help you navigate the application process for multiple programs simultaneously.",
      priority: "medium",
    },
  ];

  return {
    title: "Program Explorer Report",
    subtitle: `Filtered by ${levelsDisplay}${benefitTypes && benefitTypes.length > 0 ? ` and ${benefitTypes.length} benefit type${benefitTypes.length !== 1 ? "s" : ""}` : ""}`,
    reportType: "program-explorer",
    generatedAt: new Date().toISOString(),
    summary: `Found ${filtered.length} incentive program${filtered.length !== 1 ? "s" : ""} across ${sections.length} government level${sections.length !== 1 ? "s" : ""}. ${filtered.length > 0 ? `Programs range from direct grants and tax credits to property tax reductions and financing tools.` : "Adjust your filters to discover available programs."} Each program has specific eligibility criteria — check your address and complete the survey to narrow your results.`,
    sections,
    recommendedActions,
    metadata: {
      industry: state.industry ? getIndustryName(state.industry) : undefined,
    },
  };
}

function generateDeveloperAnalysis(
  state: WizardState,
  programs: Program[],
): GeneratedReport {
  const creditsToAnalyze = state.creditsToAnalyze || [];
  const budgetRange = state.budgetRange || "";
  const projectType = state.projectType || "Commercial development";
  const budgetMedian = BUDGET_MEDIANS[budgetRange] || 0;

  // Resolve credit IDs to programs
  const creditPrograms = creditsToAnalyze
    .map((id) => programs.find((p) => p.id === id))
    .filter((p): p is Program => !!p);

  const sections: ReportSection[] = [];

  // Section 1: Incentive Pathway Review
  const stackingItems: ReportItem[] = creditPrograms.map((p) => {
    const creditInfo = CREDIT_PERCENTAGES[p.id];
    const valueDisplay = budgetMedian > 0
      ? estimateCreditValue(p.id, budgetRange)
      : (p.benefitRange || "Contact for details");

    return {
      ...programReportItem(p),
      value: valueDisplay,
      detail: creditInfo?.label || p.summary,
    };
  });

  sections.push({
    title: "Incentive Pathway Review",
    description: "Program fit and verification notes. This report does not estimate award amounts or guarantee funding.",
    items: stackingItems.length > 0
      ? stackingItems
      : [
          {
            label: "No credits selected",
            value: "Select programs to analyze",
            detail: "Use the wizard to choose which credit programs you want to evaluate for stacking.",
          },
        ],
  });

  // Section 2: Project Requirements
  const allRequiredDocs = new Set<string>();
  const allQualifications: ReportItem[] = [];

  // Build doc → program mapping for attribution
  const docProgramMap: Record<string, Set<string>> = {};
  for (const p of creditPrograms) {
    for (const doc of p.requiredDocs) {
      allRequiredDocs.add(doc);
      if (!docProgramMap[doc]) docProgramMap[doc] = new Set();
      docProgramMap[doc].add(p.name);
    }
    allQualifications.push({
      ...programReportItem(p),
      value: p.whoQualifies,
    });
  }

  // Deduplicated requirements list with program attribution
  const requirementItems: ReportItem[] = [
    ...allQualifications,
  ];

  if (allRequiredDocs.size > 0) {
    // Categorize documents
    const docGrouped: Record<string, { doc: string; programs: string[] }[]> = {};
    for (const [doc, programs] of Object.entries(docProgramMap)) {
      let category = "General";
      const dl = doc.toLowerCase();
      if (dl.includes("tax") || dl.includes("financial") || dl.includes("bank") || dl.includes("revenue") || dl.includes("income") || dl.includes("profit")) category = "Financial & Tax";
      else if (dl.includes("license") || dl.includes("permit") || dl.includes("certificate") || dl.includes("registration") || dl.includes("incorporation") || dl.includes("articles")) category = "Business Registration";
      else if (dl.includes("lease") || dl.includes("deed") || dl.includes("property") || dl.includes("title") || dl.includes("survey") || dl.includes("parcel")) category = "Property & Site";
      else if (dl.includes("plan") || dl.includes("proposal") || dl.includes("scope") || dl.includes("budget") || dl.includes("estimate") || dl.includes("project")) category = "Project Plans";
      else if (dl.includes("employee") || dl.includes("payroll") || dl.includes("workforce") || dl.includes("hire") || dl.includes("job")) category = "Workforce";
      else if (dl.includes("insurance") || dl.includes("bond")) category = "Insurance & Compliance";
      if (!docGrouped[category]) docGrouped[category] = [];
      docGrouped[category].push({ doc, programs: Array.from(programs) });
    }
    for (const [cat, docs] of Object.entries(docGrouped).sort(([a], [b]) => a.localeCompare(b))) {
      requirementItems.push({
        label: cat,
        value: `${docs.length} document${docs.length !== 1 ? "s" : ""}`,
        detail: docs.map((d) => `${d.doc} — ${d.programs.join(", ")}`).join("\n"),
      });
    }
  }

  sections.push({
    title: "Required Documents",
    description: `${allRequiredDocs.size} documents across your eligible programs, organized by category. Each document lists which program(s) require it.`,
    items: requirementItems,
  });

  // Section 3: Navigation Roadmap
  // Group selected programs' howToApply steps as discovery actions, not a compliance timeline.
  const roadmapPhases: {
    phase: string;
    steps: { program: string; step: string; programId: string }[];
  }[] = [
    { phase: "Confirm Fit", steps: [] },
    { phase: "Find Official Source", steps: [] },
    { phase: "Prepare Materials", steps: [] },
    { phase: "Contact Administrator", steps: [] },
  ];

  for (const p of creditPrograms) {
    const steps = p.howToApply;
    steps.forEach((step, i) => {
      // Assign steps to phases based on position
      const phaseIndex = Math.min(Math.floor(i / Math.max(1, Math.ceil(steps.length / 4))), 3);
      roadmapPhases[phaseIndex].steps.push({
        program: p.name,
        step,
        programId: p.id,
      });
    });
  }

  const roadmapItems: ReportItem[] = roadmapPhases
    .filter((phase) => phase.steps.length > 0)
    .map((phase) => ({
      label: phase.phase,
      value: `${phase.steps.length} action${phase.steps.length !== 1 ? "s" : ""}`,
      detail: phase.steps
        .map((s) => `[${s.program}] ${s.step}`)
        .join(" | "),
    }));

  sections.push({
    title: "Application Roadmap",
    items: roadmapItems.length > 0
      ? roadmapItems
      : [
          {
            label: "Roadmap will populate once credits are selected",
            value: "Select programs to build your timeline",
          },
        ],
  });

  // Recommended actions
  const recommendedActions: GeneratedReport["recommendedActions"] = [];

  if (creditPrograms.length > 0) {
    const topCredit = creditPrograms[0];
    recommendedActions.push({
      label: `Verify ${topCredit.name} fit first`,
      description:
        topCredit.fastestConfirmingStep ||
        "Confirm eligibility, timing, documentation, and whether pre-approval is required before spending money.",
      priority: "high",
    });
  }

  recommendedActions.push({
    label: "Consult a tax advisor on incentive compatibility",
    description:
      "A qualified tax professional can verify whether selected credits can be combined on the same project and identify exclusions.",
    priority: "high",
  });

  recommendedActions.push({
    label: "Verify zone eligibility for all selected programs",
    description:
      "Confirm that your project address is within the required zone boundaries for each selected program before beginning applications.",
    priority: "medium",
  });

  recommendedActions.push({
    label: "Engage a program consultant or CDFI",
    description:
      "Organizations like Chicago Neighborhood Initiatives (CNI) or IFF specialize in helping developers navigate multi-program applications.",
    priority: "medium",
  });

  return {
    title: `Developer Analysis: ${projectType}`,
    subtitle: budgetRange
      ? `Incentive pathway review for ${budgetRange} project`
      : "Incentive pathway review",
    reportType: "developer-analysis",
    generatedAt: new Date().toISOString(),
    summary: `Analyzing ${creditPrograms.length} incentive pathway${creditPrograms.length !== 1 ? "s" : ""} for a ${projectType.toLowerCase()} project${budgetRange ? ` with a project budget range of ${budgetRange}` : ""}. This report identifies fit, sequencing, documentation, and verification needs; it does not estimate award amounts or guarantee funding.`,
    sections,
    recommendedActions,
    metadata: {
      address: state.address || undefined,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      industry: state.industry ? getIndustryName(state.industry) : undefined,
      budgetRange: budgetRange || undefined,
      projectType: projectType || undefined,
    },
  };
}

// ─── Corridor Intelligence Generator ───────────────────────────────

export interface CorridorMetricDetails {
  vacancy?: {
    vacantCount?: number | null;
    totalParcels?: number | null;
  };
  turnover?: {
    openings?: number | null;
    closures?: number | null;
    activeLicenses?: number | null;
    windowMonths?: number | null;
  };
  ownershipConcentration?: {
    knownOwners?: number | null;
    distinctOwners?: number | null;
    topOwnerShare?: number | null;
    totalParcels?: number | null;
  };
  ownershipOrigin?: {
    localCount?: number | null;
    outsideCount?: number | null;
    unknownCount?: number | null;
  };
  permits?: {
    count?: number | null;
    totalReportedCost?: number | null;
    demolitionCount?: number | null;
    windowMonths?: number | null;
  };
  incentiveCoverage?: {
    coveredCount?: number | null;
    totalParcels?: number | null;
  };
  windowMonths?: number | null;
}

export interface CorridorMetric {
  corridorType: string;
  corridorId: string;
  asOf?: string | null;
  vacancyRate?: number | null;
  turnoverRate?: number | null;
  ownershipHHI?: number | null;
  localOwnershipShare?: number | null;
  permitCount?: number | null;
  incentiveCoverage?: number | null;
  healthScore?: number | null;
  computedAt?: string | null;
  details?: CorridorMetricDetails | null;
}

export interface CorridorOwnerCluster {
  clusterKey: string;
  ownerName?: string | null;
  ownerMailingAddress?: string | null;
  ownerType?: string | null;
  parcelCount: number;
  vacantParcelCount: number;
  businessCount: number;
  businessNames: string[];
  sampleAddresses: string[];
  latestTransferDate?: string | null;
  latestBuyerName?: string | null;
  latestSellerName?: string | null;
  confidence: string;
  evidence: string;
}

function formatRate(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return "Not available";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatNumber(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return "Not available";
  return Number(value).toLocaleString();
}

function formatMoneyShort(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return "Not available";
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatCorridorLabel(corridor?: CorridorMetric | null, fallback?: string): string {
  const id = corridor?.corridorId || fallback || "Selected corridor";
  return corridor?.corridorType === "zip" || /^\d{5}$/.test(id) ? `ZIP ${id}` : id;
}

function generateCorridorIntelligence(
  state: WizardState,
  programs: Program[],
  ctx: ReportContext = {},
): GeneratedReport {
  const metric = ctx.corridorMetrics;
  const label = formatCorridorLabel(metric, state.neighborhood);
  const details = metric?.details ?? {};
  const vacancy = details.vacancy ?? {};
  const turnover = details.turnover ?? {};
  const ownershipConcentration = details.ownershipConcentration ?? {};
  const ownershipOrigin = details.ownershipOrigin ?? {};
  const permits = details.permits ?? {};
  const incentiveCoverage = details.incentiveCoverage ?? {};
  const ownerClusters = ctx.corridorOwnerClusters ?? [];
  const hasMetric = Boolean(metric);
  const healthScore =
    metric?.healthScore != null ? `${Math.round(Number(metric.healthScore))}/100` : "Not available";
  const placeBasedPrograms = programs.filter((program) => program.zoneKey).length;
  const activityWindowMonths = details.windowMonths ?? turnover.windowMonths ?? permits.windowMonths ?? 24;
  const activityWindowLabel = `Trailing ${activityWindowMonths} months`;
  const netLicenseCount =
    turnover.openings != null && turnover.closures != null
      ? Number(turnover.openings) - Number(turnover.closures)
      : null;
  const vacancyRead =
    vacancy.vacantCount != null && vacancy.totalParcels != null
      ? `${formatNumber(vacancy.vacantCount)} flagged parcels (${formatRate(metric?.vacancyRate)})`
      : formatRate(metric?.vacancyRate);
  const businessMomentumRead =
    netLicenseCount != null
      ? `Net ${netLicenseCount >= 0 ? "+" : ""}${formatNumber(netLicenseCount)} licenses`
      : formatRate(metric?.turnoverRate);
  const ownershipStructureRead =
    ownershipConcentration.distinctOwners != null
      ? `Highly fragmented: ${formatNumber(ownershipConcentration.distinctOwners)} owners`
      : "Not available";
  const ownershipStructureBasis = [
    ownershipConcentration.topOwnerShare != null ? `top owner ~${formatRate(ownershipConcentration.topOwnerShare)}` : null,
    metric?.ownershipHHI != null ? `HHI ${Number(metric.ownershipHHI).toFixed(4)}` : null,
  ].filter(Boolean).join("; ") || "Owner counts unavailable";
  const localOwnershipBasis =
    ownershipOrigin.localCount != null || ownershipOrigin.outsideCount != null
      ? `${formatNumber(ownershipOrigin.localCount)} local / ${formatNumber(ownershipOrigin.outsideCount)} outside classified private owner records`
      : "Ownership origin unavailable";
  const permitInvestmentRead =
    permits.totalReportedCost != null
      ? `${formatMoneyShort(permits.totalReportedCost)} in permitted work`
      : formatNumber(metric?.permitCount);
  const permitInvestmentBasis =
    metric?.permitCount != null
      ? `${formatNumber(metric.permitCount)} permits, including ${formatNumber(permits.demolitionCount)} demolitions`
      : "Permit detail unavailable";

  const metricRows = [
    [
      "Market Signal Composite",
      healthScore,
      "Comparison-only summary",
      hasMetric
        ? "Summarizes the readings below for comparison across corridors. It is not a grade of corridor success."
        : "No computed metric snapshot is available yet.",
    ],
    [
      "Vacancy pressure",
      vacancyRead,
      vacancy.vacantCount != null && vacancy.totalParcels != null
        ? `${formatNumber(vacancy.vacantCount)} / ${formatNumber(vacancy.totalParcels)} parcels`
        : "Parcel counts unavailable",
      "Start site verification with the flagged parcel list before drawing conclusions about availability or reuse.",
    ],
    [
      "Business momentum",
      businessMomentumRead,
      turnover.openings != null || turnover.closures != null
        ? `${formatNumber(turnover.openings)} openings vs. ${formatNumber(turnover.closures)} closures; ${activityWindowLabel.toLowerCase()}`
        : "License counts unavailable",
      netLicenseCount != null && netLicenseCount > 0
        ? "Licensing activity is expansionary. The reasons still need local confirmation."
        : "License activity needs local interpretation before it can explain business conditions.",
    ],
    [
      "Ownership structure",
      ownershipStructureRead,
      ownershipConcentration.distinctOwners != null && ownershipConcentration.totalParcels != null
        ? `${formatNumber(ownershipConcentration.distinctOwners)} distinct owners / ${formatNumber(ownershipConcentration.totalParcels)} owner-linked parcels; ${ownershipStructureBasis}`
        : "Owner counts unavailable",
      "Outreach here means many small conversations, not a few key property-control relationships.",
    ],
    [
      "Local ownership share",
      formatRate(metric?.localOwnershipShare),
      localOwnershipBasis,
      "Public and unknown owner records are excluded from this percentage.",
    ],
    [
      "Reinvestment",
      permitInvestmentRead,
      `${permitInvestmentBasis}; ${activityWindowLabel.toLowerCase()}`,
      "Capital is showing up. Compare this against vacancy to see where reinvestment is not reaching.",
    ],
    [
      "Incentive coverage",
      metric?.incentiveCoverage == null ? "Not yet batch-computed" : formatRate(metric.incentiveCoverage),
      incentiveCoverage.coveredCount != null && incentiveCoverage.totalParcels != null
        ? `${formatNumber(incentiveCoverage.coveredCount)} / ${formatNumber(incentiveCoverage.totalParcels)} parcels`
        : "Spatial overlay not yet computed",
      `Address-level incentive checks remain available. Corridor coverage needs parcel-to-polygon overlay across ${placeBasedPrograms} place-based program records.`,
    ],
  ];

  const sourceRows = [
    [
      "Vacancy",
      "Vacant-property and parcel signals",
      vacancy.vacantCount != null ? formatNumber(vacancy.vacantCount) : "Not available",
      "Use as a site-verification list, not proof that every site is available.",
    ],
    [
      "Business activity",
      "City business license openings and closures",
      turnover.openings != null || turnover.closures != null
        ? `${formatNumber(turnover.openings)} openings; ${formatNumber(turnover.closures)} closures`
        : "Not available",
      `Openings and closures use the ${activityWindowLabel.toLowerCase()}; informal operating changes may not appear.`,
    ],
    [
      "Ownership",
      "Cook County parcel ownership and mailing records",
      ownershipConcentration.distinctOwners != null
        ? `${formatNumber(ownershipConcentration.distinctOwners)} distinct owners`
        : "Not available",
      "Recorded owner and mailing data is a proxy; it does not prove beneficial ownership or owner intent.",
    ],
    [
      "Condition / reinvestment",
      "Building permits, violations, and 311 condition signals",
      metric?.permitCount != null ? `${formatNumber(metric.permitCount)} permits` : "Not available",
      `Permit activity uses the ${activityWindowLabel.toLowerCase()}; reported cost is a signal, not final investment value.`,
    ],
    [
      "Incentives",
      "Mapped incentive zones and program records",
      `${placeBasedPrograms} place-based program records`,
      "Batch corridor coverage needs parcel-to-polygon overlay; address-level checks remain more precise.",
    ],
  ];

  const signalItems: ReportItem[] = [
    {
      label: "Business activity is the strongest positive read",
      value: businessMomentumRead,
      detail:
        turnover.openings != null && turnover.closures != null
          ? `${formatNumber(turnover.openings)} new licenses against ${formatNumber(turnover.closures)} closures points to expansionary activity. The data says momentum is present; it does not explain which businesses are thriving or why.`
          : "Business-license activity is not available yet for this corridor snapshot.",
    },
    {
      label: "Vacancy is visible, but reviewable",
      value: vacancyRead,
      detail:
        vacancy.vacantCount != null && vacancy.totalParcels != null
          ? `${formatNumber(vacancy.vacantCount)} parcels carry a vacancy signal out of ${formatNumber(vacancy.totalParcels)} total parcels. The next read should be property-level verification, not a corridor-wide assumption.`
          : "Vacancy parcel counts are not available yet for this corridor snapshot.",
    },
    {
      label: "No single owner appears to control the corridor",
      value: ownershipStructureRead,
      detail:
        ownershipConcentration.distinctOwners != null && ownershipConcentration.totalParcels != null
          ? `${ownershipStructureBasis}. This is a fragmented property base, which changes the outreach strategy: many owners, many conversations, and fewer obvious anchor relationships.`
          : "Ownership concentration is not available yet for this corridor snapshot.",
    },
    {
      label: "Reinvestment is already present",
      value: permitInvestmentRead,
      detail:
        metric?.permitCount != null
          ? `${permitInvestmentBasis}. The useful question is where permitted investment overlaps with vacancy, ownership, and business activity, and where it does not.`
          : "Permit activity detail is not available yet for this corridor snapshot.",
    },
    {
      label: "Composite score is a comparison aid",
      value: healthScore,
      detail: hasMetric
        ? "The Market Signal Composite summarizes vacancy, license activity, ownership, and reinvestment so corridors can be compared later. It should not be read as a grade."
        : "No corridor metric snapshot is available yet for this geography.",
    },
  ];

  const confidenceItems: ReportItem[] = [
    {
      label: "Geography",
      value: metric?.corridorType === "zip" ? "ZIP-based demo" : "Selected corridor",
      detail: "ZIP metrics are useful for a funding demonstration. Neighborhood, SSA, ward, and custom corridor boundaries will be more precise for corridor management.",
    },
    {
      label: "Activity window",
      value: activityWindowLabel,
      detail: "Business-license and permit metrics use this trailing window unless a source table states otherwise.",
    },
    {
      label: "Ownership",
      value: "Recorded owner proxy",
      detail: "Owner classification uses public parcel owner and mailing records. It does not prove beneficial ownership, lease terms, owner intent, or site availability.",
    },
    {
      label: "Unit of measure",
      value: "Parcels, licenses, owner records, permits",
      detail: "Vacancy is parcel-based, business momentum is license-based, ownership splits use classified private owner records, and reinvestment is permit-based.",
    },
    {
      label: "Incentive overlay",
      value: metric?.incentiveCoverage == null ? "Not batch-computed yet" : "Computed",
      detail: "Address-level incentive checks already work. Corridor-level incentive coverage still needs parcel-to-polygon overlay before it should be treated as a full corridor metric.",
    },
  ];

  const ownerOperatorRows = ownerClusters.slice(0, 15).map((cluster) => {
    const ownerLabel = cluster.ownerName || "Owner record unavailable";
    const footprint = [
      `${formatNumber(cluster.parcelCount)} parcel${cluster.parcelCount === 1 ? "" : "s"}`,
      `${formatNumber(cluster.vacantParcelCount)} vacancy signal${cluster.vacantParcelCount === 1 ? "" : "s"}`,
      cluster.sampleAddresses.length > 0 ? `sample: ${cluster.sampleAddresses.slice(0, 2).join("; ")}` : null,
    ].filter(Boolean).join(" | ");
    const businessLinks =
      cluster.businessCount > 0
        ? `${formatNumber(cluster.businessCount)} license match${cluster.businessCount === 1 ? "" : "es"}${cluster.businessNames.length > 0 ? `: ${cluster.businessNames.slice(0, 3).join("; ")}` : ""}`
        : "No business-license site match found";
    const transferHint =
      cluster.latestTransferDate
        ? `Latest transfer ${cluster.latestTransferDate}${cluster.latestBuyerName ? `; buyer: ${cluster.latestBuyerName}` : ""}`
        : "No transfer hint in current snapshot";

    return [
      ownerLabel,
      cluster.ownerMailingAddress || "Mailing address unavailable",
      footprint,
      businessLinks,
      transferHint,
      `${cluster.confidence} confidence — ${cluster.evidence || "recorded parcel owner evidence"}`,
    ];
  });

  return {
    title: `Corridor Intelligence Demo — ${label}`,
    subtitle: "Market and resilience signals for corridor partners",
    reportType: "corridor-intelligence",
    generatedAt: new Date().toISOString(),
    summary: hasMetric
      ? `${label} shows ${netLicenseCount != null && netLicenseCount > 0 ? "strong business momentum" : "measurable business activity"} and active reinvestment, with vacancy concentrated in a reviewable set of ${formatNumber(vacancy.vacantCount)} flagged parcels and a highly fragmented ownership base. The Market Signal Composite (${healthScore}) summarizes these readings for comparison across corridors; it is not a grade of corridor success. Activity metrics use a ${activityWindowLabel.toLowerCase()} unless noted.`
      : `${label} does not have a computed corridor metric snapshot yet. This report still shows the intended data structure, but the metrics should be backfilled before using it for decisions.`,
    sections: [
      {
        title: "Market Signal Summary",
        description: "The numbers in one place. Each row pairs a signal with the plain-language read it supports.",
        table: {
          columns: ["Signal", "Current Read", "Data Basis", "Interpretation"],
          rows: metricRows,
        },
        items: [],
      },
      {
        title: "What The Signals Say",
        description: "A short read of what the current data supports, without turning the report into a recommendation engine.",
        items: signalItems,
      },
      ...(ownerOperatorRows.length > 0
        ? [
            {
              title: "Owner & Operator Map",
              description:
                "A first-pass relationship map connecting recorded property-control records to parcels, vacancy signals, business-license site matches, and transfer hints. Treat these as leads with confidence labels, not final ownership claims.",
              table: {
                columns: [
                  "Owner / control record",
                  "Mailing / control address",
                  "Property footprint",
                  "Business site links",
                  "Transfer hint",
                  "Confidence / evidence",
                ],
                rows: ownerOperatorRows,
              },
              items: [
                {
                  label: "Why this matters",
                  value: "The last mile is knowing who to contact",
                  detail:
                    "Corridor signals become useful when they resolve to property records, operating businesses, and contactable owner or agent pathways. This section starts that map using conservative public-record matches.",
                },
              ],
            },
          ]
        : []),
      {
        title: "How To Read This",
        description: "Source notes, confidence limits, and units of measure for interpreting the corridor snapshot.",
        table: {
          columns: ["Domain", "Source / Signal", "Current Value", "Caution"],
          rows: sourceRows,
        },
        items: confidenceItems,
      },
      {
        title: "What A Funded Version Unlocks",
        description: "This hidden demo shows what is possible with one geography. A funded version would make it reliable across more places and partner workflows.",
        items: [
          {
            label: "What this demo proves",
            value: "Public data can become corridor intelligence",
            detail: "Parcel, ownership, business-license, vacancy, permit, and condition signals can be stitched into a coherent market read for a specific geography.",
          },
          {
            label: "What a funded version adds",
            value: "Scale, precision, refresh, and partner context",
            detail: "Funding would support citywide backfills, corridor-specific boundaries, parcel-to-incentive overlays, scheduled refreshes, partner corrections, and exportable partner reports.",
          },
          {
            label: "Why this matters",
            value: "Better targeting before interventions",
            detail: "The value is not just more data. It is a clearer way to see where vacancy, ownership, churn, reinvestment, and incentive access point to different corridor needs.",
          },
        ],
      },
    ],
    recommendedActions: [],
    metadata: {
      corridorType: metric?.corridorType || "zip",
      corridorId: metric?.corridorId || state.neighborhood || undefined,
      corridorLabel: label,
    },
    dataSources: [
      {
        id: "corridor-metrics",
        label: "Corridor metrics",
        description:
          "Computed from parcel, vacancy, license, permit, transfer, and condition signals loaded into the platform database.",
      },
      {
        id: "city-business-licenses",
        label: "City of Chicago business licenses",
        description: "Used to estimate openings, closures, and business activity patterns.",
        url: "https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses/r5kz-chrr",
      },
      {
        id: "cook-county-parcels",
        label: "Cook County parcel and valuation data",
        description: "Used for parcel counts, ownership patterns, property type, and assessed-value context.",
        url: "https://datacatalog.cookcountyil.gov/",
      },
      {
        id: "city-permits-conditions",
        label: "City permits, violations, and 311 signals",
        description: "Used to understand reinvestment, condition, and vacancy signals.",
        url: "https://data.cityofchicago.org/",
      },
    ],
  };
}

// ─── Main Export ─────────────────────────────────────────────────────

/**
 * Census data for the report location.
 */
export interface ReportCensusData {
  medianIncome?: number | null;
  medianHomeValue?: number | null;
  population?: number | null;
  walkScore?: number | null;
  tractId?: string;
}

/**
 * City zoning classification for the report location.
 */
export interface ReportZoningData {
  zoneClass?: string;
  zoneType?: string | null;
}

/**
 * Bundled context for report generation — replaces the growing param list.
 */
export interface ReportContext {
  zones?: Record<string, boolean>;
  zoneNames?: Record<string, string>;
  census?: ReportCensusData;
  cityZoning?: ReportZoningData;
  parcel?: ParcelData;
  districts?: DistrictData;
  stackingRules?: StackingRule[];
  communityAssets?: CommunityAsset[];
  stats?: Stats;
  corridorMetrics?: CorridorMetric | null;
  corridorOwnerClusters?: CorridorOwnerCluster[];
  neighborhoodEconomics?: NeighborhoodEconomicContext;
}

/**
 * Generate structured report data from wizard answers and program data.
 *
 * @param state    - Wizard answers collected through the report wizard UI
 * @param programs - All available incentive programs
 * @param ctx      - Contextual data (zones, census, zoning, parcel, districts, stacking, assets, stats)
 * @returns A GeneratedReport object ready for UI rendering or PDF export
 */
export function generateReportData(
  state: WizardState,
  programs: Program[],
  ctx: ReportContext = {},
): GeneratedReport {
  const { zones, zoneNames, census, cityZoning, parcel, districts } = ctx;
  const reportType = state.reportType || "site-incentives";

  let report: GeneratedReport;

  switch (reportType) {
    // New types
    case "site-incentives":
    case "location-incentives":
      report = generateLocationIncentives(state, programs, ctx);
      break;

    case "dev-feasibility":
    case "best-location":
      report = generateBestLocation(state, programs, ctx);
      break;

    case "corridor-intelligence":
      report = generateCorridorIntelligence(state, programs, ctx);
      break;

    // Legacy types — kept for backward compat with shared URLs
    case "program-explorer":
      report = generateProgramExplorer(state, programs);
      break;

    case "developer-analysis":
      report = generateDeveloperAnalysis(state, programs);
      break;

    default:
      // Fallback to site-incentives for unknown types
      report = generateLocationIncentives(state, programs, ctx);
      break;
  }
  report.reportType = reportType;
  if (ctx.neighborhoodEconomics) report.neighborhoodEconomics = ctx.neighborhoodEconomics;

  // Attach census + zoning data to metadata for address-based reports
  if (reportType !== "program-explorer") {
    if (census?.medianIncome != null) report.metadata.medianIncome = census.medianIncome;
    if (census?.medianHomeValue != null) report.metadata.medianHomeValue = census.medianHomeValue;
    if (cityZoning?.zoneClass) report.metadata.zoneClass = cityZoning.zoneClass;
    if (cityZoning?.zoneType) report.metadata.zoneType = cityZoning.zoneType;

    // Insert a "Site Profile" section — property, zoning, and district data only
    // (census/market data lives in Neighborhood Economic Context to avoid duplication)
    const contextItems: ReportItem[] = [];
    if (cityZoning?.zoneClass) {
      contextItems.push({
        label: "City Zoning Classification",
        value: cityZoning.zoneClass,
        detail: cityZoning.zoneType
          ? `${cityZoning.zoneType} zoning — determines permitted land uses, density, and building requirements at this location`
          : "Determines permitted land uses, density, and building requirements at this location",
      });
    }

    // Parcel data items
    if (parcel && parcel.pin) {
      contextItems.push({
        label: "Property PIN",
        value: parcel.pin,
        detail: `View full record at cookcountyassessoril.gov/pin/${parcel.pin}`,
        url: `https://www.cookcountyassessoril.gov/pin/${parcel.pin}`,
      });
      contextItems.push({
        label: "Building Classification",
        value: `${parcel.classCode} — ${parcel.classDescription}`,
        detail: isClass7aEligible(parcel.classCode)
          ? "This property class may be eligible for Class 7a/7b assessment reduction"
          : "Standard property classification for tax assessment purposes",
        
      });
      if (parcel.totalValue) {
        contextItems.push({
          label: "Assessed Value",
          value: parcel.totalValue,
          detail: [
            parcel.landValue ? `Land: ${parcel.landValue}` : null,
            parcel.bldgValue ? `Building: ${parcel.bldgValue}` : null,
          ].filter(Boolean).join(" · ") || "Cook County Assessor certified value",
        });
      }
      if (parcel.landSqft || parcel.bldgSqft) {
        contextItems.push({
          label: "Lot / Building Size",
          value: [
            parcel.landSqft ? `${parcel.landSqft.toLocaleString()} sq ft lot` : null,
            parcel.bldgSqft ? `${parcel.bldgSqft.toLocaleString()} sq ft bldg` : null,
          ].filter(Boolean).join(" · "),
          detail: parcel.bldgAge != null ? `Building age: ${parcel.bldgAge} years` : undefined,
        });
      }
    }

    // District data items
    if (districts) {
      const districtParts: string[] = [];
      if (districts.ward) districtParts.push(`Ward ${districts.ward}`);
      if (districts.commissionerDistrict) districtParts.push(`Commissioner Dist. ${districts.commissionerDistrict}`);
      if (districts.congressionalDistrict) districtParts.push(`IL-${districts.congressionalDistrict}`);
      if (districts.stateHouseDistrict) districtParts.push(`State Rep Dist. ${districts.stateHouseDistrict}`);
      if (districts.stateSenateDistrict) districtParts.push(`State Senate Dist. ${districts.stateSenateDistrict}`);
      if (districtParts.length > 0) {
        contextItems.push({
          label: "Political Districts",
          value: districtParts.slice(0, 2).join(" · "),
          detail: districtParts.length > 2 ? districtParts.slice(2).join(" · ") : undefined,
        });
      }
    }

    if (contextItems.length > 0) {
      if (reportType === "site-incentives" || reportType === "location-incentives") {
        // Prepend as "Site Overview" — first section users see
        report.sections.unshift({
          title: "Site Overview",
          description: "Zoning, property, and district data for this address.",
          items: contextItems,
        });
      } else {
        report.sections.unshift({
          title: "Location Context",
          items: contextItems,
        });
      }
    }

    // For developer-analysis, add a dedicated Property Analysis subsection
    if ((reportType === "dev-feasibility" || reportType === "developer-analysis") && parcel && parcel.pin) {
      const propertyItems: ReportItem[] = [
        {
          label: "Property PIN",
          value: parcel.pin,
          url: `https://www.cookcountyassessoril.gov/pin/${parcel.pin}`,
        },
        {
          label: "Building Class",
          value: `${parcel.classCode} — ${parcel.classDescription}`,
          detail: parcel.isCommercial ? "Commercial property" : parcel.isIndustrial ? "Industrial property" : parcel.isVacant ? "Vacant land" : "Residential property",
        },
      ];
      if (parcel.totalValue) {
        propertyItems.push({
          label: "Total Assessed Value",
          value: parcel.totalValue,
          detail: [parcel.landValue && `Land: ${parcel.landValue}`, parcel.bldgValue && `Building: ${parcel.bldgValue}`].filter(Boolean).join(" · "),
        });
      }
      if (parcel.taxCode || parcel.township) {
        propertyItems.push({
          label: "Tax Code / Township",
          value: [parcel.taxCode, parcel.township].filter(Boolean).join(" · "),
        });
      }
      if (isClass7aEligible(parcel.classCode)) {
        propertyItems.push({
          label: "Class 7a Eligibility",
          value: "Potentially eligible",
          detail: `Property class ${parcel.classCode} may qualify for reduced assessment (10% of market value for commercial/industrial rehab)`,
        });
      }
      if (districts) {
        const parts: string[] = [];
        if (districts.ward) parts.push(`Ward ${districts.ward}`);
        if (districts.commissionerDistrict) parts.push(`Commissioner Dist. ${districts.commissionerDistrict}`);
        if (districts.congressionalDistrict) parts.push(`IL-${districts.congressionalDistrict}`);
        if (districts.stateHouseDistrict) parts.push(`State Rep Dist. ${districts.stateHouseDistrict}`);
        if (districts.stateSenateDistrict) parts.push(`State Senate Dist. ${districts.stateSenateDistrict}`);
        if (parts.length > 0) {
          propertyItems.push({
            label: "Political Districts",
            value: parts.join(" · "),
          });
        }
      }

      // Insert after Location Context / Site Profile
      const locCtxIdx = report.sections.findIndex((s) => s.title === "Location Context" || s.title === "Site Profile" || s.title === "Site Overview");
      report.sections.splice(locCtxIdx + 1, 0, {
        title: "Property Analysis",
        items: propertyItems,
      });
    }
  }

  // Attach executive summary for address-based reports when zone data is available
  if (zones && zoneNames && reportType !== "program-explorer") {
    // Run confidence engine once for exec summary (lightweight — it's already cached in location-incentives)
    const execResults = runConfidenceEngine(programs, zones, zoneNames, undefined, ctx.parcel);
    report.executiveSummary = generateExecutiveSummary(programs, zones, zoneNames, undefined, execResults);
  }

  return report;
}
