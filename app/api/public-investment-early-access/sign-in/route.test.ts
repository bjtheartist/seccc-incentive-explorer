import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: Record<string, string>, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/public-investment-early-access/sign-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
    },
    body: new URLSearchParams(body),
  });
}

describe("POST /api/public-investment-early-access/sign-in", () => {
  it("turns a confirmed interstitial into the fixed NextAuth callback", async () => {
    const response = await POST(request({ email: "BILLY@EXAMPLE.COM", token: "magic-token" }));
    const location = new URL(response.headers.get("Location") || "");
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/api/auth/callback/email");
    expect(location.searchParams.get("email")).toBe("billy@example.com");
    expect(location.searchParams.get("token")).toBe("magic-token");
    expect(location.searchParams.get("callbackUrl")).toBe("http://localhost:3000/investment");
  });

  it("rejects cross-origin token consumption", async () => {
    const response = await POST(
      request({ email: "billy@example.com", token: "magic-token" }, "https://attacker.example"),
    );
    expect(response.status).toBe(403);
  });
});
