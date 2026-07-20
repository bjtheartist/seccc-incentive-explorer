import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { reserveMock, saveMock } = vi.hoisted(() => ({
  reserveMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock("@/lib/future-commerce-signup-storage", () => ({
  FutureCommerceSignupStorageUnavailableError:
    class FutureCommerceSignupStorageUnavailableError extends Error {},
  futureCommerceClientIdentifier: () => "test-client",
  reserveFutureCommerceSignup: reserveMock,
  saveFutureCommerceSignup: saveMock,
}));

import { POST } from "./route";

const validBody = {
  email: "OWNER@example.com",
  neighborhood: "South Chicago",
  address: "1234 E 87th Street",
  zipCode: "60617",
  consent: true,
  website: "",
};

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/future-of-commerce-signups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ ...validBody, ...overrides }),
  });
}

beforeEach(() => {
  reserveMock.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  saveMock.mockReset().mockResolvedValue("signup-1");
});

describe("POST /api/future-of-commerce-signups", () => {
  it("stores a normalized, explicitly consented signup", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@example.com",
        neighborhood: "South Chicago",
        address: "1234 E 87th Street",
        zipCode: "60617",
        consent: true,
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects invalid location data or missing consent", async () => {
    const response = await POST(request({ zipCode: "6061", consent: false }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.fields.zipCode).toBeDefined();
    expect(payload.fields.consent).toBeDefined();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("quietly accepts honeypot submissions without storing them", async () => {
    const response = await POST(request({ website: "https://spam.example" }));

    expect(response.status).toBe(200);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("enforces the shared signup-attempt limit", async () => {
    reserveMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(saveMock).not.toHaveBeenCalled();
  });
});
