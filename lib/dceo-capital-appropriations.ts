/**
 * Deterministic parser for the Illinois DCEO Capital Appropriation List.
 *
 * This source is an appropriation ledger. It is not a list of active NOFOs,
 * confirmed GATA awards, or funding available to a particular project.
 */

export const DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL =
  "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/aboutdceo/grantopportunities/documents/dceo-cap-approp-list.pdf";

export const DCEO_CAPITAL_APPROPRIATIONS_SOURCE_PAGE_URL =
  "https://dceo.illinois.gov/aboutdceo/grantopportunities/capitalgrants.html";

export const DCEO_CAPITAL_APPROPRIATIONS_SOURCE_VERSION =
  "FY26 Capital Appropriation Listings (PDF created 2026-04-10)";

export const DCEO_CAPITAL_APPROPRIATIONS_EXPECTED_PAGES = 885;

export type DceoCapitalAppropriationLineType = "line_item" | "lump_sum";

export interface DceoCapitalAppropriationRecord {
  lineName: string;
  appropriationCode: string;
  appropriatedAmount: number;
  originalDescription: string;
  lineType: DceoCapitalAppropriationLineType;
  explicitProjectAddress: string | null;
  sourceUrl: string;
  sourceVersion: string;
}

export interface DceoCapitalAppropriationGroupBalances {
  lineItem: number;
  lumpSum: number;
  total: number;
}

export interface DceoCapitalAppropriationParseDiagnostics {
  pageCount: number;
  anchorCount: number;
  parsedRecordCount: number;
  lineItemCount: number;
  lumpSumCount: number;
  negativeAmountCount: number;
  explicitAddressCount: number;
  appropriatedAmountByType: {
    lineItem: number;
    lumpSum: number;
    total: number;
  };
  groupBalances: DceoCapitalAppropriationGroupBalances | null;
  reconcilesToGroupBalances: boolean | null;
  warnings: string[];
}

export interface ParseDceoCapitalAppropriationsOptions {
  sourceUrl?: string;
  sourceVersion?: string;
  strictFullDocument?: boolean;
  expectedPageCount?: number;
}

export interface DceoCapitalAppropriationParseResult {
  records: DceoCapitalAppropriationRecord[];
  diagnostics: DceoCapitalAppropriationParseDiagnostics;
}

export class DceoCapitalAppropriationParseError extends Error {
  constructor(
    message: string,
    readonly diagnostics?: DceoCapitalAppropriationParseDiagnostics,
  ) {
    super(message);
    this.name = "DceoCapitalAppropriationParseError";
  }
}

const APPROPRIATION_ANCHOR_RE =
  /\b(\d{3}-\d{5}-\d{4}-\d{4})\s+(\(\$[\d,]+(?:\.\d{1,2})?\)|\$[\d,]+(?:\.\d{1,2})?)/g;

const LINE_TYPE_RE = /\b(Line Item|Lump Sum)\b/g;

const PAGE_NOISE = [
  /^DCEO Capital Appropriations\s*$/,
  /^Line Name Appropriation Amount Original Description\s*$/,
  /^Grant funding source:\s*$/,
  /^Line Item or Lump Sum\s*$/,
  /^Appropriation\?\s*$/,
  /^FY26 Capital Appropriation Listings\s*$/,
  /^\d+ of \d+ DCEO Capital Appropriation List\s*$/,
  /^Group Balances\s*$/,
  /^Line Item \$[\d,.]+\s*$/,
  /^Lump Sum \$[\d,.]+\s*$/,
  /^Total \$[\d,.]+ TRUE\s*$/,
] as const;

const STREET_SUFFIX =
  "(?:STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|PARKWAY|PKWY|HIGHWAY|HWY|TERRACE|TER|CIRCLE|CIR|WAY)";

const EXPLICIT_STREET_ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}(?:-\d{1,6})?\s+` +
    String.raw`(?:(?:NORTH|SOUTH|EAST|WEST|N|S|E|W)\.?\s+)?` +
    String.raw`(?:[A-Z0-9][A-Z0-9.'’/-]*\s+){0,7}` +
    STREET_SUFFIX +
    String.raw`\.?(?=\s|[,;)]|$)`,
  "i",
);

/**
 * Two house numbers sharing ONE street name/suffix — the source's shorthand for
 * a project spanning more than one address ("6808 O 6816 SOUTH HALSTED STREET",
 * "4111/4113 N PULASKI AVE", "1200 & 4500 SOUTH HALSTED STREET").
 *
 * EXPLICIT_STREET_ADDRESS_RE cannot see these as multiple sites: a separator it
 * does not accept (`&`) simply blocks the earlier match so only the LAST house
 * number survives, and a separator it does accept as an interior token (`O`,
 * `/`) gets swallowed into one address string. Either way the match count is 1,
 * so a plain `addresses.length > 1` multi-site test fails open and the row plots
 * as a single confident point.
 *
 * Requiring a real street suffix after the number pair keeps unrelated numeric
 * pairs ("FY2024 AND 2025", "$10,000") from tripping the guard.
 */
const MULTI_HOUSE_NUMBER_ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}(?:-\d{1,6})?\s*(?:[/&]|\bAND\b|\bOR\b|\bO\b)\s*\d{1,6}(?:-\d{1,6})?\s+` +
    String.raw`(?:(?:NORTH|SOUTH|EAST|WEST|N|S|E|W)\.?\s+)?` +
    String.raw`(?:[A-Z0-9][A-Z0-9.'’/-]*\s+){0,7}` +
    STREET_SUFFIX +
    String.raw`\.?(?=\s|[,;)]|$)`,
  "i",
);

/**
 * True when the description names two house numbers against a single street —
 * i.e. the appropriation covers more than one site and must NOT be plotted as
 * one confident point. Callers treat this exactly like an explicit
 * "various locations" phrase: hold the record citywide, unplotted.
 */
export function describesMultipleProjectSites(description: string): boolean {
  return MULTI_HOUSE_NUMBER_ADDRESS_RE.test(normalizeField(description));
}

const CHICAGO_ZIP_RE = /\b606\d{2}(?:-\d{4})?\b/;
const ANY_ZIP_RE = /\b\d{5}(?:-\d{4})?\b/g;
const CHICAGO_LOCATION_PHRASE_RE =
  /\b(?:IN|WITHIN|LOCATED IN|CITY OF)\s+CHICAGO\b|\bCHICAGO,\s*(?:ILLINOIS|IL)\b/i;
const CHICAGO_NAMED_MUNICIPALITY_RE =
  /\b(?:(?:CITY|VILLAGE) OF )?(?:SOUTH CHICAGO HEIGHTS|CHICAGO HEIGHTS|CHICAGO RIDGE|NORTH CHICAGO|WEST CHICAGO|EAST CHICAGO)\b/i;
const CHICAGO_PUBLIC_ENTITY_RE =
  /\b(?:CHICAGO HOUSING AUTHORITY|CHICAGO PARK DISTRICT|CHICAGO PUBLIC SCHOOLS?|CHICAGO PUBLIC SCHOOL DISTRICT 299|CHICAGO BOARD OF EDUCATION|CHICAGO DEPARTMENT OF TRANSPORTATION|CHICAGO POLICE DEPARTMENT|CHICAGO FIRE DEPARTMENT|CHICAGO PUBLIC LIBRARY|CITY COLLEGES OF CHICAGO|CHICAGO STATE UNIVERSITY|PUBLIC BUILDING COMMISSION OF CHICAGO)\b/i;

interface AmountParts {
  amount: number;
  cents: number;
}

interface Anchor {
  index: number;
  end: number;
  appropriationCode: string;
  amountToken: string;
}

function normalizeField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanPage(page: string): string {
  return page
    .split(/\r?\n/)
    .filter((line) => !PAGE_NOISE.some((pattern) => pattern.test(line.trim())))
    .join("\n");
}

function parseAccountingAmount(raw: string): AmountParts {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const numeric = trimmed.replace(/[($,)]/g, "");
  const match = numeric.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new DceoCapitalAppropriationParseError(`Invalid appropriation amount: ${raw}`);
  }

  const whole = Number(match[1]);
  const fractional = Number((match[2] ?? "").padEnd(2, "0"));
  const unsignedCents = whole * 100 + fractional;
  if (!Number.isSafeInteger(unsignedCents)) {
    throw new DceoCapitalAppropriationParseError(`Appropriation amount exceeds safe range: ${raw}`);
  }

  const cents = negative ? -unsignedCents : unsignedCents;
  return { cents, amount: cents / 100 };
}

function centsToAmount(cents: number): number {
  return cents / 100;
}

function parseGroupBalances(pages: readonly string[]): {
  balances: DceoCapitalAppropriationGroupBalances | null;
  cents: { lineItem: number; lumpSum: number; total: number } | null;
} {
  const header = pages.slice(0, 3).join("\n");
  const match = header.match(
    /Group Balances\s+Line Item\s+(\$[\d,]+(?:\.\d{1,2})?)\s+Lump Sum\s+(\$[\d,]+(?:\.\d{1,2})?)\s+Total\s+(\$[\d,]+(?:\.\d{1,2})?)/,
  );
  if (!match) return { balances: null, cents: null };

  const lineItem = parseAccountingAmount(match[1]);
  const lumpSum = parseAccountingAmount(match[2]);
  const total = parseAccountingAmount(match[3]);
  return {
    balances: {
      lineItem: lineItem.amount,
      lumpSum: lumpSum.amount,
      total: total.amount,
    },
    cents: {
      lineItem: lineItem.cents,
      lumpSum: lumpSum.cents,
      total: total.cents,
    },
  };
}

function anchorsFromText(text: string): Anchor[] {
  return [...text.matchAll(APPROPRIATION_ANCHOR_RE)].map((match) => ({
    index: match.index,
    end: match.index + match[0].length,
    appropriationCode: match[1],
    amountToken: match[2],
  }));
}

/**
 * Return the first source-literal numbered street address. Intersections,
 * neighborhood names, and organization names are intentionally not inferred.
 */
export function extractExplicitProjectAddress(description: string): string | null {
  const match = normalizeField(description).match(EXPLICIT_STREET_ADDRESS_RE);
  return match ? match[0].trim() : null;
}

/**
 * True only when the ledger itself supplies strong Chicago location evidence.
 *
 * An organization name containing "Chicago" is deliberately insufficient:
 * regional organizations can spend in Naperville, Palatine, Cicero, Berwyn,
 * Oak Park, and other municipalities. We accept a Chicago ZIP, an explicit
 * Chicago location phrase, or a City-jurisdiction public entity whose projects
 * are necessarily inside Chicago. A source-literal ZIP with no Chicago ZIP
 * fails closed.
 */
export function hasHighConfidenceChicagoDceoLocation(input: {
  lineName: string;
  originalDescription: string;
}): boolean {
  const lineName = normalizeField(input.lineName);
  const originalDescription = normalizeField(input.originalDescription);
  const text = `${lineName} ${originalDescription}`;
  const hasChicagoZip = CHICAGO_ZIP_RE.test(text);
  const sourceZips = text.match(ANY_ZIP_RE) ?? [];

  if (!hasChicagoZip && sourceZips.length > 0) return false;
  if (!hasChicagoZip && CHICAGO_NAMED_MUNICIPALITY_RE.test(text)) return false;

  return (
    hasChicagoZip ||
    CHICAGO_LOCATION_PHRASE_RE.test(originalDescription) ||
    CHICAGO_PUBLIC_ENTITY_RE.test(text)
  );
}

/**
 * Parse text extracted one element per PDF page. The importer uses unpdf with
 * mergePages:false so page-count and repeated-header integrity checks remain
 * available.
 */
export function parseDceoCapitalAppropriationsPages(
  pages: readonly string[],
  options: ParseDceoCapitalAppropriationsOptions = {},
): DceoCapitalAppropriationParseResult {
  const sourceUrl = options.sourceUrl ?? DCEO_CAPITAL_APPROPRIATIONS_SOURCE_URL;
  const sourceVersion = options.sourceVersion ?? DCEO_CAPITAL_APPROPRIATIONS_SOURCE_VERSION;
  const strictFullDocument = options.strictFullDocument ?? false;
  const expectedPageCount =
    options.expectedPageCount ?? DCEO_CAPITAL_APPROPRIATIONS_EXPECTED_PAGES;

  if (pages.length === 0) {
    throw new DceoCapitalAppropriationParseError("No PDF pages were supplied");
  }

  const group = parseGroupBalances(pages);
  const text = pages.map(cleanPage).join("\n");
  const anchors = anchorsFromText(text);
  if (anchors.length === 0) {
    throw new DceoCapitalAppropriationParseError(
      "No DCEO appropriation-code and amount anchors were found",
    );
  }

  const records: DceoCapitalAppropriationRecord[] = [];
  const failures: string[] = [];
  let previousTypeEnd = 0;
  let lineItemCents = 0;
  let lumpSumCents = 0;
  let lineItemCount = 0;
  let lumpSumCount = 0;
  let negativeAmountCount = 0;
  let explicitAddressCount = 0;

  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index];
    const nextAnchorIndex = anchors[index + 1]?.index ?? text.length;
    const lineName = normalizeField(text.slice(previousTypeEnd, anchor.index));
    const afterAmount = text.slice(anchor.end, nextAnchorIndex);
    LINE_TYPE_RE.lastIndex = 0;
    const typeMatch = LINE_TYPE_RE.exec(afterAmount);

    if (!typeMatch) {
      failures.push(
        `Missing line type after record ${index + 1} (${anchor.appropriationCode})`,
      );
      previousTypeEnd = anchor.end;
      continue;
    }

    const originalDescription = normalizeField(afterAmount.slice(0, typeMatch.index));
    previousTypeEnd = anchor.end + typeMatch.index + typeMatch[0].length;

    if (!lineName) {
      failures.push(`Missing line name for record ${index + 1} (${anchor.appropriationCode})`);
      continue;
    }
    if (!originalDescription) {
      failures.push(
        `Missing original description for record ${index + 1} (${anchor.appropriationCode})`,
      );
      continue;
    }

    const parsedAmount = parseAccountingAmount(anchor.amountToken);
    const lineType: DceoCapitalAppropriationLineType =
      typeMatch[1] === "Line Item" ? "line_item" : "lump_sum";
    const explicitProjectAddress = extractExplicitProjectAddress(originalDescription);

    if (lineType === "line_item") {
      lineItemCount++;
      lineItemCents += parsedAmount.cents;
    } else {
      lumpSumCount++;
      lumpSumCents += parsedAmount.cents;
    }
    if (parsedAmount.cents < 0) negativeAmountCount++;
    if (explicitProjectAddress) explicitAddressCount++;

    records.push({
      lineName,
      appropriationCode: anchor.appropriationCode,
      appropriatedAmount: parsedAmount.amount,
      originalDescription,
      lineType,
      explicitProjectAddress,
      sourceUrl,
      sourceVersion,
    });
  }

  const trailingText = normalizeField(text.slice(previousTypeEnd));
  if (trailingText) {
    failures.push(`Unexpected trailing text after the final record: ${trailingText.slice(0, 120)}`);
  }

  const totalCents = lineItemCents + lumpSumCents;
  const reconcilesToGroupBalances = group.cents
    ? lineItemCents === group.cents.lineItem &&
      lumpSumCents === group.cents.lumpSum &&
      totalCents === group.cents.total &&
      group.cents.lineItem + group.cents.lumpSum === group.cents.total
    : null;

  const warnings: string[] = [];
  if (negativeAmountCount > 0) {
    warnings.push(
      `${negativeAmountCount} accounting-style parenthetical amount(s) were preserved as negative appropriations`,
    );
  }
  if (!group.balances) {
    warnings.push("Group balances were not present in the supplied pages");
  }

  const diagnostics: DceoCapitalAppropriationParseDiagnostics = {
    pageCount: pages.length,
    anchorCount: anchors.length,
    parsedRecordCount: records.length,
    lineItemCount,
    lumpSumCount,
    negativeAmountCount,
    explicitAddressCount,
    appropriatedAmountByType: {
      lineItem: centsToAmount(lineItemCents),
      lumpSum: centsToAmount(lumpSumCents),
      total: centsToAmount(totalCents),
    },
    groupBalances: group.balances,
    reconcilesToGroupBalances,
    warnings,
  };

  if (records.length !== anchors.length) {
    failures.push(
      `Parsed ${records.length} records from ${anchors.length} appropriation anchors`,
    );
  }
  if (strictFullDocument && pages.length !== expectedPageCount) {
    failures.push(`Expected ${expectedPageCount} pages, received ${pages.length}`);
  }
  if (strictFullDocument && !group.balances) {
    failures.push("Full-document parse requires the source group balances");
  }
  if (strictFullDocument && reconcilesToGroupBalances !== true) {
    failures.push("Parsed appropriations do not reconcile to the source group balances");
  }

  if (failures.length > 0) {
    throw new DceoCapitalAppropriationParseError(
      `DCEO capital appropriation parse failed:\n- ${failures.join("\n- ")}`,
      diagnostics,
    );
  }

  return { records, diagnostics };
}
