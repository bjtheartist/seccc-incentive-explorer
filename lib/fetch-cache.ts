/**
 * Client-side fetch cache with:
 * - URL-pattern-based TTLs
 * - In-flight request deduplication
 * - Stale-while-error fallback, reported HONESTLY to the caller
 * - A bounded map (LRU eviction) so a long-lived tab cannot grow it forever
 * - invalidateClientCache() escape hatch
 */

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

/**
 * What a cached fetch actually returned, and whether it is what the caller
 * asked for.
 *
 * `stale: true` means the network attempt FAILED (non-ok response or a thrown
 * network error) and the value handed back is a previously-cached body that
 * is already past its TTL. The serve-stale-on-error behavior is deliberately
 * kept — a stale zoning payload beats an empty panel — but it used to be
 * invisible: `cachedFetch()` returned expired data through the exact same
 * `Promise<T>` a fresh 200 returns, so nothing downstream could tell a live
 * answer from a days-old one, and no caller could have disclosed the
 * difference even if it wanted to.
 *
 * A within-TTL cache hit is NOT stale (that is the cache working as designed),
 * and neither is a successful network fetch.
 */
export interface CachedFetchResult<T> {
  data: T;
  stale: boolean;
}

/**
 * Hard ceiling on cached bodies. The map used to be unbounded: every distinct
 * URL a session ever touched stayed resident for the life of the tab, and the
 * high-cardinality keys here are coordinate-bearing (`/api/parcel?lat=…`,
 * `/api/census?lat=…`, viewport-bounded `/api/vacant?bounds=…`), so panning a
 * map is enough to accumulate thousands of full JSON payloads that nothing
 * ever evicts. 300 entries covers ordinary session reuse with room to spare.
 */
const MAX_CACHE_ENTRIES = 300;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CachedFetchResult<unknown>>>();

/**
 * Insertion-ordered LRU: `touch()` re-inserts a key so it moves to the back,
 * making the FRONT of the map the least-recently-used end that `evict()`
 * trims. Map preserves insertion order, so no separate bookkeeping is needed.
 */
function touch(url: string, entry: CacheEntry): void {
  cache.delete(url);
  cache.set(url, entry);
}

function evict(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

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
  { pattern: /\/api\/parcel-space/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/parcel(?:\?|$)/, ttlMs: 5 * 60_000 },
  { pattern: /\/api\/representatives/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/districts/, ttlMs: 30 * 60_000 },
  { pattern: /\/api\/mobility-access/, ttlMs: 30 * 60_000 },
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
 * Cached fetch with in-flight deduplication and stale-while-error, returning
 * BOTH the body and whether that body is a stale fallback.
 *
 * Prefer this over `cachedFetch()` anywhere the answer is shown to a user or
 * quoted in a claim: a stale payload is a fact read at an earlier time, and
 * the surface rendering it is the only place that can say so.
 */
export async function cachedFetchWithMeta<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<CachedFetchResult<T>> {
  // Only cache GET requests (or requests with no method specified)
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") {
    const res = await fetch(url, init);
    return { data: (await res.json()) as T, stale: false };
  }

  const ttlMs = getTTL(url);
  const existing = cache.get(url);

  // Return fresh cached data — a within-TTL hit is the cache working, not
  // staleness.
  if (existing && isFresh(existing, ttlMs)) {
    touch(url, existing);
    return { data: existing.data as T, stale: false };
  }

  // Deduplicate in-flight requests
  const pending = inflight.get(url);
  if (pending) {
    return pending as Promise<CachedFetchResult<T>>;
  }

  const promise = (async (): Promise<CachedFetchResult<T>> => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        // Stale-while-error: serve stale data if available, and SAY it is stale.
        if (existing) {
          return { data: existing.data as T, stale: true };
        }
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      cache.set(url, { data, timestamp: Date.now() });
      evict();
      return { data: data as T, stale: false };
    } catch (err) {
      // Stale-while-error: serve stale data on network failure, flagged.
      if (existing) {
        return { data: existing.data as T, stale: true };
      }
      throw err;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, promise);
  return promise;
}

/**
 * Cached fetch with in-flight deduplication and stale-while-error.
 * Drop-in replacement for fetch() in client components.
 *
 * Discards the staleness flag — see `cachedFetchWithMeta()` when the caller
 * needs to know whether it is holding a stale fallback.
 */
export async function cachedFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  return (await cachedFetchWithMeta<T>(url, init)).data;
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

/** Test-only view of the bounded map's occupancy and eviction ceiling. */
export function clientCacheStats(): { size: number; maxEntries: number } {
  return { size: cache.size, maxEntries: MAX_CACHE_ENTRIES };
}
