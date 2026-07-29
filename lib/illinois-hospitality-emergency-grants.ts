/**
 * Deterministic ingestion for Illinois DCEO Hospitality Emergency Grant
 * awardees. These are historical 2020 awards from a closed program, not an
 * active opportunity or an estimate of funding available to another project.
 */

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL =
  "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/smallbizassistance/documents/hospitality-grant-awardees-full-list.pdf";

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PROGRAM_URL =
  "https://dceo.illinois.gov/smallbizassistance/hospitalitygrantawards.html";

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_SOURCE_VERSION =
  "2020-04-27";

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION = {
  programName: "Illinois Hospitality Emergency Grant Program",
  assistanceType: "grant",
  awardStatus: "historical_award",
  programStatus: "closed",
  sourceStatus: "official_confirmed_awardee_list",
  sourcePrecision: "municipality",
  recordNote:
    "Historical 2020 state emergency grant award from a closed program; not an active opportunity or an estimate of available funding. Municipality and county are source-published; no street address or ZIP is inferred.",
} as const;

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_OFFICIAL_HEADLINE = {
  asOf: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_SOURCE_VERSION,
  approvedBusinessCount: 699,
  fundedUsd: 13_995_000,
  sourceUrl: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PROGRAM_URL,
} as const;

const CANONICAL_FIRST_RECORD_KEY =
  "1659 INC|Caminos de Michoacan|Chicago|Cook|25000";
const CANONICAL_LAST_RECORD_KEY =
  "Longbridge Golf Course, Inc.||Springfield|Sangamon|25000";

export const ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS = {
  pageCount: 12,
  rowCount: 699,
  totalGrantUsd: 13_995_000,
  minimumGrantUsd: 10_000,
  maximumGrantUsd: 50_000,
  pageRowCounts: [61, 62, 62, 62, 62, 62, 62, 62, 62, 62, 62, 18],
  awardAmountCounts: {
    10_000: 307,
    25_000: 347,
    50_000: 45,
  },
  countyCount: 69,
  firstRecordKey: CANONICAL_FIRST_RECORD_KEY,
  lastRecordKey: CANONICAL_LAST_RECORD_KEY,
  sourceVersion: ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_SOURCE_VERSION,
} as const;

export interface IllinoisHospitalityEmergencyGrantRecord {
  legalBusinessName: string;
  dba: string;
  publishedMunicipality: string;
  county: string;
  historicalGrantAmountUsd: number;
  sourceUrl: string;
  sourceVersion: string;
  programName: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.programName;
  assistanceType: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.assistanceType;
  awardStatus: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.awardStatus;
  programStatus: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.programStatus;
  sourceStatus: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.sourceStatus;
  sourcePrecision: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.sourcePrecision;
  recordNote: typeof ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION.recordNote;
}

export interface IllinoisHospitalityEmergencyGrantTextItem {
  str: string;
  x: number;
  y: number;
}

export type IllinoisHospitalityEmergencyGrantIssueCode =
  | "missing_document_header"
  | "unexpected_page_header"
  | "malformed_line"
  | "malformed_row"
  | "incomplete_row"
  | "empty_page";

export interface IllinoisHospitalityEmergencyGrantIssue {
  code: IllinoisHospitalityEmergencyGrantIssueCode;
  page: number;
  line: number;
  text: string;
  message: string;
}

export interface IllinoisHospitalityEmergencyGrantParseResult {
  records: IllinoisHospitalityEmergencyGrantRecord[];
  issues: IllinoisHospitalityEmergencyGrantIssue[];
  pageCount: number;
  pageRowCounts: number[];
  sourceVersion: string;
}

export interface IllinoisHospitalityEmergencyGrantSummary {
  pageCount: number;
  rowCount: number;
  totalGrantUsd: number;
  minimumGrantUsd: number;
  maximumGrantUsd: number;
  pageRowCounts: number[];
  awardAmountCounts: Record<number, number>;
  countyCount: number;
  firstRecordKey: string;
  lastRecordKey: string;
}

export interface IllinoisHospitalityEmergencyGrantExpectations {
  pageCount?: number;
  rowCount?: number;
  totalGrantUsd?: number;
  minimumGrantUsd?: number;
  maximumGrantUsd?: number;
  pageRowCounts?: readonly number[];
  awardAmountCounts?: Readonly<Record<number, number>>;
  countyCount?: number;
  firstRecordKey?: string;
  lastRecordKey?: string;
  sourceVersion?: string;
}

interface PendingRow {
  columns: string[][];
  page: number;
  line: number;
  sourceLines: string[];
}

const COLUMN_HEADERS = [
  "Business Name",
  "DBA",
  "City",
  "County",
  "Grant",
] as const;

const VISUAL_LINE_Y_TOLERANCE = 0.75;
const COLUMN_START_TOLERANCE = 0.75;

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00e2\u20ac\u2122/g, "\u2019")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseIllinoisHospitalityEmergencyGrantUsdAmount(
  value: string | number,
): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  const normalized = value.trim();
  if (!/^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized.replace(/[$,\s]/g, ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function emptyPendingRow(page: number, line: number): PendingRow {
  return {
    columns: Array.from({ length: COLUMN_HEADERS.length }, () => []),
    page,
    line,
    sourceLines: [],
  };
}

function pendingHasContent(pending: PendingRow): boolean {
  return pending.columns.some((parts) => parts.length > 0);
}

function joinedPendingColumns(pending: PendingRow): string[] {
  return pending.columns.map((parts) =>
    normalizeWhitespace(parts.join(" ")),
  );
}

function isColumnHeader(columns: string[]): boolean {
  return COLUMN_HEADERS.every(
    (header, index) => normalizeWhitespace(columns[index] ?? "") === header,
  );
}

function recordKey(
  record: Pick<
    IllinoisHospitalityEmergencyGrantRecord,
    | "legalBusinessName"
    | "dba"
    | "publishedMunicipality"
    | "county"
    | "historicalGrantAmountUsd"
  >,
): string {
  return [
    record.legalBusinessName,
    record.dba,
    record.publishedMunicipality,
    record.county,
    record.historicalGrantAmountUsd,
  ].join("|");
}

function buildRecord(
  columns: string[],
  sourceUrl: string,
  sourceVersion: string,
): IllinoisHospitalityEmergencyGrantRecord | null {
  const [
    legalBusinessName,
    dba,
    publishedMunicipality,
    county,
    rawGrantAmount,
  ] = columns;
  const historicalGrantAmountUsd =
    parseIllinoisHospitalityEmergencyGrantUsdAmount(rawGrantAmount);

  if (
    !legalBusinessName ||
    !publishedMunicipality ||
    !county ||
    historicalGrantAmountUsd == null
  ) {
    return null;
  }

  return {
    legalBusinessName,
    dba,
    publishedMunicipality,
    county,
    historicalGrantAmountUsd,
    sourceUrl,
    sourceVersion,
    ...ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_CLASSIFICATION,
  };
}

/**
 * Parses five-column, tab-delimited visual lines. Wrapped names and DBAs may
 * occupy multiple visual lines, but an unfinished row is never carried across
 * a page boundary and therefore cannot merge with the next page's business.
 */
export function parseIllinoisHospitalityEmergencyGrantPages(
  pages: string[],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {},
): IllinoisHospitalityEmergencyGrantParseResult {
  const sourceUrl =
    options.sourceUrl ?? ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_PDF_URL;
  const sourceVersion =
    options.sourceVersion ??
    ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_SOURCE_VERSION;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceVersion)) {
    throw new Error(
      "Illinois Hospitality Emergency Grant source version must be an ISO date.",
    );
  }

  const records: IllinoisHospitalityEmergencyGrantRecord[] = [];
  const issues: IllinoisHospitalityEmergencyGrantIssue[] = [];
  const pageRowCounts: number[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const lines = pageText.split(/\r?\n/);
    let pending = emptyPendingRow(page, 1);
    let pageRows = 0;
    let sawHeader = false;

    lines.forEach((rawLine, lineIndex) => {
      const line = lineIndex + 1;
      if (!normalizeWhitespace(rawLine)) return;

      const columns = rawLine.split("\t");
      if (columns.length !== COLUMN_HEADERS.length) {
        issues.push({
          code: "malformed_line",
          page,
          line,
          text: normalizeWhitespace(rawLine),
          message:
            "Expected five tab-delimited cells in the official Hospitality Emergency Grant column order.",
        });
        return;
      }

      const normalizedColumns = columns.map(normalizeWhitespace);
      if (isColumnHeader(normalizedColumns)) {
        sawHeader = true;
        if (page !== 1) {
          issues.push({
            code: "unexpected_page_header",
            page,
            line,
            text: normalizedColumns.join(" | "),
            message:
              "The canonical PDF publishes its column header only on page 1.",
          });
        }
        return;
      }
      if (normalizedColumns.every((value) => !value)) return;

      if (!pendingHasContent(pending)) {
        pending = emptyPendingRow(page, line);
      }
      pending.sourceLines.push(normalizedColumns.join(" | "));
      normalizedColumns.forEach((value, columnIndex) => {
        if (value) pending.columns[columnIndex].push(value);
      });

      if (!normalizedColumns[4]) return;

      const completedColumns = joinedPendingColumns(pending);
      const record = buildRecord(completedColumns, sourceUrl, sourceVersion);
      if (record) {
        records.push(record);
        pageRows += 1;
      } else {
        issues.push({
          code: "malformed_row",
          page: pending.page,
          line: pending.line,
          text: pending.sourceLines.join(" || "),
          message:
            "Completed row is missing a business name, published municipality, county, or valid historical grant amount.",
        });
      }
      pending = emptyPendingRow(page, line + 1);
    });

    if (pendingHasContent(pending)) {
      issues.push({
        code: "incomplete_row",
        page: pending.page,
        line: pending.line,
        text: pending.sourceLines.join(" || "),
        message:
          "The page ended before this row supplied a grant amount; page-boundary row joining is not allowed.",
      });
    }
    if (page === 1 && !sawHeader) {
      issues.push({
        code: "missing_document_header",
        page,
        line: 1,
        text: lines.slice(0, 3).map(normalizeWhitespace).join(" | "),
        message:
          "Page 1 is missing the official five-column document header.",
      });
    }
    if (pageRows === 0) {
      issues.push({
        code: "empty_page",
        page,
        line: 1,
        text: "",
        message: "Every canonical source page must contain awardee rows.",
      });
    }
    pageRowCounts.push(pageRows);
  });

  return {
    records,
    issues,
    pageCount: pages.length,
    pageRowCounts,
    sourceVersion,
  };
}

function headerStart(
  items: IllinoisHospitalityEmergencyGrantTextItem[],
  header: (typeof COLUMN_HEADERS)[number],
): number {
  const matches = items.filter(
    (item) => normalizeWhitespace(item.str) === header,
  );
  if (matches.length !== 1 || !Number.isFinite(matches[0]?.x)) {
    throw new IllinoisHospitalityEmergencyGrantLayoutError(
      `Page 1 must contain exactly one "${header}" header item.`,
      1,
    );
  }
  return matches[0].x;
}

function groupVisualLines(
  items: IllinoisHospitalityEmergencyGrantTextItem[],
): Array<{
  y: number;
  items: IllinoisHospitalityEmergencyGrantTextItem[];
}> {
  const sorted = items
    .filter(
      (item) =>
        normalizeWhitespace(item.str) &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y),
    )
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{
    y: number;
    items: IllinoisHospitalityEmergencyGrantTextItem[];
  }> = [];

  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= VISUAL_LINE_Y_TOLERANCE) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines;
}

function itemColumnIndex(x: number, columnStarts: number[]): number {
  for (let index = columnStarts.length - 1; index > 0; index -= 1) {
    if (x >= columnStarts[index] - COLUMN_START_TOLERANCE) return index;
  }
  return 0;
}

function layoutTextItemPage(
  items: IllinoisHospitalityEmergencyGrantTextItem[],
  columnStarts: number[],
): string {
  return groupVisualLines(items)
    .map((visualLine) => {
      const columns: IllinoisHospitalityEmergencyGrantTextItem[][] =
        Array.from({ length: COLUMN_HEADERS.length }, () => []);
      visualLine.items.forEach((item) => {
        columns[itemColumnIndex(item.x, columnStarts)].push(item);
      });
      return columns
        .map((columnItems) =>
          normalizeWhitespace(
            columnItems
              .sort((left, right) => left.x - right.x)
              .map((item) => item.str)
              .join(" "),
          ),
        )
        .join("\t");
    })
    .join("\n");
}

export class IllinoisHospitalityEmergencyGrantLayoutError extends Error {
  readonly page: number;

  constructor(message: string, page: number) {
    super(message);
    this.name = "IllinoisHospitalityEmergencyGrantLayoutError";
    this.page = page;
  }
}

/**
 * Uses source-published PDF cell coordinates to separate names and DBAs. Page
 * arrays remain distinct so text extractors cannot concatenate the final row
 * of one page with the first row of the next.
 */
export function layoutIllinoisHospitalityEmergencyGrantTextItemPages(
  pages: IllinoisHospitalityEmergencyGrantTextItem[][],
): string[] {
  if (pages.length === 0) return [];
  const columnStarts = COLUMN_HEADERS.map((header) =>
    headerStart(pages[0], header),
  );
  for (let index = 1; index < columnStarts.length; index += 1) {
    if (columnStarts[index] <= columnStarts[index - 1]) {
      throw new IllinoisHospitalityEmergencyGrantLayoutError(
        "Page 1 has non-increasing Hospitality Emergency Grant column coordinates.",
        1,
      );
    }
  }

  return pages.map((items) => layoutTextItemPage(items, columnStarts));
}

export function parseIllinoisHospitalityEmergencyGrantTextItemPages(
  pages: IllinoisHospitalityEmergencyGrantTextItem[][],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {},
): IllinoisHospitalityEmergencyGrantParseResult {
  return parseIllinoisHospitalityEmergencyGrantPages(
    layoutIllinoisHospitalityEmergencyGrantTextItemPages(pages),
    options,
  );
}

export function summarizeIllinoisHospitalityEmergencyGrants(
  result: Pick<
    IllinoisHospitalityEmergencyGrantParseResult,
    "records" | "pageCount" | "pageRowCounts"
  >,
): IllinoisHospitalityEmergencyGrantSummary {
  const amounts = result.records.map(
    (record) => record.historicalGrantAmountUsd,
  );
  const awardAmountCounts: Record<number, number> = {};
  amounts.forEach((amount) => {
    awardAmountCounts[amount] = (awardAmountCounts[amount] ?? 0) + 1;
  });

  return {
    pageCount: result.pageCount,
    rowCount: result.records.length,
    totalGrantUsd: amounts.reduce((sum, amount) => sum + amount, 0),
    minimumGrantUsd: amounts.length > 0 ? Math.min(...amounts) : 0,
    maximumGrantUsd: amounts.length > 0 ? Math.max(...amounts) : 0,
    pageRowCounts: [...result.pageRowCounts],
    awardAmountCounts,
    countyCount: new Set(result.records.map((record) => record.county)).size,
    firstRecordKey: result.records[0] ? recordKey(result.records[0]) : "",
    lastRecordKey: result.records.at(-1)
      ? recordKey(result.records.at(-1)!)
      : "",
  };
}

export class IllinoisHospitalityEmergencyGrantIntegrityError extends Error {
  readonly summary: IllinoisHospitalityEmergencyGrantSummary;

  constructor(
    message: string,
    summary: IllinoisHospitalityEmergencyGrantSummary,
  ) {
    super(message);
    this.name = "IllinoisHospitalityEmergencyGrantIntegrityError";
    this.summary = summary;
  }
}

function stableNumericRecord(value: Readonly<Record<number, number>>): string {
  return Object.entries(value)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
}

export function assertIllinoisHospitalityEmergencyGrantIntegrity(
  result: IllinoisHospitalityEmergencyGrantParseResult,
  expectations: IllinoisHospitalityEmergencyGrantExpectations =
    ILLINOIS_HOSPITALITY_EMERGENCY_GRANTS_FULL_SOURCE_EXPECTATIONS,
): IllinoisHospitalityEmergencyGrantSummary {
  const summary = summarizeIllinoisHospitalityEmergencyGrants(result);
  const problems: string[] = [];

  if (result.issues.length > 0) {
    problems.push(`${result.issues.length} parser issue(s)`);
  }

  const numericChecks: Array<{
    label: string;
    actual: number;
    expected: number | undefined;
    currency?: boolean;
  }> = [
    ["pages", summary.pageCount, expectations.pageCount],
    ["rows", summary.rowCount, expectations.rowCount],
    [
      "total historical grant",
      summary.totalGrantUsd,
      expectations.totalGrantUsd,
      true,
    ],
    [
      "minimum historical grant",
      summary.minimumGrantUsd,
      expectations.minimumGrantUsd,
      true,
    ],
    [
      "maximum historical grant",
      summary.maximumGrantUsd,
      expectations.maximumGrantUsd,
      true,
    ],
    ["counties", summary.countyCount, expectations.countyCount],
  ].map(([label, actual, expected, currency]) => ({
    label: String(label),
    actual: Number(actual),
    expected: expected == null ? undefined : Number(expected),
    currency: Boolean(currency),
  }));

  numericChecks.forEach((check) => {
    if (check.expected == null || check.actual === check.expected) return;
    const expected = check.currency
      ? `$${check.expected.toLocaleString("en-US")}`
      : check.expected.toLocaleString("en-US");
    const actual = check.currency
      ? `$${check.actual.toLocaleString("en-US")}`
      : check.actual.toLocaleString("en-US");
    problems.push(`expected ${check.label} ${expected}, parsed ${actual}`);
  });

  if (
    expectations.pageRowCounts &&
    summary.pageRowCounts.join(",") !== expectations.pageRowCounts.join(",")
  ) {
    problems.push(
      `expected page row counts ${expectations.pageRowCounts.join(",")}, parsed ${summary.pageRowCounts.join(",")}`,
    );
  }
  if (
    expectations.awardAmountCounts &&
    stableNumericRecord(summary.awardAmountCounts) !==
      stableNumericRecord(expectations.awardAmountCounts)
  ) {
    problems.push(
      `expected award distribution ${stableNumericRecord(expectations.awardAmountCounts)}, parsed ${stableNumericRecord(summary.awardAmountCounts)}`,
    );
  }

  const stringChecks: Array<{
    label: string;
    actual: string;
    expected: string | undefined;
  }> = [
    {
      label: "first record",
      actual: summary.firstRecordKey,
      expected: expectations.firstRecordKey,
    },
    {
      label: "last record",
      actual: summary.lastRecordKey,
      expected: expectations.lastRecordKey,
    },
    {
      label: "source version",
      actual: result.sourceVersion,
      expected: expectations.sourceVersion,
    },
  ];
  stringChecks.forEach((check) => {
    if (check.expected == null || check.actual === check.expected) return;
    problems.push(
      `expected ${check.label} ${JSON.stringify(check.expected)}, parsed ${JSON.stringify(check.actual)}`,
    );
  });

  if (problems.length > 0) {
    throw new IllinoisHospitalityEmergencyGrantIntegrityError(
      `Illinois Hospitality Emergency Grant integrity check failed: ${problems.join("; ")}.`,
      summary,
    );
  }

  return summary;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeIllinoisHospitalityEmergencyGrantCsv(
  records: IllinoisHospitalityEmergencyGrantRecord[],
): string {
  const headers = [
    "legal_business_name",
    "dba",
    "published_municipality",
    "county",
    "historical_grant_amount_usd",
    "source_url",
    "source_version",
    "source_status",
    "source_precision",
    "program_name",
    "assistance_type",
    "award_status",
    "program_status",
    "record_note",
  ];
  const rows = records.map((record) =>
    [
      record.legalBusinessName,
      record.dba,
      record.publishedMunicipality,
      record.county,
      record.historicalGrantAmountUsd,
      record.sourceUrl,
      record.sourceVersion,
      record.sourceStatus,
      record.sourcePrecision,
      record.programName,
      record.assistanceType,
      record.awardStatus,
      record.programStatus,
      record.recordNote,
    ]
      .map(csvEscape)
      .join(","),
  );

  return `${[headers.join(","), ...rows].join("\n")}\n`;
}
