/**
 * Report-lead storage, including the Chamber-notification status columns.
 *
 * PR #250 audit finding 1: when the Chamber alert for a support request did
 * not dispatch, the only trace was a `console.error`. The lead row looked
 * exactly like a delivered one, so a 20-minute Resend outage could bury six
 * real leads with nothing for staff to query. `notification_status` and
 * `notification_error` are that durable record:
 *
 *   SELECT * FROM report_leads
 *   WHERE wants_incentive_help IS TRUE
 *     AND notification_status IS DISTINCT FROM 'sent'
 *   ORDER BY created_at DESC;
 *
 * `notification_status` is one of 'sent' | 'failed' | 'unconfigured', and is
 * NULL for every row written before this migration.
 *
 * Idempotent, and intentionally identical to the runtime migration in
 * `lib/report-email-delivery.ts` (`migrateReportEmailStorage`) — that one runs
 * lazily on the first lead write of a process, this one lets the schema be
 * moved ahead of a deploy instead of by the first visitor.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
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
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS notification_status TEXT`;
  await sql`ALTER TABLE report_leads ADD COLUMN IF NOT EXISTS notification_error TEXT`;
  await sql`
    CREATE INDEX IF NOT EXISTS report_leads_notification_status_idx
    ON report_leads (notification_status)
  `;

  console.log("Report lead storage is ready (notification_status/notification_error present).");
}

main().catch((error) => {
  console.error("Report lead migration failed:", error);
  process.exit(1);
});
