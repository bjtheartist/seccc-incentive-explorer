/**
 * ZONING DISTRICT AT A POINT — request-time finalist resolution for the Site
 * Shortlist's by-right tiering.
 *
 * WHY THIS EXISTS (and why it is not static): the vacancy export stamps
 * `zoningClass` onto vacant-LAND points (all 8,166 carry one) but leaves it
 * null on every vacant-BUILDING point in all nine editions. The by-right matrix
 * is the whole point of the shortlist's tier split, so without a district code
 * an existing-building search puts every single record in Tier 2 as
 * "unverified" — a tier split that never splits. Committed data cannot fix
 * this: data/curated/zoning/zoning-map-snapshot.json tracks the 14,920 zoning
 * records' ATTRIBUTES for change detection and carries no geometry, and the
 * full boundary layer is not committed (it would be another multi-megabyte
 * payload on top of an 11 MB vacancy index).
 *
 * So this is deliberately the SECOND request-time source in the feature,
 * alongside the county/licensing enrichment — and it obeys the same rules:
 *   • Finalists only. Never the screened pool.
 *   • Never throws. A failed lookup yields `null`, which tiers as "zoning
 *     unverified" — the exact state the page shows today, so a City outage
 *     degrades the feature to its current behavior rather than breaking it.
 *   • Cached in memory per rounded coordinate, so repeat views and the several
 *     PINs that share a corner cost one lookup.
 *
 * Source: City of Chicago Data Portal `dj47-wfun` (zoning boundaries), the same
 * mirror app/api/zoning falls back to. A point query returns one small row, so
 * this stays far cheaper than pulling boundary polygons.
 */

import { socrataFetchResult } from "./socrata";
import { memCached } from "./redis";

const SOCRATA_ZONING_URL = "https://data.cityofchicago.org/resource/dj47-wfun.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Chicago's zoning polygons are far larger than ~11 m, so rounding to five
 *  decimals collides only for points that genuinely share a district. */
const COORD_PRECISION = 5;
/**
 * Concurrency cap. A cold 40-candidate pass is the slow path a first-time
 * reader feels, so this is sized to clear it in about two waves; the endpoint
 * is a public City mirror, so it is not raised further.
 */
const CONCURRENCY = 20;

/** Sentinel for "looked up, genuinely no district" — distinct from a miss, so
 *  an honest absence still caches. */
const NO_ZONE = "";

function cacheKey(lat: number, lon: number): string {
  return `zoning:point:v1:${lat.toFixed(COORD_PRECISION)}:${lon.toFixed(COORD_PRECISION)}`;
}

/** The district code covering one point, or `null` when unknown/unavailable.
 *  Cached through the repo's Redis-backed memo so the cost is paid once across
 *  instances, not once per serverless cold start. */
async function fetchZoneClass(lat: number, lon: number): Promise<string | null> {
  const url =
    `${SOCRATA_ZONING_URL}?` +
    new URLSearchParams({
      $select: "zone_class",
      $where: `intersects(the_geom, 'POINT(${lon} ${lat})')`,
      $limit: "1",
    });

  const value = await memCached(cacheKey(lat, lon), CACHE_TTL_MS / 1000, async () => {
    const result = await socrataFetchResult<{ zone_class?: string }[]>(url, 12_000);
    // A failed lookup must NOT be stored as an absence — that would freeze a
    // transient outage into six hours of "zoning unverified". Throwing keeps it
    // out of the cache; resolveZoneClasses turns it back into "unresolved".
    // The typed result names WHICH failure happened, so the thrown message is
    // diagnosable instead of a single undifferentiated "unavailable".
    if (!result.ok) {
      throw new Error(`zoning lookup unavailable (${result.reason})`);
    }
    if (!Array.isArray(result.data)) {
      throw new Error("zoning lookup unavailable (unexpected payload shape)");
    }
    return result.data[0]?.zone_class?.trim() || NO_ZONE;
  });

  return value === NO_ZONE ? null : value;
}

export interface ZoningPoint {
  key: string;
  lat: number;
  lon: number;
}

/**
 * Resolve district codes for a batch of points, bounded in flight. Returns a
 * map from the caller's key to the code, omitting anything that could not be
 * resolved. Never rejects.
 */
export async function resolveZoneClasses(
  points: readonly ZoningPoint[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (points.length === 0) return resolved;

  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= points.length) return;
      const point = points[index];
      try {
        const zone = await fetchZoneClass(point.lat, point.lon);
        if (zone) resolved.set(point.key, zone);
      } catch {
        // Leave it unresolved -> "zoning unverified".
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, points.length) }, () => worker()),
  );
  return resolved;
}
