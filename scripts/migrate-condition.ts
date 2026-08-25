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

  /* ── Citywide-permits columns (additive; safe on an already-populated table) ──
   *
   * `pins` holds EVERY PIN on the permit, not just the first — Chicago permits
   * routinely list several (" | "-separated upstream). These are 10-digit Cook
   * County PINs; `parcels`/COLS carry the 14-digit form, which is why the match
   * engine compares LEFT(parcel_pin, 10).
   *
   * The four metadata columns are real ydr8-5enu fields, verified against the
   * live column list on 2026-08-04 — not inferred. (The same check confirmed
   * the dataset has NO zip column; `zip` stays only because it and its index
   * already existed, and is always NULL from this source.)
   *
   * lat/lon were already nullable and stay that way: an un-geocoded permit that
   * still carries a PIN or a street address is now KEPT, with geom NULL.
   *
   * RAIL on the pre-existing `reported_cost` column: it holds the APPLICANT'S
   * OWN ESTIMATE from the application form. It is not an award, a commitment,
   * or a spend, and it must never be summed into a capital/investment/awarded
   * total or headline. Now that this table is citywide rather than three ZIPs,
   * any consumer that aggregates it produces a much larger — and equally
   * meaningless — number. See the note in lib/ingest/permits.ts.
   */
  console.log("5. Ensuring citywide building_permits columns...");
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS pins TEXT[]`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS permit_status TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS permit_milestone TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS work_type TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS permit_condition TEXT`;
  // Coordinate enrichment is additive and traceable. A null geocode_source
  // means lat/lon came directly from the City permits source. Backfilled points
  // always carry the run that produced them and can therefore be reverted or
  // superseded without rewriting raw_json.
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS geocode_source TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS geocode_match_type TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS geocode_matched_address TEXT`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ`;
  await sql`ALTER TABLE building_permits ADD COLUMN IF NOT EXISTS geocode_run_id TEXT`;

  /* ── vacant_property_permit_matches ──
   *
   * One row per (vacant parcel, permit) pair, carrying HOW it was matched and
   * HOW MUCH that method is worth. The pair is the primary key so the three
   * match tiers can be inserted strongest-first with ON CONFLICT DO NOTHING and
   * precedence falls out of insert order.
   *
   * `matched_on` records the literal value that matched (the PIN, the
   * normalized address, or the measured distance) so any row on the card can be
   * re-derived and audited later without re-running the whole match.
   *
   * There is no cost column here, and none may be added: permit costs are
   * applicant estimates and must never be aggregated across matches.
   */
  console.log("6. Creating vacant_property_permit_matches table...");
  await sql`
    CREATE TABLE IF NOT EXISTS vacant_property_permit_matches (
      vacant_property_id TEXT NOT NULL,
      permit_id TEXT NOT NULL,
      match_method TEXT NOT NULL CHECK (
        match_method IN ('pin_exact', 'address_normalized', 'spatial_proximity')
      ),
      match_confidence TEXT NOT NULL CHECK (
        match_confidence IN ('high', 'medium', 'low')
      ),
      matched_on TEXT,
      matched_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (vacant_property_id, permit_id)
    )
  `;

  /* ── controlled permit match repair staging ──
   *
   * A complete replacement proximity tier is built here, audited, and only
   * then swapped into the live match table. The unique run/permit index is a
   * database-level proof that one permit cannot fan out across several parcels
   * during a repair, even if the application query later regresses.
   */
  console.log("7. Creating permit match repair stage...");
  await sql`
    CREATE TABLE IF NOT EXISTS permit_match_repair_stage (
      run_id TEXT NOT NULL,
      vacant_property_id TEXT NOT NULL,
      permit_id TEXT NOT NULL,
      matched_on TEXT,
      staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (run_id, vacant_property_id, permit_id)
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_permit_match_repair_stage_run_permit
    ON permit_match_repair_stage (run_id, permit_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_permit_match_repair_stage_staged_at
    ON permit_match_repair_stage (staged_at)
  `;

  /* ── permit geocode run ledger ──
   *
   * One run describes the frozen backlog; one result row explains the outcome
   * for every permit in that backlog, including no-match and review-required
   * cases. These tables make coverage, provider behavior, and every applied
   * coordinate independently auditable.
   */
  console.log("8. Creating permit geocode audit ledger...");
  await sql`
    CREATE TABLE IF NOT EXISTS permit_geocode_runs (
      run_id TEXT PRIMARY KEY,
      strategy_version TEXT NOT NULL,
      census_benchmark TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      baseline_missing INTEGER NOT NULL CHECK (baseline_missing >= 0),
      unique_addresses INTEGER NOT NULL CHECK (unique_addresses >= 0),
      source_snapshot_max_fetched_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      summary JSONB
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS permit_geocode_results (
      run_id TEXT NOT NULL REFERENCES permit_geocode_runs(run_id) ON DELETE CASCADE,
      permit_id TEXT NOT NULL,
      input_address TEXT NOT NULL,
      address_key TEXT NOT NULL,
      resolution_source TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('accepted', 'unmatched', 'review_required', 'provider_error')
      ),
      match_type TEXT,
      matched_address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      max_source_spread_m DOUBLE PRECISION,
      provider_response JSONB,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_at TIMESTAMPTZ,
      PRIMARY KEY (run_id, permit_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_permit_geocode_results_run_status
    ON permit_geocode_results (run_id, status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_permit_geocode_results_permit
    ON permit_geocode_results (permit_id, attempted_at DESC)
  `;

  /* ── permit_sync_state ──
   *
   * Durable cursor and lease for the bounded daily permits refresh. This is
   * intentionally separate from the full citywide backfill: the cron only
   * asks Socrata for rows whose system `:updated_at` value changed since this
   * cursor, and refuses source-wide surges.
   */
  console.log("9. Creating permit_sync_state table...");
  await sql`
    CREATE TABLE IF NOT EXISTS permit_sync_state (
      source_key TEXT PRIMARY KEY,
      cursor_updated_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      rows_changed INTEGER NOT NULL DEFAULT 0,
      rows_fetched INTEGER NOT NULL DEFAULT 0,
      rows_written INTEGER NOT NULL DEFAULT 0,
      rows_removed INTEGER NOT NULL DEFAULT 0,
      lease_until TIMESTAMPTZ,
      last_error TEXT
    )
  `;

  /* ── Indexes: GIST on every geom, btree on zip ── */
  console.log("10. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_geom ON building_permits USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_zip ON building_permits (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_violations_geom ON building_violations USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_violations_zip ON building_violations (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_311_geom ON service_requests_311 USING GIST (geom)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_service_requests_311_zip ON service_requests_311 (zip)`;

  // Match-engine support. The GIN index carries the PIN tier (`pins && ARRAY[...]`),
  // the expression index carries the normalized-address tier, and the existing
  // GIST geom index carries the proximity tier.
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_pins ON building_permits USING GIN (pins)`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_building_permits_norm_address
    ON building_permits (regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g'))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_building_permits_issue_date ON building_permits (issue_date DESC)`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vp_permit_matches_property
    ON vacant_property_permit_matches (vacant_property_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vp_permit_matches_permit
    ON vacant_property_permit_matches (permit_id)
  `;

  console.log("\nCondition migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
