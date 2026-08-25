import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { getSQLMock, runDailyPermitSyncMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  runDailyPermitSyncMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));
vi.mock("@/lib/ingest/permit-daily-sync", () => ({
  runDailyPermitSync: runDailyPermitSyncMock,
}));

import { GET } from "./route";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/sync-permits", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "daily-secret");
  getSQLMock.mockReset();
  runDailyPermitSyncMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/sync-permits", () => {
  it("fails closed when CRON_SECRET is absent or the bearer token is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const unconfigured = await GET(request());
    expect(unconfigured.status).toBe(503);

    vi.stubEnv("CRON_SECRET", "daily-secret");
    const unauthorized = await GET(request("Bearer wrong"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("no-store");
    expect(getSQLMock).not.toHaveBeenCalled();
    expect(runDailyPermitSyncMock).not.toHaveBeenCalled();
  });

  it("runs the authenticated incremental sync and never caches its result", async () => {
    runDailyPermitSyncMock.mockResolvedValue({
      status: "synced",
      rowsChanged: 12,
      rowsFetched: 12,
      rowsWritten: 11,
      rowsRemoved: 1,
      cursor: "2026-08-25T12:27:11.706Z",
    });

    const response = await GET(request("Bearer daily-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "synced", rowsChanged: 12 });
    expect(runDailyPermitSyncMock).toHaveBeenCalledWith({ sql: sqlMock });
  });

  it("returns a non-success status when the source surge guard blocks writes", async () => {
    runDailyPermitSyncMock.mockResolvedValue({
      status: "surge_blocked",
      rowsChanged: 845_251,
      rowsFetched: 0,
      rowsWritten: 0,
      rowsRemoved: 0,
      cursor: "2026-08-24T12:00:00.000Z",
    });

    const response = await GET(request("Bearer daily-secret"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "surge_blocked",
      rowsWritten: 0,
    });
  });

  it("is scheduled exactly once per day in UTC", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: { path: string; schedule: string }[] };
    const jobs = config.crons?.filter((job) => job.path === "/api/cron/sync-permits");
    expect(jobs).toEqual([{ path: "/api/cron/sync-permits", schedule: "30 14 * * *" }]);
  });
});
