import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { createHash } from "crypto";
import { getSQL } from "@/lib/db";
import { cached, roundCoord } from "@/lib/redis";
import {
  DRAWN_AREA_VACANCY_LIMIT,
  type VacancyFeatureCollection,
} from "@/lib/drawn-area-vacancy";
import {
  buildVacancyFreshnessMetadata,
  canonicalVacancyType,
  chicagoCalendarDay,
  classifyVacancyFreshness,
  isVacancySourceTypePair,
  VACANCY_FRESHNESS_POLICY_VERSION,
} from "@/lib/vacancy-evidence";
import {
  canonicalizeVacancyZoneMatches,
  isVacancyZoneMatchInput,
} from "@/lib/vacancy-zone-matches";
import {
  notRequestedLicenseScreening,
  screenVacancyLicenseConflicts,
  VACANCY_LICENSE_POLICY_VERSION,
} from "@/lib/vacancy-license-screening";

/**
 * Viewport-based vacant property API.
 *
 * GET /api/vacant?bounds=west,south,east,north&type=vacant_land&limit=500
 * GET /api/vacant?communityArea=Near%20West%20Side
 *
 * Returns GeoJSON FeatureCollection with zone_matches in feature properties.
 * Database responses expose Explorer refresh time separately from the original
 * per-record 311 source date. `updated_at` is never a report date.
 * Static fallback responses are always marked partial and use the export's
 * `generatedAt` only when the file actually provides it.
 */

const BASE_CACHE_TTL_SECONDS = 86_400;
const LICENSE_CACHE_TTL_SECONDS = 21_600;
const DEGRADED_CACHE_TTL_SECONDS = 300;

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
  source_record_date?: unknown;
  explorer_refreshed_at?: unknown;
};

type StaticVacancyFeatureCollection = GeoJSON.FeatureCollection & {
  generatedAt?: unknown;
};

function hasTransientVacancyDegradation(result: VacancyFeatureCollection): boolean {
  const screening = result.meta.licenseScreening;
  return Boolean(
    result.meta.fallbackReason ||
      screening.status === "unavailable" ||
      screening.partialReasons.includes("source_batch_failure"),
  );
}

function vacancyResponseCacheControl(
  result: VacancyFeatureCollection,
  polygonMode: boolean,
): string {
  if (hasTransientVacancyDegradation(result)) {
    return `public, s-maxage=${DEGRADED_CACHE_TTL_SECONDS}, stale-while-revalidate=0`;
  }
  if (polygonMode) {
    return `public, s-maxage=${LICENSE_CACHE_TTL_SECONDS}, stale-while-revalidate=0`;
  }
  return `public, s-maxage=${BASE_CACHE_TTL_SECONDS}, stale-while-revalidate=${BASE_CACHE_TTL_SECONDS}`;
}

function normalizeCommunityAreaName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function timestampOrNull(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value !== "string") return null;
  const timestamp = value.trim();
  if (timestamp === "") return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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

function enrichFeatureEvidence(
  feature: GeoJSON.Feature,
  referenceDate: string,
  fallbackExplorerRefreshedAt: unknown = null,
): GeoJSON.Feature {
  const properties = { ...(feature.properties ?? {}) };
  if (!isVacancySourceTypePair(properties.source, properties.propertyType)) {
    throw new Error("Vacancy source/property type contract mismatch");
  }
  if (!isVacancyZoneMatchInput(properties.zoneMatches)) {
    throw new Error("Vacancy zone-match contract mismatch");
  }
  const sourceRecordDate = timestampOrNull(properties.sourceRecordDate);
  const explorerRefreshedAt =
    timestampOrNull(properties.explorerRefreshedAt) ??
    timestampOrNull(fallbackExplorerRefreshedAt);
  const zoneMatches = canonicalizeVacancyZoneMatches(properties.zoneMatches);
  return {
    ...feature,
    properties: {
      ...properties,
      status:
        typeof properties.status === "string" && properties.status.trim()
          ? properties.status.trim()
          : "Not recorded",
      zoneMatches,
      incentiveCount: zoneMatches.length,
      canonicalType: canonicalVacancyType(properties.propertyType),
      sourceRecordDate,
      freshnessClass: classifyVacancyFreshness(sourceRecordDate, referenceDate),
      explorerRefreshedAt,
    },
  };
}

function rowsToGeoJSON(
  rows: VacancyRow[],
  referenceDate: string,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => enrichFeatureEvidence({
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
        sourceRecordDate: r.source_record_date,
        explorerRefreshedAt: r.explorer_refreshed_at,
      },
    }, referenceDate)),
  };
}

function buildDatabaseResponse(
  rows: VacancyRow[],
  limit: number,
  referenceDate: string,
): VacancyFeatureCollection {
  // The database query asks for one extra row so truncation is observed.
  const potentiallyTruncated = rows.length > limit;
  const collection = rowsToGeoJSON(rows.slice(0, limit), referenceDate);
  const explorerRefreshedAt = latestTimestamp(
    rows.slice(0, limit).map((row) => row.explorer_refreshed_at),
  );

  return {
    ...collection,
    meta: {
      sourceMode: "database",
      sourcePath: "database:vacant_properties",
      asOf: explorerRefreshedAt,
      asOfBasis: explorerRefreshedAt ? "explorer_refresh_timestamp" : null,
      explorerRefreshedAt,
      freshness: buildVacancyFreshnessMetadata(collection.features, referenceDate),
      licenseScreening: notRequestedLicenseScreening(),
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
  referenceDate: string,
): VacancyFeatureCollection {
  const potentiallyTruncated = features.length > limit;
  const returnedFeatures = features
    .slice(0, limit)
    .map((feature) => enrichFeatureEvidence(feature, referenceDate, generatedAt));
  const asOf = timestampOrNull(generatedAt);

  return {
    type: "FeatureCollection",
    features: returnedFeatures,
    meta: {
      sourceMode: "static_fallback",
      sourcePath: "/data/vacant-properties.json",
      asOf,
      asOfBasis: asOf ? "static_export_generated_at" : null,
      explorerRefreshedAt: asOf,
      freshness: buildVacancyFreshnessMetadata(returnedFeatures, referenceDate),
      licenseScreening: notRequestedLicenseScreening(),
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
  const requestNow = new Date();
  const evidenceReferenceDay = chicagoCalendarDay(requestNow);
  const evidenceReferenceDate = `${evidenceReferenceDay}T00:00:00.000Z`;

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
    ? DRAWN_AREA_VACANCY_LIMIT
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
    ? `vacant:community-boundary:v5:${VACANCY_FRESHNESS_POLICY_VERSION}:${evidenceReferenceDay}:${communityHash}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`
    : polygonParam
    ? `vacant:poly:v5:${VACANCY_FRESHNESS_POLICY_VERSION}:${evidenceReferenceDay}:${polygonHash}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`
    : `vacant:v5:${VACANCY_FRESHNESS_POLICY_VERSION}:${evidenceReferenceDay}:${roundCoord(west)}:${roundCoord(south)}:${roundCoord(east)}:${roundCoord(north)}:${typeFilter || "all"}:${sourceFilter || "all"}:${ownerTypeFilter || "all"}:${limit}`;

  const sql = getSQL();

  const baseResult = await cached<VacancyFeatureCollection>(
    cacheKey,
    (result) => result.meta.fallbackReason
      ? DEGRADED_CACHE_TTL_SECONDS
      : BASE_CACHE_TTL_SECONDS,
    async () => {
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
                     (to_jsonb(vp)->>'source_record_date') AS source_record_date,
                     updated_at::text AS explorer_refreshed_at
              FROM vacant_properties vp
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
                     (to_jsonb(vp)->>'source_record_date') AS source_record_date,
                     updated_at::text AS explorer_refreshed_at
              FROM vacant_properties vp
              WHERE lower(community_area) = lower(${communityAreaParam})
                AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
                AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
                AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
              ORDER BY incentive_count DESC, address ASC
              LIMIT ${limit + 1}
            `;

          return buildDatabaseResponse(rows as VacancyRow[], limit, evidenceReferenceDate);
        }

        if (polygonParam) {
          const polygonJson = polygonParam;
          const rows = await sql`
            SELECT id, source, address, lat, lon, property_type, ward, community_area,
                   zoning_class, square_feet, status, zone_matches, incentive_count,
                   owner_name, owner_type,
                   (to_jsonb(vp)->>'source_record_date') AS source_record_date,
                   updated_at::text AS explorer_refreshed_at
            FROM vacant_properties vp
            WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${polygonJson}), 4326)::geography)
              AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
              AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
              AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
            ORDER BY incentive_count DESC
            LIMIT ${limit + 1}
          `;

          return buildDatabaseResponse(rows as VacancyRow[], limit, evidenceReferenceDate);
        }

        const rows = await sql`
          SELECT id, source, address, lat, lon, property_type, ward, community_area,
                 zoning_class, square_feet, status, zone_matches, incentive_count,
                 owner_name, owner_type,
                 (to_jsonb(vp)->>'source_record_date') AS source_record_date,
                 updated_at::text AS explorer_refreshed_at
          FROM vacant_properties vp
          WHERE ST_Intersects(geom, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)::geography)
            AND (CAST(${typeFilter} AS text) IS NULL OR property_type = ${typeFilter})
            AND (CAST(${sourceFilter} AS text) IS NULL OR source = ${sourceFilter})
            AND (CAST(${ownerTypeFilter} AS text) IS NULL OR owner_type = ${ownerTypeFilter})
          ORDER BY incentive_count DESC
          LIMIT ${limit + 1}
        `;

        return buildDatabaseResponse(rows as VacancyRow[], limit, evidenceReferenceDate);
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
        return buildStaticFallbackResponse(
          [],
          limit,
          null,
          fallbackReason,
          evidenceReferenceDate,
        );
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
        evidenceReferenceDate,
      );
    } catch {
      return buildStaticFallbackResponse(
        [],
        limit,
        null,
        fallbackReason,
        evidenceReferenceDate,
      );
    }
    },
  );

  const result = parsedPolygon
    ? await cached<VacancyFeatureCollection>(
        `${cacheKey}:licenses:${VACANCY_LICENSE_POLICY_VERSION}`,
        (screenedResult) => hasTransientVacancyDegradation(screenedResult)
          ? DEGRADED_CACHE_TTL_SECONDS
          : LICENSE_CACHE_TTL_SECONDS,
        async () => {
          const screened = await screenVacancyLicenseConflicts(
            { type: "FeatureCollection", features: baseResult.features },
            { checkedAt: requestNow },
          );
          return {
            ...baseResult,
            features: screened.features,
            meta: { ...baseResult.meta, licenseScreening: screened.meta },
          };
        },
      )
    : baseResult;

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": vacancyResponseCacheControl(result, Boolean(parsedPolygon)),
    },
  });
}
