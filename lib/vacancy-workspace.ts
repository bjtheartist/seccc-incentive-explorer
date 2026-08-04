import type { CaseKey, VacancyCaseRecord } from "./vacancy-cases";

export type VacancyWorkspaceView = "list" | "map";
export type VacancyWorkspaceUniverse = "all" | VacancyCaseRecord["universe"];
export type VacancyWorkspaceBounds = [west: number, south: number, east: number, north: number];

export interface VacancyWorkspaceFilters {
  query: string;
  universe: VacancyWorkspaceUniverse;
  bounds: VacancyWorkspaceBounds | null;
}

export const VACANCY_WORKSPACE_URL_EVENT = "vacancy-workspace:urlchange";

const WORKSPACE_QUERY_KEYS = ["view", "q", "universe", "bounds"] as const;

/** Build a case destination from the current workspace URL posture. */
export function buildVacancyCaseHref(
  zip: string,
  caseKey: CaseKey,
  current: URLSearchParams,
): string {
  const query = new URLSearchParams({ case: caseKey });
  for (const key of WORKSPACE_QUERY_KEYS) {
    const value = current.get(key);
    if (value) query.set(key, value);
  }
  return `/vacancy/${zip}?${query.toString()}`;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseWorkspaceView(value: string | string[] | undefined): VacancyWorkspaceView {
  return firstParam(value) === "map" ? "map" : "list";
}

export function parseWorkspaceUniverse(
  value: string | string[] | undefined,
): VacancyWorkspaceUniverse {
  const raw = firstParam(value);
  return raw === "land" || raw === "building_report" ? raw : "all";
}

export function parseWorkspaceQuery(value: string | string[] | undefined): string {
  return (firstParam(value) ?? "").trim().slice(0, 120);
}

/**
 * Parse the shareable map viewport. Four-decimal normalization keeps URLs stable
 * to roughly a city-block scale and prevents tiny Mapbox movements from creating
 * an endless family of nearly identical links.
 */
export function parseWorkspaceBounds(
  value: string | string[] | undefined,
): VacancyWorkspaceBounds | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return normalizeWorkspaceBounds([west, south, east, north]);
}

export function normalizeWorkspaceBounds(
  bounds: VacancyWorkspaceBounds,
): VacancyWorkspaceBounds {
  return bounds.map((value) => Number(value.toFixed(4))) as VacancyWorkspaceBounds;
}

export function serializeWorkspaceBounds(bounds: VacancyWorkspaceBounds): string {
  return normalizeWorkspaceBounds(bounds)
    .map((value) => value.toFixed(4))
    .join(",");
}

export function recordInsideBounds(
  record: Pick<VacancyCaseRecord, "lat" | "lon">,
  bounds: VacancyWorkspaceBounds,
): boolean {
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return false;
  const [west, south, east, north] = bounds;
  return (record.lon as number) >= west &&
    (record.lon as number) <= east &&
    (record.lat as number) >= south &&
    (record.lat as number) <= north;
}

/** All filters use explicit AND semantics. The caller feeds this one result set
 * to both the list and map, so the two surfaces cannot disagree. */
export function filterVacancyWorkspaceRecords(
  records: readonly VacancyCaseRecord[],
  filters: VacancyWorkspaceFilters,
): VacancyCaseRecord[] {
  const query = filters.query.trim().toLocaleLowerCase("en-US");
  const queryDigits = query.replace(/\D/g, "");
  return records.filter((record) => {
    if (filters.universe !== "all" && record.universe !== filters.universe) return false;
    if (filters.bounds && !recordInsideBounds(record, filters.bounds)) return false;
    if (!query) return true;
    return record.address.toLocaleLowerCase("en-US").includes(query) ||
      (queryDigits.length > 0 && (record.pin ?? "").replace(/\D/g, "").includes(queryDigits));
  });
}
