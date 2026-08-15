/**
 * Shared vacancy-evidence semantics for API, map, panel, reports and exports.
 * A City inventory row or 311 request is a public-record signal, never proof
 * that a site is vacant today.
 */

export const VACANCY_FRESHNESS_POLICY_VERSION = "source-record-date-v1" as const;
export const VACANCY_RECENT_YEARS = 3;
export const VACANCY_RETENTION_YEARS = 5;
export const CHICAGO_TIME_ZONE = "America/Chicago" as const;

/** Return the Chicago civil calendar day for an instant, independent of server TZ. */
export function chicagoCalendarDay(value: string | number | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Chicago calendar-day reference must be valid");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new Error("Could not derive Chicago calendar day");
  }
  return `${year}-${month}-${day}`;
}

/** Shift a YYYY-MM-DD civil date by whole years, clamping leap day if needed. */
export function shiftCalendarDayYears(day: string, years: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(years)) {
    throw new Error("Calendar-day year shift requires a valid day and whole years");
  }
  const [year, month, date] = day.split("-").map(Number);
  const shiftedYear = year + years;
  const lastDay = new Date(Date.UTC(shiftedYear, month, 0)).getUTCDate();
  const shiftedDate = Math.min(date, lastDay);
  return `${String(shiftedYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(shiftedDate).padStart(2, "0")}`;
}

/**
 * Preserve a Chicago source's published civil date without letting the runner's
 * local timezone reinterpret a timezone-less Socrata wall-clock timestamp.
 */
export function normalizeChicagoSourceCalendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

export type VacancySource =
  | "cols"
  | "dpd_vacant"
  | "311_clean_lot"
  | "violations";

export type VacancyPropertyType =
  | "vacant_land"
  | "reported_vacant_lot"
  | "vacant_building"
  | "vacant_storefront";

export type VacancyCanonicalType = "land" | "building" | "storefront" | "other";
export type VacancyFreshness = "recent" | "stale" | "unknown_date";
export type VacancyFreshnessFilter =
  | "current_screening"
  | "recent_reports"
  | "all_records";

export interface VacancyFreshnessCounts {
  recent: number;
  stale: number;
  unknownDate: number;
}

export interface VacancyFreshnessMetadata {
  policyVersion: typeof VACANCY_FRESHNESS_POLICY_VERSION;
  referenceDate: string;
  recentWithinYears: typeof VACANCY_RECENT_YEARS;
  cutoffDate: string;
  retainedWithinYears: typeof VACANCY_RETENTION_YEARS;
  /** Current policy reference, not the persisted cutoff of the last source sync. */
  retentionPolicyCutoffDate: string;
  retentionCutoffBasis: "current_request_reference_policy";
  returnedCounts: VacancyFreshnessCounts;
}

function timestampOrNull(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function vacancyFreshnessCutoff(
  referenceDate: string | Date,
  years = VACANCY_RECENT_YEARS,
): string {
  const reference = new Date(referenceDate);
  if (!Number.isFinite(reference.getTime())) {
    throw new Error("Vacancy freshness reference date must be valid");
  }
  const cutoff = new Date(reference);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff.toISOString();
}

export function classifyVacancyFreshness(
  sourceRecordDate: unknown,
  referenceDate: string | Date,
): VacancyFreshness {
  const reportedAt = timestampOrNull(sourceRecordDate);
  if (!reportedAt) return "unknown_date";
  return Date.parse(reportedAt) >= Date.parse(vacancyFreshnessCutoff(referenceDate))
    ? "recent"
    : "stale";
}

export function canonicalVacancyType(propertyType: unknown): VacancyCanonicalType {
  if (propertyType === "vacant_land" || propertyType === "reported_vacant_lot") {
    return "land";
  }
  if (propertyType === "vacant_building") return "building";
  if (propertyType === "vacant_storefront") return "storefront";
  return "other";
}

export function isVacancySourceTypePair(
  source: unknown,
  propertyType: unknown,
): boolean {
  if (source === "cols") return propertyType === "vacant_land";
  if (source === "311_clean_lot") {
    return propertyType === "reported_vacant_lot";
  }
  if (source === "dpd_vacant" || source === "violations") {
    return propertyType === "vacant_building";
  }
  return false;
}

export function vacancyTypeLabel(type: VacancyCanonicalType): string {
  if (type === "land") return "Tracked land signal";
  if (type === "building") return "Tracked building signal";
  if (type === "storefront") return "Tracked storefront signal";
  return "Other tracked vacancy signal";
}

export function isCurrentInventorySource(source: unknown): boolean {
  return source === "cols";
}

export function includeVacancyForFreshnessFilter(
  feature: GeoJSON.Feature,
  filter: VacancyFreshnessFilter,
): boolean {
  const properties = feature.properties ?? {};
  if (filter === "all_records") return true;
  if (
    filter === "current_screening" &&
    isCurrentInventorySource(properties.source)
  ) {
    return true;
  }
  if (properties.freshnessClass !== "recent") return false;
  if (filter === "recent_reports") return !isCurrentInventorySource(properties.source);
  return true;
}

export function summarizeVacancyFreshness(
  features: readonly GeoJSON.Feature[],
): VacancyFreshnessCounts {
  const counts: VacancyFreshnessCounts = { recent: 0, stale: 0, unknownDate: 0 };
  for (const feature of features) {
    const freshness = feature.properties?.freshnessClass;
    if (freshness === "recent") counts.recent += 1;
    else if (freshness === "stale") counts.stale += 1;
    else counts.unknownDate += 1;
  }
  return counts;
}

export function buildVacancyFreshnessMetadata(
  features: readonly GeoJSON.Feature[],
  referenceDate: string | Date,
): VacancyFreshnessMetadata {
  const reference = new Date(referenceDate);
  if (!Number.isFinite(reference.getTime())) {
    throw new Error("Vacancy freshness reference date must be valid");
  }
  return {
    policyVersion: VACANCY_FRESHNESS_POLICY_VERSION,
    referenceDate: reference.toISOString(),
    recentWithinYears: VACANCY_RECENT_YEARS,
    cutoffDate: vacancyFreshnessCutoff(reference),
    retainedWithinYears: VACANCY_RETENTION_YEARS,
    retentionPolicyCutoffDate: vacancyFreshnessCutoff(
      reference,
      VACANCY_RETENTION_YEARS,
    ),
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: summarizeVacancyFreshness(features),
  };
}
