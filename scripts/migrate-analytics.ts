#!/usr/bin/env npx tsx
/**
 * Database migration for first-party product analytics events.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-analytics.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running analytics migration...\n");

  await sql`
    CREATE TABLE IF NOT EXISTS report_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      report_type TEXT,
      source TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_event_type ON report_events (event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_created_at ON report_events (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_report_type ON report_events (report_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_user_id ON report_events (user_id)`;

  console.log("Analytics migration complete.");
}

main().catch((err) => {
  console.error("Analytics migration failed:", err);
  process.exit(1);
});
