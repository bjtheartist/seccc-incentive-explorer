import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R2 finding 2 — /api/report/generate had no rate limit of any kind.
 *
 * It is the most expensive endpoint in the app (it runs the whole report
 * engine against the full internal catalog on every call) and anyone could
 * drive it in a loop with no account, no key and no ceiling.
 *
 * The limiter deliberately mirrors `reserveReportEmailDelivery` in
 * lib/report-email-delivery.ts — hashed client identifier, one row per
 * attempt, a rolling window counted in SQL, Retry-After in seconds — with ONE
 * difference: it fails OPEN. /api/email-report 503s when its storage is
 * unreachable, which is right for it, because it cannot send an email without
 * recording the send. Report generation needs no database at all, so treating
 * an outage as a reason to stop generating reports would turn a degraded
 * dependency into an outage of the app's core feature.
 */

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("../db", () => ({ getSQL: getSQLMock }));
vi.mock("server-only", () => ({}));

import {
  REPORT_GENERATE_HOURLY_LIMIT,
  REPORT_GENERATE_WINDOW_SECONDS,
  __resetReportGenerateStorageForTests,
  reportGenerateClientIdentifier,
  reserveReportGeneration,
} from "../report-generate-rate-limit";

/** Count queries return a row; migrations and the INSERT return nothing. */
function sqlReturning(count: number) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("");
    if (text.includes("SELECT COUNT(*)")) return [{ request_count: count }];
    return [];
  });
}

beforeEach(() => {
  __resetReportGenerateStorageForTests();
  getSQLMock.mockReset().mockReturnValue(sqlMock);
  sqlMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client identification", () => {
  it("uses the first forwarded IP", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(reportGenerateClientIdentifier(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(reportGenerateClientIdentifier(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
  });

  it("buckets by user-agent rather than lumping everyone into one counter", () => {
    const a = reportGenerateClientIdentifier(new Headers({ "user-agent": "Browser A" }));
    const b = reportGenerateClientIdentifier(new Headers({ "user-agent": "Browser B" }));
    expect(a).not.toBe(b);
    expect(a).toContain("unknown:");
  });

  it("still returns something stable with no headers at all", () => {
    expect(reportGenerateClientIdentifier(new Headers())).toBe("unknown:no-user-agent");
  });
});

describe("the limit itself", () => {
  it("allows a client under the hourly limit and records the attempt", async () => {
    const sql = sqlReturning(REPORT_GENERATE_HOURLY_LIMIT - 1);
    getSQLMock.mockReturnValue(sql);

    await expect(reserveReportGeneration("203.0.113.7")).resolves.toEqual({
      allowed: true,
      degraded: false,
    });

    const statements = sql.mock.calls.map((call) => (call[0] as TemplateStringsArray).join(""));
    expect(statements.some((s) => s.includes("INSERT INTO report_generate_requests"))).toBe(true);
  });

  it("refuses a client at the limit, with Retry-After", async () => {
    getSQLMock.mockReturnValue(sqlReturning(REPORT_GENERATE_HOURLY_LIMIT));
    await expect(reserveReportGeneration("203.0.113.7")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: REPORT_GENERATE_WINDOW_SECONDS,
    });
  });

  it("does NOT record an attempt it refused", async () => {
    const sql = sqlReturning(REPORT_GENERATE_HOURLY_LIMIT + 50);
    getSQLMock.mockReturnValue(sql);

    await reserveReportGeneration("203.0.113.7");

    const statements = sql.mock.calls.map((call) => (call[0] as TemplateStringsArray).join(""));
    expect(statements.some((s) => s.includes("INSERT INTO"))).toBe(false);
  });

  it("hashes the client identifier — no raw IP is stored", async () => {
    const sql = sqlReturning(0);
    getSQLMock.mockReturnValue(sql);

    await reserveReportGeneration("203.0.113.7");

    const params = sql.mock.calls.flatMap((call) => call.slice(1));
    expect(params).not.toContain("203.0.113.7");
    expect(params.some((p) => typeof p === "string" && /^[0-9a-f]{64}$/.test(p))).toBe(true);
  });

  it("counts a rolling one-hour window", async () => {
    const sql = sqlReturning(0);
    getSQLMock.mockReturnValue(sql);

    await reserveReportGeneration("203.0.113.7");

    const statements = sql.mock.calls.map((call) => (call[0] as TemplateStringsArray).join(""));
    expect(statements.some((s) => s.includes("INTERVAL '1 hour'"))).toBe(true);
  });

  it("sets a limit generous enough for a real session but bounded", () => {
    // A heavy visitor generates on load plus refine/compare/quick-refine.
    expect(REPORT_GENERATE_HOURLY_LIMIT).toBeGreaterThan(50);
    expect(REPORT_GENERATE_HOURLY_LIMIT).toBeLessThanOrEqual(500);
  });
});

describe("fails OPEN, and says so", () => {
  it("allows the request when no database is configured", async () => {
    getSQLMock.mockReturnValue(null);
    await expect(reserveReportGeneration("203.0.113.7")).resolves.toEqual({
      allowed: true,
      degraded: true,
    });
  });

  it("allows the request when the query throws, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getSQLMock.mockReturnValue(
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    await expect(reserveReportGeneration("203.0.113.7")).resolves.toEqual({
      allowed: true,
      degraded: true,
    });
    expect(error).toHaveBeenCalled();
  });

  /**
   * `degraded` is the honesty flag: an allowed request that was never actually
   * checked must not be reported the same way as one that passed the limit.
   */
  it("distinguishes an allowed-and-checked request from an allowed-but-unchecked one", async () => {
    getSQLMock.mockReturnValue(sqlReturning(1));
    const checked = await reserveReportGeneration("203.0.113.7");

    getSQLMock.mockReturnValue(null);
    const unchecked = await reserveReportGeneration("203.0.113.7");

    expect(checked).toMatchObject({ allowed: true, degraded: false });
    expect(unchecked).toMatchObject({ allowed: true, degraded: true });
  });
});
