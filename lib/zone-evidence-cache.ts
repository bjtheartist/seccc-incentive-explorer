/**
 * lib/zone-evidence-cache.ts — Zone Evidence v2 caching (build-spec.md 1.3;
 * consult item 5; review1 R3). A brand-new Redis key namespace
 * ("zones:check:v3:", distinct from v1's "zones:check:v2:") keyed by
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
 *
 * Two review1 R3 fixes over the original design:
 *   1. The resolution timestamp (`checkedAt`) is generated once, at
 *      resolution time, and cached alongside `layers`. A cache HIT returns
 *      that original `checkedAt` — the route must not stamp a fresh
 *      `now()` on a result that may be up to 7 days old, which would make
 *      "checked <date>" a lie.
 *   2. `hadUnknown` is NEVER stored. It is recomputed from `layers` every
 *      time this function returns, on both the fresh-resolve path and the
 *      cache-hit path — a stored boolean could in principle drift from the
 *      `layers` it was computed from (a corrupted/hand-edited cache entry,
 *      a future code path that writes the cache differently); recomputing
 *      makes that drift structurally impossible to observe. The cached
 *      payload's shape is also validated on read — a Redis entry that
 *      doesn't look like `{layers, checkedAt}` is treated as a miss.
 */
import { getRedisClient, roundCoord } from "@/lib/redis";
import {
  resolveZoneEvidenceV2,
  type ZoneEvidenceOpts,
  type ZoneLayerEvidence,
  type ZoneLayerState,
} from "@/lib/zones-check";

export const ZONE_EVIDENCE_V2_NAMESPACE = "zones:check:v3:";
export const FULL_COVERAGE_TTL_SECONDS = 604_800; // 7 days
export const UNKNOWN_BEARING_TTL_SECONDS = 300; // 5 minutes — the spec's "TTL <= 5 min" cap

/** What is actually persisted in Redis — deliberately does NOT include hadUnknown (see module doc comment). */
interface StoredZoneEvidenceV2Payload {
  layers: Record<string, ZoneLayerEvidence>;
  checkedAt: string;
}

/** What resolveZoneEvidenceV2Cached returns to its caller — hadUnknown is always freshly computed from `layers`. */
export interface ZoneEvidenceV2Result {
  layers: Record<string, ZoneLayerEvidence>;
  checkedAt: string;
  hadUnknown: boolean;
}

const VALID_ZONE_LAYER_STATES: ReadonlySet<ZoneLayerState> = new Set([
  "matched",
  "not_matched",
  "unknown",
]);

function isValidStoredPayload(value: unknown): value is StoredZoneEvidenceV2Payload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.checkedAt !== "string" || v.checkedAt.length === 0) return false;
  if (!v.layers || typeof v.layers !== "object" || Array.isArray(v.layers)) return false;

  for (const entry of Object.values(v.layers as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") return false;
    const state = (entry as Record<string, unknown>).state;
    if (typeof state !== "string" || !VALID_ZONE_LAYER_STATES.has(state as ZoneLayerState)) {
      return false;
    }
  }
  return true;
}

/** Recomputed on every read — see module doc comment for why a stored boolean is never trusted. */
function computeHadUnknown(layers: Record<string, ZoneLayerEvidence>): boolean {
  return Object.values(layers).some((evidence) => evidence.state === "unknown");
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
  opts: ZoneEvidenceOpts = {}
): Promise<ZoneEvidenceV2Result> {
  const cacheKey = zoneEvidenceV2CacheKey(2, dataRevision, lat, lon, keys);
  const redis = getRedisClient();

  if (redis) {
    try {
      const hit = await redis.get<unknown>(cacheKey);
      if (hit != null) {
        if (isValidStoredPayload(hit)) {
          return {
            layers: hit.layers,
            checkedAt: hit.checkedAt, // the ORIGINAL resolution timestamp, not now()
            hadUnknown: computeHadUnknown(hit.layers), // always recomputed, never a stored boolean
          };
        }
        console.warn(
          "[zone-evidence-cache] discarding invalid/malformed cached payload, re-resolving:",
          cacheKey
        );
      }
    } catch (err) {
      console.warn("[zone-evidence-cache] read error, falling through:", err);
    }
  }

  const layers = await resolveZoneEvidenceV2(lat, lon, keys, opts);
  const checkedAt = new Date().toISOString();
  const hadUnknown = computeHadUnknown(layers);

  if (redis) {
    try {
      const toStore: StoredZoneEvidenceV2Payload = { layers, checkedAt };
      await redis.set(cacheKey, JSON.stringify(toStore), {
        ex: hadUnknown ? UNKNOWN_BEARING_TTL_SECONDS : FULL_COVERAGE_TTL_SECONDS,
      });
    } catch (err) {
      console.warn("[zone-evidence-cache] write error:", err);
    }
  }

  return { layers, checkedAt, hadUnknown };
}
