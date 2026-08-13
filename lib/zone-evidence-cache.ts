/**
 * lib/zone-evidence-cache.ts — Zone Evidence v2 caching (build-spec.md 1.3;
 * consult item 5). A brand-new Redis key namespace ("zones:check:v3:",
 * distinct from v1's "zones:check:v2:") keyed by
 * (schemaVersion, dataRevision, roundedCoord, requestedLayers).
 *
 * Content-aware TTL, which `lib/redis.ts`'s `memCached()` cannot express
 * (it takes one fixed TTL up front, before the result — whose content
 * decides the right TTL — is known): fully-covered responses get the
 * normal 7-day TTL; any response containing an `unknown` layer gets a
 * short TTL (<= 5 min) so a transient outage cannot serve a stale
 * evidence-of-absence claim for a week. `stale-on-error` must never stand
 * in for a negative claim — this cache never serves an expired/missing
 * entry as a fallback; a miss always re-resolves from
 * `resolveZoneEvidenceV2`.
 */
import { getRedisClient, roundCoord } from "@/lib/redis";
import { resolveZoneEvidenceV2, type ZoneDbLayerQuery, type ZoneLayerEvidence } from "@/lib/zones-check";
import { getSQL } from "@/lib/db";

export const ZONE_EVIDENCE_V2_NAMESPACE = "zones:check:v3:";
export const FULL_COVERAGE_TTL_SECONDS = 604_800; // 7 days
export const UNKNOWN_BEARING_TTL_SECONDS = 300; // 5 minutes — the spec's "TTL <= 5 min" cap

export interface ZoneEvidenceV2Result {
  layers: Record<string, ZoneLayerEvidence>;
  hadUnknown: boolean;
}

export function zoneEvidenceV2CacheKey(
  schemaVersion: number,
  dataRevision: string,
  lat: number,
  lon: number,
  keys: readonly string[]
): string {
  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  const sortedKeys = [...keys].sort().join(",");
  return `${ZONE_EVIDENCE_V2_NAMESPACE}${schemaVersion}:${dataRevision}:${rLat}:${rLon}:${sortedKeys}`;
}

/**
 * Resolve Zone Evidence v2 for a point + layer set, reading/writing through
 * the v3 Redis namespace with content-aware TTL. Gracefully degrades to
 * "resolve, don't cache" when Redis is unavailable (no env vars — matches
 * every other cache helper in this codebase).
 */
export async function resolveZoneEvidenceV2Cached(
  dataRevision: string,
  lat: number,
  lon: number,
  keys: readonly string[],
  opts: { sql?: ReturnType<typeof getSQL> | null; dbLayerQuery?: ZoneDbLayerQuery } = {}
): Promise<ZoneEvidenceV2Result> {
  const cacheKey = zoneEvidenceV2CacheKey(2, dataRevision, lat, lon, keys);
  const redis = getRedisClient();

  if (redis) {
    try {
      const hit = await redis.get<ZoneEvidenceV2Result>(cacheKey);
      if (hit) return hit;
    } catch (err) {
      console.warn("[zone-evidence-cache] read error, falling through:", err);
    }
  }

  const layers = await resolveZoneEvidenceV2(lat, lon, keys, opts);
  const hadUnknown = Object.values(layers).some((evidence) => evidence.state === "unknown");
  const result: ZoneEvidenceV2Result = { layers, hadUnknown };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), {
        ex: hadUnknown ? UNKNOWN_BEARING_TTL_SECONDS : FULL_COVERAGE_TTL_SECONDS,
      });
    } catch (err) {
      console.warn("[zone-evidence-cache] write error:", err);
    }
  }

  return result;
}
