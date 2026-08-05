#!/usr/bin/env npx tsx
/**
 * Create the parcel-space measurement ledger.
 *
 * Dry-run is the default. Pass --write to execute the idempotent migration.
 *
 * Usage:
 *   npx tsx scripts/migrate-parcel-space-measurements.ts
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-parcel-space-measurements.ts --write
 */

import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_STEPS = [
  "Create parcel_space_measurements as an independent PIN-keyed ledger",
  "Add optional validated ZIP context without requiring a parcels row",
  "Add verified, expiring largest-contiguous-space semantics for available space",
  "Deactivate unverifiable legacy available-space rows during an upgrade",
  "Constrain metric, positive square footage, match method, and verification status",
  "Create an idempotent source-record uniqueness index",
  "Create a partial unique index allowing one current row per PIN and metric",
  "Create PIN/metric and source lookup indexes",
] as const;

interface MigrationCliOptions {
  write: boolean;
  help: boolean;
}

export function parseMigrationCliArgs(args: readonly string[]): MigrationCliOptions {
  let write = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--write") write = true;
    else if (arg === "--dry-run") write = false;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return { write, help };
}

function printUsage(): void {
  console.log(`Parcel space measurement migration

Usage:
  npx tsx scripts/migrate-parcel-space-measurements.ts [--dry-run]
  DATABASE_URL="postgresql://..." npx tsx scripts/migrate-parcel-space-measurements.ts --write

Options:
  --dry-run  Print the migration plan without changing the database (default)
  --write    Execute the idempotent migration
  --help     Show this help`);
}

export async function migrateParcelSpaceMeasurements(databaseUrl: string): Promise<void> {
  const sql = neon(databaseUrl);

  await sql`
    CREATE TABLE IF NOT EXISTS parcel_space_measurements (
      id BIGSERIAL PRIMARY KEY,
      pin TEXT NOT NULL,
      zip TEXT,
      metric TEXT NOT NULL,
      sqft DOUBLE PRECISION NOT NULL,
      measurement_scope TEXT,
      unit TEXT NOT NULL DEFAULT 'square_feet',
      source_key TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_year INTEGER,
      source_updated_at TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ NOT NULL,
      match_method TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      notes TEXT,
      raw_json JSONB,
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      verified_at TIMESTAMPTZ,
      reconfirm_after TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT parcel_space_measurements_pin_format
        CHECK (pin ~ '^[0-9]{14}$'),
      CONSTRAINT parcel_space_measurements_zip_format
        CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$'),
      CONSTRAINT parcel_space_measurements_metric
        CHECK (metric IN (
          'lot_area',
          'assessor_building_area',
          'city_ground_footprint',
          'available_space'
        )),
      CONSTRAINT parcel_space_measurements_positive_sqft
        CHECK (sqft > 0),
      CONSTRAINT parcel_space_measurements_unit
        CHECK (unit = 'square_feet'),
      CONSTRAINT parcel_space_measurements_available_space_scope
        CHECK (
          (
            metric = 'available_space'
            AND measurement_scope = 'largest_contiguous_usable_interior_space'
          )
          OR (metric <> 'available_space' AND measurement_scope IS NULL)
        ),
      CONSTRAINT parcel_space_measurements_available_space_lifecycle
        CHECK (
          metric <> 'available_space'
          OR NOT is_active
          OR (
            verified_at IS NOT NULL
            AND reconfirm_after IS NOT NULL
            AND reconfirm_after > verified_at
          )
        ),
      CONSTRAINT parcel_space_measurements_source_key_present
        CHECK (BTRIM(source_key) <> ''),
      CONSTRAINT parcel_space_measurements_source_record_present
        CHECK (BTRIM(source_record_id) <> ''),
      CONSTRAINT parcel_space_measurements_source_year
        CHECK (source_year IS NULL OR source_year BETWEEN 1800 AND 3000),
      CONSTRAINT parcel_space_measurements_match_method
        CHECK (match_method IN (
          'exact_pin',
          'spatial_intersection',
          'verified_submission'
        )),
      CONSTRAINT parcel_space_measurements_verification_status
        CHECK (verification_status IN ('published', 'computed', 'verified'))
    )
  `;

  await sql`ALTER TABLE parcel_space_measurements ADD COLUMN IF NOT EXISTS zip TEXT`;
  await sql`
    ALTER TABLE parcel_space_measurements
    ADD COLUMN IF NOT EXISTS measurement_scope TEXT
  `;
  await sql`
    ALTER TABLE parcel_space_measurements
    ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'square_feet'
  `;
  await sql`
    ALTER TABLE parcel_space_measurements
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `;
  await sql`
    ALTER TABLE parcel_space_measurements
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ
  `;
  await sql`
    ALTER TABLE parcel_space_measurements
    ADD COLUMN IF NOT EXISTS reconfirm_after TIMESTAMPTZ
  `;
  await sql`
    UPDATE parcel_space_measurements
    SET unit = 'square_feet'
    WHERE unit IS DISTINCT FROM 'square_feet'
  `;
  await sql`
    UPDATE parcel_space_measurements
    SET is_active = TRUE
    WHERE is_active IS NULL
  `;
  await sql`
    UPDATE parcel_space_measurements
    SET measurement_scope = 'largest_contiguous_usable_interior_space'
    WHERE metric = 'available_space'
  `;
  await sql`
    UPDATE parcel_space_measurements
    SET
      is_active = FALSE,
      is_current = FALSE,
      updated_at = NOW()
    WHERE metric = 'available_space'
      AND (
        verified_at IS NULL
        OR reconfirm_after IS NULL
        OR reconfirm_after <= verified_at
      )
  `;
  await sql`
    UPDATE parcel_space_measurements
    SET measurement_scope = NULL
    WHERE metric <> 'available_space'
      AND measurement_scope IS NOT NULL
  `;
  await sql`ALTER TABLE parcel_space_measurements ALTER COLUMN unit SET DEFAULT 'square_feet'`;
  await sql`ALTER TABLE parcel_space_measurements ALTER COLUMN unit SET NOT NULL`;
  await sql`ALTER TABLE parcel_space_measurements ALTER COLUMN is_active SET DEFAULT TRUE`;
  await sql`ALTER TABLE parcel_space_measurements ALTER COLUMN is_active SET NOT NULL`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'parcel_space_measurements'::regclass
          AND conname = 'parcel_space_measurements_zip_format'
      ) THEN
        ALTER TABLE parcel_space_measurements
        ADD CONSTRAINT parcel_space_measurements_zip_format
        CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'parcel_space_measurements'::regclass
          AND conname = 'parcel_space_measurements_unit'
      ) THEN
        ALTER TABLE parcel_space_measurements
        ADD CONSTRAINT parcel_space_measurements_unit
        CHECK (unit = 'square_feet');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'parcel_space_measurements'::regclass
          AND conname = 'parcel_space_measurements_available_space_scope'
      ) THEN
        ALTER TABLE parcel_space_measurements
        ADD CONSTRAINT parcel_space_measurements_available_space_scope
        CHECK (
          (
            metric = 'available_space'
            AND measurement_scope = 'largest_contiguous_usable_interior_space'
          )
          OR (metric <> 'available_space' AND measurement_scope IS NULL)
        );
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'parcel_space_measurements'::regclass
          AND conname = 'parcel_space_measurements_available_space_lifecycle'
      ) THEN
        ALTER TABLE parcel_space_measurements
        ADD CONSTRAINT parcel_space_measurements_available_space_lifecycle
        CHECK (
          metric <> 'available_space'
          OR NOT is_active
          OR (
            verified_at IS NOT NULL
            AND reconfirm_after IS NOT NULL
            AND reconfirm_after > verified_at
          )
        );
      END IF;
    END
    $$
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_parcel_space_measurements_source_record
    ON parcel_space_measurements (pin, metric, source_key, source_record_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_parcel_space_measurements_current
    ON parcel_space_measurements (pin, metric)
    WHERE is_current
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_parcel_space_measurements_pin_metric
    ON parcel_space_measurements (pin, metric, fetched_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_parcel_space_measurements_source
    ON parcel_space_measurements (source_key, source_year)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_parcel_space_measurements_zip_metric
    ON parcel_space_measurements (zip, metric)
    WHERE zip IS NOT NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_parcel_space_measurements_available_active
    ON parcel_space_measurements (pin, reconfirm_after DESC)
    WHERE metric = 'available_space' AND is_current AND is_active
  `;
  await sql`
    CREATE OR REPLACE VIEW current_available_space_measurements AS
    SELECT
      id,
      pin,
      zip,
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
      created_at,
      updated_at,
      metric,
      is_active
    FROM parcel_space_measurements
    WHERE metric = 'available_space'
      AND measurement_scope = 'largest_contiguous_usable_interior_space'
      AND is_current
      AND is_active
      AND verification_status = 'verified'
      AND verified_at IS NOT NULL
      AND reconfirm_after > NOW()
  `;
}

export async function runMigration(options: MigrationCliOptions): Promise<void> {
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.write) {
    console.log("DRY RUN: no database changes will be made.\n");
    MIGRATION_STEPS.forEach((step, index) => console.log(`${index + 1}. ${step}`));
    console.log("\nRe-run with --write and DATABASE_URL to execute.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required with --write");

  console.log("Applying parcel-space measurement migration...");
  await migrateParcelSpaceMeasurements(databaseUrl);
  console.log("Parcel-space measurement migration complete.");
}

const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runMigration(parseMigrationCliArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
