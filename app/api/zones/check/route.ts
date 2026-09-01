import { NextRequest, NextResponse } from "next/server";
import { checkStaticZones, resolveZonesAtPoint } from "@/lib/zones-check";

/**
 * Request ceiling (30s). R2 finding 8: this route sits on the report pathway
 * and had no `maxDuration`, so it ran under the platform default with no
 * declared bound of its own.
 *
 * A PostGIS zone check across every configured layer, falling back to
 * loading and searching static GeoJSON zone files when the DB is absent.
 */
export const maxDuration = 30;

export const runtime = "nodejs";

/**
 * GET /api/zones/check?lat=&lon=
 *
 * Returns which incentive zones cover the given point. The point-in-zone logic
 * lives in lib/zones-check.ts so the read-only Site Concierge tool can reuse
 * the exact same resolution. Repairs source polygons at query time so one
 * malformed geometry cannot break the lookup.
 */
export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "lat and lon are required" },
      { status: 400 }
    );
  }

  try {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return NextResponse.json(
        { error: "lat and lon must be valid numbers" },
        { status: 400 }
      );
    }

    const results = await resolveZonesAtPoint(latNum, lonNum);

    return NextResponse.json(results, {
      headers: {
        "Cache-Control":
          "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("zone check API error:", err);
    try {
      const results = await checkStaticZones(parseFloat(lat), parseFloat(lon));
      return NextResponse.json(results);
    } catch (fallbackErr) {
      console.error("zone check static fallback error:", fallbackErr);
      return NextResponse.json(
        { error: "Zone check failed" },
        { status: 500 }
      );
    }
  }
}
