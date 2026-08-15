#!/usr/bin/env npx tsx
/**
 * Database migration for vacant_properties table.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-vacant.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running vacant_properties migration...\n");

  /* ── Ensure PostGIS ── */
  console.log("1. Ensuring PostGIS extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  /* ── Table ── */
  console.log("2. Creating vacant_properties table...");
  await sql`
    CREATE TABLE IF NOT EXISTS vacant_properties (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('cols', 'dpd_vacant', '311_clean_lot', 'violations')),
      address TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      property_type TEXT NOT NULL CHECK (property_type IN ('vacant_land', 'reported_vacant_lot', 'vacant_building', 'vacant_storefront')),
      ward TEXT,
      community_area TEXT,
      zoning_class TEXT,
      square_feet DOUBLE PRECISION,
      status TEXT,
      owner_name TEXT,
      owner_mailing_address TEXT,
      owner_type TEXT DEFAULT 'unknown',
      zone_matches JSONB DEFAULT '[]',
      incentive_count INTEGER DEFAULT 0,
      geom GEOGRAPHY(POINT, 4326),
      source_record_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  console.log("3. Ensuring ownership columns...");
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_name TEXT`;
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_mailing_address TEXT`;
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_type TEXT DEFAULT 'unknown'`;

  /* The public-record date belongs to the source row. It is deliberately
   * nullable: a sync timestamp is not a defensible substitute for an unknown
   * report date. */
  console.log("4. Ensuring source evidence columns and source/type vocabulary...");
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS source_record_date TIMESTAMPTZ`;
  await sql`ALTER TABLE vacant_properties DROP CONSTRAINT IF EXISTS vacant_properties_source_check`;
  await sql`
    ALTER TABLE vacant_properties
    ADD CONSTRAINT vacant_properties_source_check
    CHECK (source IN ('cols', 'dpd_vacant', '311_clean_lot', 'violations'))
  `;
  await sql`ALTER TABLE vacant_properties DROP CONSTRAINT IF EXISTS vacant_properties_property_type_check`;
  await sql`
    ALTER TABLE vacant_properties
    ADD CONSTRAINT vacant_properties_property_type_check
    CHECK (property_type IN ('vacant_land', 'reported_vacant_lot', 'vacant_building', 'vacant_storefront'))
  `;

  // Recover only exact 311 source dates already present in the canonical 311
  // table. Rows without an exact source match stay unknown; updated_at is never
  // used as a report date. Check catalog state explicitly so an unrelated SQL
  // error can never be mistaken for an optional-table absence.
  const [serviceRequestsRelation] = await sql`
    SELECT to_regclass('public.service_requests_311')::text AS relation_name
  `;
  const sourceDatesBackfilled = serviceRequestsRelation?.relation_name
    ? await sql`
        WITH source_dates AS (
          SELECT sr_number, created_date, status
          FROM service_requests_311
          WHERE created_date IS NOT NULL
        )
        UPDATE vacant_properties vp
        SET source_record_date = source_dates.created_date,
            status = COALESCE(source_dates.status, vp.status)
        FROM source_dates
        WHERE vp.source IN ('dpd_vacant', '311_clean_lot')
          AND vp.source_record_date IS NULL
          AND regexp_replace(vp.id, '^311-(clean-lot-)?', '') = source_dates.sr_number
        RETURNING vp.id
      `
    : [];
  console.log(`  Backfilled ${sourceDatesBackfilled.length} exact 311 source dates`);

  /* A complete 311 pull is written here first, in bounded batches. The live
   * table is changed only by one final data-modifying CTE, which atomically
   * upserts the new snapshot, retires rows no longer present, and clears this
   * staging run. Partial/failed pulls therefore cannot prune live membership. */
  console.log("5. Creating atomic source-snapshot staging tables...");
  await sql`
    CREATE TABLE IF NOT EXISTS vacant_311_sync_stage (
      run_id TEXT NOT NULL,
      id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('dpd_vacant', '311_clean_lot')),
      address TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      property_type TEXT NOT NULL CHECK (property_type IN ('vacant_building', 'reported_vacant_lot')),
      ward TEXT,
      community_area TEXT,
      zoning_class TEXT,
      square_feet DOUBLE PRECISION,
      status TEXT NOT NULL,
      source_record_date TIMESTAMPTZ,
      staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (run_id, id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS vacant_cols_sync_stage (
      run_id TEXT NOT NULL,
      id TEXT NOT NULL,
      pin TEXT,
      address TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      ward TEXT,
      community_area TEXT,
      zoning_class TEXT,
      square_feet DOUBLE PRECISION,
      owner_name TEXT NOT NULL,
      owner_mailing_address TEXT,
      owner_type TEXT NOT NULL,
      staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (run_id, id)
    )
  `;

  /* ── PIN ──
   *
   * The 14-digit, digits-only Cook County PIN, matching the `parcels.pin`
   * convention. It previously existed only INSIDE `id` (COLS rows are keyed
   * `cols-16-11-105-004-0000`), so every PIN join had to re-parse the primary
   * key. The permit match engine needs it as a first-class column, so it is
   * materialized here and backfilled from the id for rows written before this
   * migration. 311 rows carry no PIN and stay NULL — honestly unmatchable by
   * the PIN tier rather than guessed at.
   */
  console.log("6. Ensuring pin column...");
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS pin TEXT`;
  const backfilled = await sql`
    UPDATE vacant_properties
    SET pin = regexp_replace(substring(id from 6), '[^0-9]', '', 'g')
    WHERE pin IS NULL
      AND id LIKE 'cols-%'
      AND length(regexp_replace(substring(id from 6), '[^0-9]', '', 'g')) = 14
    RETURNING id
  `;
  console.log(`  Backfilled pin on ${backfilled.length} COLS rows`);

  /* ── Indexes ── */
  console.log("7. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_311_stage_staged_at ON vacant_311_sync_stage (staged_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_cols_stage_staged_at ON vacant_cols_sync_stage (staged_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_pin ON vacant_properties (pin)`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vacant_pin10
    ON vacant_properties (left(pin, 10))
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vacant_norm_address
    ON vacant_properties (regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g'))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_geom ON vacant_properties USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_source ON vacant_properties (source)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_source_record_date ON vacant_properties (source_record_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_type ON vacant_properties (property_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_owner_type ON vacant_properties (owner_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_incentive_count ON vacant_properties (incentive_count DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_owner_type ON vacant_properties (owner_type)`;

  console.log("\nVacant properties migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
