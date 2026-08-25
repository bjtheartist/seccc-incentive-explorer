import "server-only";

import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";
import {
  PUBLIC_INVESTMENT_EARLY_ACCESS_SOURCE,
  type PublicInvestmentEarlyAccessInput,
} from "@/lib/public-investment-early-access";

type SqlClient = NeonQueryFunction<false, false>;

const MAX_REQUESTS_PER_CLIENT_PER_HOUR = 10;
let storageReady: Promise<void> | null = null;

export class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {}

export interface PublicInvestmentEarlyAccessRecord {
  id: string;
  name: string;
  title: string;
  email: string;
  source: string;
  requestedAt: string;
  updatedAt: string;
}

function requireSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new PublicInvestmentEarlyAccessStorageUnavailableError(
      "Public Investment early-access storage is not configured",
    );
  }
  return sql;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function migrateStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public_investment_early_access (
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
    CREATE INDEX IF NOT EXISTS public_investment_early_access_created_at_idx
    ON public_investment_early_access (created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS public_investment_early_access_attempts (
      id BIGSERIAL PRIMARY KEY,
      client_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS public_investment_early_access_attempts_created_at_idx
    ON public_investment_early_access_attempts (created_at DESC)
  `;
  await sql`
    DELETE FROM public_investment_early_access_attempts
    WHERE created_at < NOW() - INTERVAL '30 days'
  `;
}

export async function ensurePublicInvestmentEarlyAccessStorage(
  sql: SqlClient,
): Promise<void> {
  if (!storageReady) {
    storageReady = migrateStorage(sql).catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  return storageReady;
}

export function publicInvestmentEarlyAccessClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

export async function reservePublicInvestmentEarlyAccessRequest(
  clientIdentifier: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const clientHash = sha256(clientIdentifier);
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM public_investment_early_access_attempts
    WHERE client_hash = ${clientHash}
      AND created_at >= NOW() - INTERVAL '1 hour'
  `;

  if (Number(rows[0]?.count || 0) >= MAX_REQUESTS_PER_CLIENT_PER_HOUR) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  await sql`
    INSERT INTO public_investment_early_access_attempts (client_hash)
    VALUES (${clientHash})
  `;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function savePublicInvestmentEarlyAccessRequest(
  input: PublicInvestmentEarlyAccessInput,
): Promise<string> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const rows = await sql`
    INSERT INTO public_investment_early_access (
      full_name,
      job_title,
      email,
      source
    )
    VALUES (
      ${input.name},
      ${input.title},
      ${input.email},
      ${PUBLIC_INVESTMENT_EARLY_ACCESS_SOURCE}
    )
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      job_title = EXCLUDED.job_title,
      source = EXCLUDED.source,
      updated_at = NOW()
    RETURNING id
  `;
  return String(rows[0]?.id);
}

function toRecord(row: Record<string, unknown>): PublicInvestmentEarlyAccessRecord {
  return {
    id: String(row.id),
    name: String(row.full_name),
    title: String(row.job_title),
    email: String(row.email),
    source: String(row.source),
    requestedAt: asIso(row.created_at as string | Date),
    updatedAt: asIso(row.updated_at as string | Date),
  };
}

export async function listPublicInvestmentEarlyAccessRequests(
  limit = 10_000,
): Promise<PublicInvestmentEarlyAccessRecord[]> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 10_000));
  const rows = await sql`
    SELECT id, full_name, job_title, email, source, created_at, updated_at
    FROM public_investment_early_access
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => toRecord(row as Record<string, unknown>));
}
