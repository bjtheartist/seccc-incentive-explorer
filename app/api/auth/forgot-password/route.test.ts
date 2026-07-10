import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  createTokenMock,
  deleteTokenMock,
  findUserMock,
  markRequestMock,
  reserveMock,
  sendMock,
  storeTokenMock,
} = vi.hoisted(() => ({
  createTokenMock: vi.fn(),
  deleteTokenMock: vi.fn(),
  findUserMock: vi.fn(),
  markRequestMock: vi.fn(),
  reserveMock: vi.fn(),
  sendMock: vi.fn(),
  storeTokenMock: vi.fn(),
}));

vi.mock("@/lib/password-reset", () => ({
  createPasswordResetToken: createTokenMock,
  deletePasswordResetToken: deleteTokenMock,
  findPasswordResetUser: findUserMock,
  markPasswordResetRequest: markRequestMock,
  PASSWORD_RESET_RESPONSE:
    "If an account exists for that email, a password reset link is on its way.",
  PasswordResetStorageUnavailableError:
    class PasswordResetStorageUnavailableError extends Error {},
  passwordResetClientIdentifier: () => "test-client",
  passwordResetUrl: (token: string) =>
    `https://chicagoincentiveexplorer.com/reset-password?token=${token}`,
  reservePasswordResetRequest: reserveMock,
  storePasswordResetToken: storeTokenMock,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { POST } from "./route";

function request(email = "owner@example.com") {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.stubEnv("PASSWORD_RESET_EMAILS_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  createTokenMock.mockReset().mockReturnValue("t".repeat(43));
  deleteTokenMock.mockReset().mockResolvedValue(undefined);
  findUserMock.mockReset().mockResolvedValue({ id: "user-1" });
  markRequestMock.mockReset().mockResolvedValue(undefined);
  reserveMock.mockReset().mockResolvedValue({ allowed: true, id: 12 });
  sendMock.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  storeTokenMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/forgot-password", () => {
  it("fails closed until password reset email is explicitly enabled", async () => {
    vi.stubEnv("PASSWORD_RESET_EMAILS_ENABLED", "false");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("uses the same response when no account exists", async () => {
    findUserMock.mockResolvedValue(null);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("If an account exists");
    expect(markRequestMock).toHaveBeenCalledWith(12, "ignored");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("stores a one-time token and sends the reset link", async () => {
    const response = await POST(request("OWNER@example.com"));

    expect(response.status).toBe(200);
    expect(storeTokenMock).toHaveBeenCalledWith("user-1", "t".repeat(43));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: ["owner@example.com"],
      subject: "Reset your Chicago Incentive Explorer password",
    });
    expect(sendMock.mock.calls[0][0].text).toContain(
      "https://chicagoincentiveexplorer.com/reset-password?token="
    );
    expect(markRequestMock).toHaveBeenCalledWith(12, "sent");
  });

  it("returns the generic response when the request limit is reached", async () => {
    reserveMock.mockResolvedValue({ allowed: false });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(findUserMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("removes the token without revealing a delivery failure", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "rejected" } });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("If an account exists");
    expect(deleteTokenMock).toHaveBeenCalledWith("user-1");
    expect(markRequestMock).toHaveBeenCalledWith(12, "failed");
  });
});
