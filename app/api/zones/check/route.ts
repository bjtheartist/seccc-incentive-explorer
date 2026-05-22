import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { readFile } from "fs/promises";
import path from "path";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { getSQL } from "@/lib/db";
import { memCached, roundCoord } from "@/lib/redis";
import { ZONE_KEYS } from "@/lib/constants";
import { featureDisplayName, formatZoneFeatureName, parseZoneProperties } from "@/lib/zone-names";

export const runtime = "nodejs";

const zoneFileMap: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-projects.geojson",
  ccsa: "ccsa-corridors.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
};

const zoneCache: Record<string, FeatureCollection> = {};

async function loadStaticZone(key: string): Promise<FeatureCollection> {
  if (zoneCache[key]) return zoneCache[key];

  const fileName = zoneFileMap[key];
  if (!fileName) throw new Error(`No static zone file configured for ${key}`);

  const filePath = path.join(process.cwd(), "public", "data", "zones", fileName);
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as FeatureCollection;
  zoneCache[key] = data;
  return data;
}

async function checkStaticZones(lat: number, lon: number) {
  const point = turf.point([lon, lat]);
  const matches: Array<{ key: string; name: string }> = [];

  await Promise.all(
    ZONE_KEYS.map(async (key) => {
      const collection = await loadStaticZone(key);
      const match = collection.features.find(
        (feature): feature is Feature<Polygon | MultiPolygon> =>
          Boolean(feature.geometry) &&
          turf.booleanPointInPolygon(
            point,
            feature as Feature<Polygon | MultiPolygon>
          )
      );

      if (match) {
        matches.push({ key, name: featureDisplayName(key, match) });
      }
    })
  );

  return matches;
}

/**
 * GET /api/zones/check?lat=&lon=
 *
 * Returns which incentive zones cover the given point.
 * Repairs source polygons at query time so one malformed geometry cannot break
 * the lookup. The data import should still be cleaned upstream.
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

    const rLat = roundCoord(latNum);
    const rLon = roundCoord(lonNum);
    const cacheKey = `zones:check:${rLat}:${rLon}`;
    const sql = getSQL();

    const results = await memCached(cacheKey, 604800, async () => {
      if (!sql) {
        return checkStaticZones(parseFloat(lat), parseFloat(lon));
      }

      const rows = await sql`
        WITH point AS (
          SELECT ST_SetSRID(ST_MakePoint(${lonNum}, ${latNum}), 4326) AS geom
        )
        SELECT z.zone_key, z.feature_name, z.feature_properties
        FROM zones z, point p
        WHERE z.geom::geometry && p.geom
          AND ST_Covers(ST_Buffer(z.geom::geometry, 0), p.geom)
      `;

      return rows.map((r: Record<string, unknown>) => ({
        key: r.zone_key,
        name: formatZoneFeatureName(String(r.zone_key), {
          ...parseZoneProperties(r.feature_properties),
          name: r.feature_name,
        }),
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
