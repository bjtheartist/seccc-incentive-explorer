import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * R2 finding 7 — the watchlist-digest cron failed OPEN.
 *
 * Its authorization ended:
 *
 *     if (secret) return header === `Bearer ${secret}`;
 *     return process.env.NODE_ENV !== "production";
 *
 * With CRON_SECRET unset, ANY unauthenticated request was authorized on any
 * deployment whose NODE_ENV was not exactly "production". Preview deployments
 * are the obvious case: they run against real infrastructure, carry real user
 * rows, and this route reads every user's watched areas and SENDS THEM EMAIL.
 * "Not production" was standing in for "not real", and those are not the same
 * thing.
 *
 * app/api/cron/sync-permits/route.ts already had this right — a missing secret
 * means the cron is not configured, and it refuses. This suite pins the
 * watchlist digest to the same contract.
 */

const { sqlMock, sendMock, findTifBoundaryMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  sendMock: vi.fn(),
  findTifBoundaryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));
vi.mock("@/lib/tif-boundary", () => ({ findTifBoundaryAtPoint: findTifBoundaryMock }));
vi.mock("@/app/api/zones/check/v2/route", () => ({
  GET: vi.fn(async () =>
    NextResponse.json({
      schemaVersion: 2,
      dataRevision: "test-revision",
      checkedAt: new Date().toISOString(),
      requestedLayers: [],
      layers: {},
    }),
  ),
}));
vi.mock("@/lib/programs-data", () => ({ getProgramsSync: () => [] }));

import { GET } from "./route";
import { GET as SYNC_PERMITS_GET } from "../sync-permits/route";

function request(headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/cron/watchlist-digest", { headers });
}

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  sendMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CRON_SECRET unset — fails CLOSED in every environment", () => {
  it.each(["development", "test", "preview", "production"])(
    "refuses an unauthenticated request when NODE_ENV is %s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv as "development");
      vi.stubEnv("CRON_SECRET", "");

      const res = await GET(request());

      expect(res.status, `NODE_ENV=${nodeEnv} must not open the door`).toBe(503);
      expect(await res.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) });
    },
  );

  it("does not read a single user row or send a single email when unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");

    await GET(request());

    expect(sqlMock, "an unconfigured cron must not touch the database").not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("is not fooled by a request that supplies its own Authorization header", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(request({ authorization: "Bearer anything" }));
    expect(res.status).toBe(503);
  });

  it("marks the refusal no-store so it is never cached", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(request());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("CRON_SECRET set — normal bearer-token contract", () => {
  it("rejects a missing Authorization header with 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token with 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(request({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  /**
   * Proven by WHICH refusal comes back. Past the auth gate the route reaches
   * its downstream configuration checks, so an authorized request with no
   * Resend key is refused for "Email service not configured" — a different
   * failure from the gate's own "not configured"/"Unauthorized".
   */
  it("admits the correct bearer token and proceeds past the gate", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("RESEND_API_KEY", "");

    const res = await GET(request({ authorization: "Bearer s3cret" }));
    expect(res.status).not.toBe(401);
    expect(await res.json()).toMatchObject({ error: "Email service not configured" });
  });

  it("reaches the database on a dryRun, which needs no email key", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(
      new NextRequest("http://localhost/api/cron/watchlist-digest?dryRun=1", {
        headers: { authorization: "Bearer s3cret" },
      }),
    );
    expect(res.status).not.toBe(401);
    expect(sqlMock, "a correctly authorized cron must get past the gate").toHaveBeenCalled();
  });
});

describe("matches the sibling cron that already had this right", () => {
  it("sync-permits and watchlist-digest both answer 503 when unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");

    const digest = await GET(request());
    const permits = await SYNC_PERMITS_GET(
      new NextRequest("http://localhost/api/cron/sync-permits"),
    );

    expect(digest.status).toBe(503);
    expect(permits.status).toBe(503);
  });
});
