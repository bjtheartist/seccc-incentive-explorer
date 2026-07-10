import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { consumeTokenMock, hashPasswordMock } = vi.hoisted(() => ({
  consumeTokenMock: vi.fn(),
  hashPasswordMock: vi.fn(),
}));

vi.mock("@/lib/password", () => ({
  hashPassword: hashPasswordMock,
  isStrongEnoughPassword: (password: string) => password.length >= 8,
}));

vi.mock("@/lib/password-reset", () => ({
  consumePasswordResetToken: consumeTokenMock,
  PasswordResetStorageUnavailableError:
    class PasswordResetStorageUnavailableError extends Error {},
}));

import { POST } from "./route";

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "t".repeat(43),
      password: "new-password",
      ...overrides,
    }),
  });
}

beforeEach(() => {
  hashPasswordMock.mockReset().mockResolvedValue("password-hash");
  consumeTokenMock.mockReset().mockResolvedValue(true);
});

describe("POST /api/auth/reset-password", () => {
  it("rejects weak passwords before consuming the token", async () => {
    const response = await POST(request({ password: "short" }));

    expect(response.status).toBe(400);
    expect(consumeTokenMock).not.toHaveBeenCalled();
  });

  it("rejects expired or already-used links", async () => {
    consumeTokenMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("invalid or has expired");
  });

  it("replaces the password after consuming a valid one-time token", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(hashPasswordMock).toHaveBeenCalledWith("new-password");
    expect(consumeTokenMock).toHaveBeenCalledWith(
      "t".repeat(43),
      "password-hash"
    );
  });
});
