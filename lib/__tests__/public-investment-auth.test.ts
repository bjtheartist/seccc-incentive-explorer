import { beforeEach, describe, expect, it, vi } from "vitest";

const { approvedMock } = vi.hoisted(() => ({ approvedMock: vi.fn() }));

vi.mock("@/lib/public-investment-access-email", () => ({
  isPublicInvestmentAccessEmailConfigured: () => false,
  sendPublicInvestmentMagicLinkEmail: vi.fn(),
}));
vi.mock("@/lib/public-investment-early-access-storage", () => ({
  hasApprovedPublicInvestmentAccess: approvedMock,
}));

import { authOptions } from "@/auth";

const signIn = authOptions.callbacks?.signIn as NonNullable<
  NonNullable<typeof authOptions.callbacks>["signIn"]
>;

beforeEach(() => approvedMock.mockReset().mockResolvedValue(false));

describe("NextAuth Public Investment approval boundary", () => {
  it("rejects an email-provider sign-in when the normalized identity is not approved", async () => {
    const allowed = await signIn({
      user: { id: "pending", email: "pending@example.com" },
      account: {
        provider: "email",
        providerAccountId: "pending@example.com",
        type: "email",
      },
    });
    expect(allowed).toBe(false);
    expect(approvedMock).toHaveBeenCalledWith("pending@example.com");
  });

  it("admits an approved passwordless identity without changing other providers", async () => {
    approvedMock.mockResolvedValue(true);
    await expect(
      signIn({
        user: { id: "approved", email: "approved@example.com" },
        account: {
          provider: "email",
          providerAccountId: "approved@example.com",
          type: "email",
        },
      }),
    ).resolves.toBe(true);
    await expect(
      signIn({
        user: { id: "google", email: "google@example.com" },
        account: {
          provider: "google",
          providerAccountId: "google",
          type: "oauth",
        },
      }),
    ).resolves.toBe(true);
  });
});
