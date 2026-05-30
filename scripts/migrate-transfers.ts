#!/usr/bin/env npx tsx
/**
 * Database migration for the property_transfers table.
 * Idempotent — safe to run multiple times.
 *
 * Source: Illinois MyDec / PTAX-203 (`it54-y4c6`) — deed/instrument-level
 * detail keyed by declaration/document number. Distinct from the Ownership
 * domain's `parcel_sales` spine (`wvhk-k5uv`).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-transfers.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running transfers migration...\n");

  /* ── property_transfers (deed/instrument detail, keyed by document number) ── */
  console.log("1. Creating property_transfers table...");
  await sql`
    CREATE TABLE IF NOT EXISTS property_transfers (
      transfer_id TEXT PRIMARY KEY,
      pin TEXT,
      recorded_date DATE,
      instrument_date DATE,
      instrument_type TEXT,
      doc_number TEXT,
      consideration_amount BIGINT,
      net_consideration BIGINT,
      seller_name TEXT,
      buyer_name TEXT,
      county TEXT,
      full_address TEXT,
      is_multisale BOOLEAN DEFAULT FALSE,
      num_parcels INTEGER,
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      raw_json JSONB
    )
  `;

  /* ── Indexes ── */
  console.log("2. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_property_transfers_pin ON property_transfers (pin)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_property_transfers_recorded_date ON property_transfers (recorded_date)`;

  console.log("\nTransfers migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
