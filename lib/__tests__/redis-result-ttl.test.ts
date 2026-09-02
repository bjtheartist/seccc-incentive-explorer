import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redisGet, redisSet } = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisGet;
    set = redisSet;
  },
}));

import { cached, memCached } from "@/lib/redis";

beforeEach(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://cache.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  redisGet.mockReset().mockResolvedValue(null);
  redisSet.mockReset().mockResolvedValue("OK");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cached result-derived TTL", () => {
  it("writes a numeric TTL unchanged", async () => {
    const result = await cached("numeric", 60, async () => ({ status: "ok" }));

    expect(result).toEqual({ status: "ok" });
    expect(redisSet).toHaveBeenCalledWith(
      "numeric",
      JSON.stringify(result),
      { ex: 60 },
    );
  });

  it("writes the TTL selected from each loaded result", async () => {
    const degraded = await cached(
      "degraded",
      (value: { degraded: boolean }) => value.degraded ? 300 : 21_600,
      async () => ({ degraded: true }),
    );
    const healthy = await cached(
      "healthy",
      (value: { degraded: boolean }) => value.degraded ? 300 : 21_600,
      async () => ({ degraded: false }),
    );

    expect(redisSet).toHaveBeenNthCalledWith(
      1,
      "degraded",
      JSON.stringify(degraded),
      { ex: 300 },
    );
    expect(redisSet).toHaveBeenNthCalledWith(
      2,
      "healthy",
      JSON.stringify(healthy),
      { ex: 21_600 },
    );
  });

  it("does not write invalid or nonpositive selected TTLs", async () => {
    await cached("zero", () => 0, async () => ({ status: "degraded" }));
    await cached("invalid", () => Number.NaN, async () => ({ status: "degraded" }));

    expect(redisSet).not.toHaveBeenCalled();
  });

  it("returns the loaded value when the selector throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await cached(
      "selector-error",
      () => { throw new Error("bad selector"); },
      async () => ({ status: "available" }),
    );

    expect(result).toEqual({ status: "available" });
    expect(redisSet).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[redis] cache write error:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

/**
 * R1 finding 3, follow-up. `cached()` already accepted a result-derived TTL,
 * but `memCached()` — the wrapper every caller actually uses — took only a
 * number, so it could not express "hold this one for minutes, that one for a
 * day". Callers that needed the distinction had no way to ask for it, which is
 * how lib/mobility-access.ts came to store a transient upstream outage under a
 * 24-hour key. The selector now reaches both layers.
 */
describe("memCached result-derived TTL", () => {
  it("passes the selector through to Redis, so a degraded result gets the short key", async () => {
    const selectTTL = (value: { degraded: boolean }) => (value.degraded ? 300 : 86_400);

    await memCached("mem-degraded", selectTTL, async () => ({ degraded: true }));
    await memCached("mem-healthy", selectTTL, async () => ({ degraded: false }));

    expect(redisSet).toHaveBeenNthCalledWith(
      1,
      "mem-degraded",
      JSON.stringify({ degraded: true }),
      { ex: 300 },
    );
    expect(redisSet).toHaveBeenNthCalledWith(
      2,
      "mem-healthy",
      JSON.stringify({ degraded: false }),
      { ex: 86_400 },
    );
  });

  it("still accepts a plain number, so every existing caller is untouched", async () => {
    const result = await memCached("mem-numeric", 60, async () => ({ status: "ok" }));

    expect(result).toEqual({ status: "ok" });
    expect(redisSet).toHaveBeenCalledWith("mem-numeric", JSON.stringify(result), { ex: 60 });
  });

  it("returns the loaded value when the selector throws, matching cached()", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await memCached(
      "mem-selector-error",
      () => {
        throw new Error("bad selector");
      },
      async () => ({ status: "available" }),
    );

    expect(result).toEqual({ status: "available" });
    warn.mockRestore();
  });
});
