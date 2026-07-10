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
});
