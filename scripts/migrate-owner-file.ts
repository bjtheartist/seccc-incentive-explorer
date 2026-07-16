#!/usr/bin/env npx tsx
/**
 * Database migration for the Owner File human layer — the one prod schema
 * addition the "Who Owns It?" ownership workflow needs (see the approved
 * plan at .claude/plans/okay-an-important-touch-jazzy-pebble.md).
 *
 * The static-export doctrine bars bulk re-derivable parcel/ownership data
 * from prod (lib/corridor-owners.ts, scripts/export-corridor-owners.ts);
 * small human-authored tables are the established exception — the same
 * pattern as `business_projects` / `saved_reports` / `watched_areas` in
 * scripts/migrate-workspace.ts. These three tables are that exception for
 * the Owner File verification workflow:
 *
 *   - owner_file_verifications — one row per cluster_key (upsert), the
 *     human-verified record: who verified it, IL SOS entity-lookup fields,
 *     the verification checklist (same ChecklistItem shape as
 *     lib/workspace.ts), and status.
 *   - owner_file_notes — append-only provenance for individual IL-SOS
 *     lookups and other observations (bulk SOS access is prohibited; this is
 *     the guided single-lookup paste-back trail).
 *   - owner_file_outreach_events — append-only Activate/Feed-back spine
 *     (letter generated/downloaded/mailed, outcome logged).
 *
 * cluster_key is NOT a stable primary key across refreshes on its own (an
 * assessor spelling change can silently orphan verification work); every
 * verification row also snapshots pins_snapshot (the durable per-parcel PIN
 * list) and export_generated_at so a stale-snapshot banner is computable.
 *
 * CODE ONLY. Per docs/business-file/00-spec-overview.md §6 (the standing
 * prod-migration approval doctrine): verify on a disposable Neon branch
 * first, then run against prod only with Billy's explicit sign-off. This
 * script must not be executed as part of implementing the feature.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-owner-file.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running Owner File migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating owner_file_verifications table...");
  await sql`
    CREATE TABLE IF NOT EXISTS owner_file_verifications (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      cluster_key TEXT NOT NULL UNIQUE,
      zip TEXT NOT NULL,
      pins_snapshot TEXT[] NOT NULL DEFAULT '{}',
      owner_name_snapshot TEXT,
      owner_mailing_address_snapshot TEXT,
      export_generated_at TIMESTAMPTZ,
      verifier_name TEXT NOT NULL,
      confidence_tier TEXT CHECK (confidence_tier IN ('A', 'B', 'C', 'D')),
      registered_agent_name TEXT,
      registered_agent_address TEXT,
      il_sos_file_number TEXT,
      il_sos_lookup_url TEXT,
      taxpayer_mailing_address_confirmed BOOLEAN,
      local_vs_absentee TEXT,
      checklist_json JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'stale', 'superseded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("2. Creating owner_file_notes table...");
  await sql`
    CREATE TABLE IF NOT EXISTS owner_file_notes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      cluster_key TEXT NOT NULL,
      zip TEXT NOT NULL,
      author_name TEXT NOT NULL,
      note_type TEXT NOT NULL CHECK (note_type IN ('entity_lookup', 'transfer_observation', 'distress_observation', 'general')),
      body TEXT NOT NULL,
      source_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("3. Creating owner_file_outreach_events table...");
  await sql`
    CREATE TABLE IF NOT EXISTS owner_file_outreach_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      cluster_key TEXT NOT NULL,
      zip TEXT NOT NULL,
      verification_id TEXT REFERENCES owner_file_verifications(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('letter_generated', 'letter_downloaded', 'letter_mailed', 'outcome_logged')),
      actor_name TEXT,
      program_ids JSONB NOT NULL DEFAULT '[]',
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('no_response', 'responded', 'meeting_scheduled', 'returned_undeliverable', 'sold', 'other')),
      notes TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("4. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_verifications_cluster_key ON owner_file_verifications (cluster_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_verifications_zip ON owner_file_verifications (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_notes_cluster_key ON owner_file_notes (cluster_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_notes_zip ON owner_file_notes (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_outreach_events_cluster_key ON owner_file_outreach_events (cluster_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_owner_file_outreach_events_zip ON owner_file_outreach_events (zip)`;

  console.log("\nOwner File migration complete.");
}

main().catch((err) => {
  console.error("Owner File migration failed:", err);
  process.exit(1);
});
