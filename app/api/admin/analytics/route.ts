import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureReportEventsTable } from "@/lib/server-analytics";

async function safeCount(sql: NonNullable<ReturnType<typeof getSQL>>, query: "users" | "saved_reports" | "business_projects" | "report_leads") {
  try {
    if (query === "users") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM users`;
      return Number(rows[0]?.count ?? 0);
    }
    if (query === "saved_reports") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM saved_reports`;
      return Number(rows[0]?.count ?? 0);
    }
    if (query === "business_projects") {
      const rows = await sql`SELECT COUNT(*)::int AS count FROM business_projects`;
      return Number(rows[0]?.count ?? 0);
    }
    const rows = await sql`SELECT COUNT(*)::int AS count FROM report_leads`;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const token = process.env.ANALYTICS_ADMIN_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "ANALYTICS_ADMIN_TOKEN is not configured" },
      { status: 503 }
    );
  }

  const provided =
    req.headers.get("x-analytics-token") || req.nextUrl.searchParams.get("token");
  if (provided !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Ensures the event table exists before aggregate reads.
  await ensureReportEventsTable();

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [eventsByType, eventsByDay] = await Promise.all([
    sql`
      SELECT event_type, COUNT(*)::int AS count
      FROM report_events
      WHERE created_at >= ${since}
      GROUP BY event_type
      ORDER BY count DESC, event_type ASC
    `,
    sql`
      SELECT created_at::date AS day, event_type, COUNT(*)::int AS count
      FROM report_events
      WHERE created_at >= ${since}
      GROUP BY created_at::date, event_type
      ORDER BY day DESC, event_type ASC
    `,
  ]);

  const [users, savedReports, businessProjects, reportLeads] = await Promise.all([
    safeCount(sql, "users"),
    safeCount(sql, "saved_reports"),
    safeCount(sql, "business_projects"),
    safeCount(sql, "report_leads"),
  ]);

  return NextResponse.json({
    windowDays: days,
    since,
    eventsByType,
    eventsByDay,
    lifetime: {
      users,
      savedReports,
      businessProjects,
      reportLeads,
    },
  });
}
