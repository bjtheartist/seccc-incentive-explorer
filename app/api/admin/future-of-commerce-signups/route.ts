import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { futureCommerceSignupsToCsv } from "@/lib/future-commerce-signup";
import {
  FutureCommerceSignupStorageUnavailableError,
  listFutureCommerceSignups,
} from "@/lib/future-commerce-signup-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAnalyticsAdminConfigured()) {
    return NextResponse.json(
      { error: "Admin access is not configured" },
      { status: 503 },
    );
  }

  const hasSession = hasValidAnalyticsAdminSession(
    request.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value,
  );
  if (!hasSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await listFutureCommerceSignups(10_000);
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const csv = futureCommerceSignupsToCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition":
            'attachment; filename="future-of-commerce-email-list.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      { count: rows.length, signups: rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof FutureCommerceSignupStorageUnavailableError) {
      return NextResponse.json(
        { error: "Signup storage is not configured" },
        { status: 503 },
      );
    }
    console.error("Future of Commerce signup export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
