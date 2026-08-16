import { afterEach, describe, expect, it, vi } from "vitest";
import { socrataFetch } from "../socrata";

/**
 * `revalidateSeconds` is the ONLY way a caller opts a Socrata request into
 * Next's Data Cache — the cross-instance cache that survives a serverless
 * cold start, unlike this repo's per-instance in-memory caches. It must be
 * strictly opt-in: every existing caller passes nothing and must keep the
 * uncached behavior it has today.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("socrataFetch", () => {
  it("passes next.revalidate through to fetch when a caller asks for the Data Cache", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([{ ok: true }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      socrataFetch("https://example.invalid/resource/abcd-efgh.json", undefined, {
        revalidateSeconds: 21_600,
      }),
    ).resolves.toEqual([{ ok: true }]);

    const init = fetchMock.mock.calls[0][1] as RequestInit & { next?: { revalidate?: number } };
    expect(init.next).toEqual({ revalidate: 21_600 });
    // The timeout guard is not traded away for caching.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });

  it("omits next entirely when no revalidate is requested — every existing caller is unchanged", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await socrataFetch("https://example.invalid/resource/abcd-efgh.json");
    const init = fetchMock.mock.calls[0][1] as RequestInit & { next?: unknown };
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("still returns null (never throws) on a failed response, cached or not", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("nope", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      socrataFetch("https://example.invalid/resource/abcd-efgh.json", undefined, {
        revalidateSeconds: 60,
      }),
    ).resolves.toBeNull();
  });
});
