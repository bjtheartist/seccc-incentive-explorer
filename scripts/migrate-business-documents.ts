#!/usr/bin/env npx tsx
/**
 * Database migration for the Business File document layer (packet_documents).
 * Run this after scripts/migrate-incentive-preparation.ts so the referenced
 * incentive_preparation_packets and users tables already exist.
 *
 * Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS, so re-running is a
 * no-op. This script does NOT run automatically; run it explicitly (with the
 * standing DB-approval doctrine) before enabling DOCUMENTS_ENABLED in an env.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-business-documents.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running business documents migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating packet_documents...");
  await sql`
    CREATE TABLE IF NOT EXISTS packet_documents (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      packet_id TEXT NOT NULL REFERENCES incentive_preparation_packets(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      blob_path TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'confirmed_current', 'superseded')),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '18 months')
    )
  `;

  console.log("2. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_packet_documents_user_id ON packet_documents (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_packet_documents_packet_id ON packet_documents (packet_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_packet_documents_packet_task ON packet_documents (packet_id, task_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_packet_documents_retention ON packet_documents (retention_expires_at)`;

  console.log("\nBusiness documents migration complete.");
}

main().catch((err) => {
  console.error("Business documents migration failed:", err);
  process.exit(1);
});
