import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { memCached, roundCoord } from "@/lib/redis";

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
    const rLat = roundCoord(parseFloat(lat));
    const rLon = roundCoord(parseFloat(lon));
    const cacheKey = `zones:check:${rLat}:${rLon}`;

    const results = await memCached(cacheKey, 604800, async () => {
      const rows = await sql`
        SELECT zone_key, feature_name
        FROM zones
        WHERE ST_Contains(
          geom::geometry,
          ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)
        )
      `;

      return rows.map((r: Record<string, unknown>) => ({
        key: r.zone_key,
        name: r.feature_name || "",
      }));
    });

    return NextResponse.json(results, {
      headers: {
        "Cache-Control":
          "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("zone check API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
