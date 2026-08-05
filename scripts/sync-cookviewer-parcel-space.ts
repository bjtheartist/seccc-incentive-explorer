#!/usr/bin/env npx tsx
/**
 * Enrich existing parcel rows from Cook County's current CookViewer parcel
 * feature service and Assessor Commercial Valuation Data (`csik-bsws`).
 *
 * Reads and normalization run in dry-run mode. Database mutations require
 * --write. Zero and missing source values remain unknown and are not stored as
 * measurements.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-cookviewer-parcel-space.ts --zips=60617
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-cookviewer-parcel-space.ts --zips=60617,60619 --write
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { socrataHeaders } from "../lib/socrata";
import {
  commercialBuildingMeasurementRow,
  cookViewerMeasurementRows,
  fetchCookViewerFeaturesForPins,
  normalizeCommercialBuildingAreaRecords,
  normalizeCookViewerParcelRecord,
  normalizePin14,
  parseZipList,
  positiveCliInteger,
  type CookViewerParcelRecord,
  type ParcelSpaceMeasurementInput,
} from "./parcel-space-enrichment";

const COMMERCIAL_VALUATION_URL =
  "https://datacatalog.cookcountyil.gov/resource/csik-bsws.json";
const COMMERCIAL_OUT_FIELDS = [
  "keypin",
  "pins",
  "year",
  "sheet",
  "model",
  "class_es",
  "address",
  "bldgsf",
  "aprx_comm_sf",
  "landsf",
  "netrentablesf",
  "subclass2",
  "tot_units",
] as const;

const COOKVIEWER_OUT_FIELDS = [
  "PIN14",
  "LANDSF",
  "BLDGSQFT",
  "BLDGAGE",
  "BCLASS",
  "TAXYR",
  "last_edited_date",
  "GlobalID",
] as const;

interface CookViewerSyncCliOptions {
  write: boolean;
  help: boolean;
  zips: string[] | null;
  pageSize: number;
  pinBatchSize: number;
}

interface ScopedParcel {
  pin: string;
  zip: string;
}

type SqlClient = NeonQueryFunction<false, false>;

async function fetchCommercialValuationRows(): Promise<{
  rows: Record<string, unknown>[];
  pageCount: number;
}> {
  const pageSize = 50_000;
  const rows: Record<string, unknown>[] = [];
  let pageCount = 0;

  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      "$select": COMMERCIAL_OUT_FIELDS.join(","),
      "$order": "year,keypin,sheet",
      "$limit": String(pageSize),
      "$offset": String(offset),
    });
    let page: Record<string, unknown>[] | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`${COMMERCIAL_VALUATION_URL}?${params}`, {
          headers: socrataHeaders(),
          signal: AbortSignal.timeout(120_000),
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Commercial valuation fetch HTTP ${response.status}`);
        }
        page = (await response.json()) as Record<string, unknown>[];
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
        }
      }
    }

    if (page === null) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Commercial valuation fetch failed");
    }
    pageCount++;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { rows, pageCount };
}

function nextValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCookViewerSyncCliArgs(
  args: readonly string[],
): CookViewerSyncCliOptions {
  let write = false;
  let sawWrite = false;
  let sawDryRun = false;
  let help = false;
  let zips: string[] | null = null;
  let pageSize = 1_000;
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
    } else if (arg === "--page-size") {
      pageSize = positiveCliInteger(nextValue(args, index, arg), arg, 2_000);
      index++;
    } else if (arg.startsWith("--page-size=")) {
      pageSize = positiveCliInteger(
        arg.slice("--page-size=".length),
        "--page-size",
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
  return { write, help, zips, pageSize, pinBatchSize };
}

function printUsage(): void {
  console.log(`CookViewer parcel-space enrichment

Usage:
  DATABASE_URL="postgresql://..." npx tsx scripts/sync-cookviewer-parcel-space.ts --zips=60617[,60619]
  DATABASE_URL="postgresql://..." npx tsx scripts/sync-cookviewer-parcel-space.ts --zips=60617 --write

Options:
  --zips             Required target ZIPs (or set ZIPS/ZIP)
  --page-size        ArcGIS page size, max 2000 (default: 1000)
  --pin-batch-size   Exact-PIN query batch size, max 500 (default: 200)
  --dry-run          Read and normalize without database writes (default)
  --write            Upsert measurements and legacy parcel fields
  --help             Show this help`);
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

async function writeCookViewerBatch(
  sql: SqlClient,
  records: readonly CookViewerParcelRecord[],
  zipByPin: ReadonlyMap<string, string>,
  measurementRows: readonly ParcelSpaceMeasurementInput[],
): Promise<{ measurements: number; parcels: number }> {
  const measurements = measurementRows.map((row) => ({
    ...row,
    zip: zipByPin.get(row.pin) ?? null,
  }));
  const scope = records.flatMap((record) => [
    { pin: record.pin, metric: "lot_area" },
    { pin: record.pin, metric: "assessor_building_area" },
  ]);
  const measurementPayload = serializeMeasurements(measurements);
  const scopePayload = JSON.stringify(scope);
  const parcelPayload = JSON.stringify(
    records.map((record) => ({
      pin: record.pin,
      land_sqft: record.landSqft,
      bldg_sqft: record.buildingSqft,
      bldg_age: record.buildingAge,
    })),
  );

  const [, measurementResultRaw, parcelResultRaw] = await sql.transaction((txn) => [
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
    txn`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${parcelPayload}::jsonb) AS r(
          pin TEXT,
          land_sqft DOUBLE PRECISION,
          bldg_sqft DOUBLE PRECISION,
          bldg_age INTEGER
        )
      ),
      updated AS (
        UPDATE parcels
        SET
          land_sqft = incoming.land_sqft,
          bldg_sqft = incoming.bldg_sqft,
          bldg_age = incoming.bldg_age
        FROM incoming
        WHERE parcels.pin = incoming.pin
        RETURNING parcels.pin
      )
      SELECT COUNT(*)::int AS count FROM updated
    `,
  ]);

  const measurementResult = measurementResultRaw as Array<{ id: number }>;
  const parcelResult = parcelResultRaw as Array<{ count: number }>;
  return {
    measurements: measurementResult.length,
    parcels: Number(parcelResult[0]?.count ?? 0),
  };
}

async function writeCookViewerRecords(
  sql: SqlClient,
  records: readonly CookViewerParcelRecord[],
  zipByPin: ReadonlyMap<string, string>,
  measurements: readonly ParcelSpaceMeasurementInput[],
): Promise<{ measurements: number; parcels: number }> {
  const batchSize = 500;
  let measurementCount = 0;
  let parcelCount = 0;
  const measurementsByPin = new Map<string, ParcelSpaceMeasurementInput[]>();
  for (const row of measurements) {
    const existing = measurementsByPin.get(row.pin);
    if (existing) existing.push(row);
    else measurementsByPin.set(row.pin, [row]);
  }

  for (let index = 0; index < records.length; index += batchSize) {
    const recordBatch = records.slice(index, index + batchSize);
    const result = await writeCookViewerBatch(
      sql,
      recordBatch,
      zipByPin,
      recordBatch.flatMap((record) => measurementsByPin.get(record.pin) ?? []),
    );
    measurementCount += result.measurements;
    parcelCount += result.parcels;
    console.log(
      `  Wrote ${Math.min(index + batchSize, records.length)}/${records.length} source rows`,
    );
  }

  return { measurements: measurementCount, parcels: parcelCount };
}

export async function syncCookViewerParcelSpace(
  options: CookViewerSyncCliOptions,
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

  const fetchedAt = new Date().toISOString();
  console.log("=== Cook County parcel-space sync ===");
  console.log(`Mode: ${options.write ? "WRITE" : "DRY RUN"}`);
  console.log(`ZIPs: ${zips.join(", ")}`);
  console.log(`Scoped PINs: ${scopedParcels.length}`);

  const fetched = await fetchCookViewerFeaturesForPins(
    scopedParcels.map((row) => row.pin),
    {
      outFields: COOKVIEWER_OUT_FIELDS,
      returnGeometry: false,
      pageSize: options.pageSize,
      pinBatchSize: options.pinBatchSize,
    },
  );

  const scopedPins = new Set(scopedParcels.map((row) => row.pin));
  const zipByPin = new Map(scopedParcels.map((row) => [row.pin, row.zip]));
  const normalized = new Map<string, CookViewerParcelRecord>();
  let invalidPinCount = 0;
  let duplicatePinCount = 0;

  for (const feature of fetched.features) {
    const record = normalizeCookViewerParcelRecord(feature.properties ?? {}, fetchedAt);
    if (!record || !scopedPins.has(record.pin)) {
      invalidPinCount++;
      continue;
    }
    if (normalized.has(record.pin)) duplicatePinCount++;
    const existing = normalized.get(record.pin);
    if (
      !existing ||
      (record.sourceUpdatedAt ?? "") >= (existing.sourceUpdatedAt ?? "")
    ) {
      normalized.set(record.pin, record);
    }
  }

  const records = [...normalized.values()].sort((left, right) =>
    left.pin.localeCompare(right.pin),
  );
  const currentPins = new Set(records.map((record) => record.pin));

  const commercialFetch = await fetchCommercialValuationRows();
  const commercial = normalizeCommercialBuildingAreaRecords(
    commercialFetch.rows,
    fetchedAt,
  );
  const commercialByPin = new Map(
    commercial.records
      .filter((record) => currentPins.has(record.pin))
      .map((record) => [record.pin, record]),
  );
  const commercialAuthorityPins = new Set(
    commercial.observedPins.filter((pin) => currentPins.has(pin)),
  );
  const commercialAmbiguousPins = new Set(
    commercial.ambiguousPins.filter((pin) => currentPins.has(pin)),
  );
  const commercialUnresolvedPins = new Set(
    commercial.unresolvedPins.filter((pin) => currentPins.has(pin)),
  );

  const currentMeasurements = records
    .flatMap(cookViewerMeasurementRows)
    .filter(
      (row) =>
        row.metric !== "assessor_building_area" ||
        !commercialAuthorityPins.has(row.pin),
    );
  const commercialMeasurements = [...commercialByPin.values()].map(
    commercialBuildingMeasurementRow,
  );
  const measurements = [...currentMeasurements, ...commercialMeasurements];
  const finalRecords = records.map((record) => {
    if (!commercialAuthorityPins.has(record.pin)) return record;
    return {
      ...record,
      buildingSqft: commercialByPin.get(record.pin)?.buildingSqft ?? null,
    };
  });
  const missingPins = scopedParcels.length - records.length;
  const summary = {
    arcGisPages: fetched.pageCount,
    sourceFeatures: fetched.features.length,
    normalizedRecords: records.length,
    missingPins,
    invalidOrOutOfScopePins: invalidPinCount,
    duplicatePins: duplicatePinCount,
    commercialSourcePages: commercialFetch.pageCount,
    commercialSourceRows: commercialFetch.rows.length,
    commercialObservedScopedPins: commercialAuthorityPins.size,
    commercialBuildingAreaMeasurements: commercialMeasurements.length,
    commercialAmbiguousScopedPins: commercialAmbiguousPins.size,
    commercialUnresolvedScopedPins: commercialUnresolvedPins.size,
    commercialIdenticalRowsDeduplicatedGlobal:
      commercial.identicalRowsDeduplicated,
    commercialInvalidPinRows: commercial.invalidPinRows,
    commercialInvalidYearRows: commercial.invalidYearRows,
    lotAreaMeasurements: measurements.filter((row) => row.metric === "lot_area").length,
    assessorBuildingAreaMeasurements: measurements.filter(
      (row) => row.metric === "assessor_building_area",
    ).length,
    unknownLandSqft: records.filter((row) => row.landSqft === null).length,
    unknownBuildingSqft: finalRecords.filter((row) => row.buildingSqft === null).length,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!options.write) {
    console.log("DRY RUN complete: no measurements or parcel rows were changed.");
    return;
  }

  const written = await writeCookViewerRecords(
    sql,
    finalRecords,
    zipByPin,
    measurements,
  );
  console.log(
    JSON.stringify(
      {
        ...summary,
        currentMeasurementsUpserted: written.measurements,
        legacyParcelsUpdated: written.parcels,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  syncCookViewerParcelSpace(parseCookViewerSyncCliArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
