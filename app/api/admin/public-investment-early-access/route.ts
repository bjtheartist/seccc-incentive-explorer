import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { publicInvestmentEarlyAccessToCsv } from "@/lib/public-investment-early-access";
import {
  listPublicInvestmentEarlyAccessRequests,
  PublicInvestmentEarlyAccessStorageUnavailableError,
} from "@/lib/public-investment-early-access-storage";

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
    const rows = await listPublicInvestmentEarlyAccessRequests();
    if (request.nextUrl.searchParams.get("format") === "csv") {
      return new NextResponse(publicInvestmentEarlyAccessToCsv(rows), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition":
            'attachment; filename="public-investment-early-access.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      { count: rows.length, signups: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PublicInvestmentEarlyAccessStorageUnavailableError) {
      return NextResponse.json({ error: "Signup storage is not configured" }, { status: 503 });
    }
    console.error("Public Investment early-access export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
