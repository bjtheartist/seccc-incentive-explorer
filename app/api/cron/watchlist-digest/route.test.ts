import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { sqlMock, sendMock, findTifBoundaryMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  sendMock: vi.fn(),
  findTifBoundaryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: () => sqlMock,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/tif-boundary", () => ({
  findTifBoundaryAtPoint: findTifBoundaryMock,
}));

vi.mock("@/app/api/zones/check/route", () => ({
  GET: vi.fn(async () => NextResponse.json([])),
}));

vi.mock("@/lib/programs-data", () => ({
  getProgramsSync: () => [],
}));

import { GET } from "./route";

function digestRequest(path: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const watchedRows = [
  {
    user_id: "user-1",
    area_type: "point",
    area_id: "41.7355,-87.5512",
    area_label: "Commercial Ave corridor",
    email: "user1@example.com",
    name: "User One",
  },
];

beforeEach(() => {
  sqlMock.mockReset();
  sendMock.mockReset();
  findTifBoundaryMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/watchlist-digest", () => {
  it("rejects requests without the cron bearer token", async () => {
    const res = await GET(digestRequest("/api/cron/watchlist-digest"));
    expect(res.status).toBe(401);

    const wrong = await GET(
      digestRequest("/api/cron/watchlist-digest", {
        authorization: "Bearer wrong-secret",
      })
    );
    expect(wrong.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns the would-send payload for dryRun without emailing", async () => {
    sqlMock.mockResolvedValue(watchedRows);
    findTifBoundaryMock.mockResolvedValue({
      districtId: "T-999",
      rawDistrictId: "T-999",
      districtName: "Test District",
      expirationDate: isoInDays(60),
      boundaryWards: null,
    });

    const res = await GET(
      digestRequest("/api/cron/watchlist-digest?dryRun=1", {
        authorization: "Bearer test-secret",
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.dryRun).toBe(true);
    expect(payload.usersWithWatchedAreas).toBe(1);
    expect(payload.wouldSend).toHaveLength(1);
    expect(payload.wouldSend[0]).toMatchObject({
      userId: "user-1",
      email: "user1@example.com",
    });
    expect(payload.wouldSend[0].subject).toContain("upcoming deadline");
    expect(payload.wouldSend[0].areas[0]).toMatchObject({
      areaId: "41.7355,-87.5512",
      areaLabel: "Commercial Ave corridor",
    });
    expect(payload.wouldSend[0].areas[0].tif).toMatchObject({
      districtId: "T-999",
      urgent: true,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips users with zero notable items", async () => {
    sqlMock.mockResolvedValue(watchedRows);
    findTifBoundaryMock.mockResolvedValue(null); // no TIF, no programs mocked

    const res = await GET(
      digestRequest("/api/cron/watchlist-digest?dryRun=1", {
        authorization: "Bearer test-secret",
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.wouldSend).toHaveLength(0);
    expect(payload.usersSkipped).toBe(1);
  });

  it("sends one email per user with notable items", async () => {
    sqlMock.mockResolvedValue([
      ...watchedRows,
      {
        user_id: "user-1",
        area_type: "point",
        area_id: "41.7000,-87.6000",
        area_label: "Second corner",
        email: "user1@example.com",
        name: "User One",
      },
    ]);
    findTifBoundaryMock.mockResolvedValue({
      districtId: "T-999",
      rawDistrictId: "T-999",
      districtName: "Test District",
      expirationDate: isoInDays(200),
      boundaryWards: null,
    });
    sendMock.mockResolvedValue({ id: "email-1" });

    const res = await GET(
      digestRequest("/api/cron/watchlist-digest", {
        authorization: "Bearer test-secret",
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, emailsSent: 1, failed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["user1@example.com"]);
    expect(sendMock.mock.calls[0][0].html).toContain(
      "Manage watched areas in your workspace"
    );
  });
});
