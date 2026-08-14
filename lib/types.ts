import type { PersonaId } from "./personas";
import type { DocumentSpec } from "./document-spec";
import type { ParcelSpaceFacts } from "./parcel-space";

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
  phone?: string;
  email?: string;
  url?: string;
  role?: string;
}

/* ── Eligibility-claims foundation (2026-08) ─────────────────────────
 * Structured status fields added to the internal catalog so public
 * surfaces can render a status-aware public contract instead of raw
 * prose strings. See lib/program-public.ts (toPublicProgramView) and
 * docs/eligibility-claims-acceptance.md for the full derivation and
 * copy contract. DERIVATION RULE (binding): when a record's existing
 * prose does not clearly establish one of these values, the value is
 * "unknown" / "conditional" — never "open" / "current" by default.
 */

/** Whether the program is currently accepting applications. */
export type IntakeStatus =
  | "open"
  | "rolling"
  | "closed"
  | "lapsed"
  | "pending"
  | "unknown";

/** Whether the published benefit terms (amounts, rates) are currently in force. */
export type BenefitTermsStatus =
  | "current"
  | "historical"
  | "conditional"
  | "unknown";

/** How a mapped location boundary relates to this program's actual eligibility. */
export type LocationRelation =
  | "required"
  | "preference"
  | "proxy"
  | "contextual"
  | "none";

/** Structured, nullable next-application-window info. */
export interface ProgramNextWindow {
  expected: string | null;
  note: string | null;
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
  /** Exact ISO 8601 cutoff with UTC offset when the source publishes a local time. */
  cutoffAt?: string;
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
  redesignatedAreaWarning?: string;
  adjacentCapitalNote?: string;
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
  /**
   * Persona lens tags (Tier 1b, audit BM4). Which visitor lenses most often
   * use this program. Descriptive editorial tagging, NOT an eligibility gate —
   * an untagged program still appears in the default "All" lens. DRAFT: review
   * with SECCC staff (docs/persona-tags-review.md).
   */
  personas?: PersonaId[];
  /**
   * Application-specific document schemas, matched by `label` to entries in
   * `requiredDocs`. Derived only from the program's existing requiredDocs /
   * verificationSteps text; where that text is vague the spec is generic (any
   * accepted type, single file). Flows into generated packet document tasks.
   */
  documentSpecs?: DocumentSpec[];
  // ── Eligibility-claims foundation (2026-08) — see lib/program-public.ts ──
  /** Present on every internal-catalog record; optional on the wider Program
   * type since DB-backed rows (app/api/programs/route.ts) do not yet carry
   * it. lib/__tests__/program-schema.test.ts asserts catalog completeness. */
  intakeStatus?: IntakeStatus;
  /** ISO date (YYYY-MM-DD) the status fields above were last confirmed accurate. */
  statusAsOf?: string;
  benefitTermsStatus?: BenefitTermsStatus;
  locationRelation?: LocationRelation;
  nextWindow?: ProgramNextWindow;
}

/* ── Phase 1: Check result types ── */

/**
 * How a program relates to the *data recorded* at an address — never a
 * statement about whether the visitor qualifies for it.
 *
 * This product is discovery-only: it may describe what public datasets and the
 * visitor's own answers show, and it may point at the requirements a program
 * publishes, but it must never state or imply an eligibility determination.
 * The variant names below are therefore descriptions of the evidence, not
 * verdicts about the user. Renaming them out of eligibility vocabulary is the
 * primary safety mechanism: text that is never generated cannot leak. The
 * output scrubbers in lib/report-engine.ts remain as defense in depth.
 *
 * Do not reintroduce `appears_eligible` / `location_eligible` / `may_qualify`
 * or any other determination-shaped variant here. See
 * `LegacyEligibilityConfidence` for the retired vocabulary, which survives only
 * to decode saved reports written before this rename.
 */
export type ProgramRelevance =
  /** Address falls inside the program's mapped zone AND survey answers align with a published non-location criterion. */
  | "mapped_with_matching_answers"
  /** Address falls inside the program's mapped zone; nothing else has been compared. */
  | "mapped_at_location"
  /** Some published criteria were compared, gaps remain — a human should review the rest. */
  | "review_suggested"
  /** Nothing address-specific was recorded; whether the program is worth pursuing depends on project context. */
  | "context_dependent"
  /** The mapped data does not place this address inside a zone the program requires. */
  | "not_mapped_at_location";

/**
 * Retired eligibility vocabulary. Never produced by the engine any more; it
 * exists so `ReportItem.confidenceLevel` on saved reports persisted before this
 * rename (saved_reports.report_data_json) still decodes and still gets stripped
 * by the public serializer instead of failing to type-check.
 */
export type LegacyEligibilityConfidence =
  | "appears_eligible"
  | "location_eligible"
  | "may_qualify"
  | "worth_exploring"
  | "not_applicable";

export interface ProgramCheckResult {
  programId: string;
  program: Program;
  relevance: ProgramRelevance;
  relevanceLabel: string;
  whyOneLine: string;
  benefitRange: string;
  fastestStep: string;
  notVerified: string[];
  matchedRules: string[];
}

/**
 * review6 S11 (CRITICAL, S1 reopened) — the network-safe shape for a map
 * click-snapshot program match. `ProgramCheckResult.program: Program`
 * above embeds the FULL internal record (whoQualifies, eligibilityRules,
 * contacts, requiredDocs, ...) — fine when `runConfidenceEngine()` runs
 * server-side and this type stays server-internal, but never safe to
 * serialize to an unauthenticated client. `components/map/MapDossierCard.tsx`
 * and `components/map/MapSnapshotPanel.tsx` only ever read
 * `.program.zoneKey`, `.program.name`, `.program.sourceUrl`/`.program.url`
 * (confirmed by direct grep of both files) — this narrows to exactly
 * that, nothing else, and is the ONLY shape app/api/programs/match/route.ts
 * is allowed to return.
 */
export interface SafeMapProgramMatch {
  programId: string;
  program: {
    id: string;
    name: string;
    level: string;
    zoneKey: string;
    url: string;
    sourceUrl?: string;
  };
}

/**
 * review6 S17 (CRITICAL) — `lib/program-gating.ts`'s `resolveAvailability`
 * (and its client-safe wrapper `requiresLiveProgramAvailability` in
 * components/programs/programAvailability.ts) only ever reads these 7
 * fields off a `Program` to compute intake availability — confirmed by
 * direct reading of every branch of that function. Extracting the exact
 * dependency as its own interface (rather than typing the parameter as
 * `Program`) means `Program` structurally satisfies it for free — every
 * EXISTING server-side caller that already passes a full `Program`
 * (app/programs/[slug]/page.tsx's static-params filter, lib/report-
 * engine.ts, lib/survey-engine.ts, scripts/smoke-report.ts) keeps
 * compiling with zero changes — while a genuinely narrow object built
 * from ONLY these fields is now also a valid argument, which is what
 * lets `ProgramApplicationView` below stay narrow instead of widening
 * back to `Program` just to satisfy this function's old signature.
 */
export interface ProgramAvailabilityFields {
  id: string;
  status?: ProgramStatus;
  suspensionNote?: string;
  sunsetWarning?: string;
  deadlines?: ProgramDeadlineEntry[];
  oneTime?: boolean;
  expiresOn?: string;
  recurring?: boolean;
}

/**
 * review6 S17 (CRITICAL) — `components/programs/ProgramApplicationSection.tsx`
 * is a `"use client"` component; `app/programs/[slug]/page.tsx` (a server
 * component) used to pass it a full raw `Program` prop — whoQualifies,
 * eligibilityRules, contacts, requiredDocs, verificationSteps, and every
 * other internal-only field, serialized into the page's RSC payload and
 * reachable by inspecting it, exactly the S11 leak shape but via a PROP
 * instead of a network route. This is the full, exact field set that
 * component (and the `resolveAvailability`/`resolveConservativeProgram
 * Availability` gating calls it makes) actually reads — confirmed by
 * direct reading of the component's source — nothing more.
 * `components/programs/programAvailability.ts`'s `toProgramApplicationView`
 * builds this from a full `Program` server-side; it is the ONLY shape
 * that component's `program` prop is allowed to receive.
 */
export interface ProgramApplicationView extends ProgramAvailabilityFields {
  howToApply: string[];
  fastestConfirmingStep?: string;
  sourceUrl?: string;
  url: string;
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
  cityZoningStatus?: ZoningLookupStatus;
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
  zoneType: string | null; // Official label for zoneTypeCode, when published
  zoneTypeCode?: number | null;
  pdNumber?: number | null;
  pmdSubArea?: string | null;
  pedestrianStreetAreaName?: string | null;
  ordinanceNumber?: string | null;
  ordinanceDate?: string | null;
  clerkDocumentNumber?: string | null;
  clerkUrl?: string | null;
  recordUpdatedAt?: string | null;
  source?: ZoningSourceMetadata;
  /** Per-mirror freshness, each on its own terms. See ZoningVintage. */
  vintage?: ZoningVintage;
  zba?: ChicagoZbaLookupResponse;
}

export type ZoningLookupStatus = "available" | "not_found" | "unavailable";

export interface ZoningSourceMetadata {
  id: "chicago-arcgis-zoning" | "chicago-data-portal-zoning";
  label: string;
  url: string;
  retrievedAt: string;
  recordUpdatedAt: string | null;
}

/**
 * What ONE mirror's point query actually did.
 *
 * A mirror that was never asked, a mirror that answered "no polygon here", and
 * a mirror that could not answer at all are three different facts, and
 * collapsing them lets a source that could not be consulted read as a source
 * that was consulted and found nothing. This is deliberately separate from
 * whether that mirror's dataset-level metadata could be retrieved: the two
 * endpoints fail independently.
 */
export type ZoningMirrorQueryOutcome =
  /** Returned the polygon whose fields this response publishes. */
  | "answered"
  /** Queried successfully and authoritatively returned no polygon here. */
  | "empty"
  /** Queried and could not answer. Its silence is not evidence of absence. */
  | "failed"
  /** Never asked, because another mirror had already answered. */
  | "not_queried";

/**
 * Whether this mirror's own dataset-wide freshness could be established. Kept
 * separate from `ZoningMirrorQueryOutcome` so a healthy metadata endpoint can
 * never make a failed point query look like a consulted one.
 */
export type ZoningMirrorDatasetOutcome =
  /** The mirror published a dataset-level timestamp and we read it. */
  | "published"
  /** The mirror publishes no dataset-level timestamp at all. */
  | "not_published"
  /** The metadata endpoint was asked and could not answer. */
  | "unreachable"
  /** Not waited on, so the answer would not be delayed by provenance. */
  | "not_waited";

/** One published timestamp, carrying the field it came from and its scope. */
export interface ZoningTimestamp {
  /** Published field the timestamp was read from. */
  field: string;
  /** ISO timestamp exactly as the mirror published it, or null when absent. */
  updatedAt: string | null;
  /** What the timestamp describes. */
  scope: "record" | "dataset";
}

/**
 * Freshness that ONE published mirror reports about itself.
 *
 * The two City mirrors do not measure the same thing and must not be collapsed
 * into a single "last updated" line. The ArcGIS feature layer publishes a
 * per-polygon `UPDATE_TIMESTAMP` and exposes no service-level `editingInfo`,
 * so it has record-scoped freshness only: it describes the one polygon
 * returned, not the dataset. The Data Portal mirror publishes a per-row
 * `edit_date` AND a dataset-level `rowsUpdatedAt` plus a curated "Time Period"
 * statement. `record` and `dataset` are therefore separate slots rather than
 * one field with a scope label: when the Data Portal answers it has both, and
 * making it pick one would publish a freshness the source never stated.
 */
export interface ZoningMirrorVintage {
  id: ZoningSourceMetadata["id"];
  label: string;
  /** What this mirror's point query did. */
  queryOutcome: ZoningMirrorQueryOutcome;
  /** Whether this mirror's dataset-wide freshness could be established. */
  datasetOutcome: ZoningMirrorDatasetOutcome;
  /**
   * Freshness of the polygon THIS mirror returned. Non-null only when this
   * mirror answered, so a record timestamp can never be attributed to a mirror
   * that did not produce the record.
   */
  record: ZoningTimestamp | null;
  /** Dataset-wide freshness THIS mirror publishes, when it publishes one. */
  dataset: ZoningTimestamp | null;
  /** What this mirror could and could not report for this lookup, and why. */
  note: string;
  /** Verbatim curated freshness statement, when the mirror publishes one. */
  statedTimePeriod?: string | null;
}

/** What the responding mirror actually established. */
export type ZoningAnswerKind =
  /** It returned a zoning polygon. */
  | "zoning"
  /** It successfully established that it publishes no polygon here. */
  | "no_zoning";

/**
 * Per-response provenance: which mirror produced this answer, when we asked,
 * and what each mirror says about its own freshness. Retrieval time is never
 * presented as a source-update date.
 */
export interface ZoningVintage {
  /** When this lookup ran. Not a source-update date. */
  retrievedAt: string;
  /**
   * Which mirror produced this response — the one that returned the polygon,
   * or, for a not_found, the one that authoritatively returned none. Null when
   * no mirror could answer. Always agrees with the response's `source`.
   */
  answeredBy: ZoningSourceMetadata["id"] | null;
  /**
   * What `answeredBy` established, so "answered by ArcGIS" is never ambiguous
   * between a returned polygon and a confirmed absence. Null when nothing was
   * established.
   */
  answerKind: ZoningAnswerKind | null;
  mirrors: ZoningMirrorVintage[];
  /** Why the mirror timestamps are not directly comparable. */
  comparabilityNote: string;
}

export interface ZoningAvailableResponse extends CityZoning {
  status: "available";
  source: ZoningSourceMetadata;
}

export interface ZoningNotFoundResponse {
  status: "not_found";
  zoneClass: null;
  zoneType: null;
  source: ZoningSourceMetadata;
  vintage?: ZoningVintage;
  message: string;
  zba?: ChicagoZbaLookupResponse;
}

export interface ZoningUnavailableResponse {
  status: "unavailable";
  zoneClass: null;
  zoneType: null;
  source: null;
  vintage?: ZoningVintage;
  message: string;
  zba?: ChicagoZbaLookupResponse;
}

export type ZoningLookupResponse =
  | ZoningAvailableResponse
  | ZoningNotFoundResponse
  | ZoningUnavailableResponse;

export type ChicagoZbaCaseType =
  | "special_use"
  | "variation"
  | "administrative_appeal"
  | "unknown";

export interface ChicagoZbaCase {
  id: string;
  globalId: string | null;
  caseReference: string | null;
  caseYear: number | null;
  caseSequence: number | null;
  caseType: ChicagoZbaCaseType;
  caseTypeRaw: string | null;
  address: string | null;
  judgment: string | null;
  description: string | null;
  pin10: string | null;
  pinAccuracy: string | null;
  publishedYearField: string | null;
  publishedCaseField: string | null;
}

export interface ChicagoZbaSourceMetadata {
  id: "chicago-zba-arcgis";
  label: string;
  url: string;
  boardUrl: string;
  retrievedAt: string;
  sourceUpdatedAt: null;
  freshnessNote: string;
}

export interface ChicagoZbaAvailableResponse {
  status: "available";
  cases: ChicagoZbaCase[];
  returnedCount: number;
  coverage: "complete" | "partial";
  source: ChicagoZbaSourceMetadata;
  message: string;
}

export interface ChicagoZbaNotFoundResponse {
  status: "not_found";
  cases: [];
  returnedCount: 0;
  coverage: "complete";
  source: ChicagoZbaSourceMetadata;
  message: string;
}

export interface ChicagoZbaUnavailableResponse {
  status: "unavailable";
  cases: [];
  source: ChicagoZbaSourceMetadata;
  message: string;
}

export type ChicagoZbaLookupResponse =
  | ChicagoZbaAvailableResponse
  | ChicagoZbaNotFoundResponse
  | ChicagoZbaUnavailableResponse;

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
  /** Source-separated parcel/building dimensions and their limited provenance. */
  space?: ParcelSpaceFacts;
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
  officials?: DistrictOfficials;
  sources?: DistrictSource[];
  refreshedAt?: string;
}

export interface DistrictOfficial {
  office: string;
  district: string;
  districtLabel: string;
  name: string;
  party?: string | null;
  phone?: string;
  email?: string;
  website?: string;
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  refreshedAt: string;
}

export interface DistrictOfficials {
  alderperson?: DistrictOfficial | null;
  commissioner?: DistrictOfficial | null;
  congressionalRepresentative?: DistrictOfficial | null;
  stateRepresentative?: DistrictOfficial | null;
  stateSenator?: DistrictOfficial | null;
}

export interface DistrictSource {
  id: string;
  label: string;
  url: string;
  refreshedAt: string;
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
  /**
   * Zone Evidence v2 cutover (build-spec.md 2.3; audit F2): layer keys whose
   * check could not be completed (source unavailable, malformed geometry, DB
   * layer missing) — NOT confirmed absent. `zones[key]` stays `false` for
   * these keys for backward compatibility with existing truthy-check
   * consumers (mirrors lib/zone-response.ts's NormalizedZoneCheck.unknownLayers
   * precedent from PR1). A negative summary MUST check this list before
   * asserting "not mapped"/"no zones found" — see report-engine's
   * buildKeyFindings and vacancy-site-zones's siteZonesSummary.
   */
  unknownZones?: string[];
  cityZoning?: CityZoning;
  cityZoningStatus?: ZoningLookupStatus;
  sector?: string; // user-selected business sector ID
  employment?: {
    censusTract: string;
    unemploymentRate: string; // e.g. "34.3%"
    population: number;
  };
  census?: CensusData;
  parcel?: ParcelData;
}

// review7 S21 (MEDIUM): `ZoneCheckResult` removed — it was the v1
// positives-only-array shape (`{key, name}`), used only by
// lib/data.ts's now-deleted, zero-caller `checkZonesAPI` function. See
// that removal's own comment for the full rationale.

export interface CommunityAsset {
  id: string;
  name: string;
  type: "EDO" | "BSO" | "university" | "library";
  address: string;
  lat: number;
  lon: number;
}

/* ── Pre-Qualification Survey ── */

export interface MatchTransparencyContact {
  agency: string;
  abbreviation?: string;
  phone?: string;
  email?: string;
  url?: string;
  role?: string;
}

export interface MatchTransparencySource {
  label: string;
  url: string;
}

/** Public explanation only. Internal rank and confidence never cross this boundary. */
export interface PublicMatchExplanation {
  whyItAppears: string[];
  knownFromPublicData: string[];
  basedOnUserAnswers: string[];
  stillToConfirm: string[];
  currentDocumentsToGather: string[];
  confirmWith: MatchTransparencyContact[];
  officialSource?: MatchTransparencySource;
  lastVerifiedAt?: string | null;
}

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
  program: { name: string; short: string; level: string };
  explanation: PublicMatchExplanation;
  /**
   * build-spec.md 2.6 (audit F12): status shown in the COLLAPSED row, not
   * only inside the expanded detail — a lapsed program must never surface
   * looking identical to an open one before the card is opened.
   */
  status: {
    intakeStatus: IntakeStatus;
    /** Short label for the collapsed row, e.g. "Lapsed", "Closed", "Open". */
    label: string;
  };
}

export interface SurveyResult {
  /** Answer-derived matches (never includes the always-present universal entry). */
  matches: ProgramMatch[];
  /**
   * build-spec.md 2.6: universal navigation (Small Business Source) shown
   * separately from answer-derived matches — it is not a consequence of
   * anything the user answered, and mixing it into `matches` implied it was.
   */
  universal: ProgramMatch[];
  /** Answer keys (e.g. "industry", "activities:hiring") that changed the result. */
  usedAnswers: string[];
  /**
   * Answer keys given but with no catalog rule behind them — build-spec.md
   * 2.6's honesty requirement: "No catalog rule currently uses this answer
   * to order programs." Empty today (the inert options were removed), but
   * the mechanism stays general so a future added option without a rule is
   * caught and disclosed rather than silently doing nothing.
   */
  unusedAnswers: string[];
}

/* ── Executive Summary (for reports) ── */

export interface ExecutiveSummary {
  topPrograms: {
    programId: string;
    name: string;
    explanation: PublicMatchExplanation;
  }[];
  topActions: TopAction[];
  zoneCount: number;
  whyTheseMatter: string;
  projectGoalLabel?: string;
  projectGoalLabels?: string[];
}
