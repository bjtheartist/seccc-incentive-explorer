import type { Program, ExecutiveSummary } from "./types";
import { ZONE_LABELS, ZONE_COLORS } from "./constants";
import { INDUSTRIES, getIndustryById } from "./industries-data";
import { generateExecutiveSummary } from "./confidence-engine";

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
  items: ReportItem[];
}

export interface ReportItem {
  label: string;
  value: string;
  detail?: string;
  programId?: string;
  color?: string;
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
}

// ─── Budget Median Mapping ──────────────────────────────────────────

const BUDGET_MEDIANS: Record<string, number> = {
  "Under $100K": 50_000,
  "$100K-$500K": 300_000,
  "$500K-$2M": 1_000_000,
  "$2M-$10M": 5_000_000,
  "Over $10M": 15_000_000,
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

function formatDollars(amount: number): string {
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
 * Get the display color for a program (from zone colors or a default).
 */
function getProgramColor(program: Program): string {
  return ZONE_COLORS[program.zoneKey] || "#2563EB";
}

/**
 * Count how many active zones the user is in.
 */
function countActiveZones(zones?: Record<string, boolean>): number {
  if (!zones) return 0;
  return Object.values(zones).filter(Boolean).length;
}

/**
 * Get names of active zones.
 */
function getActiveZoneNames(
  zones?: Record<string, boolean>,
  zoneNames?: Record<string, string>,
): string[] {
  if (!zones) return [];
  return Object.entries(zones)
    .filter(([, active]) => active)
    .map(([key]) => zoneNames?.[key] || ZONE_LABELS[key] || key);
}

// ─── Report Generators ──────────────────────────────────────────────

function generateLocationIncentives(
  state: WizardState,
  programs: Program[],
  zones?: Record<string, boolean>,
  zoneNames?: Record<string, string>,
): GeneratedReport {
  const eligible = filterByZones(programs, zones);
  const industryRelevant = state.industry
    ? eligible.filter((p) => isProgramRelevantToIndustry(p, state.industry))
    : eligible;

  // Split into zone-based and county-wide
  const zoneBased = industryRelevant.filter((p) => p.zoneKey && zones?.[p.zoneKey]);
  const countyWide = industryRelevant.filter((p) => !p.zoneKey);

  const zoneCount = countActiveZones(zones);
  const activeNames = getActiveZoneNames(zones, zoneNames);

  // Build benefit estimate summary
  const benefitDescriptions = zoneBased
    .filter((p) => p.benefitRange)
    .map((p) => p.benefitRange!)
    .slice(0, 3);

  const benefitSummary =
    benefitDescriptions.length > 0
      ? `potential benefits including ${benefitDescriptions.join(", ")}`
      : "various potential benefits";

  const sections: ReportSection[] = [];

  // Section 1: Eligible Zone-Based Programs
  if (zoneBased.length > 0) {
    sections.push({
      title: "Eligible Zone-Based Programs",
      items: zoneBased.map((p) => ({
        label: p.name,
        value: p.benefitRange || "Contact for details",
        detail: p.fastestConfirmingStep || p.summary,
        programId: p.id,
        color: getProgramColor(p),
      })),
    });
  }

  // Section 2: County-Wide Programs
  if (countyWide.length > 0) {
    sections.push({
      title: "County-Wide Programs",
      items: countyWide.map((p) => ({
        label: p.name,
        value: p.benefitRange || "Contact for details",
        detail: p.summary,
        programId: p.id,
        color: getProgramColor(p),
      })),
    });
  }

  // Section 3: Next Steps
  sections.push({
    title: "Next Steps",
    items: [
      {
        label: "Verify zone eligibility",
        value: "Confirm your address falls within each zone boundary",
        detail:
          "Zone boundaries can shift. Verify with the administering agency before applying.",
      },
      {
        label: "Gather required documents",
        value: "Prepare proof of ownership, project plans, and budgets",
        detail:
          "Most programs require property documentation, project descriptions, and cost estimates.",
      },
      {
        label: "Contact program administrators",
        value: "Reach out to confirm current availability and deadlines",
        detail:
          "Program funding can be limited. Early contact increases your chances.",
      },
    ],
  });

  // Recommended actions: top 3 programs + always book advising
  const topPrograms = zoneBased.slice(0, 2);
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

  // If there is room, add a third program
  if (topPrograms.length < 2 && countyWide.length > 0) {
    recommendedActions.splice(recommendedActions.length - 1, 0, {
      label: `Explore ${countyWide[0].name}`,
      description: countyWide[0].summary,
      priority: "medium",
    });
  }

  const addressDisplay = state.address || "your location";
  const zoneList =
    activeNames.length > 0
      ? activeNames.slice(0, 4).join(", ") +
        (activeNames.length > 4 ? `, and ${activeNames.length - 4} more` : "")
      : "no specific incentive zones";

  return {
    title: `Incentive Report for ${addressDisplay}`,
    subtitle: `Location-based analysis for ${getIndustryName(state.industry)}`,
    reportType: "location-incentives",
    generatedAt: new Date().toISOString(),
    summary: `Your location at ${addressDisplay} falls within ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} (${zoneList}). You may qualify for ${zoneBased.length + countyWide.length} programs with ${benefitSummary}. Review each program below to understand requirements and next steps.`,
    sections,
    recommendedActions: recommendedActions.slice(0, 4),
    metadata: {
      address: state.address,
      lat: state.lat ?? undefined,
      lon: state.lon ?? undefined,
      industry: getIndustryName(state.industry),
    },
  };
}

function generateBestLocation(
  state: WizardState,
  programs: Program[],
): GeneratedReport {
  const industryId = state.industry;
  const industryName = getIndustryName(industryId);
  const industry = getIndustryById(industryId);

  // Determine which programs are most relevant for this industry
  const relevantPrograms = industry
    ? programs.filter((p) => industry.topPrograms.includes(p.id) || industry.topPrograms.includes(p.zoneKey))
    : programs;

  // Identify zones that unlock the most relevant programs
  const zoneScores: Record<string, { programs: Program[]; score: number }> = {};
  for (const p of relevantPrograms) {
    const key = p.zoneKey || "countywide";
    if (!zoneScores[key]) zoneScores[key] = { programs: [], score: 0 };
    zoneScores[key].programs.push(p);
    zoneScores[key].score += 1;
    // Bonus score for programs with explicit benefit ranges
    if (p.benefitRange) zoneScores[key].score += 0.5;
  }

  const rankedZones = Object.entries(zoneScores)
    .filter(([key]) => key !== "countywide")
    .sort(([, a], [, b]) => b.score - a.score);

  const sections: ReportSection[] = [];

  // Section 1: Top Incentive Zones for this industry
  sections.push({
    title: `Top Incentive Zones for ${industryName}`,
    items: rankedZones.slice(0, 6).map(([zoneKey, data]) => ({
      label: ZONE_LABELS[zoneKey] || zoneKey,
      value: `Unlocks ${data.programs.length} program${data.programs.length !== 1 ? "s" : ""}`,
      detail: data.programs.map((p) => `${p.name}${p.benefitRange ? ` (${p.benefitRange})` : ""}`).join("; "),
      color: ZONE_COLORS[zoneKey] || "#2563EB",
    })),
  });

  // Section 2: Priority Factors Analysis
  const priorities = state.locationPriorities || [];
  const priorityMapping: Record<string, { zone: string; detail: string }> = {
    "tax-savings": {
      zone: "Enterprise Zone + Opportunity Zone overlap",
      detail:
        "Areas with both Enterprise Zone and Opportunity Zone designation offer stacked property tax reductions, sales tax exemptions, and capital gains benefits.",
    },
    "workforce-access": {
      zone: "High Unemployment Zones",
      detail:
        "Locations in high-unemployment census tracts qualify for WOTC credits and workforce training subsidies that offset hiring costs.",
    },
    "property-cost": {
      zone: "Chicago Land Bank areas",
      detail:
        "City-owned vacant lots and buildings available at below-market prices through the Chicago Land Bank Authority.",
    },
    "foot-traffic": {
      zone: "Special Service Areas (SSAs)",
      detail:
        "SSA districts invest in streetscaping, marketing, and safety improvements that drive foot traffic to local businesses.",
    },
    "renovation-support": {
      zone: "TIF Districts + SBIF eligible areas",
      detail:
        "TIF and SBIF provide direct grants and reimbursements for building rehabilitation and storefront improvements.",
    },
    "transit-access": {
      zone: "TOD-eligible corridors",
      detail:
        "Transit-oriented development zones near CTA stations often overlap with TIF districts and Opportunity Zones.",
    },
    "growth-potential": {
      zone: "Triple Benefit Zones",
      detail:
        "Areas qualifying for TIF, Enterprise Zone, and Opportunity Zone benefits simultaneously offer the highest stacking potential.",
    },
  };

  if (priorities.length > 0) {
    sections.push({
      title: "Priority Factors Analysis",
      items: priorities.map((p) => {
        const mapping = priorityMapping[p];
        return {
          label: p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          value: mapping?.zone || "Multiple zones applicable",
          detail: mapping?.detail || "Consider locations that overlap with relevant incentive zones.",
        };
      }),
    });
  }

  // Section 3: Recommended Neighborhoods
  // These are realistic South/Southeast Chicago neighborhoods that tend to overlap with incentive zones
  const neighborhoods = [
    {
      label: "South Chicago (83rd-93rd & Commercial)",
      value: "High stacking potential — TIF + Enterprise + Opportunity Zone",
      detail:
        "Multiple overlapping zones, active SSA, proximity to steel corridor redevelopment. Strong fit for manufacturing, retail, and services.",
    },
    {
      label: "Pullman (111th & Cottage Grove)",
      value: "Historic district + Enterprise Zone + TIF",
      detail:
        "National historic landmark district with federal and state historic tax credits, plus Enterprise Zone exemptions.",
    },
    {
      label: "Avalon Park / Calumet Heights",
      value: "SSA #50 + TIF + Opportunity Zone",
      detail:
        "Active Special Service Area with business improvement investments, combined with TIF and OZ benefits.",
    },
    {
      label: "East Side / Hegewisch",
      value: "Industrial corridor + Enterprise Zone",
      detail:
        "Industrial corridor protections combined with Enterprise Zone benefits. Ideal for manufacturing, logistics, and trades.",
    },
    {
      label: "Roseland (Michigan Ave corridor)",
      value: "Micro Market Recovery + TIF + High Unemployment",
      detail:
        "Storefront improvement grants plus TIF funding. High-unemployment designation unlocks workforce credits.",
    },
  ];

  sections.push({
    title: "Recommended Neighborhoods",
    items: neighborhoods,
  });

  // Recommended actions
  const recommendedActions: GeneratedReport["recommendedActions"] = [
    {
      label: "Tour top-ranked zones in person",
      description:
        "Visit the recommended neighborhoods to assess commercial space availability, foot traffic, and neighborhood character.",
      priority: "high",
    },
    {
      label: "Check zone boundaries for specific addresses",
      description:
        "Use the Chicago Site Incentive Map map to verify that a specific property falls within your target incentive zones.",
      priority: "high",
    },
    {
      label: "Compare lease costs across zones",
      description:
        "Request commercial real estate listings in each recommended area to compare baseline costs before applying incentive savings.",
      priority: "medium",
    },
    {
      label: "Book free business advising",
      description:
        "Schedule a session with SECCC or Small Business Source to discuss location strategy and program eligibility.",
      priority: "medium",
    },
  ];

  return {
    title: `Best Location Report for ${industryName}`,
    subtitle: `Zone analysis and neighborhood recommendations`,
    reportType: "best-location",
    generatedAt: new Date().toISOString(),
    summary: `For a ${industryName.toLowerCase()} business, we identified ${rankedZones.length} incentive zone type${rankedZones.length !== 1 ? "s" : ""} that offer relevant programs. The highest-value areas combine multiple overlapping zones for maximum benefit stacking. ${priorities.length > 0 ? `Your priorities (${priorities.slice(0, 3).map((p) => p.replace(/-/g, " ")).join(", ")}) align best with the neighborhoods listed below.` : "Review the recommended neighborhoods below for areas with the strongest incentive coverage."}`,
    sections,
    recommendedActions,
    metadata: {
      industry: industryName,
      projectType: state.projectType,
    },
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
        color: getProgramColor(p),
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
      color: getProgramColor(p),
    };
  });

  if (budgetMedian > 0 && creditPrograms.length > 0) {
    stackingItems.push({
      label: "Combined Stacking Estimate",
      value: formatDollars(totalEstimate),
      detail: `Total estimated value across ${creditPrograms.length} programs based on a ${formatDollars(budgetMedian)} project budget. Actual values depend on eligibility verification and program caps.`,
      color: "#16A34A",
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

  for (const p of creditPrograms) {
    for (const doc of p.requiredDocs) {
      allRequiredDocs.add(doc);
    }
    allQualifications.push({
      label: p.name,
      value: p.whoQualifies,
      programId: p.id,
      color: getProgramColor(p),
    });
  }

  // Deduplicated requirements list
  const requirementItems: ReportItem[] = [
    ...allQualifications,
  ];

  if (allRequiredDocs.size > 0) {
    requirementItems.push({
      label: "Combined Required Documents",
      value: `${allRequiredDocs.size} unique documents needed`,
      detail: Array.from(allRequiredDocs).join("; "),
    });
  }

  sections.push({
    title: "Project Requirements",
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
 * Generate structured report data from wizard answers and program data.
 *
 * @param state    - Wizard answers collected through the report wizard UI
 * @param programs - All available incentive programs
 * @param zones    - Zone membership flags for the user's address (optional)
 * @param zoneNames - Human-readable zone names keyed by zone ID (optional)
 * @param census   - Census data for the address location (optional)
 * @param cityZoning - City zoning classification (optional)
 * @returns A GeneratedReport object ready for UI rendering or PDF export
 */
export function generateReportData(
  state: WizardState,
  programs: Program[],
  zones?: Record<string, boolean>,
  zoneNames?: Record<string, string>,
  census?: ReportCensusData,
  cityZoning?: ReportZoningData,
): GeneratedReport {
  const reportType = state.reportType || "location-incentives";

  let report: GeneratedReport;

  switch (reportType) {
    case "location-incentives":
      report = generateLocationIncentives(state, programs, zones, zoneNames);
      break;

    case "best-location":
      report = generateBestLocation(state, programs);
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
  if (reportType === "location-incentives" || reportType === "developer-analysis") {
    if (census?.medianIncome != null) report.metadata.medianIncome = census.medianIncome;
    if (census?.medianHomeValue != null) report.metadata.medianHomeValue = census.medianHomeValue;
    if (cityZoning?.zoneClass) report.metadata.zoneClass = cityZoning.zoneClass;
    if (cityZoning?.zoneType) report.metadata.zoneType = cityZoning.zoneType;

    // Insert a "Location Context" section at the beginning if we have data
    const contextItems: ReportItem[] = [];
    if (cityZoning?.zoneClass) {
      contextItems.push({
        label: "City Zoning Classification",
        value: cityZoning.zoneClass,
        detail: cityZoning.zoneType
          ? `${cityZoning.zoneType} zoning — determines permitted land uses, density, and building requirements at this location`
          : "Determines permitted land uses, density, and building requirements at this location",
        color: "#059669",
      });
    }
    if (census?.medianIncome != null) {
      contextItems.push({
        label: "Median Household Income",
        value: `$${census.medianIncome.toLocaleString()}`,
        detail: "Census tract estimate (ACS 5-Year) — used to determine HUD low-income eligibility and program thresholds",
        color: "#2563EB",
      });
    }
    if (census?.medianHomeValue != null) {
      contextItems.push({
        label: "Median Home Value",
        value: `$${census.medianHomeValue.toLocaleString()}`,
        detail: "Census tract estimate (ACS 5-Year) — reflects area property values and investment activity",
        color: "#7C3AED",
      });
    }
    if (census?.walkScore != null) {
      contextItems.push({
        label: "Walkability Score",
        value: `${census.walkScore} / 100`,
        detail: "Based on proximity to amenities and pedestrian infrastructure — higher scores indicate better foot traffic potential",
        color: "#D97706",
      });
    }

    if (contextItems.length > 0) {
      report.sections.unshift({
        title: "Location Context",
        items: contextItems,
      });
    }
  }

  // Attach executive summary for address-based reports when zone data is available
  if (zones && zoneNames && (reportType === "location-incentives" || reportType === "developer-analysis")) {
    report.executiveSummary = generateExecutiveSummary(programs, zones, zoneNames);
  }

  return report;
}
