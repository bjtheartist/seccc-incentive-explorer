// ─── Report Wizard Configuration ────────────────────────────────────
// Pure TypeScript config/types for the multi-step report wizard.
// Two report types: Site Incentive Analysis & Development Feasibility.

// ─── Core Types ─────────────────────────────────────────────────────

export type ReportType = "site-incentives" | "dev-feasibility";

export interface ReportTypeOption {
  id: ReportType;
  title: string;
  subtitle: string;
  icon: string; // emoji
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
  inputType: "report-type" | "address" | "neighborhood" | "single" | "multi" | "combobox" | "review";
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
  projectType: string;
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
  projectType: "",
  creditsToAnalyze: [],
};

// ─── Report Type Options (Step 1) ───────────────────────────────────

export const REPORT_TYPE_OPTIONS: ReportTypeOption[] = [
  {
    id: "site-incentives",
    title: "Site Incentive Analysis",
    subtitle:
      "You have a location. See which programs apply, what they\u2019re worth, and who to call.",
    icon: "\uD83D\uDCCD",
  },
  {
    id: "dev-feasibility",
    title: "Development Feasibility Study",
    subtitle:
      "Evaluate a site or neighborhood for property data, zoning, credit stacking, and financial feasibility.",
    icon: "\uD83C\uDFD7\uFE0F",
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

const BUDGET_RANGE_OPTIONS: StepOption[] = [
  { id: "under-100k", label: "Under $100K" },
  { id: "100k-500k", label: "$100K\u2013$500K" },
  { id: "500k-2m", label: "$500K\u2013$2M" },
  { id: "2m-10m", label: "$2M\u2013$10M" },
  { id: "over-10m", label: "Over $10M" },
];

const PROJECT_TYPE_OPTIONS: StepOption[] = [
  {
    id: "rehab",
    label: "Rehabilitation / renovation",
    description: "Renovating or adaptively reusing an existing structure.",
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
];

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

// ─── Wizard Steps ───────────────────────────────────────────────────

export const WIZARD_STEPS: WizardStepConfig[] = [
  // ── Shared: Report type selection ─────────────────────────────────
  {
    id: "report-type",
    title: "What do you need?",
    subtitle: "Choose the analysis that fits your situation.",
    appliesTo: ["site-incentives", "dev-feasibility"],
    inputType: "report-type",
    stateKey: "reportType",
    options: REPORT_TYPE_OPTIONS.map((opt) => ({
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
    subtitle: "Filters programs to your sector and personalizes your action plan.",
    appliesTo: ["site-incentives"],
    inputType: "combobox",
    stateKey: "industry",
    options: [
      ...INDUSTRY_OPTIONS,
      { id: "skip", label: "Skip \u2014 show all programs" },
    ],
  },
  {
    id: "si-budget",
    title: "Estimated project budget?",
    subtitle: "Unlocks dollar estimates for each incentive. Skip if you prefer not to share.",
    appliesTo: ["site-incentives"],
    inputType: "single",
    stateKey: "budgetRange",
    options: [
      ...BUDGET_RANGE_OPTIONS,
      { id: "skip", label: "Skip this step" },
    ],
  },
  {
    id: "si-review",
    title: "Review & Generate",
    subtitle: "Confirm your selections and generate your incentive report.",
    appliesTo: ["site-incentives"],
    inputType: "review",
    stateKey: "reportType",
  },

  // ── Development Feasibility flow ──────────────────────────────────

  {
    id: "df-project-type",
    title: "What are you planning?",
    subtitle: "Shapes the feasibility assessment and determines which credits apply.",
    appliesTo: ["dev-feasibility"],
    inputType: "single",
    stateKey: "projectType",
    options: PROJECT_TYPE_OPTIONS,
  },
  {
    id: "df-location",
    title: "Where in Chicago?",
    subtitle: "Pick a neighborhood to explore, or enter a specific address for parcel-level detail.",
    appliesTo: ["dev-feasibility"],
    inputType: "neighborhood",
    stateKey: "neighborhood",
  },
  {
    id: "df-budget",
    title: "Total project cost?",
    subtitle: "Required for credit stacking calculations \u2014 determines dollar values per program.",
    appliesTo: ["dev-feasibility"],
    inputType: "single",
    stateKey: "budgetRange",
    options: BUDGET_RANGE_OPTIONS,
  },
  {
    id: "df-credits",
    title: "Which credits do you want to stack?",
    subtitle: "We\u2019ve pre-selected credits based on zone coverage. Add or remove as needed.",
    appliesTo: ["dev-feasibility"],
    inputType: "multi",
    stateKey: "creditsToAnalyze",
    options: CREDIT_OPTIONS,
  },
  {
    id: "df-review",
    title: "Review & Generate",
    subtitle: "Confirm your selections and generate your feasibility report.",
    appliesTo: ["dev-feasibility"],
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

  if (step.inputType === "single" || step.inputType === "combobox") {
    return typeof value === "string" && value.length > 0;
  }

  if (step.inputType === "multi") {
    return Array.isArray(value) && value.length > 0;
  }

  return false;
}

export function getReportTypeOption(
  type: ReportType,
): ReportTypeOption | undefined {
  return REPORT_TYPE_OPTIONS.find((opt) => opt.id === type);
}
