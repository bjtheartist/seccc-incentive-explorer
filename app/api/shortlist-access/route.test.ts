import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SHORTLIST_ACCESS_COOKIE } from "@/lib/shortlist-access";

const { reserveMock, saveMock } = vi.hoisted(() => ({
  reserveMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock("@/lib/shortlist-access-storage", () => ({
  ShortlistAccessStorageUnavailableError:
    class ShortlistAccessStorageUnavailableError extends Error {},
  reserveShortlistAccessSignup: reserveMock,
  saveShortlistAccessSignup: saveMock,
  shortlistAccessClientIdentifier: () => "test-client",
}));

import { POST } from "./route";

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

function request(body: unknown) {
  return new NextRequest("http://localhost/api/shortlist-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Billy N.",
  title: "Executive Director",
  email: "billy@example.com",
};

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "shortlist-test-secret";
  reserveMock.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  saveMock.mockReset().mockResolvedValue("1");
});

afterEach(() => {
  process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
});

describe("POST /api/shortlist-access", () => {
  it("sets the signed access cookie only after the signup is saved", async () => {
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledOnce();
    expect(response.cookies.get(SHORTLIST_ACCESS_COOKIE)?.value).toBeTruthy();
  });

  it("does not issue access for invalid input", async () => {
    const response = await POST(request({ ...VALID_BODY, email: "bad" }));
    expect(response.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
    expect(response.cookies.get(SHORTLIST_ACCESS_COOKIE)).toBeUndefined();
  });

  it("does not issue access when persistence fails", async () => {
    saveMock.mockRejectedValue(new Error("database down"));
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(500);
    expect(response.cookies.get(SHORTLIST_ACCESS_COOKIE)).toBeUndefined();
  });
});
