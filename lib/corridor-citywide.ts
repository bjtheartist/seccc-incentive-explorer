/**
 * Loader for the citywide corridor-metrics TEST export
 * (`data/exports/corridor-metrics-citywide.json`).
 *
 * This file is produced by a background batch job and is NOT guaranteed to
 * exist at any given time — callers must treat a `null` return as "no data
 * yet" and render an empty state, never throw or 500. It is a preview /
 * unlisted dataset (see app/corridors) and is intentionally separate from
 * the production `public/data/corridor-metrics.json` export consumed by
 * lib/report-engine.ts.
 *
 * Loading pattern mirrors lib/neighborhood-page-data.ts (readFile + try/catch
 * fallback, module-level memoized cache, `process.cwd()`-relative path) with
 * `existsSync` used up front so a missing file short-circuits cleanly instead
 * of relying on a thrown-and-caught ENOENT.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ── Shape (matches public/data/corridor-metrics.json, the live production
// export with the same per-ZIP structure — see that file for real values). ──

export interface CorridorCitywideVacancy {
  vacancyRate?: number | null;
  vacantCount?: number | null;
  totalParcels?: number | null;
}

export interface CorridorCitywideTurnover {
  openings?: number | null;
  closures?: number | null;
  net?: number | null;
  turnoverRate?: number | null;
}

export interface CorridorCitywideOwnershipConcentration {
  hhi?: number | null;
  topOwnerShare?: number | null;
  distinctOwners?: number | null;
  totalParcels?: number | null;
}

export interface CorridorCitywideOwnershipOrigin {
  localShare?: number | null;
  outsideShare?: number | null;
  localCount?: number | null;
  outsideCount?: number | null;
  totalParcels?: number | null;
}

export interface CorridorCitywidePermits {
  permitCount?: number | null;
  totalReportedCost?: number | null;
  demolitionCount?: number | null;
}

export interface CorridorCitywideIncentiveCoverage {
  coverageShare?: number | null;
  coveredCount?: number | null;
  totalParcels?: number | null;
}

export interface CorridorCitywideDetails {
  vacancy?: CorridorCitywideVacancy | null;
  turnover?: CorridorCitywideTurnover | null;
  ownershipConcentration?: CorridorCitywideOwnershipConcentration | null;
  ownershipOrigin?: CorridorCitywideOwnershipOrigin | null;
  permits?: CorridorCitywidePermits | null;
  incentiveCoverage?: CorridorCitywideIncentiveCoverage | null;
  windowMonths?: number | null;
  method?: string | null;
}

export interface CorridorCitywideMetric {
  corridorType: string;
  corridorId: string;
  asOf?: string | null;
  vacancyRate?: number | null;
  turnoverRate?: number | null;
  ownershipHHI?: number | null;
  localOwnershipShare?: number | null;
  permitCount?: number | null;
  incentiveCoverage?: number | null;
  /**
   * Present in the source data but MUST NOT be surfaced in any UI copy — see
   * the "Corridor Signals" copy doctrine in app/corridors. Composite scores
   * read as a judgment of the community, which this preview explicitly
   * avoids.
   */
  healthScore?: number | null;
  computedAt?: string | null;
  details?: CorridorCitywideDetails | null;
}

export type CorridorCitywideMap = Record<string, CorridorCitywideMetric>;

const DATA_PATH = path.join(
  process.cwd(),
  "data/exports/corridor-metrics-citywide.json",
);

// Module-level cache, read once per process.
// `undefined` = not attempted yet; `null` = attempted and file is absent or
// unparseable (a legitimate, expected state while the batch job runs).
let cache: CorridorCitywideMap | null | undefined = undefined;

/**
 * Reads and parses the citywide corridor-metrics export once per process,
 * caching the result. Returns `null` if the file does not exist (or fails
 * to parse) rather than throwing, so pages can render a graceful empty state.
 */
export function loadCorridorCitywideData(): CorridorCitywideMap | null {
  if (cache !== undefined) return cache;

  try {
    if (!existsSync(DATA_PATH)) {
      cache = null;
      return cache;
    }
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    cache =
      parsed && typeof parsed === "object"
        ? (parsed as CorridorCitywideMap)
        : null;
  } catch {
    cache = null;
  }

  return cache;
}

/** Sorted list of every ZIP present in the export, or `[]` if unavailable. */
export function getCorridorCitywideZips(): string[] {
  const data = loadCorridorCitywideData();
  if (!data) return [];
  return Object.keys(data).sort();
}

/** The metric record for one ZIP, or `null` if unavailable / not present. */
export function getCorridorCitywideMetric(
  zip: string,
): CorridorCitywideMetric | null {
  const data = loadCorridorCitywideData();
  if (!data) return null;
  return data[zip] ?? null;
}
