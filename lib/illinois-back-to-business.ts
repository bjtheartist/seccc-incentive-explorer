export const ILLINOIS_BACK_TO_BUSINESS_PDF_URL =
  "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/smallbizassistance/documents/b2bawards.pdf";

export const ILLINOIS_BACK_TO_BUSINESS_PROGRAM_CONTEXT_URL =
  "https://dceo.illinois.gov/smallbizassistance/b2b-previous-info.html";

export const ILLINOIS_BACK_TO_BUSINESS_SOURCE_VERSION = "2022-07-26";

export const ILLINOIS_BACK_TO_BUSINESS_LABELS = {
  programName: "Illinois Back to Business (B2B) Grant Program",
  fundingSource: "American Rescue Plan Act (ARPA)",
  assistanceType: "grant",
  awardStatus: "historical_award",
  recordNote:
    "Historical ARPA-funded grant award; not an active opportunity or a promise of future funding.",
} as const;

export const ILLINOIS_BACK_TO_BUSINESS_OFFICIAL_PROGRAM_HEADLINE = {
  rowCount: 6_687,
  totalAwardUsd: 250_000_000,
  sourceUrl: ILLINOIS_BACK_TO_BUSINESS_PROGRAM_CONTEXT_URL,
} as const;

/**
 * Exact values calculated from the dated official recipient PDF. DCEO's
 * program page reports the rounded $250 million program headline separately.
 */
export const ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS = {
  pageCount: 99,
  rowCount: 6_687,
  totalAwardUsd: 249_510_000,
  minimumAwardUsd: 5_000,
  maximumAwardUsd: 250_000,
  sourceVersion: ILLINOIS_BACK_TO_BUSINESS_SOURCE_VERSION,
} as const;

export interface IllinoisBackToBusinessRecord {
  legalBusinessName: string;
  dba: string;
  county: string;
  city: string;
  zip: string;
  awardAmountUsd: number;
  sourceUrl: string;
  sourceVersion: string;
  programName: typeof ILLINOIS_BACK_TO_BUSINESS_LABELS.programName;
  fundingSource: typeof ILLINOIS_BACK_TO_BUSINESS_LABELS.fundingSource;
  assistanceType: typeof ILLINOIS_BACK_TO_BUSINESS_LABELS.assistanceType;
  awardStatus: typeof ILLINOIS_BACK_TO_BUSINESS_LABELS.awardStatus;
  recordNote: typeof ILLINOIS_BACK_TO_BUSINESS_LABELS.recordNote;
}

export interface IllinoisBackToBusinessTextItem {
  str: string;
  x: number;
  y: number;
}

export type IllinoisBackToBusinessParseIssueCode =
  | "missing_page_header"
  | "malformed_line"
  | "malformed_row"
  | "incomplete_row";

export interface IllinoisBackToBusinessParseIssue {
  code: IllinoisBackToBusinessParseIssueCode;
  page: number;
  line: number;
  text: string;
  message: string;
}

export interface IllinoisBackToBusinessParseResult {
  records: IllinoisBackToBusinessRecord[];
  issues: IllinoisBackToBusinessParseIssue[];
  pageCount: number;
  sourceVersion: string;
}

export interface IllinoisBackToBusinessSummary {
  pageCount: number;
  rowCount: number;
  totalAwardUsd: number;
  minimumAwardUsd: number;
  maximumAwardUsd: number;
}

export interface IllinoisBackToBusinessExpectations {
  pageCount?: number;
  rowCount?: number;
  totalAwardUsd?: number;
  minimumAwardUsd?: number;
  maximumAwardUsd?: number;
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
  "Doing Business As",
  "County",
  "City",
  "Zip Code",
  "Award Amount",
] as const;

const VISUAL_LINE_Y_TOLERANCE = 0.75;
const COLUMN_START_TOLERANCE = 0.75;
const ILLINOIS_COUNTY_NAMES = [
  "Alexander",
  "Champaign",
  "Christian",
  "Crawford",
  "Cumberland",
  "De Witt",
  "Effingham",
  "Henderson",
  "Jefferson",
  "Jo Daviess",
  "Kankakee",
  "La Salle",
  "Livingston",
  "Macoupin",
  "McDonough",
  "McHenry",
  "McLean",
  "Montgomery",
  "Rock Island",
  "St. Clair",
  "Stephenson",
  "Vermilion",
  "Washington",
  "Whiteside",
  "Williamson",
  "Winnebago",
  "Woodford",
  "Adams",
  "Bond",
  "Boone",
  "Brown",
  "Bureau",
  "Calhoun",
  "Carroll",
  "Cass",
  "Clark",
  "Clay",
  "Clinton",
  "Coles",
  "Cook",
  "DeKalb",
  "Douglas",
  "DuPage",
  "Edgar",
  "Edwards",
  "Fayette",
  "Ford",
  "Franklin",
  "Fulton",
  "Gallatin",
  "Greene",
  "Grundy",
  "Hamilton",
  "Hancock",
  "Hardin",
  "Henry",
  "Iroquois",
  "Jackson",
  "Jasper",
  "Jersey",
  "Johnson",
  "Kane",
  "Kendall",
  "Knox",
  "Lake",
  "Lawrence",
  "Lee",
  "Logan",
  "Macon",
  "Madison",
  "Marion",
  "Marshall",
  "Mason",
  "Massac",
  "Menard",
  "Mercer",
  "Monroe",
  "Morgan",
  "Moultrie",
  "Ogle",
  "Peoria",
  "Perry",
  "Piatt",
  "Pike",
  "Pope",
  "Pulaski",
  "Putnam",
  "Randolph",
  "Richland",
  "Saline",
  "Sangamon",
  "Schuyler",
  "Scott",
  "Shelby",
  "Stark",
  "Tazewell",
  "Union",
  "Wabash",
  "Warren",
  "Wayne",
  "White",
  "Will",
] as const;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseIsoDate(monthName: string, day: string, year: string): string | null {
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  const month = months[monthName.toLowerCase()];
  return month ? `${year}-${month}-${day.padStart(2, "0")}` : null;
}

export function extractIllinoisBackToBusinessVersion(
  pages: string[]
): string | null {
  const headerText = pages.slice(0, 3).join("\n");
  const match = headerText.match(
    /Back to Business Grant Awardees[\s\S]{0,120}?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
  );
  return match ? parseIsoDate(match[1], match[2], match[3]) : null;
}

export function parseIllinoisBackToBusinessUsdAmount(
  value: string | number
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

export function normalizeIllinoisBackToBusinessZip(value: string): string | null {
  const normalized = value.trim();
  return /^\d{5}$/.test(normalized) ? normalized : null;
}

function isDocumentTitle(line: string): boolean {
  return /^Back to Business Grant Awardees(?:\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})?$/i.test(
    line
  );
}

function isPageFooter(line: string): boolean {
  return /^page\s+\d+\s+of\s+\d+$/i.test(line);
}

function isColumnHeader(columns: string[]): boolean {
  return COLUMN_HEADERS.every(
    (header, index) => normalizeWhitespace(columns[index] ?? "") === header
  );
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
    normalizeWhitespace(parts.join(" "))
  );
}

function buildRecord(
  columns: string[],
  sourceUrl: string,
  sourceVersion: string
): IllinoisBackToBusinessRecord | null {
  const [
    legalBusinessName,
    dba,
    county,
    city,
    rawZip,
    rawAwardAmount,
  ] = columns;
  const zip = normalizeIllinoisBackToBusinessZip(rawZip);
  const awardAmountUsd =
    parseIllinoisBackToBusinessUsdAmount(rawAwardAmount);

  if (
    !legalBusinessName ||
    !county ||
    !city ||
    !zip ||
    awardAmountUsd == null
  ) {
    return null;
  }

  return {
    legalBusinessName,
    dba,
    county,
    city,
    zip,
    awardAmountUsd,
    sourceUrl,
    sourceVersion,
    ...ILLINOIS_BACK_TO_BUSINESS_LABELS,
  };
}

function recordIssue(
  issues: IllinoisBackToBusinessParseIssue[],
  issue: IllinoisBackToBusinessParseIssue
): void {
  issues.push(issue);
}

/**
 * Parses tab-delimited extracted pages. Each visual PDF line must contain six
 * cells in official column order; cells may be blank while a row wraps.
 */
export function parseIllinoisBackToBusinessPages(
  pages: string[],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {}
): IllinoisBackToBusinessParseResult {
  const sourceUrl = options.sourceUrl ?? ILLINOIS_BACK_TO_BUSINESS_PDF_URL;
  const sourceVersion =
    options.sourceVersion ?? extractIllinoisBackToBusinessVersion(pages);
  if (!sourceVersion || !/^\d{4}-\d{2}-\d{2}$/.test(sourceVersion)) {
    throw new Error(
      "Illinois Back to Business source version is missing or invalid; pass an ISO sourceVersion or provide the dated official document header."
    );
  }

  const records: IllinoisBackToBusinessRecord[] = [];
  const issues: IllinoisBackToBusinessParseIssue[] = [];

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const lines = pageText.split(/\r?\n/);
    let sawTitle = false;
    let sawColumnHeader = false;
    let pending = emptyPendingRow(page, 1);

    lines.forEach((rawLine, lineIndex) => {
      const line = lineIndex + 1;
      const normalizedLine = normalizeWhitespace(rawLine);
      if (!normalizedLine) return;

      if (isDocumentTitle(normalizedLine)) {
        sawTitle = true;
        return;
      }
      if (isPageFooter(normalizedLine)) return;

      const columns = rawLine.split("\t");
      if (columns.length !== COLUMN_HEADERS.length) {
        recordIssue(issues, {
          code: "malformed_line",
          page,
          line,
          text: normalizedLine,
          message:
            "Expected six tab-delimited cells in the official B2B column order.",
        });
        return;
      }

      const normalizedColumns = columns.map(normalizeWhitespace);
      if (isColumnHeader(normalizedColumns)) {
        sawColumnHeader = true;
        return;
      }
      if (normalizedColumns.every((value) => !value)) return;

      if (!pendingHasContent(pending)) {
        pending = emptyPendingRow(page, line);
      }
      pending.sourceLines.push(normalizedLine);
      normalizedColumns.forEach((value, columnIndex) => {
        if (value) pending.columns[columnIndex].push(value);
      });

      if (!normalizedColumns[5]) return;

      const completedColumns = joinedPendingColumns(pending);
      const record = buildRecord(completedColumns, sourceUrl, sourceVersion);
      if (record) {
        records.push(record);
      } else {
        recordIssue(issues, {
          code: "malformed_row",
          page: pending.page,
          line: pending.line,
          text: pending.sourceLines.join(" | "),
          message:
            "Completed row is missing a legal business name, county, city, valid five-digit ZIP, or valid dollar award.",
        });
      }
      pending = emptyPendingRow(page, line + 1);
    });

    if (pendingHasContent(pending)) {
      recordIssue(issues, {
        code: "incomplete_row",
        page: pending.page,
        line: pending.line,
        text: pending.sourceLines.join(" | "),
        message: "The page ended before this row supplied an award amount.",
      });
    }
    if (!sawTitle || !sawColumnHeader) {
      recordIssue(issues, {
        code: "missing_page_header",
        page,
        line: 1,
        text: lines.slice(0, 3).map(normalizeWhitespace).join(" | "),
        message:
          "The page is missing the official document title or six-column header.",
      });
    }
  });

  return {
    records,
    issues,
    pageCount: pages.length,
    sourceVersion,
  };
}

function headerStart(
  items: IllinoisBackToBusinessTextItem[],
  header: (typeof COLUMN_HEADERS)[number],
  page: number
): number {
  const matches = items.filter(
    (item) => normalizeWhitespace(item.str) === header
  );
  if (matches.length !== 1 || !Number.isFinite(matches[0]?.x)) {
    throw new IllinoisBackToBusinessLayoutError(
      `Page ${page} must contain exactly one "${header}" header item.`,
      page
    );
  }
  return matches[0].x;
}

function groupVisualLines(
  items: IllinoisBackToBusinessTextItem[]
): Array<{ y: number; items: IllinoisBackToBusinessTextItem[] }> {
  const sorted = items
    .filter(
      (item) =>
        normalizeWhitespace(item.str) &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y)
    )
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{ y: number; items: IllinoisBackToBusinessTextItem[] }> = [];

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

function removeMergedCountySuffix(
  value: string
): { value: string; county: string } | null {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();

  for (const countyName of ILLINOIS_COUNTY_NAMES) {
    const suffix = ` ${countyName.toLowerCase()}`;
    if (!lower.endsWith(suffix)) continue;
    return {
      value: normalizeWhitespace(
        normalized.slice(0, normalized.length - suffix.length)
      ),
      county: normalized.slice(normalized.length - countyName.length),
    };
  }

  return null;
}

function splitExactRepeatedValue(
  value: string
): { first: string; second: string } | null {
  const words = normalizeWhitespace(value).split(" ");
  if (words.length < 2 || words.length % 2 !== 0) return null;
  const midpoint = words.length / 2;
  const first = words.slice(0, midpoint).join(" ");
  const second = words.slice(midpoint).join(" ");
  return first === second ? { first, second } : null;
}

function recoverOfficialMergedCells(columns: string[]): string[] {
  if (columns[2] || !columns[3] || !columns[4] || !columns[5]) return columns;

  for (const sourceColumn of [1, 0]) {
    const recovered = removeMergedCountySuffix(columns[sourceColumn]);
    if (!recovered) continue;

    const next = [...columns];
    next[sourceColumn] = recovered.value;
    next[2] = recovered.county;

    if (sourceColumn === 0 && !next[1]) {
      const repeated = splitExactRepeatedValue(next[0]);
      if (repeated) {
        next[0] = repeated.first;
        next[1] = repeated.second;
      }
    }
    return next;
  }

  return columns;
}

function layoutTextItemPage(
  items: IllinoisBackToBusinessTextItem[],
  page: number
): string {
  const columnStarts = COLUMN_HEADERS.map((header) =>
    headerStart(items, header, page)
  );
  for (let index = 1; index < columnStarts.length; index += 1) {
    if (columnStarts[index] <= columnStarts[index - 1]) {
      throw new IllinoisBackToBusinessLayoutError(
        `Page ${page} has non-increasing B2B column coordinates.`,
        page
      );
    }
  }

  return groupVisualLines(items)
    .map((visualLine) => {
      const columns: IllinoisBackToBusinessTextItem[][] = Array.from(
        { length: COLUMN_HEADERS.length },
        () => []
      );
      visualLine.items.forEach((item) => {
        columns[itemColumnIndex(item.x, columnStarts)].push(item);
      });
      const values = columns.map((columnItems) =>
          normalizeWhitespace(
            columnItems
              .sort((left, right) => left.x - right.x)
              .map((item) => item.str)
              .join(" ")
          )
        );
      return recoverOfficialMergedCells(values).join("\t");
    })
    .join("\n");
}

export class IllinoisBackToBusinessLayoutError extends Error {
  readonly page: number;

  constructor(message: string, page: number) {
    super(message);
    this.name = "IllinoisBackToBusinessLayoutError";
    this.page = page;
  }
}

/**
 * Uses the PDF's published column coordinates before parsing. This avoids
 * guessing where a legal name ends and a DBA begins after text extraction.
 */
export function layoutIllinoisBackToBusinessTextItemPages(
  pages: IllinoisBackToBusinessTextItem[][]
): string[] {
  return pages.map((items, index) => layoutTextItemPage(items, index + 1));
}

export function parseIllinoisBackToBusinessTextItemPages(
  pages: IllinoisBackToBusinessTextItem[][],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {}
): IllinoisBackToBusinessParseResult {
  return parseIllinoisBackToBusinessPages(
    layoutIllinoisBackToBusinessTextItemPages(pages),
    options
  );
}

export function summarizeIllinoisBackToBusiness(
  result: Pick<IllinoisBackToBusinessParseResult, "records" | "pageCount">
): IllinoisBackToBusinessSummary {
  const amounts = result.records.map((record) => record.awardAmountUsd);
  return {
    pageCount: result.pageCount,
    rowCount: result.records.length,
    totalAwardUsd: amounts.reduce((sum, amount) => sum + amount, 0),
    minimumAwardUsd: amounts.length > 0 ? Math.min(...amounts) : 0,
    maximumAwardUsd: amounts.length > 0 ? Math.max(...amounts) : 0,
  };
}

export class IllinoisBackToBusinessIntegrityError extends Error {
  readonly summary: IllinoisBackToBusinessSummary;

  constructor(message: string, summary: IllinoisBackToBusinessSummary) {
    super(message);
    this.name = "IllinoisBackToBusinessIntegrityError";
    this.summary = summary;
  }
}

export function assertIllinoisBackToBusinessIntegrity(
  result: IllinoisBackToBusinessParseResult,
  expectations: IllinoisBackToBusinessExpectations =
    ILLINOIS_BACK_TO_BUSINESS_FULL_SOURCE_EXPECTATIONS
): IllinoisBackToBusinessSummary {
  const summary = summarizeIllinoisBackToBusiness(result);
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
    {
      label: "pages",
      actual: summary.pageCount,
      expected: expectations.pageCount,
    },
    {
      label: "rows",
      actual: summary.rowCount,
      expected: expectations.rowCount,
    },
    {
      label: "total award",
      actual: summary.totalAwardUsd,
      expected: expectations.totalAwardUsd,
      currency: true,
    },
    {
      label: "minimum award",
      actual: summary.minimumAwardUsd,
      expected: expectations.minimumAwardUsd,
      currency: true,
    },
    {
      label: "maximum award",
      actual: summary.maximumAwardUsd,
      expected: expectations.maximumAwardUsd,
      currency: true,
    },
  ];

  for (const check of numericChecks) {
    if (check.expected == null || check.actual === check.expected) continue;
    const expected = check.currency
      ? `$${check.expected.toLocaleString("en-US")}`
      : check.expected.toLocaleString("en-US");
    const actual = check.currency
      ? `$${check.actual.toLocaleString("en-US")}`
      : check.actual.toLocaleString("en-US");
    problems.push(`expected ${check.label} ${expected}, parsed ${actual}`);
  }

  if (
    expectations.sourceVersion != null &&
    result.sourceVersion !== expectations.sourceVersion
  ) {
    problems.push(
      `expected source version ${expectations.sourceVersion}, parsed ${result.sourceVersion}`
    );
  }

  if (problems.length > 0) {
    throw new IllinoisBackToBusinessIntegrityError(
      `Illinois Back to Business integrity check failed: ${problems.join("; ")}.`,
      summary
    );
  }

  return summary;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeIllinoisBackToBusinessCsv(
  records: IllinoisBackToBusinessRecord[]
): string {
  const headers = [
    "legal_business_name",
    "dba",
    "county",
    "city",
    "zip",
    "award_amount_usd",
    "source_url",
    "source_version",
    "program_name",
    "funding_source",
    "assistance_type",
    "award_status",
    "record_note",
  ];
  const rows = records.map((record) =>
    [
      record.legalBusinessName,
      record.dba,
      record.county,
      record.city,
      record.zip,
      record.awardAmountUsd,
      record.sourceUrl,
      record.sourceVersion,
      record.programName,
      record.fundingSource,
      record.assistanceType,
      record.awardStatus,
      record.recordNote,
    ]
      .map(csvEscape)
      .join(",")
  );
  return `${[headers.join(","), ...rows].join("\n")}\n`;
}
