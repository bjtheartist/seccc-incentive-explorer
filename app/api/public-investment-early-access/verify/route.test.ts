import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));

vi.mock("@/lib/public-investment-early-access-storage", () => ({
  PublicInvestmentEarlyAccessStorageUnavailableError:
    class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
  verifyPublicInvestmentEmail: verifyMock,
}));

import { POST } from "./route";

function request(body: Record<string, string>, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/public-investment-early-access/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    body: new URLSearchParams(body),
  });
}

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue(true);
});

describe("POST /api/public-investment-early-access/verify", () => {
  it("marks a valid token verified and returns to the public beta page", async () => {
    const response = await POST(request({ email: "BILLY@EXAMPLE.COM", token: "valid-token" }));
    const location = new URL(response.headers.get("Location") || "");

    expect(response.status).toBe(303);
    expect(verifyMock).toHaveBeenCalledWith("billy@example.com", "valid-token");
    expect(location.pathname).toBe("/public-investment-analysis");
    expect(location.searchParams.get("verification")).toBe("verified");
  });

  it("does not call storage when the link is malformed", async () => {
    const response = await POST(request({ email: "not-an-email", token: "" }));
    expect(response.status).toBe(303);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("Location") || "").searchParams.get("verification")).toBe(
      "invalid",
    );
  });

  it("labels a consumed or expired token invalid", async () => {
    verifyMock.mockResolvedValue(false);
    const response = await POST(request({ email: "billy@example.com", token: "expired" }));
    expect(new URL(response.headers.get("Location") || "").searchParams.get("verification")).toBe(
      "invalid",
    );
  });

  it("rejects cross-origin verification posts", async () => {
    const response = await POST(
      request({ email: "billy@example.com", token: "valid" }, "https://attacker.example"),
    );
    expect(response.status).toBe(403);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
