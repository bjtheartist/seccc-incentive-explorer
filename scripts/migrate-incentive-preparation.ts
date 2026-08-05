#!/usr/bin/env npx tsx
/**
 * Database migration for business profiles and Incentive Preparation Packets.
 * Run this after scripts/migrate-workspace.ts so the referenced workspace
 * tables already exist.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-incentive-preparation.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running incentive preparation migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating business profiles...");
  await sql`
    CREATE TABLE IF NOT EXISTS business_profiles (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      legal_name TEXT NOT NULL,
      dba_name TEXT,
      physical_address TEXT NOT NULL,
      mailing_address TEXT,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      contact_phone TEXT,
      entity_type TEXT,
      formation_date DATE,
      industry TEXT,
      naics_code TEXT,
      employee_count INTEGER CHECK (employee_count IS NULL OR employee_count >= 0),
      ownership_notes TEXT,
      licenses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      field_provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("2. Creating Incentive Preparation Packets...");
  await sql`
    CREATE TABLE IF NOT EXISTS incentive_preparation_packets (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_profile_id TEXT NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES business_projects(id) ON DELETE SET NULL,
      saved_report_id TEXT REFERENCES saved_reports(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'Incentive Preparation Packet',
      program_id TEXT,
      program_name TEXT NOT NULL,
      goal_type TEXT NOT NULL,
      project_address TEXT,
      status TEXT NOT NULL DEFAULT 'needs_information',
      tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      timeline_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      profile_snapshot_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE OR REPLACE FUNCTION prevent_incentive_packet_profile_snapshot_update()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.profile_snapshot_json IS DISTINCT FROM OLD.profile_snapshot_json THEN
        RAISE EXCEPTION 'profile_snapshot_json is immutable for Incentive Preparation Packets';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_incentive_packet_profile_snapshot_immutable'
          AND tgrelid = 'incentive_preparation_packets'::regclass
      ) THEN
        CREATE TRIGGER trg_incentive_packet_profile_snapshot_immutable
        BEFORE UPDATE ON incentive_preparation_packets
        FOR EACH ROW
        EXECUTE FUNCTION prevent_incentive_packet_profile_snapshot_update();
      END IF;
    END
    $$
  `;

  console.log(
    "2b. Relaxing goal_type / program_name for foundation-first packets..."
  );
  // Foundation-first ("Business File") packets are created before a target
  // incentive is chosen, so goal_type and program_name must be nullable. These
  // ALTERs are idempotent: dropping NOT NULL on an already-nullable column is a
  // no-op, so re-running the migration is safe. Existing program packets keep
  // their non-null values untouched.
  await sql`ALTER TABLE incentive_preparation_packets ALTER COLUMN goal_type DROP NOT NULL`;
  await sql`ALTER TABLE incentive_preparation_packets ALTER COLUMN program_name DROP NOT NULL`;

  console.log("3. Creating consent-gated support requests...");
  await sql`
    CREATE TABLE IF NOT EXISTS incentive_support_requests (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      packet_id TEXT NOT NULL REFERENCES incentive_preparation_packets(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL DEFAULT 'introduction'
        CHECK (request_type IN ('introduction', 'materials_review')),
      target_organization TEXT,
      requested_help TEXT NOT NULL,
      consent_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      consented_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Existing deployments predate the explicit request discriminator. These
  // idempotent ALTERs preserve all rows as introductions while allowing an
  // Explorer materials review to exist without pretending it is an external
  // organization handoff.
  await sql`
    ALTER TABLE incentive_support_requests
    ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'introduction'
  `;
  await sql`ALTER TABLE incentive_support_requests ALTER COLUMN target_organization DROP NOT NULL`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'incentive_support_requests_request_type_check'
      ) THEN
        ALTER TABLE incentive_support_requests
        ADD CONSTRAINT incentive_support_requests_request_type_check
        CHECK (request_type IN ('introduction', 'materials_review'));
      END IF;
    END
    $$
  `;

  console.log("3b. Creating editable support-request drafts...");
  await sql`
    CREATE TABLE IF NOT EXISTS incentive_support_request_drafts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      packet_id TEXT NOT NULL REFERENCES incentive_preparation_packets(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL
        CHECK (request_type IN ('introduction', 'materials_review')),
      target_organization TEXT,
      requested_help TEXT NOT NULL,
      suggested_scope_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, packet_id)
    )
  `;

  console.log("4. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id ON business_profiles (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_profiles_updated_at ON business_profiles (updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_user_id ON incentive_preparation_packets (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_profile_id ON incentive_preparation_packets (business_profile_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_project_id ON incentive_preparation_packets (project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_saved_report_id ON incentive_preparation_packets (saved_report_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_status ON incentive_preparation_packets (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_packets_program_id ON incentive_preparation_packets (program_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_support_requests_user_id ON incentive_support_requests (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_support_requests_packet_id ON incentive_support_requests (packet_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_support_requests_status ON incentive_support_requests (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incentive_support_drafts_packet_id ON incentive_support_request_drafts (packet_id)`;

  console.log("\nIncentive preparation migration complete.");
}

main().catch((err) => {
  console.error("Incentive preparation migration failed:", err);
  process.exit(1);
});
