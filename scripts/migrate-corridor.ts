#!/usr/bin/env npx tsx
/**
 * Database migration for the Corridor Health domain (corridor_metrics).
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-corridor.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running corridor migration...\n");

  /* ── corridor_metrics (one row per corridor per as_of snapshot) ──
   * corridor_type is 'zip' for v1; corridor_id holds the ZIP code.
   * Each of the six metrics gets its own numeric column for easy querying,
   * with the full breakdown preserved in `details` JSONB.                */
  console.log("1. Creating corridor_metrics table...");
  await sql`
    CREATE TABLE IF NOT EXISTS corridor_metrics (
      id SERIAL PRIMARY KEY,
      corridor_type TEXT NOT NULL DEFAULT 'zip',
      corridor_id TEXT NOT NULL,
      as_of DATE NOT NULL,
      vacancy_rate DOUBLE PRECISION,
      turnover_rate DOUBLE PRECISION,
      ownership_hhi DOUBLE PRECISION,
      local_ownership_share DOUBLE PRECISION,
      permit_count DOUBLE PRECISION,
      incentive_coverage DOUBLE PRECISION,
      health_score DOUBLE PRECISION,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      details JSONB,
      UNIQUE (corridor_type, corridor_id, as_of)
    )
  `;

  /* ── Indexes ── */
  console.log("2. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_corridor_metrics_corridor ON corridor_metrics (corridor_type, corridor_id)`;

  console.log("\nCorridor migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
