#!/usr/bin/env npx tsx
/**
 * Database migration for parcels + parcel_valuations tables.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-parcels.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running parcels migration...\n");

  /* ── Ensure PostGIS ── */
  console.log("1. Ensuring PostGIS extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  /* ── parcels (current snapshot, keyed by PIN) ── */
  console.log("2. Creating parcels table...");
  await sql`
    CREATE TABLE IF NOT EXISTS parcels (
      pin TEXT PRIMARY KEY,
      address TEXT,
      zip TEXT,
      class_code TEXT,
      class_description TEXT,
      tax_code TEXT,
      township TEXT,
      land_sqft DOUBLE PRECISION,
      bldg_sqft DOUBLE PRECISION,
      bldg_age INTEGER,
      land_value BIGINT,
      bldg_value BIGINT,
      total_value BIGINT,
      parcel_type INTEGER,
      is_commercial BOOLEAN DEFAULT FALSE,
      is_industrial BOOLEAN DEFAULT FALSE,
      is_vacant BOOLEAN DEFAULT FALSE,
      owner_name TEXT,
      owner_mailing_address TEXT,
      owner_type TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  await sql`ALTER TABLE parcels ADD COLUMN IF NOT EXISTS zip TEXT`;

  /* ── parcel_valuations (append-only assessment history) ── */
  console.log("3. Creating parcel_valuations table...");
  await sql`
    CREATE TABLE IF NOT EXISTS parcel_valuations (
      id SERIAL PRIMARY KEY,
      pin TEXT,
      tax_year TEXT,
      assessed_land BIGINT,
      assessed_building BIGINT,
      assessed_total BIGINT,
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (pin, tax_year)
    )
  `;

  /* ── Indexes ── */
  console.log("4. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcels_zip ON parcels (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_valuations_pin ON parcel_valuations (pin)`;

  console.log("\nParcels migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
