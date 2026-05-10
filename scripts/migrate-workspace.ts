#!/usr/bin/env npx tsx
/**
 * Database migration for Google auth, saved reports, and business workspaces.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-workspace.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log("Running workspace/auth migration...\n");

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  console.log("1. Creating Auth.js tables...");
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT,
      email TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image TEXT,
      password_hash TEXT
    )
  `;

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at BIGINT,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      UNIQUE(provider, "providerAccountId")
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      "sessionToken" TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS verification_token (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(identifier, token)
    )
  `;

  console.log("2. Creating workspace tables...");
  await sql`
    CREATE TABLE IF NOT EXISTS business_projects (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_type TEXT NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      industry TEXT,
      budget_range TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      checklist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES business_projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      report_type TEXT NOT NULL,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      wizard_state_json JSONB NOT NULL,
      report_data_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("3. Creating indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts ("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions ("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_projects_user_id ON business_projects (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_projects_goal_type ON business_projects (goal_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_reports_user_id ON saved_reports (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_reports_project_id ON saved_reports (project_id)`;

  console.log("\nWorkspace/auth migration complete.");
}

main().catch((err) => {
  console.error("Workspace migration failed:", err);
  process.exit(1);
});
