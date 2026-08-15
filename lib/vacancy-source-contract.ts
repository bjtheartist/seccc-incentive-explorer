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
