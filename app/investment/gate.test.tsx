import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  sessionMock,
  adminConfiguredMock,
  adminSessionMock,
  emailConfiguredMock,
  approvedMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  sessionMock: vi.fn(),
  adminConfiguredMock: vi.fn(),
  adminSessionMock: vi.fn(),
  emailConfiguredMock: vi.fn(),
  approvedMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next-auth", () => ({ getServerSession: sessionMock }));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "owner",
  isOwnerFilesAdminConfigured: adminConfiguredMock,
  hasValidOwnerFilesAdminSession: adminSessionMock,
}));
vi.mock("@/lib/analytics-admin-auth", () => ({ ANALYTICS_ADMIN_COOKIE: "analytics" }));
vi.mock("@/lib/public-investment-access-email", () => ({
  isPublicInvestmentAccessEmailConfigured: emailConfiguredMock,
}));
vi.mock("@/lib/public-investment-early-access-storage", () => ({
  PublicInvestmentEarlyAccessStorageUnavailableError:
    class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
  hasApprovedPublicInvestmentAccess: approvedMock,
}));
vi.mock("@/components/investment/SessionGuard", () => ({
  InvestmentSessionGuard: () => null,
}));

import { getInvestmentAdminState } from "./gate";

beforeEach(() => {
  cookiesMock.mockReset().mockResolvedValue({ get: () => undefined });
  sessionMock.mockReset().mockResolvedValue(null);
  adminConfiguredMock.mockReset().mockReturnValue(true);
  adminSessionMock.mockReset().mockReturnValue(false);
  emailConfiguredMock.mockReset().mockReturnValue(true);
  approvedMock.mockReset().mockResolvedValue(false);
});

describe("Public Investment analysis access gate", () => {
  it("preserves existing staff access", async () => {
    adminSessionMock.mockReturnValue(true);
    expect(await getInvestmentAdminState()).toMatchObject({
      configured: true,
      hasSession: true,
      accessMode: "admin",
    });
    expect(sessionMock).not.toHaveBeenCalled();
  });

  it("admits a logged-in user only when the verified email is approved", async () => {
    sessionMock.mockResolvedValue({ user: { email: "billy@example.com" } });
    approvedMock.mockResolvedValue(true);
    expect(await getInvestmentAdminState()).toMatchObject({
      configured: true,
      hasSession: true,
      accessMode: "beta",
    });
    expect(approvedMock).toHaveBeenCalledWith("billy@example.com");
  });

  it("does not treat an ordinary logged-in account as beta approval", async () => {
    sessionMock.mockResolvedValue({ user: { email: "pending@example.com" } });
    expect(await getInvestmentAdminState()).toMatchObject({
      configured: true,
      hasSession: false,
      accessMode: null,
    });
  });
});
