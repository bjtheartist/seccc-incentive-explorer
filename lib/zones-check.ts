/**
 * Point-in-zone resolution shared by the report engine's /api/zones/check
 * route and the read-only Site Concierge tool. Extracted verbatim from the
 * route so both call the SAME logic (DB-backed with a malformed-geometry-safe
 * static fallback). No writes.
 */
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
import { CHECKABLE_ZONE_KEYS } from "@/lib/constants";
import {
  featureDisplayName,
  formatZoneFeatureName,
  parseZoneProperties,
} from "@/lib/zone-names";

export interface ZoneMatch {
  key: string;
  name: string;
}

const zoneFileMap: Record<string, string> = {
  tif: "tif-districts.geojson",
  federalOZ: "federal-oz.geojson",
  enterprise: "enterprise-zones.geojson",
  stateIncentiveZones: "edge-zones.geojson",
  ssa: "special-service-areas.geojson",
  highUnemployment: "high-unemployment.geojson",
  industrialCorridors: "industrial-corridors.geojson",
  microMarketRecovery: "micro-market-recovery.geojson",
  nof: "nof-corridors.geojson",
  ccsa: "ccsa-corridors.geojson",
  nmtcEligible: "nmtc-eligible.geojson",
  qct: "qct.geojson",
  landmarkDistricts: "landmark-districts.geojson",
  nrhpDistricts: "nrhp-districts.geojson",
  energyCommunities: "energy-communities.geojson",
  hubzone: "hubzone.geojson",
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

/**
 * Point-in-polygon test that tolerates malformed source geometry (e.g. an
 * unclosed ring). Some shipped zone GeoJSON contains features that make turf
 * throw "First and last coordinates in a ring must be the same"; skip that one
 * feature and keep scanning instead of failing the whole lookup.
 */
function pointInPolygonSafe(
  point: ReturnType<typeof turf.point>,
  key: string,
  feature: Feature<Polygon | MultiPolygon>
): boolean {
  try {
    return turf.booleanPointInPolygon(point, feature);
  } catch (err) {
    console.warn(
      `[zones/check] skipping malformed feature in zone "${key}" (${
        (feature.properties as Record<string, unknown> | null)?.name ??
        (feature.properties as Record<string, unknown> | null)?.NAME ??
        "unknown feature"
      }):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * True if the point falls inside ANY of the given static zone layers.
 * Cheaper than checkStaticZones when only specific layers matter (e.g. the
 * SSA/CCSA corridor check that reorders local support for storefront work).
 */
export async function pointInAnyZone(
  lat: number,
  lon: number,
  keys: string[]
): Promise<boolean> {
  const point = turf.point([lon, lat]);
  for (const key of keys) {
    const collection = await loadStaticZone(key);
    const hit = collection.features.some(
      (feature) =>
        Boolean(feature.geometry) &&
        pointInPolygonSafe(point, key, feature as Feature<Polygon | MultiPolygon>)
    );
    if (hit) return true;
  }
  return false;
}

export async function checkStaticZones(
  lat: number,
  lon: number
): Promise<ZoneMatch[]> {
  const point = turf.point([lon, lat]);
  const matches: ZoneMatch[] = [];

  await Promise.all(
    CHECKABLE_ZONE_KEYS.map(async (key) => {
      const collection = await loadStaticZone(key);
      const match = collection.features.find(
        (feature): feature is Feature<Polygon | MultiPolygon> =>
          Boolean(feature.geometry) &&
          pointInPolygonSafe(
            point,
            key,
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

async function checkStaticZone(
  key: string,
  lat: number,
  lon: number
): Promise<ZoneMatch | null> {
  const collection = await loadStaticZone(key);
  const point = turf.point([lon, lat]);
  const match = collection.features.find(
    (feature): feature is Feature<Polygon | MultiPolygon> =>
      Boolean(feature.geometry) &&
      pointInPolygonSafe(point, key, feature as Feature<Polygon | MultiPolygon>)
  );

  return match ? { key, name: featureDisplayName(key, match) } : null;
}

/**
 * Static point-in-polygon over a NAMED SUBSET of layers, returning each hit's
 * feature name. `checkStaticZones` scans all sixteen checkable layers (7.4 MB
 * of NMTC tracts among them); the Site Shortlist only needs the four corridor
 * and financing overlays it renders, run once per candidate, so scanning the
 * rest would be pure cost. Unknown keys and unreadable layers are skipped
 * rather than thrown — a missing overlay file must degrade to "none mapped",
 * never to a failed page.
 */
export async function checkStaticZoneKeys(
  lat: number,
  lon: number,
  keys: readonly string[]
): Promise<ZoneMatch[]> {
  const matches = await Promise.all(
    keys.map((key) => checkStaticZone(key, lat, lon).catch(() => null))
  );
  return matches.filter((match): match is ZoneMatch => Boolean(match));
}

/**
 * Resolve which incentive zones cover a point. DB-backed when the SQL client is
 * available, with a static point-in-polygon fallback. Cached per rounded
 * coordinate. This is the exact logic the report engine relies on.
 */
export async function resolveZonesAtPoint(
  lat: number,
  lon: number
): Promise<ZoneMatch[]> {
  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  const cacheKey = `zones:check:v2:${rLat}:${rLon}`;
  const sql = getSQL();

  return memCached(cacheKey, 604800, async () => {
    if (!sql) {
      return checkStaticZones(lat, lon);
    }

    const rows = await sql`
      WITH point AS (
        SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS geom
      )
      SELECT z.zone_key, z.feature_name, z.feature_properties
      FROM zones z, point p
      WHERE z.geom::geometry && p.geom
        AND ST_Covers(ST_Buffer(z.geom::geometry, 0), p.geom)
    `;

    const staticOnlyKeys = new Set([
      "nof",
      "ccsa",
      "energyCommunities",
      "hubzone",
    ]);
    const dbMatches = rows
      .filter((r: Record<string, unknown>) => !staticOnlyKeys.has(String(r.zone_key)))
      .map((r: Record<string, unknown>) => ({
        key: String(r.zone_key),
        name: formatZoneFeatureName(String(r.zone_key), {
          ...parseZoneProperties(r.feature_properties),
          name: r.feature_name,
        }),
      }));
    const staticMatches = (
      await Promise.all(
        Array.from(staticOnlyKeys).map((key) =>
          checkStaticZone(key, lat, lon).catch(() => null)
        )
      )
    ).filter((match): match is ZoneMatch => Boolean(match));

    return [...dbMatches, ...staticMatches];
  });
}
