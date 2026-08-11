import type {
  Program,
  SurveyAnswers,
  ProgramRelevance,
  ProgramCheckResult,
  TopAction,
  ExecutiveSummary,
  ParcelData,
} from "./types";
import { buildPublicMatchExplanation } from "./match-transparency";
import { buildStartHere, startHereActionsInOrder, type StartHereAction } from "./start-here";

/**
 * Relevance Engine — given zone results + programs + optional survey answers,
 * compute ProgramCheckResult[] for each program.
 *
 * This is a DISCOVERY engine, not an eligibility engine. Every value and every
 * string it produces describes what the public data (and the visitor's own
 * answers) record; none of them assert that the visitor qualifies for anything.
 * Generated copy poses verification questions for the administering agency
 * rather than making a determination the product is not entitled to make.
 * See `ProgramRelevance` in ./types for the rule against reintroducing
 * eligibility vocabulary here.
 *
 * Rules:
 * - mapped_with_matching_answers: zone match + at least one non-location criterion aligned via survey
 * - mapped_at_location: zone match only, no survey
 * - review_suggested: some criteria compared, gaps remain
 * - context_dependent: nothing address-specific recorded
 * - not_mapped_at_location (collapsed): location doesn't match and the program requires it
 *
 * (The file is still named confidence-engine for import stability; the model it
 * computes is program relevance.)
 */

/* ── Staleness policy ──────────────────────── */

export function isStaleProgramData(program: Program): boolean {
  if (!program.lastVerifiedAt) return true;
  const verifiedDate = new Date(program.lastVerifiedAt);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return verifiedDate < sixMonthsAgo;
}

const DOWNGRADE_MAP: Partial<Record<ProgramRelevance, ProgramRelevance>> = {
  mapped_with_matching_answers: "review_suggested",
  mapped_at_location: "review_suggested",
  review_suggested: "context_dependent",
};

function downgradeRelevance(relevance: ProgramRelevance): ProgramRelevance {
  return DOWNGRADE_MAP[relevance] ?? relevance;
}

/**
 * Badge copy. Each label states what the record shows, not what the reader is
 * entitled to. Anything of the form "appears eligible" / "may qualify" /
 * "high match" is prohibited here — see lib/__tests__/public-report-safety.test.ts.
 */
const RELEVANCE_LABELS: Record<ProgramRelevance, string> = {
  mapped_with_matching_answers: "Mapped at this address, answers align",
  mapped_at_location: "Mapped at this address",
  review_suggested: "Review suggested",
  context_dependent: "Depends on project context",
  not_mapped_at_location: "Not mapped at this address",
};

/** Check if a program's zone requirement is met. */
function checkLocationMatch(
  program: Program,
  zones: Record<string, boolean>
): boolean {
  if (!program.zoneKey) return true; // No zone requirement; still not address-confirmed by itself.
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

/**
 * Generate a one-line "why this is on the list" explanation.
 *
 * Every branch states a recorded fact and, where a gap exists, poses the
 * question to put to the administering agency. No branch tells the reader what
 * they qualify for, and none uses "qualifying"/"eligible" about the reader.
 */
function generateWhyOneLine(
  program: Program,
  relevance: ProgramRelevance,
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>
): string {
  const zoneName = program.zoneKey ? zoneNames[program.zoneKey] : null;

  switch (relevance) {
    case "mapped_with_matching_answers":
      return zoneName
        ? `The mapped data records this address within ${zoneName}, and your answers align with criteria this program publishes.`
        : `Your answers align with criteria this program publishes.`;
    case "mapped_at_location":
      return zoneName
        ? `The mapped data records this address within ${zoneName}.`
        : `The mapped data records this address within a boundary this program uses.`;
    case "review_suggested":
      if (program.zoneKey && zones[program.zoneKey]) {
        return `The mapped data records this address within a boundary this program uses — ask the administering agency which of the remaining published requirements apply here.`;
      }
      return `Some published criteria were compared — ask the administering agency whether the remaining requirements are met.`;
    case "context_dependent":
      if (!program.zoneKey) {
        return `Published as open to businesses across Cook County — ask the administering agency which published requirements apply to this project.`;
      }
      return `No mapped boundary was recorded at this address — ask the administering agency whether the published boundaries still apply here.`;
    case "not_mapped_at_location":
      return `The mapped data does not record this address within a boundary this program requires.`;
  }
}

/** Compute program relevance for a single program. */
function computeRelevance(
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

  let relevance: ProgramRelevance;
  let notVerified: string[] = [];
  let matchedRules: string[] = [];

  if (locationRequired && !locationMatch) {
    relevance = "not_mapped_at_location";
    notVerified = (program.eligibilityRules || [])
      .filter((r) => r.verifiedBy !== "location")
      .map((r) => r.description);
  } else if (survey && Object.keys(survey).length > 0) {
    const surveyResult = checkSurveyConfirmation(program, survey);
    notVerified = surveyResult.unverified;
    matchedRules = surveyResult.matchedRules;

    if (locationMatch && surveyResult.confirmed) {
      relevance = "mapped_with_matching_answers";
    } else if (locationMatch) {
      relevance = "review_suggested";
    } else if (surveyResult.confirmed) {
      relevance = "review_suggested";
    } else {
      relevance = "context_dependent";
    }
  } else {
    // No survey — location-only assessment
    if (!locationRequired && !program.zoneKey) {
      // No-zone programs may be good next steps, but are not address-confirmed.
      relevance = "context_dependent";
    } else if (locationMatch) {
      relevance = "mapped_at_location";
    } else {
      relevance = "not_mapped_at_location";
    }

    // All non-location rules are unverified without survey
    notVerified = (program.eligibilityRules || [])
      .filter((r) => r.verifiedBy !== "location")
      .map((r) => r.description);
  }

  // Staleness downgrade: if data not verified within 6 months, reduce relevance
  let staleNote = "";
  if (isStaleProgramData(program) && relevance !== "not_mapped_at_location") {
    relevance = downgradeRelevance(relevance);
    staleNote = " (data not recently verified)";
  }

  let whyOneLine = generateWhyOneLine(program, relevance, zones, zoneNames) + staleNote;

  // Parcel-based ordering signals (additive). These report the recorded parcel
  // classification and name the question it raises — they do not assert that
  // the parcel qualifies for the program.
  if (parcel) {
    if (program.id === "class7a" && parcel.isCommercial && relevance === "context_dependent") {
      relevance = "review_suggested";
      whyOneLine = `The assessor records property class ${parcel.classCode} (${parcel.classDescription}) — confirm with the administering agency how Class 7a treats this classification.`;
    }
    if (program.id === "landBank" && parcel.isVacant && relevance === "context_dependent") {
      relevance = "review_suggested";
      whyOneLine = "The assessor records this parcel as vacant land — confirm with the Land Bank how it treats vacant parcels.";
    }
    if ((program.id === "tif" || program.id === "sbif") && parcel.totalValue) {
      whyOneLine += ` Assessed value: ${parcel.totalValue}.`;
    }
  }

  return {
    programId: program.id,
    program,
    relevance,
    relevanceLabel: RELEVANCE_LABELS[relevance],
    whyOneLine,
    benefitRange: program.benefitRange || "Contact for details",
    fastestStep: program.fastestConfirmingStep || "Contact program administrator",
    notVerified,
    matchedRules,
  };
}

/** Display order: most address-specific evidence first. Not a ranking of merit. */
const RELEVANCE_ORDER: Record<ProgramRelevance, number> = {
  mapped_with_matching_answers: 0,
  mapped_at_location: 1,
  review_suggested: 2,
  context_dependent: 3,
  not_mapped_at_location: 4,
};

/**
 * Run the relevance engine across all programs.
 * Returns sorted ProgramCheckResult[] (most address-specific evidence first).
 */
export function runConfidenceEngine(
  programs: Program[],
  zones: Record<string, boolean>,
  zoneNames: Record<string, string>,
  survey?: SurveyAnswers,
  parcel?: ParcelData
): ProgramCheckResult[] {
  return programs
    .map((p) => computeRelevance(p, zones, zoneNames, survey, parcel))
    .sort((a, b) => RELEVANCE_ORDER[a.relevance] - RELEVANCE_ORDER[b.relevance]);
}

/**
 * Map one StartHere action back to the legacy `TopAction` shape. Only
 * program-linked actions round-trip (a call, an agency-confirmation, or the
 * advising booking) — StartHere's zoning-confirmation and generic-fallback
 * actions carry no `programId` and have no legacy `TopAction` analogue, so
 * they are dropped here rather than invented a new `type` for.
 */
function toLegacyTopAction(action: StartHereAction): TopAction | null {
  if (!action.programId) return null;
  const type: TopAction["type"] =
    action.kind === "call-agency"
      ? "call"
      : action.kind === "confirm-with-agency"
        ? "check"
        : action.kind === "book-advising"
          ? "book"
          : "gather";
  return { label: action.label, type, programId: action.programId, contact: action.contact };
}

/**
 * Compute top actions — labeled "Best next steps based on your location".
 * Returns up to 3 actions based on the most confident program results.
 *
 * Derives from `buildStartHere` (lib/start-here.ts) rather than re-running
 * its own selection: this call site never has zoning context to pass, so it
 * always gets StartHere's un-forced ranking (top address-linked programs,
 * then the advising fallback) — the exact selection this function used to
 * run inline. See lib/start-here.ts and lib/__tests__/start-here.test.ts's
 * characterization tests for the behavior-preservation evidence.
 */
export function computeTopActions(
  results: ProgramCheckResult[]
): TopAction[] {
  const startHere = buildStartHere({ results, audience: "top-actions" });
  return startHereActionsInOrder(startHere)
    .map(toLegacyTopAction)
    .filter((action): action is TopAction => action !== null)
    .slice(0, 3);
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

/** Program interactions that may warrant a confirming conversation. */
const ZONE_COMBOS: { zones: string[]; benefit: string }[] = [
  { zones: ["federalOZ", "enterprise"], benefit: "These programs address different tax categories. Confirm current eligibility and whether both may apply with the relevant administrators." },
  { zones: ["tif", "sbif"], benefit: "SBIF operates within eligible TIF districts. Confirm district availability, eligible costs, and application timing." },
  { zones: ["federalOZ", "nmtcEligible"], benefit: "These programs use different investment structures. Ask qualified advisors whether either or both are relevant to the transaction." },
  { zones: ["tif", "enterprise"], benefit: "These programs may address different project costs or tax categories. Confirm current rules before relying on both." },
  { zones: ["nrhpDistricts", "tif"], benefit: "Historic rehabilitation and TIF processes have separate requirements. Confirm project, cost, and approval compatibility." },
  { zones: ["enterprise", "highUnemployment"], benefit: "Location and hiring programs have separate eligibility and timing rules. Confirm each independently." },
  { zones: ["federalOZ", "illinoisOZ"], benefit: "Federal and state rules may interact. Obtain current tax and program guidance for the specific investment." },
  { zones: ["tif", "highUnemployment"], benefit: "Property and workforce programs have separate requirements. Confirm each independently with the relevant administrator." },
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

  const percentileLabel = `${zoneCount} mapped zone${zoneCount === 1 ? "" : "s"}`;

  // Find matching combinations
  const combinations: StackingNarrative["combinations"] = [];
  for (const combo of ZONE_COMBOS) {
    if (combo.zones.every((z) => activeZones.includes(z))) {
      combinations.push({
        zones: combo.zones.map((z) => zoneNames[z] || ZONE_LABELS_LOCAL[z] || z),
        benefit: combo.benefit,
        relationship: "conditional",
      });
    }
  }

  // Build narrative
  let narrative: string;
  if (zoneCount === 0) {
    narrative = "This location is not within any mapped incentive zones. Broader non-zone programs may still be worth exploring.";
  } else if (zoneCount <= 2) {
    const names = activeZones.map((z) => zoneNames[z] || ZONE_LABELS_LOCAL[z] || z).join(" and ");
    narrative = `This location intersects ${names}. Each program has separate eligibility, timing, approval, and interaction rules.`;
  } else {
    narrative = `This location intersects ${zoneCount} mapped incentive zones. Each program has separate eligibility, timing, approval, and interaction rules.`;
  }

  if (combinations.length > 0) {
    narrative += ` We found ${combinations.length} program interaction${combinations.length !== 1 ? "s" : ""} to verify with the relevant administrators.`;
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
    return "No address-linked programs were found in the mapped data. Broader programs and local business support may still be useful starting points.";
  }

  const names = topResults.map((r) => r.program.name);
  const listText =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  return `The mapped data records ${zoneCount} incentive zone${zoneCount !== 1 ? "s" : ""} at this location and surfaces programs such as ${listText} for review. Each program has separate project, applicant, timing, and approval requirements to confirm with its administrator.`;
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

  // Top 3 address/profile-supported programs. Discovery-only programs stay
  // visible elsewhere but should not drive the executive-summary claim.
  const addressLinked = results.filter(
    (r) => r.relevance !== "not_mapped_at_location" && r.relevance !== "context_dependent",
  );
  const topResults = addressLinked.slice(0, 3);

  const topPrograms = topResults.map((r) => ({
    programId: r.programId,
    name: r.program.name,
    explanation: buildPublicMatchExplanation(r.program, {
      whyItAppears: r.program.zoneKey && zones[r.program.zoneKey]
        ? [`This program is linked to a mapped incentive zone recorded at this address.`]
        : [`This program is included as a starting point based on its published focus.`],
      knownFromPublicData: r.program.zoneKey && zones[r.program.zoneKey]
        ? [`The address is recorded within ${zoneNames[r.program.zoneKey] || r.program.zoneKey}.`]
        : [],
      basedOnUserAnswers: r.matchedRules,
      rulesEstablishedByPublicData: (r.program.eligibilityRules ?? [])
        .filter((rule) => rule.verifiedBy === "location" && r.program.zoneKey && zones[r.program.zoneKey])
        .map((rule) => rule.description),
    }),
  }));

  const whyTheseMatter = buildWhyParagraph(topResults, zoneCount);

  return {
    topPrograms,
    topActions: topActions.slice(0, 3),
    zoneCount,
    whyTheseMatter,
  };
}
