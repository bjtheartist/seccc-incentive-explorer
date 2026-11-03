import { NextRequest, NextResponse } from "next/server";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import { isInvestmentShareConfigured } from "@/lib/investment-share-session";
import {
  InvestmentShareLinkStorageUnavailableError,
  createInvestmentShareLink,
  normalizeInvestmentShareLinkExpiryDays,
  normalizeInvestmentShareLinkLabel,
} from "@/lib/investment-share-links-storage";

export const runtime = "nodejs";

export function investmentShareLinkUrl(origin: string, token: string): string {
  return new URL(`/investment/share/${token}`, origin).toString();
}

/** Mint a partner share link. Returns the full URL exactly once; only its hash is stored. */
export async function POST(request: NextRequest) {
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
  if (!isInvestmentShareConfigured()) {
    return NextResponse.json(
      { error: "Set AUTH_SECRET before creating share links" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const label = normalizeInvestmentShareLinkLabel(body.label);
  if (!label) {
    return NextResponse.json(
      { error: "Give the link a label of 2 to 160 characters (who it is for)." },
      { status: 400 },
    );
  }
  const expiresInDays = normalizeInvestmentShareLinkExpiryDays(body.expiresInDays);
  if (!expiresInDays) {
    return NextResponse.json({ error: "Choose one of the listed expiry windows." }, { status: 400 });
  }

  try {
    const { record, token } = await createInvestmentShareLink({ label, expiresInDays });
    return NextResponse.json(
      {
        id: record.id,
        label: record.label,
        expiresAt: record.expiresAt,
        url: investmentShareLinkUrl(request.nextUrl.origin, token),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InvestmentShareLinkStorageUnavailableError) {
      return NextResponse.json({ error: "Share-link storage is unavailable" }, { status: 503 });
    }
    console.error("Investment share link creation failed:", error);
    return NextResponse.json({ error: "Could not create the share link" }, { status: 500 });
  }
}
