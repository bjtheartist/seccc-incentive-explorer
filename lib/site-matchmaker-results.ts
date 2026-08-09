/**
 * Public-safe normalization and spreadsheet helpers for Site Matchmaker results.
 *
 * Both vacancy map source views are preserved as separate rows. This module
 * never deduplicates tracked inventory against reconciled vacant land, and its
 * normalized shape intentionally excludes owner names, internal ordering
 * inputs, scores, recommendation buckets, and projected incentive amounts.
 *
 * Client-safe: vacancy-index imports are type-only so its node:fs-backed loader
 * never enters the browser bundle.
 */

import { clerkRecordsUrl, cookViewerUrl, normalizePin14 } from "@/lib/cook-viewer";
import {
  OWNER_SECTOR_LABELS,
  classifyOwnerSector,
  type OwnerSector,
} from "@/lib/owner-sector";
import {
  OWNER_STRUCTURE_LABELS,
  normalizeOwnerStructure,
  type OwnerStructure,
} from "@/lib/owner-taxonomy";
import {
  siteMatchmakerContextKey,
  type SiteMatchmakerContextMetric,
} from "@/lib/site-matchmaker-context";
import {
  replaceAvailableSpaceFacts,
  siteMatchAreaForProperty,
  siteMatchAreaLabel,
  squareFeetLabel,
  vacancySpaceFacts,
  type ParcelSpaceFacts,
  type PublicAvailableSpaceMeasurement,
  type SiteMatchAreaKind,
} from "@/lib/parcel-space";
import type {
  VacancyLandPoint,
  VacancyPropertyType,
  VacancySitePoint,
} from "@/lib/vacancy-index";

export type SiteMatchmakerSource = "tracked_inventory" | "reconciled_vacant_land";

export const SITE_MATCHMAKER_SOURCES: readonly SiteMatchmakerSource[] = [
  "tracked_inventory",
  "reconciled_vacant_land",
];

export const SITE_MATCHMAKER_SOURCE_LABELS: Record<SiteMatchmakerSource, string> = {
  tracked_inventory: "Tracked inventory",
  reconciled_vacant_land: "Reconciled vacant land",
};

export const SITE_MATCHMAKER_PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant building",
};

export type FootprintPublication = "published" | "not_published";

export const FOOTPRINT_PUBLICATION_LABELS: Record<FootprintPublication, string> = {
  published: "Matching area published",
  not_published: "Matching area not published",
};

export type CandidateDistressStatus = "tax_sale" | "violation" | "none";

export const CANDIDATE_DISTRESS_VALUES: readonly CandidateDistressStatus[] = [
  "tax_sale",
  "violation",
  "none",
];

export const CANDIDATE_DISTRESS_LABELS: Record<CandidateDistressStatus, string> = {
  tax_sale: "Tax-sale record on file",
  violation: "Violation on file",
  none: "No mapped flags",
};

export const ZONING_NOT_PUBLISHED = "status:not_published";
export const ZONING_NOT_MAPPED = "status:not_mapped_in_source";
const ZONING_CODE_PREFIX = "code:";

export type EpaWalkabilityCategory =
  | "least_walkable"
  | "below_average"
  | "above_average"
  | "most_walkable";

export const EPA_WALKABILITY_CATEGORY_LABELS: Record<EpaWalkabilityCategory, string> = {
  least_walkable: "Least walkable (1-5.75)",
  below_average: "Below average (5.76-10.5)",
  above_average: "Above average (10.51-15.25)",
  most_walkable: "Most walkable (15.26-20)",
};

export const EPA_WALKABILITY_CATEGORIES: readonly EpaWalkabilityCategory[] = [
  "least_walkable",
  "below_average",
  "above_average",
  "most_walkable",
];

export type CandidateSortKey =
  | "address"
  | "footprint"
  | "lot_area"
  | "assessor_building"
  | "ground_footprint"
  | "available_space"
  | "population_density"
  | "walkability"
  | "expressway_distance"
  | "midway_distance"
  | "ohare_distance";
export type CandidateSortDirection = "asc" | "desc";

export interface SiteMatchmakerCandidateRow {
  /** Source-qualified positional id. It preserves duplicates without collision. */
  id: string;
  source: SiteMatchmakerSource;
  address: string | null;
  pin: string | null;
  lat: number;
  lon: number;
  contextKey: string;
  context: SiteMatchmakerContextMetric | null;
  propertyType: VacancyPropertyType;
  /** Area used for a min/max match: lot area for land, verified space for a building. */
  squareFeet: number | null;
  matchAreaKind: SiteMatchAreaKind;
  space: ParcelSpaceFacts;
  ownerSector: OwnerSector;
  ownerStructure: OwnerStructure;
  zoningClass: string | null;
  zoningAvailability: "published" | "not_published" | "not_mapped_in_source";
  incentiveGeographyCount: number | null;
  incentiveAvailability: "published" | "not_mapped_in_source";
  saleYear: number | null;
  /** Null means the source view does not map building-violation flags. */
  violation: boolean | null;
}

export interface SiteMatchmakerCandidateFilters {
  search: string;
  sources: ReadonlySet<SiteMatchmakerSource>;
  propertyTypes: ReadonlySet<VacancyPropertyType>;
  footprintPublication: ReadonlySet<FootprintPublication>;
  ownerSectors: ReadonlySet<OwnerSector>;
  ownerStructures: ReadonlySet<OwnerStructure>;
  zoning: ReadonlySet<string>;
  distress: ReadonlySet<CandidateDistressStatus>;
  minimumPopulationDensity: number | null;
  walkabilityCategories: ReadonlySet<EpaWalkabilityCategory>;
  maximumExpresswayMiles: number | null;
  maximumNearestAirportMiles: number | null;
}

export interface CandidateSort {
  key: CandidateSortKey;
  direction: CandidateSortDirection;
}

function publishedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTrackedPoint(
  point: VacancySitePoint,
  sourceIndex: number,
): SiteMatchmakerCandidateRow {
  const zoningClass = publishedText(point.zoningClass);
  const space = vacancySpaceFacts(point.propertyType, point.space, point.squareFeet) ?? {};
  const matchArea = siteMatchAreaForProperty(point.propertyType, space);
  return {
    id: `tracked_inventory:${sourceIndex}`,
    source: "tracked_inventory",
    address: publishedText(point.address),
    pin: normalizePin14(point.pin),
    lat: point.lat,
    lon: point.lon,
    contextKey: siteMatchmakerContextKey(point),
    context: null,
    propertyType: point.propertyType,
    squareFeet: matchArea.sqft,
    matchAreaKind: matchArea.kind,
    space,
    ownerSector: classifyOwnerSector(point),
    ownerStructure: normalizeOwnerStructure(point.ownerStructure),
    zoningClass,
    zoningAvailability: zoningClass === null ? "not_published" : "published",
    incentiveGeographyCount: point.incentiveCount,
    incentiveAvailability: "published",
    saleYear: point.saleYear,
    violation: point.violation,
  };
}

function normalizeLandPoint(
  point: VacancyLandPoint,
  sourceIndex: number,
): SiteMatchmakerCandidateRow {
  const space = vacancySpaceFacts("vacant_land", point.space, point.squareFeet) ?? {};
  const matchArea = siteMatchAreaForProperty("vacant_land", space);
  return {
    id: `reconciled_vacant_land:${sourceIndex}`,
    source: "reconciled_vacant_land",
    address: publishedText(point.address),
    pin: normalizePin14(point.pin),
    lat: point.lat,
    lon: point.lon,
    contextKey: siteMatchmakerContextKey(point),
    context: null,
    propertyType: "vacant_land",
    squareFeet: matchArea.sqft,
    matchAreaKind: matchArea.kind,
    space,
    ownerSector: classifyOwnerSector(point),
    ownerStructure: normalizeOwnerStructure(point.ownerStructure),
    zoningClass: null,
    zoningAvailability: "not_mapped_in_source",
    incentiveGeographyCount: null,
    incentiveAvailability: "not_mapped_in_source",
    saleYear: point.saleYear,
    violation: null,
  };
}

/** Concatenate both map source views in source order without dropping duplicates. */
export function normalizeSiteMatchmakerCandidates(
  sitePoints: readonly VacancySitePoint[],
  landPoints: readonly VacancyLandPoint[] | null | undefined,
): SiteMatchmakerCandidateRow[] {
  return [
    ...sitePoints.map(normalizeTrackedPoint),
    ...(landPoints ?? []).map(normalizeLandPoint),
  ];
}

/** Join one ZIP-level context snapshot without changing candidate order or cardinality. */
export function joinCandidateContext(
  rows: readonly SiteMatchmakerCandidateRow[],
  contextByKey: ReadonlyMap<string, SiteMatchmakerContextMetric>,
): SiteMatchmakerCandidateRow[] {
  return rows.map((row) => ({
    ...row,
    context: contextByKey.get(row.contextKey) ?? null,
  }));
}

export interface ParsedSiteMatchmakerContext {
  generatedAt: string;
  sourceNotes: string[];
  contextByKey: Map<string, SiteMatchmakerContextMetric>;
}

export function parseAvailableSpacePayload(value: unknown): PublicAvailableSpaceMeasurement[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const measurements = (value as { measurements?: unknown }).measurements;
  if (!Array.isArray(measurements)) return [];
  const output: PublicAvailableSpaceMeasurement[] = [];
  for (const item of measurements) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const pin = normalizePin14(typeof row.pin === "string" ? row.pin : null);
    const availableSpaceSqft = Number(row.availableSpaceSqft);
    const source = typeof row.source === "string" ? row.source.trim() : "";
    const verifiedAt = typeof row.verifiedAt === "string" ? row.verifiedAt.trim() : "";
    const reconfirmAfter =
      typeof row.reconfirmAfter === "string" ? row.reconfirmAfter.trim() : "";
    if (
      pin === null ||
      !Number.isFinite(availableSpaceSqft) ||
      availableSpaceSqft <= 0 ||
      !source ||
      !verifiedAt ||
      !Number.isFinite(Date.parse(verifiedAt)) ||
      !Number.isFinite(Date.parse(reconfirmAfter)) ||
      Date.parse(reconfirmAfter) <= Date.now()
    ) {
      continue;
    }
    output.push({
      pin,
      availableSpaceSqft: Math.round(availableSpaceSqft),
      source,
      verifiedAt,
      reconfirmAfter,
    });
  }
  return output;
}

/** Apply an authoritative live snapshot without changing row order or cardinality. */
export function joinCandidateAvailableSpace(
  rows: readonly SiteMatchmakerCandidateRow[],
  measurements: readonly PublicAvailableSpaceMeasurement[],
): SiteMatchmakerCandidateRow[] {
  const byPin = new Map(measurements.map((measurement) => [measurement.pin, measurement]));
  return rows.map((row) => {
    const measurement = row.pin ? byPin.get(row.pin) : undefined;
    const space = replaceAvailableSpaceFacts(row.space, measurement) ?? {};
    const matchArea = siteMatchAreaForProperty(row.propertyType, space);
    return { ...row, space, squareFeet: matchArea.sqft, matchAreaKind: matchArea.kind };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function nullableFiniteNumber(
  value: unknown,
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY,
): value is number | null {
  return value === null || (finiteNumber(value, minimum) && value <= maximum);
}

function parseContextMetric(value: unknown): SiteMatchmakerContextMetric | null {
  if (!isRecord(value)) return null;
  if (
    value.tractId !== null &&
    (typeof value.tractId !== "string" || value.tractId.trim().length === 0)
  ) {
    return null;
  }
  if (!nullableFiniteNumber(value.population)) return null;
  if (!nullableFiniteNumber(value.populationDensityPerSqMi)) return null;
  if (!nullableFiniteNumber(value.walkabilityIndex, 1, 20)) return null;
  if (
    value.nearestExpresswayName !== null &&
    (typeof value.nearestExpresswayName !== "string" ||
      value.nearestExpresswayName.trim().length === 0)
  ) {
    return null;
  }
  if (!nullableFiniteNumber(value.nearestExpresswayMiles)) return null;
  if (!finiteNumber(value.midwayMiles)) return null;
  if (!finiteNumber(value.ohareMiles)) return null;

  return {
    tractId: value.tractId,
    population: value.population,
    populationDensityPerSqMi: value.populationDensityPerSqMi,
    walkabilityIndex: value.walkabilityIndex,
    nearestExpresswayName: value.nearestExpresswayName,
    nearestExpresswayMiles: value.nearestExpresswayMiles,
    midwayMiles: value.midwayMiles,
    ohareMiles: value.ohareMiles,
  };
}

function sourceNotes(value: unknown): string[] {
  const notes: string[] = [];
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      notes.push(candidate.trim());
      continue;
    }
    if (!isRecord(candidate)) continue;
    const label = [candidate.name, candidate.label, candidate.title].find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (label) notes.push(label.trim());
  }
  return [...new Set(notes)];
}

/** Validate a static ZIP snapshot and accept either keyed-object or keyed-array rows. */
export function parseSiteMatchmakerContextPayload(
  value: unknown,
  expectedZip: string,
): ParsedSiteMatchmakerContext | null {
  if (!isRecord(value) || value.version !== 1 || value.zip !== expectedZip) return null;
  if (typeof value.generatedAt !== "string" || value.generatedAt.trim().length === 0) return null;

  const contextByKey = new Map<string, SiteMatchmakerContextMetric>();
  if (isRecord(value.rows)) {
    for (const [key, rawMetric] of Object.entries(value.rows)) {
      const metric = parseContextMetric(rawMetric);
      if (key.trim().length > 0 && metric !== null) contextByKey.set(key, metric);
    }
  } else if (Array.isArray(value.rows)) {
    for (const rawRow of value.rows) {
      if (!isRecord(rawRow)) continue;
      const keyCandidate = rawRow.contextKey ?? rawRow.key;
      const key = typeof keyCandidate === "string" ? keyCandidate.trim() : "";
      const metric = parseContextMetric(rawRow);
      if (key.length > 0 && metric !== null) contextByKey.set(key, metric);
    }
  } else {
    return null;
  }

  return {
    generatedAt: value.generatedAt,
    sourceNotes: sourceNotes(value.sources),
    contextByKey,
  };
}

export function epaWalkabilityCategory(
  value: number | null | undefined,
): EpaWalkabilityCategory | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1 || value > 20) {
    return null;
  }
  if (value <= 5.75) return "least_walkable";
  if (value <= 10.5) return "below_average";
  if (value <= 15.25) return "above_average";
  return "most_walkable";
}

export function nearestAirportMiles(row: SiteMatchmakerCandidateRow): number | null {
  if (row.context === null) return null;
  const distances = [row.context.midwayMiles, row.context.ohareMiles].filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return distances.length > 0 ? Math.min(...distances) : null;
}

export function candidateFootprintPublication(
  row: SiteMatchmakerCandidateRow,
): FootprintPublication {
  return row.squareFeet === null ? "not_published" : "published";
}

export function candidateZoningFilterValue(row: SiteMatchmakerCandidateRow): string {
  if (row.zoningAvailability === "not_mapped_in_source") return ZONING_NOT_MAPPED;
  if (row.zoningAvailability === "not_published" || row.zoningClass === null) {
    return ZONING_NOT_PUBLISHED;
  }
  return `${ZONING_CODE_PREFIX}${row.zoningClass}`;
}

export function candidateZoningFilterLabel(value: string): string {
  if (value === ZONING_NOT_MAPPED) return "Not mapped in this source";
  if (value === ZONING_NOT_PUBLISHED) return "Not published";
  return value.startsWith(ZONING_CODE_PREFIX) ? value.slice(ZONING_CODE_PREFIX.length) : value;
}

export function candidateDistressStatuses(
  row: SiteMatchmakerCandidateRow,
): CandidateDistressStatus[] {
  const statuses: CandidateDistressStatus[] = [];
  if (row.saleYear !== null) statuses.push("tax_sale");
  if (row.violation === true) statuses.push("violation");
  return statuses.length > 0 ? statuses : ["none"];
}

/** OR within a dimension, AND across dimensions; every empty set is no filter. */
export function candidateMatchesFilters(
  row: SiteMatchmakerCandidateRow,
  filters: SiteMatchmakerCandidateFilters,
): boolean {
  if (filters.sources.size > 0 && !filters.sources.has(row.source)) return false;
  if (filters.propertyTypes.size > 0 && !filters.propertyTypes.has(row.propertyType)) return false;
  if (
    filters.footprintPublication.size > 0 &&
    !filters.footprintPublication.has(candidateFootprintPublication(row))
  ) {
    return false;
  }
  if (filters.ownerSectors.size > 0 && !filters.ownerSectors.has(row.ownerSector)) return false;
  if (
    filters.ownerStructures.size > 0 &&
    !filters.ownerStructures.has(row.ownerStructure)
  ) {
    return false;
  }
  if (filters.zoning.size > 0 && !filters.zoning.has(candidateZoningFilterValue(row))) {
    return false;
  }
  if (
    filters.distress.size > 0 &&
    !candidateDistressStatuses(row).some((status) => filters.distress.has(status))
  ) {
    return false;
  }
  if (
    filters.minimumPopulationDensity !== null &&
    (row.context?.populationDensityPerSqMi === null ||
      row.context?.populationDensityPerSqMi === undefined ||
      row.context.populationDensityPerSqMi < filters.minimumPopulationDensity)
  ) {
    return false;
  }
  const walkabilityCategory = epaWalkabilityCategory(row.context?.walkabilityIndex);
  if (
    filters.walkabilityCategories.size > 0 &&
    (walkabilityCategory === null || !filters.walkabilityCategories.has(walkabilityCategory))
  ) {
    return false;
  }
  if (
    filters.maximumExpresswayMiles !== null &&
    (row.context?.nearestExpresswayMiles === null ||
      row.context?.nearestExpresswayMiles === undefined ||
      row.context.nearestExpresswayMiles > filters.maximumExpresswayMiles)
  ) {
    return false;
  }
  const airportMiles = nearestAirportMiles(row);
  if (
    filters.maximumNearestAirportMiles !== null &&
    (airportMiles === null || airportMiles > filters.maximumNearestAirportMiles)
  ) {
    return false;
  }

  const needle = filters.search.trim().toLocaleLowerCase("en-US");
  if (needle.length === 0) return true;

  if (row.address?.toLocaleLowerCase("en-US").includes(needle)) return true;
  const pinNeedle = /^[\d\s-]+$/.test(needle) ? needle.replace(/\D/g, "") : "";
  return pinNeedle.length > 0 && row.pin !== null && row.pin.includes(pinNeedle);
}

function compareNullable<T>(
  a: T | null,
  b: T | null,
  compare: (left: T, right: T) => number,
  direction: CandidateSortDirection,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const result = compare(a, b);
  return direction === "asc" ? result : -result;
}

/** Filter and sort without mutating the source. Null sort values always remain last. */
export function filterAndSortCandidateRows(
  rows: readonly SiteMatchmakerCandidateRow[],
  filters: SiteMatchmakerCandidateFilters,
  sort: CandidateSort,
): SiteMatchmakerCandidateRow[] {
  const filtered = rows.filter((row) => candidateMatchesFilters(row, filters));
  const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

  filtered.sort((a, b) => {
    // A record with the relevant size field is actionable before one that
    // still needs size verification, regardless of the selected secondary sort.
    if (a.squareFeet === null && b.squareFeet !== null) return 1;
    if (a.squareFeet !== null && b.squareFeet === null) return -1;
    let primary: number;
    switch (sort.key) {
      case "footprint":
        primary = compareNullable(
          a.squareFeet,
          b.squareFeet,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "lot_area":
        primary = compareNullable(
          a.space.lotAreaSqft ?? null,
          b.space.lotAreaSqft ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "assessor_building":
        primary = compareNullable(
          a.space.assessorBuildingSqft ?? null,
          b.space.assessorBuildingSqft ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "ground_footprint":
        primary = compareNullable(
          a.space.cityGroundFootprintSqft ?? null,
          b.space.cityGroundFootprintSqft ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "available_space":
        primary = compareNullable(
          a.space.availableSpaceSqft ?? null,
          b.space.availableSpaceSqft ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "population_density":
        primary = compareNullable(
          a.context?.populationDensityPerSqMi ?? null,
          b.context?.populationDensityPerSqMi ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "walkability":
        primary = compareNullable(
          a.context?.walkabilityIndex ?? null,
          b.context?.walkabilityIndex ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "expressway_distance":
        primary = compareNullable(
          a.context?.nearestExpresswayMiles ?? null,
          b.context?.nearestExpresswayMiles ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "midway_distance":
        primary = compareNullable(
          a.context?.midwayMiles ?? null,
          b.context?.midwayMiles ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      case "ohare_distance":
        primary = compareNullable(
          a.context?.ohareMiles ?? null,
          b.context?.ohareMiles ?? null,
          (left, right) => left - right,
          sort.direction,
        );
        break;
      default:
        primary = compareNullable(
          a.address,
          b.address,
          (left, right) => collator.compare(left, right),
          sort.direction,
        );
    }
    if (primary !== 0) return primary;
    return collator.compare(a.id, b.id);
  });

  return filtered;
}

export function candidateAddressLabel(row: SiteMatchmakerCandidateRow): string {
  return row.address ?? "Not published";
}

export function candidateFootprintLabel(row: SiteMatchmakerCandidateRow): string {
  return row.squareFeet === null
    ? `Needs size verification · ${siteMatchAreaLabel(row.matchAreaKind)} not published`
    : `${siteMatchAreaLabel(row.matchAreaKind)}: ${squareFeetLabel(row.squareFeet)}`;
}

export function candidateSpaceFactLabel(
  row: SiteMatchmakerCandidateRow,
  field:
    | "lotAreaSqft"
    | "assessorBuildingSqft"
    | "cityGroundFootprintSqft"
    | "availableSpaceSqft",
): string {
  return squareFeetLabel(row.space[field]);
}

export function candidateZoningLabel(row: SiteMatchmakerCandidateRow): string {
  if (row.zoningAvailability === "not_mapped_in_source") return "Not mapped in this source";
  return row.zoningClass ?? "Not published";
}

export function candidateIncentiveGeographyLabel(row: SiteMatchmakerCandidateRow): string {
  if (row.incentiveAvailability === "not_mapped_in_source") {
    return "Not mapped in this source";
  }
  return String(row.incentiveGeographyCount ?? 0);
}

export function candidatePinLabel(row: SiteMatchmakerCandidateRow): string {
  if (row.pin === null) return "Needs verification";
  return `${row.pin.slice(0, 2)}-${row.pin.slice(2, 4)}-${row.pin.slice(4, 7)}-${row.pin.slice(7, 10)}-${row.pin.slice(10)}`;
}

export function candidateFlagLabels(row: SiteMatchmakerCandidateRow): string[] {
  const labels: string[] = [];
  if (row.saleYear !== null) labels.push(`Tax-sale record on file (${row.saleYear})`);
  if (row.violation === true) labels.push("Violation on file");
  if (labels.length === 0) labels.push("No mapped flags");
  if (row.violation === null) labels.push("Building violations: Not mapped in this source");
  return labels;
}

export const SITE_MATCHMAKER_CSV_HEADERS = [
  "Source view",
  "Address",
  "PIN",
  "Property type",
  "Size field used for match",
  "Match area (sq ft)",
  "Lot area (sq ft)",
  "Assessor building area (sq ft)",
  "Assessor building tax year",
  "Mapped building footprint on parcel (sq ft)",
  "Mapped footprint source vintage",
  "Reported available space (sq ft)",
  "Available space source",
  "Available space verified at",
  "Available space reconfirm by",
  "Owner classification",
  "Owner type",
  "Zoning",
  "Incentive geographies",
  "Source-backed flags",
  "Census tract",
  "Tract population",
  "Population density (people/sq mi)",
  "EPA Walkability Index (1-20)",
  "Nearest expressway",
  "Nearest expressway straight-line miles",
  "Midway straight-line miles",
  "O'Hare straight-line miles",
  "Parcel record",
  "Recorded documents",
] as const;

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Build a public-safe CSV for exactly the rows supplied by the current filter. */
export type CandidateContextExportStatus = "available" | "loading" | "unavailable";

function contextCsvValue(
  row: SiteMatchmakerCandidateRow,
  value: string | number | null | undefined,
  status: CandidateContextExportStatus,
): string {
  if (status === "loading") return "Context loading";
  if (status === "unavailable") return "Context unavailable";
  if (row.context === null || value === null || value === undefined || value === "") {
    return "Not mapped for this location";
  }
  return String(value);
}

export function candidateRowsToCsv(
  rows: readonly SiteMatchmakerCandidateRow[],
  contextStatus: CandidateContextExportStatus = "available",
): string {
  const body = rows.map((row) => {
    const parcelRecord = cookViewerUrl(row.pin) ?? "Needs verification";
    const recordedDocuments = clerkRecordsUrl(row.pin) ?? "Needs verification";
    return [
      SITE_MATCHMAKER_SOURCE_LABELS[row.source],
      candidateAddressLabel(row),
      candidatePinLabel(row),
      SITE_MATCHMAKER_PROPERTY_TYPE_LABELS[row.propertyType],
      siteMatchAreaLabel(row.matchAreaKind),
      row.squareFeet === null ? "Not published" : String(row.squareFeet),
      row.space.lotAreaSqft == null ? "Not published" : String(row.space.lotAreaSqft),
      row.space.assessorBuildingSqft == null
        ? "Not published"
        : String(row.space.assessorBuildingSqft),
      row.space.assessorBuildingYear == null
        ? "Not published"
        : String(row.space.assessorBuildingYear),
      row.space.cityGroundFootprintSqft == null
        ? "Not published"
        : String(row.space.cityGroundFootprintSqft),
      row.space.cityGroundFootprintVintage ?? "Not published",
      row.space.availableSpaceSqft == null
        ? "Not verified"
        : String(row.space.availableSpaceSqft),
      row.space.availableSpaceSource ?? "Not verified",
      row.space.availableSpaceVerifiedAt ?? "Not verified",
      row.space.availableSpaceReconfirmAfter ?? "Not verified",
      OWNER_SECTOR_LABELS[row.ownerSector],
      OWNER_STRUCTURE_LABELS[row.ownerStructure],
      candidateZoningLabel(row),
      candidateIncentiveGeographyLabel(row),
      candidateFlagLabels(row).join(" | "),
      contextCsvValue(row, row.context?.tractId, contextStatus),
      contextCsvValue(row, row.context?.population, contextStatus),
      contextCsvValue(row, row.context?.populationDensityPerSqMi, contextStatus),
      contextCsvValue(
        row,
        row.context?.walkabilityIndex == null
          ? row.context?.walkabilityIndex
          : row.context.walkabilityIndex.toFixed(1),
        contextStatus,
      ),
      contextCsvValue(row, row.context?.nearestExpresswayName, contextStatus),
      contextCsvValue(row, row.context?.nearestExpresswayMiles, contextStatus),
      contextCsvValue(row, row.context?.midwayMiles, contextStatus),
      contextCsvValue(row, row.context?.ohareMiles, contextStatus),
      parcelRecord,
      recordedDocuments,
    ];
  });

  return [SITE_MATCHMAKER_CSV_HEADERS, ...body]
    .map((values) => values.map((value) => csvCell(String(value))).join(","))
    .join("\r\n");
}
