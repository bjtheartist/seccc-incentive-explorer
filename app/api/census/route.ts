import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { memCached, roundCoord } from "@/lib/redis";

/**
 * GET /api/census?lat=&lon=
 *
 * Returns census tract data (ACS estimates) for a given lat/lon.
 * Uses PostGIS to find the enclosing census tract.
 * Returns null when DATABASE_URL is absent so local/static mode can proceed.
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
    return NextResponse.json(null, {
      headers: {
        "Cache-Control":
          "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }

  try {
    const rLat = roundCoord(parseFloat(lat));
    const rLon = roundCoord(parseFloat(lon));
    const cacheKey = `census:${rLat}:${rLon}`;

    const data = await memCached(cacheKey, 2592000, async () => {
      const rows = await sql`
        SELECT tract_id, median_income, median_home_value,
               population, walk_score
        FROM census_tracts
        WHERE ST_Contains(
          geom::geometry,
          ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)
        )
        LIMIT 1
      `;

      if (rows.length === 0) {
        return null;
      }

      const r = rows[0] as Record<string, unknown>;
      return {
        tractId: r.tract_id,
        medianIncome: r.median_income,
        medianHomeValue: r.median_home_value,
        population: r.population,
        walkScore: r.walk_score,
      };
    });

    return NextResponse.json(data, {
      headers: {
        "Cache-Control":
          "public, s-maxage=2592000, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("census API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
