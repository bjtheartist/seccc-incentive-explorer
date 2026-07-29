/**
 * Deterministic ingestion for SBA Restaurant Revitalization Fund awards.
 *
 * RRF was an American Rescue Plan grant program. These records describe
 * historical disbursements; they are not active opportunities or estimates of
 * funding available to another project.
 */

export const SBA_RRF_DATASET_URL =
  "https://data.sba.gov/dataset/rrf-foia";

export const SBA_RRF_CSV_URL =
  "https://data.sba.gov/sites/default/files/distribution/SBA-OCA-2022-09-001/rrf_foia.csv";

export const SBA_RRF_LEGACY_CSV_URL =
  "https://data.sba.gov/dataset/8a57ad77-fcda-4272-8020-754f1cf3607b/resource/611f26df-0de0-427d-adb1-3bb91c8e8846/download/rrf_foia.csv";

export const SBA_RRF_SOURCE_VERSION = "2024-10-21";

export const SBA_RRF_CLASSIFICATION = {
  programName: "Restaurant Revitalization Fund",
  programSlug: "sba-restaurant-revitalization-fund",
  fundingLaw: "American Rescue Plan Act of 2021",
  assistanceType: "grant",
  programState: "closed_historical_award",
  opportunityStatus: "not_active",
  amountContext: "historical_disbursed_grant",
} as const;

export const SBA_RRF_EXPECTED_SOURCE_HEADERS = [
  "LoanNumber",
  "ApprovalDate",
  "BusinessName",
  "BusinessAddress",
  "BusinessCity",
  "BusinessState",
  "BusinessZip",
  "GrantAmount",
  "FranchiseName",
  "RuralUrbanIndicator",
  "HubzoneIndicator",
  "CD",
  "grant_purp_cons_outdoor_seating",
  "grant_purpose_covered_supplier",
  "grant_purpose_debt",
  "grant_purpose_food",
  "grant_purpose_maintenance_indoor",
  "grant_purpose_operations",
  "grant_purpose_payroll",
  "grant_purpose_rent",
  "grant_purpose_supplies",
  "grant_purpose_utility",
  "LegalOrganizationType",
  "LMIIndicator",
  "SocioeconmicIndicator",
  "VeteranIndicator",
  "WomenOwnedIndicator",
  "RestaurantType",
] as const;

export const SBA_RRF_FULL_SOURCE_EXPECTATIONS = {
  sourceVersion: SBA_RRF_SOURCE_VERSION,
  sourceRowCount: 100_828,
  chicagoRecordCount: 1_523,
  sourceGrantTotalUsd: 28_613_037_362.99,
  chicagoGrantTotalUsd: 734_658_575.69,
  warningCount: 1,
} as const;

export type SbaRrfLocationPrecision =
  | "published_street_address_ungeocoded"
  | "published_zip_ungeocoded"
  | "published_city_ungeocoded";

export interface SbaRestaurantRevitalizationRecord {
  recordId: string;
  sbaLoanNumber: string;
  approvalDate: string | null;
  sourceApprovalDate: string;
  legalBusinessName: string;
  sourceBusinessName: string;
  dbaTradeName: string | null;
  franchiseName: string | null;
  publishedStreetAddress: string | null;
  publishedCity: string;
  publishedState: string;
  publishedZip: string | null;
  locationPrecision: SbaRrfLocationPrecision;
  grantAmountUsd: number;
  ruralUrbanIndicator: string | null;
  hubzoneIndicator: string | null;
  congressionalDistrict: string | null;
  grantPurposeConstructionOutdoorSeating: string | null;
  grantPurposeCoveredSupplier: string | null;
  grantPurposeDebt: string | null;
  grantPurposeFood: string | null;
  grantPurposeMaintenanceIndoor: string | null;
  grantPurposeOperations: string | null;
  grantPurposePayroll: string | null;
  grantPurposeRent: string | null;
  grantPurposeSupplies: string | null;
  grantPurposeUtility: string | null;
  legalOrganizationType: string | null;
  lmiIndicator: string | null;
  socioeconomicIndicator: string | null;
  veteranIndicator: string | null;
  womenOwnedIndicator: string | null;
  restaurantType: string | null;
  sourceUrl: string;
  sourceDownloadUrl: string;
  sourceVersion: string;
}

export type SbaRestaurantRevitalizationIssueSeverity = "error" | "warning";

export type SbaRestaurantRevitalizationIssueCode =
  | "malformed_csv"
  | "blank_row"
  | "column_count_mismatch"
  | "missing_filter_value"
  | "missing_loan_number"
  | "duplicate_loan_number"
  | "invalid_grant_amount"
  | "missing_business_name"
  | "invalid_approval_date"
  | "missing_published_address"
  | "invalid_published_zip";

export interface SbaRestaurantRevitalizationIssue {
  severity: SbaRestaurantRevitalizationIssueSeverity;
  code: SbaRestaurantRevitalizationIssueCode;
  sourceRow: number;
  sourceLine: number;
  field: string | null;
  value: string | null;
  message: string;
}

export interface ParseSbaRestaurantRevitalizationOptions {
  sourceUrl?: string;
  sourceDownloadUrl?: string;
  sourceVersion?: string;
}

export interface SbaRestaurantRevitalizationParseResult {
  records: SbaRestaurantRevitalizationRecord[];
  issues: SbaRestaurantRevitalizationIssue[];
  sourceVersion: string;
  sourceUrl: string;
  sourceDownloadUrl: string;
  sourceRowCount: number;
  excludedRowCount: number;
  skippedChicagoRowCount: number;
  sourceGrantTotalUsd: number;
}

export interface SbaRestaurantRevitalizationSummary {
  sourceRowCount: number;
  chicagoRecordCount: number;
  excludedRowCount: number;
  skippedChicagoRowCount: number;
  sourceGrantTotalUsd: number;
  chicagoGrantTotalUsd: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
}

export interface SbaRestaurantRevitalizationExpectations {
  sourceVersion?: string;
  sourceRowCount?: number;
  chicagoRecordCount?: number;
  sourceGrantTotalUsd?: number;
  chicagoGrantTotalUsd?: number;
  warningCount?: number;
  allowIssues?: boolean;
}

interface CsvRow {
  values: string[];
  sourceLine: number;
}

interface ParsedCsv {
  rows: CsvRow[];
  issues: SbaRestaurantRevitalizationIssue[];
}

interface SourceSchema {
  loanNumber: number;
  approvalDate: number;
  sourceBusinessName: number | null;
  legalBusinessName: number;
  dbaTradeName: number | null;
  businessAddress: number;
  businessCity: number;
  businessState: number;
  businessZip: number;
  grantAmount: number;
  franchiseName: number;
  ruralUrbanIndicator: number;
  hubzoneIndicator: number;
  congressionalDistrict: number;
  grantPurposeConstructionOutdoorSeating: number;
  grantPurposeCoveredSupplier: number;
  grantPurposeDebt: number;
  grantPurposeFood: number;
  grantPurposeMaintenanceIndoor: number;
  grantPurposeOperations: number;
  grantPurposePayroll: number;
  grantPurposeRent: number;
  grantPurposeSupplies: number;
  grantPurposeUtility: number;
  legalOrganizationType: number;
  lmiIndicator: number;
  socioeconomicIndicator: number;
  veteranIndicator: number;
  womenOwnedIndicator: number;
  restaurantType: number;
}

const HEADER_ALIASES = {
  loanNumber: ["LoanNumber", "Loan Number", "SBA Loan Number"],
  approvalDate: ["ApprovalDate", "Approval Date"],
  sourceBusinessName: ["BusinessName", "Business Name"],
  legalBusinessName: [
    "LegalBusinessName",
    "Legal Business Name",
    "BusinessLegalName",
    "Business Legal Name",
  ],
  dbaTradeName: [
    "DBA",
    "DBAName",
    "DBA Name",
    "DBATradeName",
    "DBA Trade Name",
    "DBAorTradeName",
    "DBA or Trade Name",
    "TradeName",
    "Trade Name",
  ],
  businessAddress: ["BusinessAddress", "Business Address"],
  businessCity: ["BusinessCity", "Business City"],
  businessState: ["BusinessState", "Business State"],
  businessZip: ["BusinessZip", "Business Zip", "Business ZIP"],
  grantAmount: ["GrantAmount", "Grant Amount"],
  franchiseName: ["FranchiseName", "Franchise Name"],
  ruralUrbanIndicator: ["RuralUrbanIndicator", "Rural Urban Indicator"],
  hubzoneIndicator: ["HubzoneIndicator", "HUBZoneIndicator", "Hubzone Indicator"],
  congressionalDistrict: ["CD", "CongressionalDistrict", "Congressional District"],
  grantPurposeConstructionOutdoorSeating: [
    "grant_purp_cons_outdoor_seating",
    "grant_purpose_cons_outdoor_seating",
  ],
  grantPurposeCoveredSupplier: ["grant_purpose_covered_supplier"],
  grantPurposeDebt: ["grant_purpose_debt"],
  grantPurposeFood: ["grant_purpose_food"],
  grantPurposeMaintenanceIndoor: ["grant_purpose_maintenance_indoor"],
  grantPurposeOperations: ["grant_purpose_operations"],
  grantPurposePayroll: ["grant_purpose_payroll"],
  grantPurposeRent: ["grant_purpose_rent"],
  grantPurposeSupplies: ["grant_purpose_supplies"],
  grantPurposeUtility: ["grant_purpose_utility"],
  legalOrganizationType: ["LegalOrganizationType", "Legal Organization Type"],
  lmiIndicator: ["LMIIndicator", "LMI Indicator"],
  socioeconomicIndicator: [
    "SocioeconmicIndicator",
    "SocioeconomicIndicator",
    "Socioeconomic Indicator",
  ],
  veteranIndicator: ["VeteranIndicator", "Veteran Indicator"],
  womenOwnedIndicator: ["WomenOwnedIndicator", "Women Owned Indicator"],
  restaurantType: ["RestaurantType", "Restaurant Type"],
} as const;

function canonicalHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optionalSourceValue(row: string[], index: number | null): string | null {
  if (index == null) return null;
  const value = row[index]?.trim() ?? "";
  return value || null;
}

function requiredSourceValue(row: string[], index: number): string {
  return row[index]?.trim() ?? "";
}

function issue(
  issues: SbaRestaurantRevitalizationIssue[],
  details: SbaRestaurantRevitalizationIssue,
): void {
  issues.push(details);
}

function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, "");
  if (!text.trim()) {
    throw new SbaRestaurantRevitalizationParseError(
      "SBA RRF CSV is empty.",
    );
  }

  const rows: CsvRow[] = [];
  const issues: SbaRestaurantRevitalizationIssue[] = [];
  let values: string[] = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;
  let line = 1;
  let rowStartLine = 1;

  const finishField = () => {
    values.push(field);
    field = "";
    justClosedQuote = false;
  };

  const finishRow = () => {
    finishField();
    rows.push({ values, sourceLine: rowStartLine });
    values = [];
    rowStartLine = line;
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else if (character === "\r") {
        if (text[index + 1] === "\n") index++;
        field += "\n";
        line++;
      } else {
        field += character;
        if (character === "\n") line++;
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === " " || character === "\t") continue;
      if (character === ",") {
        finishField();
        continue;
      }
      if (character === "\r" || character === "\n") {
        if (character === "\r" && text[index + 1] === "\n") index++;
        finishRow();
        line++;
        rowStartLine = line;
        continue;
      }

      issue(issues, {
        severity: "error",
        code: "malformed_csv",
        sourceRow: rows.length + 1,
        sourceLine: line,
        field: null,
        value: character,
        message: "Unexpected character after a closing CSV quote.",
      });
      justClosedQuote = false;
      field += character;
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      continue;
    }
    if (character === '"') {
      issue(issues, {
        severity: "error",
        code: "malformed_csv",
        sourceRow: rows.length + 1,
        sourceLine: line,
        field: null,
        value: field,
        message: "Unexpected quote inside an unquoted CSV field.",
      });
      field += character;
      continue;
    }
    if (character === ",") {
      finishField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      finishRow();
      line++;
      rowStartLine = line;
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    issue(issues, {
      severity: "error",
      code: "malformed_csv",
      sourceRow: rows.length + 1,
      sourceLine: rowStartLine,
      field: null,
      value: field.slice(0, 200),
      message: "CSV ended inside a quoted field.",
    });
  }

  if (field.length > 0 || values.length > 0 || justClosedQuote) finishRow();
  return { rows, issues };
}

function resolveHeader(
  headerIndexes: Map<string, number>,
  aliases: readonly string[],
): number | null {
  for (const alias of aliases) {
    const index = headerIndexes.get(canonicalHeader(alias));
    if (index != null) return index;
  }
  return null;
}

function requireHeader(
  headerIndexes: Map<string, number>,
  aliases: readonly string[],
  displayName: string,
): number {
  const index = resolveHeader(headerIndexes, aliases);
  if (index == null) {
    throw new SbaRestaurantRevitalizationParseError(
      `SBA RRF CSV is missing required header: ${displayName}.`,
    );
  }
  return index;
}

function resolveSourceSchema(headers: string[]): SourceSchema {
  const headerIndexes = new Map<string, number>();
  for (let index = 0; index < headers.length; index++) {
    const canonical = canonicalHeader(headers[index]);
    if (!canonical) {
      throw new SbaRestaurantRevitalizationParseError(
        `SBA RRF CSV contains an empty header at column ${index + 1}.`,
      );
    }
    if (headerIndexes.has(canonical)) {
      throw new SbaRestaurantRevitalizationParseError(
        `SBA RRF CSV contains duplicate header: ${headers[index]}.`,
      );
    }
    headerIndexes.set(canonical, index);
  }

  const sourceBusinessName = resolveHeader(
    headerIndexes,
    HEADER_ALIASES.sourceBusinessName,
  );
  const explicitLegalBusinessName = resolveHeader(
    headerIndexes,
    HEADER_ALIASES.legalBusinessName,
  );
  if (sourceBusinessName == null && explicitLegalBusinessName == null) {
    throw new SbaRestaurantRevitalizationParseError(
      "SBA RRF CSV is missing a BusinessName or LegalBusinessName header.",
    );
  }

  return {
    loanNumber: requireHeader(headerIndexes, HEADER_ALIASES.loanNumber, "LoanNumber"),
    approvalDate: requireHeader(
      headerIndexes,
      HEADER_ALIASES.approvalDate,
      "ApprovalDate",
    ),
    sourceBusinessName,
    legalBusinessName: explicitLegalBusinessName ?? sourceBusinessName!,
    dbaTradeName: resolveHeader(headerIndexes, HEADER_ALIASES.dbaTradeName),
    businessAddress: requireHeader(
      headerIndexes,
      HEADER_ALIASES.businessAddress,
      "BusinessAddress",
    ),
    businessCity: requireHeader(
      headerIndexes,
      HEADER_ALIASES.businessCity,
      "BusinessCity",
    ),
    businessState: requireHeader(
      headerIndexes,
      HEADER_ALIASES.businessState,
      "BusinessState",
    ),
    businessZip: requireHeader(
      headerIndexes,
      HEADER_ALIASES.businessZip,
      "BusinessZip",
    ),
    grantAmount: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantAmount,
      "GrantAmount",
    ),
    franchiseName: requireHeader(
      headerIndexes,
      HEADER_ALIASES.franchiseName,
      "FranchiseName",
    ),
    ruralUrbanIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.ruralUrbanIndicator,
      "RuralUrbanIndicator",
    ),
    hubzoneIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.hubzoneIndicator,
      "HubzoneIndicator",
    ),
    congressionalDistrict: requireHeader(
      headerIndexes,
      HEADER_ALIASES.congressionalDistrict,
      "CD",
    ),
    grantPurposeConstructionOutdoorSeating: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeConstructionOutdoorSeating,
      "grant_purp_cons_outdoor_seating",
    ),
    grantPurposeCoveredSupplier: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeCoveredSupplier,
      "grant_purpose_covered_supplier",
    ),
    grantPurposeDebt: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeDebt,
      "grant_purpose_debt",
    ),
    grantPurposeFood: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeFood,
      "grant_purpose_food",
    ),
    grantPurposeMaintenanceIndoor: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeMaintenanceIndoor,
      "grant_purpose_maintenance_indoor",
    ),
    grantPurposeOperations: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeOperations,
      "grant_purpose_operations",
    ),
    grantPurposePayroll: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposePayroll,
      "grant_purpose_payroll",
    ),
    grantPurposeRent: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeRent,
      "grant_purpose_rent",
    ),
    grantPurposeSupplies: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeSupplies,
      "grant_purpose_supplies",
    ),
    grantPurposeUtility: requireHeader(
      headerIndexes,
      HEADER_ALIASES.grantPurposeUtility,
      "grant_purpose_utility",
    ),
    legalOrganizationType: requireHeader(
      headerIndexes,
      HEADER_ALIASES.legalOrganizationType,
      "LegalOrganizationType",
    ),
    lmiIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.lmiIndicator,
      "LMIIndicator",
    ),
    socioeconomicIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.socioeconomicIndicator,
      "SocioeconmicIndicator",
    ),
    veteranIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.veteranIndicator,
      "VeteranIndicator",
    ),
    womenOwnedIndicator: requireHeader(
      headerIndexes,
      HEADER_ALIASES.womenOwnedIndicator,
      "WomenOwnedIndicator",
    ),
    restaurantType: requireHeader(
      headerIndexes,
      HEADER_ALIASES.restaurantType,
      "RestaurantType",
    ),
  };
}

function parseUsdCents(value: string): number | null {
  const normalized = value.trim();
  const match = normalized.match(
    /^\$?\s*((?:\d+|\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/,
  );
  if (!match) return null;

  const whole = Number(match[1].replace(/,/g, ""));
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function parseSbaRrfUsdAmount(value: string): number | null {
  const cents = parseUsdCents(value);
  return cents == null ? null : cents / 100;
}

function amountToCents(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Dollar amount exceeds safe precision: ${value}`);
  }
  return cents;
}

function parseApprovalDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isExplicitChicagoIllinois(city: string, state: string): boolean {
  const normalizedCity = city.trim().toUpperCase();
  const normalizedState = state.trim().toUpperCase();
  return (
    normalizedCity === "CHICAGO" &&
    (normalizedState === "IL" || normalizedState === "ILLINOIS")
  );
}

function locationPrecision(
  streetAddress: string | null,
  zip: string | null,
): SbaRrfLocationPrecision {
  if (streetAddress) return "published_street_address_ungeocoded";
  if (zip) return "published_zip_ungeocoded";
  return "published_city_ungeocoded";
}

function sortRecords(
  records: readonly SbaRestaurantRevitalizationRecord[],
): SbaRestaurantRevitalizationRecord[] {
  return [...records].sort(
    (left, right) =>
      compareText(left.sbaLoanNumber, right.sbaLoanNumber) ||
      compareText(left.legalBusinessName, right.legalBusinessName) ||
      compareText(
        left.publishedStreetAddress ?? "",
        right.publishedStreetAddress ?? "",
      ) ||
      left.grantAmountUsd - right.grantAmountUsd,
  );
}

export class SbaRestaurantRevitalizationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbaRestaurantRevitalizationParseError";
  }
}

export function parseSbaRestaurantRevitalizationCsv(
  csv: string,
  options: ParseSbaRestaurantRevitalizationOptions = {},
): SbaRestaurantRevitalizationParseResult {
  const sourceVersion = options.sourceVersion ?? SBA_RRF_SOURCE_VERSION;
  const sourceUrl = options.sourceUrl ?? SBA_RRF_DATASET_URL;
  const sourceDownloadUrl = options.sourceDownloadUrl ?? SBA_RRF_CSV_URL;
  if (!sourceVersion.trim()) {
    throw new SbaRestaurantRevitalizationParseError(
      "SBA RRF source version must not be empty.",
    );
  }

  const parsed = parseCsv(csv);
  if (parsed.rows.length === 0) {
    throw new SbaRestaurantRevitalizationParseError(
      "SBA RRF CSV did not contain a header row.",
    );
  }

  const headers = parsed.rows[0].values.map((header) =>
    header.replace(/^\uFEFF/, "").trim(),
  );
  const schema = resolveSourceSchema(headers);
  const issues = [...parsed.issues];
  const records: SbaRestaurantRevitalizationRecord[] = [];
  const loanNumbers = new Set<string>();
  let sourceGrantTotalCents = 0;
  let sourceRowCount = 0;
  let excludedRowCount = 0;
  let skippedChicagoRowCount = 0;

  for (let index = 1; index < parsed.rows.length; index++) {
    const source = parsed.rows[index];
    const sourceRow = index + 1;
    if (source.values.length === 1 && source.values[0].trim() === "") {
      issue(issues, {
        severity: "warning",
        code: "blank_row",
        sourceRow,
        sourceLine: source.sourceLine,
        field: null,
        value: null,
        message: "Blank CSV row was ignored.",
      });
      continue;
    }

    sourceRowCount++;
    if (source.values.length !== headers.length) {
      issue(issues, {
        severity: "error",
        code: "column_count_mismatch",
        sourceRow,
        sourceLine: source.sourceLine,
        field: null,
        value: String(source.values.length),
        message: `Expected ${headers.length} columns but parsed ${source.values.length}.`,
      });
    }

    const loanNumber = requiredSourceValue(source.values, schema.loanNumber);
    const city = requiredSourceValue(source.values, schema.businessCity);
    const state = requiredSourceValue(source.values, schema.businessState);
    const rawAmount = requiredSourceValue(source.values, schema.grantAmount);
    const amountCents = parseUsdCents(rawAmount);
    const duplicateLoanNumber =
      loanNumber.length > 0 && loanNumbers.has(loanNumber);

    if (!loanNumber) {
      issue(issues, {
        severity: "error",
        code: "missing_loan_number",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.loanNumber],
        value: null,
        message: "SBA loan number is required for stable award identity.",
      });
    } else if (duplicateLoanNumber) {
      issue(issues, {
        severity: "error",
        code: "duplicate_loan_number",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.loanNumber],
        value: loanNumber,
        message: "Duplicate SBA loan number was not imported twice.",
      });
    } else {
      loanNumbers.add(loanNumber);
    }

    if (amountCents == null) {
      issue(issues, {
        severity: "error",
        code: "invalid_grant_amount",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.grantAmount],
        value: rawAmount || null,
        message: "Grant amount is missing or not a valid non-negative USD amount.",
      });
    } else {
      sourceGrantTotalCents += amountCents;
    }

    if (!city || !state) {
      issue(issues, {
        severity: "warning",
        code: "missing_filter_value",
        sourceRow,
        sourceLine: source.sourceLine,
        field: !city ? headers[schema.businessCity] : headers[schema.businessState],
        value: null,
        message:
          "City and state are required to make the explicit Chicago, Illinois filter.",
      });
      excludedRowCount++;
      continue;
    }

    if (!isExplicitChicagoIllinois(city, state)) {
      excludedRowCount++;
      continue;
    }

    if (!loanNumber || duplicateLoanNumber || amountCents == null) {
      skippedChicagoRowCount++;
      continue;
    }

    const sourceBusinessName =
      optionalSourceValue(source.values, schema.sourceBusinessName) ?? "";
    const legalBusinessName = requiredSourceValue(
      source.values,
      schema.legalBusinessName,
    );
    if (!legalBusinessName) {
      issue(issues, {
        severity: "error",
        code: "missing_business_name",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.legalBusinessName],
        value: null,
        message: "Chicago award is missing its published business name.",
      });
      skippedChicagoRowCount++;
      continue;
    }

    const sourceApprovalDate = requiredSourceValue(
      source.values,
      schema.approvalDate,
    );
    const approvalDate = parseApprovalDate(sourceApprovalDate);
    if (!approvalDate) {
      issue(issues, {
        severity: "warning",
        code: "invalid_approval_date",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.approvalDate],
        value: sourceApprovalDate || null,
        message:
          "Approval date was preserved as published but could not be normalized to ISO format.",
      });
    }

    const publishedStreetAddress =
      optionalSourceValue(source.values, schema.businessAddress);
    if (!publishedStreetAddress) {
      issue(issues, {
        severity: "warning",
        code: "missing_published_address",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.businessAddress],
        value: null,
        message:
          "No street address was published; the record remains ungeocoded and must not receive an inferred point.",
      });
    }

    const publishedZip = optionalSourceValue(source.values, schema.businessZip);
    if (publishedZip && !/^\d{5}(?:-\d{4})?$/.test(publishedZip)) {
      issue(issues, {
        severity: "warning",
        code: "invalid_published_zip",
        sourceRow,
        sourceLine: source.sourceLine,
        field: headers[schema.businessZip],
        value: publishedZip,
        message:
          "Published ZIP was preserved but is not a five-digit or ZIP+4 value.",
      });
    }

    records.push({
      recordId: `sba-rrf-${loanNumber}`,
      sbaLoanNumber: loanNumber,
      approvalDate,
      sourceApprovalDate,
      legalBusinessName,
      sourceBusinessName: sourceBusinessName || legalBusinessName,
      dbaTradeName: optionalSourceValue(source.values, schema.dbaTradeName),
      franchiseName: optionalSourceValue(source.values, schema.franchiseName),
      publishedStreetAddress,
      publishedCity: city,
      publishedState: state,
      publishedZip,
      locationPrecision: locationPrecision(publishedStreetAddress, publishedZip),
      grantAmountUsd: amountCents / 100,
      ruralUrbanIndicator: optionalSourceValue(
        source.values,
        schema.ruralUrbanIndicator,
      ),
      hubzoneIndicator: optionalSourceValue(
        source.values,
        schema.hubzoneIndicator,
      ),
      congressionalDistrict: optionalSourceValue(
        source.values,
        schema.congressionalDistrict,
      ),
      grantPurposeConstructionOutdoorSeating: optionalSourceValue(
        source.values,
        schema.grantPurposeConstructionOutdoorSeating,
      ),
      grantPurposeCoveredSupplier: optionalSourceValue(
        source.values,
        schema.grantPurposeCoveredSupplier,
      ),
      grantPurposeDebt: optionalSourceValue(
        source.values,
        schema.grantPurposeDebt,
      ),
      grantPurposeFood: optionalSourceValue(
        source.values,
        schema.grantPurposeFood,
      ),
      grantPurposeMaintenanceIndoor: optionalSourceValue(
        source.values,
        schema.grantPurposeMaintenanceIndoor,
      ),
      grantPurposeOperations: optionalSourceValue(
        source.values,
        schema.grantPurposeOperations,
      ),
      grantPurposePayroll: optionalSourceValue(
        source.values,
        schema.grantPurposePayroll,
      ),
      grantPurposeRent: optionalSourceValue(
        source.values,
        schema.grantPurposeRent,
      ),
      grantPurposeSupplies: optionalSourceValue(
        source.values,
        schema.grantPurposeSupplies,
      ),
      grantPurposeUtility: optionalSourceValue(
        source.values,
        schema.grantPurposeUtility,
      ),
      legalOrganizationType: optionalSourceValue(
        source.values,
        schema.legalOrganizationType,
      ),
      lmiIndicator: optionalSourceValue(source.values, schema.lmiIndicator),
      socioeconomicIndicator: optionalSourceValue(
        source.values,
        schema.socioeconomicIndicator,
      ),
      veteranIndicator: optionalSourceValue(
        source.values,
        schema.veteranIndicator,
      ),
      womenOwnedIndicator: optionalSourceValue(
        source.values,
        schema.womenOwnedIndicator,
      ),
      restaurantType: optionalSourceValue(source.values, schema.restaurantType),
      sourceUrl,
      sourceDownloadUrl,
      sourceVersion,
    });
  }

  return {
    records: sortRecords(records),
    issues,
    sourceVersion,
    sourceUrl,
    sourceDownloadUrl,
    sourceRowCount,
    excludedRowCount,
    skippedChicagoRowCount,
    sourceGrantTotalUsd: sourceGrantTotalCents / 100,
  };
}

export function summarizeSbaRestaurantRevitalization(
  result: SbaRestaurantRevitalizationParseResult,
): SbaRestaurantRevitalizationSummary {
  const chicagoGrantTotalCents = result.records.reduce(
    (total, record) => total + amountToCents(record.grantAmountUsd),
    0,
  );
  return {
    sourceRowCount: result.sourceRowCount,
    chicagoRecordCount: result.records.length,
    excludedRowCount: result.excludedRowCount,
    skippedChicagoRowCount: result.skippedChicagoRowCount,
    sourceGrantTotalUsd: result.sourceGrantTotalUsd,
    chicagoGrantTotalUsd: chicagoGrantTotalCents / 100,
    issueCount: result.issues.length,
    errorCount: result.issues.filter((item) => item.severity === "error").length,
    warningCount: result.issues.filter((item) => item.severity === "warning")
      .length,
  };
}

export class SbaRestaurantRevitalizationIntegrityError extends Error {
  constructor(
    message: string,
    readonly summary: SbaRestaurantRevitalizationSummary,
  ) {
    super(message);
    this.name = "SbaRestaurantRevitalizationIntegrityError";
  }
}

export function assertSbaRestaurantRevitalizationIntegrity(
  result: SbaRestaurantRevitalizationParseResult,
  expectations: SbaRestaurantRevitalizationExpectations =
    SBA_RRF_FULL_SOURCE_EXPECTATIONS,
): SbaRestaurantRevitalizationSummary {
  const summary = summarizeSbaRestaurantRevitalization(result);
  const problems: string[] = [];

  if (!expectations.allowIssues && summary.errorCount > 0) {
    problems.push(
      `${summary.errorCount} parser error(s)`,
    );
  }
  if (
    !expectations.allowIssues &&
    expectations.warningCount == null &&
    summary.warningCount > 0
  ) {
    problems.push(`${summary.warningCount} parser warning(s)`);
  }
  if (
    expectations.warningCount != null &&
    summary.warningCount !== expectations.warningCount
  ) {
    problems.push(
      `expected ${expectations.warningCount} parser warning(s), parsed ${summary.warningCount}`,
    );
  }
  if (
    expectations.sourceVersion != null &&
    result.sourceVersion !== expectations.sourceVersion
  ) {
    problems.push(
      `expected source version ${expectations.sourceVersion}, parsed ${result.sourceVersion}`,
    );
  }
  if (
    expectations.sourceRowCount != null &&
    summary.sourceRowCount !== expectations.sourceRowCount
  ) {
    problems.push(
      `expected ${expectations.sourceRowCount.toLocaleString("en-US")} source rows, parsed ${summary.sourceRowCount.toLocaleString("en-US")}`,
    );
  }
  if (
    expectations.chicagoRecordCount != null &&
    summary.chicagoRecordCount !== expectations.chicagoRecordCount
  ) {
    problems.push(
      `expected ${expectations.chicagoRecordCount.toLocaleString("en-US")} Chicago records, parsed ${summary.chicagoRecordCount.toLocaleString("en-US")}`,
    );
  }
  if (
    expectations.sourceGrantTotalUsd != null &&
    amountToCents(summary.sourceGrantTotalUsd) !==
      amountToCents(expectations.sourceGrantTotalUsd)
  ) {
    problems.push(
      `expected ${formatUsd(expectations.sourceGrantTotalUsd)} in source grants, parsed ${formatUsd(summary.sourceGrantTotalUsd)}`,
    );
  }
  if (
    expectations.chicagoGrantTotalUsd != null &&
    amountToCents(summary.chicagoGrantTotalUsd) !==
      amountToCents(expectations.chicagoGrantTotalUsd)
  ) {
    problems.push(
      `expected ${formatUsd(expectations.chicagoGrantTotalUsd)} in Chicago grants, parsed ${formatUsd(summary.chicagoGrantTotalUsd)}`,
    );
  }

  if (problems.length > 0) {
    throw new SbaRestaurantRevitalizationIntegrityError(
      `SBA RRF integrity check failed: ${problems.join("; ")}.`,
      summary,
    );
  }
  return summary;
}

function csvEscape(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatUsdValue(value: number): string {
  return (amountToCents(value) / 100).toFixed(2);
}

function formatUsd(value: number): string {
  return `$${formatUsdValue(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function serializeSbaRestaurantRevitalizationCsv(
  records: readonly SbaRestaurantRevitalizationRecord[],
): string {
  const headers = [
    "record_id",
    "program_name",
    "program_slug",
    "funding_law",
    "assistance_type",
    "program_state",
    "opportunity_status",
    "amount_context",
    "sba_loan_number",
    "approval_date",
    "source_approval_date",
    "legal_business_name",
    "source_business_name",
    "dba_trade_name",
    "franchise_name",
    "published_street_address",
    "published_city",
    "published_state",
    "published_zip",
    "location_precision",
    "grant_amount_usd",
    "rural_urban_indicator",
    "hubzone_indicator",
    "congressional_district",
    "grant_purp_cons_outdoor_seating",
    "grant_purpose_covered_supplier",
    "grant_purpose_debt",
    "grant_purpose_food",
    "grant_purpose_maintenance_indoor",
    "grant_purpose_operations",
    "grant_purpose_payroll",
    "grant_purpose_rent",
    "grant_purpose_supplies",
    "grant_purpose_utility",
    "legal_organization_type",
    "lmi_indicator",
    "socioeconomic_indicator",
    "veteran_indicator",
    "women_owned_indicator",
    "restaurant_type",
    "source_url",
    "source_download_url",
    "source_version",
  ];

  const rows = sortRecords(records).map((record) =>
    [
      record.recordId,
      SBA_RRF_CLASSIFICATION.programName,
      SBA_RRF_CLASSIFICATION.programSlug,
      SBA_RRF_CLASSIFICATION.fundingLaw,
      SBA_RRF_CLASSIFICATION.assistanceType,
      SBA_RRF_CLASSIFICATION.programState,
      SBA_RRF_CLASSIFICATION.opportunityStatus,
      SBA_RRF_CLASSIFICATION.amountContext,
      record.sbaLoanNumber,
      record.approvalDate,
      record.sourceApprovalDate,
      record.legalBusinessName,
      record.sourceBusinessName,
      record.dbaTradeName,
      record.franchiseName,
      record.publishedStreetAddress,
      record.publishedCity,
      record.publishedState,
      record.publishedZip,
      record.locationPrecision,
      formatUsdValue(record.grantAmountUsd),
      record.ruralUrbanIndicator,
      record.hubzoneIndicator,
      record.congressionalDistrict,
      record.grantPurposeConstructionOutdoorSeating,
      record.grantPurposeCoveredSupplier,
      record.grantPurposeDebt,
      record.grantPurposeFood,
      record.grantPurposeMaintenanceIndoor,
      record.grantPurposeOperations,
      record.grantPurposePayroll,
      record.grantPurposeRent,
      record.grantPurposeSupplies,
      record.grantPurposeUtility,
      record.legalOrganizationType,
      record.lmiIndicator,
      record.socioeconomicIndicator,
      record.veteranIndicator,
      record.womenOwnedIndicator,
      record.restaurantType,
      record.sourceUrl,
      record.sourceDownloadUrl,
      record.sourceVersion,
    ]
      .map(csvEscape)
      .join(","),
  );

  return `${[headers.join(","), ...rows].join("\n")}\n`;
}
