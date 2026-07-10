import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "./db";

type SqlClient = NeonQueryFunction<false, false>;

const RESET_TOKEN_TTL_MINUTES = 60;
const MAX_RECIPIENT_REQUESTS_PER_HOUR = 3;
const MAX_CLIENT_REQUESTS_PER_HOUR = 8;
const RESET_IDENTIFIER_PREFIX = "password-reset:";

let passwordResetStorageReady: Promise<void> | null = null;

export const PASSWORD_RESET_RESPONSE =
  "If an account exists for that email, a password reset link is on its way.";

export class PasswordResetStorageUnavailableError extends Error {}

export type PasswordResetReservation =
  | { allowed: true; id: number }
  | { allowed: false };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return sha256(token);
}

export function passwordResetClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

export function passwordResetUrl(token: string): string {
  const configuredBase =
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "https://chicagoincentiveexplorer.com"
      : "http://localhost:3000");
  const url = new URL("/reset-password", configuredBase);
  url.searchParams.set("token", token);
  return url.toString();
}

async function migratePasswordResetStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id BIGSERIAL PRIMARY KEY,
      recipient_hash TEXT NOT NULL,
      client_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS password_reset_requests_created_at_idx
    ON password_reset_requests (created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS verification_token_token_idx
    ON verification_token (token)
  `;
  await sql`
    DELETE FROM password_reset_requests
    WHERE created_at < NOW() - INTERVAL '30 days'
  `;
  await sql`
    DELETE FROM verification_token
    WHERE identifier LIKE ${`${RESET_IDENTIFIER_PREFIX}%`}
      AND expires <= NOW()
  `;
}

export async function ensurePasswordResetStorage(
  sql: SqlClient
): Promise<void> {
  if (!passwordResetStorageReady) {
    passwordResetStorageReady = migratePasswordResetStorage(sql).catch(
      (error) => {
        passwordResetStorageReady = null;
        throw error;
      }
    );
  }
  return passwordResetStorageReady;
}

function requirePasswordResetSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new PasswordResetStorageUnavailableError(
      "Password reset storage is not configured"
    );
  }
  return sql;
}

export async function reservePasswordResetRequest(
  email: string,
  clientIdentifier: string
): Promise<PasswordResetReservation> {
  const sql = requirePasswordResetSQL();
  await ensurePasswordResetStorage(sql);

  const recipientHash = sha256(email.trim().toLowerCase());
  const clientHash = sha256(clientIdentifier);
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE recipient_hash = ${recipientHash})::int AS recipient_count,
      COUNT(*) FILTER (WHERE client_hash = ${clientHash})::int AS client_count
    FROM password_reset_requests
    WHERE created_at >= NOW() - INTERVAL '1 hour'
  `;
  const recipientCount = Number(rows[0]?.recipient_count || 0);
  const clientCount = Number(rows[0]?.client_count || 0);

  if (
    recipientCount >= MAX_RECIPIENT_REQUESTS_PER_HOUR ||
    clientCount >= MAX_CLIENT_REQUESTS_PER_HOUR
  ) {
    return { allowed: false };
  }

  const inserted = await sql`
    INSERT INTO password_reset_requests (recipient_hash, client_hash, status)
    VALUES (${recipientHash}, ${clientHash}, 'pending')
    RETURNING id
  `;
  return { allowed: true, id: Number(inserted[0]?.id) };
}

export async function findPasswordResetUser(
  email: string
): Promise<{ id: string } | null> {
  const sql = requirePasswordResetSQL();
  const rows = await sql`
    SELECT id
    FROM users
    WHERE lower(email) = ${email.trim().toLowerCase()}
    LIMIT 1
  `;
  return rows[0]?.id ? { id: String(rows[0].id) } : null;
}

export async function storePasswordResetToken(
  userId: string,
  token: string
): Promise<void> {
  const sql = requirePasswordResetSQL();
  const identifier = `${RESET_IDENTIFIER_PREFIX}${userId}`;
  const tokenHash = hashPasswordResetToken(token);

  await sql`
    DELETE FROM verification_token
    WHERE identifier = ${identifier}
  `;
  await sql`
    INSERT INTO verification_token (identifier, token, expires)
    VALUES (
      ${identifier},
      ${tokenHash},
      NOW() + (${RESET_TOKEN_TTL_MINUTES} * INTERVAL '1 minute')
    )
  `;
}

export async function deletePasswordResetToken(
  userId: string
): Promise<void> {
  const sql = requirePasswordResetSQL();
  await sql`
    DELETE FROM verification_token
    WHERE identifier = ${`${RESET_IDENTIFIER_PREFIX}${userId}`}
  `;
}

export async function markPasswordResetRequest(
  requestId: number,
  status: "sent" | "ignored" | "failed"
): Promise<void> {
  const sql = requirePasswordResetSQL();
  await sql`
    UPDATE password_reset_requests
    SET status = ${status}
    WHERE id = ${requestId}
  `;
}

export async function consumePasswordResetToken(
  token: string,
  passwordHash: string
): Promise<boolean> {
  const sql = requirePasswordResetSQL();
  await ensurePasswordResetStorage(sql);
  const tokenHash = hashPasswordResetToken(token);

  const rows = await sql`
    WITH consumed AS (
      DELETE FROM verification_token
      WHERE token = ${tokenHash}
        AND identifier LIKE ${`${RESET_IDENTIFIER_PREFIX}%`}
        AND expires > NOW()
      RETURNING identifier
    )
    UPDATE users AS account
    SET
      password_hash = ${passwordHash},
      "emailVerified" = COALESCE(account."emailVerified", NOW())
    FROM consumed
    WHERE consumed.identifier = ${RESET_IDENTIFIER_PREFIX} || account.id
    RETURNING account.id
  `;

  return Boolean(rows[0]?.id);
}
