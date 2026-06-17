import { getSQL } from "@/lib/db";
import {
  sanitizeAnalyticsEventPayload,
  type AnalyticsEventPayload,
  type AnalyticsEventType,
} from "@/lib/analytics-events";

let reportEventsTableReady = false;

export async function ensureReportEventsTable() {
  const sql = getSQL();
  if (!sql) return null;
  if (reportEventsTableReady) return sql;

  await sql`
    CREATE TABLE IF NOT EXISTS report_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      report_type TEXT,
      source TEXT,
      address TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_event_type ON report_events (event_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_created_at ON report_events (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_report_type ON report_events (report_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_report_events_user_id ON report_events (user_id)`;

  reportEventsTableReady = true;
  return sql;
}

export async function recordReportEvent(
  eventType: AnalyticsEventType,
  payload: Omit<AnalyticsEventPayload, "eventType"> & { userId?: string | null } = {}
) {
  try {
    const event = sanitizeAnalyticsEventPayload(eventType, payload);
    if (!event) return false;

    const sql = await ensureReportEventsTable();
    if (!sql) return false;

    await sql`
      INSERT INTO report_events (
        event_type, report_type, source, address, lat, lon, metadata_json, user_id
      )
      VALUES (
        ${event.eventType},
        ${event.reportType},
        ${event.source},
        ${event.address},
        ${event.lat},
        ${event.lon},
        ${JSON.stringify(event.metadata)}::jsonb,
        ${payload.userId ?? null}
      )
    `;

    return true;
  } catch (err) {
    console.error("[analytics] failed to record event:", err);
    return false;
  }
}
