importScripts("lookup.js");

const CACHE_KEY = "cie_lookup_cache_v1";
const MAX_ENTRIES = 20;
const TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;

// One writer: simultaneous popup and content-script requests never interleave cache writes.
let pending = Promise.resolve();

async function readCache() {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    const raw = stored && stored[CACHE_KEY];
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

// Drop expired entries, then keep the 20 most recently used (LRU eviction).
function prune(cache, now) {
  const live = Object.entries(cache)
    .filter(([, entry]) => entry && entry.result && Number.isFinite(entry.usedAt) && now - entry.savedAt < TTL_MS)
    .sort((a, b) => b[1].usedAt - a[1].usedAt)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(live);
}

async function writeCache(cache) {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

async function runLookup(address) {
  const key = CieLookup.normalizeAddress(address);
  if (!key) return { error: CieLookup.NOT_FOUND_MESSAGE };
  const now = Date.now();
  const cache = prune(await readCache(), now);

  const hit = cache[key];
  if (hit) {
    hit.usedAt = now;
    await writeCache(cache);
    return { result: hit.result };
  }

  const outcome = await CieLookup.lookupAddress(fetch, address);
  if (!outcome || outcome.status !== "ok") {
    return { error: (outcome && outcome.message) || CieLookup.UNAVAILABLE_MESSAGE };
  }
  cache[key] = { savedAt: now, usedAt: now, result: outcome };
  await writeCache(prune(cache, now));
  return { result: outcome };
}

// The recent list is derived from the cache; there is no second store to keep in sync.
async function recentLookups() {
  const cache = prune(await readCache(), Date.now());
  return Object.values(cache)
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, RECENT_LIMIT)
    .map(entry => ({
      address: entry.result.address,
      matchedCount: Array.isArray(entry.result.matched) ? entry.result.matched.length : 0,
      usedAt: entry.usedAt
    }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "cie_lookup") {
    const result = pending.then(() => runLookup(message.address));
    pending = result.catch(() => {});
    result.then(sendResponse, () => sendResponse({ error: CieLookup.UNAVAILABLE_MESSAGE }));
    return true;
  }
  if (message?.type === "cie_recent") {
    const result = pending.then(recentLookups);
    pending = result.catch(() => {});
    result.then(items => sendResponse({ items }), () => sendResponse({ items: [] }));
    return true;
  }
  return false;
});
