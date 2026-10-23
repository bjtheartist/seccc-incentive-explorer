import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INVESTMENT_SHARE_SESSION_MAX_AGE,
  createInvestmentShareSession,
  investmentShareCookieMaxAge,
  isInvestmentShareConfigured,
  parseInvestmentShareSession,
} from "@/lib/investment-share-session";

const originalSecret = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret";
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

describe("investment share sessions", () => {
  it("round-trips a signed session naming the link it came from", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const expiresAt = new Date("2026-09-25T12:00:00Z");
    const cookie = createInvestmentShareSession("42", expiresAt, now);
    expect(parseInvestmentShareSession(cookie, now)).toEqual({
      linkId: "42",
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    });
  });

  it("rejects a tampered link id, a tampered expiry, and a lapsed session", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const expiresAt = new Date("2026-09-25T12:00:00Z");
    const cookie = createInvestmentShareSession("42", expiresAt, now);
    const [, exp, sig] = cookie.split(".");
    expect(parseInvestmentShareSession(`43.${exp}.${sig}`, now)).toBeNull();
    expect(parseInvestmentShareSession(`42.${Number(exp) + 999999}.${sig}`, now)).toBeNull();
    expect(parseInvestmentShareSession(cookie, new Date("2026-09-26T12:00:00Z"))).toBeNull();
    expect(parseInvestmentShareSession("garbage", now)).toBeNull();
  });

  it("caps a long-lived link at the session ceiling", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const expiresAt = new Date("2027-03-18T12:00:00Z");
    const parsed = parseInvestmentShareSession(createInvestmentShareSession("7", expiresAt, now), now);
    expect(parsed?.expiresAt).toBe(Math.floor(now.getTime() / 1000) + INVESTMENT_SHARE_SESSION_MAX_AGE);
    expect(investmentShareCookieMaxAge(expiresAt, now)).toBe(INVESTMENT_SHARE_SESSION_MAX_AGE);
    expect(investmentShareCookieMaxAge(new Date("2026-09-18T13:00:00Z"), now)).toBe(3600);
  });

  it("is inert without a signing secret", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(isInvestmentShareConfigured()).toBe(false);
    expect(parseInvestmentShareSession("1.9999999999.abc")).toBeNull();
    expect(() => createInvestmentShareSession("1", new Date(Date.now() + 1000))).toThrow();
  });
});
