import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R2 finding 7 — the Investment gate reported "we cannot check" as "you are
 * not allowed".
 *
 * `getInvestmentAdminState()` caught
 * `PublicInvestmentEarlyAccessStorageUnavailableError` and swallowed it,
 * falling through to the SAME `hasSession: false` a genuine rejection
 * produces. So a signed-in, approved beta tester hitting a moment of database
 * trouble was shown the staff password wall — a screen telling them access is
 * restricted to corridor-management partners and inviting them to enter an
 * admin password they do not have and never will.
 *
 * Two different claims were collapsed into one screen. They are now separate.
 */

const {
  cookiesMock,
  sessionMock,
  adminConfiguredMock,
  adminSessionMock,
  emailConfiguredMock,
  approvedMock,
  StorageUnavailableError,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  sessionMock: vi.fn(),
  adminConfiguredMock: vi.fn(),
  adminSessionMock: vi.fn(),
  emailConfiguredMock: vi.fn(),
  approvedMock: vi.fn(),
  StorageUnavailableError: class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
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
  PublicInvestmentEarlyAccessStorageUnavailableError: StorageUnavailableError,
  hasApprovedPublicInvestmentAccess: approvedMock,
}));
vi.mock("@/components/investment/SessionGuard", () => ({
  InvestmentSessionGuard: () => null,
}));

import {
  InvestmentLoginForm,
  InvestmentTemporarilyUnavailable,
  getInvestmentAdminState,
} from "./gate";

beforeEach(() => {
  cookiesMock.mockReset().mockResolvedValue({ get: () => undefined });
  sessionMock.mockReset().mockResolvedValue({ user: { email: "beta@example.com" } });
  adminConfiguredMock.mockReset().mockReturnValue(true);
  adminSessionMock.mockReset().mockReturnValue(false);
  emailConfiguredMock.mockReset().mockReturnValue(true);
  approvedMock.mockReset().mockResolvedValue(false);
});

describe("storage unavailable is reported as its own state", () => {
  it("flags storageUnavailable when the access lookup cannot complete", async () => {
    approvedMock.mockRejectedValue(new StorageUnavailableError("down"));
    expect(await getInvestmentAdminState()).toMatchObject({
      configured: true,
      hasSession: false,
      accessMode: null,
      storageUnavailable: true,
    });
  });

  it("does NOT flag it for a completed lookup that said no", async () => {
    approvedMock.mockResolvedValue(false);
    const state = await getInvestmentAdminState();
    expect(state.hasSession).toBe(false);
    expect(state.storageUnavailable).toBeFalsy();
  });

  it("does NOT flag it for an approved user", async () => {
    approvedMock.mockResolvedValue(true);
    const state = await getInvestmentAdminState();
    expect(state).toMatchObject({ hasSession: true, accessMode: "beta" });
    expect(state.storageUnavailable).toBeFalsy();
  });

  it("still lets a staff admin session through without consulting storage at all", async () => {
    adminSessionMock.mockReturnValue(true);
    approvedMock.mockRejectedValue(new StorageUnavailableError("down"));
    expect(await getInvestmentAdminState()).toMatchObject({
      hasSession: true,
      accessMode: "admin",
    });
    expect(approvedMock).not.toHaveBeenCalled();
  });

  it("re-throws an unexpected error instead of disguising it as a denial", async () => {
    approvedMock.mockRejectedValue(new Error("something else entirely"));
    await expect(getInvestmentAdminState()).rejects.toThrow("something else entirely");
  });
});

describe("the screen a beta user actually sees", () => {
  async function renderLoginForm() {
    const element = await InvestmentLoginForm({ redirectTo: "/investment", hasAuthError: false });
    return element;
  }

  it("swaps the admin password wall for an honest 'temporarily unavailable' screen", async () => {
    approvedMock.mockRejectedValue(new StorageUnavailableError("down"));
    const element = await renderLoginForm();
    expect(element.type).toBe(InvestmentTemporarilyUnavailable);
  });

  it("still shows the password wall when the lookup completed and said no", async () => {
    approvedMock.mockResolvedValue(false);
    const element = await renderLoginForm();
    expect(element.type).not.toBe(InvestmentTemporarilyUnavailable);
  });

  it("still shows the password wall to an anonymous visitor — storage never mattered to them", async () => {
    sessionMock.mockResolvedValue(null);
    const element = await renderLoginForm();
    expect(element.type).not.toBe(InvestmentTemporarilyUnavailable);
    expect(approvedMock).not.toHaveBeenCalled();
  });

  it("shows the password wall when beta access is not configured at all", async () => {
    emailConfiguredMock.mockReturnValue(false);
    const element = await renderLoginForm();
    expect(element.type).not.toBe(InvestmentTemporarilyUnavailable);
  });

  /**
   * The whole point of the copy: it must not tell someone they are
   * unauthorized, and must not ask them for a password they cannot have.
   */
  it("the unavailable screen says it is our problem, not a decision about them", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(InvestmentTemporarilyUnavailable());

    expect(html).toContain("Access check temporarily unavailable");
    expect(html).toContain("not a decision about your account");
    expect(html).toContain("try again");

    // None of the password-wall language may appear here.
    expect(html).not.toContain("Enter admin password");
    expect(html).not.toContain("Access is restricted");
    expect(html).not.toContain('type="password"');
  });
});
