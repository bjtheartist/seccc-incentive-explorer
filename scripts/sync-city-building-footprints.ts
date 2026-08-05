#!/usr/bin/env npx tsx
/**
 * Compute parcel-level mapped building footprint from City of Chicago Building
 * Footprints (`syp8-uezg`) and Cook County's current CookViewer parcel
 * polygons. Overlapping clipped building polygons are unioned before area is
 * calculated.
 *
 * The City dataset is labeled with its official August 2015 vintage. These
 * values use the official August 2015 vintage and are never gross building
 * area or available indoor space. Database mutations require --write; dry-run
 * is the default.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-city-building-footprints.ts --zips=60617
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-city-building-footprints.ts --zips=60617,60619 --write
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { bbox, featureCollection } from "@turf/turf";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { socrataHeaders } from "../lib/socrata";
import {
  aggregateCityFootprintAreaByParcel,
  CITY_BUILDING_FOOTPRINTS_DATASET_ID,
  CITY_BUILDING_FOOTPRINTS_VINTAGE_YEAR,
  fetchCookViewerFeaturesForPins,
  latestTimestampIso,
  normalizePin14,
  parseZipList,
  positiveCliInteger,
  stableSourceRecordId,
  type CityBuildingPolygonFeature,
  type ParcelPolygonFeature,
  type ParcelSpaceMeasurementInput,
} from "./parcel-space-enrichment";

const CITY_BUILDING_FOOTPRINTS_URL =
  `https://data.cityofchicago.org/resource/${CITY_BUILDING_FOOTPRINTS_DATASET_ID}.geojson`;
const CITY_BUILDING_SELECT = [
  "the_geom",
  "bldg_id",
  "bldg_statu",
  "stories",
  "edit_date",
  "qc_date",
  "year_built",
  "bldg_sq_fo",
  "shape_area",
].join(",");
const COOKVIEWER_GEOMETRY_FIELDS = ["PIN14"] as const;
const BBOX_PADDING_DEGREES = 0.0005;

interface CityFootprintSyncCliOptions {
  write: boolean;
  help: boolean;
  zips: string[] | null;
  cityPageSize: number;
  cookViewerPageSize: number;
  pinBatchSize: number;
}

interface ScopedParcel {
  pin: string;
  zip: string;
}

type SqlClient = NeonQueryFunction<false, false>;

interface CityGeoJsonResponse {
  type?: string;
  features?: Array<Feature<Geometry | null, Record<string, unknown>>>;
  error?: boolean;
  message?: string;
}

function nextValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCityFootprintSyncCliArgs(
  args: readonly string[],
): CityFootprintSyncCliOptions {
  let write = false;
  let sawWrite = false;
  let sawDryRun = false;
  let help = false;
  let zips: string[] | null = null;
  let cityPageSize = 5_000;
  let cookViewerPageSize = 1_000;
  let pinBatchSize = 200;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--write") {
      sawWrite = true;
      write = true;
    } else if (arg === "--dry-run") {
      sawDryRun = true;
      write = false;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--zips") {
      zips = parseZipList(nextValue(args, index, arg));
      index++;
    } else if (arg.startsWith("--zips=")) {
      zips = parseZipList(arg.slice("--zips=".length));
    } else if (arg === "--city-page-size") {
      cityPageSize = positiveCliInteger(nextValue(args, index, arg), arg, 50_000);
      index++;
    } else if (arg.startsWith("--city-page-size=")) {
      cityPageSize = positiveCliInteger(
        arg.slice("--city-page-size=".length),
        "--city-page-size",
        50_000,
      );
    } else if (arg === "--cookviewer-page-size") {
      cookViewerPageSize = positiveCliInteger(nextValue(args, index, arg), arg, 2_000);
      index++;
    } else if (arg.startsWith("--cookviewer-page-size=")) {
      cookViewerPageSize = positiveCliInteger(
        arg.slice("--cookviewer-page-size=".length),
        "--cookviewer-page-size",
        2_000,
      );
    } else if (arg === "--pin-batch-size") {
      pinBatchSize = positiveCliInteger(nextValue(args, index, arg), arg, 500);
      index++;
    } else if (arg.startsWith("--pin-batch-size=")) {
      pinBatchSize = positiveCliInteger(
        arg.slice("--pin-batch-size=".length),
        "--pin-batch-size",
        500,
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawWrite && sawDryRun) {
    throw new Error("Choose either --write or --dry-run, not both");
  }
  return {
    write,
    help,
    zips,
    cityPageSize,
    cookViewerPageSize,
    pinBatchSize,
  };
}

function printUsage(): void {
  console.log(`City building-footprint parcel enrichment

Usage:
  DATABASE_URL="postgresql://..." npx tsx scripts/sync-city-building-footprints.ts --zips=60617[,60619]
  DATABASE_URL="postgresql://..." npx tsx scripts/sync-city-building-footprints.ts --zips=60617 --write

Options:
  --zips                    Required target ZIPs (or set ZIPS/ZIP)
  --city-page-size           Socrata page size, max 50000 (default: 5000)
  --cookviewer-page-size     ArcGIS page size, max 2000 (default: 1000)
  --pin-batch-size           Exact-PIN query batch size, max 500 (default: 200)
  --dry-run                  Fetch and compute without database writes (default)
  --write                    Upsert computed current measurements
  --help                     Show this help`);
}

async function loadScopedParcels(
  sql: SqlClient,
  zips: readonly string[],
): Promise<ScopedParcel[]> {
  const rows = (await sql`
    SELECT pin, zip
    FROM parcels
    WHERE zip = ANY(${zips})
      AND pin IS NOT NULL
    ORDER BY zip, pin
  `) as Array<{ pin: string; zip: string | null }>;

  const scoped = new Map<string, ScopedParcel>();
  for (const row of rows) {
    const pin = normalizePin14(row.pin);
    if (!pin || !row.zip || !zips.includes(row.zip)) continue;
    scoped.set(pin, { pin, zip: row.zip });
  }
  return [...scoped.values()];
}

function isPolygonGeometry(
  geometry: Geometry | null,
): geometry is Polygon | MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function normalizeParcelPolygons(
  features: readonly Feature<Geometry | null, Record<string, unknown>>[],
  zipByPin: ReadonlyMap<string, string>,
): { parcels: ParcelPolygonFeature[]; invalidCount: number; duplicateCount: number } {
  const parcels = new Map<string, ParcelPolygonFeature>();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const feature of features) {
    const pin = normalizePin14(feature.properties?.PIN14 ?? feature.properties?.pin14);
    const zip = pin ? zipByPin.get(pin) : null;
    if (!pin || !zip || !isPolygonGeometry(feature.geometry)) {
      invalidCount++;
      continue;
    }
    if (parcels.has(pin)) duplicateCount++;
    parcels.set(pin, {
      type: "Feature",
      geometry: feature.geometry,
      properties: { pin, zip },
    });
  }

  return { parcels: [...parcels.values()], invalidCount, duplicateCount };
}

function cityProperty(
  properties: Record<string, unknown>,
  name: string,
): unknown {
  if (properties[name] !== undefined) return properties[name];
  const match = Object.entries(properties).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return match?.[1] ?? null;
}

function normalizeCityBuildingFeature(
  feature: Feature<Geometry | null, Record<string, unknown>>,
): CityBuildingPolygonFeature | null {
  if (!isPolygonGeometry(feature.geometry)) return null;
  const rawJson = { ...(feature.properties ?? {}) };
  const publishedId = String(cityProperty(rawJson, "bldg_id") ?? "").trim();
  const sourceRecordId =
    publishedId || stableSourceRecordId("geometry", [JSON.stringify(feature.geometry)]);
  const status = String(cityProperty(rawJson, "bldg_statu") ?? "").trim() || null;
  const sourceUpdatedAt = latestTimestampIso([
    cityProperty(rawJson, "edit_date"),
    cityProperty(rawJson, "qc_date"),
  ]);

  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      sourceRecordId,
      status,
      sourceUpdatedAt,
      rawJson,
    },
  };
}

async function fetchCityJsonWithRetries(
  url: string,
  attempts = 3,
): Promise<CityGeoJsonResponse> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          ...socrataHeaders(),
          Accept: "application/geo+json, application/json",
        },
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
        );
      }
      return (await response.json()) as CityGeoJsonResponse;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`City building-footprint request failed: ${message}`);
}

async function fetchCityBuildingsForBounds(
  bounds: readonly [number, number, number, number],
  pageSize: number,
): Promise<{ buildings: CityBuildingPolygonFeature[]; pageCount: number; invalidCount: number }> {
  const [west, south, east, north] = bounds;
  const buildings: CityBuildingPolygonFeature[] = [];
  let pageCount = 0;
  let invalidCount = 0;
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      $select: CITY_BUILDING_SELECT,
      $where: `within_box(the_geom, ${north}, ${west}, ${south}, ${east})`,
      $order: "bldg_id",
      $limit: String(pageSize),
      $offset: String(offset),
    });
    const response = await fetchCityJsonWithRetries(
      `${CITY_BUILDING_FOOTPRINTS_URL}?${params.toString()}`,
    );
    if (response.error) {
      throw new Error(response.message || "City building-footprint API returned an error");
    }
    const page = response.features ?? [];
    pageCount++;
    for (const feature of page) {
      const normalized = normalizeCityBuildingFeature(feature);
      if (normalized) buildings.push(normalized);
      else invalidCount++;
    }
    offset += page.length;
    if (page.length < pageSize) break;
  }

  return { buildings, pageCount, invalidCount };
}

function boundsForParcels(
  parcels: readonly ParcelPolygonFeature[],
): [number, number, number, number] {
  const raw = bbox(featureCollection([...parcels]));
  const west = raw[0] - BBOX_PADDING_DEGREES;
  const south = raw[1] - BBOX_PADDING_DEGREES;
  const east = raw[2] + BBOX_PADDING_DEGREES;
  const north = raw[3] + BBOX_PADDING_DEGREES;
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Could not compute a finite parcel bounding box");
  }
  return [west, south, east, north];
}

function serializeMeasurements(rows: readonly ParcelSpaceMeasurementInput[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      pin: row.pin,
      zip: row.zip,
      metric: row.metric,
      sqft: row.sqft,
      measurement_scope: row.measurementScope,
      unit: row.unit,
      source_key: row.sourceKey,
      source_record_id: row.sourceRecordId,
      source_year: row.sourceYear,
      source_updated_at: row.sourceUpdatedAt,
      fetched_at: row.fetchedAt,
      match_method: row.matchMethod,
      verification_status: row.verificationStatus,
      notes: row.notes,
      raw_json: row.rawJson,
      verified_at: row.verifiedAt,
      reconfirm_after: row.reconfirmAfter,
      is_active: row.isActive,
    })),
  );
}

async function writeCityFootprintBatch(
  sql: SqlClient,
  scopePins: readonly string[],
  measurements: readonly ParcelSpaceMeasurementInput[],
): Promise<number> {
  const scopePayload = JSON.stringify(
    scopePins.map((pin) => ({ pin, metric: "city_ground_footprint" })),
  );
  const measurementPayload = serializeMeasurements(measurements);
  const [, upsertResultRaw] = await sql.transaction((txn) => [
    txn`
      WITH scope AS (
        SELECT DISTINCT pin, metric
        FROM jsonb_to_recordset(${scopePayload}::jsonb) AS s(
          pin TEXT,
          metric TEXT
        )
      )
      UPDATE parcel_space_measurements AS existing
      SET is_current = FALSE, updated_at = NOW()
      FROM scope
      WHERE existing.pin = scope.pin
        AND existing.metric = scope.metric
        AND existing.is_current
      RETURNING existing.id
    `,
    txn`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${measurementPayload}::jsonb) AS r(
          pin TEXT,
          zip TEXT,
          metric TEXT,
          sqft DOUBLE PRECISION,
          measurement_scope TEXT,
          unit TEXT,
          source_key TEXT,
          source_record_id TEXT,
          source_year INTEGER,
          source_updated_at TIMESTAMPTZ,
          fetched_at TIMESTAMPTZ,
          match_method TEXT,
          verification_status TEXT,
          notes TEXT,
          raw_json JSONB,
          verified_at TIMESTAMPTZ,
          reconfirm_after TIMESTAMPTZ,
          is_active BOOLEAN
        )
      )
      INSERT INTO parcel_space_measurements (
        pin,
        zip,
        metric,
        sqft,
        measurement_scope,
        unit,
        source_key,
        source_record_id,
        source_year,
        source_updated_at,
        fetched_at,
        match_method,
        verification_status,
        notes,
        raw_json,
        verified_at,
        reconfirm_after,
        is_active,
        is_current
      )
      SELECT
        incoming.pin,
        incoming.zip,
        incoming.metric,
        incoming.sqft,
        incoming.measurement_scope,
        incoming.unit,
        incoming.source_key,
        incoming.source_record_id,
        incoming.source_year,
        incoming.source_updated_at,
        incoming.fetched_at,
        incoming.match_method,
        incoming.verification_status,
        incoming.notes,
        incoming.raw_json,
        incoming.verified_at,
        incoming.reconfirm_after,
        incoming.is_active,
        TRUE
      FROM incoming
      ON CONFLICT (pin, metric, source_key, source_record_id)
      DO UPDATE SET
        sqft = EXCLUDED.sqft,
        zip = EXCLUDED.zip,
        measurement_scope = EXCLUDED.measurement_scope,
        unit = EXCLUDED.unit,
        source_year = EXCLUDED.source_year,
        source_updated_at = EXCLUDED.source_updated_at,
        fetched_at = EXCLUDED.fetched_at,
        match_method = EXCLUDED.match_method,
        verification_status = EXCLUDED.verification_status,
        notes = EXCLUDED.notes,
        raw_json = EXCLUDED.raw_json,
        verified_at = EXCLUDED.verified_at,
        reconfirm_after = EXCLUDED.reconfirm_after,
        is_active = EXCLUDED.is_active,
        is_current = TRUE,
        updated_at = NOW()
      RETURNING id
    `,
  ]);
  const rows = upsertResultRaw as Array<{ id: number }>;
  return rows.length;
}

async function writeCityFootprintMeasurements(
  sql: SqlClient,
  scopePins: readonly string[],
  measurements: readonly ParcelSpaceMeasurementInput[],
): Promise<number> {
  const measurementByPin = new Map(measurements.map((row) => [row.pin, row]));
  const batchSize = 500;
  let count = 0;

  for (let index = 0; index < scopePins.length; index += batchSize) {
    const pinBatch = scopePins.slice(index, index + batchSize);
    const measurementBatch = pinBatch
      .map((pin) => measurementByPin.get(pin))
      .filter((row): row is ParcelSpaceMeasurementInput => Boolean(row));
    count += await writeCityFootprintBatch(sql, pinBatch, measurementBatch);
    console.log(`  Wrote ${Math.min(index + batchSize, scopePins.length)}/${scopePins.length} parcels`);
  }
  return count;
}

export async function syncCityBuildingFootprints(
  options: CityFootprintSyncCliOptions,
): Promise<void> {
  if (options.help) {
    printUsage();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const zips =
    options.zips ??
    parseZipList(process.env.ZIPS ?? process.env.ZIP ?? "");
  const sql = neon(databaseUrl);
  const scopedParcels = await loadScopedParcels(sql, zips);
  if (scopedParcels.length === 0) {
    throw new Error(`No parcel PINs found for ZIPs: ${zips.join(", ")}`);
  }

  console.log("=== City Building Footprints parcel-space sync ===");
  console.log(`Mode: ${options.write ? "WRITE" : "DRY RUN"}`);
  console.log(`ZIPs: ${zips.join(", ")}`);
  console.log(`Scoped PINs: ${scopedParcels.length}`);
  console.log("Dataset vintage: current as of August 2015");

  const zipByPin = new Map(scopedParcels.map((row) => [row.pin, row.zip]));
  const parcelFetch = await fetchCookViewerFeaturesForPins(
    scopedParcels.map((row) => row.pin),
    {
      outFields: COOKVIEWER_GEOMETRY_FIELDS,
      returnGeometry: true,
      pageSize: options.cookViewerPageSize,
      pinBatchSize: options.pinBatchSize,
    },
  );
  const normalizedParcels = normalizeParcelPolygons(parcelFetch.features, zipByPin);
  if (normalizedParcels.parcels.length === 0) {
    throw new Error("CookViewer returned no usable parcel polygons");
  }

  const fetchedAt = new Date().toISOString();
  const allMeasurements: ParcelSpaceMeasurementInput[] = [];
  const scopePins: string[] = [];
  const zipDiagnostics: Array<Record<string, unknown>> = [];

  for (const zip of zips) {
    const parcels = normalizedParcels.parcels.filter(
      (parcel) => parcel.properties.zip === zip,
    );
    if (parcels.length === 0) {
      zipDiagnostics.push({ zip, parcelPolygons: 0, skipped: true });
      continue;
    }

    const cityFetch = await fetchCityBuildingsForBounds(
      boundsForParcels(parcels),
      options.cityPageSize,
    );
    const aggregation = aggregateCityFootprintAreaByParcel(
      parcels,
      cityFetch.buildings,
    );
    const buildingById = new Map(
      cityFetch.buildings.map((building) => [
        building.properties.sourceRecordId,
        building,
      ]),
    );

    scopePins.push(...parcels.map((parcel) => parcel.properties.pin));
    for (const row of aggregation.rows) {
      const roundedSqft = Math.round(row.sqft * 100) / 100;
      if (roundedSqft <= 0) continue;
      allMeasurements.push({
        pin: row.pin,
        zip,
        metric: "city_ground_footprint",
        sqft: roundedSqft,
        measurementScope: null,
        unit: "square_feet",
        sourceKey: `chicago_building_footprints_${CITY_BUILDING_FOOTPRINTS_DATASET_ID}`,
        sourceRecordId: stableSourceRecordId(
          `${CITY_BUILDING_FOOTPRINTS_DATASET_ID}-${CITY_BUILDING_FOOTPRINTS_VINTAGE_YEAR}`,
          row.buildingIds,
        ),
        sourceYear: CITY_BUILDING_FOOTPRINTS_VINTAGE_YEAR,
        sourceUpdatedAt: row.sourceUpdatedAt,
        fetchedAt,
        matchMethod: "spatial_intersection",
        verificationStatus: "computed",
        verifiedAt: null,
        reconfirmAfter: null,
        isActive: true,
        notes:
          "Mapped building footprint on parcel, computed as the union of clipped City Building Footprints syp8-uezg polygons. Official dataset vintage: August 2015. This is not gross building area or available space.",
        rawJson: {
          dataset_id: CITY_BUILDING_FOOTPRINTS_DATASET_ID,
          dataset_vintage: "Current as of August 2015",
          parcel_geometry_source: "Cook County current parcel feature service",
          mapped_building_footprint_sqft_unrounded: row.sqft,
          individual_clipped_intersections: row.intersections,
          source_records: row.buildingIds.map(
            (id) => buildingById.get(id)?.properties.rawJson ?? { bldg_id: id },
          ),
        },
      });
    }

    zipDiagnostics.push({
      zip,
      parcelPolygons: parcels.length,
      cityPages: cityFetch.pageCount,
      cityFeatures: cityFetch.buildings.length,
      invalidCityFeatures: cityFetch.invalidCount,
      measurements: aggregation.rows.length,
      ...aggregation.diagnostics,
    });
    console.log(
      `${zip}: ${parcels.length} parcels, ${cityFetch.buildings.length} City polygons, ${aggregation.rows.length} measurements`,
    );
  }

  const summary = {
    cookViewerPages: parcelFetch.pageCount,
    parcelSourceFeatures: parcelFetch.features.length,
    usableParcelPolygons: normalizedParcels.parcels.length,
    invalidParcelFeatures: normalizedParcels.invalidCount,
    duplicateParcelPins: normalizedParcels.duplicateCount,
    scopedGeometryPins: scopePins.length,
    computedMeasurements: allMeasurements.length,
    zipDiagnostics,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!options.write) {
    console.log("DRY RUN complete: no measurements were changed.");
    return;
  }

  const written = await writeCityFootprintMeasurements(sql, scopePins, allMeasurements);
  console.log(
    JSON.stringify(
      {
        scopedGeometryPins: scopePins.length,
        currentMeasurementsUpserted: written,
        metric: "city_ground_footprint",
        availableSpaceWritten: false,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  syncCityBuildingFootprints(parseCityFootprintSyncCliArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
