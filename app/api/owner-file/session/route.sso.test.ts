import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ANALYTICS_ADMIN_COOKIE, createAnalyticsAdminSession } from "@/lib/analytics-admin-auth";
import { OWNER_FILES_ADMIN_COOKIE, createOwnerFilesAdminSession } from "@/lib/owner-files-admin-auth";
import { GET } from "./route";

/**
 * Real-auth-module coverage for the analytics/Owner Files single sign-on
 * cross-acceptance, hitting this route directly. Unlike ./route.test.ts
 * (which mocks lib/owner-files-admin-auth to test the route's wiring in
 * isolation), this file imports the real auth modules so it proves the
 * actual cookie-signing/verification round trip: a valid analytics admin
 * session, with no Owner Files cookie at all, gets past this gate.
 */

function req(cookieHeader?: string) {
  const headers = cookieHeader ? { cookie: cookieHeader } : undefined;
  return new NextRequest("http://localhost/api/owner-file/session", { headers });
}

describe("GET /api/owner-file/session — analytics session single sign-on (real auth modules)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 204 with only a valid analytics admin session cookie", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
    vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
    vi.stubEnv("AUTH_SECRET", "shared-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    const analyticsSession = createAnalyticsAdminSession();
    const res = await GET(req(`${ANALYTICS_ADMIN_COOKIE}=${analyticsSession}`));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("returns 401 when the analytics cookie is present but invalid, with no owner-files cookie", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
    vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
    vi.stubEnv("AUTH_SECRET", "shared-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    const res = await GET(req(`${ANALYTICS_ADMIN_COOKIE}=tampered-session`));
    expect(res.status).toBe(401);
  });

  it("still returns 204 for a valid Owner Files session with no analytics cookie present", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "owner-password");
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "");
    vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
    vi.stubEnv("AUTH_SECRET", "shared-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    const ownerSession = createOwnerFilesAdminSession();
    const res = await GET(req(`${OWNER_FILES_ADMIN_COOKIE}=${ownerSession}`));
    expect(res.status).toBe(204);
  });

  it("returns 401 when neither cookie is present and only the analytics gate is configured", async () => {
    vi.stubEnv("OWNER_FILES_ADMIN_PASSWORD", "");
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "analytics-password");
    vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
    vi.stubEnv("AUTH_SECRET", "shared-secret");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
