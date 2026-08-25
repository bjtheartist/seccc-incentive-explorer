import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { shortlistAccessSignupsToCsv } from "@/lib/shortlist-access";
import {
  listShortlistAccessSignups,
  ShortlistAccessStorageUnavailableError,
} from "@/lib/shortlist-access-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAnalyticsAdminConfigured()) {
    return NextResponse.json({ error: "Admin access is not configured" }, { status: 503 });
  }

  const hasSession = hasValidAnalyticsAdminSession(
    request.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );
  if (!hasSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await listShortlistAccessSignups();
    if (request.nextUrl.searchParams.get("format") === "csv") {
      return new NextResponse(shortlistAccessSignupsToCsv(rows), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="site-shortlist-signups.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      { count: rows.length, signups: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ShortlistAccessStorageUnavailableError) {
      return NextResponse.json({ error: "Signup storage is not configured" }, { status: 503 });
    }
    console.error("Shortlist signup export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
