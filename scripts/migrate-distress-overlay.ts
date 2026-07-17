#!/usr/bin/env npx tsx
/**
 * Database migration for the Phase-2 Distress Overlay domain:
 *   vacant_building_violations, scavenger_sale_entries, annual_tax_sale_entries.
 * Idempotent — safe to run multiple times.
 *
 * NOT chained into `db:migrate` — same precedent as db:migrate:concierge /
 * db:migrate:owner-file. Run explicitly on a refresh branch that already has
 * parcels migrated (scripts/sync-distress-overlay.ts reads DISTINCT
 * parcels.pin to scope the PIN-keyed tax-sale adapters):
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-distress-overlay.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running distress-overlay migration...\n");

  /* ── Ensure PostGIS ── */
  console.log("1. Ensuring PostGIS extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  /* ── vacant_building_violations (Chicago Vacant/Abandoned Building
   * Violations, u7si-yh3t, keyed by `id`). Separate table from
   * building_violations (22u3-xenr) — different upstream schema/PK. ── */
  console.log("2. Creating vacant_building_violations table...");
  await sql`
    CREATE TABLE IF NOT EXISTS vacant_building_violations (
      violation_id TEXT PRIMARY KEY,
      address TEXT,
      zip TEXT,
      violation_code TEXT,
      violation_description TEXT,
      violation_status TEXT,
      violation_date DATE,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── scavenger_sale_entries (Cook County Treasurer Scavenger Tax Sale,
   * ydgz-vkrp). PIN-keyed, no ZIP/address column upstream. ── */
  console.log("3. Creating scavenger_sale_entries table...");
  await sql`
    CREATE TABLE IF NOT EXISTS scavenger_sale_entries (
      entry_id TEXT PRIMARY KEY,
      pin TEXT NOT NULL,
      tax_sale_year INTEGER,
      from_year INTEGER,
      to_year INTEGER,
      total_amount_paid NUMERIC,
      sold_at_sale BOOLEAN,
      buyer_name TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── annual_tax_sale_entries (Cook County Treasurer Annual Tax Sale,
   * 55ju-2fs9). PIN-keyed, no ZIP/address column upstream. ── */
  console.log("4. Creating annual_tax_sale_entries table...");
  await sql`
    CREATE TABLE IF NOT EXISTS annual_tax_sale_entries (
      entry_id TEXT PRIMARY KEY,
      pin TEXT NOT NULL,
      tax_sale_year INTEGER,
      classification TEXT,
      township_name TEXT,
      sold_at_sale BOOLEAN,
      tax_amount_offered NUMERIC,
      penalty_amount_offered NUMERIC,
      total_tax_and_penalty_amount_offered NUMERIC,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── Indexes: GIST on every geom, btree on the join keys ── */
  console.log("5. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_building_violations_geom ON vacant_building_violations USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_vacant_building_violations_zip ON vacant_building_violations (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scavenger_sale_entries_pin ON scavenger_sale_entries (pin)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scavenger_sale_entries_geom ON scavenger_sale_entries USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_annual_tax_sale_entries_pin ON annual_tax_sale_entries (pin)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_annual_tax_sale_entries_geom ON annual_tax_sale_entries USING GIST (geom)`;

  console.log("\nDistress-overlay migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
