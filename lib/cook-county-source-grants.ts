export const COOK_COUNTY_SOURCE_GRANTS_PDF_URL =
  "https://cookcountysmallbiz.org/wp-content/uploads/2024/11/2023-Source-Grant-Awardee-List-a.o-11.20.24_.pdf";

export const COOK_COUNTY_SOURCE_GRANTS_PROGRAM_CONTEXT_URL =
  "https://cookcountysmallbiz.org/the-2023-source-grant-program-50-million-distributed-to-3000-small-businesses/";

export const COOK_COUNTY_SOURCE_GRANTS_SOURCE_VERSION = "2024-11-20";

export const COOK_COUNTY_SOURCE_GRANTS_CLASSIFICATION = {
  visibility: "private_admin_source",
  programState: "historical_award",
} as const;

export const COOK_COUNTY_SOURCE_GRANTS_OFFICIAL_PROGRAM_HEADLINE = {
  rowCount: 3_000,
  totalAwardUsd: 50_000_000,
  sourceUrl: COOK_COUNTY_SOURCE_GRANTS_PROGRAM_CONTEXT_URL,
} as const;

export const COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS = {
  pageCount: 74,
  rowCount: 3_003,
  totalAwardUsd: 50_050_000,
} as const;

export interface CookCountySourceGrantRecord {
  awardeeName: string;
  awardAmountUsd: number;
  municipality: string;
  zip: string;
  sourceUrl: string;
  sourceVersion: string;
}

export type CookCountySourceGrantParseIssueCode =
  | "incomplete_row"
  | "malformed_row"
  | "orphan_text"
  | "suspect_municipality_fragment";

export interface CookCountySourceGrantParseIssue {
  code: CookCountySourceGrantParseIssueCode;
  page: number;
  line: number;
  text: string;
  message: string;
}

export interface CookCountySourceGrantParseResult {
  records: CookCountySourceGrantRecord[];
  issues: CookCountySourceGrantParseIssue[];
  pageCount: number;
  sourceVersion: string;
}

export interface CookCountySourceGrantSummary {
  pageCount: number;
  rowCount: number;
  totalAwardUsd: number;
}

export interface CookCountySourceGrantExpectations {
  pageCount?: number;
  rowCount?: number;
  totalAwardUsd?: number;
}

interface PartialRow {
  awardeeName: string;
  awardAmountUsd: number;
  municipalityParts: string[];
  page: number;
  line: number;
  sourceText: string;
}

const MONEY_PATTERN = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?`;
const COMPLETE_ROW_PATTERN = new RegExp(
  String.raw`^(.+?)\s+\$\s*(${MONEY_PATTERN})\s+(.+?)\s+(\d{1,5}(?:-\d{4})?)$`
);
const PARTIAL_ROW_PATTERN = new RegExp(
  String.raw`^(.+?)\s+\$\s*(${MONEY_PATTERN})\s+(.+)$`
);

/**
 * Characters and tokens that occur in AWARDEE NAMES but not in Illinois
 * municipality names: a comma, an ampersand, or a corporate-form suffix. Used to
 * flag a wrapped line that is about to be appended to the municipality when it
 * is far more likely a continuation of the business name.
 *
 * Deliberately narrow. "Oak Park", "Chicago Heights", "La Grange Park", and
 * "Mount Prospect" are all multi-word and must NOT trip it; only these markers do.
 */
const ENTITY_NAME_MARKER_RE =
  /[,&]|\b(?:INC|LLC|L\.L\.C|LTD|CORP|CO|COMPANY|PLLC|LLP|LP|PC|DBA|ENTERPRISES|HOLDINGS|GROUP|SERVICES|PROGRAM)\b\.?/i;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isDocumentNoise(line: string): boolean {
  return (
    /^Cook County Small Business Source 2023 Source Grant(?:\s+List as of .+)?$/i.test(line) ||
    /^\d{1,3}$/.test(line) ||
    /^Awardee\s+Award Amount\s+City\s+Zip$/i.test(line)
  );
}

function isColumnHeader(line: string): boolean {
  return /^Awardee\s+Award Amount\s+City\s+Zip$/i.test(line);
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
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

export function extractCookCountySourceGrantVersion(pages: string[]): string | null {
  const headerText = pages.slice(0, 3).join("\n");
  const match = headerText.match(
    /List as of (January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
  );
  return match ? parseIsoDate(match[1], match[2], match[3]) : null;
}

export function parseUsdAmount(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const normalized = value.trim();
  if (!/^\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeZipCode(value: string | number): string | null {
  const normalized = String(value).trim();
  const zipPlusFourMatch = normalized.match(/^(\d{1,5})-(\d{4})$/);
  if (zipPlusFourMatch) {
    return `${zipPlusFourMatch[1].padStart(5, "0")}-${zipPlusFourMatch[2]}`;
  }
  if (!/^\d{1,5}$/.test(normalized)) return null;
  return normalized.padStart(5, "0");
}

function buildRecord(
  awardeeName: string,
  awardAmountUsd: number,
  municipality: string,
  zip: string,
  sourceUrl: string,
  sourceVersion: string
): CookCountySourceGrantRecord | null {
  const normalizedAwardeeName = normalizeWhitespace(awardeeName);
  const normalizedMunicipality = normalizeWhitespace(municipality);
  const normalizedZip = normalizeZipCode(zip);
  if (!normalizedAwardeeName || !normalizedMunicipality || !normalizedZip) return null;

  return {
    awardeeName: normalizedAwardeeName,
    awardAmountUsd,
    municipality: normalizedMunicipality,
    zip: normalizedZip,
    sourceUrl,
    sourceVersion,
  };
}

function recordIssue(
  issues: CookCountySourceGrantParseIssue[],
  issue: CookCountySourceGrantParseIssue
): void {
  issues.push(issue);
}

export function parseCookCountySourceGrantPages(
  pages: string[],
  options: {
    sourceUrl?: string;
    sourceVersion?: string;
  } = {}
): CookCountySourceGrantParseResult {
  const sourceUrl = options.sourceUrl ?? COOK_COUNTY_SOURCE_GRANTS_PDF_URL;
  const sourceVersion =
    options.sourceVersion ?? extractCookCountySourceGrantVersion(pages);
  if (!sourceVersion) {
    throw new Error(
      "Cook County Source Grant source version is missing; pass sourceVersion or provide a document header with 'List as of ...'."
    );
  }

  const records: CookCountySourceGrantRecord[] = [];
  const issues: CookCountySourceGrantParseIssue[] = [];
  const pendingNameLines: Array<{ page: number; line: number; text: string }> = [];
  let partialRow: PartialRow | null = null;

  const finishPartialRow = (
    zip: string,
    finalMunicipalityPart?: string
  ): CookCountySourceGrantRecord | null => {
    if (!partialRow) return null;
    const municipalityParts = finalMunicipalityPart
      ? [...partialRow.municipalityParts, finalMunicipalityPart]
      : partialRow.municipalityParts;
    return buildRecord(
      partialRow.awardeeName,
      partialRow.awardAmountUsd,
      municipalityParts.join(" "),
      zip,
      sourceUrl,
      sourceVersion
    );
  };

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    pageText.split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const lineNumber = lineIndex + 1;
      const line = normalizeWhitespace(rawLine);
      if (!line) return;

      if (isDocumentNoise(line)) {
        if (isColumnHeader(line)) pendingNameLines.length = 0;
        return;
      }

      if (partialRow && !line.includes("$")) {
        const zipOnly = normalizeZipCode(line);
        if (zipOnly && /^\d{1,5}(?:-\d{4})?$/.test(line)) {
          const record = finishPartialRow(zipOnly);
          if (record) records.push(record);
          partialRow = null;
          return;
        }

        const locationWithZip = line.match(/^(.+?)\s+(\d{1,5}(?:-\d{4})?)$/);
        if (locationWithZip) {
          const record = finishPartialRow(locationWithZip[2], locationWithZip[1]);
          if (record) records.push(record);
          partialRow = null;
          return;
        }

        // The one uninstrumented path in this parser. Once a `$` line lands
        // without a trailing ZIP, every later non-`$` line was appended to the
        // municipality UNCONDITIONALLY — no check that the fragment looks like a
        // place name rather than a continuation of the awardee name.
        //
        // Corruption here is invisible to assertCookCountySourceGrantIntegrity:
        // the row still parses, so rowCount stays 3,003, the amount is untouched
        // so totalAwardUsd stays $50,050,000, pageCount is unchanged, and issues
        // stays empty. All four assertions pass and the bad row is written to
        // the CSV. Downstream the row is silently dropped from the map (the
        // export's Chicago filter is an exact `municipality === "CHICAGO"`
        // match), so the Chicago count quietly falls by one with no error
        // anywhere in the pipeline.
        //
        // Recording an issue is enough to close it: the integrity gate throws on
        // issues.length > 0, so a corrupted row now fails the import loudly
        // instead of publishing. The wrap fragments this document actually
        // produces ("Inc.", "Educational Program Inc.", "Precision Tools And
        // Equipment Services, Llc") are all trivially distinguishable from real
        // Illinois municipality names ("Highlands", "Oak Park").
        if (ENTITY_NAME_MARKER_RE.test(line)) {
          recordIssue(issues, {
            code: "suspect_municipality_fragment",
            page,
            line: lineNumber,
            text: line,
            message:
              "A wrapped line appended to the municipality carries entity-name markers " +
              "(comma, ampersand, or a corporate suffix), so the awardee name may have " +
              "been truncated into the municipality.",
          });
        }
        partialRow.municipalityParts.push(line);
        return;
      }

      if (partialRow && line.includes("$")) {
        recordIssue(issues, {
          code: "incomplete_row",
          page: partialRow.page,
          line: partialRow.line,
          text: partialRow.sourceText,
          message: "A row with an award amount did not end with a valid ZIP code.",
        });
        partialRow = null;
      }

      if (!line.includes("$")) {
        pendingNameLines.push({ page, line: lineNumber, text: line });
        return;
      }

      const startsWithAmount = line.startsWith("$");
      if (pendingNameLines.length > 0 && !startsWithAmount && records.length > 0) {
        const orphanText = pendingNameLines.map((item) => item.text).join(" ");
        const first = pendingNameLines[0];
        recordIssue(issues, {
          code: "orphan_text",
          page: first.page,
          line: first.line,
          text: orphanText,
          message: "Text between parsed rows was not attached to an award row.",
        });
      }

      const candidate =
        startsWithAmount && pendingNameLines.length > 0
          ? `${pendingNameLines.map((item) => item.text).join(" ")} ${line}`
          : line;
      pendingNameLines.length = 0;

      const completeMatch = candidate.match(COMPLETE_ROW_PATTERN);
      if (completeMatch) {
        const awardAmountUsd = parseUsdAmount(completeMatch[2]);
        const record =
          awardAmountUsd == null
            ? null
            : buildRecord(
                completeMatch[1],
                awardAmountUsd,
                completeMatch[3],
                completeMatch[4],
                sourceUrl,
                sourceVersion
              );
        if (record) {
          records.push(record);
          return;
        }
      }

      const partialMatch = candidate.match(PARTIAL_ROW_PATTERN);
      if (partialMatch) {
        const awardAmountUsd = parseUsdAmount(partialMatch[2]);
        if (awardAmountUsd != null) {
          partialRow = {
            awardeeName: normalizeWhitespace(partialMatch[1]),
            awardAmountUsd,
            municipalityParts: [normalizeWhitespace(partialMatch[3])],
            page,
            line: lineNumber,
            sourceText: candidate,
          };
          return;
        }
      }

      recordIssue(issues, {
        code: "malformed_row",
        page,
        line: lineNumber,
        text: candidate,
        message:
          "A line containing an award marker could not be parsed into awardee, amount, municipality, and ZIP.",
      });
    });
  });

  const unfinishedRow = partialRow as PartialRow | null;
  if (unfinishedRow) {
    recordIssue(issues, {
      code: "incomplete_row",
      page: unfinishedRow.page,
      line: unfinishedRow.line,
      text: unfinishedRow.sourceText,
      message: "The document ended before this row supplied a valid ZIP code.",
    });
  }

  if (pendingNameLines.length > 0 && records.length > 0) {
    const first = pendingNameLines[0];
    recordIssue(issues, {
      code: "orphan_text",
      page: first.page,
      line: first.line,
      text: pendingNameLines.map((item) => item.text).join(" "),
      message: "The document ended with text that was not attached to an award row.",
    });
  }

  return {
    records,
    issues,
    pageCount: pages.length,
    sourceVersion,
  };
}

export function summarizeCookCountySourceGrants(
  result: Pick<CookCountySourceGrantParseResult, "records" | "pageCount">
): CookCountySourceGrantSummary {
  return {
    pageCount: result.pageCount,
    rowCount: result.records.length,
    totalAwardUsd: result.records.reduce(
      (sum, record) => sum + record.awardAmountUsd,
      0
    ),
  };
}

export class CookCountySourceGrantIntegrityError extends Error {
  readonly summary: CookCountySourceGrantSummary;

  constructor(message: string, summary: CookCountySourceGrantSummary) {
    super(message);
    this.name = "CookCountySourceGrantIntegrityError";
    this.summary = summary;
  }
}

export function assertCookCountySourceGrantIntegrity(
  result: CookCountySourceGrantParseResult,
  expectations: CookCountySourceGrantExpectations = COOK_COUNTY_SOURCE_GRANTS_FULL_SOURCE_EXPECTATIONS
): CookCountySourceGrantSummary {
  const summary = summarizeCookCountySourceGrants(result);
  const problems: string[] = [];

  if (result.issues.length > 0) {
    problems.push(`${result.issues.length} parser issue(s)`);
  }
  if (
    expectations.pageCount != null &&
    summary.pageCount !== expectations.pageCount
  ) {
    problems.push(
      `expected ${expectations.pageCount} pages, parsed ${summary.pageCount}`
    );
  }
  if (
    expectations.rowCount != null &&
    summary.rowCount !== expectations.rowCount
  ) {
    problems.push(
      `expected ${expectations.rowCount.toLocaleString("en-US")} rows, parsed ${summary.rowCount.toLocaleString("en-US")}`
    );
  }
  if (
    expectations.totalAwardUsd != null &&
    summary.totalAwardUsd !== expectations.totalAwardUsd
  ) {
    problems.push(
      `expected $${expectations.totalAwardUsd.toLocaleString("en-US")}, parsed $${summary.totalAwardUsd.toLocaleString("en-US")}`
    );
  }

  if (problems.length > 0) {
    throw new CookCountySourceGrantIntegrityError(
      `Cook County Source Grant integrity check failed: ${problems.join("; ")}.`,
      summary
    );
  }

  return summary;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCookCountySourceGrantsCsv(
  records: CookCountySourceGrantRecord[]
): string {
  const headers = [
    "awardee_name",
    "award_amount_usd",
    "municipality",
    "zip",
    "source_url",
    "source_version",
  ];
  const rows = records.map((record) =>
    [
      record.awardeeName,
      record.awardAmountUsd,
      record.municipality,
      record.zip,
      record.sourceUrl,
      record.sourceVersion,
    ]
      .map(csvEscape)
      .join(",")
  );
  return `${[headers.join(","), ...rows].join("\n")}\n`;
}
