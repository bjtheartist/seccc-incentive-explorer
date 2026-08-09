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
      source TEXT NOT NULL CHECK (source IN ('cols', 'dpd_vacant', 'violations')),
      address TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      property_type TEXT NOT NULL CHECK (property_type IN ('vacant_land', 'vacant_building', 'vacant_storefront')),
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  console.log("3. Ensuring ownership columns...");
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_name TEXT`;
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_mailing_address TEXT`;
  await sql`ALTER TABLE vacant_properties ADD COLUMN IF NOT EXISTS owner_type TEXT DEFAULT 'unknown'`;

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
  console.log("4. Ensuring pin column...");
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
  console.log("5. Creating indexes...");
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
