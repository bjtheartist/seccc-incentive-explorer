/**
 * review5 S4 — "persistence test with a spy asserting stored assistant
 * text === streamed text." This file's own header comment on
 * lib/concierge/output-validator.ts already states the doctrine (consult
 * item 7, BLOCKING): "Scrubbing the stored transcript creates two
 * different histories and does nothing about exposure" — the ONLY correct
 * design is a single `finalText` value used for both the stream and the
 * persisted row. app/api/concierge/route.ts already does this (one local
 * variable, read twice), but nothing asserted it — a future edit could
 * silently persist `rawText` instead of `finalText` and every existing
 * test would stay green, because the existing suite
 * (route-output-validation.test.ts) always has `getSQL` return `null`,
 * so persistence never runs in it at all.
 *
 * This file forces the persistence branch to actually execute: `getSQL`
 * returns a truthy sentinel, `getCurrentUserId` returns a fake user, and
 * `checkConciergeRateLimit`/`consumeDailyBudget` are mocked to "allowed"
 * so the fake `sql` sentinel is never called as a real tagged-template
 * function (Hard Rule: no live DB). `persistConciergeTurn` is replaced
 * with a spy that captures its `assistantText` argument for direct
 * byte-for-byte comparison against the streamed response body.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { persistConciergeTurn as PersistConciergeTurnFn } from "@/lib/concierge/persistence";

const streamTextMock = vi.fn();
const persistConciergeTurnMock = vi.fn<typeof PersistConciergeTurnFn>(async () => {});

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

// A non-null sentinel — never invoked as a real tagged-template SQL
// function, because the rate-limit/budget calls below are mocked to
// never actually read it, and persistConciergeTurn is fully replaced.
const FAKE_SQL = (() => {}) as unknown as ReturnType<typeof import("@/lib/db").getSQL>;
vi.mock("@/lib/db", () => ({ getSQL: () => FAKE_SQL }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: async () => "test-user-id" }));

vi.mock("@/lib/concierge/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/rate-limit")>();
  return {
    ...actual,
    checkConciergeRateLimit: async () => ({ allowed: true, scope: "ok", retryAfterSeconds: 0 }),
  };
});

vi.mock("@/lib/concierge/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/budget")>();
  return {
    ...actual,
    consumeDailyBudget: async () => ({ allowed: true }),
  };
});

vi.mock("@/lib/concierge/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/persistence")>();
  return {
    ...actual,
    persistConciergeTurn: (...args: Parameters<typeof actual.persistConciergeTurn>) =>
      persistConciergeTurnMock(...args),
  };
});

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

/** The streamed response wraps `finalText` in the UI-message-stream
 *  protocol (a text-delta chunk), not the raw string — extract exactly
 *  what the client would render, the same way a real client parses it. */
function extractStreamedAssistantText(rawBody: string): string {
  const deltas: string[] = [];
  for (const line of rawBody.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed.type === "text-delta" && typeof parsed.delta === "string") {
        deltas.push(parsed.delta);
      }
    } catch {
      /* non-JSON control line — ignore */
    }
  }
  return deltas.join("");
}

beforeEach(() => {
  streamTextMock.mockReset();
  persistConciergeTurnMock.mockClear();
});

describe("POST /api/concierge — persisted assistantText === streamed text (review5 S4)", () => {
  it("persists EXACTLY the safe/passed-through model text, matching what was streamed to the client", async () => {
    streamTextMock.mockReturnValue(
      mockStreamTextResult("The TIF program reimburses eligible costs in designated districts."),
    );
    const POST = await getPOST();
    const response = await POST(makeRequest("What is TIF?"));
    const body = await readAllText(response);
    const streamedText = extractStreamedAssistantText(body);

    expect(persistConciergeTurnMock).toHaveBeenCalledTimes(1);
    const [, turn] = persistConciergeTurnMock.mock.calls[0];
    expect(turn.assistantText).toBe(streamedText);
    expect(turn.assistantText).toContain("TIF program reimburses eligible costs");
  });

  it("persists EXACTLY the fallback substitution text — never the raw prohibited model text — matching what was streamed", async () => {
    streamTextMock.mockReturnValue(
      mockStreamTextResult("Great news — you qualify for the Enterprise Zone exemption at that address."),
    );
    const POST = await getPOST();
    const response = await POST(makeRequest("Do I qualify for anything?"));
    const body = await readAllText(response);
    const streamedText = extractStreamedAssistantText(body);

    expect(persistConciergeTurnMock).toHaveBeenCalledTimes(1);
    const [, turn] = persistConciergeTurnMock.mock.calls[0];
    expect(turn.assistantText).toBe(streamedText);
    // Byte-for-byte parity is the load-bearing assertion above; this is a
    // belt-and-suspenders content check that the parity isn't parity on
    // the WRONG (raw, prohibited) text.
    expect(turn.assistantText).not.toContain("you qualify");
    expect(turn.assistantText).not.toContain("Great news");
  });
});
