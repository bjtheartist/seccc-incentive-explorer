import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";
import {
  PUBLIC_INVESTMENT_EARLY_ACCESS_SOURCE,
  type PublicInvestmentAccessStatus,
  type PublicInvestmentEarlyAccessInput,
} from "@/lib/public-investment-early-access";

type SqlClient = NeonQueryFunction<false, false>;

const MAX_REQUESTS_PER_CLIENT_PER_HOUR = 10;
const EMAIL_VERIFICATION_TOKEN_TTL_HOURS = 24;
const MAGIC_LINK_TOKEN_TTL_MINUTES = 30;
let storageReady: Promise<void> | null = null;

export class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {}

export interface PublicInvestmentEarlyAccessRecord {
  id: string;
  name: string;
  title: string;
  organization: string;
  useCase: string;
  email: string;
  source: string;
  status: PublicInvestmentAccessStatus;
  emailVerifiedAt: string;
  approvedAt: string;
  deniedAt: string;
  revokedAt: string;
  lastInvitedAt: string;
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

function asOptionalIso(value: unknown): string {
  return value ? asIso(value as string | Date) : "";
}

function authSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function nextAuthTokenHash(token: string): string {
  const secret = authSecret();
  if (!secret) {
    throw new PublicInvestmentEarlyAccessStorageUnavailableError(
      "Public Investment passwordless access is not configured",
    );
  }
  return sha256(`${token}${secret}`);
}

async function migrateStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public_investment_early_access (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      organization TEXT,
      use_case TEXT,
      email TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      access_status TEXT NOT NULL DEFAULT 'pending_verification',
      email_verified_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      denied_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      last_invited_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS organization TEXT`;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS use_case TEXT`;
  await sql`
    ALTER TABLE public_investment_early_access
    ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'pending_verification'
  `;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS denied_at TIMESTAMPTZ`;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE public_investment_early_access ADD COLUMN IF NOT EXISTS last_invited_at TIMESTAMPTZ`;
  await sql`
    CREATE INDEX IF NOT EXISTS public_investment_early_access_created_at_idx
    ON public_investment_early_access (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS public_investment_early_access_status_idx
    ON public_investment_early_access (access_status, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS public_investment_email_verification_tokens (
      email TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
  await sql`
    DELETE FROM public_investment_email_verification_tokens
    WHERE expires_at <= NOW()
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
): Promise<PublicInvestmentEarlyAccessRecord> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const rows = await sql`
    INSERT INTO public_investment_early_access (
      full_name,
      job_title,
      organization,
      use_case,
      email,
      source
    )
    VALUES (
      ${input.name},
      ${input.title},
      ${input.organization},
      ${input.useCase},
      ${input.email},
      ${PUBLIC_INVESTMENT_EARLY_ACCESS_SOURCE}
    )
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      job_title = EXCLUDED.job_title,
      organization = EXCLUDED.organization,
      use_case = EXCLUDED.use_case,
      source = EXCLUDED.source,
      updated_at = NOW()
    RETURNING *
  `;
  return toRecord(rows[0] as Record<string, unknown>);
}

function toRecord(row: Record<string, unknown>): PublicInvestmentEarlyAccessRecord {
  return {
    id: String(row.id),
    name: String(row.full_name),
    title: String(row.job_title),
    organization: row.organization ? String(row.organization) : "",
    useCase: row.use_case ? String(row.use_case) : "",
    email: String(row.email),
    source: String(row.source),
    status: String(row.access_status || "pending_verification") as PublicInvestmentAccessStatus,
    emailVerifiedAt: asOptionalIso(row.email_verified_at),
    approvedAt: asOptionalIso(row.approved_at),
    deniedAt: asOptionalIso(row.denied_at),
    revokedAt: asOptionalIso(row.revoked_at),
    lastInvitedAt: asOptionalIso(row.last_invited_at),
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
    SELECT
      id,
      full_name,
      job_title,
      organization,
      use_case,
      email,
      source,
      access_status,
      email_verified_at,
      approved_at,
      denied_at,
      revoked_at,
      last_invited_at,
      created_at,
      updated_at
    FROM public_investment_early_access
    ORDER BY
      CASE access_status
        WHEN 'pending_review' THEN 0
        WHEN 'pending_verification' THEN 1
        WHEN 'approved' THEN 2
        WHEN 'denied' THEN 3
        ELSE 4
      END,
      created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => toRecord(row as Record<string, unknown>));
}

export async function createPublicInvestmentEmailVerificationToken(
  email: string,
): Promise<string> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const normalizedEmail = email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await sql`DELETE FROM public_investment_email_verification_tokens WHERE email = ${normalizedEmail}`;
  await sql`
    INSERT INTO public_investment_email_verification_tokens (email, token_hash, expires_at)
    VALUES (
      ${normalizedEmail},
      ${tokenHash},
      NOW() + (${EMAIL_VERIFICATION_TOKEN_TTL_HOURS} * INTERVAL '1 hour')
    )
  `;
  return token;
}

export async function verifyPublicInvestmentEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await sql`
    WITH consumed AS (
      DELETE FROM public_investment_email_verification_tokens
      WHERE email = ${normalizedEmail}
        AND token_hash = ${sha256(token)}
        AND expires_at > NOW()
      RETURNING email
    )
    UPDATE public_investment_early_access AS request
    SET
      email_verified_at = COALESCE(request.email_verified_at, NOW()),
      access_status = CASE
        WHEN request.access_status = 'pending_verification' THEN 'pending_review'
        ELSE request.access_status
      END,
      updated_at = NOW()
    FROM consumed
    WHERE request.email = consumed.email
    RETURNING request.id
  `;
  return Boolean(rows[0]?.id);
}

export async function getPublicInvestmentAccessByEmail(
  email: string,
): Promise<PublicInvestmentEarlyAccessRecord | null> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const rows = await sql`
    SELECT *
    FROM public_investment_early_access
    WHERE email = ${email.trim().toLowerCase()}
    LIMIT 1
  `;
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

export async function getPublicInvestmentAccessById(
  id: string,
): Promise<PublicInvestmentEarlyAccessRecord | null> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const rows = await sql`
    SELECT *
    FROM public_investment_early_access
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

export async function hasApprovedPublicInvestmentAccess(email: string): Promise<boolean> {
  const request = await getPublicInvestmentAccessByEmail(email);
  return request?.status === "approved" && Boolean(request.emailVerifiedAt);
}

export async function decidePublicInvestmentAccess(
  id: string,
  decision: "approve" | "deny" | "revoke",
): Promise<PublicInvestmentEarlyAccessRecord | null> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const rows =
    decision === "approve"
      ? await sql`
          UPDATE public_investment_early_access
          SET
            access_status = 'approved',
            approved_at = NOW(),
            denied_at = NULL,
            revoked_at = NULL,
            updated_at = NOW()
          WHERE id = ${id}
            AND email_verified_at IS NOT NULL
          RETURNING *
        `
      : decision === "deny"
        ? await sql`
            UPDATE public_investment_early_access
            SET
              access_status = 'denied',
              denied_at = NOW(),
              approved_at = NULL,
              revoked_at = NULL,
              updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
          `
        : await sql`
            UPDATE public_investment_early_access
            SET
              access_status = 'revoked',
              revoked_at = NOW(),
              updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
          `;
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

export async function createPublicInvestmentMagicSignInToken(
  email: string,
): Promise<{ token: string; expiresAt: Date }> {
  const sql = requireSQL();
  await ensurePublicInvestmentEarlyAccessStorage(sql);
  const normalizedEmail = email.trim().toLowerCase();
  if (!(await hasApprovedPublicInvestmentAccess(normalizedEmail))) {
    throw new Error("Public Investment beta access is not approved");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = nextAuthTokenHash(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TOKEN_TTL_MINUTES * 60_000);
  await sql`DELETE FROM verification_token WHERE identifier = ${normalizedEmail}`;
  await sql`
    INSERT INTO verification_token (identifier, token, expires)
    VALUES (${normalizedEmail}, ${tokenHash}, ${expiresAt})
  `;
  await sql`
    UPDATE public_investment_early_access
    SET last_invited_at = NOW(), updated_at = NOW()
    WHERE email = ${normalizedEmail}
  `;
  return { token, expiresAt };
}
