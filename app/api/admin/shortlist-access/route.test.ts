import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { sessionMock, configuredMock, listMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  configuredMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("@/lib/analytics-admin-auth", () => ({
  ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin",
  hasValidAnalyticsAdminSession: sessionMock,
  isAnalyticsAdminConfigured: configuredMock,
}));
vi.mock("@/lib/shortlist-access-storage", () => ({
  ShortlistAccessStorageUnavailableError:
    class ShortlistAccessStorageUnavailableError extends Error {},
  listShortlistAccessSignups: listMock,
}));

import { GET } from "./route";

beforeEach(() => {
  configuredMock.mockReset().mockReturnValue(true);
  sessionMock.mockReset().mockReturnValue(true);
  listMock.mockReset().mockResolvedValue([
    {
      name: "Billy",
      title: "Director",
      email: "billy@example.com",
      signedUpAt: "2026-08-24T12:00:00.000Z",
    },
  ]);
});

describe("GET /api/admin/shortlist-access", () => {
  it("rejects an unauthenticated export", async () => {
    sessionMock.mockReturnValue(false);
    const response = await GET(
      new NextRequest("http://localhost/api/admin/shortlist-access?format=csv"),
    );
    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("exports captured shortlist signups for an authenticated admin", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/shortlist-access?format=csv"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "site-shortlist-signups.csv",
    );
    expect(await response.text()).toContain("billy@example.com");
  });
});
