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
