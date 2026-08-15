import { describe, expect, it, vi } from "vitest";
import { fetchCompleteOffsetPages } from "@/lib/complete-source-pagination";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("complete source pagination", () => {
  it("returns only after the final short page completes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(response([{ id: 3 }]));

    await expect(
      fetchCompleteOffsetPages<{ id: number }>({
        sourceLabel: "Test source",
        pageSize: 2,
        buildUrl: (offset) => `https://example.test?offset=${offset}`,
        fetchImpl,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws instead of returning accumulated rows when a later page fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(response({ error: "down" }, 503));

    await expect(
      fetchCompleteOffsetPages<{ id: number }>({
        sourceLabel: "COLS API",
        pageSize: 2,
        buildUrl: (offset) => `https://example.test?offset=${offset}`,
        fetchImpl,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("COLS API returned 503 at offset 2");
  });

  it("rejects a malformed page rather than treating it as a clean zero", async () => {
    await expect(
      fetchCompleteOffsetPages({
        sourceLabel: "311 API",
        pageSize: 1_000,
        buildUrl: () => "https://example.test",
        fetchImpl: vi.fn().mockResolvedValue(response({ rows: [] })),
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("non-array page");
  });
});
