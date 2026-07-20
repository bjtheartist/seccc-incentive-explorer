import "server-only";

import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";
import {
  FUTURE_COMMERCE_CONSENT_VERSION,
  FUTURE_COMMERCE_SOURCE,
  type FutureCommerceSignupInput,
} from "@/lib/future-commerce-signup";

type SqlClient = NeonQueryFunction<false, false>;

const MAX_SIGNUPS_PER_CLIENT_PER_HOUR = 20;
let storageReady: Promise<void> | null = null;

export class FutureCommerceSignupStorageUnavailableError extends Error {}

export interface FutureCommerceSignupRecord {
  id: string;
  email: string;
  neighborhood: string;
  address: string;
  zipCode: string;
  consentVersion: string;
  source: string;
  signedUpAt: string;
  updatedAt: string;
}

export interface FutureCommerceSignupAdminData {
  total: number;
  rows: FutureCommerceSignupRecord[];
  neighborhoods: { label: string; count: number }[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireSignupSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new FutureCommerceSignupStorageUnavailableError(
      "Future of Commerce signup storage is not configured",
    );
  }
  return sql;
}

async function migrateStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS future_commerce_signups (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email TEXT NOT NULL UNIQUE,
      neighborhood TEXT NOT NULL,
      street_address TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      marketing_consent BOOLEAN NOT NULL DEFAULT TRUE,
      consent_version TEXT NOT NULL,
      source TEXT NOT NULL,
      subscribed BOOLEAN NOT NULL DEFAULT TRUE,
      consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signups_created_at_idx
    ON future_commerce_signups (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signups_zip_idx
    ON future_commerce_signups (zip_code)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS future_commerce_signup_attempts (
      id BIGSERIAL PRIMARY KEY,
      client_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS future_commerce_signup_attempts_created_at_idx
    ON future_commerce_signup_attempts (created_at DESC)
  `;
  await sql`
    DELETE FROM future_commerce_signup_attempts
    WHERE created_at < NOW() - INTERVAL '30 days'
  `;
}

export async function ensureFutureCommerceSignupStorage(
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

export function futureCommerceClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

export async function reserveFutureCommerceSignup(
  clientIdentifier: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const sql = requireSignupSQL();
  await ensureFutureCommerceSignupStorage(sql);
  const clientHash = sha256(clientIdentifier);
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM future_commerce_signup_attempts
    WHERE client_hash = ${clientHash}
      AND created_at >= NOW() - INTERVAL '1 hour'
  `;

  if (Number(rows[0]?.count || 0) >= MAX_SIGNUPS_PER_CLIENT_PER_HOUR) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  await sql`
    INSERT INTO future_commerce_signup_attempts (client_hash)
    VALUES (${clientHash})
  `;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function saveFutureCommerceSignup(
  input: FutureCommerceSignupInput,
): Promise<string> {
  const sql = requireSignupSQL();
  await ensureFutureCommerceSignupStorage(sql);
  const rows = await sql`
    INSERT INTO future_commerce_signups (
      email,
      neighborhood,
      street_address,
      zip_code,
      marketing_consent,
      consent_version,
      source,
      subscribed,
      consented_at,
      unsubscribed_at
    )
    VALUES (
      ${input.email},
      ${input.neighborhood},
      ${input.address},
      ${input.zipCode},
      TRUE,
      ${FUTURE_COMMERCE_CONSENT_VERSION},
      ${FUTURE_COMMERCE_SOURCE},
      TRUE,
      NOW(),
      NULL
    )
    ON CONFLICT (email) DO UPDATE SET
      neighborhood = EXCLUDED.neighborhood,
      street_address = EXCLUDED.street_address,
      zip_code = EXCLUDED.zip_code,
      marketing_consent = TRUE,
      consent_version = EXCLUDED.consent_version,
      source = EXCLUDED.source,
      subscribed = TRUE,
      consented_at = NOW(),
      unsubscribed_at = NULL,
      updated_at = NOW()
    RETURNING id
  `;
  return String(rows[0]?.id);
}

function toRecord(row: Record<string, unknown>): FutureCommerceSignupRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    neighborhood: String(row.neighborhood),
    address: String(row.street_address),
    zipCode: String(row.zip_code),
    consentVersion: String(row.consent_version),
    source: String(row.source),
    signedUpAt: asIso(row.consented_at as string | Date),
    updatedAt: asIso(row.updated_at as string | Date),
  };
}

export async function listFutureCommerceSignups(
  limit = 5000,
): Promise<FutureCommerceSignupRecord[]> {
  const sql = requireSignupSQL();
  await ensureFutureCommerceSignupStorage(sql);
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 10_000));
  const rows = await sql`
    SELECT
      id,
      email,
      neighborhood,
      street_address,
      zip_code,
      consent_version,
      source,
      consented_at,
      updated_at
    FROM future_commerce_signups
    WHERE subscribed = TRUE
    ORDER BY consented_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => toRecord(row as Record<string, unknown>));
}

export async function getFutureCommerceSignupAdminData(
  limit = 500,
): Promise<FutureCommerceSignupAdminData> {
  const sql = requireSignupSQL();
  await ensureFutureCommerceSignupStorage(sql);
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  const [rows, totalRows, neighborhoodRows] = await Promise.all([
    sql`
      SELECT
        id,
        email,
        neighborhood,
        street_address,
        zip_code,
        consent_version,
        source,
        consented_at,
        updated_at
      FROM future_commerce_signups
      WHERE subscribed = TRUE
      ORDER BY consented_at DESC
      LIMIT ${safeLimit}
    `,
    sql`
      SELECT COUNT(*)::int AS count
      FROM future_commerce_signups
      WHERE subscribed = TRUE
    `,
    sql`
      SELECT neighborhood AS label, COUNT(*)::int AS count
      FROM future_commerce_signups
      WHERE subscribed = TRUE
      GROUP BY neighborhood
      ORDER BY count DESC, neighborhood ASC
      LIMIT 12
    `,
  ]);

  return {
    total: Number(totalRows[0]?.count || 0),
    rows: rows.map((row) => toRecord(row as Record<string, unknown>)),
    neighborhoods: neighborhoodRows.map((row) => ({
      label: String(row.label),
      count: Number(row.count || 0),
    })),
  };
}
