/**
 * Client-side fetch cache with:
 * - URL-pattern-based TTLs
 * - In-flight request deduplication
 * - Stale-while-error fallback
 * - invalidateClientCache() escape hatch
 */

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** TTL rules: first matching pattern wins. */
const TTL_RULES: { pattern: RegExp; ttlMs: number }[] = [
  { pattern: /\/api\/programs/, ttlMs: 5 * 60_000 },
  { pattern: /\/data\/programs\.json/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/stats/, ttlMs: 5 * 60_000 },
  { pattern: /\/data\/stats\.json/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/stacking/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/businesses/, ttlMs: 5 * 60_000 },
  { pattern: /\/data\/businesses\.json/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/geocode/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/zones\/geojson\//, ttlMs: 30 * 60_000 },
  { pattern: /\/data\/zones\//, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/zones\/check/, ttlMs: 10 * 60_000 },
  { pattern: /\/api\/tif-finance/, ttlMs: 60 * 60_000 },
  { pattern: /\/api\/census/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/zoning/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/parcel/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/districts/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/assets/, ttlMs: 30 * 60_000 },
  // External datasets (community areas, zoning polygons, POI)
  { pattern: /data\.cityofchicago\.org/, ttlMs: 60 * 60_000 },
  // POI layers (CTA, schools, libraries)
  { pattern: /data\.cityofchicago\.org\/resource\//, ttlMs: 30 * 60_000 },
];

/** Default TTL for unmatched URLs: 2 minutes */
const DEFAULT_TTL_MS = 2 * 60_000;

function getTTL(url: string): number {
  for (const rule of TTL_RULES) {
    if (rule.pattern.test(url)) return rule.ttlMs;
  }
  return DEFAULT_TTL_MS;
}

function isFresh(entry: CacheEntry, ttlMs: number): boolean {
  return Date.now() - entry.timestamp < ttlMs;
}

/**
 * Cached fetch with in-flight deduplication and stale-while-error.
 * Drop-in replacement for fetch() in client components.
 */
export async function cachedFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  // Only cache GET requests (or requests with no method specified)
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") {
    const res = await fetch(url, init);
    return res.json() as Promise<T>;
  }

  const ttlMs = getTTL(url);
  const existing = cache.get(url);

  // Return fresh cached data
  if (existing && isFresh(existing, ttlMs)) {
    return existing.data as T;
  }

  // Deduplicate in-flight requests
  const pending = inflight.get(url);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async (): Promise<T> => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        // Stale-while-error: return stale data if available
        if (existing) {
          return existing.data as T;
        }
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      cache.set(url, { data, timestamp: Date.now() });
      return data as T;
    } catch (err) {
      // Stale-while-error: return stale data on network failure
      if (existing) {
        return existing.data as T;
      }
      throw err;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}

/** Clear the entire client cache, or entries matching a pattern. */
export function invalidateClientCache(pattern?: RegExp): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (pattern.test(key)) {
      cache.delete(key);
    }
  }
}
