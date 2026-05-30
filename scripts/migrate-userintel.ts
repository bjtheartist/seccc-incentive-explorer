#!/usr/bin/env npx tsx
/**
 * Database migration for the User intelligence domain (Domain 6).
 *
 * Captures product/user signals: searches, watched areas, exports, and
 * partner corrections. No external data source.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-userintel.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running user-intelligence migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating search_log...");
  await sql`
    CREATE TABLE IF NOT EXISTS search_log (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      query TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      result_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("2. Creating watched_areas...");
  await sql`
    CREATE TABLE IF NOT EXISTS watched_areas (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      area_type TEXT NOT NULL,
      area_id TEXT NOT NULL,
      area_label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, area_type, area_id)
    )
  `;

  console.log("3. Creating export_events...");
  await sql`
    CREATE TABLE IF NOT EXISTS export_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      report_id TEXT,
      report_type TEXT,
      format TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("4. Creating partner_corrections...");
  await sql`
    CREATE TABLE IF NOT EXISTS partner_corrections (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      submitter_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      submitter_email TEXT,
      target_type TEXT,
      target_id TEXT,
      field TEXT,
      current_value TEXT,
      suggested_value TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `;

  console.log("5. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_search_log_created_at ON search_log (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_search_log_user_id ON search_log (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_watched_areas_user_id ON watched_areas (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_export_events_user_id ON export_events (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_export_events_created_at ON export_events (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_corrections_status ON partner_corrections (status)`;

  console.log("\nUser-intelligence migration complete.");
}

main().catch((err) => {
  console.error("User-intelligence migration failed:", err);
  process.exit(1);
});
