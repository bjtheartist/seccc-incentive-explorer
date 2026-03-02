import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { cached, roundCoord } from "@/lib/redis";

/**
 * GET /api/businesses?search=&lat=&lon=&radius=
 *
 * Business list with optional full-text search or proximity query.
 * Falls through to 503 if DATABASE_URL is not set.
 */
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("search");
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");
  const radius = request.nextUrl.searchParams.get("radius") || "1000";

  const sql = getSQL();
  if (!sql) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  try {
    const rLat = lat ? roundCoord(parseFloat(lat)) : "";
    const rLon = lon ? roundCoord(parseFloat(lon)) : "";
    const cacheKey = `businesses:${search || ""}:${rLat}:${rLon}:${radius}`;

    const businesses = await cached(cacheKey, 43200, async () => {
      let rows;

      if (search) {
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data
          FROM businesses
          WHERE search_vector @@ plainto_tsquery('english', ${search})
             OR name ILIKE ${"%" + search + "%"}
             OR address ILIKE ${"%" + search + "%"}
          ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${search})) DESC
          LIMIT 50
        `;
      } else if (lat && lon) {
        const radiusMeters = parseInt(radius, 10) || 1000;
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data,
                 ST_Distance(geom, ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)::geography) AS distance_m
          FROM businesses
          WHERE ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)::geography,
            ${radiusMeters}
          )
          ORDER BY distance_m
          LIMIT 50
        `;
      } else {
        rows = await sql`
          SELECT id, name, address, city, state, zip, lat, lon,
                 phone, website, category, incentive_count,
                 zone_data
          FROM businesses
          ORDER BY name
          LIMIT 500
        `;
      }

      return rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
        lat: r.lat,
        lon: r.lon,
        phone: r.phone || "",
        website: r.website || "",
        category: r.category || "",
        incentiveCount: r.incentive_count || 0,
        zones: typeof r.zone_data === "string" ? JSON.parse(r.zone_data) : (r.zone_data || {}),
      }));
    });

    return NextResponse.json(businesses, {
      headers: {
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("businesses API error:", err);
    return NextResponse.json(
      { error: "Database query failed" },
      { status: 500 }
    );
  }
}
