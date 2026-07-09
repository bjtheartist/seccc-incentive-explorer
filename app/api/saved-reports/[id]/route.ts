import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const rows = await sql`
    SELECT *
    FROM saved_reports
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const row = rows[0] as Record<string, unknown>;
  const wizardState =
    typeof row.wizard_state_json === "string"
      ? JSON.parse(row.wizard_state_json)
      : row.wizard_state_json;
  const reportData =
    typeof row.report_data_json === "string"
      ? JSON.parse(row.report_data_json)
      : row.report_data_json;

  return NextResponse.json({
    report: {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      reportType: row.report_type,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      wizardState,
      reportData,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    },
  });
}

/** PATCH /api/saved-reports/[id] — rename a report (title only). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { id } = await params;
  const rows = await sql`
    UPDATE saved_reports
    SET title = ${title}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, title, updated_at
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const row = rows[0] as Record<string, unknown>;
  return NextResponse.json({
    report: {
      id: row.id,
      title: row.title,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    },
  });
}

/** DELETE /api/saved-reports/[id] — delete an owned report. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const rows = await sql`
    DELETE FROM saved_reports
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
