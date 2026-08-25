import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { reserveMock, saveMock } = vi.hoisted(() => ({
  reserveMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock("@/lib/public-investment-early-access-storage", () => ({
  PublicInvestmentEarlyAccessStorageUnavailableError:
    class PublicInvestmentEarlyAccessStorageUnavailableError extends Error {},
  publicInvestmentEarlyAccessClientIdentifier: () => "test-client",
  reservePublicInvestmentEarlyAccessRequest: reserveMock,
  savePublicInvestmentEarlyAccessRequest: saveMock,
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
  saveMock.mockReset().mockResolvedValue("1");
});

describe("POST /api/public-investment-early-access", () => {
  it("persists name, title, and normalized email", async () => {
    const response = await POST(
      request({
        name: "Billy N.",
        title: "Executive Director",
        email: "BILLY@EXAMPLE.COM",
      }),
    );

    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Billy N.",
        title: "Executive Director",
        email: "billy@example.com",
      }),
    );
  });

  it("rejects missing title before reserving or saving", async () => {
    const response = await POST(
      request({ name: "Billy", title: "", email: "billy@example.com" }),
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
      request({ name: "Billy", title: "Director", email: "billy@example.com" }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(saveMock).not.toHaveBeenCalled();
  });
});
