import type {
  Program,
  SurveyAnswers,
  EligibilityConfidence,
  ProgramCheckResult,
  TopAction,
  ProgramContact,
  ExecutiveSummary,
  ParcelData,
} from "./types";

/**
 * Confidence Engine — given zone results + programs + optional survey answers,
 * compute ProgramCheckResult[] for each program.
 *
 * Rules:
 * - appears_eligible (green): location match + at least one non-location criterion confirmed via survey
 * - location_eligible (green + qualifier): zone match only, no survey
 * - may_qualify (amber): some criteria match, gaps remain
 * - worth_exploring (gray): possible but low evidence
 * - not_applicable (collapsed): location doesn't match and location is required
 */

/* ── Staleness policy ──────────────────────── */

export function isStaleProgramData(program: Program): boolean {
  if (!program.lastVerifiedAt) return true;
  const verifiedDate = new Date(program.lastVerifiedAt);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return verifiedDate < sixMonthsAgo;
}

const DOWNGRADE_MAP: Partial<Record<EligibilityConfidence, EligibilityConfidence>> = {
  appears_eligible: "may_qualify",
  location_eligible: "may_qualify",
  may_qualify: "worth_exploring",
};

function downgradeConfidence(confidence: EligibilityConfidence): EligibilityConfidence {
  return DOWNGRADE_MAP[confidence] ?? confidence;
}

const CONFIDENCE_LABELS: Record<EligibilityConfidence, string> = {
  appears_eligible: "Appears eligible",
  location_eligible: "Appears eligible (based on location)",
  may_qualify: "May qualify",
  worth_exploring: "Worth exploring",
  not_applicable: "Not applicable at this location",
};

/** Check if a program's zone requirement is met. */
function checkLocationMatch(
  program: Program,
  zones: Record<string, boolean>
): boolean {
  if (!program.zoneKey) return true; // No zone requirement (County-level programs)
  return !!zones[program.zoneKey];
}

/** Check if any non-location rule is confirmed by survey answers. */
function checkSurveyConfirmation(
  program: Program,
  survey: SurveyAnswers
): { confirmed: boolean; matchedRules: string[]; unverified: string[] } {
  const rules = program.eligibilityRules || [];
  const nonLocationRules = rules.filter((r) => r.verifiedBy !== "location");
  const matchedRules: string[] = [];
  const unverified: string[] = [];

  for (const rule of nonLocationRules) {
    let matched = false;

    if (rule.criterion === "industry" && survey.industry) {
      // Industry-specific programs
      if (program.id === "rev" && (survey.industry === "ev" || survey.industry === "manufacturing")) {
        matched = true;
      } else if (program.id === "micro" && survey.industry === "semiconductor") {
        matched = true;
      } else if (program.id === "dataCenter" && survey.industry === "dataCenter") {
        matched = true;
      } else if (!["rev", "micro", "dataCenter"].includes(program.id)) {
        // Non-industry-specific programs: any industry counts
        matched = true;
      }
    } else if (rule.criterion === "propertyType" && survey.property) {
      if (["own", "lease5plus"].includes(survey.property)) {
        matched = true;
      } else if (survey.property === "buyBuild" && program.id === "landBank") {
        matched = true;
      }
    } else if (rule.criterion === "investmentSize") {
      // Can't confirm investment size from survey alone
      if (survey.activities?.includes("renovations") || survey.activities?.includes("equipment") || survey.activities?.includes("expanding")) {
        matched = true;
      }
    }

    if (matched) {
      matchedRules.push(rule.description);
    } else if (rule.verifiedBy !== "none") {
      unverified.push(rule.description);
    }
  }

  return {
    confirmed: matchedRules.length > 0,
    matchedRules,
    unverified,
  };
}

/** Generate a one-line "why" explanation. */
function generateWhyOneLine(
  program: Program,
  confidence: EligibilityConfidence,
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>
): string {
  const zoneName = program.zoneKey ? zoneNames[program.zoneKey] : null;

  switch (confidence) {
    case "appears_eligible":
      return zoneName
        ? `Your location is in ${zoneName} — this program is designed for you.`
        : `Your profile matches this program's criteria.`;
    case "location_eligible":
      return zoneName
        ? `Your location is in ${zoneName}.`
        : `Your location is in a qualifying zone.`;
    case "may_qualify":
      if (program.zoneKey && zones[program.zoneKey]) {
        return `You're in a qualifying zone — some details still need verification.`;
      }
      return `Some criteria match — worth confirming with the program administrator.`;
    case "worth_exploring":
      if (!program.zoneKey) {
        return `Available to businesses in Cook County — check eligibility requirements.`;
      }
      return `This program may be available — check with the administrator.`;
    case "not_applicable":
      return `Your location is not in a qualifying zone for this program.`;
  }
}

/** Compute confidence for a single program. */
function computeConfidence(
  program: Program,
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>,
  survey?: SurveyAnswers,
  parcel?: ParcelData
): ProgramCheckResult {
  const locationMatch = checkLocationMatch(program, zones);
  const locationRequired = (program.eligibilityRules || []).some(
    (r) => r.criterion === "location" && r.required && r.verifiedBy === "location"
  );

  let confidence: EligibilityConfidence;
  let notVerified: string[] = [];
  let matchedRules: string[] = [];

  if (locationRequired && !locationMatch) {
    confidence = "not_applicable";
    notVerified = (program.eligibilityRules || [])
      .filter((r) => r.verifiedBy !== "location")
      .map((r) => r.description);
  } else if (survey && Object.keys(survey).length > 0) {
    const surveyResult = checkSurveyConfirmation(program, survey);
    notVerified = surveyResult.unverified;
    matchedRules = surveyResult.matchedRules;

    if (locationMatch && surveyResult.confirmed) {
      confidence = "appears_eligible";
    } else if (locationMatch) {
      confidence = "may_qualify";
    } else if (surveyResult.confirmed) {
      confidence = "may_qualify";
    } else {
      confidence = "worth_exploring";
    }
  } else {
    // No survey — location-only assessment
    if (locationMatch) {
      confidence = "location_eligible";
    } else if (!locationRequired && !program.zoneKey) {
      // County programs with no zone requirement — worth exploring
      confidence = "worth_exploring";
    } else {
      confidence = "not_applicable";
    }

    // All non-location rules are unverified without survey
    notVerified = (program.eligibilityRules || [])
      .filter((r) => r.verifiedBy !== "location")
      .map((r) => r.description);
  }

  // Staleness downgrade: if data not verified within 6 months, reduce confidence
  let staleNote = "";
  if (isStaleProgramData(program) && confidence !== "not_applicable") {
    confidence = downgradeConfidence(confidence);
    staleNote = " (data not recently verified)";
  }

  let whyOneLine = generateWhyOneLine(program, confidence, zones, zoneNames) + staleNote;

  // Parcel-based scoring boosts (additive)
  if (parcel) {
    if (program.id === "class7a" && parcel.isCommercial && confidence === "worth_exploring") {
      confidence = "may_qualify";
      whyOneLine = `Property class ${parcel.classCode} (${parcel.classDescription}) may be eligible for Class 7a assessment reduction.`;
    }
    if (program.id === "landBank" && parcel.isVacant && confidence === "worth_exploring") {
      confidence = "may_qualify";
      whyOneLine = "Parcel classified as vacant land — potential Land Bank acquisition candidate.";
    }
    if ((program.id === "tif" || program.id === "sbif") && parcel.totalValue) {
      whyOneLine += ` Assessed value: ${parcel.totalValue}.`;
    }
  }

  return {
    programId: program.id,
    program,
    confidence,
    confidenceLabel: CONFIDENCE_LABELS[confidence],
    whyOneLine,
    benefitRange: program.benefitRange || "Contact for details",
    fastestStep: program.fastestConfirmingStep || "Contact program administrator",
    notVerified,
    matchedRules,
  };
}

/** Confidence order for sorting (most confident first). */
const CONFIDENCE_ORDER: Record<EligibilityConfidence, number> = {
  appears_eligible: 0,
  location_eligible: 1,
  may_qualify: 2,
  worth_exploring: 3,
  not_applicable: 4,
};

/**
 * Run the confidence engine across all programs.
 * Returns sorted ProgramCheckResult[] (most confident first).
 */
export function runConfidenceEngine(
  programs: Program[],
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>,
  survey?: SurveyAnswers,
  parcel?: ParcelData
): ProgramCheckResult[] {
  return programs
    .map((p) => computeConfidence(p, zones, zoneNames, survey, parcel))
    .sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]);
}

/**
 * Compute top actions — labeled "Best next steps based on your location".
 * Returns up to 3 actions based on the most confident program results.
 */
export function computeTopActions(
  results: ProgramCheckResult[]
): TopAction[] {
  const actions: TopAction[] = [];

  // Get top eligible programs
  const eligible = results.filter(
    (r) => r.confidence !== "not_applicable" && r.confidence !== "worth_exploring"
  );

  for (const result of eligible.slice(0, 2)) {
    const contact = result.program.contacts?.[0];
    if (contact?.phone) {
      actions.push({
        label: `Call ${contact.agency || contact.abbreviation} about ${result.program.name}`,
        type: "call",
        programId: result.programId,
        contact,
      });
    } else if (contact?.url) {
      actions.push({
        label: `Check ${result.program.name} eligibility`,
        type: "check",
        programId: result.programId,
        contact,
      });
    }
  }

  // Always include a low-regret action
  const sbs = results.find((r) => r.programId === "smallBizSource");
  if (sbs && actions.length < 3) {
    const contact = sbs.program.contacts?.[0];
    actions.push({
      label: "Book free business advising",
      type: "book",
      programId: "smallBizSource",
      contact,
    });
  }

  return actions.slice(0, 3);
}

// ─── Stacking Narrative ─────────────────────────────────────────────

export interface StackingNarrative {
  zoneCount: number;
  totalZones: number;
  percentileLabel: string;
  narrative: string;
  combinations: {
    zones: string[];
    benefit: string;
    relationship: "can" | "conditional";
  }[];
}

/**
 * Chicago stacking distribution (from Stats.stackingDistribution).
 * Hardcoded percentile thresholds based on 360+ businesses analyzed.
 */
const STACKING_PERCENTILES: Record<number, number> = {
  0: 95, 1: 78, 2: 55, 3: 35, 4: 18, 5: 8, 6: 4, 7: 2, 8: 1, 9: 1, 10: 1, 11: 1,
};

/** Well-known beneficial zone combinations. */
const ZONE_COMBOS: { zones: string[]; benefit: string }[] = [
  { zones: ["federalOZ", "enterprise"], benefit: "Stack capital gains deferral with sales/utility tax exemptions — combined savings of ~20-25%" },
  { zones: ["tif", "sbif"], benefit: "TIF funds public improvements while SBIF reimburses up to 50% of your renovation costs" },
  { zones: ["federalOZ", "nmtcEligible"], benefit: "Layer Opportunity Zone capital gains benefits with 39% NMTC credits over 7 years" },
  { zones: ["tif", "enterprise"], benefit: "TIF rehabilitation funding plus Enterprise Zone tax exemptions reduce both property and operating costs" },
  { zones: ["nrhpDistricts", "tif"], benefit: "20% Federal Historic Tax Credit plus TIF funding for certified rehabilitation projects" },
  { zones: ["enterprise", "highUnemployment"], benefit: "Enterprise Zone exemptions plus WOTC credits for hiring in high-unemployment areas" },
  { zones: ["federalOZ", "illinoisOZ"], benefit: "Federal and state Opportunity Zone benefits stack — defer and reduce capital gains at both levels" },
  { zones: ["tif", "highUnemployment"], benefit: "TIF funding for improvements plus workforce development credits for local hiring" },
];

/**
 * Compute a stacking narrative for a given set of active zones.
 * Explains what the zone overlap means in plain language.
 */
export function computeStackingNarrative(
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>,
): StackingNarrative {
  const ZONE_LABELS_LOCAL: Record<string, string> = {
    federalOZ: "Federal Opportunity Zone",
    illinoisOZ: "Illinois Opportunity Zone",
    tif: "TIF District",
    sbif: "SBIF",
    enterprise: "Enterprise Zone",
    edge: "EDGE",
    rev: "REV Illinois",
    micro: "MICRO",
    dataCenter: "Data Center Zone",
    cpace: "C-PACE Eligible",
    class7a: "Class 7a/b",
    landBank: "Land Bank",
    highUnemployment: "High Unemployment Zone",
    catalystGrant: "Catalyst Grant",
    nmtcEligible: "NMTC Eligible",
    nrhpDistricts: "National Register Historic District",
    landmarkDistricts: "Chicago Landmark District",
    smallBizSource: "Small Business Source",
    workforceInvest: "Workforce Investment",
    ssa: "Special Service Area",
  };

  const activeZones = Object.entries(zones).filter(([, v]) => v).map(([k]) => k);
  const zoneCount = activeZones.length;
  const totalZones = 11; // standard zone count

  const percentile = STACKING_PERCENTILES[Math.min(zoneCount, 11)] || 1;
  const percentileLabel = percentile <= 10
    ? `top ${percentile}%`
    : percentile <= 25
      ? `top quarter`
      : percentile <= 50
        ? `above average`
        : `below average`;

  // Find matching combinations
  const combinations: StackingNarrative["combinations"] = [];
  for (const combo of ZONE_COMBOS) {
    if (combo.zones.every((z) => activeZones.includes(z))) {
      combinations.push({
        zones: combo.zones.map((z) => zoneNames[z] || ZONE_LABELS_LOCAL[z] || z),
        benefit: combo.benefit,
        relationship: "can",
      });
    }
  }

  // Build narrative
  let narrative: string;
  if (zoneCount === 0) {
    narrative = "This location is not within any mapped incentive zones. County-wide programs may still apply.";
  } else if (zoneCount <= 2) {
    const names = activeZones.map((z) => zoneNames[z] || ZONE_LABELS_LOCAL[z] || z).join(" and ");
    narrative = `Your location is in ${names}. While the zone overlap is limited, you still qualify for targeted programs designed for this area.`;
  } else if (zoneCount <= 4) {
    narrative = `With ${zoneCount} overlapping zones, your location is in the ${percentileLabel} of Chicago locations for incentive density. This overlap means multiple programs can be combined to reduce your total project cost.`;
  } else {
    narrative = `Your ${zoneCount}-zone overlap puts you in the ${percentileLabel} of all Chicago locations. This exceptional density means you can stack incentives across federal, state, and local programs — a rare combination that can dramatically reduce costs.`;
  }

  if (combinations.length > 0) {
    narrative += ` We identified ${combinations.length} beneficial zone combination${combinations.length !== 1 ? "s" : ""} at your location.`;
  }

  return {
    zoneCount,
    totalZones,
    percentileLabel,
    narrative,
    combinations,
  };
}

/** Build a plain-language paragraph explaining why the top programs matter. */
function buildWhyParagraph(
  topResults: ProgramCheckResult[],
  zoneCount: number,
): string {
  if (topResults.length === 0) {
    return "No specific incentive programs were matched to this location. Consider exploring county-wide programs or contacting a business advisor for guidance.";
  }

  const names = topResults.map((r) => r.program.name);
  const listText =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  const benefits = topResults
    .filter((r) => r.benefitRange && r.benefitRange !== "Contact for details")
    .map((r) => r.benefitRange);

  const benefitClause =
    benefits.length > 0
      ? ` — with potential benefits including ${benefits.slice(0, 2).join(" and ")}`
      : "";

  return `Your location falls within ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""}, making you a candidate for programs like ${listText}${benefitClause}. These programs are designed to reduce costs, offset taxes, and support investment in your area. We recommend reviewing the details below and contacting program administrators to confirm eligibility.`;
}

/**
 * Generate an executive summary from zone check results.
 * Reuses runConfidenceEngine() + computeTopActions() internally.
 */
export function generateExecutiveSummary(
  programs: Program[],
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>,
  survey?: SurveyAnswers,
  precomputedResults?: ProgramCheckResult[],
): ExecutiveSummary {
  const results = precomputedResults || runConfidenceEngine(programs, zones, zoneNames, survey);
  const topActions = computeTopActions(results);

  const zoneCount = Object.values(zones).filter(Boolean).length;

  // Top 3 programs (excluding not_applicable)
  const eligible = results.filter((r) => r.confidence !== "not_applicable");
  const topResults = eligible.slice(0, 3);

  const topPrograms = topResults.map((r) => ({
    programId: r.programId,
    name: r.program.name,
    confidence: r.confidence,
    confidenceLabel: r.confidenceLabel,
    benefitRange: r.benefitRange,
    whyOneLine: r.whyOneLine,
    notVerified: r.notVerified,
  }));

  const whyTheseMatter = buildWhyParagraph(topResults, zoneCount);

  return {
    topPrograms,
    topActions: topActions.slice(0, 3),
    zoneCount,
    whyTheseMatter,
  };
}
