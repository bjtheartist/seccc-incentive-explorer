#!/usr/bin/env npx tsx
/**
 * Database migration for the Property-Condition domain:
 *   building_permits, building_violations, service_requests_311.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-condition.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running condition migration...\n");

  /* ── Ensure PostGIS ── */
  console.log("1. Ensuring PostGIS extension...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  /* ── building_permits (Chicago Building Permits, keyed by permit_id) ── */
  console.log("2. Creating building_permits table...");
  await sql`
    CREATE TABLE IF NOT EXISTS building_permits (
      permit_id TEXT PRIMARY KEY,
      pin TEXT,
      address TEXT,
      zip TEXT,
      permit_type TEXT,
      work_description TEXT,
      issue_date DATE,
      reported_cost BIGINT,
      is_demolition BOOLEAN DEFAULT FALSE,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── building_violations (Chicago Building Violations, keyed by violation_id) ── */
  console.log("3. Creating building_violations table...");
  await sql`
    CREATE TABLE IF NOT EXISTS building_violations (
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

  /* ── service_requests_311 (Chicago 311 Service Requests, keyed by sr_number) ── */
  console.log("4. Creating service_requests_311 table...");
  await sql`
    CREATE TABLE IF NOT EXISTS service_requests_311 (
      sr_number TEXT PRIMARY KEY,
      sr_type TEXT,
      status TEXT,
      created_date DATE,
      address TEXT,
      zip TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      geom GEOGRAPHY(POINT, 4326),
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── Indexes: GIST on every geom, btree on zip ── */
  console.log("5. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_geom ON building_permits USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_zip ON building_permits (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_violations_geom ON building_violations USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_violations_zip ON building_violations (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_311_geom ON service_requests_311 USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_311_zip ON service_requests_311 (zip)`;

  console.log("\nCondition migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
