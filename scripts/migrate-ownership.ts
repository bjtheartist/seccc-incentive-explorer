#!/usr/bin/env npx tsx
/**
 * Database migration for the ownership domain (parcel_sales).
 * Valuation history reuses the existing parcel_valuations table.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-ownership.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running ownership migration...\n");

  /* ── parcel_sales (append-only sale history) ── */
  console.log("1. Creating parcel_sales table...");
  await sql`
    CREATE TABLE IF NOT EXISTS parcel_sales (
      id SERIAL PRIMARY KEY,
      pin TEXT,
      sale_date DATE,
      sale_price BIGINT,
      deed_type TEXT,
      seller TEXT,
      buyer TEXT,
      document_number TEXT,
      source TEXT,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (pin, sale_date, document_number)
    )
  `;

  /* ── Indexes ── */
  console.log("2. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_parcel_sales_pin ON parcel_sales (pin)`;

  console.log("\nOwnership migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
