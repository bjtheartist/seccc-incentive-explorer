import type {
  Program,
  ExecutiveSummary,
  ParcelData,
  DistrictData,
  StackingRule,
  CommunityAsset,
  Stats,
  PublicMatchExplanation,
  ChicagoZbaLookupResponse,
  ZoningLookupResponse,
  ZoningSourceMetadata,
  CostSignalTag,
} from "./types";
import {
  inferSupportLanes,
  type LocalBusinessSupportContext,
  type LocalBusinessSupportOrganization,
  type LocalSupportLane,
} from "./local-business-support";
import type { SiteSignals } from "./site-signals";
import type { TransportAccess } from "./transport-access";
import type { MobilityAccess, MobilityAccessLine, MobilityAccessPoint } from "./mobility-access";
import { buildLocationContext, publicParcelContext } from "./location-context";
import type { LocationContext } from "./location-context";
import { isClass7aEligible } from "./parcel-classes";
import { formatMiles } from "./transport-access";
import { ZONE_LABELS, ZONE_DESCRIPTIONS } from "./constants";
import { getIndustryById } from "./industries-data";
import { generateExecutiveSummary, computeStackingNarrative, runConfidenceEngine, isStaleProgramData } from "./confidence-engine";
import type { LegacyEligibilityConfidence, ProgramRelevance, ProgramCheckResult } from "./types";
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
  selectedProjectGoalLabels,
  selectedProjectGoals,
} from "./report-wizard-config";
import { deadlinesForAddress, type TifFinancialsSlim, type SbifWindow } from "./deadlines";
import {
  resolveAvailability,
  type AvailabilityState,
  type ResolveAvailabilityOpts,
} from "./program-gating";
import {
  compareProjectGoalFit,
  isProjectGoalMatch,
  orderProgramCheckResultsByProjectGoals,
  projectGoalFit,
  projectGoalsFit,
  summarizeProjectFit,
} from "./project-fit";
import {
  DOCUMENT_PREPARATION_COST_CAVEAT,
  DOCUMENT_PREPARATION_COST_LEGEND,
  classifyDocumentPreparationCost,
  classifyPreparationStepCost,
  isDocumentRequirementGuidance,
  type DocumentPreparationCostSignal,
} from "./document-preparation-cost";
import type { ProjectFit, ProjectFitSummary } from "./project-fit";
import type { CapitalMatchResult, CapitalPartnerMatch } from "./capital-partners";
import {
  CAPITAL_PARTNER_SECTION_ID,
  CAPITAL_PARTNER_SECTION_TITLE,
  capitalPartnerHandoffForReport,
} from "./capital-partner-report";
import { addPartnerReferralAttribution } from "./partner-referrals";
import { buildPublicMatchExplanation, type PublicMatchEvidence } from "./match-transparency";
import {
  isSupportOrganizationSectionTitle,
  SUPPORT_ORGANIZATION_AVAILABILITY_LINE,
  SUPPORT_ORGANIZATIONS_CAPACITY_NOTE,
  SUPPORT_ORGANIZATIONS_DESCRIPTION,
  SUPPORT_ORGANIZATIONS_SECTION_ID,
  SUPPORT_ORGANIZATIONS_SECTION_TITLE,
} from "./support-organization-copy";
import { buildStartHere, selectTopPrograms, type StartHere, type UnresolvedZoningQuestion } from "./start-here";
import { authorityReferenceLine } from "./authority-routing";
import { policeDistrictLabel } from "./police-districts";
import { loadCapitalContextForArea, type CraYearRow } from "./investment-analysis";

export type { StartHere, StartHereAction, StartHereActionKind, StartHereEvidence } from "./start-here";
export { buildStartHere, selectTopPrograms } from "./start-here";

// ─── Local Types ────────────────────────────────────────────────────

export type ReportType =
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
  projectGoals?: string[];
  projectType: string;
  customGoal?: string;
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
  /**
   * Stable kebab-case identifier for this section, set at every construction
   * site below. Renderers and the PDF builder should match sections on `id`,
   * falling back to `title` only for saved reports persisted before this
   * field existed (those have no `id` in their stored JSON). `title` remains
   * purely a display string — do not match logic against it going forward.
   */
  id?: string;
  title: string;
  description?: string;
  table?: {
    columns: string[];
    rows: string[][];
  };
  items: ReportItem[];
  /**
   * Persona lens (Tier 1b): when a non-"All" lens is active this section holds
   * the programs that fall outside the lens. The UI renders it as a collapsed
   * ("Also at this address") disclosure — collapse, never hide. Absent on the
   * canonical report; only the lensed view sets it.
   */
  collapsedByPersona?: boolean;
}

export interface ReportDetailGroup {
  id: string;
  label: string;
  items: string[];
}

export interface ReportItem {
  label: string;
  value: string;
  detail?: string;
  detailGroups?: ReportDetailGroup[];
  detailCaveat?: string;
  /** Internal ordering context; stripped before any public report serialization. */
  projectFit?: ProjectFitSummary;
  programId?: string;
  partnerId?: string;
  color?: string;
  /**
   * review6 S11 investigation: this field used to carry raw
   * `program.whoQualifies` catalog prose — the exact internal-only field
   * `lib/program-public.ts`'s `PublicProgramView` deliberately excludes,
   * and for the identical reason (it can assert/imply a determination
   * this tool has no authority to make). `programReportItem()` and the
   * TIF-deadline item builder both used to populate it, and
   * app/report/page.tsx / components/report/ReportDisplay.tsx both
   * rendered it verbatim under "Published Applicant Requirements" — a
   * real, live leak, independent of the /api/programs/engine-source
   * route S11 is about. `eligibilityRules` below (rendered as the safe,
   * structured "Requirements" list right next to where this used to
   * render) already carries the same underlying fact, safely. Removed
   * rather than fixed-in-place: no legitimate caller should ever
   * repopulate this with raw prose again.
   */
  eligibilityRules?: { description: string; required: boolean }[];
  url?: string;
  level?: string;
  matchExplanation?: PublicMatchExplanation;
  /**
   * @deprecated Legacy saved-report field. Never written any more; still typed
   * so reports persisted in saved_reports.report_data_json before the
   * ProgramRelevance rename decode and get stripped rather than fail. The
   * retired eligibility vocabulary lives on only here.
   */
  confidenceLevel?: LegacyEligibilityConfidence;
  /** @deprecated Legacy saved-report field. Public renderers ignore it. */
  confidenceLabel?: string;
  /** @deprecated Legacy saved-report field. Public renderers ignore it. */
  whyOneLine?: string;
  /** @deprecated Legacy saved-report field. Public renderers normalize it into stillToConfirm. */
  notVerified?: string[];
  /** @deprecated Legacy saved-report field. Public renderers normalize it as user-provided context. */
  matchedRules?: string[];
  lastVerifiedAt?: string | null;
  isStale?: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
  applicationPortals?: Program["applicationPortals"];
  verificationSteps?: Program["verificationSteps"];
  status?: Program["status"];
  /** Availability gating state (lib/program-gating). 'expired' items never reach a report. */
  availability?: AvailabilityState;
  /** Status note rendered for 'window-closed' and 'lapsed-notice' items. */
  availabilityNote?: string;
  /** Qualitative cost/effort signal for preparing this document or step. */
  preparationCost?: DocumentPreparationCostSignal;
  /**
   * Program-card content fields (persona spec v2 amendment). Every one is
   * DERIVED from data the program catalog already carries (published
   * benefit text, the committed stacking-rules dataset, existing source/
   * contact URLs) — never hand-authored prose. A program whose real data
   * doesn't support a field simply doesn't carry it (honest omission, no
   * placeholder) — see buildWorksWith/buildVerifySources/buildExpectations
   * in this file.
   */
  worksWith?: { label: string; detail: string }[];
  verifySources?: { label: string; url: string; dated?: string | null }[];
  expectations?: string;
  /**
   * "Cost signals" pills (gate finding 4). Built by buildCostSignals from
   * the program's own `costSignals` catalog field ONLY — never derived
   * from benefits[]/requiredDocs[] text. Absent when the catalog record
   * carries no confirmed cost-signal tags.
   */
  costSignals?: { label: string; severity: "info" | "amber" }[];
  /**
   * Raw ISO date (YYYY-MM-DD) for an "Upcoming Deadlines" item — the same
   * `item.date` lib/deadlines.ts already resolves correctly per-address
   * (SBIF window start, TIF expiration, program deadline), carried through
   * unformatted so chart components can plot it. `value` on these items
   * stays the human "In 5 days — 2026-03-01" display string; this is only
   * for chart math. Set only on items in the deadlines section.
   */
  deadlineDate?: string;
  /** Which kind of deadline this is — see lib/deadlines.ts DeadlineKind. */
  deadlineKind?: "program_deadline" | "sbif_window" | "tif_expiration";
  /** Window close date (ISO) — set only for deadlineKind="sbif_window". */
  deadlineWindowEnd?: string;
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
  tifFinance?: {
    districtId?: string | null;
    districtName?: string | null;
    reportYear?: number | null;
    expirationDate?: string | null;
    expirationYear?: number | null;
    boundaryWards?: string | null;
    fundBalance?: number | null;
    taxAllocationFundBalance?: number | null;
    propertyTaxIncrementCurrent?: number | null;
    cashExpenses?: number | null;
    totalExpenditure?: number | null;
    netIncome?: number | null;
    distributionOfSurplus?: number | null;
    amountDesignatedDebtObligations?: number | null;
    amountDesignatedProjectCosts?: number | null;
    surplusDeficit?: number | null;
    sourceLabel?: string;
    sourceUrl?: string;
    caution?: string;
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

export interface ActionRoadmapItem {
  tier: "do-this-week" | "start-gathering" | "worth-exploring";
  programId?: string;
  programName?: string;
  label: string;
  description: string;
  contact?: { agency: string; phone?: string; email?: string; role?: string };
  callScript?: string;
  documents?: string[];
  preparationCost?: DocumentPreparationCostSignal;
}

export type PublicReportLocationContext = Omit<LocationContext, "posture" | "programs">;

export interface GeneratedReport {
  /**
   * Version of the *persisted* report shape, stamped when a report is written
   * to storage (see `lib/report-schema.ts`). Absent on freshly generated
   * in-memory reports and on everything saved before this field existed —
   * both of which are version 1 by definition, so `undefined` must always be
   * read as 1 and never as "unknown" or "invalid". Nothing in the engine or
   * the UI should branch on it; it exists so `normalizeSavedReport` can tell
   * an old saved blob from one written by a newer deploy.
   */
  schemaVersion?: number;
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
    preparationCost?: DocumentPreparationCostSignal;
  }[];
  metadata: {
    address?: string;
    lat?: number;
    lon?: number;
    industry?: string;
    budgetRange?: string;
    projectGoals?: string[];
    projectType?: string;
    customGoal?: string;
    proposedUse?: string;
    medianIncome?: number;
    medianHomeValue?: number;
    zoneClass?: string;
    zoneType?: string;
    corridorType?: string;
    corridorId?: string;
    corridorLabel?: string;
    /** Business or contact name for the cover page's "PREPARED FOR" line.
     *  Rendered only when present — most callers don't set it yet. */
    preparedFor?: string;
  };
  executiveSummary?: ExecutiveSummary;
  actionRoadmap?: ActionRoadmapItem[];
  verdict?: {
    /** @deprecated Internal generation hint. Public normalization removes it. */
    signal?: "strong" | "moderate" | "limited";
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
    organizations?: {
      id?: string;
      name: string;
      type: string;
      role: string;
      address?: string;
      phone?: string;
      website?: string;
      detail?: string;
      supportLanes?: LocalSupportLane[];
      supportTypes?: string;
      serviceGeography?: string;
    }[];
    communityArea?: string;
    /**
     * Organizations mapped for the community area, before the display cap.
     * Set only when a caller actually supplied more organizations than the cap
     * lists — the production API caps at the same six this report shows and
     * publishes no total, so the mapped total is usually unknown and must never
     * be inferred from the length of an already-capped list.
     */
    totalOrganizations?: number;
    /**
     * True when the received list had already reached the display cap, so the
     * listed count is a floor and more organizations may be mapped for the area.
     */
    listingMayBeIncomplete?: boolean;
    /**
     * How the listed organizations were picked. The community-area branch
     * matches published service areas; the asset-directory fallback does no
     * matching at all, and the section copy must not claim otherwise. Absent
     * on hand-built fixtures and on reports saved before this field existed —
     * treated as "basis unknown", never as the matched case.
     */
    selectionBasis?: "community-area-match" | "asset-directory";
    narrative: string;
  };
  /**
   * Supporter persona — corridor-investment-by-year chart source (gate
   * finding 5). The FFIEC CRA small-business loan-origination series for
   * this report's community area, read server-side at generation time from
   * data/private/capital-context.json via loadCapitalContextForArea
   * (lib/investment-analysis.ts). Canonical, not lens-time: this is real
   * committed data the engine already resolves the community area for, only
   * reorganized into a chart-ready shape. Null when the address resolved no
   * community area, or the file carries no CRA series for it — never a
   * fabricated or zero-filled series.
   */
  corridorInvestment?: { communityArea: string; series: CraYearRow[]; source: string } | null;
  capitalPartnerHandoff?: CapitalMatchResult;
  neighborhoodEconomics?: NeighborhoodEconomicContext;
  locationContext?: PublicReportLocationContext;
  dataSources?: DataSourceCitation[];
  /**
   * The canonical "start here" action model (see lib/start-here.ts).
   * Additive and optional: it does not replace `executiveSummary.topActions`,
   * `actionRoadmap`, or `recommendedActions` — those are refactored to
   * DERIVE from the same underlying selection so they cannot disagree with
   * this field, but this field is what a future single "start here" surface
   * would render from. Absent on report types outside the executive-summary
   * gate (currently: program-explorer, or any report generated without
   * zones/zoneNames) and on every report saved before this field existed —
   * both read as "not built for this report," never as an error.
   */
  startHere?: StartHere;
}

export const CONFIRMED_PROGRAMS_SECTION_TITLE = "Programs Mapped at This Address";
export const GOAL_MATCH_PROGRAMS_SECTION_TITLE = "Programs to Review for Your Goal";
export const OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE = "Other Programs Mapped at This Address";

export const CONFIRMED_PROGRAMS_SECTION_ID = "programs-mapped-at-this-address";
export const GOAL_MATCH_PROGRAMS_SECTION_ID = "programs-to-review-for-your-goal";
export const OTHER_CONFIRMED_PROGRAMS_SECTION_ID = "other-programs-mapped-at-this-address";

const LEGACY_CONFIRMED_PROGRAMS_SECTION_TITLE = "Eligible Incentive Programs";
const LEGACY_OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE = "Other Programs Tied to This Address";

const CONFIRMED_PROGRAMS_SECTION_TITLES = new Set([
  CONFIRMED_PROGRAMS_SECTION_TITLE,
  GOAL_MATCH_PROGRAMS_SECTION_TITLE,
  OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
  LEGACY_CONFIRMED_PROGRAMS_SECTION_TITLE,
  LEGACY_OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
]);

/**
 * Stable kebab-case ids for the report sections that are constructed as
 * literal `title:` strings below (i.e. not already backed by an exported
 * *_SECTION_TITLE constant). Renderers/PDF code should key off these ids,
 * not the English title, so a copy edit never silently breaks selection.
 * Keys are grouped by the semantic slot they identify — several construction
 * sites intentionally share an id (e.g. "Additional Programs to Explore" is
 * built by more than one report generator for the same semantic section).
 */
export const SECTION_IDS = {
  vacancyProjectIntake: "vacancy-project-intake",
  projectIntake: "project-intake",
  documentReadinessChecklist: "document-readiness-checklist",
  neighborhoodEconomicContext: "neighborhood-economic-context",
  localImpactAnchors: "local-impact-anchors",
  incentiveZoneCoverage: "incentive-zone-coverage-program-interactions",
  additionalProgramsToExplore: "additional-programs-to-explore",
  requiredDocuments: "required-documents",
  tifFinancialContext: "tif-financial-context",
  upcomingDeadlines: "upcoming-deadlines-near-this-address",
  siteDescriptionPropertyProfile: "site-description-property-profile",
  zoningRegulatoryReview: "zoning-regulatory-review",
  locationContext: "location-context",
  programsMappedAtThisSite: "programs-mapped-at-this-site",
  decisionFactors: "decision-factors",
  incentivePathwayReview: "incentive-pathway-review",
  applicationRoadmap: "application-roadmap",
  noProgramsMatchCurrentFilters: "no-programs-match-current-filters",
  marketSignalSummary: "market-signal-summary",
  pilotBaseline: "pilot-baseline",
  whatTheSignalsSay: "what-the-signals-say",
  ownerOperatorMap: "owner-operator-map",
  howToReadThis: "how-to-read-this",
  whatAFundedVersionUnlocks: "what-a-funded-version-unlocks",
  siteFacts: "site-facts",
  zoningUseStartingPoint: "zoning-use-starting-point",
  propertyAnalysis: "property-analysis",
  logisticsAccess: "logistics-access",
  civicRepresentation: "civic-representation",
  documentReadiness: "document-readiness",
  contactSheet: "contact-sheet",
} as const;

/** Kebab-case id for a `${level}-Level Programs` section, e.g. "city-level-programs". */
function levelProgramsSectionId(level: string): string {
  return `${level.toLowerCase()}-level-programs`;
}

/**
 * Marker sets used to find "the property/zoning context section, whichever
 * one this report type built" without matching literal English titles.
 * "Site Profile" and "Site Overview" are kept in the title sets only as a
 * historical fallback — no current builder emits either title — so an old
 * saved report using those titles still matches.
 */
const LOCATION_CONTEXT_MARKER_IDS = new Set<string>([
  SECTION_IDS.locationContext,
  SECTION_IDS.siteFacts,
  SECTION_IDS.zoningUseStartingPoint,
]);
const LOCATION_CONTEXT_MARKER_TITLES = new Set([
  "Location Context",
  "Site Profile",
  "Site Facts",
  "Zoning & Use Starting Point",
]);
const CONTEXT_SECTION_MARKER_IDS = new Set<string>([
  SECTION_IDS.zoningUseStartingPoint,
  SECTION_IDS.siteFacts,
  SECTION_IDS.locationContext,
  SECTION_IDS.propertyAnalysis,
]);
const CONTEXT_SECTION_MARKER_TITLES = new Set([
  "Zoning & Use Starting Point",
  "Site Facts",
  "Site Overview",
  "Location Context",
  "Property Analysis",
]);

/**
 * Probe program for goal-rule lookups. `projectGoalFit` returns undefined for
 * exactly one reason — project-fit has no GOAL_RULES entry for the goal — so
 * asking it about a blank program answers "does this goal rank anything?"
 * without needing the rule table exported.
 */
const GOAL_RULE_PROBE_PROGRAM = { id: "", name: "" };

/**
 * The goals that actually ordered the programs. Every structured goal has a
 * rule; "Something else" is open text and has none, so it is scored nowhere.
 * Copy that lists it alongside the ranked goals claims an ordering the engine
 * never performed, so split the two before writing the sentence. Probing the
 * rule table rather than hard-coding "other" keeps this correct if a goal is
 * ever added to the wizard ahead of its rule.
 */
function partitionGoalLabelsByOrderingUse(
  goalIds: readonly string[],
  goalLabels: readonly string[],
): { ordering: string[]; contextOnly: string[] } {
  const ordering: string[] = [];
  const contextOnly: string[] = [];
  goalIds.forEach((goalId, index) => {
    const label = goalLabels[index];
    if (!label) return;
    if (projectGoalFit(GOAL_RULE_PROBE_PROGRAM, goalId)) ordering.push(label);
    else contextOnly.push(label);
  });
  return { ordering, contextOnly };
}

/** "A", "A and B", "A, B, and C" — used in the goal sentences below. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Exported (build-spec.md 2.5) so the concierge output validator
// (lib/concierge/output-validator.ts) can run the SAME determination-
// phrase normalizer over model-generated text before it is ever shown to
// a visitor — one vocabulary, not a second copy tuned separately for chat.
export function normalizePublicDeterminationText(value: string): string {
  return value
    .replace(/eligible incentive programs/gi, CONFIRMED_PROGRAMS_SECTION_TITLE)
    .replace(/other programs tied to this address/gi, OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE)
    .replace(/address-confirmed programs?/gi, (match) =>
      match.toLowerCase().endsWith("s") ? "programs mapped at this address" : "program mapped at this address",
    )
    .replace(/appears eligible(?: \(based on location\))?/gi, "Included for review")
    .replace(/(?:high|medium|low) match/gi, "Program review")
    .replace(/(?:this\s+)?(?:site|property|business|project|address|neighborhood)\s+may qualify for/gi, "This location requires review for")
    .replace(/you may qualify|you qualify/gi, "Review the published requirements")
    .replace(/\bmay qualify for\b/gi, "may require review for")
    .replace(/(?:this\s+)?(?:site|property|business|project|address)\s+(?:is\s+)?potentially eligible for/gi, "This location is recorded for review of")
    .replace(/(?:this\s+)?(?:site|property|business|project|address)\s+qualifies for/gi, "This location is recorded for review of")
    .replace(/(?:this\s+)?(?:site|property|business|project|address)\s+may be eligible for/gi, "This location requires review for")
    .replace(/potentially eligible/gi, "Requirements to review")
    .replace(/eligibility confirmed/gi, "location recorded");
}

function normalizePublicHeadlineText(value: string): string {
  const normalized = normalizePublicDeterminationText(value);
  const money = "\\$[\\d,.]+(?:\\s*[-–]\\s*\\$?[\\d,.]+)?(?:\\s*[KMB])?\\b";
  const incentiveType = "(?:incentive|benefit|award|grant|credit|reimbursement)s?";
  const speculative = "(?:possible|potential|estimated|projected)";
  return normalized
    .replace(new RegExp(String.raw`${speculative}\s+${incentiveType}[^.!?]{0,35}${money}`, "gi"), "published program terms")
    .replace(new RegExp(String.raw`${speculative}\s+${money}\s*${incentiveType}`, "gi"), "published program terms")
    .replace(new RegExp(String.raw`${money}[^.!?]{0,24}${speculative}\s+${incentiveType}`, "gi"), "published program terms")
    .replace(new RegExp(String.raw`(?:benefit\s+range|incentive\s+estimate)[^.!?]{0,35}${money}`, "gi"), "published program terms")
    .replace(new RegExp(String.raw`(?:could|may)\s+receive[^.!?]{0,35}${money}`, "gi"), "published program terms")
    .replace(new RegExp(String.raw`Review the published requirements[^.!?]{0,45}up to\s+${money}`, "gi"), "Review the published requirements and published program terms")
    .replace(/published program terms\s*(?:benefit|award|incentive)?/gi, "published program terms")
    .replace(/\b(?:a|an) published program terms\b/gi, "published program terms")
    .replace(/(?:a\s+)?program review program/gi, "a program selected for review")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizePublicMatchExplanation(
  explanation: PublicMatchExplanation,
  additionalPublicFacts: readonly string[] = [],
): PublicMatchExplanation {
  const selfReportedPattern = /^(?:(?:you|your)\b|(?:reported|selected|provided|entered|stated)\b)|\b(?:user answer|self-reported)\b/i;
  const misplacedUserAnswers = explanation.knownFromPublicData.filter((item) =>
    selfReportedPattern.test(item),
  );
  // Reports saved before buildPublicMatchExplanation split guidance out of
  // requiredDocs still carry catalog guidance ("No formal documents required to
  // get started") inside currentDocumentsToGather, where the "Documents to
  // gather" heading turns it into a requirement the record explicitly denies.
  // This sanitizer is the one point every display and PDF path funnels stored
  // explanations through, so apply the same split here. The strings are still
  // published statements, so they move to the public-facts list, never dropped.
  // The ?? guards saved payloads written before the field existed.
  const storedDocuments = explanation.currentDocumentsToGather ?? [];
  const documentGuidance = storedDocuments.filter(isDocumentRequirementGuidance);
  return {
    ...explanation,
    whyItAppears: explanation.whyItAppears.map(normalizePublicHeadlineText),
    knownFromPublicData: Array.from(new Set([
      ...explanation.knownFromPublicData.filter((item) => !selfReportedPattern.test(item)),
      ...documentGuidance,
      ...additionalPublicFacts,
    ])).map(normalizePublicHeadlineText),
    basedOnUserAnswers: Array.from(new Set([
      ...explanation.basedOnUserAnswers,
      ...misplacedUserAnswers,
    ])).map(normalizePublicHeadlineText),
    stillToConfirm: explanation.stillToConfirm.map(normalizePublicHeadlineText),
    currentDocumentsToGather: storedDocuments.filter(
      (doc) => !isDocumentRequirementGuidance(doc),
    ),
  };
}

interface LegacyDocumentGuidance {
  text: string;
  programAttribution?: string;
}

function legacyRequiredDocumentGuidance(
  value: string,
  programNames: readonly string[],
): LegacyDocumentGuidance | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withCostAndAttribution = trimmed.match(
    /^(.*?)\s+\[(?:\?|\${1,3})\]\s+[—–-]\s+(.+)$/,
  );
  if (withCostAndAttribution) {
    const text = withCostAndAttribution[1].trim();
    return isDocumentRequirementGuidance(text)
      ? { text, programAttribution: withCostAndAttribution[2].trim() }
      : null;
  }

  const attributionSeparator = trimmed.lastIndexOf(" — ");
  if (attributionSeparator > 0) {
    const text = trimmed.slice(0, attributionSeparator).trim();
    const programAttribution = trimmed.slice(attributionSeparator + 3).trim();
    if (
      programNames.some((programName) => programAttribution.includes(programName)) &&
      isDocumentRequirementGuidance(text)
    ) {
      return { text, programAttribution };
    }
  }

  const text = trimmed.replace(/\s+\[(?:\?|\${1,3})\]\s*$/, "").trim();
  return isDocumentRequirementGuidance(text) ? { text } : null;
}

function guidanceForProgram(
  guidance: readonly LegacyDocumentGuidance[],
  programName: string,
): string[] {
  return guidance
    .filter((item) => item.programAttribution?.includes(programName))
    .map((item) => item.text);
}

function sanitizeLegacyRequiredDocumentsSections(
  sections: readonly ReportSection[],
  programNames: readonly string[],
): { sections: ReportSection[]; guidance: LegacyDocumentGuidance[] } {
  const guidance: LegacyDocumentGuidance[] = [];
  const sanitizedSections: ReportSection[] = [];

  for (const section of sections) {
    if (section.title !== "Required Documents") {
      sanitizedSections.push(section);
      continue;
    }

    let sawDocumentCategory = false;
    let documentCount = 0;
    const items: ReportItem[] = [];

    for (const item of section.items) {
      const directGuidance = [item.label, item.value]
        .map((value) => legacyRequiredDocumentGuidance(value, programNames))
        .find((value): value is LegacyDocumentGuidance => Boolean(value));
      if (directGuidance) {
        guidance.push({
          ...directGuidance,
          programAttribution: directGuidance.programAttribution ??
            (item.programId ? item.label : undefined),
        });
        continue;
      }

      const isDocumentCategory = /^\d+\s+documents?$/i.test(item.value.trim());
      const detailLines = (item.detail ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const retainedDetailLines: string[] = [];

      for (const line of detailLines) {
        const lineGuidance = legacyRequiredDocumentGuidance(line, programNames);
        if (lineGuidance) guidance.push(lineGuidance);
        else retainedDetailLines.push(line);
      }

      if (isDocumentCategory) {
        sawDocumentCategory = true;
        documentCount += retainedDetailLines.length;
        if (retainedDetailLines.length === 0) continue;
        items.push({
          ...item,
          value: `${retainedDetailLines.length} document${retainedDetailLines.length === 1 ? "" : "s"}`,
          detail: retainedDetailLines.join("\n"),
        });
        continue;
      }

      if (detailLines.length > 0 && retainedDetailLines.length === 0 && !item.programId) {
        continue;
      }

      items.push({
        ...item,
        detail: detailLines.length > 0
          ? retainedDetailLines.join("\n") || undefined
          : item.detail,
      });
    }

    if (items.length === 0) continue;

    sanitizedSections.push({
      ...section,
      description: sawDocumentCategory && section.description
        ? section.description.replace(
            /\b\d+\s+documents?\b/i,
            `${documentCount} document${documentCount === 1 ? "" : "s"}`,
          )
        : section.description,
      items,
    });
  }

  return { sections: sanitizedSections, guidance };
}

function isProgramListingSection(title: string): boolean {
  return CONFIRMED_PROGRAMS_SECTION_TITLES.has(title)
    || title === "Additional Programs to Explore"
    || /^Programs Mapped at This Site(?: \(\d+\))?$/.test(title)
    || title === "Incentive Pathway Review"
    || /^.+-Level Programs$/.test(title);
}

function normalizeSupportOrganizationDetail(detail?: string): string | undefined {
  const lines = (detail ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Status:/i.test(line))
    .map(normalizePublicHeadlineText);

  if (!lines.some((line) => /^Availability:/i.test(line))) {
    lines.push(SUPPORT_ORGANIZATION_AVAILABILITY_LINE);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function legacyMatchExplanation(
  item: ReportItem,
  additionalPublicFacts: readonly string[] = [],
): PublicMatchExplanation | undefined {
  if (!item.programId) return undefined;
  const requirements = (item.eligibilityRules ?? []).map((rule) => rule.description);
  const matchedRules = (item.matchedRules ?? []).map(normalizePublicHeadlineText);
  const notVerified = (item.notVerified ?? []).map(normalizePublicHeadlineText);
  const stillToConfirm = Array.from(new Set([...notVerified, ...requirements]));
  const sourceUrl = item.sourceUrl || item.url;
  const source = sourceUrl
    ? {
        label: normalizePublicHeadlineText(
          item.sourceLabel || `Official ${item.label} source`,
        ),
        url: sourceUrl,
      }
    : undefined;

  if (item.matchExplanation) {
    const normalized = normalizePublicMatchExplanation(
      item.matchExplanation,
      additionalPublicFacts,
    );
    return {
      ...normalized,
      basedOnUserAnswers: Array.from(new Set([
        ...normalized.basedOnUserAnswers,
        ...matchedRules,
      ])),
      stillToConfirm: Array.from(new Set([
        ...normalized.stillToConfirm,
        ...stillToConfirm,
      ])),
      officialSource: normalized.officialSource ?? source,
      lastVerifiedAt: normalized.lastVerifiedAt ?? item.lastVerifiedAt,
    };
  }

  return {
    whyItAppears: ["This program was included in the saved report as a starting point for review."],
    knownFromPublicData: [
      ...(item.lastVerifiedAt
        ? [`Program information was last reviewed on ${item.lastVerifiedAt}.`]
        : []),
      ...additionalPublicFacts,
    ],
    basedOnUserAnswers: Array.from(new Set(matchedRules)),
    stillToConfirm,
    currentDocumentsToGather: [],
    confirmWith: [],
    officialSource: source,
    lastVerifiedAt: item.lastVerifiedAt,
  };
}

/** Normalize legacy saved reports before any public UI or PDF rendering. */
export function normalizePublicReportForDisplay(report: GeneratedReport): GeneratedReport {
  const legacySummary = report.executiveSummary as unknown as {
    topPrograms?: Array<{
      programId: string;
      name: string;
      explanation?: PublicMatchExplanation;
      matchedRules?: string[];
      notVerified?: string[];
    }>;
    topActions?: ExecutiveSummary["topActions"];
    zoneCount?: number;
    whyTheseMatter?: string;
    projectGoalLabel?: string;
    projectGoalLabels?: string[];
  } | undefined;

  const programNames = Array.from(new Set([
    ...(legacySummary?.topPrograms ?? []).map((program) => program.name),
    ...report.sections.flatMap((section) =>
      section.items
        .filter((item) => Boolean(item.programId))
        .map((item) => item.label),
    ),
  ])).sort((a, b) => b.length - a.length);
  const legacyDocuments = sanitizeLegacyRequiredDocumentsSections(
    report.sections,
    programNames,
  );

  const executiveSummary = legacySummary
    ? {
        topPrograms: (legacySummary.topPrograms ?? []).map((program) => ({
          programId: program.programId,
          name: program.name,
          explanation: normalizePublicMatchExplanation(
            program.explanation ?? {
              whyItAppears: ["This program was included in the saved report as a starting point for review."],
              knownFromPublicData: [],
              basedOnUserAnswers: Array.from(new Set(program.matchedRules ?? [])),
              stillToConfirm: Array.from(new Set(program.notVerified ?? [])),
              currentDocumentsToGather: [],
              confirmWith: [],
            },
            guidanceForProgram(legacyDocuments.guidance, program.name),
          ),
        })),
        topActions: (legacySummary.topActions ?? []).map((action) => ({
          ...action,
          label: normalizePublicHeadlineText(action.label),
        })),
        zoneCount: legacySummary.zoneCount ?? 0,
        whyTheseMatter: normalizePublicHeadlineText(legacySummary.whyTheseMatter ?? ""),
        projectGoalLabel: legacySummary.projectGoalLabel,
        projectGoalLabels: legacySummary.projectGoalLabels,
      }
    : undefined;

  const rawLocationContext = report.locationContext as LocationContext | undefined;
  const publicLocationContext = rawLocationContext
    ? (() => {
        const {
          posture: _posture,
          programs: _programs,
          ...publicContext
        } = rawLocationContext;
        void _posture;
        void _programs;
        return publicContext;
      })()
    : undefined;

  return {
    ...report,
    title: normalizePublicHeadlineText(report.title),
    subtitle: normalizePublicHeadlineText(report.subtitle),
    summary: normalizePublicHeadlineText(report.summary),
    executiveSummary,
    locationContext: publicLocationContext,
    verdict: report.verdict
      ? {
          headline: normalizePublicHeadlineText(report.verdict.headline),
          subheadline: normalizePublicHeadlineText(report.verdict.subheadline),
          topReasons: report.verdict.topReasons.map(normalizePublicHeadlineText),
        }
      : undefined,
    actionRoadmap: report.actionRoadmap?.map((item) => ({
      ...item,
      label: normalizePublicHeadlineText(item.label),
      description: normalizePublicHeadlineText(item.description),
      callScript: item.callScript
        ? normalizePublicHeadlineText(item.callScript)
        : undefined,
    })),
    recommendedActions: report.recommendedActions.map((action) => ({
      ...action,
      label: normalizePublicHeadlineText(action.label),
      description: normalizePublicHeadlineText(action.description),
    })),
    startHere: report.startHere
      ? {
          ...report.startHere,
          primary: {
            ...report.startHere.primary,
            label: normalizePublicHeadlineText(report.startHere.primary.label),
            description: normalizePublicHeadlineText(report.startHere.primary.description),
          },
          secondary: report.startHere.secondary.map((action) => ({
            ...action,
            label: normalizePublicHeadlineText(action.label),
            description: normalizePublicHeadlineText(action.description),
          })),
          unresolvedQuestions: report.startHere.unresolvedQuestions.map(normalizePublicHeadlineText),
          evidence: report.startHere.evidence.map((fact) => ({
            ...fact,
            fact: normalizePublicHeadlineText(fact.fact),
          })),
        }
      : undefined,
    sections: legacyDocuments.sections.map((section) => {
      const programListingSection = isProgramListingSection(section.title);
      const supportOrganizationSection = isSupportOrganizationSectionTitle(section.title);
      return {
        ...section,
        // Backfill the id even for reports saved before this field existed,
        // so downstream matching (PDF builder, ReportDisplay) can key off id
        // for the normalized support-organizations section regardless of the
        // report's save vintage.
        id: supportOrganizationSection ? SUPPORT_ORGANIZATIONS_SECTION_ID : section.id,
        title: supportOrganizationSection
          ? SUPPORT_ORGANIZATIONS_SECTION_TITLE
          : normalizePublicHeadlineText(section.title),
        // This stamp exists to get the current selection/capacity copy onto
        // saved reports that predate it. It used to overwrite unconditionally,
        // which also flattened the asset-directory fallback — whose
        // organizations were matched on nothing — into "Selected using
        // published service areas, project types, and support services".
        // A description that already carries the capacity note is
        // current-generation copy the builder chose on purpose; leave it.
        description: supportOrganizationSection
          ? section.description?.includes(SUPPORT_ORGANIZATIONS_CAPACITY_NOTE)
            ? section.description
            : `${SUPPORT_ORGANIZATIONS_DESCRIPTION} ${SUPPORT_ORGANIZATIONS_CAPACITY_NOTE}`
          : section.description
            ? normalizePublicHeadlineText(section.description)
            : undefined,
        items: section.items.map((item) => {
          const additionalPublicFacts = guidanceForProgram(
            legacyDocuments.guidance,
            item.label,
          );
          const {
            confidenceLevel: _confidenceLevel,
            confidenceLabel: _confidenceLabel,
            whyOneLine: _whyOneLine,
            notVerified: _notVerified,
            matchedRules: _matchedRules,
            projectFit: _projectFit,
            ...publicItem
          } = item;
          void _confidenceLevel;
          void _confidenceLabel;
          void _whyOneLine;
          void _notVerified;
          void _matchedRules;
          void _projectFit;
          // review6 S11 investigation: `whoQualifies` was removed from
          // ReportItem's type (it carried raw internal catalog prose,
          // rendered verbatim — see the type's own doc comment), but a
          // report SAVED before this fix can still carry the key in its
          // persisted JSON blob. Strip it defensively here too, the same
          // way the other now-legacy fields above are stripped, so an
          // old saved report never re-surfaces it.
          const legacyItem = publicItem as ReportItem & { whoQualifies?: string };
          if ("whoQualifies" in legacyItem) delete legacyItem.whoQualifies;
          const supportSummaryItem =
            item.label === "Community Support" || item.label.startsWith("Local Support in ");
          const normalizedItem: ReportItem = {
            ...publicItem,
            label: normalizePublicHeadlineText(publicItem.label),
            value: normalizePublicHeadlineText(publicItem.value),
            detail:
              supportOrganizationSection && !supportSummaryItem
                ? normalizeSupportOrganizationDetail(publicItem.detail)
                : publicItem.detail
                  ? normalizePublicHeadlineText(publicItem.detail)
                  : undefined,
            sourceLabel: publicItem.sourceLabel
              ? normalizePublicHeadlineText(publicItem.sourceLabel)
              : undefined,
            matchExplanation: publicItem.matchExplanation
              ? normalizePublicMatchExplanation(
                  publicItem.matchExplanation,
                  additionalPublicFacts,
                )
              : undefined,
          };
          if (!programListingSection || !item.programId) return normalizedItem;
          return {
            ...normalizedItem,
            value: "Review published terms",
            matchExplanation: legacyMatchExplanation(item, additionalPublicFacts),
          };
        }),
      };
    }),
  };
}

/** Address-confirmed programs surfaced by a generated report (id + name). */
export function confirmedProgramsFromReport(
  report: GeneratedReport,
): { id: string; name: string }[] {
  const sections = report.sections?.filter((section) =>
    CONFIRMED_PROGRAMS_SECTION_TITLES.has(section.title),
  );
  if (!sections?.length) return [];

  const seen = new Set<string>();
  return sections
    .flatMap((section) => section.items)
    .filter((item) => Boolean(item.programId))
    .filter((item) => {
      const id = item.programId as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((item) => ({ id: item.programId as string, name: item.label }));
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
  const goalLabels = selectedProjectGoalLabels(state);

  if (isVacancy && state.projectType) {
    items.push({
      label: "Project Focus",
      value: PROJECT_TYPE_LABELS[state.projectType] || state.projectType,
    });
  } else if (goalLabels.length > 0) {
    items.push({
      label: goalLabels.length === 1 ? "Project Goal" : "Project Goals",
      value: goalLabels.join("; "),
      detail: state.projectGoals?.includes("other")
        ? "The open-text goal is user-provided context. Program ordering uses only the structured goals selected alongside it."
        : undefined,
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
      id: SECTION_IDS.vacancyProjectIntake,
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
    id: SECTION_IDS.projectIntake,
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
        preparationCost: classifyDocumentPreparationCost(doc.label),
        detail:
          requiringPrograms.length > 0
            ? `Commonly requested for: ${requiringPrograms.slice(0, 4).join(", ")}${requiringPrograms.length > 4 ? ` and ${requiringPrograms.length - 4} more` : ""}.`
            : "No matched program requirement found in the current data, but this can still help during intake or advising.",
      };
    });

  return {
    id: SECTION_IDS.documentReadinessChecklist,
    title: "Document Readiness Checklist",
    description:
      `Practical document checklist based on your answers and the programs matched to this project. ${DOCUMENT_PREPARATION_COST_LEGEND.map((item) => `${item.tier} = ${item.label.toLowerCase()}`).join("; ")}. ${DOCUMENT_PREPARATION_COST_CAVEAT} Marked items are not a guarantee of eligibility; they help prepare the next conversation.`,
    items,
  };
}

function hasProjectReadinessContext(state: WizardState): boolean {
  return Boolean(
    state.projectType ||
      state.projectGoals?.length ||
      state.customGoal ||
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

const COUNTY_EXPLORATORY_PRIORITY: Record<string, number> = {
  smallBizSource: 0,
  cpace: 1,
  class7a: 2,
  class7b: 3,
  class7c: 4,
  class6b: 5,
  class6bSer: 6,
  classC: 7,
  landBank: 8,
  catalystGrant: 9,
  ahsap: 10,
};

const CHICAGO_DISCOVERY_EXCLUDED_COUNTY_PROGRAMS = new Set<string>([
  "class8",
  "cookBrownfield",
]);

function filterDiscoveryPrograms(programs: Program[]): Program[] {
  return programs.filter((p) => !p.zoneKey && !CHICAGO_DISCOVERY_EXCLUDED_COUNTY_PROGRAMS.has(p.id));
}

function countyExploratoryRank(program: Program): number | null {
  if (program.level !== "County") return null;
  if (program.zoneKey) return null;
  if (CHICAGO_DISCOVERY_EXCLUDED_COUNTY_PROGRAMS.has(program.id)) return null;
  return COUNTY_EXPLORATORY_PRIORITY[program.id] ?? 50;
}

function relevanceRank(relevance?: ProgramRelevance): number {
  switch (relevance) {
    case "mapped_with_matching_answers":
      return 0;
    case "mapped_at_location":
      return 1;
    case "review_suggested":
      return 2;
    case "context_dependent":
      return 3;
    case "not_mapped_at_location":
      return 5;
    default:
      return 4;
  }
}

function publicEvidenceForProgram(
  program: Program,
  state: WizardState,
  zones?: Record<string, boolean>,
  zoneNames?: Record<string, string>,
  fit?: ProjectFit,
): PublicMatchEvidence {
  const mappedAtAddress = Boolean(program.zoneKey && zones?.[program.zoneKey]);
  const basedOnUserAnswers: string[] = [];
  if (state.industry) {
    basedOnUserAnswers.push(`You selected ${getIndustryName(state.industry)} as the business type.`);
  }
  const goalLabels = selectedProjectGoalLabels(state);
  if (goalLabels.length > 0) {
    basedOnUserAnswers.push(
      `You selected ${goalLabels.join(", ")} as project goal${goalLabels.length === 1 ? "" : "s"}.`,
    );
  }

  return {
    whyItAppears: mappedAtAddress
      ? [
          fit && isProjectGoalMatch(fit)
            ? "The program is linked to a mapped incentive zone at this address and its published uses overlap with the selected goal."
            : "The program is linked to a mapped incentive zone recorded at this address.",
        ]
      : [
          fit && isProjectGoalMatch(fit)
            ? "The program's published uses overlap with the selected goal."
            : "This broader program is included as a starting point for review.",
        ],
    knownFromPublicData: mappedAtAddress
      ? [`The address is recorded within ${zoneNames?.[program.zoneKey] || ZONE_LABELS[program.zoneKey] || program.zoneKey}.`]
      : [],
    basedOnUserAnswers,
    rulesEstablishedByPublicData: mappedAtAddress
      ? (program.eligibilityRules ?? [])
          .filter((rule) => rule.verifiedBy === "location")
          .map((rule) => rule.description)
      : [],
  };
}

// ─── Program-card content fields (persona spec v2 amendment) ────────────
// Every field below is DERIVED from data the program catalog already
// carries — the committed public/data/stacking-rules.json dataset, and
// each program's own published benefits/sourceUrl/contacts/lastVerifiedAt
// — never hand-authored per-program prose. A program without the
// underlying real data for a field simply doesn't carry it.

let programNameLookupCache: Record<string, string> | null = null;

/** id -> name from the PUBLIC program export (never the internal catalog —
 *  report-engine.ts is reachable from client bundles via ReportDisplay's
 *  normalizePublicReportForDisplay, so this must stay public-safe the same
 *  way loadTifFinancials/loadSbifRollout already are). */
function loadProgramNameLookup(): Record<string, string> {
  if (programNameLookupCache) return programNameLookupCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/programs-public.json") as {
      programs?: { id: string; name: string }[];
    };
    programNameLookupCache = Object.fromEntries(
      (raw.programs ?? []).map((p) => [p.id, p.name]),
    );
  } catch {
    programNameLookupCache = {};
  }
  return programNameLookupCache;
}

let stackingRulesDataCache: StackingRule[] | null = null;

function loadStackingRulesData(): StackingRule[] {
  if (stackingRulesDataCache) return stackingRulesDataCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    stackingRulesDataCache = require("../public/data/stacking-rules.json") as StackingRule[];
  } catch {
    stackingRulesDataCache = [];
  }
  return stackingRulesDataCache;
}

/** "Can combine with" — only the `can` relationship, deduped, named via the
 *  public program list. Returns undefined (no block) rather than []. */
export function buildWorksWith(programId: string): ReportItem["worksWith"] {
  const rules = loadStackingRulesData().filter(
    (rule) =>
      (rule.programId === programId || rule.otherProgramId === programId) &&
      rule.relationship === "can",
  );
  if (rules.length === 0) return undefined;

  const names = loadProgramNameLookup();
  const seen = new Set<string>();
  const items = rules.flatMap((rule) => {
    const otherId = rule.programId === programId ? rule.otherProgramId : rule.programId;
    if (seen.has(otherId)) return [];
    seen.add(otherId);
    return [{ label: names[otherId] || otherId, detail: rule.reason }];
  });
  return items.length > 0 ? items : undefined;
}

/** "Verify at the source" — every link the program record already
 *  publishes, deduped, dated with the program's own lastVerifiedAt. */
export function buildVerifySources(program: Program): ReportItem["verifySources"] {
  const sources: { label: string; url: string; dated?: string | null }[] = [];
  if (program.sourceUrl) {
    sources.push({ label: "Official program page", url: program.sourceUrl, dated: program.lastVerifiedAt });
  }
  if (program.url && program.url !== program.sourceUrl) {
    sources.push({ label: "Program administrator", url: program.url, dated: program.lastVerifiedAt });
  }
  for (const contact of program.contacts ?? []) {
    if (contact.url && !sources.some((s) => s.url === contact.url)) {
      sources.push({ label: contact.agency, url: contact.url, dated: program.lastVerifiedAt });
    }
  }
  return sources.length > 0 ? sources.slice(0, 3) : undefined;
}

/**
 * "What to expect" — intake cadence read from EXACTLY ONE structured field,
 * `intakeStatus`, via a single switch (no overlapping branches). This used
 * to also check `recurring` first and text-mine `benefits[]` for the word
 * "reimburs" — both deleted per the eligibility-claims doctrine (gate
 * finding 2+3): `recurring && intakeStatus !== "closed"` matched SBIF
 * (recurring=true, intakeStatus="open") and produced "no fixed application
 * window published", which is FALSE — SBIF has real, resolved per-TIF-
 * district windows (see FundingWindowChart, which plots them from this
 * exact program). A keyword match on published prose is not a structured
 * fact and can silently contradict the program's own real behavior; it is
 * not an acceptable source for a claim this module makes on its own
 * authority. If `intakeStatus` carries no signal, this renders nothing —
 * never a fallback guess.
 */
export function buildExpectations(program: Program): string | undefined {
  switch (program.intakeStatus) {
    case "open":
      return "Applications are being accepted under the published intake window.";
    case "rolling":
      return "Rolling intake — applications are accepted on an ongoing basis.";
    case "closed":
      return "Intake is not currently open — confirm the next window before relying on this program.";
    case "lapsed":
      return "Intake authority is currently lapsed — confirm current status before relying on this program.";
    case "pending":
      return "Intake has not yet opened for the published window.";
    default:
      return undefined;
  }
}

/**
 * Fixed display copy for each closed-vocabulary cost-signal tag (gate
 * finding 4). One entry per `CostSignalTag` value, enforced by the
 * exhaustiveness test in program-card-content-fields.test.ts — a new tag
 * added to the type without a matching entry here is a type error.
 */
const COST_SIGNAL_COPY: Record<CostSignalTag, { label: string; severity: "info" | "amber" }> = {
  free_to_apply: { label: "Free to apply", severity: "info" },
  application_fee_required: { label: "Application fee required", severity: "amber" },
  reimbursement_after_spend: { label: "You front costs until reimbursed", severity: "amber" },
  upfront_funds_no_reimbursement_wait: { label: "Funds provided upfront", severity: "info" },
  drawings_required: { label: "Drawings required", severity: "amber" },
  permit_fees_apply: { label: "Permit fees apply", severity: "amber" },
  matching_funds_required: { label: "Matching funds required", severity: "amber" },
};

/**
 * "Cost signals" pills (gate finding 4 — R5 board's owner-card block).
 * Reads ONLY `program.costSignals` — the closed-vocabulary catalog field —
 * and maps each tag to its fixed label/severity. Deliberately does NOT
 * scan `benefits[]`/`requiredDocs[]` text for cost-related keywords: that
 * exact pattern (deriving a claim from published prose instead of a
 * structured field) is the bug gate finding 2+3 removed from
 * `buildExpectations` on this same card, and a true-today keyword match
 * is not proof it stays true for every program under the same rule.
 * Returns undefined (block renders nothing) when the catalog carries no
 * confirmed tags for this program.
 */
export function buildCostSignals(
  program: Program,
): { label: string; severity: "info" | "amber" }[] | undefined {
  const tags = program.costSignals;
  if (!tags || tags.length === 0) return undefined;
  return tags.map((tag) => COST_SIGNAL_COPY[tag]);
}

function programReportItem(
  program: Program,
  confidenceMap?: Map<string, ProgramCheckResult>,
  gatingOpts?: ResolveAvailabilityOpts,
  fit?: ProjectFit,
  publicEvidence: PublicMatchEvidence = {},
): ReportItem {
  void confidenceMap;
  // 'expired' programs are filtered out before sections are built
  // (generateReportData); here we annotate the surviving states so
  // 'window-closed' and 'lapsed-notice' render with their note.
  const availability = resolveAvailability(program, new Date(), gatingOpts);
  const availabilityNote =
    availability.state === "window-closed" || availability.state === "lapsed-notice"
      ? availability.note
      : undefined;
  return {
    label: program.name,
    value: "Review published terms",
    detail: availabilityNote ? `${availabilityNote}\n${program.summary}` : program.summary,
    availability: availability.state,
    availabilityNote,
    programId: program.id,
    eligibilityRules: program.eligibilityRules?.map((r: { description: string; required: boolean }) => ({
      description: r.description,
      required: r.required,
    })),
    url: program.url,
    level: program.level,
    matchExplanation: buildPublicMatchExplanation(program, publicEvidence),
    projectFit: summarizeProjectFit(fit),
    lastVerifiedAt: program.lastVerifiedAt,
    isStale: isStaleProgramData(program),
    sourceLabel: program.zoneKey ? (ZONE_LABELS[program.zoneKey] || program.zoneKey) : "Official source",
    sourceUrl: program.sourceUrl || (program.zoneKey ? ZONE_LEARN_MORE[program.zoneKey] : undefined),
    applicationPortals: program.applicationPortals,
    verificationSteps: program.verificationSteps,
    status: program.status,
    worksWith: buildWorksWith(program.id),
    verifySources: buildVerifySources(program),
    expectations: buildExpectations(program),
    costSignals: buildCostSignals(program),
  };
}

function sortProgramItems(
  programs: Program[],
  zones?: Record<string, boolean>,
  confidenceMap?: Map<string, ProgramCheckResult>,
  projectFitMap?: Map<string, ProjectFit | undefined>,
): Program[] {
  return [...programs].sort((a, b) => {
    const zoneDiff = Number(!hasAddressZoneMatch(a, zones)) - Number(!hasAddressZoneMatch(b, zones));
    if (zoneDiff !== 0) return zoneDiff;
    const fitDiff = compareProjectGoalFit(projectFitMap?.get(a.id), projectFitMap?.get(b.id));
    if (fitDiff !== 0) return fitDiff;
    const relevanceDiff = relevanceRank(confidenceMap?.get(a.id)?.relevance) - relevanceRank(confidenceMap?.get(b.id)?.relevance);
    if (relevanceDiff !== 0) return relevanceDiff;
    return a.name.localeCompare(b.name);
  });
}

function sortExploratoryProgramItems(
  programs: Program[],
  zones?: Record<string, boolean>,
  confidenceMap?: Map<string, ProgramCheckResult>,
  projectFitMap?: Map<string, ProjectFit | undefined>,
): Program[] {
  return sortProgramItems(programs, zones, confidenceMap, projectFitMap).sort((a, b) => {
    const fitDiff = compareProjectGoalFit(projectFitMap?.get(a.id), projectFitMap?.get(b.id));
    if (fitDiff !== 0) return fitDiff;
    const aCountyRank = countyExploratoryRank(a);
    const bCountyRank = countyExploratoryRank(b);
    if (aCountyRank != null || bCountyRank != null) {
      if (aCountyRank == null) return 1;
      if (bCountyRank == null) return -1;
      if (aCountyRank !== bCountyRank) return aCountyRank - bCountyRank;
    }
    return 0;
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
    label: "City of Chicago zoning boundaries",
    description: "Published district classification from the City zoning boundary layer. The classification does not determine whether a proposed use is permitted.",
    url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
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
  tifFinance: {
    id: "tifFinance",
    label: "City of Chicago TIF Annual Reports",
    description: "District-level TIF annual report financial context, including reported fund balance and designations.",
    url: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
  },
  localBusinessSupport: {
    id: "localBusinessSupport",
    label: "Chicago Small Business Resource Map",
    description: "Curated neighborhood-level business support organizations, including NBDC, chamber, SSA, CBC, and CDC/EDO access points.",
  },
  siteSignals: {
    id: "siteSignals",
    label: "Public site-signal layers",
    description: "Nearby NOF funding precedents, county incentive parcels, brownfield sites, and leaking underground storage tank records.",
    url: "https://data.cityofchicago.org/",
  },
  transport: {
    id: "transport",
    label: "Transportation and logistics access layer",
    description: "Straight-line proximity to expressways, freight rail, and Chicago airports for site-context screening.",
  },
  mobilityAccess: {
    id: "mobilityAccess",
    label: "Public mobility and site-access sources",
    description: "CTA GTFS, Metra GTFS, Chicago CTA bus stops, Chicago bike routes, airports, and Explorer transport-network layers used for straight-line proximity context.",
    url: "https://www.transitchicago.com/developers/gtfs/",
  },
};

function collectDataSources(ctx: ReportContext): DataSourceCitation[] {
  const sources: DataSourceCitation[] = [];
  if (ctx.census) sources.push(DATA_SOURCES.census);
  if (ctx.zones) sources.push(DATA_SOURCES.zones);
  if (ctx.cityZoning && ctx.cityZoning.status !== "unavailable") {
    const source = ctx.cityZoning.source;
    if (source) {
      const freshness = source.recordUpdatedAt
        ? ` Source record updated ${source.recordUpdatedAt.slice(0, 10)}.`
        : ` Retrieved ${source.retrievedAt.slice(0, 10)}.`;
      sources.push({
        id: "zoning",
        label: source.label,
        description: `${DATA_SOURCES.zoning.description}${freshness}`,
        url: source.url,
      });
    } else {
      sources.push(DATA_SOURCES.zoning);
    }
  }
  const zba = ctx.cityZoning?.zba;
  if (zba) {
    sources.push({
      id: "chicagoZba",
      label: zba.source.label,
      description: `Official City ZBA case geometry and published case attributes. ${zba.source.freshnessNote} The Explorer's point match and presentation are informational, not a City zoning determination. Retrieved ${zba.source.retrievedAt.slice(0, 10)}.`,
      url: zba.source.url,
    });
    sources.push({
      id: "chicagoZbaBoard",
      label: "Chicago Zoning Board of Appeals",
      description: "Official City board page for current procedures, calendars, and verification contacts.",
      url: zba.source.boardUrl,
    });
  }
  if (ctx.parcel) sources.push(DATA_SOURCES.parcel);
  if (ctx.neighborhoodEconomics?.jobsPayroll) sources.push(DATA_SOURCES.zbp);
  if (ctx.neighborhoodEconomics?.reinvestment) sources.push(DATA_SOURCES.buildingPermits);
  if (ctx.neighborhoodEconomics?.property) sources.push(DATA_SOURCES.assessorValues);
  if (ctx.neighborhoodEconomics?.tifFinance) sources.push(DATA_SOURCES.tifFinance);
  if (ctx.siteSignals) sources.push(DATA_SOURCES.siteSignals);
  if (ctx.mobilityAccess) sources.push(DATA_SOURCES.mobilityAccess);
  else if (ctx.transport) sources.push(DATA_SOURCES.transport);
  if (ctx.localBusinessSupport?.organizations?.length) {
    const source = { ...DATA_SOURCES.localBusinessSupport };
    const firstUrl = ctx.localBusinessSupport.sourceUrls?.[0];
    if (firstUrl) source.url = firstUrl;
    sources.push(source);
  }
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

  // build-spec.md 2.3 / audit F2: a genuinely empty zoneCount is only an
  // honest "no mapped zones" claim when every relevant layer was actually
  // checked. When layers are unknown (source unavailable, malformed
  // geometry, etc.), the correct claim is that the check was incomplete —
  // never that the address was confirmed clear.
  //
  // review5 S3: this must hold even when zoneCount > 0. Before this fix,
  // ANY known positive zone silenced the unknown-layer disclosure
  // entirely — an address with 3 confirmed zones and 2 layers that failed
  // to resolve rendered a headline/subheadline that never mentioned the 2
  // unknown layers at all. Known positives and the unavailable-layer
  // notice must both render, regardless of match count.
  const hasUnknownZones = (ctx.unknownZones?.length ?? 0) > 0;
  const unknownZoneCaveat = hasUnknownZones
    ? `${ctx.unknownZones!.length} additional zone layer${ctx.unknownZones!.length !== 1 ? "s" : ""} could not be checked right now (checked ${ctx.zoneCheckedAt ?? new Date().toISOString().slice(0, 10)})`
    : "";
  const headline =
    zoneCount > 0
      ? hasUnknownZones
        ? `Mapped incentive zones were found at this address — ${unknownZoneCaveat}`
        : "Mapped incentive zones were found at this address"
      : hasUnknownZones
        ? `${ctx.unknownZones!.length} zone layer${ctx.unknownZones!.length !== 1 ? "s" : ""} could not be checked right now (checked ${ctx.zoneCheckedAt ?? new Date().toISOString().slice(0, 10)})`
        : "No mapped zone-based programs were found at this address";

  const subheadline = programCount > 0
    ? hasUnknownZones
      ? "The programs linked to those zones have separate eligibility, timing, and approval requirements to confirm. Some additional incentive-zone layers could not be checked and may not be reflected here."
      : "The programs linked to those zones have separate eligibility, timing, and approval requirements to confirm."
    : zoneCount === 0 && hasUnknownZones
      ? "Some incentive-zone layers could not be checked; this is not confirmation the address is outside them. Try again shortly or confirm directly with the administering agency."
      : "Broader programs may still be worth exploring with a local business-support organization.";

  const topReasons: string[] = [];
  topReasons.push(`${zoneCount} mapped incentive zone${zoneCount !== 1 ? "s" : ""} intersect this location`);
  topReasons.push(`${programCount} address-linked program${programCount !== 1 ? "s" : ""} identified for individual confirmation`);
  if (comboCount > 0) topReasons.push(`${comboCount} program interaction${comboCount !== 1 ? "s" : ""} to verify`);
  if (isQCT) topReasons.push("A Qualified Census Tract indicator is present; confirm its implications program by program");
  if (isLMI && !isQCT) topReasons.push("A low-to-moderate income indicator is present; confirm program-specific requirements");

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
    // A walkability score measures the built environment. It does not support a
    // recommendation about what business model to run at this address, so this
    // band states the measurement and its place on the published scale only.
    else walkabilityNarrative = `EPA Walkability Index ${walkScore}/20 — below-average walkability on the index's 1-20 scale.${epaAttribution}`;
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
        label: "Neighborhood Program Context",
        value: marketContext.isQCT ? "Modeled screening context / needs verification: QCT income range" : "Modeled screening context / needs verification: LMI range",
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
    });
  } else {
    items.push({
      label: "Jobs & Payroll",
      value: "Benchmark when ZBP geography is matched",
      detail: "Census ZIP Business Patterns can add establishment counts, employment, and annual payroll by ZIP. This report does not yet have a matched ZBP record for the address context.",
      sourceLabel: "Census ZIP Business Patterns",
      sourceUrl: DATA_SOURCES.zbp.url,
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
    });
  } else {
    items.push({
      label: "Reinvestment Signals",
      value: "Measured public record (loads with permit history)",
      detail: "Building permits can show where visible reinvestment is happening, including reported project cost and permit volume. This address report is not yet carrying the permit-history signal.",
      sourceLabel: "City of Chicago Building Permits",
      sourceUrl: DATA_SOURCES.buildingPermits.url,
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
    });
  }

  const tifFinance = economics?.tifFinance;
  if (tifFinance) {
    const reportYear = tifFinance.reportYear ? `Report year ${tifFinance.reportYear}` : "Latest City annual report";
    const expiration = tifFinance.expirationYear ? `Expires ${tifFinance.expirationYear}` : "Expiration year not matched";
    const financeDetails = [
      tifFinance.propertyTaxIncrementCurrent != null
        ? `current-year increment ${formatMoneyShort(tifFinance.propertyTaxIncrementCurrent)}`
        : null,
      tifFinance.totalExpenditure != null
        ? `reported annual expenditures ${formatMoneyShort(tifFinance.totalExpenditure)}`
        : null,
      tifFinance.amountDesignatedProjectCosts != null
        ? `reported project-cost designation ${formatMoneyShort(tifFinance.amountDesignatedProjectCosts)}`
        : null,
      tifFinance.amountDesignatedDebtObligations != null
        ? `reported debt/obligation designation ${formatMoneyShort(tifFinance.amountDesignatedDebtObligations)}`
        : null,
      tifFinance.surplusDeficit != null
        ? `reported surplus/deficit ${formatMoneyShort(tifFinance.surplusDeficit)}`
        : null,
      tifFinance.distributionOfSurplus != null
        ? `surplus distribution ${formatMoneyShort(tifFinance.distributionOfSurplus)}`
        : null,
    ].filter(Boolean).join("; ");

    items.push({
      label: "TIF District Funding Overview",
      value: tifFinance.fundBalance != null
        ? `Reported district fund balance: ${formatMoneyShort(tifFinance.fundBalance)}`
        : "TIF boundary matched; finance row not matched",
      detail: `TIF districts capture growth in property-tax revenue and can support public improvements, redevelopment agreements, SBIF, infrastructure, and other district-approved project costs. This address is inside the ${tifFinance.districtName || tifFinance.districtId || "matched"} TIF district. ${reportYear}; ${expiration}. ${financeDetails || "No annual finance figures were matched for this district."} ${tifFinance.caution || "District-level City annual report data; not proof of funding availability or project approval."}`,
      sourceLabel: tifFinance.sourceLabel || DATA_SOURCES.tifFinance.label,
      sourceUrl: tifFinance.sourceUrl || DATA_SOURCES.tifFinance.url,
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
  // Storefront-level public-record signals from the corridor-metrics export,
  // merged here so area context lives in one section. Ownership rows render
  // only when county owner data has actually loaded — absence must never
  // read as a measurement. Permit activity is NOT repeated here: the
  // Reinvestment tile above is the single permit figure for this report.
  const corridorMetric = ctx.corridorMetrics ?? loadStaticCorridorMetrics(zipFromContext(ctx));
  if (corridorMetric) {
    const cd = corridorMetric.details ?? null;
    const cWindow = cd?.windowMonths ?? 24;
    if (corridorMetric.vacancyRate != null) {
      items.push({
        label: "Properties flagged vacant",
        value: `${Math.round(corridorMetric.vacancyRate * 100)}% of property records`,
        detail: "Share of property records in this ZIP with a public vacancy indicator.",
      });
    }
    const cOpenings = cd?.turnover?.openings ?? null;
    const cClosures = cd?.turnover?.closures ?? null;
    if (cOpenings != null && cClosures != null) {
      items.push({
        label: "Business license activity",
        value: `${cOpenings.toLocaleString()} opened / ${cClosures.toLocaleString()} closed in the last ${cWindow} months`,
        detail: "Business licenses recorded as opened or closed in this ZIP, shown separately so the direction is visible.",
      });
    }
    const ownerDataLoaded = (cd?.ownershipConcentration?.totalParcels ?? 0) > 0;
    if (ownerDataLoaded && corridorMetric.ownershipHHI != null) {
      items.push({
        label: "Ownership concentration",
        value: corridorConcentrationBand(corridorMetric.ownershipHHI),
        detail: "How spread out private property ownership appears in available assessor records; higher concentration means fewer owners hold a larger share.",
      });
    }
    if (ownerDataLoaded && corridorMetric.localOwnershipShare != null) {
      items.push({
        label: "Illinois owner mailing addresses",
        value: `${Math.round(corridorMetric.localOwnershipShare * 100)}% of private-owner records`,
        detail: "Share of private-owner property records with an Illinois owner mailing address; this does not measure residency or community commitment.",
      });
    }
  }

  items.push({
    label: "How to read this",
    value: "Context, not proof",
    detail:
      "Figures are ZIP-level aggregates for context — not address-level proof. License continuity is a neighborhood signal, not a closure list; ZIP Business Patterns is a 2020–2023 benchmark, not current-year; spending power, leakage, and multiplier are modeled estimates to verify with partners. Storefront rows (vacancy, license activity, ownership) describe public-record patterns in this ZIP — context for decisions, not a judgment of the community or its residents.",
  });

  return {
    id: SECTION_IDS.neighborhoodEconomicContext,
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
    value: a.type || "Community anchor",
    detail: a.rationale || a.type || "",
    sourceLabel: a.type,
    sourceUrl: a.sourceUrls && a.sourceUrls.length > 0 ? a.sourceUrls[0] : undefined,
  }));

  return {
    id: SECTION_IDS.localImpactAnchors,
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
function relationshipLabel(org: LocalBusinessSupportOrganization): string {
  const labels: Record<string, string> = {
    primary_access_point: "Primary local access point",
    secondary_access_point: "Secondary local access point",
    legal_support: "Small business legal support",
    nbdc_2025: "2025/2026 NBDC",
    cbc_hub: "CBC regional hub",
    ssa_provider: "SSA provider",
  };
  return org.relationships.map((r) => labels[r] ?? r).slice(0, 3).join(" + ");
}

function localSupportDetail(
  org: LocalBusinessSupportOrganization,
  communityArea?: string,
  storefrontCorridor?: boolean,
): string {
  const inferredSupport = org.relationships.includes("cbc_hub")
    ? "May help with: regional business navigation, referrals, and Chicago Business Center support. Confirm the exact intake path directly."
    : org.relationships.includes("ssa_provider")
      ? "May help with: corridor services, local business support, and SSA-related questions. Confirm the current service area directly."
      : org.relationships.includes("legal_support")
        ? "May help with: small-business legal questions, entity formation, contracts, compliance, and referrals. Confirm eligibility and intake requirements directly."
      : "May help with: business advising, referrals, and incentive-navigation questions. Confirm current programs and capacity directly.";

  const details = [
    storefrontCorridor && org.relationships.includes("ssa_provider")
      ? "Storefront remodel note: this address falls within a Special Service Area or CCSA corridor. Start with the SSA/corridor operator first — corridor storefront programs, like the Commercial Corridor Storefront Activation (CCSA) grants, are delivered through local corridor organizations. Ask what is active for this corridor right now."
      : "",
    org.address ? `Address: ${org.address}` : "",
    org.phone ? `Phone: ${org.phone}` : "",
    org.supportTypes ? `Published support services: ${org.supportTypes}` : inferredSupport,
    org.serviceGeography ? `Published service area: ${org.serviceGeography}` : communityArea ? `Service area: mapped as a support option for ${communityArea}; confirm fit directly.` : "",
    org.website ? "" : "Website: not listed in the source records used for this report.",
    SUPPORT_ORGANIZATION_AVAILABILITY_LINE,
  ].filter(Boolean);
  return details.join("\n");
}

/** Display cap for the support-organization list. The narrative and the summary
 *  item both disclose when the list may be incomplete. */
const MAX_LISTED_SUPPORT_ORGANIZATIONS = 6;

function buildCommunityAssets(
  assets?: CommunityAsset[],
  localSupport?: LocalBusinessSupportContext | null,
): GeneratedReport["communityAssets"] {
  if (localSupport?.organizations?.length) {
    const receivedCount = localSupport.organizations.length;
    const organizations = localSupport.organizations.slice(0, MAX_LISTED_SUPPORT_ORGANIZATIONS).map((org) => ({
      id: org.id,
      name: org.name,
      type: org.primaryType || "Business support organization",
      role: relationshipLabel(org),
      address: org.address,
      phone: org.phone,
      website: org.website,
      detail: localSupportDetail(org, localSupport.communityArea, localSupport.storefrontCorridor),
      supportLanes: inferSupportLanes(org),
      supportTypes: org.supportTypes,
      serviceGeography: org.serviceGeography,
    }));

    const edos = organizations
      .filter((org) => /edo|cdc|chamber|ssa/i.test(`${org.type} ${org.role}`))
      .map((org) => ({ name: org.name, address: org.address || "" }));
    const bsos = organizations
      .filter((org) => !/edo|cdc|chamber|ssa/i.test(`${org.type} ${org.role}`))
      .map((org) => ({ name: org.name, address: org.address || "" }));

    // The pre-cap mapped total, when the caller knows it.
    //
    // /api/local-business-support caps its list at 6 and now publishes
    // `mappedTotal` — the size of the matched pool BEFORE that cap. Without it
    // a 6-item list is ambiguous: it could mean the area maps exactly six, or
    // that it maps ten and four were dropped. Guessing "six" would silently
    // delete real organizations from what the reader believes exists; hedging
    // on every capped list would fire on 55 of the 77 community areas, most of
    // which lost nothing. With the real total, both cases are stated plainly
    // and the truncation notice appears only where something was truncated.
    //
    // `receivedCount > listedCount` is retained as a fallback for callers that
    // pass an over-long array with no total (saved reports, tests). The hedge
    // survives only for a caller that supplies neither — an unknown stated as
    // unknown rather than resolved in either direction.
    const listedCount = organizations.length;
    const knownMappedTotal = localSupport.mappedTotal;
    const mappedTotal =
      knownMappedTotal != null && knownMappedTotal > listedCount
        ? knownMappedTotal
        : receivedCount > listedCount
          ? receivedCount
          : undefined;
    const listingMayBeIncomplete =
      mappedTotal == null &&
      knownMappedTotal == null &&
      receivedCount >= MAX_LISTED_SUPPORT_ORGANIZATIONS;
    const discoveryGuidance = "Use this as a discovery list: review the published service fit, then confirm current programs, contact options, language access, and capacity directly with each organization.";
    const countSentence = mappedTotal != null
      ? `${mappedTotal} local business-support organizations are mapped for ${localSupport.communityArea}. This report lists the first ${listedCount}.`
      : listingMayBeIncomplete
        ? `This report lists ${listedCount} local business-support organizations for ${localSupport.communityArea}. That is the most it lists, and the total mapped for the area is not available to this report, so there may be more.`
        : `${listedCount} local business-support organization${listedCount === 1 ? " is" : "s are"} mapped for ${localSupport.communityArea}.`;
    const narrative = `${countSentence} ${discoveryGuidance}`;

    return {
      edos,
      bsos,
      organizations,
      communityArea: localSupport.communityArea,
      totalOrganizations: mappedTotal,
      listingMayBeIncomplete,
      selectionBasis: "community-area-match",
      narrative,
    };
  }

  if (!assets || assets.length === 0) return undefined;

  const edos = assets.filter((a) => a.type === "EDO").map((a) => ({ name: a.name, address: a.address }));
  const bsos = assets.filter((a) => a.type === "BSO").map((a) => ({ name: a.name, address: a.address }));

  if (edos.length === 0 && bsos.length === 0) return undefined;

  const parts: string[] = [];
  if (edos.length > 0) parts.push(`${edos.length} economic development organization${edos.length !== 1 ? "s" : ""}`);
  if (bsos.length > 0) parts.push(`${bsos.length} business support organization${bsos.length !== 1 ? "s" : ""}`);
  // This branch runs when no community area resolved. Nothing here was matched
  // to the address, the project, or a published service area, and no source
  // establishes that these organizations advise for free or connect anyone to
  // funding — the previous sentence asserted all of that.
  const narrative = `${parts.join(" and ")} are listed in the community-asset directory this report draws on. They were not matched to this address, project type, or published service area; ask each organization what it offers and whether it serves your location.`;

  return { edos, bsos, selectionBasis: "asset-directory", narrative };
}

function capitalPartnerReportItem(match: CapitalPartnerMatch): ReportItem {
  const contactLines = [
    match.fitNote ? `Organization focus: ${match.fitNote}` : null,
    match.phone ? `Phone: ${match.phone}` : null,
    match.contactEmail ? `Email: ${match.contactEmail}` : null,
    "Informational listing only; contact the organization to ask whether its services may be relevant.",
  ].filter(Boolean);
  const intakeUrl = match.intakeUrl || match.website;

  return {
    label: match.name,
    partnerId: match.partnerId,
    value: "Financing resource to explore",
    detail: [match.reason, ...contactLines].join("\n"),
    url: intakeUrl ? addPartnerReferralAttribution(intakeUrl, match.partnerId) : undefined,
    sourceLabel: "Official organization source",
    sourceUrl: match.provenance.sourceUrl,
    lastVerifiedAt: match.provenance.lastVerifiedAt || null,
    isStale: match.provenance.verificationStatus === "stale",
  };
}

function buildCapitalPartnerSection(handoff: CapitalMatchResult): ReportSection | null {
  if (!handoff.primary) return null;
  return {
    id: CAPITAL_PARTNER_SECTION_ID,
    title: CAPITAL_PARTNER_SECTION_TITLE,
    description:
      "These organizations describe financing services for certain projects. Contact them directly to ask whether their services may be relevant. These listings are informational, not endorsements, approvals, or eligibility decisions. Other public, community, financing, and program reviews may apply, and no contact information has been shared on your behalf.",
    items: [
      capitalPartnerReportItem(handoff.primary),
      ...handoff.alternates.map((match) => capitalPartnerReportItem(match)),
    ],
  };
}

// ─── Integration: TIF Financials, Deadlines, Corridor Context ──────

/**
 * Load tif-financials.json from the static public data file.
 * Returns null if the file is missing, empty, or has no districts.
 */
function loadTifFinancials(): Record<string, TifFinancialsSlim> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/tif-financials.json") as {
      districts?: Record<string, {
        tifNumber: string;
        tifName?: string | null;
        expirationDate?: string | null;
        expirationYear?: number | null;
        expiresWithin24Months?: boolean;
      }>;
    };
    if (!raw?.districts || Object.keys(raw.districts).length === 0) return null;
    const result: Record<string, TifFinancialsSlim> = {};
    for (const [key, d] of Object.entries(raw.districts)) {
      result[key] = {
        tifNumber: d.tifNumber,
        tifName: d.tifName ?? null,
        expirationDate: d.expirationDate ?? null,
        expirationYear: d.expirationYear ?? null,
        expiresWithin24Months: d.expiresWithin24Months ?? false,
      };
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Load sbif-rollout.json from the static public data file.
 * Returns null gracefully when the file is empty (fetchError state).
 * Exported so scripts (smoke-report) and gating callers reuse this single
 * reader instead of duplicating the JSON load.
 */
export function loadSbifRollout(): SbifWindow[] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/sbif-rollout.json") as {
      windows?: SbifWindow[];
      fetchError?: string;
    };
    if (!raw?.windows || raw.windows.length === 0) return null;
    return raw.windows;
  } catch {
    return null;
  }
}

/**
 * Load corridor-metrics.json static export if present.
 * The file is optional — returns null when absent.
 * Uses a lazy require pattern identical to programs-data.ts so the bundler
 * does not produce a module-not-found error when the file has not been
 * generated yet. The try/catch ensures a graceful null return.
 */
/**
 * Load every corridor entry from the committed corridor-metrics.json export.
 * Used for the pilot baseline table, where each corridor's numbers are read
 * against the other pilot corridors from the SAME snapshot and window — the
 * only baseline this dataset honestly supports.
 */
function loadAllStaticCorridorMetrics(): CorridorMetric[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/corridor-metrics.json") as
      | CorridorMetric
      | Record<string, CorridorMetric>;
    if ((raw as CorridorMetric)?.corridorId) return [raw as CorridorMetric];
    return Object.values(raw as Record<string, CorridorMetric>)
      .filter((m) => m?.corridorId)
      .sort((a, b) => a.corridorId.localeCompare(b.corridorId));
  } catch {
    return [];
  }
}

function loadStaticCorridorMetrics(zip: string | null): CorridorMetric | null {
  if (!zip) return null;
  try {
    // Literal require so the bundler ships the committed export to the
    // client too (same pattern as tif-financials.json / sbif-rollout.json).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("../public/data/corridor-metrics.json") as
      | CorridorMetric
      | Record<string, CorridorMetric>;
    // Legacy single-metric shape.
    if ((raw as CorridorMetric)?.corridorId) {
      const single = raw as CorridorMetric;
      return single.corridorId === zip ? single : null;
    }
    // ZIP-keyed map (scripts/export-corridor-metrics.ts shape).
    const map = raw as Record<string, CorridorMetric>;
    const metric = map[zip];
    return metric?.corridorId ? metric : null;
  } catch {
    return null;
  }
}

/** Plain-language band for parcel-ownership HHI (no raw index in UI copy). */
export function corridorConcentrationBand(hhi: number): string {
  if (hhi < 0.15) return "Low concentration";
  if (hhi < 0.25) return "Moderate concentration";
  return "High concentration";
}

/** Best-effort ZIP for the report address, for ZIP-level corridor metrics. */
function zipFromContext(ctx: ReportContext): string | null {
  if (ctx.reportZip && /^\d{5}$/.test(ctx.reportZip)) return ctx.reportZip;
  const parcelZip = (ctx.parcel as { zip?: string | null } | undefined)?.zip;
  if (parcelZip && /^\d{5}$/.test(parcelZip)) return parcelZip;
  const econZip = (ctx.neighborhoodEconomics as { zip?: string | null } | undefined)?.zip;
  if (econZip && /^\d{5}$/.test(econZip)) return econZip;
  return null;
}

/**
 * Enrich the tifFinance section of neighborhoodEconomics from the static
 * tif-financials.json when the address is inside a TIF district.
 *
 * Uses ctx.neighborhoodEconomics.tifFinance.districtId, which the tif-finance
 * API route resolves by point-in-polygon against the district boundaries.
 * There is deliberately no zone-name fallback: a district's NAME digits are
 * cross-street numbers (e.g. "35th/Halsted"), not its TIF number, so deriving
 * an id from the name attaches a different district's financials — showing
 * nothing is correct when the id is genuinely unknown.
 * Returns the districtId used (for deadline lookup) or null.
 */
function enrichTifFinancialContext(
  ctx: ReportContext,
  financials: Record<string, TifFinancialsSlim> | null,
): string | null {
  if (!financials) return null;

  const districtId = ctx.neighborhoodEconomics?.tifFinance?.districtId ?? null;
  if (!districtId) return null;

  const fin = financials[districtId];
  if (!fin) return districtId; // in TIF but no finance record — still return id for deadlines

  // If the report engine already has tifFinance context (from live API), leave it
  // in place and only fill in the expiration/fund fields that may be missing.
  const existing = ctx.neighborhoodEconomics?.tifFinance;
  if (existing) {
    // Already populated — note expiration urgency if not already set
    return districtId;
  }

  // No tifFinance context yet — build a minimal enrichment note via the
  // Neighborhood Economic Context section.  The full context object is read-only
  // in this scope, so we surface the enrichment as additional ReportItems via
  // the section builder; the enrichment is returned as the districtId only here.
  return districtId;
}

/**
 * Build the "Upcoming Deadlines Near This Address" report section.
 *
 * Merges:
 *   - program card deadlines[] entries for matched/relevant programs
 *   - the address's SBIF window from sbif-rollout.json (omitted when empty)
 *   - TIF expiration alerts (when tifDistrict is known and expires ≤24 months)
 *
 * Sorted ascending by date, past dates dropped, capped at 8 items.
 * Returns undefined when there are no upcoming items to show.
 */
function buildDeadlinesSection(
  programs: Program[],
  tifDistrictId: string | null,
  financials: Record<string, TifFinancialsSlim> | null,
  sbifRollout: SbifWindow[] | null,
): ReportSection | undefined {
  const programById = new Map(programs.map((p) => [p.id, p]));

  function compactSummary(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    const sentence = normalized.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim();
    const summary = sentence || normalized;
    return summary.length > 280 ? `${summary.slice(0, 277).trim()}...` : summary;
  }

  function buildProgramDeadlineDetail(program: Program, deadlineLabel?: string): string {
    const portal = program.applicationPortals?.find((p) => p.url);
    const verificationStep = program.verificationSteps?.find((step) => step.label);
    const nextStep = program.fastestConfirmingStep
      ?? (verificationStep
        ? `${verificationStep.label} with ${verificationStep.agency}`
        : portal
        ? `Review ${portal.label} and confirm this address or project fits the current round`
        : program.contact
        ? `Contact ${program.contact} to confirm current timing and eligibility`
        : null);
    const parts = [
      deadlineLabel ? `Timing: ${deadlineLabel}.` : null,
      `Why it matters: ${compactSummary(program.summary)}`,
      nextStep ? `Next step: ${nextStep}.` : null,
      program.contact && !nextStep?.includes(program.contact)
        ? `Contact: ${program.contact}.`
        : null,
    ];
    return parts.filter(Boolean).join("\n");
  }

  // Flatten programs with deadlines[] arrays into ProgramCardSlim entries.
  // Each deadline entry in a program gets its own item so sorting is by date.
  const cardSlims = programs.flatMap((p) => {
    // Support both the older flat `deadline` string field and the new `deadlines[]` array.
    const deadlineArr: Array<{ label?: string; date: string }> =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p as any).deadlines ?? [];
    if (deadlineArr.length > 0) {
      return deadlineArr.map((d) => ({
        id: p.id,
        name: d.label ? `${p.name} — ${d.label}` : p.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deadline: d.date ?? (p as any).deadline ?? null,
        deadlineNote: buildProgramDeadlineDetail(p, d.label),
      }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flatDeadline = (p as any).deadline as string | null | undefined;
    if (flatDeadline) {
      return [{
        id: p.id,
        name: p.name,
        deadline: flatDeadline,
        deadlineNote: buildProgramDeadlineDetail(p),
      }];
    }
    return [];
  });

  const summary = deadlinesForAddress({
    matchedPrograms: cardSlims,
    tifDistrict: tifDistrictId,
    tifFinancials: financials,
    sbifRollout,
    today: new Date(),
    deadlineWindowDays: 365, // broader window for report — show full year
  });

  // Build final list: TIF expirations and SBIF windows always surface first
  // (they are context-specific to this address), then program deadlines sorted
  // by date. Cap at 8 total items; drop past items.
  const notPast = summary.allItems.filter((item) => !item.isPast);
  const addressSpecific = notPast.filter(
    (item) => item.kind === "tif_expiration" || item.kind === "sbif_window",
  );
  const programDeadlines = notPast
    .filter((item) => item.kind === "program_deadline")
    .slice(0, Math.max(0, 8 - addressSpecific.length));
  const upcoming = [...addressSpecific, ...programDeadlines].sort(
    (a, b) => a.daysFromToday - b.daysFromToday,
  );

  if (upcoming.length === 0) return undefined;

  const items: ReportItem[] = upcoming.map((item) => {
    const program = item.programId ? programById.get(item.programId) : undefined;
    const label = item.kind === "program_deadline"
      ? item.label.replace(/\s+— application deadline$/, "")
      : item.label;
    let value = item.date;
    if (item.daysFromToday === 0) value = `Today (${item.date})`;
    else if (item.daysFromToday === 1) value = `Tomorrow (${item.date})`;
    else if (item.daysFromToday <= 7) value = `In ${item.daysFromToday} days — ${item.date}`;
    else value = item.date;

    const detail = item.note
      ? item.note
      : item.kind === "tif_expiration"
      ? "TIF districts can fund SBIF reimbursements, public improvements, and redevelopment agreements. Apply for TIF-funded programs before the district expires."
      : item.kind === "sbif_window"
      ? "Small Business Improvement Fund (SBIF) reimburses up to 90% of eligible façade and interior improvement costs. Windows are district-specific."
      : undefined;

    // For TIF expiration items, add the "act soon" note
    let actSoonNote: string | undefined;
    if (item.kind === "tif_expiration" && tifDistrictId && financials?.[tifDistrictId]) {
      const fin = financials[tifDistrictId];
      if (fin.expiresWithin24Months) {
        actSoonNote = `Act soon: this TIF district is scheduled to expire ${fin.expirationDate ?? "soon"}. Apply for TIF-funded programs before the window closes.`;
      }
    }

    return {
      label,
      value,
      detail: actSoonNote ?? detail,
      programId: item.programId,
      url: program?.url,
      level: program?.level,
      eligibilityRules: program?.eligibilityRules?.map((r) => ({
        description: r.description,
        required: r.required,
      })),
      sourceUrl: program?.sourceUrl,
      applicationPortals: program?.applicationPortals,
      verificationSteps: program?.verificationSteps,
      deadlineDate: item.date,
      deadlineKind: item.kind,
      deadlineWindowEnd: item.windowEnd,
    };
  });

  return {
    id: SECTION_IDS.upcomingDeadlines,
    title: "Upcoming Deadlines Near This Address",
    description: "Upcoming dates that may affect this report. Use each row's notes and official links to confirm timing before applying or starting work.",
    items,
  };
}


// ─── Report Generators ──────────────────────────────────────────────

function generateLocationIncentives(
  state: WizardState,
  programs: Program[],
  ctx: ReportContext = {},
): GeneratedReport {
  const { zones, zoneNames } = ctx;
  const projectGoals = selectedProjectGoals(state);
  const projectGoalLabels = selectedProjectGoalLabels(state);
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
  const projectFitMap = new Map<string, ProjectFit | undefined>(
    industryRelevant.map((program) => [
      program.id,
      projectGoalsFit(program, projectGoals, state.industry),
    ]),
  );
  const confirmedPrograms = sortProgramItems(zoneBased, zones, confidenceMap, projectFitMap);
  const exploratoryPrograms = sortExploratoryProgramItems(
    discoveryOnly,
    zones,
    confidenceMap,
    projectFitMap,
  );
  const goalMatchedPrograms = projectGoals.length > 0
    ? confirmedPrograms.filter((program) => isProjectGoalMatch(projectFitMap.get(program.id)))
    : [];
  const otherConfirmedPrograms = goalMatchedPrograms.length > 0
    ? confirmedPrograms.filter((program) => !isProjectGoalMatch(projectFitMap.get(program.id)))
    : [];

  // ── Static TIF/SBIF context (loaded once; reused by program gating notes,
  //    the TIF financial enrichment, and the deadlines section below) ──
  const tifFinancials = loadTifFinancials();
  const sbifRollout = loadSbifRollout();
  const tifDistrictId = enrichTifFinancialContext(ctx, tifFinancials);
  const gatingOpts: ResolveAvailabilityOpts = {
    sbifRollout,
    tifDistrict: tifDistrictId,
  };

  // ── Builder outputs ──
  const verdict = computeVerdict(zones, programs, ctx);
  const marketContext = buildMarketContext(ctx, zones);
  const eligibleIds = confirmedPrograms.map((p) => p.id);
  const stackingAnalysis = buildStackingAnalysis(zones, zoneNames, eligibleIds, ctx.stackingRules);
  const communityAssetsData = buildCommunityAssets(ctx.communityAssets, ctx.localBusinessSupport);
  const dataSources = collectDataSources(ctx);

  // ── Sections: Overview → Stacking → Programs → Documents → Support → Next Steps → Market ──
  const sections: ReportSection[] = [];
  const projectIntakeSection = buildProjectIntakeSection(state);
  if (projectIntakeSection) sections.push(projectIntakeSection);

  // Neighborhood Economic Context is built here (the TIF enrichment below
  // appends to it) but is NOT pushed here. On the site-incentive report the
  // reader is a business owner who came for programs and next steps; opening
  // the report on tract-level economics spends the two sections the UI renders
  // expanded by default on background reading. It is appended after the
  // program, document, support, and deadline sections instead — see the push
  // at the end of this section block. The vacancy/development report
  // (generateBestLocation) keeps its earlier placement, because corridor and
  // lender readers come for exactly this material.
  const neighborhoodEconomicSection = buildNeighborhoodEconomicContextSection(ctx, zones, marketContext);
  const localImpactAnchorsSection = buildLocalImpactAnchorsSection(ctx);
  if (localImpactAnchorsSection) sections.push(localImpactAnchorsSection);

  // §02 Mapped zone coverage and program interactions
  if (stackingAnalysis) {
    const stackingItems: ReportItem[] = [];
    stackingItems.push({ label: "Mapped Zone Coverage", value: `${stackingAnalysis.zoneCount} zone${stackingAnalysis.zoneCount === 1 ? "" : "s"}`, detail: stackingAnalysis.narrative });
    for (const combo of stackingAnalysis.combinations) {
      stackingItems.push({ label: combo.zones.join(" + "), value: "Verify interaction", detail: combo.benefit });
    }
    for (const rule of stackingAnalysis.rules) {
      stackingItems.push({ label: `${rule.programA} + ${rule.programB}`, value: "Verify interaction", detail: rule.reason });
    }
    if (stackingItems.length > 0) {
      sections.push({
        id: SECTION_IDS.incentiveZoneCoverage,
        title: "Incentive Zone Coverage & Program Interactions",
        description: "Mapped incentive zones at this address and program interactions to confirm with the relevant administrators.",
        items: stackingItems,
      });
    }
  }

  // §03 Address-confirmed programs, with project fit kept separate from location eligibility.
  if (confirmedPrograms.length > 0) {
    if (goalMatchedPrograms.length > 0) {
      // Only the goals with a project-fit rule put programs in this section.
      // Naming the rest here told the reader their custom goal had been
      // matched when it contributed nothing to the filter.
      const { ordering, contextOnly } = partitionGoalLabelsByOrderingUse(projectGoals, projectGoalLabels);
      const contextNote = contextOnly.length > 0
        ? ` ${joinLabels(contextOnly)} ${contextOnly.length === 1 ? "is" : "are"} recorded from your answers but ${contextOnly.length === 1 ? "was" : "were"} not used to select these programs.`
        : "";
      sections.push({
        id: GOAL_MATCH_PROGRAMS_SECTION_ID,
        title: GOAL_MATCH_PROGRAMS_SECTION_TITLE,
        description: `Programs tied to this address whose stated uses may relate to the selected goal${ordering.length === 1 ? "" : "s"}: ${joinLabels(ordering)}.${contextNote} Each program still requires individual eligibility confirmation.`,
        items: goalMatchedPrograms.map((program) =>
          programReportItem(
            program,
            confidenceMap,
            gatingOpts,
            projectFitMap.get(program.id),
            publicEvidenceForProgram(program, state, zones, zoneNames, projectFitMap.get(program.id)),
          ),
        ),
      });
      if (otherConfirmedPrograms.length > 0) {
        sections.push({
          id: OTHER_CONFIRMED_PROGRAMS_SECTION_ID,
          title: OTHER_CONFIRMED_PROGRAMS_SECTION_TITLE,
          description: `Other programs connected to this address that do not directly target the selected goals or still need industry confirmation.`,
          items: otherConfirmedPrograms.map((program) =>
            programReportItem(
              program,
              confidenceMap,
              gatingOpts,
              projectFitMap.get(program.id),
              publicEvidenceForProgram(program, state, zones, zoneNames, projectFitMap.get(program.id)),
            ),
          ),
        });
      }
    } else {
      sections.push({
        id: CONFIRMED_PROGRAMS_SECTION_ID,
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "Programs connected to this address through mapped incentive-zone boundaries. Confirm the applicable requirements for each program.",
        items: confirmedPrograms.map((program) =>
          programReportItem(
            program,
            confidenceMap,
            gatingOpts,
            projectFitMap.get(program.id),
            publicEvidenceForProgram(program, state, zones, zoneNames, projectFitMap.get(program.id)),
          ),
        ),
      });
    }
  }

  if (exploratoryPrograms.length > 0) {
    sections.push({
      id: SECTION_IDS.additionalProgramsToExplore,
      title: "Additional Programs to Explore",
      description: "Programs not confirmed by this address alone, including Cook County tools that may apply countywide but still need project, property, and administrator review.",
      items: exploratoryPrograms.slice(0, 8).map((program) =>
        programReportItem(
          program,
          confidenceMap,
          gatingOpts,
          projectFitMap.get(program.id),
          publicEvidenceForProgram(program, state, zones, zoneNames, projectFitMap.get(program.id)),
        ),
      ),
    });
  }

  // §04 Required Documents (categorized, with program attribution) — inserted before Support Network
  {
    // Build a map: document → { category, programs[] }
    const docMap: Record<string, { category: string; programs: Set<string> }> = {};
    for (const p of confirmedPrograms) {
      // requiredDocs is not purely a document list: some catalog records state
      // the opposite ("No application needed — benefits are automatic by
      // location", "No formal documents required to get started"). Listed under
      // a "Required Documents" heading, and counted in this section's own
      // document total, they become requirements the record explicitly denies.
      // buildPublicMatchExplanation keeps the same strings as published facts
      // via this predicate (lib/match-transparency.ts), so nothing is lost from
      // the report by leaving them out of the document list here.
      for (const doc of p.requiredDocs.filter((d) => !isDocumentRequirementGuidance(d))) {
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
    // The guidance filter above drops non-document entries, so a program that
    // publishes three requiredDocs routinely leaves one real document here.
    // The noun agrees with the count rather than being hardcoded plural.
    const documentCount = Object.keys(docMap).length;
    if (categoryEntries.length > 0) {
      const docItems: ReportItem[] = categoryEntries.map(([cat, docs]) => ({
        label: cat,
        value: `${docs.length} document${docs.length !== 1 ? "s" : ""}`,
        detail: docs.map((d) => {
          const cost = classifyDocumentPreparationCost(d.doc);
          return `${d.doc} [${cost.tier}] — ${d.programs.join(", ")}`;
        }).join("\n"),
      }));
      sections.push({
        id: SECTION_IDS.requiredDocuments,
        title: "Required Documents",
        description: `${documentCount} document${documentCount === 1 ? "" : "s"} across programs mapped at this address, organized by category. Each document lists which program(s) require it. ${DOCUMENT_PREPARATION_COST_LEGEND.map((item) => `${item.tier} = ${item.label.toLowerCase()}`).join("; ")}. ${DOCUMENT_PREPARATION_COST_CAVEAT}`,
        items: docItems,
      });
    }
  }

  if (hasProjectReadinessContext(state)) {
    sections.push(buildDocumentReadinessSection(confirmedPrograms, state));
  }

  // §05 Organizations that may be able to help
  if (communityAssetsData) {
    const assetItems: ReportItem[] = [];
    const listedCount = communityAssetsData.organizations?.length
      ?? communityAssetsData.edos.length + communityAssetsData.bsos.length;
    const mappedTotal = communityAssetsData.totalOrganizations;
    // A single organization survives the support filters often enough that the
    // count has to agree in number — the detail sentence already does.
    const listedLabel = `${listedCount} organization${listedCount === 1 ? "" : "s"}`;
    assetItems.push({
      label: communityAssetsData.communityArea ? `Local Support in ${communityAssetsData.communityArea}` : "Community Support",
      // Never present the display cap as the mapped total — the value read
      // "6 organizations" for community areas that map more than six. When the
      // mapped total is unknown (the usual case: the API caps before this
      // engine sees the list) the value says only what is listed, and the
      // detail below carries the reason more may exist.
      value: mappedTotal != null && mappedTotal > listedCount
        ? `${listedCount} of ${mappedTotal} organizations`
        : communityAssetsData.listingMayBeIncomplete
          ? `${listedLabel} listed`
          : listedLabel,
      detail: communityAssetsData.narrative,
    });
    if (communityAssetsData.organizations?.length) {
      for (const org of communityAssetsData.organizations) {
        assetItems.push({
          label: org.name,
          value: org.role,
          detail: org.detail || org.address,
          url: org.website,
          sourceUrl: org.website,
          sourceLabel: org.phone ? `Phone: ${org.phone}` : undefined,
        });
      }
    } else {
      for (const edo of communityAssetsData.edos) {
        assetItems.push({ label: edo.name, value: "EDO", detail: edo.address });
      }
      for (const bso of communityAssetsData.bsos) {
        assetItems.push({ label: bso.name, value: "BSO", detail: bso.address });
      }
    }
    // SUPPORT_ORGANIZATIONS_DESCRIPTION describes the community-area match.
    // The asset-directory fallback applies no service-area, project-type, or
    // service filter at all, so it must not borrow that sentence — and an
    // absent basis is unknown, not the matched case.
    sections.push({
      id: SUPPORT_ORGANIZATIONS_SECTION_ID,
      title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
      description: communityAssetsData.selectionBasis === "community-area-match"
        ? `${SUPPORT_ORGANIZATIONS_DESCRIPTION} ${SUPPORT_ORGANIZATIONS_CAPACITY_NOTE}`
        : `Listed from the community-asset directory this report draws on, not selected by published service area, project type, or support services. ${SUPPORT_ORGANIZATIONS_CAPACITY_NOTE}`,
      items: assetItems,
    });
  }

  // §06 TIF Financial Context enrichment + Deadlines + Corridor Context
  // (tifFinancials / sbifRollout / tifDistrictId are loaded once near the top
  //  of this function and shared with the program-gating annotations.)
  {
    // TIF Financial Context: when in a TIF and tif-financials.json has a record,
    // add an enrichment note to the Neighborhood Economic Context section items.
    // If the section was already built by buildNeighborhoodEconomicContextSection
    // (which uses ctx.neighborhoodEconomics.tifFinance from the live API), this
    // is a no-op. When the static file has data the live API didn't provide, we
    // append a standalone section.
    if (tifDistrictId && tifFinancials?.[tifDistrictId] && !ctx.neighborhoodEconomics?.tifFinance) {
      const fin = tifFinancials[tifDistrictId];
      const expiresNote = fin.expiresWithin24Months && fin.expirationDate
        ? ` Act soon: this TIF is scheduled to expire ${fin.expirationDate}.`
        : "";
      const tifItem: ReportItem = {
        label: "TIF District Funding Overview",
        value: `TIF district ${fin.tifName ?? fin.tifNumber}${fin.expirationDate ? ` — expires ${fin.expirationDate}` : ""}`,
        detail: [
          `This address is inside the ${fin.tifName ?? fin.tifNumber} TIF district (${fin.tifNumber}).`,
          fin.expirationDate ? `Expiration date: ${fin.expirationDate} (${fin.expirationYear}).` : null,
          expiresNote || null,
          "TIF districts can fund SBIF façade reimbursements, public improvements, and redevelopment agreements. Contact the City of Chicago DPD for current fund availability.",
        ].filter(Boolean).join(" "),
        sourceLabel: "City of Chicago TIF Annual Reports",
        sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
      };
      // The economic-context section is appended at the end of this block, so
      // it is enriched through the object reference rather than by index.
      if (neighborhoodEconomicSection) {
        neighborhoodEconomicSection.items.push(tifItem);
      } else {
        sections.push({
          id: SECTION_IDS.tifFinancialContext,
          title: "TIF Financial Context",
          description: "Annual report financial context for the TIF district covering this address.",
          items: [tifItem],
        });
      }
    }

    // Deadlines section
    const deadlinesSection = buildDeadlinesSection(
      [...confirmedPrograms, ...exploratoryPrograms],
      tifDistrictId,
      tifFinancials,
      sbifRollout,
    );
    if (deadlinesSection) sections.push(deadlinesSection);

    // Corridor Context section (omitted entirely when no data)
  }

  // Supporting context, last: the demoted Neighborhood Economic Context (see
  // the note where it is built). Nothing is removed — every measurement,
  // comparison, source label, and unavailable-data state it carries is intact;
  // only its position in the section order changed.
  if (neighborhoodEconomicSection) sections.push(neighborhoodEconomicSection);

  // ── Action Roadmap ("Your Next Steps") ──────────────────────────
  const actionRoadmap: ActionRoadmapItem[] = [];
  const topPrograms = selectTopPrograms(
    goalMatchedPrograms.length > 0 ? goalMatchedPrograms : confirmedPrograms,
    2,
  );

  // Tier 1: "Do This Week" — top 2 programs with full contact + call script
  for (const p of topPrograms) {
    const contact = p.contacts?.[0];
    const addressDisplay = state.address || "my address";
    const zoneName = p.zoneKey ? (zoneNames?.[p.zoneKey] || ZONE_LABELS[p.zoneKey] || p.zoneKey) : "";
    const goalContext = projectGoalLabels.length > 0
      ? ` with a focus on ${projectGoalLabels.join(", ").toLowerCase()}`
      : "";
    const callScript = contact
      ? `"Hi, I'm at ${addressDisplay}${zoneName ? ` in ${zoneName}` : ""}. I'd like to learn about ${p.name} for my ${getIndustryName(state.industry).toLowerCase()}${getIndustryName(state.industry).toLowerCase().includes("business") ? "" : " business"}${goalContext}."`
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
      label: `Confirm fit for ${p.name}`,
      description:
        p.fastestConfirmingStep ||
        `Contact the program administrator to confirm current eligibility and the right next step for ${p.name}.`,
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
    ? ` The address intersects ${stackingAnalysis.zoneCount} mapped incentive zone${stackingAnalysis.zoneCount === 1 ? "" : "s"}; each program has separate eligibility and approval rules.`
    : "";
  const projectGoalSummary = projectGoalLabels.length > 0
    ? ` The selected project goal${projectGoalLabels.length === 1 ? " is" : "s are"} ${projectGoalLabels.join(", ")}; each program still requires individual confirmation.`
    : "";

  return {
    title: `Site Incentive Analysis — ${addressDisplay}`,
    subtitle: `Location-based analysis for ${getIndustryName(state.industry)}`,
    reportType: "location-incentives",
    generatedAt: new Date().toISOString(),
    summary: `${verdict?.headline || "Incentive analysis complete"}. The mapped data records ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} at ${addressDisplay} and links ${confirmedPrograms.length} program${confirmedPrograms.length !== 1 ? "s" : ""} to this address.${exploratoryPrograms.length > 0 ? ` ${exploratoryPrograms.length} additional program${exploratoryPrograms.length !== 1 ? "s" : ""} appear as discovery next steps.` : ""}${projectGoalSummary}${stackingContext} Start with the recommended actions, then use the later sections to prepare and verify.`,
    sections,
    recommendedActions: recommendedActions.slice(0, 4),
    metadata: {
      address: state.address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      industry: getIndustryName(state.industry),
      budgetRange: state.budgetRange || undefined,
      projectGoals: projectGoals.length > 0 ? projectGoals : undefined,
      projectType: projectGoals[0] || state.projectType || undefined,
      customGoal: state.customGoal?.trim() || undefined,
    },
    actionRoadmap,
    verdict,
    marketContext,
    stackingAnalysis,
    communityAssets: communityAssetsData,
    corridorInvestment: buildCorridorInvestmentContext(communityAssetsData?.communityArea),
    dataSources,
  };
}

/**
 * Gate finding 5: supporter corridor-investment chart source. Reads the
 * REAL FFIEC CRA series already committed for this community area — never
 * fetched, never derived from unrelated program data. Returns null (chart
 * renders nothing) when there is no community area to key on, or the file
 * has no series for it. `source` is read from the file's own sources[]
 * list by matching "FFIEC" — never hardcoded to an array index, so if the
 * citation text changes upstream this does not silently go stale.
 */
export function buildCorridorInvestmentContext(
  communityArea: string | null | undefined,
): { communityArea: string; series: CraYearRow[]; source: string } | null {
  if (!communityArea) return null;
  const ctx = loadCapitalContextForArea(communityArea);
  if (!ctx.cra || ctx.cra.length === 0) return null;
  const source = ctx.sources.find((s) => s.includes("FFIEC")) ?? ctx.sources[0] ?? "FFIEC CRA small-business lending data";
  return { communityArea, series: ctx.cra, source };
}

function buildZoningReportItem(
  cityZoning: ReportZoningData | undefined,
): ReportItem | null {
  if (!cityZoning) return null;

  if (cityZoning.status === "unavailable") {
    return {
      label: "Published Zoning Source",
      value: "Temporarily unavailable",
      detail: `${cityZoning.message || "Published Chicago zoning data could not be retrieved."} No zoning conclusion is shown. Try again before relying on this report for a project decision.`,
    };
  }

  if (cityZoning.status === "not_found") {
    return {
      label: "Published Zoning Source",
      value: "No district returned",
      detail: `${cityZoning.message || "No published Chicago zoning district was returned for this location."} This is not a finding that zoning requirements do not apply.`,
      url: cityZoning.source?.url,
    };
  }

  if (!cityZoning.zoneClass) return null;

  const recordUpdatedAt =
    cityZoning.recordUpdatedAt ?? cityZoning.source?.recordUpdatedAt;
  const sourceDetail = [
    cityZoning.zoneType
      ? `Published City zoning category: ${cityZoning.zoneType}.`
      : null,
    recordUpdatedAt
      ? `Source record updated ${recordUpdatedAt.slice(0, 10)}.`
      : null,
    cityZoning.clerkDocumentNumber
      ? `Related City Clerk record: ${cityZoning.clerkDocumentNumber}.`
      : null,
    cityZoning.ordinanceDate
      ? `Published ordinance date: ${cityZoning.ordinanceDate.slice(0, 10)}.`
      : null,
    "This report does not determine whether a proposed use is permitted.",
    // review5 S5: routed through authorityReferenceLine("zoning") — was
    // "...and with the City", the exact generic-City-without-ZBA shape
    // for a zoning-classification/use-permission sentence.
    `Verify the intended use and project requirements against the current Chicago Zoning Ordinance and with the ${authorityReferenceLine("zoning")}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    label: "City Zoning Classification",
    value: cityZoning.zoneClass,
    detail: sourceDetail,
    url: cityZoning.clerkUrl ?? cityZoning.source?.url,
  };
}

const ZBA_CASE_TYPE_LABELS = {
  special_use: "Special use",
  variation: "Variation",
  administrative_appeal: "Administrative appeal",
  unknown: "City case type",
} as const;

function buildZbaReportItems(
  zba: ChicagoZbaLookupResponse | undefined,
): ReportItem[] {
  if (!zba) return [];

  if (zba.status === "unavailable") {
    return [{
      label: "City ZBA Case Source",
      value: "Temporarily unavailable",
      detail: `${zba.message} Consult the cited City source directly before relying on this report. ${zba.source.freshnessNote}`,
      url: zba.source.url,
    }];
  }

  if (zba.status === "not_found") {
    return [{
      label: "City ZBA Case Source",
      value: "No intersecting record returned",
      detail: `${zba.message} In the cited ArcGIS layer, use the Query tool to search the published ADDRESS and ORDINANCE fields, then confirm the case history with the Chicago Zoning Board of Appeals or Department of Planning and Development. ${zba.source.freshnessNote}`,
      url: zba.source.url,
    }];
  }

  const maxDisplayedCases = 8;
  const displayedCases = zba.cases.slice(0, maxDisplayedCases);
  const omittedCount = Math.max(0, zba.returnedCount - displayedCases.length);
  const items: ReportItem[] = [{
    label: "City ZBA Case Source",
    value: `${zba.returnedCount} historical record${zba.returnedCount === 1 ? "" : "s"} returned`,
    detail: [
      zba.message,
      zba.coverage === "partial"
        ? "The returned set is partial; consult the cited City layer for the complete published result."
        : null,
      omittedCount > 0
        ? `${omittedCount} additional record${omittedCount === 1 ? " is" : "s are"} not listed in this compact report.`
        : null,
      "These are historical City records whose published geometry intersects the selected point. A past judgment does not establish current authorization, permitted use, or compliance.",
      "In the cited ArcGIS layer, use the Query tool to search the ORDINANCE field for the case reference. Verify conditions, amendments, expiration or revocation, and current effect with the Chicago Zoning Board of Appeals or Department of Planning and Development before relying on it.",
      zba.source.freshnessNote,
    ].filter(Boolean).join(" "),
    url: zba.source.url,
  }];

  for (const zbaCase of displayedCases) {
    const caseLabel = ZBA_CASE_TYPE_LABELS[zbaCase.caseType];
    items.push({
      label: `${caseLabel} · ${zbaCase.caseReference ?? "Case reference not published"}`,
      value: zbaCase.judgment ?? "Judgment not published",
      detail: [
        zbaCase.address ? `Published address: ${zbaCase.address}.` : null,
        zbaCase.caseType === "unknown" && zbaCase.caseTypeRaw
          ? `Published case-type code: ${zbaCase.caseTypeRaw}. The Explorer did not map it to a standard ZBA category.`
          : null,
        zbaCase.description,
        "Judgment text is shown as published by the City and has not been normalized by the Explorer.",
        `Open the cited City ArcGIS layer, use Query to search the ORDINANCE field for ${zbaCase.caseReference ?? "the published case reference"}, and confirm its current effect before relying on this record.`,
      ].filter(Boolean).join(" "),
      url: zba.source.url,
    });
  }
  return items;
}

function buildZoningReportItems(
  cityZoning: ReportZoningData | undefined,
): ReportItem[] {
  const zoningItem = buildZoningReportItem(cityZoning);
  return [
    ...(zoningItem ? [zoningItem] : []),
    ...buildZbaReportItems(cityZoning?.zba),
  ];
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
  const exploratoryPrograms = sortExploratoryProgramItems(filterDiscoveryPrograms(programs), zones, confidenceMap);

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
    const parcelStreetLine = parcel.address ? parcel.address.split(",")[0].trim() : "";
    const propertyItems: ReportItem[] = [];
    // Address guard: a parcel resolved from a geocoded point can belong to a
    // different address than the one searched (street-right-of-way points,
    // large multi-address parcels). Never present a mismatched parcel's
    // records as the searched address's records without saying so.
    if (parcel.addressMatch === "mismatch" && parcelStreetLine) {
      propertyItems.push({
        label: "Parcel address check",
        value: `Records are for ${parcelStreetLine}`,
        detail: `No Cook County parcel record was found published under ${
          parcel.requestedAddress || "the searched address"
        }. The PIN and assessor records below describe the parcel at this location — ${parcelStreetLine} — which may be a larger or differently addressed parcel. Verify the legal address and PIN with the Cook County Assessor before relying on them.`,
      });
    }
    propertyItems.push(
      {
        label: "Property PIN",
        value: parcel.pin,
        detail: `Cook County Assessor record${parcelStreetLine ? ` for ${parcelStreetLine}` : ""} — cookcountyassessoril.gov/pin/${parcel.pin}`,
        url: `https://www.cookcountyassessoril.gov/pin/${parcel.pin}`,
      },
      {
        label: "Building Classification",
        value: `${parcel.classCode} — ${parcel.classDescription}`,
        detail: parcel.isVacant
          ? "Vacant land — review new-construction and Land Bank program requirements"
          : parcel.isCommercial
            ? "Commercial property — Class 7a requirements are relevant to review"
            : parcel.isIndustrial
              ? "Industrial property — review industrial-development program requirements"
              : "Residential property classification",
      },
    );
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
      id: SECTION_IDS.siteDescriptionPropertyProfile,
      title: "Site Description & Property Profile",
      description: "Property data from Cook County Assessor records for due diligence and application reference.",
      items: propertyItems,
    });
  }

  // §02 Zoning & Regulatory Review
  const zoningItems = buildZoningReportItems(cityZoning);
  if (zoningItems.length > 0) {
    sections.push({
      id: SECTION_IDS.zoningRegulatoryReview,
      title: "Zoning & Regulatory Review",
      // review5 S5: the final sentence names the ZONING authority
      // (authorityReferenceLine("zoning") = "Chicago Zoning Board of
      // Appeals (ZBA)") explicitly for the use-verification instruction —
      // an earlier ZBA mention in this same description does not excuse
      // THIS sentence's own generic-City phrasing, per the sentence-by-
      // sentence doctrine build-spec.md F10/S4 established for the
      // concierge validator and now applied here too.
      description: `Published City zoning classification and cited City ZBA records for the selected location. The cited datasets are official City sources. The Explorer's point matches and presentation are informational and are not a City zoning determination. Consult the cited records and verify the intended use, case history, and project requirements with the ${authorityReferenceLine("zoning")} before relying on them.`,
      items: zoningItems,
    });
  }

  // §03 Neighborhood Economic Context
  const neighborhoodEconomicSection = buildNeighborhoodEconomicContextSection(ctx, zones, marketContext);
  if (neighborhoodEconomicSection) sections.push(neighborhoodEconomicSection);
  const localImpactAnchorsSection = buildLocalImpactAnchorsSection(ctx);
  if (localImpactAnchorsSection) sections.push(localImpactAnchorsSection);

  // §04 Incentive zone coverage and program interactions
  if (zoneCount > 0) {
    const zoneItems: ReportItem[] = activeZones.map((key) => {
      const matchingPrograms = programs.filter((p) => p.zoneKey === key);
      return {
        label: ZONE_LABELS[key] || key,
        value: zoneNames?.[key] || (matchingPrograms.length > 0
          ? `${matchingPrograms.length} program${matchingPrograms.length !== 1 ? "s" : ""}`
          : "Active"),
        detail: (ZONE_DESCRIPTIONS[key] ? ZONE_DESCRIPTIONS[key] + " " : "") +
          (matchingPrograms.map((p) => p.name).join("; ") || ""),
      };
    });
    // Add program interaction notes without exposing internal rankings.
    if (stackingAnalysis) {
      zoneItems.push({ label: "Mapped Zone Coverage", value: `${stackingAnalysis.zoneCount} zone${stackingAnalysis.zoneCount === 1 ? "" : "s"}`, detail: stackingAnalysis.narrative });
      for (const combo of stackingAnalysis.combinations) {
        zoneItems.push({ label: combo.zones.join(" + "), value: "Verify interaction", detail: combo.benefit });
      }
    }
    sections.push({
      id: SECTION_IDS.incentiveZoneCoverage,
      title: `Incentive Zone Coverage & Program Interactions (${zoneCount} zones)`,
      description: "Mapped incentive zones at this location and program interactions to confirm with the relevant administrators.",
      items: zoneItems,
    });
  }

  // §05 Vacancy Opportunity Assessment
  const feasibilityItems: ReportItem[] = [];

  if (projectType === "rehab" || projectType === "mixed-use-conversion") {
    if (parcel?.bldgAge != null && parcel.bldgAge >= 50 && activeZones.includes("nrhpDistricts")) {
      feasibilityItems.push({
        label: "Historic Tax Credit review",
        value: "Age and district records found",
        detail: "The recorded building age and National Register district status are relevant to the published Federal Historic Tax Credit requirements for certified rehabilitation.",
      });
    } else if (parcel?.bldgAge != null && parcel.bldgAge >= 50) {
      feasibilityItems.push({
        label: "Historic designation review",
        value: "Building age recorded as 50+ years",
        detail: "Review whether individual listing or a district designation applies before relying on historic program terms.",
      });
    }
    if (activeZones.includes("tif") || activeZones.includes("sbif")) {
      feasibilityItems.push({
        label: "Renovation funding",
        value: "Mapped TIF/SBIF area",
        detail: "This site is recorded in a TIF district and/or SBIF area. Confirm current project requirements, caps, and open funding rounds before applying.",
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
        value: "Recorded vacant parcel",
        detail: "The parcel is classified as vacant land. Review current Land Bank acquisition and City disposition requirements.",
      });
    }
    if (parcel?.isCommercial && isClass7aEligible(parcel.classCode)) {
      feasibilityItems.push({
        label: "Class 7a review",
        value: "Worth confirming",
        detail: `Property class ${parcel.classCode} is one signal to review against the current Class 7a requirements for this project.`,
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
      detail: "Enterprise Zone benefits may be relevant to eligible projects at this site. Confirm the current project, cost, and application requirements with the program administrator.",
    });
  }

  if (feasibilityItems.length === 0) {
    feasibilityItems.push({
      label: "Mapped zone context",
      value: `${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""}`,
      detail: zoneCount > 0
        ? "Each mapped program has separate eligibility and approval requirements to confirm."
        : "Broader county, state, federal, and utility programs may still be worth exploring.",
    });
  }

  sections.push({
    id: SECTION_IDS.locationContext,
    title: `${projectLabel} Location Context`,
    description: "Vacancy-focused property and program context to verify before relying on an incentive or financing path.",
    items: feasibilityItems,
  });

  // §06 Available Programs
  if (sitePrograms.length > 0) {
    sections.push({
      id: SECTION_IDS.programsMappedAtThisSite,
      title: `Programs Mapped at This Site (${sitePrograms.length})`,
      description: "Programs linked to this site through mapped incentive-zone boundaries. Each program requires separate review.",
      items: sitePrograms.slice(0, 8).map((program) =>
        programReportItem(
          program,
          confidenceMap,
          undefined,
          undefined,
          publicEvidenceForProgram(program, state, zones, zoneNames),
        ),
      ),
    });
  }

  if (exploratoryPrograms.length > 0) {
    sections.push({
      id: SECTION_IDS.additionalProgramsToExplore,
      title: "Additional Programs to Explore",
      description: "Broader programs, including Cook County tools, that require project, property, and administrator review.",
      items: exploratoryPrograms.slice(0, 8).map((program) =>
        programReportItem(
          program,
          confidenceMap,
          undefined,
          undefined,
          publicEvidenceForProgram(program, state, zones, zoneNames),
        ),
      ),
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
        detail: `${z.length} incentive zone${z.length !== 1 ? "s" : ""} at this site.${p?.isCommercial ? " Commercial classification is worth reviewing against additional property tax incentive programs." : ""}`,
        
      }),
      "zoning-compatibility": (_p, _z) => ({
        label: "Zoning Compatibility",
        value: "Check city zoning",
        // review5 S5: a zoning-classification/use-permission sentence —
        // routed through authorityReferenceLine("zoning") rather than a
        // generic "verify with the city" instruction.
        detail: `Verify that the current city zoning classification supports your intended use with the ${authorityReferenceLine("zoning")}. See Zoning & Regulatory Review section.`,
      }),
      "property-condition": (p) => ({
        label: "Property Condition",
        value: p?.bldgAge != null ? `${p.bldgAge}-year-old building` : "No building data",
        detail: p?.bldgAge != null
          ? p.bldgAge >= 50
            ? "Older structure — factor in renovation costs and review current historic tax credit requirements."
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
          ? "TIF/SBIF area mapped"
          : z.includes("microMarketRecovery")
            ? "Micro Market area mapped"
            : "Limited direct grants",
        detail: (z.includes("tif") || z.includes("sbif"))
          ? "This site is recorded in a TIF district and/or SBIF area. Review current project and reimbursement requirements."
          : "No direct grant programs identified at this location. Consider county-wide programs.",
        
      }),
    };

    sections.push({
      id: SECTION_IDS.decisionFactors,
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
  const topSitePrograms = selectTopPrograms(sitePrograms, 2);
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
      description: "Contact the Illinois SHPO to review the building against the National Register and federal Historic Tax Credit criteria.",
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
  summaryParts.push(`${sitePrograms.length} program${sitePrograms.length !== 1 ? "s" : ""} mapped at this address`);
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
    summary: `${verdict?.headline || "Site assessment complete"}. ${summaryParts.join(". ")}. ${projectType === "rehab" && parcel?.bldgAge != null && parcel.bldgAge >= 50 ? "The building's age may warrant reviewing current historic tax credit requirements. " : ""}The sections below are organized from key findings to detailed evidence.`,
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
      id: levelProgramsSectionId(level),
      title: `${level}-Level Programs`,
      items: levelPrograms.map((p) => programReportItem(p)),
    });
  }

  // If no programs matched the filters, show a fallback section
  if (sections.length === 0) {
    sections.push({
      id: SECTION_IDS.noProgramsMatchCurrentFilters,
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
      label: "Add your project details",
      description:
        "Answer four project questions to narrow the programs and requirements worth reviewing.",
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

  // Resolve credit IDs to programs
  const creditPrograms = creditsToAnalyze
    .map((id) => programs.find((p) => p.id === id))
    .filter((p): p is Program => !!p);

  const sections: ReportSection[] = [];

  // Section 1: Incentive Pathway Review
  const stackingItems: ReportItem[] = creditPrograms.map((program) => ({
    ...programReportItem(program, undefined, undefined, undefined, publicEvidenceForProgram(program, state)),
    value: "Review published terms",
    detail: program.summary,
  }));

  sections.push({
    id: SECTION_IDS.incentivePathwayReview,
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
    // Same guidance-vs-requirement split as the site-incentives §04 above: this
    // section also publishes under a "Required Documents" heading, so a record
    // that says "No application needed" must not be listed or counted as one.
    for (const doc of p.requiredDocs.filter((d) => !isDocumentRequirementGuidance(d))) {
      allRequiredDocs.add(doc);
      if (!docProgramMap[doc]) docProgramMap[doc] = new Set();
      docProgramMap[doc].add(p.name);
    }
    // review6 S11 investigation: was `value: p.whoQualifies` — the raw
    // internal-only catalog field, rendered as this item's PRIMARY,
    // most-prominent text (not even behind an accordion). Section 1
    // above (`stackingItems`) already uses the safe pattern for this
    // exact function — a generic value plus `program.summary` in detail
    // — so this now derives from the same reviewed, structured
    // `eligibilityRules[]` PublicProgramView itself is built from,
    // falling back to the already-public `summary` when a program has no
    // structured rules on file.
    const publishedCriteria = (p.eligibilityRules ?? [])
      .map((rule) => rule.description.trim())
      .filter(Boolean)
      .join(" ");
    allQualifications.push({
      ...programReportItem(p, undefined, undefined, undefined, publicEvidenceForProgram(p, state)),
      value: publishedCriteria || p.summary,
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
    id: SECTION_IDS.requiredDocuments,
    title: "Required Documents",
    description: `${allRequiredDocs.size} documents across the selected programs, organized by category. Each document lists which program(s) require it.`,
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
    id: SECTION_IDS.applicationRoadmap,
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
    label: "Confirm zone requirements for all selected programs",
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
  const placeBasedPrograms = programs.filter((program) => program.zoneKey).length;
  const activityWindowMonths = details.windowMonths ?? turnover.windowMonths ?? permits.windowMonths ?? 24;
  // Anchor every trailing-window phrase to the snapshot date. "Trailing 24
  // months" with no endpoint reads as "the 24 months before today", which is
  // wrong the day after the snapshot is computed.
  const asOfLabel = metric?.asOf
    ? new Date(metric.asOf).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    : null;
  const activityWindowLabel = asOfLabel
    ? `Trailing ${activityWindowMonths} months ending ${asOfLabel}`
    : `Trailing ${activityWindowMonths} months`;
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
  ];

  const confidenceItems: ReportItem[] = [
    {
      label: "Data vintage",
      value: asOfLabel ? `Snapshot dated ${asOfLabel}` : "Snapshot date unavailable",
      detail:
        "Every corridor metric in this report comes from this snapshot; the report's generation date is not the data date. Trailing-window metrics count backward from the snapshot date, not from today.",
    },
    {
      label: "Geography",
      value: metric?.corridorType === "zip" ? "ZIP-based pilot" : "Selected corridor",
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

  // ── Pilot baseline: this corridor against the other pilot corridors from
  //    the SAME snapshot and trailing window. Not a citywide benchmark — the
  //    dataset does not support one, and the description says so.
  const baselineMetrics = (() => {
    const all = loadAllStaticCorridorMetrics();
    if (!metric?.corridorId) return all;
    const others = all.filter((m) => m.corridorId !== metric.corridorId);
    return [metric, ...others].sort((a, b) => a.corridorId.localeCompare(b.corridorId));
  })();
  const baselineColumns = [
    "Signal",
    ...baselineMetrics.map((m) =>
      m.corridorId === metric?.corridorId ? `ZIP ${m.corridorId} (this report)` : `ZIP ${m.corridorId}`
    ),
  ];
  const baselineRows =
    baselineMetrics.length >= 2
      ? [
          [
            "Vacancy signals",
            ...baselineMetrics.map((m) => {
              const v = m.details?.vacancy ?? {};
              return v.vacantCount != null && v.totalParcels != null
                ? `${formatNumber(v.vacantCount)} / ${formatNumber(v.totalParcels)} parcels (${formatRate(m.vacancyRate)})`
                : formatRate(m.vacancyRate);
            }),
          ],
          [
            "License change",
            ...baselineMetrics.map((m) => {
              const t = m.details?.turnover ?? {};
              return t.openings != null && t.closures != null
                ? `${Number(t.openings) - Number(t.closures) >= 0 ? "+" : ""}${formatNumber(Number(t.openings) - Number(t.closures))} net (${formatNumber(t.openings)} openings / ${formatNumber(t.closures)} closures)`
                : formatRate(m.turnoverRate);
            }),
          ],
          [
            "Local ownership share",
            ...baselineMetrics.map((m) => {
              const o = m.details?.ownershipOrigin ?? {};
              return o.localCount != null && o.outsideCount != null
                ? `${formatRate(m.localOwnershipShare)} (${formatNumber(o.localCount)} local / ${formatNumber(o.outsideCount)} outside)`
                : formatRate(m.localOwnershipShare);
            }),
          ],
          [
            "Permits",
            ...baselineMetrics.map((m) => {
              const pm = m.details?.permits ?? {};
              return m.permitCount != null
                ? `${formatNumber(m.permitCount)}${pm.totalReportedCost != null ? ` (${formatMoneyShort(pm.totalReportedCost)} reported)` : ""}`
                : "Not available";
            }),
          ],
        ]
      : [];

  return {
    title: `Corridor Intelligence Pilot — ${label}`,
    subtitle: "Market and resilience signals for corridor partners",
    reportType: "corridor-intelligence",
    generatedAt: new Date().toISOString(),
    summary: hasMetric
      ? `${label} shows ${netLicenseCount != null && netLicenseCount > 0 ? "strong business momentum" : "measurable business activity"} and active reinvestment, with vacancy concentrated in a reviewable set of ${formatNumber(vacancy.vacantCount)} flagged parcels and a highly fragmented ownership base. ${asOfLabel ? `Data as of ${asOfLabel}. ` : ""}Activity metrics use a ${activityWindowLabel.toLowerCase()} unless noted.`
      : `${label} does not have a computed corridor metric snapshot yet. This report still shows the intended data structure, but the metrics should be backfilled before using it for decisions.`,
    sections: [
      {
        id: SECTION_IDS.marketSignalSummary,
        title: "Market Signal Summary",
        description: "The numbers in one place. Each row pairs a signal with the plain-language read it supports.",
        table: {
          columns: ["Signal", "Current Read", "Data Basis", "Interpretation"],
          rows: metricRows,
        },
        items: [],
      },
      ...(baselineRows.length > 0
        ? [
            {
              id: SECTION_IDS.pilotBaseline,
              title: "Pilot Baseline: The Three Corridors Side By Side",
              description: `Each number above needs a comparison to mean anything. The only baseline this dataset honestly supports is the other pilot corridors, computed from the same${asOfLabel ? ` ${asOfLabel}` : ""} snapshot with the same ${activityWindowMonths}-month trailing window and the same methods. This is not a citywide benchmark: three Southeast Side ZIP areas cannot stand in for Chicago, and differences between them are directional, not rankings.`,
              table: {
                columns: baselineColumns,
                rows: baselineRows,
              },
              items: [],
            },
          ]
        : []),
      {
        id: SECTION_IDS.whatTheSignalsSay,
        title: "What The Signals Say",
        description: "A short read of what the current data supports, without turning the report into a recommendation engine.",
        items: signalItems,
      },
      ...(ownerOperatorRows.length > 0
        ? [
            {
              id: SECTION_IDS.ownerOperatorMap,
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
        id: SECTION_IDS.howToReadThis,
        title: "How To Read This",
        description: "Source notes, confidence limits, and units of measure for interpreting the corridor snapshot.",
        table: {
          columns: ["Domain", "Source / Signal", "Current Value", "Caution"],
          rows: sourceRows,
        },
        items: confidenceItems,
      },
      {
        id: SECTION_IDS.whatAFundedVersionUnlocks,
        title: "What A Funded Version Adds",
        description: "This public pilot shows what is possible with three ZIP-based geographies. A funded version would make it reliable across more places and partner workflows.",
        items: [
          {
            label: "What this pilot proves",
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

function buildLogisticsAccessItem(transport: TransportAccess): ReportItem {
  const detailLines = [
    transport.rail
      ? `Freight rail: ${transport.rail.name} (${formatMiles(transport.rail.miles)})`
      : null,
    `Midway Airport: ${formatMiles(transport.midwayMiles)}`,
    `O'Hare Airport: ${formatMiles(transport.ohareMiles)}`,
    "Straight-line distance only; verify travel time, truck access, loading, and site constraints before relying on this for a project decision.",
  ].filter(Boolean) as string[];

  return {
    label: "Logistics Access",
    value: transport.expressway
      ? `${transport.expressway.name} - ${formatMiles(transport.expressway.miles)}`
      : "Distances loaded",
    detail: detailLines.join("\n"),
    sourceLabel: "Transportation and logistics access layer",
  };
}

function humanizeTransportationName(value: string): string {
  const letters = value.match(/[A-Za-z]/g) || [];
  if (letters.length === 0) return value;
  const uppercaseRatio = letters.filter((letter) => letter === letter.toUpperCase()).length / letters.length;
  if (uppercaseRatio < 0.75) return value;

  const uppercaseTokens = new Set(["n", "s", "e", "w", "cta", "bnsf", "ri", "csx"]);
  const lowercaseTokens = new Set(["to", "on", "and", "of"]);

  return value.toLowerCase().replace(/\b[a-z0-9]+\b/g, (token) => {
    if (uppercaseTokens.has(token)) return token.toUpperCase();
    if (lowercaseTokens.has(token)) return token;
    if (/^\d+(st|nd|rd|th)$/.test(token)) return token;
    return token.charAt(0).toUpperCase() + token.slice(1);
  });
}

function formatAccessPointName(point: MobilityAccessPoint): string {
  const name = humanizeTransportationName(point.name);
  if (point.category !== "cta_rail") return name;
  return name.replace(/\(([^)]+)\)$/, (match, line: string) =>
    /line$/i.test(line) ? match : `(${line} Line)`,
  );
}

function formatAccessPointRoutes(point: MobilityAccessPoint): string | null {
  const routes = point.routes?.slice(0, 4) || [];
  if (routes.length === 0) return null;
  if (point.category === "bus_stop") {
    return `${routes.length === 1 ? "Route" : "Routes"} ${routes.join(", ")}`;
  }
  if (point.category === "metra") {
    return routes.map((route) => (/line$/i.test(route) ? route : `${route} Line`)).join(", ");
  }
  return routes.join(", ");
}

function pointEntries(points: MobilityAccessPoint[], limit = 3): string[] {
  return points.slice(0, limit).map((point) =>
    [formatAccessPointName(point), formatAccessPointRoutes(point), formatMiles(point.miles)]
      .filter(Boolean)
      .join(" · "),
  );
}

function lineEntries(lines: MobilityAccessLine[], limit = 3): string[] {
  return lines.slice(0, limit).map((line) =>
    [
      line.routeType ? humanizeTransportationName(line.routeType) : null,
      humanizeTransportationName(line.name),
      formatMiles(line.miles),
    ]
      .filter(Boolean)
      .join(" · "),
  );
}

function buildTransportationSiteAccessItem(mobility: MobilityAccess): ReportItem {
  const detailGroups: ReportDetailGroup[] = [
    { id: "cta-rail", label: "CTA rail", items: pointEntries(mobility.ctaRailStations) },
    { id: "cta-bus", label: "CTA bus", items: pointEntries(mobility.busStops) },
    { id: "metra", label: "Metra", items: pointEntries(mobility.metraStations) },
    { id: "bike-routes", label: "Bike routes", items: lineEntries(mobility.bikeRoutes) },
    { id: "drive-access", label: "Drive access", items: lineEntries(mobility.expressways) },
    { id: "airports", label: "Airports", items: pointEntries(mobility.airports, 2) },
    { id: "freight-rail", label: "Freight rail", items: lineEntries(mobility.freightRail) },
  ].filter((group) => group.items.length > 0);
  const detailCaveat = mobility.caveats[0]
    || "Distances are straight-line proximity signals; verify travel time and site access before relying on them.";
  const detailLines = detailGroups.map((group) => `${group.label}: ${group.items.join(" · ")}`);

  return {
    label: "Transportation & Site Access",
    value: [mobility.transitLabel, mobility.bikeLabel, mobility.driveLabel]
      .filter(Boolean)
      .join(" · "),
    detail: [...detailLines, detailCaveat].join("\n"),
    detailGroups,
    detailCaveat,
    sourceLabel: "Public mobility and transportation access sources",
  };
}

/**
 * Logistics Access section (persona spec v2, "shortlist infra precedent"):
 * a dedicated, row-per-mode breakdown of the same mobility-access data
 * `buildTransportationSiteAccessItem` already summarizes into one Site Facts
 * item. Building this as a genuine canonical section (not a lens-time
 * fabrication) keeps the "engine emits one canonical section set, persona is
 * a pure display transform" boundary intact — the persona order map decides
 * where this sits, it never invents the data. Truck-route access is
 * deliberately omitted: no committed source backs it.
 */
function buildLogisticsAccessSection(
  mobility: MobilityAccess | null | undefined,
  transport: TransportAccess | null | undefined,
): ReportSection | null {
  const items: ReportItem[] = [];

  if (mobility) {
    const rail = mobility.ctaRailStations[0];
    if (rail) {
      items.push({
        label: "Nearest 'L'",
        value: [formatAccessPointName(rail), formatMiles(rail.miles)].filter(Boolean).join(" · "),
        detail: formatAccessPointRoutes(rail) || undefined,
      });
    }
    const bus = mobility.busStops[0];
    if (bus) {
      items.push({
        label: "Bus",
        value: [formatAccessPointName(bus), formatMiles(bus.miles)].filter(Boolean).join(" · "),
        detail: formatAccessPointRoutes(bus) || undefined,
      });
    }
    const expressway = mobility.expressways[0];
    if (expressway) {
      items.push({
        label: "Expressway",
        value: `${humanizeTransportationName(expressway.name)} ramp · ${formatMiles(expressway.miles)}`,
      });
    }
    const midway = mobility.airports.find((a) => /midway/i.test(a.name));
    const ohare = mobility.airports.find((a) => /o'?hare/i.test(a.name));
    if (midway || ohare) {
      items.push({
        label: "Airports",
        value: [
          midway ? `Midway ${formatMiles(midway.miles)}` : null,
          ohare ? `O'Hare ${formatMiles(ohare.miles)}` : null,
        ].filter(Boolean).join(" · "),
      });
    }
    const metra = mobility.metraStations[0];
    if (metra) {
      items.push({
        label: "Metra",
        value: [formatAccessPointName(metra), formatMiles(metra.miles)].filter(Boolean).join(" · "),
        detail: formatAccessPointRoutes(metra) || undefined,
      });
    }
  } else if (transport) {
    if (transport.rail) {
      items.push({ label: "Freight rail", value: `${transport.rail.name} · ${formatMiles(transport.rail.miles)}` });
    }
    if (transport.expressway) {
      items.push({ label: "Expressway", value: `${transport.expressway.name} · ${formatMiles(transport.expressway.miles)}` });
    }
    items.push({
      label: "Airports",
      value: `Midway ${formatMiles(transport.midwayMiles)} · O'Hare ${formatMiles(transport.ohareMiles)}`,
    });
  }

  if (items.length === 0) return null;

  return {
    id: SECTION_IDS.logisticsAccess,
    title: "Logistics Access",
    description: "Straight-line distance to transit, expressway, and airport access points. Verify travel time, truck access, and loading before relying on this for a project decision.",
    items,
  };
}

function buildSiteSignalsItem(siteSignals: SiteSignals): ReportItem {
  const lines = [
    siteSignals.nofAwardsNearby > 0
      ? `NOF grants funded within 1/2 mi: ${siteSignals.nofAwardsNearby}`
      : null,
    siteSignals.incentiveParcelsNearby > 0
      ? `County incentive parcels within 1/4 mi: ${siteSignals.incentiveParcelsNearby}`
      : null,
    siteSignals.brownfield && siteSignals.brownfield.miles < 0.5
      ? `Nearest brownfield site: ${siteSignals.brownfield.name} (${formatMiles(siteSignals.brownfield.miles)})`
      : null,
    siteSignals.openLustNearby > 0
      ? `Open tank-leak incidents within 1/4 mi: ${siteSignals.openLustNearby}`
      : null,
  ].filter(Boolean) as string[];

  const signalCount = [
    siteSignals.nofAwardsNearby > 0,
    siteSignals.incentiveParcelsNearby > 0,
    Boolean(siteSignals.brownfield && siteSignals.brownfield.miles < 0.5),
    siteSignals.openLustNearby > 0,
  ].filter(Boolean).length;

  return {
    label: "Site Signals",
    value: signalCount > 0
      ? `${signalCount} nearby public-data signal${signalCount === 1 ? "" : "s"}`
      : "No nearby signals",
    detail: [
      ...(lines.length > 0 ? lines : ["No nearby NOF funding, county incentive parcel, brownfield, or open tank-leak signal was found within the current proximity thresholds."]),
      "Public-data proximity signals only; verify with DPD, Cook County, IEPA/EPA, or the administering agency before relying on them.",
    ].join("\n"),
    sourceLabel: "Public site-signal layers",
  };
}

function districtParts(districts: DistrictData): string[] {
  const parts: string[] = [];
  if (districts.ward) parts.push(`Ward ${districts.ward}`);
  if (districts.commissionerDistrict) parts.push(`Commissioner Dist. ${districts.commissionerDistrict}`);
  if (districts.congressionalDistrict) parts.push(`IL-${districts.congressionalDistrict}`);
  if (districts.stateHouseDistrict) parts.push(`State Rep Dist. ${districts.stateHouseDistrict}`);
  if (districts.stateSenateDistrict) parts.push(`State Senate Dist. ${districts.stateSenateDistrict}`);
  return parts;
}

function officialParts(districts: DistrictData): string[] {
  return [
    districts.officials?.alderperson
      ? `${districts.officials.alderperson.name} (${districts.officials.alderperson.districtLabel})`
      : null,
    districts.officials?.commissioner
      ? `${districts.officials.commissioner.name} (${districts.officials.commissioner.districtLabel})`
      : null,
    districts.officials?.congressionalRepresentative
      ? `${districts.officials.congressionalRepresentative.name} (${districts.officials.congressionalRepresentative.districtLabel})`
      : null,
    districts.officials?.stateRepresentative
      ? `${districts.officials.stateRepresentative.name} (${districts.officials.stateRepresentative.districtLabel})`
      : null,
    districts.officials?.stateSenator
      ? `${districts.officials.stateSenator.name} (${districts.officials.stateSenator.districtLabel})`
      : null,
  ].filter(Boolean) as string[];
}

function buildPoliticalDistrictItem(districts: DistrictData): ReportItem | null {
  const parts = districtParts(districts);
  if (parts.length === 0) return null;

  const officials = officialParts(districts);
  return {
    label: officials.length > 0 ? "Civic Representation" : "Political Districts",
    value: parts.slice(0, 2).join(" · "),
    detail: [
      ...(parts.length > 2 ? [parts.slice(2).join(" · ")] : []),
      ...(officials.length > 0 ? [`Current officials: ${officials.join(" · ")}`] : []),
      "Representative info is civic context only; verify with the source offices before formal outreach or applications.",
    ].join("\n"),
  };
}

/**
 * Civic Representation section (persona spec v2). Re-presents the SAME
 * sourced `DistrictData` (ward/alderperson, county commissioner district,
 * police district — each carrying its own sourceId/sourceLabel/sourceUrl/
 * refreshedAt provenance where an elected official is attached) plus the
 * community area and SSA/corridor zone names the engine already computes,
 * as a dedicated section instead of one folded item. Genuinely canonical,
 * not lens-time: this only reorganizes data the engine already sourced and
 * verified — it adds nothing new. Police district comes from
 * lib/district-lookup.ts's live query against the City's boundary layer
 * (Socrata `9vmg-9p8p`, the same intersects()-query pattern the ward lookup
 * already used) — see lib/police-districts.ts for the district-name map.
 */
function buildCivicRepresentationSection(
  districts: DistrictData | null | undefined,
  zones: Record<string, boolean> | null | undefined,
  zoneNames: Record<string, string> | null | undefined,
  communityArea: string | null | undefined,
): ReportSection | null {
  const items: ReportItem[] = [];

  if (districts?.ward) {
    const alder = districts.officials?.alderperson;
    items.push({
      label: "Ward",
      value: alder ? `${districts.ward} · Ald. ${alder.name}` : districts.ward,
      detail: alder ? `Source: ${alder.sourceLabel}, verified ${alder.refreshedAt}` : undefined,
      sourceUrl: alder?.sourceUrl,
    });
  }
  if (communityArea) {
    items.push({ label: "Community area", value: communityArea });
  }
  if (districts?.policeDistrict) {
    items.push({
      label: "Police district",
      value: policeDistrictLabel(districts.policeDistrict),
      sourceLabel: "City of Chicago Boundaries — Police Districts",
    });
  }
  if (districts?.commissionerDistrict) {
    const commissioner = districts.officials?.commissioner;
    items.push({
      label: "County commissioner district",
      value: commissioner
        ? `${districts.commissionerDistrict} · Comm. ${commissioner.name}`
        : districts.commissionerDistrict,
      detail: commissioner ? `Source: ${commissioner.sourceLabel}, verified ${commissioner.refreshedAt}` : undefined,
      sourceUrl: commissioner?.sourceUrl,
    });
  }
  if (zones?.ssa && zoneNames?.ssa) {
    items.push({ label: "SSA", value: zoneNames.ssa, programId: "ssa" });
  }
  if (zones?.ccsa && zoneNames?.ccsa) {
    items.push({ label: "City corridor", value: zoneNames.ccsa, programId: "ccsa" });
  }

  if (items.length === 0) return null;

  return {
    id: SECTION_IDS.civicRepresentation,
    title: "Civic Representation",
    description: "Elected and appointed representation for this address, from the same sourced district data used elsewhere in this report.",
    items,
  };
}

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
export interface LegacyReportZoningData {
  status?: never;
  zoneClass: string;
  zoneType?: string | null;
  zoneTypeCode?: number | null;
  pdNumber?: number | null;
  pmdSubArea?: string | null;
  pedestrianStreetAreaName?: string | null;
  ordinanceNumber?: string | null;
  ordinanceDate?: string | null;
  clerkDocumentNumber?: string | null;
  clerkUrl?: string | null;
  recordUpdatedAt?: string | null;
  source?: ZoningSourceMetadata | null;
  zba?: ChicagoZbaLookupResponse;
  message?: never;
}

export type ReportZoningData = ZoningLookupResponse | LegacyReportZoningData;

/**
 * Bundled context for report generation — replaces the growing param list.
 */
export interface ReportContext {
  zones?: Record<string, boolean>;
  zoneNames?: Record<string, string>;
  /**
   * Zone Evidence v2 cutover (build-spec.md 2.3; audit F2): layer keys whose
   * check could not be completed. A negative zone summary MUST NOT be
   * rendered as a confirmed "no mapped zones" claim when this is non-empty
   * — see computeVerdict's headline logic, which switches to an honest
   * "N layers could not be checked" line instead.
   */
  unknownZones?: string[];
  /** ISO date the zone evidence was actually checked (from the v2 envelope's checkedAt), used in the unknown-layers headline. */
  zoneCheckedAt?: string;
  census?: ReportCensusData;
  cityZoning?: ReportZoningData;
  parcel?: ParcelData;
  districts?: DistrictData;
  stackingRules?: StackingRule[];
  communityAssets?: CommunityAsset[];
  localBusinessSupport?: LocalBusinessSupportContext | null;
  stats?: Stats;
  corridorMetrics?: CorridorMetric | null;
  /** Report ZIP resolved by the page (geocode/parcel/address) — corridor metrics key. */
  reportZip?: string | null;
  corridorOwnerClusters?: CorridorOwnerCluster[];
  neighborhoodEconomics?: NeighborhoodEconomicContext;
  siteSignals?: SiteSignals | null;
  transport?: TransportAccess | null;
  mobilityAccess?: MobilityAccess | null;
  locationContext?: LocationContext;
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
  // Availability gate: 'expired' programs (past expiresOn, or one-time
  // programs whose every deadline has passed) are excluded from every report
  // type — eligible sections, exploratory sections, verdict counts, document
  // checklists, and the deadlines section. 'window-closed' and
  // 'lapsed-notice' programs stay in and are annotated by programReportItem.
  const gatingToday = new Date();
  programs = programs.filter(
    (p) => resolveAvailability(p, gatingToday).state !== "expired",
  );

  const locationContext = ctx.locationContext ?? buildLocationContext(state, programs, ctx);
  ctx = { ...ctx, locationContext };
  const { zones, zoneNames, census } = ctx;
  const cityZoning = locationContext.geography.cityZoning?.value ?? ctx.cityZoning;
  const parcel = locationContext.geography.parcel?.value ?? (ctx.parcel ? publicParcelContext(ctx.parcel) : undefined);
  const districts = locationContext.geography.districts?.value ?? ctx.districts;
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
  report.locationContext = locationContext;
  if (locationContext.neighborhood.economics?.value) {
    report.neighborhoodEconomics = locationContext.neighborhood.economics.value;
  } else if (ctx.neighborhoodEconomics) {
    report.neighborhoodEconomics = ctx.neighborhoodEconomics;
  }

  // Attach census + zoning data to metadata for address-based reports
  if (reportType !== "program-explorer") {
    if (census?.medianIncome != null) report.metadata.medianIncome = census.medianIncome;
    if (census?.medianHomeValue != null) report.metadata.medianHomeValue = census.medianHomeValue;
    if (cityZoning?.zoneClass) report.metadata.zoneClass = cityZoning.zoneClass;
    if (cityZoning?.zoneType) report.metadata.zoneType = cityZoning.zoneType;

    // Insert a "Site Profile" section — property, zoning, and district data only
    // (census/market data lives in Neighborhood Economic Context to avoid duplication)
    const contextItems: ReportItem[] = [];
    const hasDedicatedZoningSection = report.sections.some(
      (section) => section.id === SECTION_IDS.zoningRegulatoryReview || section.title === "Zoning & Regulatory Review",
    );
    const zoningContextItems = hasDedicatedZoningSection
      ? []
      : buildZoningReportItems(cityZoning);

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
          ? "This property class is relevant to review under current Class 7a/7b requirements"
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
      const districtItem = buildPoliticalDistrictItem(districts);
      if (districtItem) contextItems.push(districtItem);
    }

    const mobilityAccess = locationContext.site.mobilityAccess?.value ?? ctx.mobilityAccess;
    const transport = locationContext.site.transport?.value ?? ctx.transport;
    if (mobilityAccess) {
      contextItems.push(buildTransportationSiteAccessItem(mobilityAccess));
    } else if (transport) {
      contextItems.push(buildLogisticsAccessItem(transport));
    }

    const siteSignals = locationContext.site.siteSignals?.value ?? ctx.siteSignals;
    if (siteSignals) {
      contextItems.push(buildSiteSignalsItem(siteSignals));
    }

    if (reportType === "site-incentives" || reportType === "location-incentives") {
      // Logistics Access + Civic Representation are genuine canonical
      // sections (persona spec v2) — built from data the engine already
      // computes and sources elsewhere, never dropped, only reordered by
      // the persona lens. Unshifted first here so they sit after Site
      // Facts once Site Facts and Zoning are unshifted below them.
      const civicRepresentationSection = buildCivicRepresentationSection(
        districts,
        zones,
        zoneNames,
        ctx.localBusinessSupport?.communityArea,
      );
      if (civicRepresentationSection) report.sections.unshift(civicRepresentationSection);
      const logisticsAccessSection = buildLogisticsAccessSection(mobilityAccess, transport);
      if (logisticsAccessSection) report.sections.unshift(logisticsAccessSection);
      if (contextItems.length > 0) {
        report.sections.unshift({
          id: SECTION_IDS.siteFacts,
          title: "Site Facts",
          description: "Property, district, transportation, and nearby public-data signals that help scope the project after the zoning starting point is understood.",
          items: contextItems,
        });
      }
      if (zoningContextItems.length > 0) {
        report.sections.unshift({
          id: SECTION_IDS.zoningUseStartingPoint,
          title: "Zoning & Use Starting Point",
          description: `Start here before committing to a lease, design, or construction scope. The report shows the published district and cited City case records; it does not classify the proposed activity or determine that a use is permitted. Define the exact activity, then verify the controlling ordinance and current process with the ${authorityReferenceLine("zoning")}.`,
          items: zoningContextItems,
        });
      }
    } else if (contextItems.length > 0 || zoningContextItems.length > 0) {
      report.sections.unshift({
        id: SECTION_IDS.locationContext,
        title: "Location Context",
        items: [...zoningContextItems, ...contextItems],
      });
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
          label: "Class 7a Review",
          value: "Requirements to review",
          detail: `Property class ${parcel.classCode} is relevant to the published reduced-assessment requirements (10% of market value for qualifying commercial or industrial rehabilitation).`,
        });
      }
      if (districts) {
        const districtItem = buildPoliticalDistrictItem(districts);
        if (districtItem) propertyItems.push(districtItem);
      }

      // Insert after Location Context / Site Profile
      const locCtxIdx = report.sections.findIndex((s) =>
        s.id
          ? LOCATION_CONTEXT_MARKER_IDS.has(s.id)
          : LOCATION_CONTEXT_MARKER_TITLES.has(s.title),
      );
      report.sections.splice(locCtxIdx + 1, 0, {
        id: SECTION_IDS.propertyAnalysis,
        title: "Property Analysis",
        items: propertyItems,
      });
    }
  }

  const capitalPartnerHandoff = capitalPartnerHandoffForReport(state, {
    zip: ctx.reportZip,
    lat: report.metadata.lat ?? state.lat,
    lon: report.metadata.lon ?? state.lon,
    asOf: report.generatedAt,
  });
  const capitalPartnerSection = capitalPartnerHandoff
    ? buildCapitalPartnerSection(capitalPartnerHandoff)
    : null;
  if (capitalPartnerHandoff?.primary && capitalPartnerSection) {
    report.capitalPartnerHandoff = capitalPartnerHandoff;
    const supportIndex = report.sections.findIndex((section) =>
      isSupportOrganizationSectionTitle(section.title),
    );
    const contextIndex = report.sections.reduce(
      (lastIndex, section, index) =>
        (section.id
          ? CONTEXT_SECTION_MARKER_IDS.has(section.id)
          : CONTEXT_SECTION_MARKER_TITLES.has(section.title))
          ? index
          : lastIndex,
      -1,
    );
    const insertionIndex = supportIndex >= 0
      ? supportIndex
      : contextIndex >= 0
        ? contextIndex + 1
        : 0;
    report.sections.splice(insertionIndex, 0, capitalPartnerSection);
  }

  // Attach executive summary for address-based reports when zone data is available.
  // `startHereResults` is hoisted out of this block so the StartHere model built
  // below can reuse the exact same goal-ordered results generateExecutiveSummary
  // (and therefore executiveSummary.topActions, via computeTopActions) used —
  // one ranked list feeding both, instead of two independent rankings that could
  // pick a different "top program."
  let startHereResults: ProgramCheckResult[] | undefined;
  if (zones && zoneNames && reportType !== "program-explorer") {
    // Run confidence engine once for exec summary (lightweight — it's already cached in location-incentives)
    const execResults = runConfidenceEngine(programs, zones, zoneNames, undefined, ctx.parcel);
    const projectGoals = selectedProjectGoals(state);
    const projectGoalLabels = selectedProjectGoalLabels(state);
    const orderedExecResults = projectGoals.length > 0
      ? orderProgramCheckResultsByProjectGoals(execResults, projectGoals, state.industry)
      : execResults;
    startHereResults = orderedExecResults;
    report.executiveSummary = generateExecutiveSummary(
      programs,
      zones,
      zoneNames,
      undefined,
      orderedExecResults,
    );
    if (projectGoalLabels.length > 0 && report.executiveSummary) {
      report.executiveSummary.projectGoalLabel = projectGoalLabels.join(", ");
      report.executiveSummary.projectGoalLabels = projectGoalLabels;
      // orderProgramCheckResultsByProjectGoals ranks on project-fit rules, and
      // the open-text goal has none — it moves nothing. The old sentence
      // listed every selected goal, custom text included, as an ordering input.
      const { ordering, contextOnly } = partitionGoalLabelsByOrderingUse(projectGoals, projectGoalLabels);
      const goalSentences = ordering.length > 0
        ? [
            `These programs are ordered across the selected goal${ordering.length === 1 ? "" : "s"}: ${joinLabels(ordering)}.`,
            contextOnly.length > 0
              ? `${joinLabels(contextOnly)} ${contextOnly.length === 1 ? "is" : "are"} recorded from your answers and ${contextOnly.length === 1 ? "does" : "do"} not affect that order.`
              : "",
          ]
        : ["Program ordering does not use the selected goals: none of them map to a program-fit rule."];
      report.executiveSummary.whyTheseMatter = `${goalSentences.filter(Boolean).join(" ")} ${report.executiveSummary.whyTheseMatter}`;
    }
  }

  report.actionRoadmap = report.actionRoadmap?.map((item) => ({
    ...item,
    preparationCost: item.preparationCost ?? classifyPreparationStepCost(
      item.label,
      item.description,
      ...(item.documents ?? []),
    ) ?? undefined,
  }));
  report.recommendedActions = report.recommendedActions.map((action) => ({
    ...action,
    preparationCost: action.preparationCost ?? classifyPreparationStepCost(
      action.label,
      action.description,
    ) ?? undefined,
  }));

  // `unresolvedZoningQuestion` is built from the exact same copy injected into
  // actionRoadmap[0] below, so StartHere's primary/unresolvedQuestions and the
  // legacy actionRoadmap's front-loaded zoning action are provably the same
  // fact, not two independently-worded claims that could drift apart.
  let unresolvedZoningQuestion: UnresolvedZoningQuestion | undefined;
  if (reportType !== "program-explorer" && cityZoning) {
    const zoningAction: ActionRoadmapItem = cityZoning.zoneClass
      ? {
          tier: "do-this-week",
          label: `Define the exact activity and verify its use category for ${cityZoning.zoneClass}`,
          description: `List every primary and accessory activity at the site, then ask the ${authorityReferenceLine("zoning")} to identify the controlling Title 17 use category and current process. The published district alone does not establish that a proposed use is permitted or that zoning relief is required.`,
        }
      : {
          tier: "do-this-week",
          label: "Retry the published zoning lookup before making a site commitment",
          // review5 S5: not-found/unavailable branch — routed through
          // authorityReferenceLine("zoning") like the resolved branch
          // above, not a generic "the City" reference.
          description: `No zoning conclusion is available in this report. Confirm the current district and controlling records directly with the ${authorityReferenceLine("zoning")} before relying on the site analysis.`,
        };
    const existingRoadmap = report.actionRoadmap ?? [];
    if (!existingRoadmap.some((item) => item.label === zoningAction.label)) {
      report.actionRoadmap = [zoningAction, ...existingRoadmap];
    }
    unresolvedZoningQuestion = {
      question: cityZoning.zoneClass
        ? `What is the exact proposed use, and which Title 17 use category does the ${authorityReferenceLine("zoning")} place it in for ${cityZoning.zoneClass}?`
        : `What does the current published zoning district record at this site, and has it been verified with the ${authorityReferenceLine("zoning")}?`,
      confirmationLabel: zoningAction.label,
      confirmationDescription: zoningAction.description,
    };
  }

  // Canonical StartHere model — built once, additive, from the same
  // goal-ordered results and the same zoning-confirmation copy the legacy
  // structures above already used. See lib/start-here.ts.
  if (startHereResults) {
    const zoneCount = countActiveZones(zones);
    const evidenceFacts: { fact: string; sourceLabel: string }[] = [
      {
        fact: `${zoneCount} mapped incentive zone${zoneCount === 1 ? "" : "s"} recorded at this address.`,
        sourceLabel: report.dataSources?.[0]?.label ?? "Public zone boundary data",
      },
    ];
    const topStartHereResult = startHereResults.find(
      (r) => r.relevance !== "not_mapped_at_location" && r.relevance !== "context_dependent",
    );
    if (topStartHereResult) {
      evidenceFacts.push({
        fact: topStartHereResult.whyOneLine,
        sourceLabel: topStartHereResult.program.name,
      });
    }
    report.startHere = buildStartHere({
      results: startHereResults,
      audience: reportType,
      unresolvedZoning: unresolvedZoningQuestion,
      evidenceFacts,
    });
  }

  return normalizePublicReportForDisplay(report);
}
