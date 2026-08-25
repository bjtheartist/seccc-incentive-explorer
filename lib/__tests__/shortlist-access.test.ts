import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHORTLIST_ACCESS_MAX_AGE,
  ShortlistAccessSignupSchema,
  createShortlistAccessSession,
  hasValidShortlistAccessSession,
  shortlistAccessSignupsToCsv,
} from "@/lib/shortlist-access";

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "shortlist-test-secret";
});

afterEach(() => {
  process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
});

describe("shortlist access", () => {
  it("requires name, title, and email", () => {
    expect(
      ShortlistAccessSignupSchema.safeParse({
        name: "Billy",
        title: "",
        email: "billy@example.com",
      }).success,
    ).toBe(false);
  });

  it("accepts an untampered session within its lifetime", () => {
    const now = Date.UTC(2026, 7, 24);
    const cookie = createShortlistAccessSession(now);
    expect(hasValidShortlistAccessSession(cookie, now + 1_000)).toBe(true);
  });

  it("rejects tampered and expired sessions", () => {
    const now = Date.UTC(2026, 7, 24);
    const cookie = createShortlistAccessSession(now);
    expect(hasValidShortlistAccessSession(`${cookie}x`, now + 1_000)).toBe(false);
    expect(
      hasValidShortlistAccessSession(
        cookie,
        now + (SHORTLIST_ACCESS_MAX_AGE + 1) * 1_000,
      ),
    ).toBe(false);
  });

  it("exports formula-safe signup CSV", () => {
    const csv = shortlistAccessSignupsToCsv([
      {
        name: "=IMPORTXML()",
        title: "Director",
        email: "billy@example.com",
        signedUpAt: "2026-08-24T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"\'=IMPORTXML()"');
    expect(csv).toContain('"Signed Up At"');
  });
});
