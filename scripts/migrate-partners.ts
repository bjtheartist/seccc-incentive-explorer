#!/usr/bin/env npx tsx
/**
 * Database migration for capital partner registry and referral tables.
 * Idempotent — safe to run multiple times.
 *
 * Amount bounds on partner_products are internal routing data only and
 * must never be serialized into user-facing responses.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-partners.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running capital partners migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating partners table...");
  await sql`
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      partner_type TEXT NOT NULL CHECK (partner_type IN ('cdfi', 'mission_lender', 'community_bank', 'public_program')),
      website TEXT,
      contact_email TEXT,
      phone TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified', 'stale')),
      source_url TEXT,
      source_date DATE,
      last_verified_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("2. Creating partner_service_areas table...");
  await sql`
    CREATE TABLE IF NOT EXISTS partner_service_areas (
      id BIGSERIAL PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('citywide', 'community_area', 'zip', 'ward')),
      area_value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (partner_id, scope, area_value)
    )
  `;

  console.log("3. Creating partner_products table...");
  await sql`
    CREATE TABLE IF NOT EXISTS partner_products (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      product_type TEXT NOT NULL,
      product_name TEXT,
      project_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      industries JSONB NOT NULL DEFAULT '[]'::jsonb,
      min_amount_cents BIGINT,
      max_amount_cents BIGINT,
      verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified', 'unverified', 'stale')),
      source_url TEXT,
      source_date DATE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("4. Creating referrals table...");
  await sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      report_id TEXT,
      user_id TEXT,
      partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES partner_products(id) ON DELETE SET NULL,
      role TEXT NOT NULL CHECK (role IN ('primary', 'alternate')),
      reason TEXT NOT NULL,
      provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      request_json JSONB,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'sent', 'accepted', 'declined', 'expired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("5. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_partners_partner_type ON partners (partner_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partners_active ON partners (active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_service_areas_partner_id ON partner_service_areas (partner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_service_areas_scope_value ON partner_service_areas (scope, area_value)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_products_partner_id ON partner_products (partner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_partner_products_product_type ON partner_products (product_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_partner_id ON referrals (partner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_report_id ON referrals (report_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals (created_at DESC)`;

  console.log("\nCapital partners migration complete.");
}

migrate().catch((err) => {
  console.error("Capital partners migration failed:", err);
  process.exit(1);
});
