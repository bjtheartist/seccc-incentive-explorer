import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_FILES_ADMIN_COOKIE,
  hasValidOwnerFilesAdminSession,
  isOwnerFilesAdminConfigured,
} from "@/lib/owner-files-admin-auth";
import { filterOwnerClusterGeoByZips, loadOwnerClusterGeoFile } from "@/lib/owner-cluster-geo";

function isAuthorized(req: NextRequest): boolean {
  return hasValidOwnerFilesAdminSession(req.cookies.get(OWNER_FILES_ADMIN_COOKIE)?.value);
}

/**
 * GET /api/owner-file/geo?zips=60617,60624 — the private per-parcel
 * ownership-cluster GeoJSON (data/private/owner-clusters-geo.json), gated
 * behind the same Owner Files admin session as the dossier routes
 * (app/api/owner-file/[clusterKey]/route.ts). Backs the admin-gated map
 * layer toggle and the admin-only report ownership panel — an Owner File is
 * a named-entity dossier, more sensitive than the public vacant-properties
 * layer, so this is never cached beyond the request and never served
 * unauthenticated.
 *
 * `zips` is an optional comma-separated filter (5-digit ZIPs only, invalid
 * entries dropped); omitted or empty returns every ZIP in the export.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerFilesAdminConfigured()) {
    return NextResponse.json({ error: "Owner Files admin auth is not configured" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fc = loadOwnerClusterGeoFile();
  if (!fc) {
    return NextResponse.json(
      { error: "Ownership-cluster geo export has not been generated yet" },
      { status: 503 }
    );
  }

  const zipsParam = req.nextUrl.searchParams.get("zips");
  const zips = zipsParam
    ? zipsParam
        .split(",")
        .map((z) => z.trim())
        .filter((z) => /^\d{5}$/.test(z))
    : null;

  const filtered = filterOwnerClusterGeoByZips(fc, zips);
  return NextResponse.json(filtered, { headers: { "Cache-Control": "private, no-store" } });
}
