import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAnalyticsAdminSession } from "@/lib/analytics-admin-auth";
import { GET } from "./route";
import { POST } from "@/app/api/admin/analytics/login/route";

function request(cookie?: string, query = "") {
  return new NextRequest(`https://example.test/research/ctc-small-business${query}`, {
    headers: cookie ? { Cookie: `cie_analytics_admin=${cookie}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "test-password");
  vi.stubEnv("ANALYTICS_ADMIN_TOKEN", "");
  vi.stubEnv("AUTH_SECRET", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("CTC internal research publication", () => {
  it.each([undefined, "invalid-session"])("withholds the artifact without a valid admin session: %s", async (cookie) => {
    const response = await GET(request(cookie));
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain("Open research map");
    expect(html).not.toContain("docs.google.com");
    expect(html).not.toContain("const DATA");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns the exact reviewed artifact to an authenticated administrator", async () => {
    const response = await GET(request(createAnalyticsAdminSession()));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(readFileSync(path.join(process.cwd(), "data/private/ctc-research/corridor-map.html"), "utf8"));
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects an expired admin session", async () => {
    vi.useFakeTimers();
    const cookie = createAnalyticsAdminSession();
    vi.advanceTimersByTime(9 * 60 * 60 * 1000);
    expect((await GET(request(cookie))).status).toBe(401);
  });

  it("fails closed when admin access is unconfigured", async () => {
    vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("docs.google.com");
  });

  it.each([true, false])("returns to research after a login attempt (valid: %s)", async (valid) => {
    const response = await POST(new NextRequest("https://example.test/api/admin/analytics/login", {
      method: "POST",
      body: new URLSearchParams({ redirectTo: "/research/ctc-small-business", password: valid ? "test-password" : "incorrect" }),
    }));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("Location")!);
    expect(location.pathname).toBe("/research/ctc-small-business");
    expect(location.searchParams.get("error")).toBe(valid ? null : "1");
    expect(Boolean(response.cookies.get("cie_analytics_admin"))).toBe(valid);
    if (valid) {
      expect((await GET(request(response.cookies.get("cie_analytics_admin")!.value))).status).toBe(200);
    } else {
      expect(await (await GET(request(undefined, "?error=1"))).text()).toContain("That password did not match");
    }
  });
});
