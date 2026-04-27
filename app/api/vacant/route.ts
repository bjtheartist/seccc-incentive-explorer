import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { createHash } from "crypto";
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
        ownerName: r.owner_name || null,
        ownerType: r.owner_type || null,
      },
    })),
  };
}

export async function GET(request: NextRequest) {
  const boundsParam = request.nextUrl.searchParams.get("bounds");
  const polygonParam = request.nextUrl.searchParams.get("polygon");
  const typeFilter = request.nextUrl.searchParams.get("type");
  const sourceFilter = request.nextUrl.searchParams.get("source");
  const ownerTypeFilter = request.nextUrl.searchParams.get("ownerType");
  const limitParam = request.nextUrl.searchParams.get("limit");

  if (!boundsParam && !polygonParam) {
    return NextResponse.json(
      { error: "bounds or polygon parameter is required" },
      { status: 400 }
    );
  }

  // Validate polygon JSON if provided
  let parsedPolygon: GeoJSON.Polygon | null = null;
  if (polygonParam) {
    try {
      const parsed = JSON.parse(polygonParam);
      if (parsed.type !== "Polygon" || !Array.isArray(parsed.coordinates)) {
        return NextResponse.json(
          { error: "polygon must be a GeoJSON Polygon geometry" },
          { status: 400 }
        );
      }
      parsedPolygon = parsed;
    } catch {
      return NextResponse.json(
        { error: "polygon must be valid JSON" },
        { status: 400 }
      );
    }
  }

  // Polygon mode: no limit (return all matching). Bounds mode: default 500, max 2000.
  const limit = polygonParam
    ? 10000
    : Math.min(parseInt(limitParam || "500", 10) || 500, 2000);

  let west = 0, south = 0, east = 0, north = 0;
  if (boundsParam) {
    const parts = boundsParam.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return NextResponse.json(
        { error: "bounds must be 4 comma-separated numbers: west,south,east,north" },
        { status: 400 }
      );
    }
    [west, south, east, north] = parts;
  }

  // Cache key
  const polygonHash = polygonParam
    ? createHash("sha256").update(polygonParam).digest("hex").slice(0, 16)
    : null;
  const cacheKey = polygonParam
    ? `vacant:poly:${polygonHash}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}`
    : `vacant:${roundCoord(west)}:${roundCoord(south)}:${roundCoord(east)}:${roundCoord(north)}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}`;

  const sql = getSQL();

  const result = await cached<GeoJSON.FeatureCollection>(cacheKey, 86400, async () => {
    // Try database first
    if (sql) {
      try {
        if (polygonParam) {
          const polygonJson = polygonParam;
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count,
                   owner_name, owner_type
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${polygonJson}), 4326)::geography)
              AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
              AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
              AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
            ORDER BY incentive_count DESC
            LIMIT ${limit}
          `;

          return rowsToGeoJSON(rows);
        }

        const rows = await sql`
          SELECT id, source, address, lat, lon, property_type, ward, community_area,
                 zoning_class, square_feet, status, zone_matches, incentive_count,
                 owner_name, owner_type
          FROM vacant_properties
          WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
            AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
            AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
            AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
          ORDER BY incentive_count DESC
          LIMIT ${limit}
        `;

        return rowsToGeoJSON(rows);
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
        if (parsedPolygon) {
          const point = turf.point([lng, lat]);
          if (!turf.booleanPointInPolygon(point, parsedPolygon)) return false;
        } else {
          if (lng < west || lng > east || lat < south || lat > north) return false;
        }
        if (typeFilter && f.properties?.propertyType !== typeFilter) return false;
        if (sourceFilter && f.properties?.source !== sourceFilter) return false;
        if (ownerTypeFilter && f.properties?.ownerType !== ownerTypeFilter) return false;
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
