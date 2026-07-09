import { NextRequest, NextResponse } from "next/server";
import { getDistrictData, parseLatLon } from "@/lib/district-lookup";

/**
 * Queries political/tax district boundaries for a given lat/lon.
 *
 * Fires all 5 district queries in parallel via Promise.allSettled:
 * - Ward (Chicago Data Portal SODA)
 * - Commissioner District (Cook County ArcGIS politicalBoundary Layer 9)
 * - Congressional District (Cook County ArcGIS politicalBoundary Layer 13)
 * - State House District (Cook County ArcGIS politicalBoundary Layer 11)
 * - State Senate District (Cook County ArcGIS politicalBoundary Layer 12)
 *
 * GET /api/districts?lat=41.75&lon=-87.58
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=86400",
};

export async function GET(request: NextRequest) {
  const parsed = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getDistrictData(parsed.latNum, parsed.lonNum);
  return NextResponse.json(result, { headers: CDN_HEADERS });
}
