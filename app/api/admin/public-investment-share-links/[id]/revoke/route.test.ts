import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { adminSessionMock, revokeMock } = vi.hoisted(() => ({
  adminSessionMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/analytics-admin-auth", () => ({
  ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin",
  isAnalyticsAdminConfigured: () => true,
  hasValidAnalyticsAdminSession: adminSessionMock,
}));
vi.mock("@/lib/investment-share-links-storage", () => ({
  InvestmentShareLinkStorageUnavailableError: class InvestmentShareLinkStorageUnavailableError extends Error {},
  revokeInvestmentShareLink: revokeMock,
}));

import { POST } from "./route";

function revoke(id: string) {
  return POST(
    new NextRequest(`http://localhost/api/admin/public-investment-share-links/${id}/revoke`, {
      method: "POST",
      headers: { Origin: "http://localhost", Cookie: "cie_analytics_admin=x" },
      body: new URLSearchParams(),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  adminSessionMock.mockReset().mockReturnValue(true);
  revokeMock.mockReset().mockResolvedValue({ id: "3", revokedAt: "2026-09-18T00:00:00.000Z" });
});

describe("POST /api/admin/public-investment-share-links/[id]/revoke", () => {
  it("requires a dashboard session", async () => {
    adminSessionMock.mockReturnValue(false);
    expect((await revoke("3")).status).toBe(401);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("revokes and returns to the share-links section", async () => {
    const response = await revoke("3");
    const location = new URL(response.headers.get("Location") || "");
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/admin/public-investment-access");
    expect(location.searchParams.get("updated")).toBe("share-link-revoked");
    expect(location.hash).toBe("#share-links");
    expect(revokeMock).toHaveBeenCalledWith("3");
  });

  it("reports an unknown link without touching storage for a malformed id", async () => {
    revokeMock.mockResolvedValue(null);
    expect(new URL((await revoke("77")).headers.get("Location") || "").searchParams.get("error")).toBe(
      "share-link-not-found",
    );
    revokeMock.mockClear();
    expect(new URL((await revoke("abc")).headers.get("Location") || "").searchParams.get("error")).toBe(
      "share-link-not-found",
    );
    expect(revokeMock).not.toHaveBeenCalled();
  });
});
