import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/concierge/route";
import { __resetConciergeRateLimit } from "@/lib/concierge/rate-limit";
import { CONCIERGE_RATE_LIMITS } from "@/lib/concierge/config";

function makeRequest(body: unknown, ip = "5.5.5.5"): NextRequest {
  return new NextRequest("http://localhost/api/concierge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

const sampleBody = {
  messages: [
    { id: "1", role: "user", parts: [{ type: "text", text: "hello" }] },
  ],
  pageContext: { route: "/report" },
};

afterEach(() => {
  vi.unstubAllEnvs();
  __resetConciergeRateLimit();
});

describe("POST /api/concierge feature gate", () => {
  it("503s with a friendly message when the concierge is disabled (no keys)", async () => {
    vi.stubEnv("CONCIERGE_ENABLED", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const res = await POST(makeRequest(sampleBody));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("concierge_disabled");
    expect(typeof json.message).toBe("string");
  });

  it("503s when enabled but no gateway key is present", async () => {
    vi.stubEnv("CONCIERGE_ENABLED", "true");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const res = await POST(makeRequest(sampleBody));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/concierge rate limiting (fails closed, no model call)", () => {
  it("429s once the per-IP window is exhausted, before any model call", async () => {
    vi.stubEnv("CONCIERGE_ENABLED", "true");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw_test_key");

    // Burn the per-IP allowance with an invalid-JSON body so the handler passes
    // the rate-limit gate and stops at body validation (no gateway call).
    for (let i = 0; i < CONCIERGE_RATE_LIMITS.perIpPerHour; i++) {
      const res = await POST(
        new NextRequest("http://localhost/api/concierge", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
          body: "not-json",
        })
      );
      // 400 invalid_json — proves we got past the gate without streaming.
      expect(res.status).toBe(400);
    }

    const limited = await POST(
      new NextRequest("http://localhost/api/concierge", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
        body: "not-json",
      })
    );
    expect(limited.status).toBe(429);
    const json = await limited.json();
    expect(json.error).toBe("rate_limited");
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /api/concierge body validation", () => {
  it("rejects an empty message list", async () => {
    vi.stubEnv("CONCIERGE_ENABLED", "true");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw_test_key");
    const res = await POST(makeRequest({ messages: [], pageContext: {} }, "8.8.8.8"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_messages");
  });

  it("rejects an over-long single message", async () => {
    vi.stubEnv("CONCIERGE_ENABLED", "true");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw_test_key");
    const huge = {
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "x".repeat(5000) }] },
      ],
      pageContext: { route: "/report" },
    };
    const res = await POST(makeRequest(huge, "8.8.8.9"));
    expect(res.status).toBe(400);
  });
});
