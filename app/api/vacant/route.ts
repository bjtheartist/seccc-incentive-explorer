import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { cached, roundCoord } from "@/lib/redis";

/**
 * Viewport-based vacant property API.
 *
 * GET /api/vacant?bounds=west,south,east,north&type=vacant_land&limit=500
 *
 * Returns GeoJSON FeatureCollection with zone_matches in feature properties.
 * Falls back to static file if DB is unavailable.
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsToGeoJSON(rows: any[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.lon, r.lat],
      },
      properties: {
        id: r.id,
        source: r.source,
        address: r.address,
        propertyType: r.property_type,
        ward: r.ward,
        communityArea: r.community_area,
        zoningClass: r.zoning_class,
        squareFeet: r.square_feet,
        status: r.status,
        zoneMatches:
          typeof r.zone_matches === "string"
            ? JSON.parse(r.zone_matches)
            : r.zone_matches,
        incentiveCount: r.incentive_count,
      },
    })),
  };
}

export async function GET(request: NextRequest) {
  const boundsParam = request.nextUrl.searchParams.get("bounds");
  const typeFilter = request.nextUrl.searchParams.get("type");
  const sourceFilter = request.nextUrl.searchParams.get("source");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(parseInt(limitParam || "500", 10) || 500, 2000);

  if (!boundsParam) {
    return NextResponse.json(
      { error: "bounds parameter is required (west,south,east,north)" },
      { status: 400 }
    );
  }

  const parts = boundsParam.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json(
      { error: "bounds must be 4 comma-separated numbers: west,south,east,north" },
      { status: 400 }
    );
  }

  const [west, south, east, north] = parts;

  // Round to 2 decimal places for cache key
  const cacheKey = `vacant:${roundCoord(west, 2)}:${roundCoord(south, 2)}:${roundCoord(east, 2)}:${roundCoord(north, 2)}:${typeFilter || "all"}:${sourceFilter || "all"}`;

  const sql = getSQL();

  const result = await cached<GeoJSON.FeatureCollection>(cacheKey, 86400, async () => {
    // Try database first
    if (sql) {
      try {
        // Use tagged template syntax for Neon driver
        if (typeFilter && sourceFilter) {
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
              AND property_type = ${typeFilter}
              AND source = ${sourceFilter}
            ORDER BY incentive_count DESC
            LIMIT ${limit}
          `;
          return rowsToGeoJSON(rows);
        } else if (typeFilter) {
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
              AND property_type = ${typeFilter}
            ORDER BY incentive_count DESC
            LIMIT ${limit}
          `;
          return rowsToGeoJSON(rows);
        } else if (sourceFilter) {
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
              AND source = ${sourceFilter}
            ORDER BY incentive_count DESC
            LIMIT ${limit}
          `;
          return rowsToGeoJSON(rows);
        } else {
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
            ORDER BY incentive_count DESC
            LIMIT ${limit}
          `;
          return rowsToGeoJSON(rows);
        }
      } catch (err) {
        console.warn("[vacant] DB query failed, falling back to static:", err);
      }
    }

    // Fallback: load and filter static file
    try {
      const staticUrl = new URL("/data/vacant-properties.json", request.nextUrl.origin);
      const res = await fetch(staticUrl.toString());
      if (!res.ok) return { type: "FeatureCollection" as const, features: [] };
      const data: GeoJSON.FeatureCollection = await res.json();

      const filtered = data.features.filter((f) => {
        if (f.geometry.type !== "Point") return false;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        if (lng < west || lng > east || lat < south || lat > north) return false;
        if (typeFilter && f.properties?.propertyType !== typeFilter) return false;
        if (sourceFilter && f.properties?.source !== sourceFilter) return false;
        return true;
      });

      return {
        type: "FeatureCollection" as const,
        features: filtered.slice(0, limit),
      };
    } catch {
      return { type: "FeatureCollection" as const, features: [] };
    }
  });

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
