import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * R2 finding 3 — /api/parcel's Redis cache made three freshness/correctness
 * claims it had not earned:
 *
 * 1. A 30-day TTL. PIN splits and consolidations, class changes, address
 *    corrections and demolitions all land inside a month, so a month-old
 *    answer was being served as the County record.
 * 2. It cached `addressMatch: "mismatch"` — the endpoint's OWN admission that
 *    the parcel it found is probably not the one the caller asked about. That
 *    pinned the wrong parcel to an address for the life of the entry and kept
 *    re-serving it after the retry that would have resolved it correctly.
 * 3. Coordinate keys rounded to 4 decimals (~11m). This route resolves WHICH
 *    PARCEL an address is, and Chicago lots are routinely narrower than 11m,
 *    so two points on genuinely different parcels could share one key and be
 *    served each other's record.
 *
 * Plus: nothing carried the instant the County was actually read, so a
 * day-old cache hit was indistinguishable from a live lookup.
 */

const { cachedMock, getSQLMock, sqlMock } = vi.hoisted(() => ({
  cachedMock: vi.fn(),
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/redis", () => ({
  // Unlike the sibling suite's mock, this one HONORS the decimals argument —
  // the 4-vs-6 decimal bucket is precisely what is under test here.
  roundCoord: (value: number, decimals = 4) => value.toFixed(decimals),
  cached: cachedMock,
}));

import { GET } from "./route";

/** The TTL argument /api/parcel passes to `cached()`, as a function. */
type TtlResolver = (value: unknown) => number;

function ttlResolver(): TtlResolver {
  const arg = cachedMock.mock.calls[0]?.[1];
  expect(typeof arg, "the TTL argument must be a function so mismatches can opt out").toBe(
    "function",
  );
  return arg as TtlResolver;
}

function cacheKey(): string {
  return cachedMock.mock.calls[0]?.[0] as string;
}

const COOKVIEWER_PARCEL = {
  ok: true,
  status: 200,
  json: async () => ({
    features: [
      {
        attributes: {
          pin14: "20123456789012",
          property_address: "100 E TEST ST",
          property_zip: "60617",
          class: "5-17",
        },
        geometry: { rings: [[[-87.6, 41.75]]] },
      },
    ],
  }),
};

beforeEach(() => {
  vi.stubEnv("PARCEL_DB_LOOKUPS_ENABLED", "false");
  cachedMock
    .mockReset()
    .mockImplementation(async (_key: string, _ttl: unknown, loader: () => Promise<unknown>) =>
      loader(),
    );
  getSQLMock.mockReset().mockReturnValue(sqlMock);
  sqlMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parcel cache TTL", () => {
  it("caches an ordinary result for 24 hours, not 30 days", async () => {
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    const ttl = ttlResolver();
    expect(ttl({ addressMatch: "pin" })).toBe(24 * 60 * 60);
    expect(ttl({ addressMatch: "pin" })).not.toBe(2592000);
  });

  it.each(["pin", "point", "verified"])("caches an addressMatch:%s result", async (match) => {
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(ttlResolver()({ addressMatch: match })).toBe(24 * 60 * 60);
  });

  /**
   * A TTL of 0 makes lib/redis.ts's `cached()` skip the write entirely while
   * still returning the value to this caller — so a mismatch is answered once
   * and never pinned.
   */
  it("REFUSES to cache an addressMatch:mismatch result", async () => {
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(ttlResolver()({ addressMatch: "mismatch" })).toBe(0);
  });

  it("caches a null (no parcel found) result normally", async () => {
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(ttlResolver()(null)).toBe(24 * 60 * 60);
  });
});

describe("parcel cache key", () => {
  it("is versioned v6, so every v5 entry is orphaned on deploy", async () => {
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(cacheKey()).toContain("parcel:v6:");
    expect(cacheKey()).not.toContain("parcel:v5:");
  });

  it("rounds coordinates to 6 decimals, not the shared 4-decimal default", async () => {
    await GET(new NextRequest("http://localhost/api/parcel?lat=41.7512345&lon=-87.6512345"));
    expect(cacheKey()).toBe("parcel:v6:cookviewer:41.751235:-87.651235");
  });

  it("gives two points ~5m apart DIFFERENT keys (they were colliding at 4 decimals)", async () => {
    // Resolve to "no features" immediately: this test is about the KEY, and a
    // failing upstream would send the resolver through its retry path.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [] }) }),
    );

    await GET(new NextRequest("http://localhost/api/parcel?lat=41.750100&lon=-87.650000"));
    const first = cacheKey();
    cachedMock.mockClear();
    await GET(new NextRequest("http://localhost/api/parcel?lat=41.750145&lon=-87.650000"));
    const second = cacheKey();

    // Both round to 41.7501 at 4 decimals — the old bucket merged them.
    expect((41.7501).toFixed(4)).toBe((41.750145).toFixed(4));
    expect(first).not.toBe(second);
  });

  it("still separates db-first from cookviewer source modes", async () => {
    vi.stubEnv("PARCEL_DB_LOOKUPS_ENABLED", "true");
    sqlMock.mockRejectedValue(new Error("no table"));
    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(cacheKey()).toBe("parcel:v6:db-first:pin:20123456789012");
  });
});

describe("checkedAt provenance", () => {
  it("stamps the instant the County was read onto the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(COOKVIEWER_PARCEL));
    const before = Date.now();
    const response = await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(typeof body.checkedAt).toBe("string");
    const stamped = new Date(body.checkedAt).getTime();
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
  });

  /**
   * The whole point: a cache HIT must report when the County was actually
   * read, not when the response was assembled. The stamp goes into the cache
   * with the record, so a hit returns the original instant untouched.
   */
  it("reports the ORIGINAL read instant on a cache hit, not 'now'", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    cachedMock.mockReset().mockResolvedValue({
      parcel: { pin: "20123456789012", address: "100 E TEST ST" },
      addressMatch: "pin",
      checkedAt: yesterday,
    });

    const response = await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    const body = await response.json();
    expect(body.checkedAt).toBe(yesterday);
  });

  it("puts checkedAt INSIDE the cached value, so it survives a round trip", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(COOKVIEWER_PARCEL));
    let stored: unknown;
    cachedMock
      .mockReset()
      .mockImplementation(async (_key: string, _ttl: unknown, loader: () => Promise<unknown>) => {
        stored = await loader();
        return stored;
      });

    await GET(new NextRequest("http://localhost/api/parcel?pin=20123456789012"));
    expect(stored).toMatchObject({ checkedAt: expect.any(String) });
  });
});
