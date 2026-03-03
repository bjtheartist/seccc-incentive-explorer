import type { Program, ExecutiveSummary, ParcelData, DistrictData, StackingRule, CommunityAsset, Stats } from "./types";
import { isClass7aEligible } from "./parcel-classes";
import { ZONE_LABELS, ZONE_DESCRIPTIONS, describeZoneClass } from "./constants";
import { getIndustryById } from "./industries-data";
import { generateExecutiveSummary, computeStackingNarrative } from "./confidence-engine";
import { censusNarrative, CHICAGO_MEDIANS } from "./census-narrative";

// ─── Local Types ────────────────────────────────────────────────────

type ReportType =
  | "location-incentives"
  | "best-location"
  | "program-explorer"
  | "developer-analysis";

interface WizardState {
  reportType: ReportType | null;
  address: string;
  lat: number | null;
  lon: number | null;
  industry: string;
  activities: string[];
  incentiveInterests: string[];
  locationPriorities: string[];
  budgetRange: string;
  governmentLevels: string[];
  benefitTypes: string[];
  projectType: string;
  creditsToAnalyze: string[];
}

// ─── Output Types ───────────────────────────────────────────────────

export interface ReportSection {
  title: string;
  description?: string;
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
    medianIncome?: number;
    medianHomeValue?: number;
    zoneClass?: string;
    zoneType?: string;
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
const CREDIT_PERCENTAGES: Record<string, { pct: number; label: string }> = {
  federalOZ: { pct: 0.15, label: "~15% effective tax benefit on capital gains" },
  illinoisOZ: { pct: 0.05, label: "~5% IL state income tax benefit" },
  tif: { pct: 0.25, label: "Up to 25% of rehab costs" },
  sbif: { pct: 0.5, label: "Up to 50% of eligible costs (max $150K)" },
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
  workforceInvest: { pct: 0.05, label: "~5% via workforce training subsidies" },
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
  // Cap SBIF at $150K
  const capped = creditId === "sbif" ? Math.min(raw, 150_000) : raw;
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
  return industry.topPrograms.includes(program.id) || industry.topPrograms.includes(program.zoneKey);
}

/**
 * Filter programs by zone eligibility.
 */
function filterByZones(
  programs: Program[],
  zones?: Record<string, boolean>,
): Program[] {
  if (!zones) return programs;
  return programs.filter((p) => {
    if (!p.zoneKey) return true; // Non-zone programs always included
    return !!zones[p.zoneKey];
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
  const eligible = zones
    ? programs.filter((p) => !p.zoneKey || zones[p.zoneKey])
    : programs.filter((p) => !p.zoneKey);
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
  let walkabilityNarrative = "Walkability data not available for this location.";
  if (walkScore != null) {
    if (walkScore >= 70) walkabilityNarrative = `Walk Score ${walkScore}/100 — a walkable area with good foot traffic potential for customer-facing businesses.`;
    else if (walkScore >= 50) walkabilityNarrative = `Walk Score ${walkScore}/100 — somewhat walkable; some errands can be accomplished on foot.`;
    else walkabilityNarrative = `Walk Score ${walkScore}/100 — car-dependent area; consider drive-in or destination-based business models.`;
  }

  const zoneCount = zones ? Object.values(zones).filter(Boolean).length : 0;
  let zoneCoverageNarrative: string;
  if (zoneCount >= 4) zoneCoverageNarrative = `With ${zoneCount} active incentive zones, this location is in a high-coverage area — established programs target this neighborhood for investment.`;
  else if (zoneCount >= 2) zoneCoverageNarrative = `${zoneCount} incentive zones overlap at this location, providing moderate program coverage.`;
  else if (zoneCount === 1) zoneCoverageNarrative = "One incentive zone covers this location. County-wide programs supplement zone-based options.";
  else zoneCoverageNarrative = "No incentive zones overlap at this location. County-wide programs may still apply.";

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
  const eligible = filterByZones(programs, zones);
  const industryRelevant = state.industry
    ? eligible.filter((p) => isProgramRelevantToIndustry(p, state.industry))
    : eligible;

  // Split into zone-based and county-wide
  const zoneBased = industryRelevant.filter((p) => p.zoneKey && zones?.[p.zoneKey]);
  const countyWide = industryRelevant.filter((p) => !p.zoneKey);

  const zoneCount = countActiveZones(zones);

  // ── Merge all eligible programs, sorted by zone-match first ──
  const allEligible = [...zoneBased, ...countyWide];
  // Sort: zone-based first (lower index = higher confidence proxy), then county-wide
  const mergedPrograms = [...allEligible].sort((a, b) => {
    const aZone = a.zoneKey && zones?.[a.zoneKey] ? 0 : 1;
    const bZone = b.zoneKey && zones?.[b.zoneKey] ? 0 : 1;
    return aZone - bZone;
  });

  // ── Builder outputs ──
  const verdict = computeVerdict(zones, programs, ctx);
  const marketContext = buildMarketContext(ctx, zones);
  const eligibleIds = allEligible.map((p) => p.id);
  const stackingAnalysis = buildStackingAnalysis(zones, zoneNames, eligibleIds, ctx.stackingRules);
  const communityAssetsData = buildCommunityAssets(ctx.communityAssets);

  // ── Sections: Overview → Market → Stacking → Programs → Documents → Support → Next Steps ──
  const sections: ReportSection[] = [];

  // §01 Market Analysis
  if (marketContext) {
    const cmp = marketContext.comparisons;
    const marketItems: ReportItem[] = [];
    if (marketContext.incomeNarrative) {
      const vs = cmp.income ? ` (${cmp.income.pct}% of city median $${cmp.income.city.toLocaleString()})` : "";
      marketItems.push({ label: "Median Household Income", value: ctx.census?.medianIncome != null ? `$${ctx.census.medianIncome.toLocaleString()}` : "N/A", detail: `${marketContext.incomeNarrative}${vs}` });
    }
    if (marketContext.homeValueNarrative) {
      const vs = cmp.homeValue ? ` (${cmp.homeValue.pct}% of city median $${cmp.homeValue.city.toLocaleString()})` : "";
      marketItems.push({ label: "Median Home Value", value: ctx.census?.medianHomeValue != null ? `$${ctx.census.medianHomeValue.toLocaleString()}` : "N/A", detail: `${marketContext.homeValueNarrative}${vs}` });
    }
    if (marketContext.populationNarrative) {
      const vs = cmp.population ? ` (${cmp.population.pct}% of city avg ${cmp.population.city.toLocaleString()} per tract)` : "";
      marketItems.push({ label: "Population", value: ctx.census?.population != null ? ctx.census.population.toLocaleString() : "N/A", detail: `${marketContext.populationNarrative}${vs}` });
    }
    {
      const vs = cmp.walkScore ? ` (city avg: ${cmp.walkScore.city})` : "";
      marketItems.push({ label: "Walkability", value: ctx.census?.walkScore != null ? `${ctx.census.walkScore}/100` : "N/A", detail: `${marketContext.walkabilityNarrative}${vs}` });
    }
    marketItems.push({ label: "Zone Coverage", value: `${zoneCount} zone${zoneCount !== 1 ? "s" : ""}`, detail: marketContext.zoneCoverageNarrative });
    if (marketContext.qualificationNarrative && (marketContext.isQCT || marketContext.isLMI)) {
      marketItems.push({ label: "Neighborhood Qualification", value: marketContext.isQCT ? "Qualified Census Tract" : "Low-to-Moderate Income", detail: marketContext.qualificationNarrative });
    }
    sections.push({
      title: "Market Analysis",
      description: "How this location compares to Chicago city medians across key economic and demographic indicators.",
      items: marketItems,
    });
  }

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

  // §03 Eligible Incentive Programs — merged, sorted by confidence
  if (mergedPrograms.length > 0) {
    sections.push({
      title: "Eligible Incentive Programs",
      description: "Programs matched to your location and profile, ordered by eligibility confidence.",
      items: mergedPrograms.map((p) => ({
        label: p.name,
        value: p.benefitRange || "Contact for details",
        detail: p.summary,
        programId: p.id,
        whoQualifies: p.whoQualifies,
        eligibilityRules: p.eligibilityRules?.map((r: { description: string; required: boolean }) => ({
          description: r.description,
          required: r.required,
        })),
        url: p.url,
        level: p.level,
      })),
    });
  }

  // §04 Required Documents (categorized, with program attribution) — inserted before Support Network
  {
    // Build a map: document → { category, programs[] }
    const docMap: Record<string, { category: string; programs: Set<string> }> = {};
    for (const p of allEligible) {
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
        description: `${Object.keys(docMap).length} documents across your eligible programs, organized by category. Each document lists which program(s) require it.`,
        items: docItems,
      });
    }
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

      for (const p of allEligible) {
        const creditInfo = CREDIT_PERCENTAGES[p.id];
        if (!creditInfo || creditInfo.pct === 0) continue;
        const raw = budgetMedian * creditInfo.pct;
        const capped = p.id === "sbif" ? Math.min(raw, 150_000) : raw;
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
  const topPrograms = zoneBased.slice(0, 2);

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
  const lowerPriority = [...zoneBased.slice(2), ...countyWide].slice(0, 3);
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

  if (topPrograms.length < 2 && countyWide.length > 0) {
    recommendedActions.splice(recommendedActions.length - 1, 0, {
      label: `Explore ${countyWide[0].name}`,
      description: countyWide[0].summary,
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
    summary: `${verdict?.headline || "Incentive analysis complete"}. Your address at ${addressDisplay} falls within ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""}, qualifying for ${mergedPrograms.length} programs.${stackingContext}${dollarSummary} The sections below are organized from key findings to detailed evidence.`,
    sections,
    recommendedActions: recommendedActions.slice(0, 4),
    metadata: {
      address: state.address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      industry: getIndustryName(state.industry),
      budgetRange: state.budgetRange || undefined,
    },
    benefitEstimates,
    actionRoadmap,
    verdict,
    marketContext,
    stackingAnalysis,
    communityAssets: communityAssetsData,
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
    "acquisition": "Acquisition & Hold",
    "rehab": "Rehabilitation / Renovation",
    "new-construction": "New Construction",
    "mixed-use-conversion": "Mixed-Use Conversion",
  };
  const projectLabel = projectLabels[projectType] || projectType;
  const address = state.address || "Selected Site";

  const activeZones = zones
    ? Object.entries(zones).filter(([, v]) => v).map(([k]) => k)
    : [];
  const zoneCount = activeZones.length;

  // Filter programs to those available at this site
  const sitePrograms = zones
    ? programs.filter((p) => !p.zoneKey || zones[p.zoneKey])
    : programs;

  // ── Builder outputs ──
  const verdict = computeVerdict(zones, programs, ctx);
  const marketContext = buildMarketContext(ctx, zones);
  const eligibleIds = sitePrograms.map((p) => p.id);
  const stackingAnalysis = buildStackingAnalysis(zones, zoneNames, eligibleIds, ctx.stackingRules);

  const sections: ReportSection[] = [];

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

  // §03 Market Analysis
  if (marketContext) {
    const cmp = marketContext.comparisons;
    const marketItems: ReportItem[] = [];
    if (marketContext.incomeNarrative) {
      const vs = cmp.income ? ` (${cmp.income.pct}% of city median $${cmp.income.city.toLocaleString()})` : "";
      marketItems.push({ label: "Median Household Income", value: ctx.census?.medianIncome != null ? `$${ctx.census.medianIncome.toLocaleString()}` : "N/A", detail: `${marketContext.incomeNarrative}${vs}` });
    }
    if (marketContext.homeValueNarrative) {
      const vs = cmp.homeValue ? ` (${cmp.homeValue.pct}% of city median $${cmp.homeValue.city.toLocaleString()})` : "";
      marketItems.push({ label: "Median Home Value", value: ctx.census?.medianHomeValue != null ? `$${ctx.census.medianHomeValue.toLocaleString()}` : "N/A", detail: `${marketContext.homeValueNarrative}${vs}` });
    }
    if (marketContext.populationNarrative) {
      const vs = cmp.population ? ` (${cmp.population.pct}% of city avg ${cmp.population.city.toLocaleString()} per tract)` : "";
      marketItems.push({ label: "Population", value: ctx.census?.population != null ? ctx.census.population.toLocaleString() : "N/A", detail: `${marketContext.populationNarrative}${vs}` });
    }
    {
      const vs = cmp.walkScore ? ` (city avg: ${cmp.walkScore.city})` : "";
      marketItems.push({ label: "Walkability", value: ctx.census?.walkScore != null ? `${ctx.census.walkScore}/100` : "N/A", detail: `${marketContext.walkabilityNarrative}${vs}` });
    }
    if (marketContext.qualificationNarrative && (marketContext.isQCT || marketContext.isLMI)) {
      marketItems.push({ label: "Neighborhood Qualification", value: marketContext.isQCT ? "Qualified Census Tract" : "Low-to-Moderate Income", detail: marketContext.qualificationNarrative });
    }
    sections.push({
      title: "Market Analysis",
      description: "How this location compares to Chicago city medians across key economic and demographic indicators.",
      items: marketItems,
    });
  }

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

  // §05 Feasibility Assessment
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
        detail: "This site is in a TIF district and/or SBIF-eligible area — rehabilitation costs may be partially reimbursed (SBIF: up to 50%, max $150K).",
      });
    }
  }

  if (projectType === "new-construction" || projectType === "acquisition") {
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
      detail: "Qualified Opportunity Fund investment at this site can defer and reduce capital gains taxes. 10-year hold eliminates gains on appreciation.",
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
    feasibilityItems.push({ label: "Risk Signal", value: "Limited incentive coverage", detail: "Fewer zone-based programs available. County-wide programs and manual eligibility checks recommended." });
  }

  if (feasibilityItems.length === 0) {
    feasibilityItems.push({
      label: "Baseline feasibility",
      value: `${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} active`,
      detail: `This site has ${zoneCount > 0 ? "incentive coverage that can offset project costs" : "limited zone coverage — county-wide programs may still apply"}.`,
    });
  }

  sections.push({
    title: `${projectLabel} Feasibility`,
    description: "Assessment of project-specific incentive eligibility, risk signals, and financing opportunities.",
    items: feasibilityItems,
  });

  // §06 Available Programs
  if (sitePrograms.length > 0) {
    sections.push({
      title: `Available Programs (${sitePrograms.length})`,
      description: "Programs matched to this site, ordered by relevance to your project type.",
      items: sitePrograms.slice(0, 8).map((p) => ({
        label: p.name,
        value: p.benefitRange || "Contact for details",
        detail: p.summary,
        programId: p.id,
        level: p.level,
        
      })),
    });
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
        value: "See Market Analysis",
        detail: "Review the median income, home values, and population data in the Market Analysis section to gauge local market demand.",
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
  const topSitePrograms = sitePrograms.filter((p) => p.zoneKey && zones?.[p.zoneKey]).slice(0, 2);
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
  summaryParts.push(`${sitePrograms.length} program${sitePrograms.length !== 1 ? "s" : ""} available`);
  if (parcel?.totalValue) {
    summaryParts.push(`assessed at ${parcel.totalValue}`);
  }

  return {
    title: `Development Feasibility Assessment — ${address}`,
    subtitle: `${projectLabel} feasibility analysis`,
    reportType: "best-location",
    generatedAt: new Date().toISOString(),
    summary: `${verdict?.headline || "Site assessment complete"}. ${summaryParts.join(". ")}. ${projectType === "rehab" && parcel?.bldgAge != null && parcel.bldgAge >= 50 ? "The building's age may unlock historic tax credits. " : ""}The sections below are organized from key findings to detailed evidence.`,
    sections,
    recommendedActions,
    metadata: {
      address: state.address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      projectType,
    },
    verdict,
    marketContext,
    stackingAnalysis,
    actionRoadmap: actionRoadmap.length > 0 ? actionRoadmap : undefined,
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

  // Group by level in order: Federal, State, County, City
  const grouped = groupByLevel(filtered);
  const levelOrder: Array<Program["level"]> = ["Federal", "State", "County", "City"];

  const sections: ReportSection[] = [];
  for (const level of levelOrder) {
    const levelPrograms = grouped[level];
    if (!levelPrograms || levelPrograms.length === 0) continue;
    sections.push({
      title: `${level}-Level Programs`,
      items: levelPrograms.map((p) => ({
        label: p.name,
        value: p.benefitRange || "Contact for details",
        detail: p.summary,
        programId: p.id,
        
        whoQualifies: p.whoQualifies,
        eligibilityRules: p.eligibilityRules?.map((r: { description: string; required: boolean }) => ({
          description: r.description,
          required: r.required,
        })),
        url: p.url,
        level: p.level,
      })),
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
  const budgetMedian = BUDGET_MEDIANS[budgetRange] || 0;
  const projectType = state.projectType || "Commercial development";

  // Resolve credit IDs to programs
  const creditPrograms = creditsToAnalyze
    .map((id) => programs.find((p) => p.id === id))
    .filter((p): p is Program => !!p);

  const sections: ReportSection[] = [];

  // Section 1: Credit Stacking Analysis
  let totalEstimate = 0;
  const stackingItems: ReportItem[] = creditPrograms.map((p) => {
    const creditInfo = CREDIT_PERCENTAGES[p.id];
    const pct = creditInfo?.pct || 0;
    const estimated = budgetMedian * pct;
    // Cap SBIF at $150K
    const capped = p.id === "sbif" ? Math.min(estimated, 150_000) : estimated;
    totalEstimate += capped;

    const valueDisplay = budgetMedian > 0
      ? estimateCreditValue(p.id, budgetRange)
      : (p.benefitRange || "Contact for details");

    return {
      label: p.name,
      value: valueDisplay,
      detail: creditInfo?.label || p.summary,
      programId: p.id,
      
    };
  });

  if (budgetMedian > 0 && creditPrograms.length > 0) {
    stackingItems.push({
      label: "Combined Stacking Estimate",
      value: formatDollars(totalEstimate),
      detail: `Total estimated value across ${creditPrograms.length} programs based on a ${formatDollars(budgetMedian)} project budget. Actual values depend on eligibility verification and program caps.`,
    });
  }

  sections.push({
    title: "Credit Stacking Analysis",
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
      label: p.name,
      value: p.whoQualifies,
      programId: p.id,

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

  // Section 3: Application Roadmap
  // Build a chronological roadmap from all selected programs' howToApply steps
  const roadmapPhases: {
    phase: string;
    steps: { program: string; step: string; programId: string }[];
  }[] = [
    { phase: "Phase 1: Pre-Application (Weeks 1-2)", steps: [] },
    { phase: "Phase 2: Application Submission (Weeks 3-6)", steps: [] },
    { phase: "Phase 3: Review & Approval (Weeks 7-12)", steps: [] },
    { phase: "Phase 4: Compliance & Reporting (Ongoing)", steps: [] },
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
    // First priority: the program with the highest estimated value
    const topCredit = creditPrograms.reduce((best, p) => {
      const bestPct = CREDIT_PERCENTAGES[best.id]?.pct || 0;
      const currentPct = CREDIT_PERCENTAGES[p.id]?.pct || 0;
      return currentPct > bestPct ? p : best;
    });
    recommendedActions.push({
      label: `Prioritize ${topCredit.name} application`,
      description:
        topCredit.fastestConfirmingStep ||
        `This program offers the highest estimated return. ${topCredit.contact}`,
      priority: "high",
    });
  }

  recommendedActions.push({
    label: "Consult a tax advisor on credit stacking",
    description:
      "A qualified tax professional can verify that selected credits can legally be stacked on the same project and identify any exclusions.",
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
      ? `Credit stacking analysis for ${budgetRange} project`
      : "Credit stacking analysis",
    reportType: "developer-analysis",
    generatedAt: new Date().toISOString(),
    summary: `Analyzing ${creditPrograms.length} incentive program${creditPrograms.length !== 1 ? "s" : ""} for a ${projectType.toLowerCase()} project${budgetRange ? ` with an estimated budget of ${budgetRange}` : ""}. ${totalEstimate > 0 ? `Combined stacking estimate: ${formatDollars(totalEstimate)} in potential incentives. ` : ""}These estimates are preliminary and subject to program-specific caps, eligibility verification, and legal stacking rules.`,
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
  const reportType = state.reportType || "location-incentives";

  let report: GeneratedReport;

  switch (reportType) {
    case "location-incentives":
      report = generateLocationIncentives(state, programs, ctx);
      break;

    case "best-location":
      report = generateBestLocation(state, programs, ctx);
      break;

    case "program-explorer":
      report = generateProgramExplorer(state, programs);
      break;

    case "developer-analysis":
      report = generateDeveloperAnalysis(state, programs);
      break;

    default: {
      const _exhaustive: never = reportType;
      throw new Error(`Unknown report type: ${_exhaustive}`);
    }
  }

  // Attach census + zoning data to metadata for address-based reports
  if (reportType === "location-incentives" || reportType === "developer-analysis" || reportType === "best-location") {
    if (census?.medianIncome != null) report.metadata.medianIncome = census.medianIncome;
    if (census?.medianHomeValue != null) report.metadata.medianHomeValue = census.medianHomeValue;
    if (cityZoning?.zoneClass) report.metadata.zoneClass = cityZoning.zoneClass;
    if (cityZoning?.zoneType) report.metadata.zoneType = cityZoning.zoneType;

    // Insert a "Site Profile" section — property, zoning, and district data only
    // (census/market data lives in Market Analysis to avoid duplication)
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
      if (reportType === "location-incentives") {
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
    if (reportType === "developer-analysis" && parcel && parcel.pin) {
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
  if (zones && zoneNames && (reportType === "location-incentives" || reportType === "developer-analysis" || reportType === "best-location")) {
    report.executiveSummary = generateExecutiveSummary(programs, zones, zoneNames);
  }

  return report;
}
