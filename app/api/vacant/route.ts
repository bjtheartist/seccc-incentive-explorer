import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { createHash } from "crypto";
import { getSQL } from "@/lib/db";
import { cached, roundCoord } from "@/lib/redis";
import type {
  VacancyFeatureCollection,
} from "@/lib/drawn-area-vacancy";

/**
 * Viewport-based vacant property API.
 *
 * GET /api/vacant?bounds=west,south,east,north&type=vacant_land&limit=500
 * GET /api/vacant?communityArea=Near%20West%20Side
 *
 * Returns GeoJSON FeatureCollection with zone_matches in feature properties.
 * Database responses use the latest queried `updated_at` for `meta.asOf`.
 * Static fallback responses are always marked partial and use the export's
 * `generatedAt` only when the file actually provides it.
 */

const CDN_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

type CommunityAreaBoundary = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  GeoJSON.GeoJsonProperties
>;

type VacancyRow = {
  id: unknown;
  source: unknown;
  address: unknown;
  lat: number;
  lon: number;
  property_type: unknown;
  ward: unknown;
  community_area: unknown;
  zoning_class: unknown;
  square_feet: unknown;
  status: unknown;
  zone_matches: unknown;
  incentive_count: unknown;
  owner_name: unknown;
  owner_type: unknown;
  source_as_of?: unknown;
};

type StaticVacancyFeatureCollection = GeoJSON.FeatureCollection & {
  generatedAt?: unknown;
};

function normalizeCommunityAreaName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function timestampOrNull(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") return null;
  const timestamp = value.trim();
  return timestamp === "" ? null : timestamp;
}

function latestTimestamp(values: unknown[]): string | null {
  let latest: string | null = null;
  let latestMillis = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const timestamp = timestampOrNull(value);
    if (!timestamp) continue;
    const millis = Date.parse(timestamp);
    if (Number.isFinite(millis) && millis > latestMillis) {
      latest = timestamp;
      latestMillis = millis;
    } else if (latest === null) {
      latest = timestamp;
    }
  }

  return latest;
}

async function loadCommunityAreaBoundary(
  request: NextRequest,
  communityArea: string
): Promise<CommunityAreaBoundary | null> {
  try {
    const boundaryUrl = new URL("/data/community-areas.geojson", request.nextUrl.origin);
    const res = await fetch(boundaryUrl.toString());
    if (!res.ok) return null;

    const data = (await res.json()) as GeoJSON.FeatureCollection;
    const requested = normalizeCommunityAreaName(communityArea);
    const feature = data.features.find((f) => {
      const name = normalizeCommunityAreaName(f.properties?.community);
      return name === requested;
    });

    if (
      !feature ||
      (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")
    ) {
      return null;
    }

    return feature as CommunityAreaBoundary;
  } catch {
    return null;
  }
}

function rowsToGeoJSON(rows: VacancyRow[]): GeoJSON.FeatureCollection {
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

function buildDatabaseResponse(
  rows: VacancyRow[],
  limit: number,
): VacancyFeatureCollection {
  // The database query asks for one extra row so truncation is observed.
  const potentiallyTruncated = rows.length > limit;
  const collection = rowsToGeoJSON(rows.slice(0, limit));
  const asOf = latestTimestamp(rows.map((row) => row.source_as_of));

  return {
    ...collection,
    meta: {
      sourceMode: "database",
      sourcePath: "database:vacant_properties",
      asOf,
      asOfBasis: asOf ? "latest_queried_row_updated_at" : null,
      returnedCount: collection.features.length,
      configuredLimit: limit,
      queryLimit: limit + 1,
      coverageStatus: potentiallyTruncated ? "truncated" : "complete",
      potentiallyTruncated,
      fallbackReason: null,
    },
  };
}

function buildStaticFallbackResponse(
  features: GeoJSON.Feature[],
  limit: number,
  generatedAt: unknown,
  fallbackReason: "database_unavailable" | "database_query_failed",
): VacancyFeatureCollection {
  const potentiallyTruncated = features.length > limit;
  const returnedFeatures = features.slice(0, limit);
  const asOf = timestampOrNull(generatedAt);

  return {
    type: "FeatureCollection",
    features: returnedFeatures,
    meta: {
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOf,
      asOfBasis: asOf ? "static_export_generated_at" : null,
      returnedCount: returnedFeatures.length,
      configuredLimit: limit,
      queryLimit: null,
      coverageStatus: "partial",
      potentiallyTruncated,
      fallbackReason,
    },
  };
}

export async function GET(request: NextRequest) {
  const boundsParam = request.nextUrl.searchParams.get("bounds");
  const polygonParam = request.nextUrl.searchParams.get("polygon");
  const communityAreaParam =
    request.nextUrl.searchParams.get("communityArea")?.trim() || null;
  const typeFilter = request.nextUrl.searchParams.get("type");
  const sourceFilter = request.nextUrl.searchParams.get("source");
  const ownerTypeFilter = request.nextUrl.searchParams.get("ownerType");
  const limitParam = request.nextUrl.searchParams.get("limit");

  if (!boundsParam && !polygonParam && !communityAreaParam) {
    return NextResponse.json(
      { error: "bounds, polygon, or communityArea parameter is required" },
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

  // Polygon/community mode: higher export cap. Bounds mode: default 500, max 2000.
  const limit = polygonParam || communityAreaParam
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
  const communityHash = communityAreaParam
    ? createHash("sha256").update(communityAreaParam.toLowerCase()).digest("hex").slice(0, 16)
    : null;
  const cacheKey = communityAreaParam
    ? `vacant:community-boundary:v2:${communityHash}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`
    : polygonParam
    ? `vacant:poly:v2:${polygonHash}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`
    : `vacant:v2:${roundCoord(west)}:${roundCoord(south)}:${roundCoord(east)}:${roundCoord(north)}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`;

  const sql = getSQL();

  const result = await cached<VacancyFeatureCollection>(cacheKey, 86400, async () => {
    const communityAreaBoundary = communityAreaParam
      ? await loadCommunityAreaBoundary(request, communityAreaParam)
      : null;

    let fallbackReason: "database_unavailable" | "database_query_failed" =
      sql ? "database_query_failed" : "database_unavailable";

    // Try database first
    if (sql) {
      try {
        if (communityAreaParam) {
          const rows = communityAreaBoundary
            ? await sql`
              SELECT id, source, address, lat, lon, property_type, ward, community_area,
                     zoning_class, square_feet, status, zone_matches, incentive_count,
                     owner_name, owner_type,
                     updated_at::text AS source_as_of
              FROM vacant_properties
              WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(communityAreaBoundary.geometry)}), 4326)::geography)
                AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
                AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
                AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
              ORDER BY incentive_count DESC, address ASC
              LIMIT ${limit + 1}
            `
            : await sql`
              SELECT id, source, address, lat, lon, property_type, ward, community_area,
                     zoning_class, square_feet, status, zone_matches, incentive_count,
                     owner_name, owner_type,
                     updated_at::text AS source_as_of
              FROM vacant_properties
              WHERE lower(community_area) = lower(${communityAreaParam})
                AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
                AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
                AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
              ORDER BY incentive_count DESC, address ASC
              LIMIT ${limit + 1}
            `;

          return buildDatabaseResponse(rows as VacancyRow[], limit);
        }

        if (polygonParam) {
          const polygonJson = polygonParam;
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count,
                   owner_name, owner_type,
                   updated_at::text AS source_as_of
            FROM vacant_properties
            WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${polygonJson}), 4326)::geography)
              AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
              AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
              AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
            ORDER BY incentive_count DESC
            LIMIT ${limit + 1}
          `;

          return buildDatabaseResponse(rows as VacancyRow[], limit);
        }

        const rows = await sql`
          SELECT id, source, address, lat, lon, property_type, ward, community_area,
                 zoning_class, square_feet, status, zone_matches, incentive_count,
                 owner_name, owner_type,
                 updated_at::text AS source_as_of
          FROM vacant_properties
          WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
            AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
            AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
            AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
          ORDER BY incentive_count DESC
          LIMIT ${limit + 1}
        `;

        return buildDatabaseResponse(rows as VacancyRow[], limit);
      } catch (err) {
        console.warn("[vacant] DB query failed, falling back to static:", err);
        fallbackReason = "database_query_failed";
      }
    }

    // Fallback: load and filter static file
    try {
      const staticUrl = new URL("/data/vacant-properties.json", request.nextUrl.origin);
      const res = await fetch(staticUrl.toString());
      if (!res.ok) {
        return buildStaticFallbackResponse([], limit, null, fallbackReason);
      }
      const data = (await res.json()) as StaticVacancyFeatureCollection;
      const communityAreaFilter = communityAreaParam?.toLowerCase();

      const filtered = data.features.filter((f) => {
        if (f.geometry.type !== "Point") return false;

        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        if (communityAreaBoundary) {
          const point = turf.point([lng, lat]);
          if (!turf.booleanPointInPolygon(point, communityAreaBoundary)) return false;
        } else if (
          communityAreaFilter &&
          String(f.properties?.communityArea ?? "").toLowerCase() !== communityAreaFilter
        ) {
          return false;
        }

        if (parsedPolygon) {
          const point = turf.point([lng, lat]);
          if (!turf.booleanPointInPolygon(point, parsedPolygon)) return false;
        } else if (boundsParam) {
          if (lng < west || lng > east || lat < south || lat > north) return false;
        }
        if (typeFilter && f.properties?.propertyType !== typeFilter) return false;
        if (sourceFilter && f.properties?.source !== sourceFilter) return false;
        if (ownerTypeFilter && f.properties?.ownerType !== ownerTypeFilter) return false;
        return true;
      });

      return buildStaticFallbackResponse(
        filtered,
        limit,
        data.generatedAt,
        fallbackReason,
      );
    } catch {
      return buildStaticFallbackResponse([], limit, null, fallbackReason);
    }
  });

  return NextResponse.json(result, { headers: CDN_HEADERS });
}
