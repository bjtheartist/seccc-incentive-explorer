import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

/**
 * GET /api/zones/check?lat=&lon=
 *
 * Returns which incentive zones contain the given point.
 * Uses PostGIS ST_Contains for spatial query against all zone geometries.
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

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const rows = await sql`
      SELECT zone_key, feature_name
      FROM zones
      WHERE ST_Contains(
        geom::geometry,
        ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)
      )
    `;

    const results = rows.map((r: Record<string, unknown>) => ({
      key: r.zone_key,
      name: r.feature_name || "",
    }));

    return NextResponse.json(results, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("zone check API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
