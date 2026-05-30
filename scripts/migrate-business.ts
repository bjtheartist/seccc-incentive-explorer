#!/usr/bin/env npx tsx
/**
 * Database migration for the business_licenses table.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-business.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running business_licenses migration...\n");

  /* ── Ensure PostGIS ── */
  console.log("1. Ensuring PostGIS extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  /* ── business_licenses (one row per license period) ──
   * PK is the Socrata `id` (license_number + license_start_date), which is
   * unique per row; license_id repeats across renewal periods.            */
  console.log("2. Creating business_licenses table...");
  await sql`
    CREATE TABLE IF NOT EXISTS business_licenses (
      license_id TEXT PRIMARY KEY,
      account_number TEXT,
      legal_name TEXT,
      dba_name TEXT,
      address TEXT,
      zip TEXT,
      license_code TEXT,
      license_description TEXT,
      application_type TEXT,
      license_status TEXT,
      license_start_date DATE,
      expiration_date DATE,
      date_issued DATE,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── Indexes ── */
  console.log("3. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_business_licenses_geom ON business_licenses USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_licenses_zip ON business_licenses (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_licenses_description ON business_licenses (license_description)`;

  console.log("\nBusiness licenses migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
