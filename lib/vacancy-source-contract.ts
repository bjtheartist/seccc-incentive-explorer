export const COLS_STABLE_ORDER = "pin,:id";
export const SR311_STABLE_ORDER = "created_date DESC,:id";

export function buildColsSourcePageUrl(
  baseUrl: string,
  offset: number,
  limit: number,
): string {
  return `${baseUrl}?$limit=${limit}&$offset=${offset}&$order=${encodeURIComponent(COLS_STABLE_ORDER)}`;
}

export function build311VacancySourcePageUrl(
  baseUrl: string,
  dateFilter: string,
  offset: number,
  limit: number,
): string {
  const where = encodeURIComponent(
    `sr_type in('Vacant/Abandoned Building Complaint','Clean Vacant Lot Request') AND created_date>='${dateFilter}T00:00:00'`,
  );
  return `${baseUrl}?$where=${where}&$limit=${limit}&$offset=${offset}&$order=${encodeURIComponent(SR311_STABLE_ORDER)}`;
}

export interface VacancySourceSnapshotMetrics {
  source: "COLS" | "311";
  rawCount: number;
  validShapeCount: number;
  candidateCount: number;
  normalizedCount: number;
}

export interface CclbaSourceSnapshotMetrics {
  expectedCount: number;
  rawCount: number;
  uniqueIdCount: number;
  validShapeCount: number;
  chicagoCount: number;
  locatedChicagoCount: number;
  unlocatedChicagoCount: number;
  /** Located Chicago rows that survived normalization and can be staged. */
  normalizedCount: number;
  priorLiveCount: number;
}

export interface CclbaMembershipTransition {
  priorLiveIds: readonly string[];
  normalizedChicagoIds: readonly string[];
}

// Inventory turnover can legitimately reduce the current count, but losing
// more than half of the prior live Chicago membership in one run is a
// destructive anomaly that requires the existing reviewed-recovery override.
const CCLBA_MIN_UNREVIEWED_PRIOR_COUNT_RETENTION = 0.5;
const CCLBA_MIN_UNREVIEWED_PRIOR_ID_RETENTION = 0.5;
// This is a collapse guard, not an assertion that the live count must remain
// exactly equal to the 2026-08-26 audit (1,033 published / 915 Chicago).
const CCLBA_MIN_PUBLISHED_INVENTORY_COUNT = 500;
const CCLBA_MIN_CHICAGO_INVENTORY_COUNT = 400;

/**
 * A complete HTTP page sequence is not enough to authorize destructive
 * reconciliation. Reject empty, schema-collapsed, or implausibly lossy source
 * snapshots unless an operator explicitly opts into a one-off recovery run.
 */
export function assertVacancySourceSnapshotSane(
  metrics: VacancySourceSnapshotMetrics,
  allowImplausible = false,
): void {
  if (allowImplausible) return;
  const validShapeRatio =
    metrics.rawCount > 0 ? metrics.validShapeCount / metrics.rawCount : 0;
  const normalizationYield =
    metrics.candidateCount > 0
      ? metrics.normalizedCount / metrics.candidateCount
      : 0;
  const minimumShapeRatio = metrics.source === "COLS" ? 0.75 : 0.5;

  if (
    metrics.rawCount < 1_000 ||
    metrics.normalizedCount < 500 ||
    validShapeRatio < minimumShapeRatio ||
    normalizationYield < 0.8
  ) {
    throw new Error(
      `${metrics.source} source snapshot failed destructive-publish sanity: ` +
        `raw=${metrics.rawCount}, validShape=${metrics.validShapeCount}, ` +
        `candidates=${metrics.candidateCount}, normalized=${metrics.normalizedCount}. ` +
        "Live membership was not changed. Set ALLOW_IMPLAUSIBLE_VACANCY_SOURCE_SNAPSHOT=1 only for a reviewed intentional recovery.",
    );
  }
}

/**
 * CCLBA's public inventory can legitimately be much smaller than the citywide
 * COLS/311 feeds. Its destructive gate therefore proves count agreement,
 * unique stable IDs, source-shape yield, and plausible retention of prior live
 * Chicago membership instead of imposing a large absolute minimum. An empty
 * response or catastrophic count drop fails closed unless an operator explicitly
 * reviews and uses the existing recovery override for that one run.
 */
export function assertCclbaSourceSnapshotSane(
  metrics: CclbaSourceSnapshotMetrics,
  allowImplausible = false,
): void {
  if (allowImplausible) return;
  const validShapeRatio =
    metrics.rawCount > 0 ? metrics.validShapeCount / metrics.rawCount : 0;
  const priorCountRetention =
    metrics.priorLiveCount > 0
      ? metrics.locatedChicagoCount / metrics.priorLiveCount
      : 1;
  if (
    metrics.expectedCount < CCLBA_MIN_PUBLISHED_INVENTORY_COUNT ||
    metrics.rawCount !== metrics.expectedCount ||
    metrics.uniqueIdCount !== metrics.rawCount ||
    metrics.validShapeCount > metrics.rawCount ||
    metrics.chicagoCount < CCLBA_MIN_CHICAGO_INVENTORY_COUNT ||
    metrics.locatedChicagoCount < 1 ||
    metrics.locatedChicagoCount + metrics.unlocatedChicagoCount !==
      metrics.chicagoCount ||
    metrics.normalizedCount !== metrics.locatedChicagoCount ||
    metrics.locatedChicagoCount > metrics.validShapeCount ||
    metrics.unlocatedChicagoCount < 0 ||
    validShapeRatio < 0.9 ||
    !Number.isSafeInteger(metrics.priorLiveCount) ||
    metrics.priorLiveCount < 0 ||
    priorCountRetention < CCLBA_MIN_UNREVIEWED_PRIOR_COUNT_RETENTION
  ) {
    throw new Error(
      "CCLBA source snapshot failed destructive-publish sanity: " +
        `expected=${metrics.expectedCount}, raw=${metrics.rawCount}, ` +
        `uniqueIds=${metrics.uniqueIdCount}, validShape=${metrics.validShapeCount}, ` +
        `chicago=${metrics.chicagoCount}, locatedChicago=${metrics.locatedChicagoCount}, ` +
        `unlocatedChicago=${metrics.unlocatedChicagoCount}, normalized=${metrics.normalizedCount}, ` +
        `priorLive=${metrics.priorLiveCount}. ` +
        "Live membership was not changed. Set ALLOW_IMPLAUSIBLE_CCLBA_SOURCE_SNAPSHOT=1 only for a reviewed intentional recovery.",
    );
  }
}

/**
 * Count retention cannot detect a same-size, fully rekeyed snapshot. Require
 * stable-ID overlap with prior live membership before the atomic retire step;
 * an intentional source-identity migration must use the existing reviewed
 * recovery override rather than silently replacing every row.
 */
export function assertCclbaMembershipTransitionSane(
  transition: CclbaMembershipTransition,
  allowImplausible = false,
): void {
  if (allowImplausible) return;

  const validUniqueIds = (ids: readonly string[]): Set<string> | null => {
    const normalized = ids.filter(
      (id) => typeof id === "string" && id.trim() === id && id.length > 0,
    );
    const unique = new Set(normalized);
    return normalized.length === ids.length && unique.size === ids.length
      ? unique
      : null;
  };
  const prior = validUniqueIds(transition.priorLiveIds);
  const next = validUniqueIds(transition.normalizedChicagoIds);
  const retainedPriorCount =
    prior && next
      ? Array.from(prior).filter((id) => next.has(id)).length
      : 0;
  const priorIdRetention =
    prior && prior.size > 0 ? retainedPriorCount / prior.size : 1;

  if (
    !prior ||
    !next ||
    priorIdRetention < CCLBA_MIN_UNREVIEWED_PRIOR_ID_RETENTION
  ) {
    throw new Error(
      "CCLBA membership transition failed destructive-publish sanity: " +
        `priorIds=${transition.priorLiveIds.length}, ` +
        `nextIds=${transition.normalizedChicagoIds.length}, ` +
        `retainedPriorIds=${retainedPriorCount}. ` +
        "Live membership was not changed. Set ALLOW_IMPLAUSIBLE_CCLBA_SOURCE_SNAPSHOT=1 only for a reviewed intentional source-identity recovery.",
    );
  }
}

function chicagoCoordinates(latValue: unknown, lonValue: unknown): boolean {
  const lat = typeof latValue === "string" ? Number(latValue) : NaN;
  const lon = typeof lonValue === "string" ? Number(lonValue) : NaN;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 41.6 &&
    lat <= 42.1 &&
    lon >= -88 &&
    lon <= -87.4
  );
}

export function isPlausibleColsSourceRow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.pin === "string" &&
    row.pin.trim().length > 0 &&
    (typeof row.address === "string" || typeof row.street === "string") &&
    chicagoCoordinates(row.latitude, row.longitude)
  );
}

export function isPlausible311VacancySourceRow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.sr_number === "string" &&
    row.sr_number.trim().length > 0 &&
    (row.sr_type === "Vacant/Abandoned Building Complaint" ||
      row.sr_type === "Clean Vacant Lot Request") &&
    typeof row.created_date === "string" &&
    Number.isFinite(Date.parse(row.created_date)) &&
    typeof row.street_address === "string" &&
    row.street_address.trim().length > 0 &&
    chicagoCoordinates(row.latitude, row.longitude)
  );
}

export function isPlausibleCclbaSourceRow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const sourceId = typeof row.id === "number" ? row.id : Number(row.id);
  const pinDigits =
    typeof row.parcelNumber === "string"
      ? row.parcelNumber.replace(/\D/g, "")
      : "";
  const coordinatesAbsent = row.latitude == null && row.longitude == null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const coordinatesPlausible =
    Number.isFinite(latitude) &&
    latitude >= 41.3 &&
    latitude <= 42.2 &&
    Number.isFinite(longitude) &&
    longitude >= -88.3 &&
    longitude <= -87.4;
  return (
    Number.isSafeInteger(sourceId) &&
    sourceId > 0 &&
    pinDigits.length === 14 &&
    typeof row.propertyAddress1 === "string" &&
    row.propertyAddress1.trim().length > 0 &&
    typeof row.city === "string" &&
    row.city.trim().length > 0 &&
    typeof row.currentStatus === "string" &&
    row.currentStatus.trim().length > 0 &&
    typeof row.inventoryType === "string" &&
    row.inventoryType.trim().length > 0 &&
    typeof row.propertyClass === "string" &&
    row.propertyClass.trim().length > 0 &&
    (coordinatesAbsent || coordinatesPlausible)
  );
}
