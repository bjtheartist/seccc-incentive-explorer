#!/usr/bin/env npx tsx
/**
 * Database migration for the tif_financials table.
 * Idempotent — safe to run multiple times.
 *
 * Sources: qm7s-3ctt (TIF Annual Report Analysis) + fpsv-qjg3 (TIF
 * Projections/Expirations). One row per TIF district keyed on tif_number
 * (canonical normalized form e.g. "T-087").
 *
 * DO NOT run against a production DATABASE_URL without explicit approval.
 * Use a disposable Neon branch for testing — see SECCC DB verification notes.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-tif-financials.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running tif_financials migration...\n");

  /* ── tif_financials (one row per district; upserted on every sync) ──
   *
   * tif_number  — canonical normalized key (T-NNN), PK.
   * tif_name    — human district name from fpsv-qjg3 or qm7s-3ctt.
   *
   * latest_* fields come from the most-recent row in qm7s-3ctt (sorted by
   * report_year DESC). Dollar amounts stored as BIGINT; nulls preserved where
   * the upstream record has no entry for that year.
   *
   * expires_within_24_months — boolean flag set at sync time. Will drift over
   * time; re-sync to refresh. Downstream consumers should re-evaluate against
   * the current date using expiration_date directly.
   *
   * projected_balances — JSONB map {"2026": 5000000, "2027": 3200000, ...}
   * extracted from fpsv-qjg3 year columns. Null when fpsv-qjg3 has no row for
   * the district or no year columns are recognized.                           */
  console.log("1. Creating tif_financials table...");
  await sql`
    CREATE TABLE IF NOT EXISTS tif_financials (
      tif_number                              TEXT PRIMARY KEY,
      tif_name                                TEXT,
      latest_report_year                      INTEGER,
      latest_fund_balance                     BIGINT,
      latest_tax_allocation_fund_balance      BIGINT,
      latest_property_tax_increment           BIGINT,
      latest_total_expenditure                BIGINT,
      latest_surplus_deficit                  BIGINT,
      latest_amount_designated_project_costs  BIGINT,
      expiration_date                         DATE,
      expiration_year                         INTEGER,
      expires_within_24_months                BOOLEAN NOT NULL DEFAULT FALSE,
      projected_balances                      JSONB,
      source                                  TEXT,
      fetched_at                              TIMESTAMPTZ DEFAULT NOW(),
      raw_json                                JSONB
    )
  `;

  /* ── Indexes ── */
  console.log("2. Creating indexes...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tif_financials_expiration_year
      ON tif_financials (expiration_year)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tif_financials_expires_soon
      ON tif_financials (expires_within_24_months)
      WHERE expires_within_24_months = TRUE
  `;

  console.log("\ntif_financials migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
