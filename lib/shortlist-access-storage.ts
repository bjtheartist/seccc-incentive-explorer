import "server-only";

import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";
import {
  SHORTLIST_ACCESS_SOURCE,
  type ShortlistAccessSignupInput,
} from "@/lib/shortlist-access";

type SqlClient = NeonQueryFunction<false, false>;

const MAX_SIGNUPS_PER_CLIENT_PER_HOUR = 10;
let storageReady: Promise<void> | null = null;

export class ShortlistAccessStorageUnavailableError extends Error {}

export interface ShortlistAccessRecord {
  id: string;
  name: string;
  title: string;
  email: string;
  source: string;
  signedUpAt: string;
  updatedAt: string;
}

function requireSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new ShortlistAccessStorageUnavailableError(
      "Shortlist access signup storage is not configured",
    );
  }
  return sql;
}

async function migrateStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS shortlist_access_signups (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS shortlist_access_signups_created_at_idx
    ON shortlist_access_signups (created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS shortlist_access_signup_attempts (
      id BIGSERIAL PRIMARY KEY,
      client_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS shortlist_access_signup_attempts_created_at_idx
    ON shortlist_access_signup_attempts (created_at DESC)
  `;
  await sql`
    DELETE FROM shortlist_access_signup_attempts
    WHERE created_at < NOW() - INTERVAL '30 days'
  `;
}

async function ensureStorage(sql: SqlClient): Promise<void> {
  if (!storageReady) {
    storageReady = migrateStorage(sql).catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  return storageReady;
}

export function shortlistAccessClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

export async function reserveShortlistAccessSignup(
  clientIdentifier: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const sql = requireSQL();
  await ensureStorage(sql);
  const clientHash = createHash("sha256").update(clientIdentifier).digest("hex");
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM shortlist_access_signup_attempts
    WHERE client_hash = ${clientHash}
      AND created_at >= NOW() - INTERVAL '1 hour'
  `;

  if (Number(rows[0]?.count || 0) >= MAX_SIGNUPS_PER_CLIENT_PER_HOUR) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  await sql`
    INSERT INTO shortlist_access_signup_attempts (client_hash)
    VALUES (${clientHash})
  `;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function saveShortlistAccessSignup(
  input: ShortlistAccessSignupInput,
): Promise<string> {
  const sql = requireSQL();
  await ensureStorage(sql);
  const rows = await sql`
    INSERT INTO shortlist_access_signups (full_name, job_title, email, source)
    VALUES (${input.name}, ${input.title}, ${input.email}, ${SHORTLIST_ACCESS_SOURCE})
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      job_title = EXCLUDED.job_title,
      source = EXCLUDED.source,
      updated_at = NOW()
    RETURNING id
  `;
  return String(rows[0]?.id);
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function listShortlistAccessSignups(
  limit = 10_000,
): Promise<ShortlistAccessRecord[]> {
  const sql = requireSQL();
  await ensureStorage(sql);
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 10_000));
  const rows = await sql`
    SELECT id, full_name, job_title, email, source, created_at, updated_at
    FROM shortlist_access_signups
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.full_name),
    title: String(row.job_title),
    email: String(row.email),
    source: String(row.source),
    signedUpAt: asIso(row.created_at as string | Date),
    updatedAt: asIso(row.updated_at as string | Date),
  }));
}
