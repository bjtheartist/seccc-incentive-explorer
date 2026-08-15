import { Redis } from "@upstash/redis";

/**
 * Lazy-initialized Upstash Redis client.
 * Returns null if env vars are not set (graceful degradation).
 */
let _redis: Redis | null = null;
let _redisChecked = false;

function getRedis(): Redis | null {
  if (_redisChecked) return _redis;
  _redisChecked = true;

  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Public accessor for the lazily-initialized Upstash client. Returns null when
 * Upstash env vars are absent (graceful degradation — callers must have an
 * in-memory / no-op fallback). Reuses the same cached instance as `cached()`.
 */
export function getRedisClient(): Redis | null {
  return getRedis();
}

/**
 * Cache-through helper.
 * Returns cached value from Redis if available; otherwise calls fn(),
 * stores the result with the given TTL, and returns it.
 *
 * Gracefully falls through to fn() if Redis is unavailable (no env vars
 * or connection error).
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number | ((result: T) => number),
  fn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();

  if (redis) {
    try {
      const hit = await redis.get<T>(key);
      if (hit !== null && hit !== undefined) {
        return hit;
      }
    } catch (err) {
      console.warn("[redis] cache read error, falling through:", err);
    }
  }

  const result = await fn();

  if (redis) {
    try {
      const resolvedTTL =
        typeof ttlSeconds === "function" ? ttlSeconds(result) : ttlSeconds;
      if (Number.isFinite(resolvedTTL) && resolvedTTL > 0) {
        await redis.set(key, JSON.stringify(result), { ex: resolvedTTL });
      }
    } catch (err) {
      console.warn("[redis] cache write error:", err);
    }
  }

  return result;
}

// ─── Process-Level Memory Cache (Layer 4) ─────────────────────────────

interface MemEntry {
  data: unknown;
  expiresAt: number;
}

const MEM_MAX_ENTRIES = 200;
const memStore = new Map<string, MemEntry>();

/** Clamp memory TTL to 60s–300s, targeting 10% of the Redis TTL. */
function memTTL(redisTTLSeconds: number): number {
  return Math.min(300, Math.max(60, Math.round(redisTTLSeconds * 0.1)));
}

/** Lazy eviction: drop expired entries when we exceed capacity. */
function memEvict(): void {
  if (memStore.size <= MEM_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of memStore) {
    if (v.expiresAt <= now) memStore.delete(k);
  }
  // If still over cap, remove oldest entries
  if (memStore.size > MEM_MAX_ENTRIES) {
    const excess = memStore.size - MEM_MAX_ENTRIES;
    const keys = memStore.keys();
    for (let i = 0; i < excess; i++) {
      const next = keys.next();
      if (!next.done) memStore.delete(next.value);
    }
  }
}

/**
 * Process-level memory cache that sits in front of Redis.
 * Avoids a Redis roundtrip for recently fetched data within the same
 * serverless function instance.
 *
 * Falls through to `cached()` (Redis) on miss.
 */
export async function memCached<T>(
  key: string,
  redisTTLSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = memStore.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.data as T;
  }

  // Fall through to Redis-backed cached()
  const result = await cached<T>(key, redisTTLSeconds, fn);

  // Store in memory
  const mTTL = memTTL(redisTTLSeconds);
  memStore.set(key, { data: result, expiresAt: now + mTTL * 1000 });
  memEvict();

  return result;
}

/**
 * Round a coordinate to a fixed number of decimal places.
 * Useful for normalizing lat/lon in cache keys.
 * 4 decimals ~ 11m precision, sufficient for zone lookups.
 */
export function roundCoord(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

/**
 * Invalidate all Redis keys matching a glob pattern.
 * Uses SCAN + DEL to avoid blocking the server.
 * No-op if Redis is unavailable.
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  try {
    let deleted = 0;
    let done = false;
    let cur: number | string = 0;

    while (!done) {
      const result: [string, string[]] = await redis.scan(cur, {
        match: pattern,
        count: 100,
      });
      const nextCursor = result[0];
      const keys = result[1];
      cur = nextCursor;

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        await pipeline.exec();
        deleted += keys.length;
      }

      if (nextCursor === "0") {
        done = true;
      }
    }

    return deleted;
  } catch (err) {
    console.warn("[redis] invalidatePattern error:", err);
    return 0;
  }
}
