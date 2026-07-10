import "server-only";

import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "./db";

type SqlClient = NeonQueryFunction<false, false>;
let reportEmailStorageReady: Promise<void> | null = null;

export interface ReportLeadInput {
  name?: string;
  email: string;
  zipCode?: string;
  reportAddress?: string;
  reportTitle?: string;
  reportType?: string;
  projectGoal?: string;
  wantsHelp: boolean;
  source: string;
}

export class ReportEmailStorageUnavailableError extends Error {}

export type ReportEmailReservation =
  | { allowed: true; id: number }
  | { allowed: false; retryAfterSeconds: number };

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function reportEmailClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

async function migrateReportEmailStorage(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS report_leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      report_address TEXT,
      report_title TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS report_type TEXT`;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS project_goal TEXT`;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS wants_incentive_help BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS delivery_source TEXT`;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS email_delivered_at TIMESTAMPTZ`;

  await sql`
    CREATE TABLE IF NOT EXISTS report_email_deliveries (
      id BIGSERIAL PRIMARY KEY,
      recipient_hash TEXT NOT NULL,
      client_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS report_email_deliveries_created_at_idx
    ON report_email_deliveries (created_at DESC)
  `;
  await sql`
    DELETE FROM report_email_deliveries
    WHERE created_at < NOW() - INTERVAL '30 days'
  `;
}

export async function ensureReportEmailStorage(sql: SqlClient): Promise<void> {
  if (!reportEmailStorageReady) {
    reportEmailStorageReady = migrateReportEmailStorage(sql).catch((error) => {
      reportEmailStorageReady = null;
      throw error;
    });
  }
  return reportEmailStorageReady;
}

function requireEmailSQL(): SqlClient {
  const sql = getSQL();
  if (!sql) {
    throw new ReportEmailStorageUnavailableError("Report email storage is not configured");
  }
  return sql;
}

export async function reserveReportEmailDelivery(
  email: string,
  clientIdentifier: string,
): Promise<ReportEmailReservation> {
  const sql = requireEmailSQL();
  await ensureReportEmailStorage(sql);

  const recipientHash = hashIdentifier(email.trim().toLowerCase());
  const clientHash = hashIdentifier(clientIdentifier);
  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE recipient_hash = ${recipientHash})::int AS recipient_count,
      COUNT(*) FILTER (WHERE client_hash = ${clientHash})::int AS client_count
    FROM report_email_deliveries
    WHERE created_at >= NOW() - INTERVAL '1 hour'
      AND status IN ('pending', 'sent')
  `;
  const recipientCount = Number(rows[0]?.recipient_count || 0);
  const clientCount = Number(rows[0]?.client_count || 0);

  if (recipientCount >= 3 || clientCount >= 8) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  const inserted = await sql`
    INSERT INTO report_email_deliveries (recipient_hash, client_hash, status)
    VALUES (${recipientHash}, ${clientHash}, 'pending')
    RETURNING id
  `;
  return { allowed: true, id: Number(inserted[0]?.id) };
}

export async function createReportLead(input: ReportLeadInput): Promise<number> {
  const sql = requireEmailSQL();
  await ensureReportEmailStorage(sql);
  const rows = await sql`
    INSERT INTO report_leads (
      name,
      email,
      zip_code,
      report_address,
      report_title,
      report_type,
      project_goal,
      wants_incentive_help,
      delivery_source
    )
    VALUES (
      ${input.name?.trim() || "Report recipient"},
      ${input.email.trim().toLowerCase()},
      ${input.zipCode?.trim() || ""},
      ${input.reportAddress?.trim() || null},
      ${input.reportTitle?.trim() || null},
      ${input.reportType?.trim() || null},
      ${input.projectGoal?.trim() || null},
      ${input.wantsHelp},
      ${input.source}
    )
    RETURNING id
  `;
  return Number(rows[0]?.id);
}

export async function markReportLeadDelivered(leadId: number): Promise<void> {
  const sql = requireEmailSQL();
  await sql`
    UPDATE report_leads
    SET email_delivered_at = NOW()
    WHERE id = ${leadId}
  `;
}

export async function markReportEmailDelivery(
  reservationId: number,
  status: "sent" | "failed",
): Promise<void> {
  const sql = requireEmailSQL();
  await sql`
    UPDATE report_email_deliveries
    SET status = ${status}
    WHERE id = ${reservationId}
  `;
}
