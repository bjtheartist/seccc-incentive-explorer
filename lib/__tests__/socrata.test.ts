import { afterEach, describe, expect, it, vi } from "vitest";
import { socrataFetch, socrataFetchResult } from "../socrata";

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

/**
 * R1 finding 4 (the false-claims class). `socrataFetch` collapsed EVERY
 * failure mode into `null`, so a caller could not tell "the portal answered,
 * and it holds no rows" from "the portal never answered" — and the callers
 * that could not tell published the second as the first. `socrataFetchResult`
 * names the mode; these pin that it names the RIGHT one.
 */
describe("socrataFetchResult — the failure MODE, not just failure", () => {
  it("reports a non-2xx as http_error, carrying the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const result = await socrataFetchResult("https://example.invalid/resource/abcd-efgh.json");
    expect(result).toEqual({ ok: false, reason: "http_error", detail: "HTTP 503" });
  });

  it("reports an aborted request as a timeout, distinctly from a transport failure", async () => {
    const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw timeout; }));
    const result = await socrataFetchResult("https://example.invalid/resource/abcd-efgh.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  it("reports a rejected fetch as network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const result = await socrataFetchResult("https://example.invalid/resource/abcd-efgh.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("network_error");
  });

  it("reports an unparseable 2xx body as invalid_json rather than as data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 })),
    );
    const result = await socrataFetchResult("https://example.invalid/resource/abcd-efgh.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_json");
  });

  it("returns the parsed rows on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ a: 1 }])));
    const result = await socrataFetchResult<{ a: number }[]>("https://example.invalid/x.json");
    expect(result).toEqual({ ok: true, data: [{ a: 1 }] });
  });

  it("an EMPTY 200 is ok:true with zero rows — a real answer, never a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const result = await socrataFetchResult<unknown[]>("https://example.invalid/x.json");
    expect(result).toEqual({ ok: true, data: [] });
  });
});
