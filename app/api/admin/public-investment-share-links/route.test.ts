import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { adminConfiguredMock, adminSessionMock, shareConfiguredMock, createMock } = vi.hoisted(() => ({
  adminConfiguredMock: vi.fn(),
  adminSessionMock: vi.fn(),
  shareConfiguredMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("@/lib/analytics-admin-auth", () => ({
  ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin",
  isAnalyticsAdminConfigured: adminConfiguredMock,
  hasValidAnalyticsAdminSession: adminSessionMock,
}));
vi.mock("@/lib/investment-share-session", () => ({
  isInvestmentShareConfigured: shareConfiguredMock,
}));
vi.mock("@/lib/investment-share-links-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investment-share-links-storage")>()),
  createInvestmentShareLink: createMock,
}));

import { POST } from "./route";

function request(body: unknown, origin = "https://chicagoincentiveexplorer.com") {
  return new NextRequest("https://chicagoincentiveexplorer.com/api/admin/public-investment-share-links", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: "cie_analytics_admin=x" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  adminConfiguredMock.mockReset().mockReturnValue(true);
  adminSessionMock.mockReset().mockReturnValue(true);
  shareConfiguredMock.mockReset().mockReturnValue(true);
  createMock.mockReset().mockResolvedValue({
    record: { id: "9", label: "CCT", expiresAt: "2026-10-18T00:00:00.000Z" },
    token: "raw-token",
  });
});

describe("POST /api/admin/public-investment-share-links", () => {
  it("requires a dashboard session", async () => {
    adminSessionMock.mockReturnValue(false);
    expect((await POST(request({ label: "CCT", expiresInDays: 30 }))).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin creation", async () => {
    expect((await POST(request({ label: "CCT", expiresInDays: 30 }, "https://attacker.example"))).status).toBe(403);
  });

  it("validates the label and expiry window", async () => {
    expect((await POST(request({ label: "x", expiresInDays: 30 }))).status).toBe(400);
    expect((await POST(request({ label: "Partner", expiresInDays: 45 }))).status).toBe(400);
    expect((await POST(request("not json"))).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("mints a link and returns the one-time URL on the request origin", async () => {
    const response = await POST(request({ label: "  Chicago  Community Trust ", expiresInDays: 30 }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "9",
      label: "CCT",
      expiresAt: "2026-10-18T00:00:00.000Z",
      url: "https://chicagoincentiveexplorer.com/investment/share/raw-token",
    });
    expect(createMock).toHaveBeenCalledWith({ label: "Chicago Community Trust", expiresInDays: 30 });
  });

  it("refuses when no signing secret backs the partner cookie", async () => {
    shareConfiguredMock.mockReturnValue(false);
    expect((await POST(request({ label: "CCT", expiresInDays: 30 }))).status).toBe(503);
  });
});
