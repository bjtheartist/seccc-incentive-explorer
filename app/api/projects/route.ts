import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getCurrentUserId } from "@/lib/current-user";
import {
  buildChecklist,
  goalLabel,
  isGoalType,
  normalizeChecklist,
  type BusinessProject,
} from "@/lib/workspace";

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
    SELECT *
    FROM business_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;

  return NextResponse.json({ projects: rows.map((row) => toProject(row as ProjectRow)) });
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
  const goalType = body.goalType;
  if (!isGoalType(goalType)) {
    return NextResponse.json({ error: "Valid goalType is required" }, { status: 400 });
  }

  const checklist = body.checklist
    ? normalizeChecklist(body.checklist)
    : buildChecklist(goalType);

  const rows = await sql`
    INSERT INTO business_projects (
      user_id, goal_type, address, lat, lon, industry, budget_range, status, checklist_json
    )
    VALUES (
      ${userId},
      ${goalType},
      ${body.address || null},
      ${body.lat ?? null},
      ${body.lon ?? null},
      ${body.industry || null},
      ${body.budgetRange || null},
      ${body.status || "active"},
      ${JSON.stringify(checklist)}::jsonb
    )
    RETURNING *
  `;

  return NextResponse.json({ project: toProject(rows[0] as ProjectRow) }, { status: 201 });
}
