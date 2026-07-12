#!/usr/bin/env npx tsx
/**
 * Database migration for the Site Concierge audit tables (Stage 3).
 *
 * Idempotent (CREATE TABLE / INDEX IF NOT EXISTS), following the pattern of
 * scripts/migrate-incentive-preparation.ts. Safe to re-run.
 *
 * The route persists to these tables ONLY when the DB is configured AND the
 * user is signed in. Guest conversations are never written to the DB (their
 * usage is captured only through the existing analytics events). Persistence is
 * best-effort — a missing table or write error must never break the chat.
 *
 * DO NOT run this against a production database without explicit approval, and
 * verify on a disposable Neon branch first.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-concierge.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running concierge audit migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating concierge_conversations...");
  await sql`
    CREATE TABLE IF NOT EXISTS concierge_conversations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      page_route TEXT,
      model_id TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("2. Creating concierge_messages...");
  await sql`
    CREATE TABLE IF NOT EXISTS concierge_messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      conversation_id TEXT NOT NULL REFERENCES concierge_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL DEFAULT '',
      -- Tool calls the assistant made in this message (name, input, state).
      tool_calls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- Citation / source records grounding the message (program id, officialUrl).
      citations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("3. Creating concierge_tool_actions...");
  await sql`
    CREATE TABLE IF NOT EXISTS concierge_tool_actions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      conversation_id TEXT NOT NULL REFERENCES concierge_conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES concierge_messages(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      tool_call_id TEXT,
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- proposed | approved | declined | executed | failed
      approval_status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (approval_status IN ('proposed', 'approved', 'declined', 'executed', 'failed')),
      result_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("4. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_conversations_user_id ON concierge_conversations (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_conversations_session_id ON concierge_conversations (session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_conversations_updated_at ON concierge_conversations (updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_messages_conversation_id ON concierge_messages (conversation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_messages_user_id ON concierge_messages (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_messages_created_at ON concierge_messages (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_tool_actions_conversation_id ON concierge_tool_actions (conversation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_tool_actions_user_id ON concierge_tool_actions (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_tool_actions_tool_name ON concierge_tool_actions (tool_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_concierge_tool_actions_status ON concierge_tool_actions (approval_status)`;

  console.log("\nConcierge audit migration complete.");
}

main().catch((err) => {
  console.error("Concierge audit migration failed:", err);
  process.exit(1);
});
