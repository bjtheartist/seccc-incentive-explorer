// Service Worker for SECCC Incentive Explorer
// Implements cache-first for static data, stale-while-revalidate for API responses

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `seccc-static-${CACHE_VERSION}`;
const API_CACHE = `seccc-api-${CACHE_VERSION}`;
const API_CACHE_MAX_ENTRIES = 100;

// --- Route matchers ---

function isStaticData(url) {
  const path = url.pathname;
  return (
    path.match(/^\/data\/zones\/.*\.geojson$/) ||
    path.match(/^\/data\/.*\.json$/)
  );
}

function isApiCacheable(url) {
  const path = url.pathname;
  return (
    path === '/api/programs' ||
    path.startsWith('/api/businesses') ||
    path.startsWith('/api/zones/check') ||
    path.startsWith('/api/zones/geojson/') ||
    path.startsWith('/api/census') ||
    path.startsWith('/api/assets') ||
    path === '/api/stats'
  );
}

function isNetworkOnly(url) {
  const path = url.pathname;
  return (
    path.startsWith('/api/geocode') ||
    path.startsWith('/api/zoning')
  );
}

// --- Cache helpers ---

/**
 * Trim the API cache to at most API_CACHE_MAX_ENTRIES entries.
 * Deletes the oldest entries (those inserted first) when the limit is exceeded.
 */
async function trimApiCache() {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    if (keys.length > API_CACHE_MAX_ENTRIES) {
      const excess = keys.length - API_CACHE_MAX_ENTRIES;
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (_e) {
    // Silently ignore trim errors
  }
}

// --- Strategies ---

/**
 * Cache-first: check cache, return if found.
 * On miss, fetch from network, cache the response, and return it.
 */
async function cacheFirst(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_error) {
    // If both cache and network fail, try cache one more time (offline scenario)
    const fallback = await caches.match(request);
    if (fallback) {
      return fallback;
    }
    return new Response(
      JSON.stringify({ error: 'Offline and no cached data available' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Stale-while-revalidate: return cached response immediately if available,
 * and fetch a fresh copy in the background to update the cache.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  // Always kick off a network fetch to update the cache in the background
  const networkFetch = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse.ok) {
        await cache.put(request, networkResponse.clone());
        await trimApiCache();
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    // Return stale response immediately; background fetch updates cache
    return cached;
  }

  // No cached response — must wait for network
  try {
    const networkResponse = await networkFetch;
    if (networkResponse) {
      return networkResponse;
    }
    return new Response(
      JSON.stringify({ error: 'Network request failed and no cached data available' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (_e2) {
    return new Response(
      JSON.stringify({ error: 'Network request failed and no cached data available' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// --- Service Worker lifecycle ---

self.addEventListener('install', (_event) => {
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches that don't match the current version
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Delete any seccc-* cache that isn't one of our current caches
            return (
              name.startsWith('seccc-') &&
              name !== STATIC_CACHE &&
              name !== API_CACHE
            );
          })
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Claim all open clients so the SW takes effect immediately
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-only: never cache user-specific lookups
  if (isNetworkOnly(url)) {
    return;
  }

  // Cache-first for static data files
  if (isStaticData(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Stale-while-revalidate for cacheable API routes
  if (isApiCacheable(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // All other requests: let the browser handle normally
});
