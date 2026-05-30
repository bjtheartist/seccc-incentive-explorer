import { requireSQL } from "@/lib/db";
import type {
  CorrectionInput,
  ExportEventInput,
  PartnerCorrection,
  SearchLogInput,
  WatchAreaInput,
  WatchedArea,
} from "@/lib/types/user-intel";

/**
 * User intelligence domain helpers (Domain 6).
 * Captures product/user signals. No external data source.
 */

/**
 * PURE helper: trim, lowercase, and collapse internal whitespace.
 * Unit-testable without a DB.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function toWatchedArea(row: Record<string, unknown>): WatchedArea {
  return {
    id: String(row.id),
    areaType: String(row.area_type),
    areaId: String(row.area_id),
    areaLabel: row.area_label ? String(row.area_label) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/** Log a search event. user_id NULL for anonymous searches. */
export async function logSearch(input: SearchLogInput): Promise<string> {
  const sql = requireSQL();
  const normalized =
    typeof input.query === "string" ? normalizeSearchQuery(input.query) : null;
  const rows = await sql`
    INSERT INTO search_log (user_id, query, address, lat, lon, result_count)
    VALUES (
      ${input.userId ?? null},
      ${normalized},
      ${input.address ?? null},
      ${input.lat ?? null},
      ${input.lon ?? null},
      ${input.resultCount ?? null}
    )
    RETURNING id
  `;
  return String(rows[0].id);
}

/** Add a watched area for a user. Idempotent on (user_id, area_type, area_id). */
export async function watchArea(
  userId: string,
  input: WatchAreaInput
): Promise<WatchedArea> {
  const sql = requireSQL();
  const rows = await sql`
    INSERT INTO watched_areas (user_id, area_type, area_id, area_label)
    VALUES (${userId}, ${input.areaType}, ${input.areaId}, ${input.areaLabel ?? null})
    ON CONFLICT (user_id, area_type, area_id)
    DO UPDATE SET area_label = COALESCE(EXCLUDED.area_label, watched_areas.area_label)
    RETURNING id, area_type, area_id, area_label, created_at
  `;
  return toWatchedArea(rows[0] as Record<string, unknown>);
}

/** Remove a watched area for a user. Returns true if a row was deleted. */
export async function unwatchArea(
  userId: string,
  areaType: string,
  areaId: string
): Promise<boolean> {
  const sql = requireSQL();
  const rows = await sql`
    DELETE FROM watched_areas
    WHERE user_id = ${userId} AND area_type = ${areaType} AND area_id = ${areaId}
    RETURNING id
  `;
  return rows.length > 0;
}

/** List a user's watched areas, newest first. */
export async function listWatchedAreas(userId: string): Promise<WatchedArea[]> {
  const sql = requireSQL();
  const rows = await sql`
    SELECT id, area_type, area_id, area_label, created_at
    FROM watched_areas
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map((row) => toWatchedArea(row as Record<string, unknown>));
}

/** Record an export event. user_id NULL for anonymous exports. */
export async function recordExport(input: ExportEventInput): Promise<string> {
  const sql = requireSQL();
  const rows = await sql`
    INSERT INTO export_events (user_id, report_id, report_type, format)
    VALUES (
      ${input.userId ?? null},
      ${input.reportId ?? null},
      ${input.reportType ?? null},
      ${input.format ?? null}
    )
    RETURNING id
  `;
  return String(rows[0].id);
}

/** Submit a partner correction. Defaults to status 'pending'. */
export async function submitCorrection(
  input: CorrectionInput
): Promise<PartnerCorrection> {
  const sql = requireSQL();
  const rows = await sql`
    INSERT INTO partner_corrections (
      submitter_user_id, submitter_email, target_type, target_id,
      field, current_value, suggested_value, note
    )
    VALUES (
      ${input.submitterUserId ?? null},
      ${input.submitterEmail ?? null},
      ${input.targetType},
      ${input.targetId},
      ${input.field ?? null},
      ${input.currentValue ?? null},
      ${input.suggestedValue ?? null},
      ${input.note ?? null}
    )
    RETURNING id, status, created_at
  `;
  const row = rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    status: String(row.status) as PartnerCorrection["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
