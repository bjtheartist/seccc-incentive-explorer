import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import {
  goalLabel,
  isGoalType,
  normalizeChecklist,
  type BusinessProject,
} from "@/lib/workspace";

type Params = { params: Promise<{ id: string }> };
type ProjectRow = Record<string, unknown>;

function toProject(row: ProjectRow): BusinessProject {
  const goalType = String(row.goal_type) as BusinessProject["goalType"];
  const checklist =
    typeof row.checklist_json === "string"
      ? JSON.parse(row.checklist_json)
      : row.checklist_json;

  return {
    id: String(row.id),
    goalType,
    goalLabel: goalLabel(goalType),
    address: row.address ? String(row.address) : null,
    lat: typeof row.lat === "number" ? row.lat : row.lat ? Number(row.lat) : null,
    lon: typeof row.lon === "number" ? row.lon : row.lon ? Number(row.lon) : null,
    industry: row.industry ? String(row.industry) : null,
    budgetRange: row.budget_range ? String(row.budget_range) : null,
    status: String(row.status || "active"),
    checklist: normalizeChecklist(checklist),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function loadProject(id: string, userId: string) {
  const sql = getSQL();
  if (!sql) return { error: "Database not configured" as const };

  const rows = await sql`
    SELECT *
    FROM business_projects
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;

  if (rows.length === 0) return { project: null };
  return { project: toProject(rows[0] as ProjectRow) };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;
  const result = await loadProject(id, userId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  if (!result.project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const sql = getSQL()!;
  const reportRows = await sql`
    SELECT id, project_id, title, report_type, address, lat, lon, created_at, updated_at
    FROM saved_reports
    WHERE project_id = ${id} AND user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({
    project: result.project,
    reports: reportRows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      reportType: row.report_type,
      address: row.address,
      lat: row.lat,
      lon: row.lon,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await sql`
    SELECT *
    FROM business_projects
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const current = existing[0] as ProjectRow;
  const nextGoalType = isGoalType(body.goalType) ? body.goalType : String(current.goal_type);
  const currentChecklist =
    typeof current.checklist_json === "string"
      ? JSON.parse(current.checklist_json)
      : current.checklist_json;
  const checklist =
    body.checklist !== undefined
      ? normalizeChecklist(body.checklist)
      : normalizeChecklist(currentChecklist);

  const rows = await sql`
    UPDATE business_projects
    SET
      goal_type = ${nextGoalType},
      status = ${body.status || current.status || "active"},
      checklist_json = ${JSON.stringify(checklist)}::jsonb,
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;

  return NextResponse.json({ project: toProject(rows[0] as ProjectRow) });
}
