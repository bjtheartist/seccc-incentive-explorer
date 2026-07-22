#!/usr/bin/env npx tsx
/**
 * Database migration for the parcel_exemptions table.
 * Idempotent — safe to run multiple times.
 *
 * Source: PTAXSIM — the Cook County Assessor data team's public SQLite artifact
 * (github.com/ccao-data/ptaxsim). One row per 14-digit PIN per tax year; this
 * table mirrors the exemption EAV amounts (homeowner, senior, senior freeze,
 * disabled, veteran, longtime-homeowner) for the latest tax year in the DB.
 * The veteran columns (returning + disabled tiers + WWII) are consolidated into
 * a single exe_vet at ingest time (see lib/ingest/exemptions.ts).
 *
 * These EAVs back the EXEMPTION ANOMALY overlay: an occupancy-premised exemption
 * still attached to a vacant parcel is a RECORD ANOMALY warranting official
 * review — never an assertion of fraud, intent, or wrongdoing.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-exemptions.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running exemptions migration...\n");

  /* ── parcel_exemptions (exemption EAV amounts, keyed by PIN + tax year) ── */
  console.log("1. Creating parcel_exemptions table...");
  await sql`
    CREATE TABLE IF NOT EXISTS parcel_exemptions (
      pin TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      exe_homeowner NUMERIC,
      exe_senior NUMERIC,
      exe_freeze NUMERIC,
      exe_disabled NUMERIC,
      exe_vet NUMERIC,
      exe_longtime NUMERIC,
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (pin, tax_year)
    )
  `;

  /* ── Indexes ── */
  console.log("2. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_exemptions_pin ON parcel_exemptions (pin)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_exemptions_tax_year ON parcel_exemptions (tax_year)`;

  console.log("\nExemptions migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
