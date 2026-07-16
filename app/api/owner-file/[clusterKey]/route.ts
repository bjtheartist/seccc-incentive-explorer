import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { getOwnerFile } from "@/lib/owner-file";

type Params = { params: Promise<{ clusterKey: string }> };

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value);
}

/**
 * GET /api/owner-file/[clusterKey]?zip= — the merged Owner File view model
 * (cluster + verification + resolved confidence tier + notes + outreach).
 * Gated behind the Owner Files admin session (lib/owner-files-admin-auth.ts)
 * — an Owner File is a named-entity dossier, more sensitive than the
 * unlisted-but-open /corridors/[zip] page.
 */
export async function GET(req: NextRequest, { params }: Params) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clusterKey } = await params;
  const zip = req.nextUrl.searchParams.get("zip");
  if (!zip || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ error: "zip must be a 5-digit ZIP code" }, { status: 400 });
  }

  const ownerFile = await getOwnerFile(zip, clusterKey);
  if (!ownerFile) {
    return NextResponse.json(
      { error: "No owner cluster found for this zip/clusterKey" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ownerFile }, { headers: { "Cache-Control": "no-store" } });
}
