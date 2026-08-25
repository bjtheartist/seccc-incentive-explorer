import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  configuredAdminMock,
  adminSessionMock,
  emailConfiguredMock,
  getRequestMock,
  decideMock,
  tokenMock,
  sendMock,
} = vi.hoisted(() => ({
  configuredAdminMock: vi.fn(),
  adminSessionMock: vi.fn(),
  emailConfiguredMock: vi.fn(),
  getRequestMock: vi.fn(),
  decideMock: vi.fn(),
  tokenMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/lib/analytics-admin-auth", () => ({
  ANALYTICS_ADMIN_COOKIE: "cie_analytics_admin",
  isAnalyticsAdminConfigured: configuredAdminMock,
  hasValidAnalyticsAdminSession: adminSessionMock,
}));
vi.mock("@/lib/public-investment-access-email", () => ({
  isPublicInvestmentAccessEmailConfigured: emailConfiguredMock,
  publicInvestmentMagicLinkUrl: () => "https://example.com/magic",
  sendPublicInvestmentMagicLinkEmail: sendMock,
}));
vi.mock("@/lib/public-investment-early-access-storage", () => ({
  PublicInvestmentEarlyAccessStorageUnavailableError:
    class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
  getPublicInvestmentAccessById: getRequestMock,
  decidePublicInvestmentAccess: decideMock,
  createPublicInvestmentMagicSignInToken: tokenMock,
}));

import { POST } from "./route";

const VERIFIED = {
  id: "42",
  email: "billy@example.com",
  status: "pending_review",
  emailVerifiedAt: "2026-08-24T12:00:00.000Z",
};

function request(decision: string, cookie = "session", origin = "http://localhost") {
  const body = new URLSearchParams({ decision });
  return new NextRequest("http://localhost/api/admin/public-investment-early-access/42/decision", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `cie_analytics_admin=${cookie}`,
      Origin: origin,
    },
    body,
  });
}

beforeEach(() => {
  configuredAdminMock.mockReset().mockReturnValue(true);
  adminSessionMock.mockReset().mockReturnValue(true);
  emailConfiguredMock.mockReset().mockReturnValue(true);
  getRequestMock.mockReset().mockResolvedValue(VERIFIED);
  decideMock.mockReset().mockResolvedValue({ ...VERIFIED, status: "approved" });
  tokenMock.mockReset().mockResolvedValue({ token: "magic-token" });
  sendMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/admin/public-investment-early-access/[id]/decision", () => {
  it("rejects an unauthenticated decision before reading the request", async () => {
    adminSessionMock.mockReturnValue(false);
    const response = await POST(request("approve"), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(401);
    expect(getRequestMock).not.toHaveBeenCalled();
  });

  it("requires email verification before approval", async () => {
    getRequestMock.mockResolvedValue({ ...VERIFIED, emailVerifiedAt: "" });
    const response = await POST(request("approve"), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(303);
    expect(decideMock).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("Location") || "").searchParams.get("error")).toBe(
      "verify-first",
    );
  });

  it("approves a verified request and sends a one-time sign-in link", async () => {
    const response = await POST(request("approve"), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(303);
    expect(decideMock).toHaveBeenCalledWith("42", "approve");
    expect(tokenMock).toHaveBeenCalledWith("billy@example.com");
    expect(sendMock).toHaveBeenCalledWith("billy@example.com", "https://example.com/magic");
    expect(new URL(response.headers.get("Location") || "").searchParams.get("updated")).toBe(
      "approved",
    );
  });

  it("rejects cross-origin form posts", async () => {
    const response = await POST(request("approve", "session", "https://attacker.example"), {
      params: Promise.resolve({ id: "42" }),
    });
    expect(response.status).toBe(403);
    expect(getRequestMock).not.toHaveBeenCalled();
  });
});
