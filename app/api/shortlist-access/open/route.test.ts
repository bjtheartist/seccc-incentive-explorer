import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  SHORTLIST_ACCESS_COOKIE,
  SHORTLIST_ACCESS_MAX_AGE,
  hasValidShortlistAccessSession,
} from "@/lib/shortlist-access";
import { GET } from "./route";

const TOKEN = "test-owner-bookmark-token".padEnd(43, "_");
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

function request(token?: string, extra = "") {
  const url = new URL("https://chicagoincentiveexplorer.com/api/shortlist-access/open");
  if (token !== undefined) url.searchParams.set("token", token);
  return new NextRequest(url + extra);
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "shortlist-direct-access-test-secret");
  vi.stubEnv("AUTH_SECRET", "");
  vi.stubEnv("SHORTLIST_ACCESS_LINK_SHA256", TOKEN_HASH);
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/shortlist-access/open", () => {
  it("opens Site Matchmaker with a valid 180-day access cookie and removes the token", async () => {
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://chicagoincentiveexplorer.com/locate");
    const cookie = response.cookies.get(SHORTLIST_ACCESS_COOKIE);
    expect(hasValidShortlistAccessSession(cookie?.value)).toBe(true);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SHORTLIST_ACCESS_MAX_AGE,
    });
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it.each([undefined, "", "bypass", "x".repeat(43), TOKEN + "x", TOKEN_HASH])(
    "rejects an absent, guessed, malformed, or hash-only token (%s)",
    async (token) => {
      const response = await GET(request(token));
      expect(response.status).toBe(403);
      expect(response.cookies.getAll()).toHaveLength(0);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it.each(["", "bad-config"])("fails closed when the link hash is unconfigured (%s)", async (hash) => {
    vi.stubEnv("SHORTLIST_ACCESS_LINK_SHA256", hash);
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(503);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("fails closed when session signing is unavailable", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(503);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("revokes the old link when its configured hash is rotated", async () => {
    vi.stubEnv("SHORTLIST_ACCESS_LINK_SHA256", createHash("sha256").update("replacement").digest("hex"));
    const response = await GET(request(TOKEN));
    expect(response.status).toBe(403);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("ignores supplied redirect targets", async () => {
    const response = await GET(request(TOKEN, "&next=https://example.com&returnTo=//example.com"));
    expect(response.headers.get("location")).toBe("https://chicagoincentiveexplorer.com/locate");
  });
});
