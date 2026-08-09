import { describe, expect, it, vi } from "vitest";
import {
  fetchPermitArea,
  formatPermitAreaDate,
  formatPermitAreaCoverageLabel,
  permitAreaRequestPath,
  type PermitAreaResult,
} from "@/lib/permit-area";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.65, 41.87],
      [-87.6, 41.87],
      [-87.6, 41.9],
      [-87.65, 41.9],
      [-87.65, 41.87],
    ],
  ],
};

const RESULT: PermitAreaResult = {
  status: "ready",
  source: { label: "City permits", url: "https://example.com/data", portalUrl: "https://example.com/verify" },
  dataWindow: "Since 2015",
  sourceRefresh: {
    asOf: "2026-08-04T18:22:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 1,
  distinctAddresses: 1,
  issueDateSpan: { first: "2026-08-04", latest: "2026-08-04" },
  typeBreakdown: [],
  yearBreakdown: [],
  statusBreakdown: [],
  records: [],
  recordsReturned: 0,
  recordsTruncated: true,
};

describe("permit area client", () => {
  it("builds a reproducible polygon request", () => {
    const path = permitAreaRequestPath(POLYGON);
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/api/permit-area");
    expect(JSON.parse(url.searchParams.get("polygon") ?? "")).toEqual(POLYGON);
  });

  it("returns a ready source-backed result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchPermitArea(POLYGON, { fetchImpl })).resolves.toEqual(RESULT);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats HTTP and malformed readiness responses as lookup failures", async () => {
    const unavailable = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchPermitArea(POLYGON, { fetchImpl: unavailable })).rejects.toThrow("HTTP 503");

    const malformed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "partial" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchPermitArea(POLYGON, { fetchImpl: malformed })).rejects.toThrow("not ready");

    const missingFreshness = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...RESULT, sourceRefresh: undefined }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      fetchPermitArea(POLYGON, { fetchImpl: missingFreshness }),
    ).rejects.toThrow("not ready");
  });

  it("relays cancellation and applies a bounded request timeout", async () => {
    const abortingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const caller = new AbortController();
    const cancelled = fetchPermitArea(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      signal: caller.signal,
      timeoutMs: 1_000,
    });
    caller.abort(new DOMException("Caller stopped", "AbortError"));
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const timedOut = fetchPermitArea(POLYGON, {
      fetchImpl: abortingFetch as typeof fetch,
      timeoutMs: 5,
    });
    await expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("formats source dates without changing unparseable values", () => {
    expect(formatPermitAreaDate("2026-08-04")).toBe("Aug 4, 2026");
    expect(formatPermitAreaDate("source value")).toBe("source value");
    expect(formatPermitAreaDate(null)).toBe("Not recorded");
    expect(formatPermitAreaCoverageLabel(RESULT)).toBe(
      "Since 2015; database updated Aug 4, 2026",
    );
    expect(
      formatPermitAreaCoverageLabel({
        ...RESULT,
        sourceRefresh: { asOf: null, asOfBasis: null },
      }),
    ).toBe("Since 2015; database update date unavailable");
  });
});
