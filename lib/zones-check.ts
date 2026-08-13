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
import { getZoneLayerRegistryEntry } from "@/lib/zone-layer-registry";

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

/* ════════════════════════════════════════════════════════════════════════
 * Zone Evidence v2 (build-spec.md 1.3; audit F2; consult item 6)
 *
 * Everything below is NEW code for the new /api/zones/check/v2 route. It
 * does not modify or call into any of the v1 functions above — v1's route
 * and behavior are untouched in PR1. The core difference from v1: a layer
 * that cannot be confidently resolved (unreadable file, malformed
 * geometry, or a DB layer with no verified-loaded confirmation) produces
 * an explicit `unknown` result with a reason, never a silent `false`/
 * omission. A known match on one layer is never affected by another
 * layer's failure — each layer is resolved independently.
 * ════════════════════════════════════════════════════════════════════════ */

export type ZoneLayerState = "matched" | "not_matched" | "unknown";
export type ZoneUnknownReason = "source_unavailable" | "malformed_geometry" | "layer_missing";

export interface ZoneLayerEvidence {
  state: ZoneLayerState;
  name?: string;
  reason?: ZoneUnknownReason;
}

/** Injectable per-key DB lookup so tests never need a live database (Hard Rule: mock at the getSQL boundary). */
export type ZoneDbLayerQuery = (
  key: string,
  lat: number,
  lon: number
) => Promise<{ name: string } | null>;

async function defaultDbLayerQuery(
  key: string,
  lat: number,
  lon: number
): Promise<{ name: string } | null> {
  const sql = getSQL();
  if (!sql) return null;

  const rows = await sql`
    WITH point AS (
      SELECT ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) AS geom
    )
    SELECT z.feature_name, z.feature_properties
    FROM zones z, point p
    WHERE z.zone_key = ${key}
      AND z.geom::geometry && p.geom
      AND ST_Covers(ST_Buffer(z.geom::geometry, 0), p.geom)
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    name: formatZoneFeatureName(key, {
      ...parseZoneProperties(row.feature_properties),
      name: row.feature_name,
    }),
  };
}

/**
 * Per-feature point-in-polygon test that distinguishes "no match" from
 * "this feature's geometry could not be evaluated" — the v1
 * `pointInPolygonSafe` above collapses both to `false`, which is exactly
 * the false-negative defect this v2 path exists to fix. `checkStaticZoneV2`
 * uses `malformed` to decide between `not_matched` and `unknown`.
 */
function pointInPolygonSafeV2(
  point: ReturnType<typeof turf.point>,
  key: string,
  feature: Feature<Polygon | MultiPolygon>
): { matched: boolean; malformed: boolean } {
  try {
    return { matched: turf.booleanPointInPolygon(point, feature), malformed: false };
  } catch (err) {
    console.warn(
      `[zones/check/v2] skipping malformed feature in zone "${key}":`,
      err instanceof Error ? err.message : err
    );
    return { matched: false, malformed: true };
  }
}

/**
 * Static-file evidence for one layer. A match always wins outright. If no
 * match was found AND at least one feature in the layer was malformed, the
 * layer's true coverage of this point could not be fully verified, so the
 * result is `unknown` (reason `malformed_geometry`) rather than a
 * confident `not_matched`. An unreadable/missing source file is
 * `unknown` (reason `source_unavailable`).
 */
async function checkStaticZoneV2(key: string, lat: number, lon: number): Promise<ZoneLayerEvidence> {
  let collection: FeatureCollection;
  try {
    collection = await loadStaticZone(key);
  } catch (err) {
    console.warn(
      `[zones/check/v2] static layer "${key}" unavailable:`,
      err instanceof Error ? err.message : err
    );
    return { state: "unknown", reason: "source_unavailable" };
  }

  const point = turf.point([lon, lat]);
  let sawMalformed = false;

  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    const result = pointInPolygonSafeV2(point, key, feature as Feature<Polygon | MultiPolygon>);
    if (result.malformed) {
      sawMalformed = true;
      continue;
    }
    if (result.matched) {
      return {
        state: "matched",
        name: featureDisplayName(key, feature as Feature<Polygon | MultiPolygon>),
      };
    }
  }

  if (sawMalformed) {
    return { state: "unknown", reason: "malformed_geometry" };
  }
  return { state: "not_matched" };
}

/**
 * Resolve one layer's evidence for a point. `opts.sql`/`opts.dbLayerQuery`
 * are injectable so tests can simulate DB failure, a zero-row unverified
 * layer, and a zero-row verified layer without any live database
 * connection (Hard Rule: no DB in this task; mock at the boundary).
 */
export async function resolveZoneLayerEvidence(
  key: string,
  lat: number,
  lon: number,
  opts: { sql?: ReturnType<typeof getSQL> | null; dbLayerQuery?: ZoneDbLayerQuery } = {}
): Promise<ZoneLayerEvidence> {
  const registryEntry = getZoneLayerRegistryEntry(key);
  if (!registryEntry) {
    return { state: "unknown", reason: "layer_missing" };
  }

  const sql = opts.sql !== undefined ? opts.sql : getSQL();
  const useDb = registryEntry.source === "db" && Boolean(sql);

  if (useDb) {
    try {
      const dbQuery = opts.dbLayerQuery ?? defaultDbLayerQuery;
      const match = await dbQuery(key, lat, lon);
      if (match) {
        return { state: "matched", name: match.name };
      }
      // Zero rows. Only trust this as a genuine "not matched" when the
      // registry confirms the layer is actually loaded — otherwise a
      // never-populated table would silently read as "no incentive here"
      // for every address, forever.
      if (!registryEntry.verifiedLoaded) {
        return { state: "unknown", reason: "layer_missing" };
      }
      return { state: "not_matched" };
    } catch (err) {
      console.warn(
        `[zones/check/v2] DB query failed for layer "${key}":`,
        err instanceof Error ? err.message : err
      );
      return { state: "unknown", reason: "source_unavailable" };
    }
  }

  return checkStaticZoneV2(key, lat, lon);
}

/**
 * Resolve evidence for every requested layer independently — one layer's
 * failure never affects another's result, and a known match is never
 * downgraded by an unrelated layer's `unknown`.
 */
export async function resolveZoneEvidenceV2(
  lat: number,
  lon: number,
  keys: readonly string[],
  opts: { sql?: ReturnType<typeof getSQL> | null; dbLayerQuery?: ZoneDbLayerQuery } = {}
): Promise<Record<string, ZoneLayerEvidence>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await resolveZoneLayerEvidence(key, lat, lon, opts)] as const)
  );
  return Object.fromEntries(entries);
}
