import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { configuredMock, listMock, sessionMock } = vi.hoisted(() => ({
  configuredMock: vi.fn(),
  listMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("@/lib/analytics-admin-auth", () => ({
  ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin",
  hasValidAnalyticsAdminSession: sessionMock,
  isAnalyticsAdminConfigured: configuredMock,
}));

vi.mock("@/lib/future-commerce-signup-storage", () => ({
  FutureCommerceSignupStorageUnavailableError:
    class FutureCommerceSignupStorageUnavailableError extends Error {},
  listFutureCommerceSignups: listMock,
}));

import { GET } from "./route";

beforeEach(() => {
  configuredMock.mockReset().mockReturnValue(true);
  sessionMock.mockReset().mockReturnValue(true);
  listMock.mockReset().mockResolvedValue([
    {
      id: "signup-1",
      email: "owner@example.com",
      neighborhood: "South Chicago",
      address: "1234 E 87th Street",
      zipCode: "60617",
      consentVersion: "future-commerce-2026-v1",
      source: "future-of-commerce-2026",
      signedUpAt: "2026-07-20T18:00:00.000Z",
      updatedAt: "2026-07-20T18:00:00.000Z",
    },
  ]);
});

describe("GET /api/admin/future-of-commerce-signups", () => {
  it("keeps the attendee list behind the admin session", async () => {
    sessionMock.mockReturnValue(false);
    const request = new NextRequest(
      "http://localhost/api/admin/future-of-commerce-signups",
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns a private CSV export for an authenticated admin", async () => {
    const request = new NextRequest(
      "http://localhost/api/admin/future-of-commerce-signups?format=csv",
      { headers: { Cookie: "cie_analytics_admin=test-session" } },
    );

    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "future-of-commerce-email-list.csv",
    );
    expect(body).toContain("owner@example.com");
    expect(body).toContain("South Chicago");
  });
});
