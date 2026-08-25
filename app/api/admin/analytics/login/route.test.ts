import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(redirectTo: string, password = "test-password") {
  const body = new URLSearchParams({ password, redirectTo });
  return new NextRequest("http://localhost/api/admin/analytics/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("ANALYTICS_ADMIN_PASSWORD", "test-password");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/analytics/login", () => {
  it("allows the shared admin session to return to the event signup list", async () => {
    const response = await POST(request("/admin/future-of-commerce"));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location") || "").pathname).toBe(
      "/admin/future-of-commerce",
    );
    expect(response.cookies.get("cie_analytics_admin")?.value).toBeTruthy();
  });

  it("allows the shared admin session to return to the support directory", async () => {
    const response = await POST(request("/admin/support-network"));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location") || "").pathname).toBe(
      "/admin/support-network",
    );
    expect(response.cookies.get("cie_analytics_admin")?.value).toBeTruthy();
  });

  it("allows the shared admin session to return to the zoning change ledger", async () => {
    const response = await POST(request("/admin/zoning-changes"));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location") || "").pathname).toBe(
      "/admin/zoning-changes",
    );
    expect(response.cookies.get("cie_analytics_admin")?.value).toBeTruthy();
  });

  it("allows the shared admin session to return to the Public Investment access queue", async () => {
    const response = await POST(request("/admin/public-investment-access"));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location") || "").pathname).toBe(
      "/admin/public-investment-access",
    );
    expect(response.cookies.get("cie_analytics_admin")?.value).toBeTruthy();
  });

  it("rejects external redirect targets", async () => {
    const response = await POST(request("https://example.com/admin/future-of-commerce"));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("Location") || "");
    expect(location.origin).toBe("http://localhost");
    expect(location.pathname).toBe("/admin/analytics");
  });
});
