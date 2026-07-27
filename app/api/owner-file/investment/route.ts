import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { ANALYTICS_ADMIN_COOKIE } from "@/lib/analytics-admin-auth";
import { INVESTMENT_SOURCES, filterInvestmentBySources, loadCommunityInvestment } from "@/lib/community-investment";

// A valid analytics admin session also satisfies this gate (single sign-on
// — see lib/owner-files-admin-auth.ts module doc). Identical auth check to
// app/api/owner-file/geo/route.ts.
function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(
    req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value,
    req.cookies.get(ANALYTICS_ADMIN_COOKIE)?.value
  );
}

const VALID_SOURCES = new Set<string>(INVESTMENT_SOURCES);

/**
 * GET /api/owner-file/investment?source=cdg,foundation — the private Community
 * Investment dataset (data/private/community-investment.json), gated behind the
 * same Owner Files admin session as the other owner-file routes. The records
 * carry grantee/business names + street addresses (more sensitive than the
 * public vacant-properties layer), so this is never cached beyond the request
 * and never served unauthenticated.
 *
 * `source` is an optional comma-separated filter over the six investment
 * sources (invalid entries dropped); omitted or empty returns every record.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = loadCommunityInvestment();
  if (!data) {
    return NextResponse.json(
      { error: "Community Investment export has not been generated yet" },
      { status: 503 }
    );
  }

  const sourceParam = req.nextUrl.searchParams.get("source");
  const sources = sourceParam
    ? sourceParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => VALID_SOURCES.has(s))
    : null;

  const filtered = filterInvestmentBySources(data, sources);
  return NextResponse.json(filtered, { headers: { "Cache-Control": "private, no-store" } });
}
