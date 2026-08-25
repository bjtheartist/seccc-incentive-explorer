import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  reserveMock,
  saveMock,
  createVerificationMock,
  createMagicMock,
  configuredMock,
  sendVerificationMock,
  sendMagicMock,
} = vi.hoisted(() => ({
  reserveMock: vi.fn(),
  saveMock: vi.fn(),
  createVerificationMock: vi.fn(),
  createMagicMock: vi.fn(),
  configuredMock: vi.fn(),
  sendVerificationMock: vi.fn(),
  sendMagicMock: vi.fn(),
}));

vi.mock("@/lib/public-investment-access-email", () => ({
  isPublicInvestmentAccessEmailConfigured: configuredMock,
  publicInvestmentMagicLinkUrl: () => "https://example.com/magic",
  sendPublicInvestmentMagicLinkEmail: sendMagicMock,
  sendPublicInvestmentVerificationEmail: sendVerificationMock,
}));

vi.mock("@/lib/public-investment-early-access-storage", () => ({
  PublicInvestmentEarlyAccessStorageUnavailableError:
    class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
  publicInvestmentEarlyAccessClientIdentifier: () => "test-client",
  reservePublicInvestmentEarlyAccessRequest: reserveMock,
  savePublicInvestmentEarlyAccessRequest: saveMock,
  createPublicInvestmentEmailVerificationToken: createVerificationMock,
  createPublicInvestmentMagicSignInToken: createMagicMock,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/public-investment-early-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  reserveMock.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  saveMock.mockReset().mockResolvedValue({
    id: "1",
    email: "billy@example.com",
    status: "pending_verification",
    emailVerifiedAt: "",
  });
  createVerificationMock.mockReset().mockResolvedValue("verify-token");
  createMagicMock.mockReset().mockResolvedValue({ token: "magic-token" });
  configuredMock.mockReset().mockReturnValue(true);
  sendVerificationMock.mockReset().mockResolvedValue(undefined);
  sendMagicMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/public-investment-early-access", () => {
  it("persists name, title, and normalized email", async () => {
    const response = await POST(
      request({
        name: "Billy N.",
        title: "Executive Director",
        organization: "South East Chicago Commission",
        useCase: "Compare neighborhood funding patterns.",
        email: "BILLY@EXAMPLE.COM",
      }),
    );

    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Billy N.",
        title: "Executive Director",
        organization: "South East Chicago Commission",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
      }),
    );
    expect(createVerificationMock).toHaveBeenCalledWith("billy@example.com");
    expect(sendVerificationMock).toHaveBeenCalledWith("billy@example.com", "verify-token");
  });

  it("rejects missing title before reserving or saving", async () => {
    const response = await POST(
      request({
        name: "Billy",
        title: "",
        organization: "SECC",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
      }),
    );
    expect(response.status).toBe(400);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("quietly accepts the honeypot without saving", async () => {
    const response = await POST(
      request({ name: "Bot", title: "Bot", email: "bot@example.com", website: "spam" }),
    );
    expect(response.status).toBe(200);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rate limits before persistence", async () => {
    reserveMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });
    const response = await POST(
      request({
        name: "Billy",
        title: "Director",
        organization: "SECC",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("sends an approved requester a passwordless sign-in link instead of restarting verification", async () => {
    saveMock.mockResolvedValue({
      id: "1",
      email: "billy@example.com",
      status: "approved",
      emailVerifiedAt: "2026-08-24T12:00:00.000Z",
    });
    const response = await POST(
      request({
        name: "Billy",
        title: "Director",
        organization: "SECC",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(createVerificationMock).not.toHaveBeenCalled();
    expect(createMagicMock).toHaveBeenCalledWith("billy@example.com");
    expect(sendMagicMock).toHaveBeenCalledWith("billy@example.com", "https://example.com/magic");
  });

  it("does not send another verification email when a verified request is already under review", async () => {
    saveMock.mockResolvedValue({
      id: "1",
      email: "billy@example.com",
      status: "pending_review",
      emailVerifiedAt: "2026-08-24T12:00:00.000Z",
    });
    const response = await POST(
      request({
        name: "Billy",
        title: "Director",
        organization: "SECC",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
      }),
    );
    expect(response.status).toBe(200);
    expect(createVerificationMock).not.toHaveBeenCalled();
    expect(createMagicMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      message: "Your verified early-access request is already under review.",
    });
  });
});
