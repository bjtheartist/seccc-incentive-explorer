import type { Program, ProgramCheckResult } from "./types";
import { PROJECT_TYPE_LABELS } from "./report-wizard-config";
import { getIndustryById } from "./industries-data";

export type ProjectFitLevel =
  | "strong"
  | "related"
  | "industry-check"
  | "location-only";

export interface ProjectFitSummary {
  level: ProjectFitLevel;
  label: string;
  reason: string;
}

export type ProjectFit = ProjectFitSummary;

type ProgramProjectProfile = Pick<Program, "id" | "name"> &
  Partial<
    Pick<
      Program,
      "zoneKey" | "summary" | "whoQualifies" | "benefits" | "howToApply" | "eligibilityRules"
    >
  >;

interface GoalRule {
  strongProgramIds: ReadonlySet<string>;
  relatedProgramIds: ReadonlySet<string>;
  keywords: readonly string[];
}

function ids(values: readonly string[]): ReadonlySet<string> {
  return new Set(values);
}

const GOAL_RULES: Record<string, GoalRule> = {
  rehab: {
    strongProgramIds: ids([
      "sbif",
      "tif",
      "nof",
      "class7a",
      "class7b",
      "class7c",
      "class8",
      "classL",
      "classC",
      "bmec",
      "cookBrownfield",
    ]),
    relatedProgramIds: ids([
      "enterprise",
      "cpace",
      "hudSection108",
      "sba7a504",
      "cdgSmall",
      "cdgMedium",
      "cdgLarge",
      "microMarketRecovery",
      "ccsa",
    ]),
    keywords: [
      "renovat",
      "rehab",
      "building improvement",
      "facade",
      "roof",
      "plumbing",
      "electrical",
      "build-out",
      "buildout",
    ],
  },
  expansion: {
    strongProgramIds: ids([
      "edge",
      "enterprise",
      "sba7a504",
      "hudSection108",
      "ssbciAdvantageIL",
      "landBank",
      "class6b",
      "class7a",
      "class7b",
      "class8",
      "hib",
    ]),
    relatedProgramIds: ids([
      "catalystGrant",
      "smallBizSource",
      "kivaChicago",
      "greenwoodArcher",
      "alliesCommunityBusiness",
      "workforceSolutions",
      "aim",
    ]),
    keywords: [
      "expan",
      "add capacity",
      "capital investment",
      "business growth",
      "new location",
      "working capital",
      "job creation",
    ],
  },
  equipment: {
    strongProgramIds: ids([
      "enterprise",
      "bmec",
      "sba7a504",
      "catalystGrant",
      "kivaChicago",
      "greenwoodArcher",
      "alliesCommunityBusiness",
      "comedEvRebate",
    ]),
    relatedProgramIds: ids([
      "edge",
      "aim",
      "innovationVoucher",
      "ssbciAdvantageIL",
      "dataCenter",
      "rev",
      "micro",
      "chips48d",
    ]),
    keywords: [
      "equipment",
      "machinery",
      "fixtures",
      "vehicle",
      "technology purchase",
      "sales tax exemption",
      "capital purchase",
    ],
  },
  hiring: {
    strongProgramIds: ids([
      "edge",
      "workforceSolutions",
      "highUnemployment",
      "catalystGrant",
    ]),
    relatedProgramIds: ids([
      "enterprise",
      "smallBizSource",
      "economicEmpowermentCenters",
      "r3Grants",
      "hib",
      "aim",
      "rev",
      "micro",
    ]),
    keywords: [
      "hiring",
      "new hire",
      "job creation",
      "create jobs",
      "retain jobs",
      "workforce",
      "employee",
      "payroll",
      "training",
    ],
  },
  relocation: {
    strongProgramIds: ids([
      "landBank",
      "class7a",
      "class7b",
      "class8",
      "class6b",
      "enterprise",
      "ssa",
      "ccsa",
    ]),
    relatedProgramIds: ids([
      "sba7a504",
      "hudSection108",
      "smallBizSource",
      "nof",
      "tif",
    ]),
    keywords: [
      "relocat",
      "new location",
      "site selection",
      "property acquisition",
      "acquire property",
      "reoccupancy",
      "commercial space",
    ],
  },
  energy: {
    strongProgramIds: ids([
      "cpace",
      "comedSmallBizEfficiency",
      "comedDgSolar",
      "peoplesGasEfficiency",
      "sec179d",
      "energyCommunityBonus",
      "iraCleanElectricity",
      "electivePay",
      "climateInfrastructureFund",
      "comedEvRebate",
    ]),
    relatedProgramIds: ids(["enterprise", "sbif", "tif", "bmec"]),
    keywords: [
      "energy efficiency",
      "renewable energy",
      "solar",
      "hvac",
      "utility",
      "water conservation",
      "building system",
      "electric vehicle",
    ],
  },
  "new-construction": {
    strongProgramIds: ids([
      "landBank",
      "class7a",
      "class7b",
      "class8",
      "class6b",
      "enterprise",
      "nof",
      "nmtcEligible",
      "qct",
    ]),
    relatedProgramIds: ids(["tif", "hudSection108", "sba7a504", "cpace", "cdgLarge"]),
    keywords: ["new construction", "ground-up", "construction costs", "develop vacant"],
  },
  "mixed-use": {
    strongProgramIds: ids([
      "nmtcEligible",
      "qct",
      "ahsap",
      "landBank",
      "hudSection108",
      "tif",
    ]),
    relatedProgramIds: ids(["class7a", "class7b", "cpace", "nof"]),
    keywords: ["mixed-use", "mixed use", "housing and commercial", "community facility"],
  },
  "affordable-housing": {
    strongProgramIds: ids(["qct", "ahsap", "nmtcEligible", "landBank", "hudSection108"]),
    relatedProgramIds: ids(["tif", "cpace", "class8"]),
    keywords: ["affordable housing", "income-restricted", "lihtc", "multifamily"],
  },
  "vacant-acquisition": {
    strongProgramIds: ids(["landBank", "class7a", "class7b", "class8", "class6b", "classC"]),
    relatedProgramIds: ids(["tif", "nof", "hudSection108", "cookBrownfield"]),
    keywords: ["vacant property", "acquisition", "abandoned", "brownfield", "reoccupancy"],
  },
};

const SPECIALIZED_INDUSTRY_PROGRAM_IDS = ids([
  "rev",
  "micro",
  "dataCenter",
  "chips48d",
  "class8aMicro",
  "quantumEZ",
  "filmCredit",
  "liveTheaterCredit",
  "cannabisR3",
  "cookCannabisGrant",
]);

const PROJECT_FIT_PRIORITY: Record<ProjectFitLevel, number> = {
  strong: 3,
  related: 2,
  "location-only": 1,
  "industry-check": 0,
};

function searchableProgramText(program: ProgramProjectProfile): string {
  return [
    program.name,
    program.summary,
    program.whoQualifies,
    ...(program.benefits || []),
    ...(program.howToApply || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function projectGoalLabel(projectType: string): string {
  return PROJECT_TYPE_LABELS[projectType] || projectType;
}

export function projectGoalFit(
  program: ProgramProjectProfile,
  projectType: string,
  industry?: string,
): ProjectFit | undefined {
  const rule = GOAL_RULES[projectType];
  if (!rule) return undefined;

  const goalLabel = projectGoalLabel(projectType);
  let level: ProjectFitLevel = "location-only";

  if (rule.strongProgramIds.has(program.id)) {
    level = "strong";
  } else if (rule.relatedProgramIds.has(program.id)) {
    level = "related";
  } else {
    const haystack = searchableProgramText(program);
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      level = "related";
    }
  }

  if (SPECIALIZED_INDUSTRY_PROGRAM_IDS.has(program.id)) {
    const industryProfile = industry ? getIndustryById(industry) : undefined;
    const industrySupportsProgram = industryProfile
      ? industryProfile.topPrograms.includes(program.id)
      : false;
    if (!industry || !industrySupportsProgram) {
      return {
        level: "industry-check",
        label: "Industry requirements to confirm",
        reason: industry
          ? `The selected industry does not establish whether this specialized program applies to ${goalLabel.toLowerCase()}.`
          : `This program is tied to the address, but its industry requirement must be confirmed before considering it for ${goalLabel.toLowerCase()}.`,
      };
    }
  }

  if (level === "strong") {
    return {
      level: "strong",
      label: `Directly related to ${goalLabel.toLowerCase()}`,
      reason: `This program directly supports the selected goal: ${goalLabel.toLowerCase()}.`,
    };
  }

  if (level === "related") {
    return {
      level: "related",
      label: `May relate to ${goalLabel.toLowerCase()}`,
      reason: `This program may support part of the selected goal and should be verified with its administrator.`,
    };
  }

  return {
    level: "location-only",
    label: "Location-based program",
    reason: `The address may connect to this program, but its current description does not clearly target ${goalLabel.toLowerCase()}.`,
  };
}

export function isProjectGoalMatch(fit?: ProjectFit): boolean {
  return fit?.level === "strong" || fit?.level === "related";
}

export function summarizeProjectFit(fit?: ProjectFit): ProjectFitSummary | undefined {
  if (!fit) return undefined;
  return {
    level: fit.level,
    label: fit.label,
    reason: fit.reason,
  };
}

export function compareProjectGoalFit(a?: ProjectFit, b?: ProjectFit): number {
  const aPriority = a ? PROJECT_FIT_PRIORITY[a.level] : 0;
  const bPriority = b ? PROJECT_FIT_PRIORITY[b.level] : 0;
  return bPriority - aPriority;
}

export function orderProgramCheckResultsByProjectGoal(
  results: ProgramCheckResult[],
  projectType: string,
  industry?: string,
): ProgramCheckResult[] {
  if (!GOAL_RULES[projectType]) return results;
  return [...results].sort((a, b) => {
    const fitDiff = compareProjectGoalFit(
      projectGoalFit(a.program, projectType, industry),
      projectGoalFit(b.program, projectType, industry),
    );
    return fitDiff;
  });
}
