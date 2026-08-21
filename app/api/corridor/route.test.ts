import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

import { GET } from "./route";

beforeEach(() => {
  getSQLMock.mockReset();
});

describe("GET /api/corridor", () => {
  it("never exposes the internal corridor score", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        corridor_type: "zip",
        corridor_id: "60617",
        as_of: "2026-07-03",
        vacancy_rate: 0.06,
        turnover_rate: 0.04,
        ownership_hhi: 0.001,
        local_ownership_share: 0.62,
        permit_count: 1641,
        incentive_coverage: null,
        health_score: 91,
        computed_at: "2026-07-03T16:13:45.727Z",
        details: {},
      },
    ]);
    getSQLMock.mockReturnValue(sql);

    const response = await GET(
      new NextRequest("http://localhost/api/corridor?zip=60617"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.corridors).toHaveLength(1);
    expect(body.corridors[0]).not.toHaveProperty("healthScore");
    expect(JSON.stringify(body)).not.toMatch(/health.?score/i);
  });

  it("falls back to the committed static snapshot when the table has no rows", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    getSQLMock.mockReturnValue(sql);

    const response = await GET(
      new NextRequest("http://localhost/api/corridor?zip=60617"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.corridors).toHaveLength(1);
    expect(body.corridors[0].corridorId).toBe("60617");
    // The snapshot's own vintage fields survive — the fallback never
    // re-stamps or invents freshness.
    expect(body.corridors[0].asOf).toBeTruthy();
    expect(body.corridors[0].computedAt).toBeTruthy();
    expect(body.corridors[0].vacancyRate).not.toBeNull();
  });

  it("serves every ZIP from the static snapshot when unfiltered and the table is empty", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    getSQLMock.mockReturnValue(sql);

    const response = await GET(new NextRequest("http://localhost/api/corridor"));
    const body = await response.json();

    expect(response.status).toBe(200);
    const ids = body.corridors.map((c: { corridorId: string }) => c.corridorId).sort();
    expect(ids).toEqual(["60617", "60619", "60649"]);
  });

  it("falls back to the static snapshot when DATABASE_URL is not configured", async () => {
    getSQLMock.mockReturnValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/corridor?zip=60649"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.corridors).toHaveLength(1);
    expect(body.corridors[0].corridorId).toBe("60649");
  });

  it("falls back to the static snapshot when the corridor_metrics table is missing (42P01)", async () => {
    const sql = vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    getSQLMock.mockReturnValue(sql);

    const response = await GET(
      new NextRequest("http://localhost/api/corridor?zip=60619"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.corridors).toHaveLength(1);
    expect(body.corridors[0].corridorId).toBe("60619");
  });

  it("prefers DB rows over the static snapshot when rows exist", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        corridor_type: "zip",
        corridor_id: "60617",
        as_of: "2026-08-01",
        vacancy_rate: 0.09,
        turnover_rate: null,
        ownership_hhi: null,
        local_ownership_share: null,
        permit_count: 7,
        incentive_coverage: null,
        computed_at: "2026-08-01T00:00:00.000Z",
        details: {},
      },
    ]);
    getSQLMock.mockReturnValue(sql);

    const response = await GET(
      new NextRequest("http://localhost/api/corridor?zip=60617"),
    );
    const body = await response.json();

    expect(body.corridors[0].asOf).toBe("2026-08-01");
    expect(body.corridors[0].vacancyRate).toBe(0.09);
  });
});
