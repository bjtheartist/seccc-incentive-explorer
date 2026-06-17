import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { getSQL } from "@/lib/db";
import {
  getAnalyticsDashboardData,
  isValidAnalyticsToken,
  normalizeAnalyticsWindow,
} from "@/lib/analytics-dashboard";

export async function GET(req: NextRequest) {
  const token = process.env.ANALYTICS_ADMIN_TOKEN;
  if (!isAnalyticsAdminConfigured()) {
    return NextResponse.json(
      { error: "Analytics admin auth is not configured" },
      { status: 503 }
    );
  }

  const provided =
    req.headers.get("x-analytics-token") || req.nextUrl.searchParams.get("token");
  const hasToken = isValidAnalyticsToken(provided, token);
  const hasSession = hasValidAnalyticsAdminSession(
    req.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value
  );
  if (!hasToken && !hasSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const data = await getAnalyticsDashboardData(sql, normalizeAnalyticsWindow(daysParam));

  return NextResponse.json(data);
}
