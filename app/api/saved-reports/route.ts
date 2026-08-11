import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import { buildChecklist, isGoalType, type SavedReportSummary } from "@/lib/workspace";
import { stampReportSchemaVersion } from "@/lib/report-schema";

function toSummary(row: Record<string, unknown>): SavedReportSummary {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    title: String(row.title),
    reportType: String(row.report_type),
    address: row.address ? String(row.address) : null,
    lat: typeof row.lat === "number" ? row.lat : row.lat ? Number(row.lat) : null,
    lon: typeof row.lon === "number" ? row.lon : row.lon ? Number(row.lon) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const rows = await sql`
    SELECT id, project_id, title, report_type, address, lat, lon, created_at, updated_at
    FROM saved_reports
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ reports: rows.map((row) => toSummary(row as Record<string, unknown>)) });
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const rawReportData = body.reportData;
  if (!rawReportData || typeof rawReportData !== "object" || Array.isArray(rawReportData)) {
    return NextResponse.json({ error: "reportData is required" }, { status: 400 });
  }

  // Stamp the persisted-shape version on the way in, so the load path can tell
  // this row apart from everything saved before versioning existed.
  const reportData = stampReportSchemaVersion(rawReportData as Record<string, unknown>);

  const wizardState = body.wizardState && typeof body.wizardState === "object"
    ? body.wizardState
    : {};
  const metadata = "metadata" in reportData && reportData.metadata
    ? (reportData.metadata as Record<string, unknown>)
    : {};

  let projectId = typeof body.projectId === "string" ? body.projectId : null;

  if (!projectId) {
    const goalType = body.goalType;
    if (!isGoalType(goalType)) {
      return NextResponse.json({ error: "Valid goalType is required" }, { status: 400 });
    }

    const checklist = buildChecklist(goalType);
    const projectRows = await sql`
      INSERT INTO business_projects (
        user_id, goal_type, address, lat, lon, industry, budget_range, checklist_json
      )
      VALUES (
        ${userId},
        ${goalType},
        ${metadata.address || body.address || null},
        ${metadata.lat ?? body.lat ?? null},
        ${metadata.lon ?? body.lon ?? null},
        ${(wizardState as Record<string, unknown>).industry || null},
        ${(wizardState as Record<string, unknown>).budgetRange || null},
        ${JSON.stringify(checklist)}::jsonb
      )
      RETURNING id
    `;
    projectId = String(projectRows[0].id);
  } else {
    const ownedProject = await sql`
      SELECT id FROM business_projects
      WHERE id = ${projectId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (ownedProject.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  const title = typeof body.title === "string"
    ? body.title
    : typeof (reportData as Record<string, unknown>).title === "string"
      ? String((reportData as Record<string, unknown>).title)
      : "Saved Incentive Report";
  const reportType = typeof (reportData as Record<string, unknown>).reportType === "string"
    ? String((reportData as Record<string, unknown>).reportType)
    : "site-incentives";

  const rows = await sql`
    INSERT INTO saved_reports (
      user_id, project_id, title, report_type, address, lat, lon, wizard_state_json, report_data_json
    )
    VALUES (
      ${userId},
      ${projectId},
      ${title},
      ${reportType},
      ${metadata.address || body.address || null},
      ${metadata.lat ?? body.lat ?? null},
      ${metadata.lon ?? body.lon ?? null},
      ${JSON.stringify(wizardState)}::jsonb,
      ${JSON.stringify(reportData)}::jsonb
    )
    RETURNING id, project_id, title, report_type, address, lat, lon, created_at, updated_at
  `;

  return NextResponse.json({ report: toSummary(rows[0] as Record<string, unknown>) }, { status: 201 });
}
