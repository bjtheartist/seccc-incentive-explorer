import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";

type SqlClient = NeonQueryFunction<false, false>;

export const INVESTMENT_SHARE_LINK_EXPIRY_OPTIONS_DAYS = [7, 30, 90, 180] as const;
export const DEFAULT_INVESTMENT_SHARE_LINK_EXPIRY_DAYS = 30;
const MAX_LABEL_LENGTH = 160;

let storageReady: Promise<void> | null = null;

export class InvestmentShareLinkStorageUnavailableError extends Error {}

export interface InvestmentShareLinkRecord {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string;
  lastOpenedAt: string;
  openCount: number;
}

export type InvestmentShareLinkState = "active" | "expired" | "revoked";

export function investmentShareLinkState(
  record: Pick<InvestmentShareLinkRecord, "expiresAt" | "revokedAt">,
  now = new Date(),
): InvestmentShareLinkState {
  if (record.revokedAt) return "revoked";
  if (new Date(record.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function normalizeInvestmentShareLinkLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > MAX_LABEL_LENGTH) return null;
  return label;
}

export function normalizeInvestmentShareLinkExpiryDays(value: unknown): number | null {
  const days = Number(value);
  return (INVESTMENT_SHARE_LINK_EXPIRY_OPTIONS_DAYS as readonly number[]).includes(days) ? days : null;
}

function requireSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new InvestmentShareLinkStorageUnavailableError(
      "Investment share-link storage is not configured",
    );
  }
  return sql;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asOptionalIso(value: unknown): string {
  if (!value) return "";
  return (value instanceof Date ? value : new Date(value as string)).toISOString();
}

function toRecord(row: Record<string, unknown>): InvestmentShareLinkRecord {
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    createdAt: asOptionalIso(row.created_at),
    expiresAt: asOptionalIso(row.expires_at),
    revokedAt: asOptionalIso(row.revoked_at),
    lastOpenedAt: asOptionalIso(row.last_opened_at),
    openCount: Number(row.open_count ?? 0),
  };
}

async function migrateStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public_investment_share_links (
      id BIGSERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      last_opened_at TIMESTAMPTZ,
      open_count INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS public_investment_share_links_created_at_idx
    ON public_investment_share_links (created_at DESC)
  `;
}

export async function ensureInvestmentShareLinkStorage(sql: SqlClient): Promise<void> {
  if (!storageReady) {
    storageReady = migrateStorage(sql).catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  return storageReady;
}

async function withStorage<T>(work: (sql: SqlClient) => Promise<T>): Promise<T> {
  const sql = requireSQL();
  try {
    await ensureInvestmentShareLinkStorage(sql);
    return await work(sql);
  } catch (error) {
    if (error instanceof InvestmentShareLinkStorageUnavailableError) throw error;
    throw new InvestmentShareLinkStorageUnavailableError(
      error instanceof Error ? error.message : "Investment share-link storage failed",
    );
  }
}

export async function createInvestmentShareLink(input: {
  label: string;
  expiresInDays: number;
}): Promise<{ record: InvestmentShareLinkRecord; token: string }> {
  return withStorage(async (sql) => {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    const rows = await sql`
      INSERT INTO public_investment_share_links (label, token_hash, expires_at)
      VALUES (${input.label}, ${sha256(token)}, ${expiresAt})
      RETURNING id, label, created_at, expires_at, revoked_at, last_opened_at, open_count
    `;
    return { record: toRecord(rows[0] as Record<string, unknown>), token };
  });
}

export async function listInvestmentShareLinks(): Promise<InvestmentShareLinkRecord[]> {
  return withStorage(async (sql) => {
    const rows = await sql`
      SELECT id, label, created_at, expires_at, revoked_at, last_opened_at, open_count
      FROM public_investment_share_links
      ORDER BY created_at DESC
      LIMIT 200
    `;
    return rows.map((row) => toRecord(row as Record<string, unknown>));
  });
}

export async function revokeInvestmentShareLink(id: string): Promise<InvestmentShareLinkRecord | null> {
  return withStorage(async (sql) => {
    const rows = await sql`
      UPDATE public_investment_share_links
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = ${id}
      RETURNING id, label, created_at, expires_at, revoked_at, last_opened_at, open_count
    `;
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  });
}

/**
 * Swap a raw link token for its record, counting the open. Returns null when
 * the token is unknown, expired, or revoked — the three are deliberately
 * indistinguishable to the caller so a guessed token learns nothing.
 */
export async function redeemInvestmentShareLink(token: string): Promise<InvestmentShareLinkRecord | null> {
  if (!token || token.length > 128) return null;
  return withStorage(async (sql) => {
    const rows = await sql`
      UPDATE public_investment_share_links
      SET open_count = open_count + 1, last_opened_at = NOW()
      WHERE token_hash = ${sha256(token)}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING id, label, created_at, expires_at, revoked_at, last_opened_at, open_count
    `;
    return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
  });
}

/** True while the link a session came from is neither revoked nor expired. */
export async function isInvestmentShareLinkActive(id: string): Promise<boolean> {
  if (!/^\d+$/.test(id)) return false;
  return withStorage(async (sql) => {
    const rows = await sql`
      SELECT 1 AS ok
      FROM public_investment_share_links
      WHERE id = ${id} AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1
    `;
    return rows.length > 0;
  });
}
