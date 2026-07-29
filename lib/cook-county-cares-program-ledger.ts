export const COOK_COUNTY_CARES_IMPACT_REPORT_URL =
  "https://www.cookcountyil.gov/sites/g/files/ywwepo161/files/cook_county_2020_community_recovery_initiative_impact_report_0.pdf";

export const COOK_COUNTY_CARES_IMPACT_RELEASE_URL =
  "https://www.cookcountyil.gov/news/president-preckwinkle-releases-2020-impact-report-highlight-77m-cares-funding-outcomes";

export const COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL =
  "https://www.cookcountyil.gov/news/president-preckwinkle-launches-small-business-assistance-program-suburban-cook-county";

export const COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL =
  "https://www.cookcountyil.gov/news/president-preckwinkle-launches-fund-help-small-businesses-and-independent-contractors-recover";

export const COOK_COUNTY_CARES_SOURCE_VERSION = "2021-03-18";

export const COOK_COUNTY_CARES_UMBRELLA_RECORD_ID =
  "cook-county-community-recovery-initiative-2020";

export const COOK_COUNTY_CARES_CLASSIFICATION = {
  reliefEra: "cares_2020",
  fundingSource:
    "Coronavirus Aid, Relief, and Economic Security (CARES) Act",
  programStatus: "historical_closed",
  geographicEligibility: "suburban_cook_county_only",
  cityOfChicagoAwardEligible: false,
  cityOfChicagoExclusionReason:
    "Award eligibility was limited to suburban Cook County; City of Chicago businesses and residents were excluded from these awards.",
  mappable: false,
  isRecipientLevelRecord: false,
  hasRecipientRecords: false,
  hasCoordinates: false,
  isActiveIncentive: false,
  amountRollupPolicy: "never_sum_with_related_records",
} as const;

export const COOK_COUNTY_CARES_EXPECTATIONS = {
  pageCount: 24,
  recordCount: 4,
  umbrellaHistoricalAmountUsd: 77_000_000,
  childPrograms: {
    "cook-county-cares-small-business-grants-2020": {
      recipientCount: 1_690,
      directRecipientHistoricalAmountUsd: 16_900_000,
    },
    "cook-county-cares-small-business-forgivable-loans-2020": {
      recipientCount: 410,
      directRecipientHistoricalAmountUsd: 7_600_000,
    },
    "cook-county-cares-gig-worker-forgivable-loans-2020": {
      recipientCount: 148,
      directRecipientHistoricalAmountUsd: 1_400_000,
    },
  },
} as const;

export type CookCountyCaresRecordKind =
  | "umbrella_program_context"
  | "child_program_outcome";

export type CookCountyCaresAssistanceType =
  | "multi_program_portfolio"
  | "grant"
  | "forgivable_loan";

export type CookCountyCaresRecipientCategory =
  | "mixed_program_portfolio"
  | "small_business"
  | "gig_worker";

export interface CookCountyCaresProgramLedgerRecord {
  recordOrder: number;
  recordId: string;
  parentRecordId: string | null;
  recordKind: CookCountyCaresRecordKind;
  programName: string;
  assistanceType: CookCountyCaresAssistanceType;
  recipientCategory: CookCountyCaresRecipientCategory;
  recipientCount: number | null;
  historicalPortfolioAmountUsd: number | null;
  historicalDirectRecipientAmountUsd: number | null;
  sourceReportedAmountLabel: string;
  amountRollupPolicy: typeof COOK_COUNTY_CARES_CLASSIFICATION.amountRollupPolicy;
  reliefEra: typeof COOK_COUNTY_CARES_CLASSIFICATION.reliefEra;
  fundingSource: typeof COOK_COUNTY_CARES_CLASSIFICATION.fundingSource;
  programStatus: typeof COOK_COUNTY_CARES_CLASSIFICATION.programStatus;
  geographicEligibility: typeof COOK_COUNTY_CARES_CLASSIFICATION.geographicEligibility;
  cityOfChicagoAwardEligible: false;
  cityOfChicagoExclusionReason: typeof COOK_COUNTY_CARES_CLASSIFICATION.cityOfChicagoExclusionReason;
  mappable: false;
  isRecipientLevelRecord: false;
  hasRecipientRecords: false;
  hasCoordinates: false;
  isActiveIncentive: false;
  sourceReportUrl: string;
  sourceContextUrl: string;
  eligibilitySourceUrl: string;
  sourceVersion: string;
  sourcePage: number;
  recordNote: string;
}

export interface CookCountyCaresProgramLedgerResult {
  records: CookCountyCaresProgramLedgerRecord[];
  pageCount: number;
  sourceVersion: string;
}

export interface CookCountyCaresProgramLedgerOptions {
  sourceReportUrl?: string;
  sourceVersion?: string;
}

export interface CookCountyCaresProgramLedgerExpectations {
  pageCount?: number;
  recordCount?: number;
  sourceVersion?: string;
}

export interface CookCountyCaresProgramLedgerSummary {
  pageCount: number;
  recordCount: number;
  historicalPortfolioAmountUsd: number;
  childProgramOutcomes: Array<{
    recordId: string;
    recipientCount: number;
    historicalDirectRecipientAmountUsd: number;
  }>;
}

interface IndexedPage {
  pageNumber: number;
  text: string;
}

interface ParsedProgramOutcome {
  recipientCount: number;
  historicalAmountUsd: number;
  sourceReportedAmountLabel: string;
}

const SMALL_BUSINESS_GRANT_RECORD_ID =
  "cook-county-cares-small-business-grants-2020";
const SMALL_BUSINESS_LOAN_RECORD_ID =
  "cook-county-cares-small-business-forgivable-loans-2020";
const GIG_WORKER_LOAN_RECORD_ID =
  "cook-county-cares-gig-worker-forgivable-loans-2020";

const BANNED_PUBLIC_FIELD_PATTERN =
  /(?:^|_)(?:score|rank|confidence|probability)(?:_|$)/i;

export class CookCountyCaresProgramLedgerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookCountyCaresProgramLedgerParseError";
  }
}

export class CookCountyCaresProgramLedgerIntegrityError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Cook County CARES program ledger integrity check failed: ${problems.join(
        "; ",
      )}.`,
    );
    this.name = "CookCountyCaresProgramLedgerIntegrityError";
    this.problems = problems;
  }
}

function normalizePageText(value: unknown, pageNumber: number): string {
  if (typeof value !== "string") {
    throw new CookCountyCaresProgramLedgerParseError(
      `Impact report page ${pageNumber} must be text.`,
    );
  }
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function requireUniquePage(
  pages: readonly IndexedPage[],
  label: string,
  predicate: (text: string) => boolean,
): IndexedPage {
  const matches = pages.filter((page) => predicate(page.text));
  if (matches.length !== 1) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Expected exactly one ${label} page, found ${matches.length}.`,
    );
  }
  return matches[0];
}

function parseGroupedInteger(value: string, label: string): number {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Malformed ${label}: ${JSON.stringify(value)}.`,
    );
  }
  return parsed;
}

function parseMillions(value: string, label: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Malformed ${label}: ${JSON.stringify(value)}.`,
    );
  }
  const amount = Number(value) * 1_000_000;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Malformed ${label}: ${JSON.stringify(value)}.`,
    );
  }
  return amount;
}

function requireMatch(
  text: string,
  pattern: RegExp,
  label: string,
): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Could not parse ${label} from the official impact report.`,
    );
  }
  return match;
}

function parseUmbrellaHistoricalAmount(page: IndexedPage): {
  historicalAmountUsd: number;
  sourceReportedAmountLabel: string;
} {
  const match = requireMatch(
    page.text,
    /funding was revised to\s+\$\s*(\d+(?:\.\d+)?)\s+million\b/i,
    "Community Recovery Initiative revised funding",
  );
  return {
    historicalAmountUsd: parseMillions(match[1], "umbrella historical amount"),
    sourceReportedAmountLabel: `$${match[1]} million`,
  };
}

function parseSmallBusinessGrantOutcome(
  page: IndexedPage,
): ParsedProgramOutcome {
  const countMatch = requireMatch(
    page.text,
    /(\d{1,3}(?:,\d{3})*)\s+SUBURBAN\s+BUSINESSES\s+RECEIVED\b/i,
    "small-business grant recipient count",
  );
  const amountMatch = requireMatch(
    page.text,
    /\$(\d+(?:\.\d+)?)M\s+DISTRIBUTED\s+IN\s+SMALL\s+BUSINESS\s+GRANTS\b/i,
    "small-business grant historical amount",
  );
  return {
    recipientCount: parseGroupedInteger(
      countMatch[1],
      "small-business grant recipient count",
    ),
    historicalAmountUsd: parseMillions(
      amountMatch[1],
      "small-business grant historical amount",
    ),
    sourceReportedAmountLabel: `$${amountMatch[1]}M`,
  };
}

function parseSmallBusinessLoanOutcome(
  page: IndexedPage,
): ParsedProgramOutcome {
  const match = requireMatch(
    page.text,
    /(\d{1,3}(?:,\d{3})*)\s+RECEIVED\s+UP\s+TO\s+\$20,000\s+LOANS\s+\$(\d+(?:\.\d+)?)M\s+DISTRIBUTED\b/i,
    "small-business forgivable-loan outcome",
  );
  return {
    recipientCount: parseGroupedInteger(
      match[1],
      "small-business forgivable-loan recipient count",
    ),
    historicalAmountUsd: parseMillions(
      match[2],
      "small-business forgivable-loan historical amount",
    ),
    sourceReportedAmountLabel: `$${match[2]}M`,
  };
}

function parseGigWorkerLoanOutcome(
  page: IndexedPage,
): ParsedProgramOutcome {
  const match = requireMatch(
    page.text,
    /(\d{1,3}(?:,\d{3})*)\s+RECEIVED\s+LOANS\s+\$(\d+(?:\.\d+)?)M\s+DISTRIBUTED\b/i,
    "gig-worker forgivable-loan outcome",
  );
  return {
    recipientCount: parseGroupedInteger(
      match[1],
      "gig-worker forgivable-loan recipient count",
    ),
    historicalAmountUsd: parseMillions(
      match[2],
      "gig-worker forgivable-loan historical amount",
    ),
    sourceReportedAmountLabel: `$${match[2]}M`,
  };
}

function normalizeSourceVersion(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CookCountyCaresProgramLedgerParseError(
      `Source version must be an ISO date, received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function validateSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CookCountyCaresProgramLedgerParseError(
      `Source report URL is malformed: ${JSON.stringify(value)}.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new CookCountyCaresProgramLedgerParseError(
      "Source report URL must use HTTPS.",
    );
  }
  return url.toString();
}

function baseRecord(
  sourceReportUrl: string,
  sourceVersion: string,
): Pick<
  CookCountyCaresProgramLedgerRecord,
  | "amountRollupPolicy"
  | "reliefEra"
  | "fundingSource"
  | "programStatus"
  | "geographicEligibility"
  | "cityOfChicagoAwardEligible"
  | "cityOfChicagoExclusionReason"
  | "mappable"
  | "isRecipientLevelRecord"
  | "hasRecipientRecords"
  | "hasCoordinates"
  | "isActiveIncentive"
  | "sourceReportUrl"
  | "sourceVersion"
> {
  return {
    ...COOK_COUNTY_CARES_CLASSIFICATION,
    sourceReportUrl,
    sourceVersion,
  };
}

export function parseCookCountyCaresProgramLedgerPages(
  rawPages: readonly unknown[],
  options: CookCountyCaresProgramLedgerOptions = {},
): CookCountyCaresProgramLedgerResult {
  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    throw new CookCountyCaresProgramLedgerParseError(
      "Impact report must contain at least one page.",
    );
  }

  const pages = rawPages.map((page, index) => ({
    pageNumber: index + 1,
    text: normalizePageText(page, index + 1),
  }));
  const sourceReportUrl = validateSourceUrl(
    options.sourceReportUrl ?? COOK_COUNTY_CARES_IMPACT_REPORT_URL,
  );
  const sourceVersion = normalizeSourceVersion(
    options.sourceVersion ?? COOK_COUNTY_CARES_SOURCE_VERSION,
  );

  const umbrellaPage = requireUniquePage(
    pages,
    "Community Recovery Initiative funding",
    (text) =>
      /Cook County Community Recovery Initiative/i.test(text) &&
      /initially funded by\s+\$82 million/i.test(text) &&
      /funding was revised to\s+\$77 million/i.test(text),
  );
  const loanPage = requireUniquePage(
    pages,
    "Community Recovery Program loan outcome",
    (text) =>
      /Cook County Community Recovery Program/i.test(text) &&
      /Small Business Forgivable Loans/i.test(text) &&
      /Gig Worker Forgivable Loans/i.test(text),
  );
  const grantPage = requireUniquePage(
    pages,
    "Small Business Assistance Program outcome",
    (text) =>
      /Small Business Assistance Program/i.test(text) &&
      /SUBURBAN BUSINESSES/i.test(text) &&
      /DISTRIBUTED IN SMALL BUSINESS GRANTS/i.test(text),
  );

  if (
    !/suburban Cook County residents and small businesses/i.test(
      umbrellaPage.text,
    ) ||
    !/small businesses and gig workers in suburban Cook County/i.test(
      loanPage.text,
    ) ||
    !/SUBURBAN BUSINESSES/i.test(grantPage.text)
  ) {
    throw new CookCountyCaresProgramLedgerParseError(
      "Official report does not contain the expected suburban Cook County eligibility language.",
    );
  }

  const umbrella = parseUmbrellaHistoricalAmount(umbrellaPage);
  const grants = parseSmallBusinessGrantOutcome(grantPage);
  const businessLoans = parseSmallBusinessLoanOutcome(loanPage);
  const gigWorkerLoans = parseGigWorkerLoanOutcome(loanPage);
  const shared = baseRecord(sourceReportUrl, sourceVersion);

  const records: CookCountyCaresProgramLedgerRecord[] = [
    {
      ...shared,
      recordOrder: 0,
      recordId: COOK_COUNTY_CARES_UMBRELLA_RECORD_ID,
      parentRecordId: null,
      recordKind: "umbrella_program_context",
      programName: "Cook County Community Recovery Initiative",
      assistanceType: "multi_program_portfolio",
      recipientCategory: "mixed_program_portfolio",
      recipientCount: null,
      historicalPortfolioAmountUsd: umbrella.historicalAmountUsd,
      historicalDirectRecipientAmountUsd: null,
      sourceReportedAmountLabel: umbrella.sourceReportedAmountLabel,
      sourceContextUrl: COOK_COUNTY_CARES_IMPACT_RELEASE_URL,
      eligibilitySourceUrl: COOK_COUNTY_CARES_IMPACT_RELEASE_URL,
      sourcePage: umbrellaPage.pageNumber,
      recordNote:
        "Source-reported CARES funding for the full initiative. This umbrella amount is portfolio context, not a recipient award total, and must not be added to child outcomes.",
    },
    {
      ...shared,
      recordOrder: 1,
      recordId: SMALL_BUSINESS_GRANT_RECORD_ID,
      parentRecordId: COOK_COUNTY_CARES_UMBRELLA_RECORD_ID,
      recordKind: "child_program_outcome",
      programName:
        "Cook County COVID-19 Recovery Small Business Assistance Program",
      assistanceType: "grant",
      recipientCategory: "small_business",
      recipientCount: grants.recipientCount,
      historicalPortfolioAmountUsd: null,
      historicalDirectRecipientAmountUsd: grants.historicalAmountUsd,
      sourceReportedAmountLabel: grants.sourceReportedAmountLabel,
      sourceContextUrl:
        COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL,
      eligibilitySourceUrl:
        COOK_COUNTY_CARES_SMALL_BUSINESS_GRANT_ELIGIBILITY_URL,
      sourcePage: grantPage.pageNumber,
      recordNote:
        "Source-reported historical grant outcome for suburban Cook County businesses. No public recipient roster or coordinates are represented.",
    },
    {
      ...shared,
      recordOrder: 2,
      recordId: SMALL_BUSINESS_LOAN_RECORD_ID,
      parentRecordId: COOK_COUNTY_CARES_UMBRELLA_RECORD_ID,
      recordKind: "child_program_outcome",
      programName:
        "Cook County Community Recovery Program - Small Business Forgivable Loans",
      assistanceType: "forgivable_loan",
      recipientCategory: "small_business",
      recipientCount: businessLoans.recipientCount,
      historicalPortfolioAmountUsd: null,
      historicalDirectRecipientAmountUsd: businessLoans.historicalAmountUsd,
      sourceReportedAmountLabel: businessLoans.sourceReportedAmountLabel,
      sourceContextUrl: COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
      eligibilitySourceUrl: COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
      sourcePage: loanPage.pageNumber,
      recordNote:
        "Source-reported historical forgivable-loan outcome for suburban Cook County businesses. No public borrower roster or coordinates are represented.",
    },
    {
      ...shared,
      recordOrder: 3,
      recordId: GIG_WORKER_LOAN_RECORD_ID,
      parentRecordId: COOK_COUNTY_CARES_UMBRELLA_RECORD_ID,
      recordKind: "child_program_outcome",
      programName:
        "Cook County Community Recovery Program - Gig Worker Forgivable Loans",
      assistanceType: "forgivable_loan",
      recipientCategory: "gig_worker",
      recipientCount: gigWorkerLoans.recipientCount,
      historicalPortfolioAmountUsd: null,
      historicalDirectRecipientAmountUsd: gigWorkerLoans.historicalAmountUsd,
      sourceReportedAmountLabel: gigWorkerLoans.sourceReportedAmountLabel,
      sourceContextUrl: COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
      eligibilitySourceUrl: COOK_COUNTY_CARES_RECOVERY_FUND_ELIGIBILITY_URL,
      sourcePage: loanPage.pageNumber,
      recordNote:
        "Source-reported historical forgivable-loan outcome for suburban Cook County gig workers. No public borrower roster or coordinates are represented.",
    },
  ];

  return {
    records,
    pageCount: pages.length,
    sourceVersion,
  };
}

export function summarizeCookCountyCaresProgramLedger(
  result: CookCountyCaresProgramLedgerResult,
): CookCountyCaresProgramLedgerSummary {
  const umbrella = result.records.find(
    (record) => record.recordKind === "umbrella_program_context",
  );
  if (umbrella?.historicalPortfolioAmountUsd == null) {
    throw new CookCountyCaresProgramLedgerIntegrityError([
      "missing umbrella historical portfolio amount",
    ]);
  }

  return {
    pageCount: result.pageCount,
    recordCount: result.records.length,
    historicalPortfolioAmountUsd: umbrella.historicalPortfolioAmountUsd,
    childProgramOutcomes: result.records
      .filter(
        (
          record,
        ): record is CookCountyCaresProgramLedgerRecord & {
          recipientCount: number;
          historicalDirectRecipientAmountUsd: number;
        } =>
          record.recordKind === "child_program_outcome" &&
          record.recipientCount !== null &&
          record.historicalDirectRecipientAmountUsd !== null,
      )
      .sort((a, b) => a.recordOrder - b.recordOrder)
      .map((record) => ({
        recordId: record.recordId,
        recipientCount: record.recipientCount,
        historicalDirectRecipientAmountUsd:
          record.historicalDirectRecipientAmountUsd,
      })),
  };
}

function recordKeysContainBannedPublicField(
  record: CookCountyCaresProgramLedgerRecord,
): boolean {
  return Object.keys(record).some((key) =>
    BANNED_PUBLIC_FIELD_PATTERN.test(
      key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(),
    ),
  );
}

export function assertCookCountyCaresProgramLedgerIntegrity(
  result: CookCountyCaresProgramLedgerResult,
  expectations: CookCountyCaresProgramLedgerExpectations = {
    pageCount: COOK_COUNTY_CARES_EXPECTATIONS.pageCount,
    recordCount: COOK_COUNTY_CARES_EXPECTATIONS.recordCount,
    sourceVersion: COOK_COUNTY_CARES_SOURCE_VERSION,
  },
): CookCountyCaresProgramLedgerSummary {
  const problems: string[] = [];
  const summary = summarizeCookCountyCaresProgramLedger(result);

  if (
    expectations.pageCount !== undefined &&
    result.pageCount !== expectations.pageCount
  ) {
    problems.push(
      `expected ${expectations.pageCount} pages, parsed ${result.pageCount}`,
    );
  }
  if (
    expectations.recordCount !== undefined &&
    result.records.length !== expectations.recordCount
  ) {
    problems.push(
      `expected ${expectations.recordCount} records, parsed ${result.records.length}`,
    );
  }
  if (
    expectations.sourceVersion !== undefined &&
    result.sourceVersion !== expectations.sourceVersion
  ) {
    problems.push(
      `expected source version ${expectations.sourceVersion}, parsed ${result.sourceVersion}`,
    );
  }

  const recordsById = new Map(
    result.records.map((record) => [record.recordId, record]),
  );
  if (recordsById.size !== result.records.length) {
    problems.push("record IDs must be unique");
  }

  const umbrella = recordsById.get(COOK_COUNTY_CARES_UMBRELLA_RECORD_ID);
  if (!umbrella) {
    problems.push(`missing umbrella record ${COOK_COUNTY_CARES_UMBRELLA_RECORD_ID}`);
  } else {
    if (
      umbrella.recordKind !== "umbrella_program_context" ||
      umbrella.parentRecordId !== null
    ) {
      problems.push("umbrella record has malformed hierarchy");
    }
    if (
      umbrella.historicalPortfolioAmountUsd !==
      COOK_COUNTY_CARES_EXPECTATIONS.umbrellaHistoricalAmountUsd
    ) {
      problems.push("umbrella historical portfolio amount does not match source");
    }
    if (
      umbrella.historicalDirectRecipientAmountUsd !== null ||
      umbrella.recipientCount !== null
    ) {
      problems.push(
        "umbrella record must not contain a direct-recipient amount or count",
      );
    }
  }

  for (const [recordId, expected] of Object.entries(
    COOK_COUNTY_CARES_EXPECTATIONS.childPrograms,
  )) {
    const record = recordsById.get(recordId);
    if (!record) {
      problems.push(`missing child program ${recordId}`);
      continue;
    }
    if (
      record.recordKind !== "child_program_outcome" ||
      record.parentRecordId !== COOK_COUNTY_CARES_UMBRELLA_RECORD_ID
    ) {
      problems.push(`${recordId} has malformed hierarchy`);
    }
    if (record.recipientCount !== expected.recipientCount) {
      problems.push(`${recordId} recipient count does not match source`);
    }
    if (
      record.historicalDirectRecipientAmountUsd !==
      expected.directRecipientHistoricalAmountUsd
    ) {
      problems.push(`${recordId} direct-recipient amount does not match source`);
    }
    if (record.historicalPortfolioAmountUsd !== null) {
      problems.push(`${recordId} must not repeat the umbrella amount`);
    }
  }

  for (const record of result.records) {
    if (
      record.amountRollupPolicy !==
      COOK_COUNTY_CARES_CLASSIFICATION.amountRollupPolicy
    ) {
      problems.push(`${record.recordId} does not prohibit related-row rollups`);
    }
    if (
      record.geographicEligibility !==
        COOK_COUNTY_CARES_CLASSIFICATION.geographicEligibility ||
      record.cityOfChicagoAwardEligible ||
      record.mappable ||
      record.isRecipientLevelRecord ||
      record.hasRecipientRecords ||
      record.hasCoordinates ||
      record.isActiveIncentive
    ) {
      problems.push(`${record.recordId} violates exclusion-ledger boundaries`);
    }
    if (
      record.cityOfChicagoExclusionReason !==
      COOK_COUNTY_CARES_CLASSIFICATION.cityOfChicagoExclusionReason
    ) {
      problems.push(`${record.recordId} is missing the Chicago exclusion reason`);
    }
    if (record.sourceReportUrl !== COOK_COUNTY_CARES_IMPACT_REPORT_URL) {
      problems.push(`${record.recordId} does not cite the official impact report`);
    }
    if (recordKeysContainBannedPublicField(record)) {
      problems.push(`${record.recordId} contains a banned public field`);
    }
  }

  if (problems.length > 0) {
    throw new CookCountyCaresProgramLedgerIntegrityError(problems);
  }
  return summary;
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCookCountyCaresProgramLedgerCsv(
  records: readonly CookCountyCaresProgramLedgerRecord[],
): string {
  const header = [
    "record_order",
    "record_id",
    "parent_record_id",
    "record_kind",
    "program_name",
    "assistance_type",
    "recipient_category",
    "recipient_count",
    "historical_portfolio_amount_usd",
    "historical_direct_recipient_amount_usd",
    "source_reported_amount_label",
    "amount_rollup_policy",
    "relief_era",
    "funding_source",
    "program_status",
    "geographic_eligibility",
    "city_of_chicago_award_eligible",
    "city_of_chicago_exclusion_reason",
    "mappable",
    "is_recipient_level_record",
    "has_recipient_records",
    "has_coordinates",
    "is_active_incentive",
    "source_report_url",
    "source_context_url",
    "eligibility_source_url",
    "source_version",
    "source_page",
    "record_note",
  ];

  const rows = [...records]
    .sort(
      (a, b) =>
        a.recordOrder - b.recordOrder || a.recordId.localeCompare(b.recordId),
    )
    .map((record) =>
      [
        record.recordOrder,
        record.recordId,
        record.parentRecordId,
        record.recordKind,
        record.programName,
        record.assistanceType,
        record.recipientCategory,
        record.recipientCount,
        record.historicalPortfolioAmountUsd,
        record.historicalDirectRecipientAmountUsd,
        record.sourceReportedAmountLabel,
        record.amountRollupPolicy,
        record.reliefEra,
        record.fundingSource,
        record.programStatus,
        record.geographicEligibility,
        record.cityOfChicagoAwardEligible,
        record.cityOfChicagoExclusionReason,
        record.mappable,
        record.isRecipientLevelRecord,
        record.hasRecipientRecords,
        record.hasCoordinates,
        record.isActiveIncentive,
        record.sourceReportUrl,
        record.sourceContextUrl,
        record.eligibilitySourceUrl,
        record.sourceVersion,
        record.sourcePage,
        record.recordNote,
      ]
        .map(csvCell)
        .join(","),
    );

  return `${[header.join(","), ...rows].join("\n")}\n`;
}
