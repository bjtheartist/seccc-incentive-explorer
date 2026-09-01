import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedFetch,
  cachedFetchWithMeta,
  clientCacheStats,
  invalidateClientCache,
} from "../fetch-cache";

/**
 * R2 finding 4 — lib/fetch-cache.ts served stale data as if it were fresh,
 * and grew forever.
 *
 * Two separate defects:
 *
 * 1. Serve-stale-on-error was INVISIBLE. When a fetch failed, the cache
 *    returned an expired body through the same `Promise<T>` a live 200
 *    returns. Nothing downstream could distinguish a current answer from a
 *    days-old one, so no surface could have disclosed the difference even if
 *    it wanted to. The behavior itself is right — a stale zoning payload
 *    beats an empty panel — but it has to be visible to callers.
 *
 * 2. The Map was UNBOUNDED. The high-cardinality keys here are
 *    coordinate-bearing (`/api/parcel?lat=…`, viewport-bounded
 *    `/api/vacant?bounds=…`), so panning a map accumulates full JSON bodies
 *    that nothing ever evicts for the life of the tab.
 */

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  invalidateClientCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  invalidateClientCache();
});

describe("cachedFetchWithMeta — honest staleness", () => {
  it("reports a live fetch as not stale", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ v: 1 }));
    const result = await cachedFetchWithMeta<{ v: number }>("/api/census?lat=41.7&lon=-87.6");
    expect(result).toEqual({ data: { v: 1 }, stale: false });
  });

  it("reports a within-TTL cache hit as not stale — a warm cache is not staleness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ v: 1 }));
    globalThis.fetch = fetchMock;
    const url = "/api/census?lat=41.7&lon=-87.6";

    await cachedFetchWithMeta(url);
    vi.advanceTimersByTime(60_000); // /api/census TTL is 30 minutes
    const second = await cachedFetchWithMeta<{ v: number }>(url);

    expect(second).toEqual({ data: { v: 1 }, stale: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a stale body served after a non-ok response", async () => {
    const url = "/api/zoning?lat=41.7&lon=-87.6";
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ zone: "B3-2" }));
    await cachedFetchWithMeta(url);

    // Past the 30-minute /api/zoning TTL, and the origin is now failing.
    vi.advanceTimersByTime(31 * 60_000);
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, false));

    const result = await cachedFetchWithMeta<{ zone: string }>(url);
    expect(result.data).toEqual({ zone: "B3-2" });
    expect(result.stale, "a served-stale body must announce itself").toBe(true);
  });

  it("flags a stale body served after a thrown network error", async () => {
    const url = "/api/districts?lat=41.7&lon=-87.6";
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ward: 10 }));
    await cachedFetchWithMeta(url);

    vi.advanceTimersByTime(31 * 60_000);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    const result = await cachedFetchWithMeta<{ ward: number }>(url);
    expect(result.data).toEqual({ ward: 10 });
    expect(result.stale).toBe(true);
  });

  it("still THROWS when the fetch fails and there is nothing stale to serve", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(null, false));
    await expect(cachedFetchWithMeta("/api/stats")).rejects.toThrow(/Fetch failed/);
  });

  it("does not cache or flag non-GET requests", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await cachedFetchWithMeta("/api/report/generate", { method: "POST" });
    expect(result.stale).toBe(false);
    expect(clientCacheStats().size).toBe(0);
  });

  it("deduplicates concurrent in-flight requests for the same URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ v: 7 }));
    globalThis.fetch = fetchMock;
    const url = "/api/stats";

    const [a, b] = await Promise.all([cachedFetchWithMeta(url), cachedFetchWithMeta(url)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ data: { v: 7 }, stale: false });
    expect(b).toEqual({ data: { v: 7 }, stale: false });
  });
});

describe("cachedFetch — unchanged signature", () => {
  it("returns the body directly, so existing callers are untouched", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ v: 42 }));
    await expect(cachedFetch<{ v: number }>("/api/stats")).resolves.toEqual({ v: 42 });
  });

  it("keeps serving stale on error (behavior preserved, just no longer silent to callers who ask)", async () => {
    const url = "/api/tif-finance?lat=41.7&lon=-87.6";
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ tif: "Chatham" }));
    await cachedFetch(url);

    vi.advanceTimersByTime(61 * 60_000);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(cachedFetch(url)).resolves.toEqual({ tif: "Chatham" });
  });
});

describe("bounded cache", () => {
  it("never exceeds the max-entries ceiling no matter how many distinct URLs are fetched", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => jsonResponse({ v: 1 }));
    const { maxEntries } = clientCacheStats();

    for (let i = 0; i < maxEntries + 120; i++) {
      // Coordinate-bearing keys: exactly the high-cardinality shape that used
      // to grow the map without bound.
      await cachedFetchWithMeta(`/api/parcel?lat=41.${i}&lon=-87.6`);
    }

    const { size } = clientCacheStats();
    expect(size).toBeLessThanOrEqual(maxEntries);
    expect(size, "eviction must not empty the cache either").toBeGreaterThan(maxEntries / 2);
  });

  it("evicts least-recently-used entries, keeping the ones still being read", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => jsonResponse({ v: 1 }));
    const { maxEntries } = clientCacheStats();
    const keeper = "/api/parcel?lat=41.0000&lon=-87.0000";

    await cachedFetchWithMeta(keeper);

    for (let i = 0; i < maxEntries + 50; i++) {
      await cachedFetchWithMeta(`/api/parcel?lat=41.${i}&lon=-87.6`);
      // Re-read the keeper so it stays the most-recently-used entry.
      await cachedFetchWithMeta(keeper);
    }

    // A surviving keeper serves from cache without a new network call.
    const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await cachedFetchWithMeta(keeper);
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
      "the most-recently-used entry must survive eviction",
    ).toBe(callsBefore);
  });

  it("invalidateClientCache still clears everything", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ v: 1 }));
    await cachedFetchWithMeta("/api/stats");
    expect(clientCacheStats().size).toBe(1);
    invalidateClientCache();
    expect(clientCacheStats().size).toBe(0);
  });
});
