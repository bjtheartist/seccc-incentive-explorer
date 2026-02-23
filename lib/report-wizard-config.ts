// ─── Report Wizard Configuration ────────────────────────────────────
// Pure TypeScript config/types for the multi-step report wizard.
// No external library imports — this is a standalone configuration file.

// ─── Core Types ─────────────────────────────────────────────────────

export type ReportType =
  | "location-incentives"
  | "best-location"
  | "program-explorer"
  | "developer-analysis";

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
  appliesTo: ReportType[]; // which report types include this step
  inputType: "report-type" | "address" | "single" | "multi" | "review";
  stateKey: keyof WizardState; // maps directly to the WizardState property this step writes to
  options?: StepOption[];
}

export interface WizardState {
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

// ─── Initial State ──────────────────────────────────────────────────

export const INITIAL_WIZARD_STATE: WizardState = {
  reportType: null,
  address: "",
  lat: null,
  lon: null,
  industry: "",
  activities: [],
  incentiveInterests: [],
  locationPriorities: [],
  budgetRange: "",
  governmentLevels: [],
  benefitTypes: [],
  projectType: "",
  creditsToAnalyze: [],
};

// ─── Report Type Options (Step 1) ───────────────────────────────────

export const REPORT_TYPE_OPTIONS: ReportTypeOption[] = [
  {
    id: "location-incentives",
    title: "Incentives at My Location",
    subtitle:
      "You have or know your address and want to see what incentives apply there.",
    icon: "📍",
  },
  {
    id: "best-location",
    title: "Find the Best Location",
    subtitle:
      "You are looking for the optimal place to locate your business based on incentives.",
    icon: "🗺️",
  },
  {
    id: "program-explorer",
    title: "Explore Programs",
    subtitle:
      "Understand what programs exist and which ones you might qualify for.",
    icon: "📋",
  },
  {
    id: "developer-analysis",
    title: "Development Feasibility",
    subtitle:
      "Analyze a site for tax credit stacking and project viability as a developer or investor.",
    icon: "🏗️",
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

const INCENTIVE_INTEREST_OPTIONS: StepOption[] = [
  { id: "tif", label: "TIF District" },
  { id: "federalOZ", label: "Federal Opportunity Zone" },
  { id: "enterprise", label: "Enterprise Zone" },
  { id: "stateIncentiveZones", label: "State Incentive Zone (EDGE/REV/MICRO/Data Center)" },
  { id: "ssa", label: "Special Service Area" },
  { id: "highUnemployment", label: "High Unemployment Zone" },
  { id: "industrialCorridors", label: "Industrial Corridor" },
  { id: "microMarketRecovery", label: "Micro Market Recovery" },
  { id: "nof", label: "Neighborhood Opportunity Fund" },
  { id: "nmtcEligible", label: "NMTC Eligible Census Tract" },
  { id: "qct", label: "Qualified Census Tract (HUD)" },
  { id: "landmarkDistricts", label: "Chicago Landmark District" },
  { id: "nrhpDistricts", label: "National Register Historic District" },
];

// ─── Wizard Steps ───────────────────────────────────────────────────

export const WIZARD_STEPS: WizardStepConfig[] = [
  // ── Step 1: Report type (shared across all flows) ─────────────────
  {
    id: "report-type",
    title: "What kind of report do you need?",
    subtitle: "Choose the analysis that best fits your situation.",
    appliesTo: [
      "location-incentives",
      "best-location",
      "program-explorer",
      "developer-analysis",
    ],
    inputType: "report-type",
    stateKey: "reportType",
    options: REPORT_TYPE_OPTIONS.map((opt) => ({
      id: opt.id,
      label: opt.title,
      description: opt.subtitle,
    })),
  },

  // ── location-incentives flow ──────────────────────────────────────

  {
    id: "li-address",
    title: "What is your address?",
    subtitle:
      "Enter your business or property address so we can check which incentive zones cover it.",
    appliesTo: ["location-incentives"],
    inputType: "address",
    stateKey: "address",
  },
  {
    id: "li-industry",
    title: "What industry or sector are you in?",
    subtitle:
      "This helps us highlight the programs most relevant to your type of business.",
    appliesTo: ["location-incentives"],
    inputType: "single",
    stateKey: "industry",
    options: INDUSTRY_OPTIONS,
  },
  {
    id: "li-activities",
    title: "What are you looking to do?",
    subtitle: "Select all that apply to your plans.",
    appliesTo: ["location-incentives"],
    inputType: "multi",
    stateKey: "activities",
    options: [
      {
        id: "expand-renovate",
        label: "Expand/renovate existing space",
        description:
          "Physical improvements to a building you already occupy or own.",
      },
      {
        id: "new-location",
        label: "Open new location",
        description:
          "Moving into a new storefront, office, or facility for the first time.",
      },
      {
        id: "hire-employees",
        label: "Hire employees",
        description:
          "Adding new full-time or part-time positions at your location.",
      },
      {
        id: "invest-capital-gains",
        label: "Invest capital gains",
        description:
          "Deploying realized capital gains into a qualified investment.",
      },
      {
        id: "buy-property",
        label: "Buy property",
        description:
          "Purchasing commercial or industrial real estate.",
      },
      {
        id: "energy-efficiency",
        label: "Improve energy efficiency",
        description:
          "Upgrades such as HVAC, insulation, solar panels, or lighting retrofits.",
      },
    ],
  },
  {
    id: "li-incentive-interests",
    title: "Which incentive areas interest you?",
    subtitle:
      "Toggle the zone types you want included in your report. We will still show all zones at your address.",
    appliesTo: ["location-incentives"],
    inputType: "multi",
    stateKey: "incentiveInterests",
    options: INCENTIVE_INTEREST_OPTIONS,
  },
  {
    id: "li-review",
    title: "Review & Generate",
    subtitle:
      "Confirm your selections below and generate your customized incentive report.",
    appliesTo: ["location-incentives"],
    inputType: "review",
    stateKey: "reportType", // review step reads multiple fields; stateKey is nominal
  },

  // ── best-location flow ────────────────────────────────────────────

  {
    id: "bl-industry",
    title: "What industry or sector are you in?",
    subtitle:
      "We will focus on locations with the strongest incentive match for your sector.",
    appliesTo: ["best-location"],
    inputType: "single",
    stateKey: "industry",
    options: INDUSTRY_OPTIONS,
  },
  {
    id: "bl-priorities",
    title: "What matters most to you?",
    subtitle: "Select all the factors that are important for your ideal location.",
    appliesTo: ["best-location"],
    inputType: "multi",
    stateKey: "locationPriorities",
    options: [
      {
        id: "low-property-costs",
        label: "Low property costs",
        description: "Affordable lease rates or purchase prices.",
      },
      {
        id: "transit-access",
        label: "Transit access",
        description: "Proximity to CTA, Metra, or major bus routes.",
      },
      {
        id: "foot-traffic",
        label: "Foot traffic",
        description: "High pedestrian volume for customer-facing businesses.",
      },
      {
        id: "skilled-workforce",
        label: "Skilled workforce",
        description: "Access to trained employees in your industry.",
      },
      {
        id: "incentive-density",
        label: "Incentive density",
        description:
          "Areas where multiple incentive zones overlap for maximum benefit stacking.",
      },
      {
        id: "industrial-zoning",
        label: "Industrial zoning",
        description:
          "Locations zoned for manufacturing, warehousing, or industrial use.",
      },
    ],
  },
  {
    id: "bl-budget",
    title: "What is your budget range?",
    subtitle:
      "This helps us match you with programs that fit your investment level.",
    appliesTo: ["best-location"],
    inputType: "single",
    stateKey: "budgetRange",
    options: BUDGET_RANGE_OPTIONS,
  },
  {
    id: "bl-review",
    title: "Review & Generate",
    subtitle:
      "Confirm your selections below and generate your location recommendation report.",
    appliesTo: ["best-location"],
    inputType: "review",
    stateKey: "reportType",
  },

  // ── program-explorer flow ─────────────────────────────────────────

  {
    id: "pe-government-level",
    title: "Which government levels are you interested in?",
    subtitle:
      "Select the levels of government whose programs you want to explore.",
    appliesTo: ["program-explorer"],
    inputType: "multi",
    stateKey: "governmentLevels",
    options: [
      {
        id: "federal",
        label: "Federal",
        description: "U.S. government programs such as Opportunity Zones, NMTC, and HTC.",
      },
      {
        id: "state",
        label: "State",
        description:
          "Illinois state programs including Enterprise Zone, EDGE, and REV credits.",
      },
      {
        id: "county",
        label: "County",
        description: "Cook County incentives such as property tax classifications.",
      },
      {
        id: "city",
        label: "City",
        description:
          "City of Chicago programs like TIF, SSA, SBIF, and Neighborhood Opportunity Fund.",
      },
    ],
  },
  {
    id: "pe-industry",
    title: "What industry or sector are you in?",
    subtitle:
      "We will highlight programs most commonly used by businesses in your sector.",
    appliesTo: ["program-explorer"],
    inputType: "single",
    stateKey: "industry",
    options: INDUSTRY_OPTIONS,
  },
  {
    id: "pe-benefit-types",
    title: "What types of benefits are you looking for?",
    subtitle: "Select all the benefit categories that interest you.",
    appliesTo: ["program-explorer"],
    inputType: "multi",
    stateKey: "benefitTypes",
    options: [
      {
        id: "tax-credits",
        label: "Tax credits",
        description: "Dollar-for-dollar reductions in your tax liability.",
      },
      {
        id: "grants",
        label: "Grants",
        description: "Non-repayable funds for eligible projects or improvements.",
      },
      {
        id: "financing-loans",
        label: "Financing/loans",
        description: "Below-market-rate loans or special financing programs.",
      },
      {
        id: "tax-exemptions",
        label: "Tax exemptions",
        description:
          "Exemptions from sales tax, utility tax, or other specific taxes.",
      },
      {
        id: "technical-assistance",
        label: "Technical assistance",
        description:
          "Free or subsidized consulting, training, and business support services.",
      },
      {
        id: "property-tax-reduction",
        label: "Property tax reduction",
        description:
          "Reduced property tax assessments or abatements for qualifying properties.",
      },
    ],
  },
  {
    id: "pe-review",
    title: "Review & Generate",
    subtitle:
      "Confirm your selections below and generate your program exploration report.",
    appliesTo: ["program-explorer"],
    inputType: "review",
    stateKey: "reportType",
  },

  // ── developer-analysis flow ───────────────────────────────────────

  {
    id: "da-address",
    title: "What is the project address?",
    subtitle:
      "Enter the site address so we can check zone overlaps and credit eligibility.",
    appliesTo: ["developer-analysis"],
    inputType: "address",
    stateKey: "address",
  },
  {
    id: "da-project-type",
    title: "What type of project is this?",
    subtitle: "Select the category that best describes your development.",
    appliesTo: ["developer-analysis"],
    inputType: "single",
    stateKey: "projectType",
    options: [
      {
        id: "new-commercial",
        label: "New commercial construction",
        description:
          "Ground-up construction of office, retail, or mixed commercial space.",
      },
      {
        id: "historic-rehab",
        label: "Historic rehabilitation",
        description:
          "Certified rehabilitation of a historic structure for continued or adaptive use.",
      },
      {
        id: "affordable-housing",
        label: "Affordable housing",
        description:
          "Residential development with income-restricted units meeting affordability thresholds.",
      },
      {
        id: "mixed-use",
        label: "Mixed-use development",
        description:
          "Projects combining residential, commercial, and/or institutional uses.",
      },
      {
        id: "industrial-manufacturing",
        label: "Industrial/manufacturing facility",
        description:
          "New or renovated facilities for manufacturing, warehousing, or industrial operations.",
      },
    ],
  },
  {
    id: "da-budget",
    title: "What is the estimated project budget?",
    subtitle:
      "Total project cost helps determine which credits and financing tools are viable.",
    appliesTo: ["developer-analysis"],
    inputType: "single",
    stateKey: "budgetRange",
    options: BUDGET_RANGE_OPTIONS,
  },
  {
    id: "da-credits",
    title: "Which credits do you want to analyze?",
    subtitle:
      "Select the tax credits and financing mechanisms to include in your stacking analysis.",
    appliesTo: ["developer-analysis"],
    inputType: "multi",
    stateKey: "creditsToAnalyze",
    options: [
      {
        id: "federal-htc",
        label: "Federal Historic Tax Credit (20%)",
        description:
          "20% credit on qualified rehabilitation expenditures for certified historic structures.",
      },
      {
        id: "nmtc",
        label: "NMTC (39% over 7 years)",
        description:
          "New Markets Tax Credit providing 39% of the investment as credits over seven years.",
      },
      {
        id: "oz-capital-gains",
        label: "Opportunity Zone capital gains",
        description:
          "Deferral and potential reduction of capital gains taxes through Qualified Opportunity Fund investment.",
      },
      {
        id: "lihtc-qct",
        label: "LIHTC / QCT boost",
        description:
          "Low-Income Housing Tax Credits with a 130% basis boost in Qualified Census Tracts.",
      },
      {
        id: "tif-funding",
        label: "TIF funding",
        description:
          "Tax Increment Financing to fund public improvements and eligible project costs.",
      },
      {
        id: "enterprise-zone",
        label: "Enterprise Zone exemptions",
        description:
          "State sales tax exemptions, utility tax exemptions, and investment tax credits.",
      },
      {
        id: "edge-credits",
        label: "EDGE tax credits",
        description:
          "Income tax credits for job creation and retention through the EDGE program.",
      },
      {
        id: "cpace",
        label: "C-PACE financing",
        description:
          "Commercial Property Assessed Clean Energy financing for energy efficiency and renewable energy improvements.",
      },
    ],
  },
  {
    id: "da-review",
    title: "Review & Generate",
    subtitle:
      "Confirm your selections below and generate your development feasibility report.",
    appliesTo: ["developer-analysis"],
    inputType: "review",
    stateKey: "reportType",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Returns the ordered list of wizard steps for a given report type.
 * Always starts with the shared "report-type" step, then the
 * type-specific steps in definition order.
 */
export function getStepsForReportType(type: ReportType): WizardStepConfig[] {
  return WIZARD_STEPS.filter((step) => step.appliesTo.includes(type));
}

/**
 * Reads the current value from WizardState for a given step.
 * Address steps return the address string. Single-choice steps return
 * a string. Multi-choice steps return a string[]. The report-type step
 * returns the reportType string (or "").
 */
export function getStepValue(
  state: WizardState,
  stepId: string,
): string | string[] {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return "";

  const value = state[step.stateKey];

  // Null report type returns empty string for UI convenience
  if (value === null) return "";

  return value as string | string[];
}

/**
 * Returns a new WizardState with the value for the given step updated.
 * For address steps, also accepts an object with { address, lat, lon }
 * via the overloaded signature. For all other steps, pass a string or
 * string[] matching the step's inputType.
 */
export function setStepValue(
  state: WizardState,
  stepId: string,
  value: string | string[],
): WizardState {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return state;

  return {
    ...state,
    [step.stateKey]: value,
  };
}

/**
 * Sets the address fields (address, lat, lon) together.
 * Use this instead of setStepValue for address steps when you
 * have geocoding results.
 */
export function setAddressValue(
  state: WizardState,
  address: string,
  lat: number | null,
  lon: number | null,
): WizardState {
  return {
    ...state,
    address,
    lat,
    lon,
  };
}

/**
 * Returns the total number of steps for a report type (including the
 * shared report-type selection step).
 */
export function getStepCount(type: ReportType): number {
  return getStepsForReportType(type).length;
}

/**
 * Returns the zero-based index of a step within its report type flow.
 * Returns -1 if the step is not found for that report type.
 */
export function getStepIndex(type: ReportType, stepId: string): number {
  const steps = getStepsForReportType(type);
  return steps.findIndex((s) => s.id === stepId);
}

/**
 * Checks whether a step has a valid value in the current state.
 * Used to determine if the user can proceed to the next step.
 */
export function isStepComplete(
  state: WizardState,
  stepId: string,
): boolean {
  const step = WIZARD_STEPS.find((s) => s.id === stepId);
  if (!step) return false;

  // Review steps are always considered "complete" (they are the final step)
  if (step.inputType === "review") return true;

  // Report type step: must have a selection
  if (step.inputType === "report-type") return state.reportType !== null;

  // Address step: must have a non-empty address and coordinates
  if (step.inputType === "address") {
    return state.address.trim().length > 0 && state.lat !== null && state.lon !== null;
  }

  const value = state[step.stateKey];

  // Single-choice: non-empty string
  if (step.inputType === "single") {
    return typeof value === "string" && value.length > 0;
  }

  // Multi-choice: at least one selection
  if (step.inputType === "multi") {
    return Array.isArray(value) && value.length > 0;
  }

  return false;
}

/**
 * Returns the ReportTypeOption for a given report type id.
 */
export function getReportTypeOption(
  type: ReportType,
): ReportTypeOption | undefined {
  return REPORT_TYPE_OPTIONS.find((opt) => opt.id === type);
}
