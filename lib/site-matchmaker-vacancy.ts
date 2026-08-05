import {
  decodeSiteMatchCriteria,
  isSiteMatchCriteriaReady,
  summarizeSiteMatchCriteria,
  type SiteMatchCriteria,
  type SiteMatchSummary,
} from "./site-matchmaker";
import { normalizePin14 } from "./cook-viewer";
import {
  replaceAvailableSpaceFacts,
  vacancySpaceFacts,
  type PublicAvailableSpaceMeasurement,
} from "./parcel-space";
import type {
  VacancyLandPoint,
  VacancyPropertyType,
  VacancySitePoint,
} from "./vacancy-index";

const SITE_MATCHMAKER_SOURCE = "site-matchmaker";
const CANONICAL_CRITERIA_PARAMS = [
  "sm_use",
  "sm_property",
  "sm_min_sqft",
  "sm_max_sqft",
  "sm_context",
  "sm_transport",
  "sm_transport_distance",
  "sm_walkability",
  "sm_pedestrian_activity",
  "sm_amenities",
] as const;

export interface SiteMatchmakerVacancyHandoff {
  criteria: SiteMatchCriteria;
  summary: SiteMatchSummary;
  footprintBoundActive: boolean;
}

/**
 * Accept only the namespaced handoff emitted by the Site Matchmaker. The ZIP
 * comes from the route, while all other criteria are copied from canonical
 * `sm_*` parameters before using the shared decoder and readiness contract.
 */
export function decodeSiteMatchmakerVacancyHandoff(
  zip: string,
  params: URLSearchParams,
): SiteMatchmakerVacancyHandoff | null {
  if (params.get("source") !== SITE_MATCHMAKER_SOURCE) return null;
  if (!params.has("sm_use") || !params.has("sm_property")) return null;

  const canonical = new URLSearchParams({ zip });
  for (const key of CANONICAL_CRITERIA_PARAMS) {
    for (const value of params.getAll(key)) canonical.append(key, value);
  }

  const criteria = decodeSiteMatchCriteria(canonical);
  if (!isSiteMatchCriteriaReady(criteria) || criteria.zip !== zip) return null;

  return {
    criteria,
    summary: summarizeSiteMatchCriteria(criteria),
    footprintBoundActive:
      criteria.minSquareFeet != null || criteria.maxSquareFeet != null,
  };
}

export interface VacancyPrefilterSelectors<T> {
  propertyType: (record: T) => VacancyPropertyType | null;
  squareFeet: (record: T) => number | null;
}

export interface VacancyPrefilterResult<T> {
  records: T[];
  loadedCount: number;
  keptCount: number;
  propertyUniverseCount: number;
  omittedPropertyTypeCount: number;
  unassessedUnknownSizeCount: number;
  confirmedFootprintCount: number;
  omittedOutsideFootprintCount: number;
}

function availableSpaceByPin(
  measurements: readonly PublicAvailableSpaceMeasurement[],
): ReadonlyMap<string, PublicAvailableSpaceMeasurement> {
  return new Map(measurements.map((measurement) => [measurement.pin, measurement]));
}

/** Reconcile static rows with a live snapshot before filtering or plotting. */
export function applyCurrentAvailableSpaceToSitePoints(
  records: readonly VacancySitePoint[],
  measurements: readonly PublicAvailableSpaceMeasurement[],
  authoritative: boolean,
): VacancySitePoint[] {
  const byPin = availableSpaceByPin(measurements);
  return records.map((record) => {
    const base = vacancySpaceFacts(record.propertyType, record.space, record.squareFeet);
    const pin = normalizePin14(record.pin);
    const space = authoritative
      ? replaceAvailableSpaceFacts(base, pin ? byPin.get(pin) : null)
      : base;
    const { space: _previousSpace, ...rest } = record;
    return space ? { ...rest, space } : rest;
  });
}

export function applyCurrentAvailableSpaceToLandPoints(
  records: readonly VacancyLandPoint[],
  measurements: readonly PublicAvailableSpaceMeasurement[],
  authoritative: boolean,
): VacancyLandPoint[] {
  const byPin = availableSpaceByPin(measurements);
  return records.map((record) => {
    const base = vacancySpaceFacts("vacant_land", record.space, record.squareFeet);
    const pin = normalizePin14(record.pin);
    const space = authoritative
      ? replaceAvailableSpaceFacts(base, pin ? byPin.get(pin) : null)
      : base;
    const { space: _previousSpace, ...rest } = record;
    return space ? { ...rest, space } : rest;
  });
}

function propertyTypeIsIncluded(
  recordType: VacancyPropertyType | null,
  requestedType: SiteMatchCriteria["propertyType"],
): boolean {
  if (recordType !== "vacant_building" && recordType !== "vacant_land") return false;
  if (requestedType === "existing-building") return recordType === "vacant_building";
  if (requestedType === "vacant-land") return recordType === "vacant_land";
  return requestedType === "either";
}

/**
 * Apply only filters supported by the current vacancy records. Unknown sizes
 * remain visible as explicitly unassessed leads; they are never represented as
 * satisfying the requested footprint. Known out-of-range records are omitted.
 */
export function prefilterVacancyRecords<T>(
  records: readonly T[],
  criteria: SiteMatchCriteria,
  selectors: VacancyPrefilterSelectors<T>,
): VacancyPrefilterResult<T> {
  const kept: T[] = [];
  const footprintBoundActive =
    criteria.minSquareFeet != null || criteria.maxSquareFeet != null;
  let propertyUniverseCount = 0;
  let omittedPropertyTypeCount = 0;
  let unassessedUnknownSizeCount = 0;
  let confirmedFootprintCount = 0;
  let omittedOutsideFootprintCount = 0;

  for (const record of records) {
    if (!propertyTypeIsIncluded(selectors.propertyType(record), criteria.propertyType)) {
      omittedPropertyTypeCount += 1;
      continue;
    }

    propertyUniverseCount += 1;
    if (!footprintBoundActive) {
      kept.push(record);
      continue;
    }

    const squareFeet = selectors.squareFeet(record);
    if (squareFeet == null || !Number.isFinite(squareFeet) || squareFeet <= 0) {
      unassessedUnknownSizeCount += 1;
      kept.push(record);
      continue;
    }
    if (
      (criteria.minSquareFeet != null && squareFeet < criteria.minSquareFeet) ||
      (criteria.maxSquareFeet != null && squareFeet > criteria.maxSquareFeet)
    ) {
      omittedOutsideFootprintCount += 1;
      continue;
    }
    confirmedFootprintCount += 1;
    kept.push(record);
  }

  return {
    records: kept,
    loadedCount: records.length,
    keptCount: kept.length,
    propertyUniverseCount,
    omittedPropertyTypeCount,
    unassessedUnknownSizeCount,
    confirmedFootprintCount,
    omittedOutsideFootprintCount,
  };
}
