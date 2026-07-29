export const ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL =
  "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/smallbizassistance/documents/bigawardsall.pdf";

export const ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_SOURCE_VERSION =
  "2021-04-09";

export const ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS = {
  programName: "Illinois Business Interruption Grant (BIG) Program",
  reliefEra: "CARES Act (2020)",
  assistanceType: "grant",
  programStatus: "historical_closed",
  recordNote: "Historical CARES Act-funded grant award from a closed program.",
} as const;

/**
 * Exact values calculated from the dated official 135-page awardee PDF.
 * Publication fails closed if any value or source version changes.
 */
export const ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS = {
  pageCount: 135,
  rowCount: 8_998,
  totalGrantUsd: 276_275_000,
  minimumGrantUsd: 5_000,
  maximumGrantUsd: 150_000,
  round1RowCount: 2_802,
  round1TotalGrantUsd: 48_600_000,
  round2RowCount: 6_196,
  round2TotalGrantUsd: 227_675_000,
  sourceVersion: ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_SOURCE_VERSION,
} as const;

export type IllinoisBusinessInterruptionGrantRound = "Round 1" | "Round 2";

export interface IllinoisBusinessInterruptionGrantRecord {
  sourceRowNumber: number;
  legalBusinessName: string;
  dba: string;
  city: string;
  county: string;
  zip: string;
  grantAmountUsd: number;
  round: IllinoisBusinessInterruptionGrantRound;
  sourceUrl: string;
  sourceVersion: string;
  programName:
    typeof ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.programName;
  reliefEra: typeof ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.reliefEra;
  assistanceType:
    typeof ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.assistanceType;
  programStatus:
    typeof ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.programStatus;
  recordNote:
    typeof ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS.recordNote;
}

export interface IllinoisBusinessInterruptionGrantTextItem {
  str: string;
  x: number;
  y: number;
  width?: number;
}

export type IllinoisBusinessInterruptionGrantParseIssueCode =
  | "missing_page_header"
  | "malformed_line"
  | "malformed_row"
  | "incomplete_row";

export interface IllinoisBusinessInterruptionGrantParseIssue {
  code: IllinoisBusinessInterruptionGrantParseIssueCode;
  page: number;
  line: number;
  text: string;
  message: string;
}

export interface IllinoisBusinessInterruptionGrantParseResult {
  records: IllinoisBusinessInterruptionGrantRecord[];
  issues: IllinoisBusinessInterruptionGrantParseIssue[];
  pageCount: number;
  sourceVersion: string;
}

export interface IllinoisBusinessInterruptionGrantSummary {
  pageCount: number;
  rowCount: number;
  totalGrantUsd: number;
  minimumGrantUsd: number;
  maximumGrantUsd: number;
  round1RowCount: number;
  round1TotalGrantUsd: number;
  round2RowCount: number;
  round2TotalGrantUsd: number;
}

export interface IllinoisBusinessInterruptionGrantExpectations {
  pageCount?: number;
  rowCount?: number;
  totalGrantUsd?: number;
  minimumGrantUsd?: number;
  maximumGrantUsd?: number;
  round1RowCount?: number;
  round1TotalGrantUsd?: number;
  round2RowCount?: number;
  round2TotalGrantUsd?: number;
  sourceVersion?: string;
}

interface PendingRow {
  columns: string[][];
  page: number;
  line: number;
  sourceLines: string[];
}

interface CandidateRow {
  columns: string[];
  page: number;
  line: number;
  sourceLines: string[];
}

const COLUMN_HEADERS = [
  "Business Name",
  "Doing Business As",
  "City",
  "County",
  "Zip",
  "Grant Size",
  "Round 1/2",
] as const;

const VISUAL_LINE_Y_TOLERANCE = 0.75;
const COLUMN_START_TOLERANCE = 0.75;
const ILLINOIS_COUNTY_NAMES = [
  "Adams",
  "Alexander",
  "Bond",
  "Boone",
  "Brown",
  "Bureau",
  "Calhoun",
  "Carroll",
  "Cass",
  "Champaign",
  "Christian",
  "Clark",
  "Clay",
  "Clinton",
  "Coles",
  "Cook",
  "Crawford",
  "Cumberland",
  "De Witt",
  "DeKalb",
  "Douglas",
  "DuPage",
  "Edgar",
  "Edwards",
  "Effingham",
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
  "Henderson",
  "Henry",
  "Iroquois",
  "Jackson",
  "Jasper",
  "Jefferson",
  "Jersey",
  "Jo Daviess",
  "Johnson",
  "Kane",
  "Kankakee",
  "Kendall",
  "Knox",
  "La Salle",
  "Lake",
  "Lawrence",
  "Lee",
  "Livingston",
  "Logan",
  "Macon",
  "Macoupin",
  "Madison",
  "Marion",
  "Marshall",
  "Mason",
  "Massac",
  "McDonough",
  "McHenry",
  "McLean",
  "Menard",
  "Mercer",
  "Monroe",
  "Montgomery",
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
  "Rock Island",
  "Saline",
  "Sangamon",
  "Schuyler",
  "Scott",
  "Shelby",
  "St. Clair",
  "Stark",
  "Stephenson",
  "Tazewell",
  "Union",
  "Vermilion",
  "Wabash",
  "Warren",
  "Washington",
  "Wayne",
  "White",
  "Whiteside",
  "Will",
  "Williamson",
  "Winnebago",
  "Woodford",
] as const;

const COUNTY_BY_KEY = new Map(
  ILLINOIS_COUNTY_NAMES.map((county) => [
    county.toLowerCase().replace(/[^a-z]/g, ""),
    county,
  ])
);
COUNTY_BY_KEY.set("saintclair", "St. Clair");

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function countyKey(value: string): string {
  return normalizedKey(value).replace(/[^a-z]/g, "");
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

export function extractIllinoisBusinessInterruptionGrantsVersion(
  pages: string[]
): string | null {
  const headerText = pages.slice(0, 3).join("\n");
  const match = headerText.match(
    /Business Interruption Grant \(BIG\) Awardees[\s\S]{0,120}?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
  );
  return match ? parseIsoDate(match[1], match[2], match[3]) : null;
}

export function parseIllinoisBusinessInterruptionGrantUsdAmount(
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

export function normalizeIllinoisBusinessInterruptionGrantZip(
  value: string
): string | null {
  const normalized = value.trim();
  return /^\d{5}$/.test(normalized) ? normalized : null;
}

export function normalizeIllinoisBusinessInterruptionGrantCounty(
  value: string
): string | null {
  return COUNTY_BY_KEY.get(countyKey(value)) ?? null;
}

export function normalizeIllinoisBusinessInterruptionGrantCity(
  value: string
): string | null {
  const normalized = normalizeWhitespace(value);
  return normalized && !/[\t\r\n]/.test(normalized) ? normalized : null;
}

function normalizeRound(
  value: string
): IllinoisBusinessInterruptionGrantRound | null {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (normalized === "round 1") return "Round 1";
  if (normalized === "round 2") return "Round 2";
  return null;
}

function isDocumentTitle(line: string): boolean {
  return /^Business Interruption Grant \(BIG\) Awardees(?:\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})?$/i.test(
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
  return pending.columns.map((parts) => normalizeWhitespace(parts.join(" ")));
}

function removeCountySuffix(
  value: string
): { value: string; county: string } | null {
  const normalized = normalizeWhitespace(value);
  const compactLower = normalized.toLowerCase().replace(/[^a-z]/g, "");
  for (const county of ILLINOIS_COUNTY_NAMES) {
    const countyLower = county.toLowerCase().replace(/[^a-z]/g, "");
    if (
      !compactLower.endsWith(countyLower) ||
      compactLower === countyLower
    ) {
      continue;
    }
    const sourcePattern = county
      .split(/[\s.]+/)
      .filter(Boolean)
      .join("[\\s.]*");
    const match = normalized.match(new RegExp(`${sourcePattern}$`, "i"));
    if (!match || match.index == null) continue;
    return {
      value: normalizeWhitespace(normalized.slice(0, match.index)),
      county,
    };
  }
  return null;
}

function recoverCounty(columns: string[]): string[] {
  if (normalizeIllinoisBusinessInterruptionGrantCounty(columns[3])) {
    return columns;
  }
  for (const sourceColumn of [2, 1, 0]) {
    const recovered = removeCountySuffix(columns[sourceColumn]);
    if (!recovered) continue;
    const next = [...columns];
    next[sourceColumn] = recovered.value;
    next[3] = recovered.county;
    return next;
  }
  return columns;
}

function removeObservedCitySuffix(
  value: string,
  observedCities: string[]
): { value: string; city: string } | null {
  const normalized = normalizeWhitespace(value);
  const lower = normalized.toLowerCase();
  for (const city of observedCities) {
    const cityLower = city.toLowerCase();
    if (!lower.endsWith(cityLower) || lower === cityLower) continue;
    const start = normalized.length - city.length;
    return {
      value: normalizeWhitespace(normalized.slice(0, start)),
      city,
    };
  }
  return null;
}

function splitExactRepeatedValue(
  value: string
): { first: string; second: string } | null {
  const normalized = normalizeWhitespace(value);
  if (normalized.length >= 2 && normalized.length % 2 === 0) {
    const midpoint = normalized.length / 2;
    const first = normalizeWhitespace(normalized.slice(0, midpoint));
    const second = normalizeWhitespace(normalized.slice(midpoint));
    if (first && first === second) return { first, second };
  }

  const words = normalized.split(" ");
  if (words.length < 4 || words.length % 2 !== 0) return null;
  const midpoint = words.length / 2;
  const first = words.slice(0, midpoint).join(" ");
  const second = words.slice(midpoint).join(" ");
  return first === second ? { first, second } : null;
}

function recoverCity(columns: string[], observedCities: string[]): string[] {
  if (normalizeIllinoisBusinessInterruptionGrantCity(columns[2])) return columns;
  const county = normalizeIllinoisBusinessInterruptionGrantCounty(columns[3]);

  if (county) {
    const countyPattern = county
      .replace(/^St\.\s+/i, "(?:St\\.?|Saint)\\s+")
      .split(/\s+/)
      .join("\\s+");
    const unincorporatedPattern = new RegExp(
      `(Uninc\\s+${countyPattern}\\s+County)$`,
      "i"
    );
    for (const sourceColumn of [1, 0]) {
      const match = columns[sourceColumn].match(unincorporatedPattern);
      if (!match || match.index == null) continue;
      const next = [...columns];
      next[sourceColumn] = normalizeWhitespace(
        next[sourceColumn].slice(0, match.index)
      );
      next[2] = normalizeWhitespace(match[1]);
      if (sourceColumn === 0 && !next[1]) {
        const repeated = splitExactRepeatedValue(next[0]);
        if (repeated) {
          next[0] = repeated.first;
          next[1] = repeated.second;
        }
      }
      return next;
    }
  }

  for (const sourceColumn of [1, 0]) {
    const recovered = removeObservedCitySuffix(
      columns[sourceColumn],
      observedCities
    );
    if (!recovered) continue;
    const next = [...columns];
    next[sourceColumn] = recovered.value;
    next[2] = recovered.city;
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

function buildRecord(
  candidate: CandidateRow,
  sourceRowNumber: number,
  sourceUrl: string,
  sourceVersion: string,
  observedCities: string[]
): IllinoisBusinessInterruptionGrantRecord | null {
  const columns = recoverCity(recoverCounty(candidate.columns), observedCities);
  let [legalBusinessName, dba] = columns;
  const [, , rawCity, rawCounty, rawZip, rawGrant, rawRound] = columns;
  if (!dba) {
    const repeated = splitExactRepeatedValue(legalBusinessName);
    if (repeated) {
      legalBusinessName = repeated.first;
      dba = repeated.second;
    }
  }
  const city = normalizeIllinoisBusinessInterruptionGrantCity(rawCity);
  const county = normalizeIllinoisBusinessInterruptionGrantCounty(rawCounty);
  const zip = normalizeIllinoisBusinessInterruptionGrantZip(rawZip);
  const grantAmountUsd =
    parseIllinoisBusinessInterruptionGrantUsdAmount(rawGrant);
  const round = normalizeRound(rawRound);

  if (
    !legalBusinessName ||
    !city ||
    !county ||
    !zip ||
    grantAmountUsd == null ||
    !round
  ) {
    return null;
  }

  return {
    sourceRowNumber,
    legalBusinessName: normalizeWhitespace(legalBusinessName),
    dba: normalizeWhitespace(dba),
    city,
    county,
    zip,
    grantAmountUsd,
    round,
    sourceUrl,
    sourceVersion,
    ...ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_LABELS,
  };
}

/**
 * Parses tab-delimited extracted pages. Every visual line has seven cells in
 * official column order, while a source row may span more than one visual line.
 */
export function parseIllinoisBusinessInterruptionGrantPages(
  pages: string[],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {}
): IllinoisBusinessInterruptionGrantParseResult {
  const sourceUrl =
    options.sourceUrl ?? ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_PDF_URL;
  const sourceVersion =
    options.sourceVersion ??
    extractIllinoisBusinessInterruptionGrantsVersion(pages);
  if (!sourceVersion || !/^\d{4}-\d{2}-\d{2}$/.test(sourceVersion)) {
    throw new Error(
      "Illinois BIG source version is missing or invalid; pass an ISO sourceVersion or provide the dated official document header."
    );
  }

  const candidates: CandidateRow[] = [];
  const issues: IllinoisBusinessInterruptionGrantParseIssue[] = [];

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
        issues.push({
          code: "malformed_line",
          page,
          line,
          text: normalizedLine,
          message:
            "Expected seven tab-delimited cells in the official BIG column order.",
        });
        return;
      }

      const normalizedColumns = columns.map(normalizeWhitespace);
      if (isColumnHeader(normalizedColumns)) {
        sawColumnHeader = true;
        return;
      }
      if (normalizedColumns.every((value) => !value)) return;

      if (!pendingHasContent(pending)) pending = emptyPendingRow(page, line);
      pending.sourceLines.push(normalizedLine);
      normalizedColumns.forEach((value, columnIndex) => {
        if (value) pending.columns[columnIndex].push(value);
      });

      if (!normalizedColumns[6]) return;
      candidates.push({
        columns: joinedPendingColumns(pending),
        page: pending.page,
        line: pending.line,
        sourceLines: [...pending.sourceLines],
      });
      pending = emptyPendingRow(page, line + 1);
    });

    if (pendingHasContent(pending)) {
      issues.push({
        code: "incomplete_row",
        page: pending.page,
        line: pending.line,
        text: pending.sourceLines.join(" | "),
        message: "The page ended before this row supplied a round value.",
      });
    }
    if (!sawTitle || !sawColumnHeader) {
      issues.push({
        code: "missing_page_header",
        page,
        line: 1,
        text: lines.slice(0, 3).map(normalizeWhitespace).join(" | "),
        message:
          "The page is missing the official document title or seven-column header.",
      });
    }
  });

  const observedCities = Array.from(
    new Set(
      candidates
        .map((candidate) => recoverCounty(candidate.columns))
        .filter((columns) =>
          Boolean(
            normalizeIllinoisBusinessInterruptionGrantCounty(columns[3]) &&
              normalizeIllinoisBusinessInterruptionGrantCity(columns[2])
          )
        )
        .map((columns) => normalizeWhitespace(columns[2]))
    )
  ).sort((left, right) => right.length - left.length || left.localeCompare(right));

  const records: IllinoisBusinessInterruptionGrantRecord[] = [];
  candidates.forEach((candidate, index) => {
    const record = buildRecord(
      candidate,
      index + 1,
      sourceUrl,
      sourceVersion,
      observedCities
    );
    if (record) {
      records.push(record);
      return;
    }
    issues.push({
      code: "malformed_row",
      page: candidate.page,
      line: candidate.line,
      text: candidate.sourceLines.join(" | "),
      message:
        "Completed row is missing a legal business name, normalized city/county, valid five-digit ZIP, exact dollar grant, or Round 1/2 value.",
    });
  });

  return {
    records,
    issues,
    pageCount: pages.length,
    sourceVersion,
  };
}

function headerStart(
  items: IllinoisBusinessInterruptionGrantTextItem[],
  header: (typeof COLUMN_HEADERS)[number],
  page: number
): number {
  const matches = items.filter(
    (item) => normalizeWhitespace(item.str) === header
  );
  if (matches.length !== 1 || !Number.isFinite(matches[0]?.x)) {
    throw new IllinoisBusinessInterruptionGrantLayoutError(
      `Page ${page} must contain exactly one "${header}" header item.`,
      page
    );
  }
  return matches[0].x;
}

function groupVisualLines(
  items: IllinoisBusinessInterruptionGrantTextItem[]
): Array<{ y: number; items: IllinoisBusinessInterruptionGrantTextItem[] }> {
  const sorted = items
    .filter(
      (item) =>
        normalizeWhitespace(item.str) &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y)
    )
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{
    y: number;
    items: IllinoisBusinessInterruptionGrantTextItem[];
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
  items: IllinoisBusinessInterruptionGrantTextItem[],
  page: number
): string {
  const columnStarts = COLUMN_HEADERS.map((header) =>
    headerStart(items, header, page)
  );
  for (let index = 1; index < columnStarts.length; index += 1) {
    if (columnStarts[index] <= columnStarts[index - 1]) {
      throw new IllinoisBusinessInterruptionGrantLayoutError(
        `Page ${page} has non-increasing BIG column coordinates.`,
        page
      );
    }
  }

  return groupVisualLines(items)
    .map((visualLine) => {
      const columns: IllinoisBusinessInterruptionGrantTextItem[][] = Array.from(
        { length: COLUMN_HEADERS.length },
        () => []
      );
      visualLine.items.forEach((item) => {
        columns[itemColumnIndex(item.x, columnStarts)].push(item);
      });
      return columns
        .map((columnItems) =>
          normalizeWhitespace(
            columnItems
              .sort((left, right) => left.x - right.x)
              .map((item) => item.str)
              .join(" ")
          )
        )
        .join("\t");
    })
    .join("\n");
}

export class IllinoisBusinessInterruptionGrantLayoutError extends Error {
  readonly page: number;

  constructor(message: string, page: number) {
    super(message);
    this.name = "IllinoisBusinessInterruptionGrantLayoutError";
    this.page = page;
  }
}

export function layoutIllinoisBusinessInterruptionGrantTextItemPages(
  pages: IllinoisBusinessInterruptionGrantTextItem[][]
): string[] {
  return pages.map((items, index) => layoutTextItemPage(items, index + 1));
}

export function parseIllinoisBusinessInterruptionGrantTextItemPages(
  pages: IllinoisBusinessInterruptionGrantTextItem[][],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {}
): IllinoisBusinessInterruptionGrantParseResult {
  return parseIllinoisBusinessInterruptionGrantPages(
    layoutIllinoisBusinessInterruptionGrantTextItemPages(pages),
    options
  );
}

export function summarizeIllinoisBusinessInterruptionGrants(
  result: Pick<
    IllinoisBusinessInterruptionGrantParseResult,
    "records" | "pageCount"
  >
): IllinoisBusinessInterruptionGrantSummary {
  const round1 = result.records.filter((record) => record.round === "Round 1");
  const round2 = result.records.filter((record) => record.round === "Round 2");
  const amounts = result.records.map((record) => record.grantAmountUsd);
  return {
    pageCount: result.pageCount,
    rowCount: result.records.length,
    totalGrantUsd: amounts.reduce((sum, amount) => sum + amount, 0),
    minimumGrantUsd: amounts.length > 0 ? Math.min(...amounts) : 0,
    maximumGrantUsd: amounts.length > 0 ? Math.max(...amounts) : 0,
    round1RowCount: round1.length,
    round1TotalGrantUsd: round1.reduce(
      (sum, record) => sum + record.grantAmountUsd,
      0
    ),
    round2RowCount: round2.length,
    round2TotalGrantUsd: round2.reduce(
      (sum, record) => sum + record.grantAmountUsd,
      0
    ),
  };
}

export class IllinoisBusinessInterruptionGrantIntegrityError extends Error {
  readonly summary: IllinoisBusinessInterruptionGrantSummary;

  constructor(
    message: string,
    summary: IllinoisBusinessInterruptionGrantSummary
  ) {
    super(message);
    this.name = "IllinoisBusinessInterruptionGrantIntegrityError";
    this.summary = summary;
  }
}

export function assertIllinoisBusinessInterruptionGrantIntegrity(
  result: IllinoisBusinessInterruptionGrantParseResult,
  expectations: IllinoisBusinessInterruptionGrantExpectations =
    ILLINOIS_BUSINESS_INTERRUPTION_GRANTS_FULL_SOURCE_EXPECTATIONS
): IllinoisBusinessInterruptionGrantSummary {
  const summary = summarizeIllinoisBusinessInterruptionGrants(result);
  const problems: string[] = [];
  if (result.issues.length > 0) {
    problems.push(`${result.issues.length} parser issue(s)`);
  }

  const checks: Array<{
    label: string;
    actual: number;
    expected: number | undefined;
    currency?: boolean;
  }> = [
    { label: "pages", actual: summary.pageCount, expected: expectations.pageCount },
    { label: "rows", actual: summary.rowCount, expected: expectations.rowCount },
    {
      label: "total grant",
      actual: summary.totalGrantUsd,
      expected: expectations.totalGrantUsd,
      currency: true,
    },
    {
      label: "minimum grant",
      actual: summary.minimumGrantUsd,
      expected: expectations.minimumGrantUsd,
      currency: true,
    },
    {
      label: "maximum grant",
      actual: summary.maximumGrantUsd,
      expected: expectations.maximumGrantUsd,
      currency: true,
    },
    {
      label: "Round 1 rows",
      actual: summary.round1RowCount,
      expected: expectations.round1RowCount,
    },
    {
      label: "Round 1 total",
      actual: summary.round1TotalGrantUsd,
      expected: expectations.round1TotalGrantUsd,
      currency: true,
    },
    {
      label: "Round 2 rows",
      actual: summary.round2RowCount,
      expected: expectations.round2RowCount,
    },
    {
      label: "Round 2 total",
      actual: summary.round2TotalGrantUsd,
      expected: expectations.round2TotalGrantUsd,
      currency: true,
    },
  ];

  for (const check of checks) {
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
    throw new IllinoisBusinessInterruptionGrantIntegrityError(
      `Illinois Business Interruption Grant integrity check failed: ${problems.join(
        "; "
      )}.`,
      summary
    );
  }
  return summary;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeIllinoisBusinessInterruptionGrantCsv(
  records: IllinoisBusinessInterruptionGrantRecord[]
): string {
  const headers = [
    "source_row_number",
    "legal_business_name",
    "dba",
    "city",
    "county",
    "zip",
    "grant_amount_usd",
    "round",
    "source_url",
    "source_version",
    "program_name",
    "relief_era",
    "assistance_type",
    "program_status",
    "record_note",
  ];
  const rows = records.map((record) =>
    [
      record.sourceRowNumber,
      record.legalBusinessName,
      record.dba,
      record.city,
      record.county,
      record.zip,
      record.grantAmountUsd,
      record.round,
      record.sourceUrl,
      record.sourceVersion,
      record.programName,
      record.reliefEra,
      record.assistanceType,
      record.programStatus,
      record.recordNote,
    ]
      .map(csvEscape)
      .join(",")
  );
  return `${[headers.join(","), ...rows].join("\n")}\n`;
}
