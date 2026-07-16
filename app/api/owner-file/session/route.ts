import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value);
}

/**
 * GET /api/owner-file/session — cheap client-side probe for "is this browser
 * currently an authenticated Owner Files admin?" No body either way — callers
 * only need the status code. Used by the map's admin-gated ownership-cluster
 * layer toggle (components/map/MapView.tsx) and the report's admin-only
 * ownership panel (components/report/AdminOwnershipPanel.tsx) to decide
 * whether to render the admin affordance at all, without fetching or
 * exposing any owner data up front.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerFilesAdminConfigured() || !isAuthorized(req)) {
    return new NextResponse(null, { status: 401 });
  }
  return new NextResponse(null, { status: 204 });
}
