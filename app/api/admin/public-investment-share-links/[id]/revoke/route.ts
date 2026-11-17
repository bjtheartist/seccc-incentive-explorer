import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import {
  InvestmentShareLinkStorageUnavailableError,
  revokeInvestmentShareLink,
} from "@/lib/investment-share-links-storage";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

function redirect(request: NextRequest, key: "updated" | "error", value: string) {
  const url = new URL("/admin/public-investment-access", request.url);
  url.searchParams.set(key, value);
  url.hash = "share-links";
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  if (!isAnalyticsAdminConfigured()) {
    return NextResponse.json({ error: "Admin access is not configured" }, { status: 503 });
  }
  if (!hasValidAnalyticsAdminSession(request.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) return redirect(request, "error", "share-link-not-found");

  try {
    const record = await revokeInvestmentShareLink(id);
    if (!record) return redirect(request, "error", "share-link-not-found");
    return redirect(request, "updated", "share-link-revoked");
  } catch (error) {
    if (!(error instanceof InvestmentShareLinkStorageUnavailableError)) {
      console.error("Investment share link revocation failed:", error);
    }
    return redirect(request, "error", "share-link-storage");
  }
}
