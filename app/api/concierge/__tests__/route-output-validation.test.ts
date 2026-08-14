/**
 * build-spec.md 2.5 (audit "F-rail"; consult item 7) — end-to-end proof
 * that app/api/concierge/route.ts actually wires the buffer-validate-emit
 * contract: the model's raw text is awaited in full, validated, and only
 * the validated (or substituted) text ever reaches the response — never
 * the raw model text, not even inside a streamed chunk.
 *
 * `streamText` (from "ai") is mocked so its `.text`/`.toolCalls`/
 * `.toolResults` promises resolve to a controlled, PROHIBITED string —
 * exactly what a successful prompt-injection would look like coming back
 * from the model. No DB, no Redis, no real model call (Hard Rules).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const streamTextMock = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
  };
});

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: () => (modelId: string) => ({ modelId }),
}));

vi.mock("@/lib/concierge/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/config")>();
  return {
    ...actual,
    isConciergeEnabled: () => true,
    hasGatewayCredential: () => true,
    getGatewayApiKey: () => "test-key",
    getConciergeModelId: () => "test/model",
  };
});

vi.mock("@/lib/db", () => ({ getSQL: () => null }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: async () => null }));

// Force past the zero-model deterministic-response gate so every request in
// this file reaches the model-backed path under test.
vi.mock("@/lib/concierge/fallback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/fallback")>();
  return {
    ...actual,
    buildDeterministicConciergeResponse: async () => null,
  };
});

async function getPOST() {
  const mod = await import("../route");
  return mod.POST;
}

function makeRequest(userText: string): NextRequest {
  return new NextRequest("https://example.test/api/concierge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: userText }],
        },
      ],
      pageContext: { route: "/" },
    }),
  });
}

/** A minimal StreamTextResult-shaped mock — only the promises the route reads. */
function mockStreamTextResult(text: string) {
  return {
    text: Promise.resolve(text),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
  };
}

async function readAllText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

beforeEach(() => {
  streamTextMock.mockReset();
});

describe("POST /api/concierge — buffer-validate-emit", () => {
  it("never streams a prohibited model claim to the client — the fallback message is emitted instead", async () => {
    streamTextMock.mockReturnValue(
      mockStreamTextResult("Great news — you qualify for the Enterprise Zone exemption at that address."),
    );
    const POST = await getPOST();
    const response = await POST(makeRequest("Do I qualify for anything?"));
    const body = await readAllText(response);

    expect(body).not.toContain("you qualify");
    expect(body).not.toContain("Great news");
    expect(body).toContain("I can't confidently answer that from published sources right now");
  });

  it("passes safe model text through unchanged", async () => {
    streamTextMock.mockReturnValue(
      mockStreamTextResult("The TIF program reimburses eligible costs in designated districts."),
    );
    const POST = await getPOST();
    const response = await POST(makeRequest("What is TIF?"));
    const body = await readAllText(response);

    expect(body).toContain("TIF program reimburses eligible costs");
  });

  it("falls back to the resting message, not a partial/raw response, when the model call itself throws", async () => {
    const rejected = Promise.reject(new Error("gateway timeout"));
    // Suppress the "unhandled rejection" warning this deliberately-rejected
    // promise would otherwise trigger before the route awaits it — does not
    // consume the rejection for the route's own Promise.all listener.
    rejected.catch(() => {});
    streamTextMock.mockReturnValue({
      text: rejected,
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
    });
    const POST = await getPOST();
    const response = await POST(makeRequest("What is TIF?"));
    const body = await readAllText(response);

    expect(body).toContain("resting");
  });
});
