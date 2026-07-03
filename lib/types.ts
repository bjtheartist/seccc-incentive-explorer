export interface Business {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lon: number | null;
  phone: string;
  website: string;
  category: string;
  incentiveCount: number;
  zones: Record<string, boolean | string>;
}

/* ── Structured contact (replaces flat text) ── */

export interface ProgramContact {
  agency: string;
  abbreviation: string;
  phone: string;
  email?: string;
  url?: string;
  role?: string;
}

/* ── Machine-readable eligibility rule ── */

export interface EligibilityRule {
  criterion: string; // "location" | "industry" | "propertyType" | "investmentSize"
  description: string;
  verifiedBy: "location" | "survey" | "manual" | "none";
  required: boolean;
}

/* ── Application portal (Submittable, web form, PDF, etc.) ── */

export interface ApplicationPortal {
  type: "submittable" | "web" | "pdf" | "email" | "in_person";
  label: string;
  url: string;
  language?: "en" | "es";
  notes?: string;
}

/* ── "Next step" — discovery/navigation only, not compliance ── */

export interface VerificationStep {
  label: string;
  agency: string;
  url: string;
  kind: "certification" | "reporting" | "filing" | "preapproval" | "consent";
  appliesBefore?: "application" | "purchase" | "construction" | "annual";
  note?: string;
}

export type ProgramStatus =
  | "active"
  | "current" // used interchangeably with "active" in programs.json
  | "changed"
  | "verify"
  | "sunset"
  | "pending"
  | "lapsed"; // statutory authority lapsed but revival is realistic (e.g. WOTC)
export type ProgramLevel = "Federal" | "State" | "County" | "City" | "Utility";

/* ── Dated application window / deadline entry on a program card ── */

export interface ProgramDeadlineEntry {
  /** Human label, e.g. "July 2026 window closes" or "Final application deadline". */
  label?: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
}

/* ── Stacking rule between two programs ── */

export interface StackingRule {
  id: string;
  programId: string;
  otherProgramId: string;
  relationship: "can" | "cannot" | "conditional" | "unknown";
  scope: "same_property" | "same_project" | "same_costs" | "general";
  conditionsJson: { allowed_if?: string[]; blocked_if?: string[] } | null;
  reason: string;
  authoritySource: string;
  confidence: "high" | "medium" | "low";
  lastVerifiedAt: string | null;
}

export interface Program {
  id: string;
  name: string;
  level: ProgramLevel;
  zoneKey: string;
  summary: string;
  whoQualifies: string;
  benefits: string[];
  howToApply: string[];
  requiredDocs: string[];
  contact: string;
  url: string;
  contacts?: ProgramContact[];
  eligibilityRules?: EligibilityRule[];
  lastVerifiedAt?: string | null;
  benefitRange?: string;
  fastestConfirmingStep?: string;
  // ── Phase 1 (2026-05-21) additions ─────────────────────────────
  status?: ProgramStatus;
  sourceUrl?: string;
  applicationPortals?: ApplicationPortal[];
  verificationSteps?: VerificationStep[];
  boundaryDisclaimer?: string;
  expirationNote?: string;
  suspensionNote?: string;
  sunsetWarning?: string;
  oz2Note?: string;
  // ── Availability gating (2026-07) — see lib/program-gating.ts ──
  /** Dated application windows/deadlines for this card (used by deadlines + gating). */
  deadlines?: ProgramDeadlineEntry[];
  /**
   * One-shot program (e.g. a disaster declaration). Once every deadlines[]
   * date has passed (or expiresOn passes), the card is treated as expired
   * and hidden everywhere.
   */
  oneTime?: boolean;
  /** Hard end-of-availability date (YYYY-MM-DD). Past this date the card is hidden. */
  expiresOn?: string;
  /**
   * Recurring program (annual/quarterly/district rounds). Never auto-hidden;
   * between windows it is shown with an "applications currently closed" note.
   */
  recurring?: boolean;
}

/* ── Phase 1: Check result types ── */

export type EligibilityConfidence =
  | "appears_eligible"
  | "location_eligible"
  | "may_qualify"
  | "worth_exploring"
  | "not_applicable";

export interface ProgramCheckResult {
  programId: string;
  program: Program;
  confidence: EligibilityConfidence;
  confidenceLabel: string;
  whyOneLine: string;
  benefitRange: string;
  fastestStep: string;
  notVerified: string[];
  matchedRules: string[];
}

export interface TopAction {
  label: string;
  type: "call" | "gather" | "book" | "check";
  programId: string;
  contact?: ProgramContact;
}

export interface CheckResult {
  address: string;
  lat: number;
  lon: number;
  zones: Record<string, boolean>;
  zoneNames: Record<string, string>;
  zoneCount: number;
  programs: ProgramCheckResult[];
  topActions: TopAction[];
  cityZoning?: CityZoning;
  census?: CensusData;
  parcel?: ParcelData;
  timestamp: string;
}

export interface ZoneCoverage {
  count: number;
  pct: number;
  label: string;
}

export interface Stats {
  totalBusinesses: number;
  totalCategories: number;
  zipCodes: string[];
  diversityIndex: number;
  zoneCoverage: Record<string, ZoneCoverage>;
  stackingDistribution: Record<string, number>;
  sbif: {
    localProjects: number;
    citywideProjects: number;
    localShare: number;
  };
  corridors: Record<string, string>;
}

export interface CityZoning {
  zoneClass: string; // e.g. "C1-2", "M1-2", "RS-3"
  zoneType: string | null; // e.g. "Commercial", "Manufacturing"
}

export interface CensusData {
  tractId: string;
  medianIncome: number | null;
  medianHomeValue: number | null;
  population: number | null;
  walkScore: number | null;
}

export interface ParcelData {
  pin: string;              // 14-digit Cook County PIN
  address: string;          // Street address from parcel record
  zip?: string | null;      // ZIP code from parcel source when available
  classCode: string;        // e.g. "5-17", "2-11"
  classDescription: string; // "One-story commercial building"
  taxCode: string;
  township: string;
  landSqft: number | null;
  bldgSqft: number | null;
  bldgAge: number | null;
  landValue: string | null;
  bldgValue: string | null;
  totalValue: string | null;
  parcelType: number | null; // 1 = condo
  isCommercial: boolean;
  isIndustrial: boolean;
  isVacant: boolean;
  // Cook County Assessor enrichment (optional)
  assessedLand?: number | null;
  assessedBuilding?: number | null;
  assessedTotal?: number | null;
  taxYear?: string | null;
  priorYearTax?: number | null;
  // Ownership enrichment
  ownerName?: string | null;
  ownerMailingAddress?: string | null;
  ownerType?: string | null;
}

/* ── Vacant Property ── */

export interface VacantPropertyZoneMatch {
  zoneKey: string;
  zoneName: string;
}

export interface VacantProperty {
  id: string;
  source: "cols" | "dpd_vacant" | "violations";
  address: string;
  lat: number;
  lon: number;
  propertyType: "vacant_land" | "vacant_building" | "vacant_storefront";
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
  status: string | null;
  zoneMatches: VacantPropertyZoneMatch[];
  incentiveCount: number;
  ownerName: string | null;
  ownerType: string | null;
}

export interface DistrictData {
  ward: string | null;
  congressionalDistrict: string | null;
  stateHouseDistrict: string | null;
  stateSenateDistrict: string | null;
  commissionerDistrict: string | null;
}

export interface LookupResult {
  matched: boolean;
  business?: Business;
  address: string;
  lat: number;
  lon: number;
  zones: Record<string, boolean>;
  zoneNames: Record<string, string>; // e.g. { tif: "Stony Island Ave...", ssa: "Calumet Hts/Avalon" }
  incentiveCount: number;
  cityZoning?: CityZoning;
  sector?: string; // user-selected business sector ID
  employment?: {
    censusTract: string;
    unemploymentRate: string; // e.g. "34.3%"
    population: number;
  };
  census?: CensusData;
  parcel?: ParcelData;
}

export interface ZoneCheckResult {
  key: string;
  name: string;
}

export interface CommunityAsset {
  id: string;
  name: string;
  type: "EDO" | "BSO" | "university" | "library";
  address: string;
  lat: number;
  lon: number;
}

/* ── Pre-Qualification Survey ── */

export interface SurveyQuestion {
  id: string;
  step: number;
  title: string;
  subtitle: string;
  type: "single" | "multi";
  options: { id: string; label: string }[];
}

export interface SurveyAnswers {
  industry?: string;
  property?: string;
  activities?: string[];
  size?: string;
}

export interface ProgramMatch {
  programId: string;
  program: { name: string; short: string };
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface SurveyResult {
  matches: ProgramMatch[];
  total: number;
  totalPrograms: number;
}

/* ── Executive Summary (for reports) ── */

export interface ExecutiveSummary {
  topPrograms: {
    programId: string;
    name: string;
    confidence: EligibilityConfidence;
    confidenceLabel: string;
    benefitRange: string;
    whyOneLine?: string;
    notVerified?: string[];
  }[];
  topActions: TopAction[];
  zoneCount: number;
  whyTheseMatter: string;
}
