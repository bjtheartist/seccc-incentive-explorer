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

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
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
  ttlSeconds: number,
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
      await redis.set(key, JSON.stringify(result), { ex: ttlSeconds });
    } catch (err) {
      console.warn("[redis] cache write error:", err);
    }
  }

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
