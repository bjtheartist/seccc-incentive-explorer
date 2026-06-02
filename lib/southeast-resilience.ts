/**
 * Southeast business-resilience cohort helpers.
 *
 * These functions compare business-license records across two years without
 * hitting the database. Scripts/API routes can feed rows from Neon, Google
 * audit imports, or fixtures and get the same retained/left/new buckets.
 */

export type BusinessResilienceStatus =
  | "retained"
  | "left_or_closed"
  | "new_since_baseline"
  | "not_in_scope"
  | "needs_review";

export interface BusinessLicenseCohortInput {
  licenseId: string;
  accountNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  address: string | null;
  zip: string | null;
  licenseDescription: string | null;
  licenseStatus: string | null;
  licenseStartDate: string | null;
  expirationDate: string | null;
  dateIssued: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface BusinessCohortRecord {
  entityKey: string;
  status: BusinessResilienceStatus;
  accountNumber: string | null;
  businessName: string | null;
  legalName: string | null;
  dbaName: string | null;
  primaryAddress: string | null;
  zip: string | null;
  licenseDescriptions: string[];
  licenseStatuses: string[];
  licenseIds: string[];
  activeInBaselineYear: boolean;
  activeInComparisonYear: boolean;
  firstLicenseStart: string | null;
  latestExpiration: string | null;
  licenseCount: number;
  evidence: string[];
  reviewReason: string | null;
}

export interface BusinessCohortSummary {
  baselineYear: number;
  comparisonYear: number;
  baselineActiveCount: number;
  comparisonActiveCount: number;
  retainedCount: number;
  leftOrClosedCount: number;
  newSinceBaselineCount: number;
  needsReviewCount: number;
  resilienceRate: number | null;
  netBusinessChange: number;
}

export interface BusinessCohortResult {
  summary: BusinessCohortSummary;
  records: BusinessCohortRecord[];
}

const CLOSED_STATUSES = new Set(["AAC", "REV", "CAN", "INA"]);

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const normalized = trimmed
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(THE|INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function normalizeBusinessName(value: string | null | undefined): string | null {
  return normalizeText(value);
}

export function normalizeBusinessAddress(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
    ?.replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bPLACE\b/g, "PL")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function yearStart(year: number): Date {
  return new Date(Date.UTC(year, 0, 1));
}

function yearEnd(year: number): Date {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
}

function minIso(values: Array<string | null>): string | null {
  const dates = values.map(parseDate).filter((date): date is Date => date != null);
  if (dates.length === 0) return null;
  return isoDate(new Date(Math.min(...dates.map((date) => date.getTime()))));
}

function maxIso(values: Array<string | null>): string | null {
  const dates = values.map(parseDate).filter((date): date is Date => date != null);
  if (dates.length === 0) return null;
  return isoDate(new Date(Math.max(...dates.map((date) => date.getTime()))));
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => trimOrNull(value)).filter((value): value is string => value != null))
  ).sort((a, b) => a.localeCompare(b));
}

export function isLicenseActiveInYear(
  license: Pick<
    BusinessLicenseCohortInput,
    "licenseStartDate" | "expirationDate" | "licenseStatus"
  >,
  year: number
): boolean {
  const status = trimOrNull(license.licenseStatus)?.toUpperCase() ?? "";
  if (CLOSED_STATUSES.has(status)) return false;

  const start = parseDate(license.licenseStartDate);
  const expiration = parseDate(license.expirationDate);
  const startBoundary = yearStart(year);
  const endBoundary = yearEnd(year);

  const startsBeforeYearEnds = !start || start <= endBoundary;
  const expiresAfterYearStarts = !expiration || expiration >= startBoundary;
  return startsBeforeYearEnds && expiresAfterYearStarts;
}

function entityKeyFor(row: BusinessLicenseCohortInput): string | null {
  const accountNumber = trimOrNull(row.accountNumber);
  if (accountNumber) return `acct:${accountNumber}`;

  const name = normalizeBusinessName(row.dbaName ?? row.legalName);
  const address = normalizeBusinessAddress(row.address);
  if (name && address) return `nameaddr:${name}|${address}`;
  if (name && trimOrNull(row.zip)) return `namezip:${name}|${trimOrNull(row.zip)}`;
  return null;
}

function firstNonNull(values: Array<string | null | undefined>): string | null {
  return values.map(trimOrNull).find((value) => value != null) ?? null;
}

export function buildBusinessCohorts(
  rows: BusinessLicenseCohortInput[],
  baselineYear = 2020,
  comparisonYear = 2025
): BusinessCohortResult {
  const groups = new Map<string, BusinessLicenseCohortInput[]>();
  const needsReviewRows: BusinessCohortRecord[] = [];

  for (const row of rows) {
    const key = entityKeyFor(row);
    if (!key) {
      needsReviewRows.push({
        entityKey: `review:${row.licenseId}`,
        status: "needs_review",
        accountNumber: trimOrNull(row.accountNumber),
        businessName: firstNonNull([row.dbaName, row.legalName]),
        legalName: trimOrNull(row.legalName),
        dbaName: trimOrNull(row.dbaName),
        primaryAddress: trimOrNull(row.address),
        zip: trimOrNull(row.zip),
        licenseDescriptions: unique([row.licenseDescription]),
        licenseStatuses: unique([row.licenseStatus]),
        licenseIds: unique([row.licenseId]),
        activeInBaselineYear: isLicenseActiveInYear(row, baselineYear),
        activeInComparisonYear: isLicenseActiveInYear(row, comparisonYear),
        firstLicenseStart: trimOrNull(row.licenseStartDate),
        latestExpiration: trimOrNull(row.expirationDate),
        licenseCount: 1,
        evidence: ["missing stable account/name/address key"],
        reviewReason: "Missing account number and enough name/address information to group safely.",
      });
      continue;
    }
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const records: BusinessCohortRecord[] = [];
  for (const [entityKey, group] of groups) {
    const activeInBaselineYear = group.some((row) => isLicenseActiveInYear(row, baselineYear));
    const activeInComparisonYear = group.some((row) => isLicenseActiveInYear(row, comparisonYear));

    let status: BusinessResilienceStatus = "not_in_scope";
    if (activeInBaselineYear && activeInComparisonYear) status = "retained";
    else if (activeInBaselineYear && !activeInComparisonYear) status = "left_or_closed";
    else if (!activeInBaselineYear && activeInComparisonYear) status = "new_since_baseline";

    records.push({
      entityKey,
      status,
      accountNumber: firstNonNull(group.map((row) => row.accountNumber)),
      businessName: firstNonNull(group.flatMap((row) => [row.dbaName, row.legalName])),
      legalName: firstNonNull(group.map((row) => row.legalName)),
      dbaName: firstNonNull(group.map((row) => row.dbaName)),
      primaryAddress: firstNonNull(group.map((row) => row.address)),
      zip: firstNonNull(group.map((row) => row.zip)),
      licenseDescriptions: unique(group.map((row) => row.licenseDescription)),
      licenseStatuses: unique(group.map((row) => row.licenseStatus)),
      licenseIds: unique(group.map((row) => row.licenseId)),
      activeInBaselineYear,
      activeInComparisonYear,
      firstLicenseStart: minIso(group.map((row) => row.licenseStartDate)),
      latestExpiration: maxIso(group.map((row) => row.expirationDate)),
      licenseCount: group.length,
      evidence: [
        entityKey.startsWith("acct:") ? "grouped by account_number" : "grouped by normalized name/address",
        activeInBaselineYear ? `active in ${baselineYear}` : `not active in ${baselineYear}`,
        activeInComparisonYear ? `active in ${comparisonYear}` : `not active in ${comparisonYear}`,
      ],
      reviewReason: null,
    });
  }

  records.push(...needsReviewRows);
  records.sort((a, b) => {
    const statusCompare = a.status.localeCompare(b.status);
    if (statusCompare !== 0) return statusCompare;
    return (a.businessName ?? "").localeCompare(b.businessName ?? "");
  });

  const baselineActiveCount = records.filter((record) => record.activeInBaselineYear).length;
  const comparisonActiveCount = records.filter((record) => record.activeInComparisonYear).length;
  const retainedCount = records.filter((record) => record.status === "retained").length;
  const leftOrClosedCount = records.filter((record) => record.status === "left_or_closed").length;
  const newSinceBaselineCount = records.filter((record) => record.status === "new_since_baseline").length;
  const needsReviewCount = records.filter((record) => record.status === "needs_review").length;

  return {
    summary: {
      baselineYear,
      comparisonYear,
      baselineActiveCount,
      comparisonActiveCount,
      retainedCount,
      leftOrClosedCount,
      newSinceBaselineCount,
      needsReviewCount,
      resilienceRate: baselineActiveCount === 0 ? null : retainedCount / baselineActiveCount,
      netBusinessChange: comparisonActiveCount - baselineActiveCount,
    },
    records,
  };
}
