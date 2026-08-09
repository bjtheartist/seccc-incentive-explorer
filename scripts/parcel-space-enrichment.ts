import { createHash } from "node:crypto";
import {
  area,
  booleanIntersects,
  featureCollection,
  geojsonRbush,
  intersect,
  union,
} from "@turf/turf";
import type {
  Feature,
  GeoJsonProperties,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";
import {
  COOK_COUNTY_CURRENT_PARCELS_QUERY_URL,
  normalizePin14,
} from "../lib/cook-viewer";

export { normalizePin14 };

export const CITY_BUILDING_FOOTPRINTS_DATASET_ID = "syp8-uezg";
export const CITY_BUILDING_FOOTPRINTS_VINTAGE_YEAR = 2015;
export const COOK_COUNTY_COMMERCIAL_VALUATION_DATASET_ID = "csik-bsws";
export const SQUARE_METERS_TO_SQUARE_FEET = 10.763910416709722;

export const PARCEL_SPACE_METRICS = [
  "lot_area",
  "assessor_building_area",
  "city_ground_footprint",
  "available_space",
] as const;

export type ParcelSpaceMetric = (typeof PARCEL_SPACE_METRICS)[number];
export type ParcelSpaceMatchMethod =
  | "exact_pin"
  | "spatial_intersection"
  | "verified_submission";
export type ParcelSpaceVerificationStatus =
  | "published"
  | "computed"
  | "verified";
export type AvailableSpaceScope =
  "largest_contiguous_usable_interior_space";

interface ParcelSpaceMeasurementBase {
  pin: string;
  zip: string | null;
  sqft: number;
  sourceKey: string;
  sourceRecordId: string;
  sourceYear: number | null;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  matchMethod: ParcelSpaceMatchMethod;
  verificationStatus: ParcelSpaceVerificationStatus;
  notes: string | null;
  rawJson: Record<string, unknown>;
  unit: "square_feet";
}

export type ParcelSpaceMeasurementInput =
  | (ParcelSpaceMeasurementBase & {
      metric: Exclude<ParcelSpaceMetric, "available_space">;
      measurementScope: null;
      verifiedAt: null;
      reconfirmAfter: null;
      isActive: true;
    })
  | (ParcelSpaceMeasurementBase & {
      metric: "available_space";
      measurementScope: AvailableSpaceScope;
      verifiedAt: string;
      reconfirmAfter: string;
      isActive: boolean;
    });

export interface CookViewerParcelRecord {
  pin: string;
  landSqft: number | null;
  buildingSqft: number | null;
  buildingAge: number | null;
  taxYear: number | null;
  geometryYear: number | null;
  globalId: string | null;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  rawJson: Record<string, unknown>;
}

export interface CommercialBuildingAreaRecord {
  pin: string;
  buildingSqft: number;
  sourceYear: number;
  fetchedAt: string;
  rawJson: Record<string, unknown>;
}

export interface CommercialBuildingNormalizationResult {
  records: CommercialBuildingAreaRecord[];
  observedPins: string[];
  ambiguousPins: string[];
  unresolvedPins: string[];
  invalidPinRows: number;
  invalidYearRows: number;
  identicalRowsDeduplicated: number;
}

export type ParcelPolygonProperties = Record<string, unknown> & {
  pin: string;
  zip: string;
};

export type CityBuildingPolygonProperties = Record<string, unknown> & {
  sourceRecordId: string;
  status: string | null;
  sourceUpdatedAt: string | null;
  rawJson: Record<string, unknown>;
};

export type ParcelPolygonFeature = Feature<
  Polygon | MultiPolygon,
  ParcelPolygonProperties
>;
export type CityBuildingPolygonFeature = Feature<
  Polygon | MultiPolygon,
  CityBuildingPolygonProperties
>;

export interface CityFootprintOverlap {
  pin: string;
  sqft: number;
  buildingIds: string[];
  sourceUpdatedAt: string | null;
  intersections: Array<{
    buildingId: string;
    overlapSqft: number;
  }>;
}

export interface CityFootprintAggregationResult {
  rows: CityFootprintOverlap[];
  diagnostics: {
    inputBuildingCount: number;
    indexedBuildingCount: number;
    duplicateBuildingCount: number;
    excludedStatusCount: number;
    candidateComparisonCount: number;
    positiveIntersectionCount: number;
  };
}

export interface ArcGisFeatureCollection {
  features?: Array<Feature<Geometry | null, Record<string, unknown>> & {
    attributes?: Record<string, unknown>;
  }>;
  exceededTransferLimit?: boolean;
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
}

export interface CookViewerFetchOptions {
  outFields: readonly string[];
  returnGeometry: boolean;
  pageSize?: number;
  pinBatchSize?: number;
  timeoutMs?: number;
}

export interface CookViewerFetchResult {
  features: Array<Feature<Geometry | null, Record<string, unknown>>>;
  pageCount: number;
}

function valueFor(
  record: Record<string, unknown>,
  ...names: string[]
): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }

  const entries = Object.entries(record);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && match[1] !== undefined && match[1] !== null) return match[1];
  }

  return null;
}

export function positiveNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "string"
      ? Number(value.replace(/,/g, "").trim())
      : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = positiveNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function sourceYearOrNull(value: unknown): number | null {
  const parsed = positiveIntegerOrNull(value);
  return parsed !== null && parsed >= 1800 && parsed <= 3000 ? parsed : null;
}

export function timestampIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  let epochMs: number | null = null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      epochMs = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    }
  }

  if (epochMs === null) {
    let text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
      text += "Z";
    }
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) return null;
    epochMs = parsed;
  }

  const date = new Date(epochMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function latestTimestampIso(
  values: readonly unknown[],
): string | null {
  let latest: string | null = null;
  for (const value of values) {
    const normalized = timestampIsoOrNull(value);
    if (normalized && (!latest || normalized > latest)) latest = normalized;
  }
  return latest;
}

export function normalizeCookViewerParcelRecord(
  properties: Record<string, unknown>,
  fetchedAt = new Date().toISOString(),
): CookViewerParcelRecord | null {
  const pin = normalizePin14(valueFor(properties, "PIN14", "pin14", "PIN"));
  if (!pin) return null;

  return {
    pin,
    landSqft: positiveNumberOrNull(
      valueFor(properties, "LANDSF", "LandSqft"),
    ),
    buildingSqft: positiveNumberOrNull(
      valueFor(properties, "BLDGSQFT", "BldgSqft"),
    ),
    buildingAge: positiveIntegerOrNull(
      valueFor(properties, "BLDGAGE", "BldgAge"),
    ),
    taxYear: sourceYearOrNull(valueFor(properties, "TAXYR", "taxyr")),
    geometryYear: sourceYearOrNull(valueFor(properties, "geom_year")),
    globalId:
      String(valueFor(properties, "GlobalID", "globalid") ?? "").trim() || null,
    sourceUpdatedAt: latestTimestampIso([
      valueFor(properties, "last_edited_date"),
      valueFor(properties, "assessor_update_date"),
    ]),
    fetchedAt,
    rawJson: { ...properties },
  };
}

export function cookViewerMeasurementRows(
  record: CookViewerParcelRecord,
): ParcelSpaceMeasurementInput[] {
  const sourceYear = record.taxYear ?? record.geometryYear;
  const baseRecordId = record.globalId ?? record.pin;
  const sourceRecordId = `${baseRecordId}:${sourceYear ?? "unknown"}`;
  const common = {
    pin: record.pin,
    zip: null,
    sourceKey: "cook_county_current_parcels",
    sourceRecordId,
    sourceYear,
    sourceUpdatedAt: record.sourceUpdatedAt,
    fetchedAt: record.fetchedAt,
    matchMethod: "exact_pin" as const,
    verificationStatus: "published" as const,
    rawJson: record.rawJson,
    unit: "square_feet" as const,
    measurementScope: null,
    verifiedAt: null,
    reconfirmAfter: null,
    isActive: true as const,
  };
  const rows: ParcelSpaceMeasurementInput[] = [];

  if (record.landSqft !== null) {
    rows.push({
      ...common,
      metric: "lot_area",
      sqft: record.landSqft,
      notes:
        "Cook County current parcel service LANDSF; zero or missing values are unknown.",
    });
  }

  if (record.buildingSqft !== null) {
    rows.push({
      ...common,
      metric: "assessor_building_area",
      sqft: record.buildingSqft,
      notes:
        "Cook County current parcel service BLDGSQFT; assessor building area, not available space.",
    });
  }

  return rows;
}

/**
 * Normalize property-level Commercial Valuation rows without inventing a
 * rollup. A KeyPIN can have multiple same-year model rows. One unique positive
 * BLDGSF value is publishable; conflicting values are quarantined because the
 * source does not state that they should be summed or prioritized.
 */
export function normalizeCommercialBuildingAreaRecords(
  rows: readonly Record<string, unknown>[],
  fetchedAt = new Date().toISOString(),
): CommercialBuildingNormalizationResult {
  const rowsByPin = new Map<
    string,
    Array<{ year: number; buildingSqft: number | null; raw: Record<string, unknown> }>
  >();
  let invalidPinRows = 0;
  let invalidYearRows = 0;

  for (const raw of rows) {
    const pin = normalizePin14(valueFor(raw, "keypin", "KEYPIN"));
    if (!pin) {
      invalidPinRows++;
      continue;
    }
    const year = sourceYearOrNull(valueFor(raw, "year", "YEAR"));
    if (year === null) {
      invalidYearRows++;
      continue;
    }
    const normalized = {
      year,
      buildingSqft: positiveNumberOrNull(valueFor(raw, "bldgsf", "BLDGSF")),
      raw: { ...raw },
    };
    const existing = rowsByPin.get(pin);
    if (existing) existing.push(normalized);
    else rowsByPin.set(pin, [normalized]);
  }

  const records: CommercialBuildingAreaRecord[] = [];
  const ambiguousPins: string[] = [];
  const unresolvedPins: string[] = [];
  let identicalRowsDeduplicated = 0;

  for (const [pin, pinRows] of rowsByPin) {
    const latestYear = Math.max(...pinRows.map((row) => row.year));
    const latestRows = pinRows.filter((row) => row.year === latestYear);
    const positiveValues = latestRows
      .map((row) => row.buildingSqft)
      .filter((value): value is number => value !== null);
    const uniqueValues = [...new Set(positiveValues)].sort((left, right) => left - right);

    if (uniqueValues.length === 0) {
      unresolvedPins.push(pin);
      continue;
    }
    if (uniqueValues.length > 1) {
      ambiguousPins.push(pin);
      continue;
    }
    identicalRowsDeduplicated += Math.max(0, positiveValues.length - 1);
    records.push({
      pin,
      buildingSqft: uniqueValues[0],
      sourceYear: latestYear,
      fetchedAt,
      rawJson: {
        dataset_id: COOK_COUNTY_COMMERCIAL_VALUATION_DATASET_ID,
        keypin: pin,
        source_rows: latestRows.map((row) => row.raw),
      },
    });
  }

  records.sort((left, right) => left.pin.localeCompare(right.pin));
  const observedPins = [...rowsByPin.keys()].sort();
  ambiguousPins.sort();
  unresolvedPins.sort();
  return {
    records,
    observedPins,
    ambiguousPins,
    unresolvedPins,
    invalidPinRows,
    invalidYearRows,
    identicalRowsDeduplicated,
  };
}

export function commercialBuildingMeasurementRow(
  record: CommercialBuildingAreaRecord,
): ParcelSpaceMeasurementInput {
  return {
    pin: record.pin,
    zip: null,
    metric: "assessor_building_area",
    sqft: record.buildingSqft,
    sourceKey: `cook_county_assessor_commercial_valuation_${COOK_COUNTY_COMMERCIAL_VALUATION_DATASET_ID}`,
    sourceRecordId: `${record.pin}:${record.sourceYear}`,
    sourceYear: record.sourceYear,
    sourceUpdatedAt: null,
    fetchedAt: record.fetchedAt,
    matchMethod: "exact_pin",
    verificationStatus: "published",
    notes:
      "Cook County Assessor Commercial Valuation Data BLDGSF for the exact KeyPIN. A commercial assessment unit may span multiple PINs; this value is not allocated to associated PINs and is not available space.",
    rawJson: record.rawJson,
    unit: "square_feet",
    measurementScope: null,
    verifiedAt: null,
    reconfirmAfter: null,
    isActive: true,
  };
}

export function isMappedBuildingStatus(value: unknown): boolean {
  return String(value ?? "").trim().toUpperCase() === "ACTIVE";
}

export function stableSourceRecordId(
  prefix: string,
  sourceRecordIds: readonly string[],
): string {
  const normalized = [...new Set(sourceRecordIds.map((id) => id.trim()).filter(Boolean))]
    .sort()
    .join("|");
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `${prefix}:${digest}`;
}

export function aggregateCityFootprintAreaByParcel(
  parcels: readonly ParcelPolygonFeature[],
  buildings: readonly CityBuildingPolygonFeature[],
): CityFootprintAggregationResult {
  const uniqueBuildings = new Map<string, CityBuildingPolygonFeature>();
  let duplicateBuildingCount = 0;
  let excludedStatusCount = 0;

  for (const building of buildings) {
    if (!isMappedBuildingStatus(building.properties.status)) {
      excludedStatusCount++;
      continue;
    }
    const id = building.properties.sourceRecordId;
    if (uniqueBuildings.has(id)) {
      duplicateBuildingCount++;
      continue;
    }
    uniqueBuildings.set(id, building);
  }

  const indexedBuildings = [...uniqueBuildings.values()];
  const tree = geojsonRbush<Polygon | MultiPolygon, CityBuildingPolygonProperties>();
  tree.load(indexedBuildings);

  let candidateComparisonCount = 0;
  let positiveIntersectionCount = 0;
  const rows: CityFootprintOverlap[] = [];

  for (const parcel of parcels) {
    const intersections: CityFootprintOverlap["intersections"] = [];
    const clippedPolygons: Array<Feature<Polygon | MultiPolygon>> = [];
    const timestamps: unknown[] = [];
    const candidates = tree.search(parcel).features;

    for (const candidate of candidates) {
      candidateComparisonCount++;
      if (!booleanIntersects(parcel, candidate)) continue;
      const overlap = intersect(
        featureCollection<Polygon | MultiPolygon, GeoJsonProperties>([
          parcel,
          candidate,
        ]),
      );
      if (!overlap) continue;
      const overlapSqft = area(overlap) * SQUARE_METERS_TO_SQUARE_FEET;
      if (!Number.isFinite(overlapSqft) || overlapSqft <= 0) continue;

      positiveIntersectionCount++;
      clippedPolygons.push(overlap);
      intersections.push({
        buildingId: candidate.properties.sourceRecordId,
        overlapSqft,
      });
      timestamps.push(candidate.properties.sourceUpdatedAt);
    }

    if (intersections.length === 0) continue;
    const mappedFootprint =
      clippedPolygons.length === 1
        ? clippedPolygons[0]
        : union(featureCollection(clippedPolygons));
    if (!mappedFootprint) {
      throw new Error(
        `Could not union mapped building footprints for parcel ${parcel.properties.pin}`,
      );
    }
    const mappedFootprintSqft = area(mappedFootprint) * SQUARE_METERS_TO_SQUARE_FEET;
    if (!Number.isFinite(mappedFootprintSqft) || mappedFootprintSqft <= 0) continue;
    intersections.sort((left, right) =>
      left.buildingId.localeCompare(right.buildingId),
    );
    rows.push({
      pin: parcel.properties.pin,
      sqft: mappedFootprintSqft,
      buildingIds: intersections.map((item) => item.buildingId),
      sourceUpdatedAt: latestTimestampIso(timestamps),
      intersections,
    });
  }

  rows.sort((left, right) => left.pin.localeCompare(right.pin));
  return {
    rows,
    diagnostics: {
      inputBuildingCount: buildings.length,
      indexedBuildingCount: indexedBuildings.length,
      duplicateBuildingCount,
      excludedStatusCount,
      candidateComparisonCount,
      positiveIntersectionCount,
    },
  };
}

export function parseZipList(value: string): string[] {
  const raw = value
    .split(",")
    .map((zip) => zip.trim())
    .filter(Boolean);
  if (raw.length === 0) throw new Error("At least one ZIP code is required");

  const invalid = raw.filter((zip) => !/^\d{5}$/.test(zip));
  if (invalid.length > 0) {
    throw new Error(`Invalid ZIP code(s): ${invalid.join(", ")}`);
  }
  return [...new Set(raw)];
}

export function positiveCliInteger(
  value: string,
  flag: string,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${flag} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function featureProperties(
  feature: Feature<Geometry | null, Record<string, unknown>> & {
    attributes?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return feature.properties ?? feature.attributes ?? {};
}

async function fetchJsonWithRetries<T>(
  url: string,
  timeoutMs: number,
  attempts = 3,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Request failed after ${attempts} attempts: ${message}`);
}

export async function fetchCookViewerFeaturesForPins(
  pins: readonly string[],
  options: CookViewerFetchOptions,
): Promise<CookViewerFetchResult> {
  const normalizedPins = [
    ...new Set(pins.map(normalizePin14).filter((pin): pin is string => Boolean(pin))),
  ];
  const pageSize = options.pageSize ?? 1_000;
  const pinBatchSize = options.pinBatchSize ?? 250;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const features: CookViewerFetchResult["features"] = [];
  let pageCount = 0;

  for (let index = 0; index < normalizedPins.length; index += pinBatchSize) {
    const batch = normalizedPins.slice(index, index + pinBatchSize);
    const where = `PIN14 IN (${batch.map((pin) => `'${pin}'`).join(",")})`;
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        where,
        outFields: options.outFields.join(","),
        returnGeometry: String(options.returnGeometry),
        returnZ: "false",
        returnM: "false",
        outSR: "4326",
        orderByFields: "PIN14",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: "geojson",
      });
      const response = await fetchJsonWithRetries<ArcGisFeatureCollection>(
        `${COOK_COUNTY_CURRENT_PARCELS_QUERY_URL}?${params.toString()}`,
        timeoutMs,
      );
      if (response.error) {
        throw new Error(
          `Cook County current parcel service error ${response.error.code ?? "unknown"}: ${[
            response.error.message,
            ...(response.error.details ?? []),
          ]
            .filter(Boolean)
            .join("; ")}`,
        );
      }

      const page = response.features ?? [];
      pageCount++;
      for (const feature of page) {
        features.push({
          ...feature,
          properties: featureProperties(feature),
        });
      }

      if (page.length === 0) {
        if (response.exceededTransferLimit) {
          throw new Error("CookViewer pagination stalled on an empty truncated page");
        }
        break;
      }
      offset += page.length;
      if (!response.exceededTransferLimit && page.length < pageSize) break;
    }
  }

  return { features, pageCount };
}
