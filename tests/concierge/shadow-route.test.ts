/**
 * Route-level shadow test: the decision call is fired only when the flag is on,
 * never changes the model call or the shown text, and lands as an audit-only
 * row (not in the assistant message's tool_calls) plus a hashed runtime log
 * line. Mirrors the mocking pattern of route-persistence-parity.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { streamTextMock, evaluateShadowDecisionMock, persistMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn<(opts: unknown) => unknown>(),
  evaluateShadowDecisionMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  persistMock: vi.fn<(ctx: unknown, turn: unknown) => Promise<void>>(async () => undefined),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: (opts: unknown) => streamTextMock(opts) };
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
vi.mock("@/lib/concierge/decisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/decisions")>();
  return {
    ...actual,
    evaluateShadowDecision: (...args: unknown[]) => evaluateShadowDecisionMock(...args),
  };
});
vi.mock("@/lib/concierge/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/persistence")>();
  return { ...actual, persistConciergeTurn: persistMock };
});
const FAKE_SQL = (() => {}) as unknown as ReturnType<typeof import("@/lib/db").getSQL>;
vi.mock("@/lib/db", () => ({ getSQL: () => FAKE_SQL }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: async () => "user-1" }));
vi.mock("@/lib/concierge/fallback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/fallback")>();
  return { ...actual, buildDeterministicConciergeResponse: async () => null };
});
vi.mock("@/lib/concierge/budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/budget")>();
  return { ...actual, consumeDailyBudget: async () => ({ allowed: true }) };
});
vi.mock("@/lib/concierge/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/rate-limit")>();
  return {
    ...actual,
    checkConciergeRateLimit: async () => ({ allowed: true, scope: "ok", retryAfterSeconds: 0 }),
  };
});

import { POST } from "@/app/api/concierge/route";
import { SHADOW_DECISION_TOOL_NAME } from "@/lib/concierge/decisions";

const REPLY = "Here is a next step you can take.";
const shadowResult = {
  model: "typesafe-ai/jev",
  answers: {
    lane: { choice: "small_business_capital", probabilities: { small_business_capital: 0.8 } },
    stage: { choice: "actively_planning", probabilities: { actively_planning: 0.7 } },
    wants_handoff: 0.4,
    off_topic: 0.02,
  },
  latencyMs: 38,
  inputTokens: 250,
  generationId: "gen_1",
};

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/concierge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify({
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "need an equipment loan for my bakery" }] },
      ],
      pageContext: { route: "/report", address: "7100 S Jeffery Blvd" },
    }),
  });
}

type CapturedStreamOpts = { system: string };
type PersistedTurn = {
  assistantText: string;
  toolCalls: unknown[];
  auditOnly?: Array<{ toolName: string; approvalStatus?: string; resultSummary?: string }>;
};

beforeEach(() => {
  streamTextMock.mockReset();
  evaluateShadowDecisionMock.mockReset();
  persistMock.mockClear();
  streamTextMock.mockImplementation(() => ({
    text: Promise.resolve(REPLY),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
  }));
});
afterEach(() => vi.unstubAllEnvs());

async function runTurn(): Promise<{ opts: CapturedStreamOpts; body: string; turn: PersistedTurn }> {
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(streamTextMock).toHaveBeenCalledTimes(1);
  expect(persistMock).toHaveBeenCalledTimes(1);
  return {
    opts: streamTextMock.mock.calls[0]![0] as CapturedStreamOpts,
    body,
    turn: persistMock.mock.calls[0]![1] as PersistedTurn,
  };
}

describe("concierge shadow decisions (route)", () => {
  it("does not call the decision model when the flag is off", async () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "");
    const { turn } = await runTurn();
    expect(evaluateShadowDecisionMock).not.toHaveBeenCalled();
    expect(turn.auditOnly ?? []).toHaveLength(0);
  });

  it("records the decision as audit-only and logs a hashed line, without touching the model call or the shown text", async () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "true");
    evaluateShadowDecisionMock.mockResolvedValue(shadowResult);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { opts, body, turn } = await runTurn();

    // Same inputs the guide saw.
    expect(evaluateShadowDecisionMock).toHaveBeenCalledTimes(1);
    const [arg] = evaluateShadowDecisionMock.mock.calls[0]! as [
      { userText: string; pageContext: { route: string } },
    ];
    expect(arg.userText).toBe("need an equipment loan for my bakery");
    expect(arg.pageContext.route).toBe("/report");

    // Nothing about the decision reached the prompt or the visitor.
    expect(opts.system).not.toContain("shadow");
    expect(opts.system).not.toContain("small_business_capital 0.8");
    expect(body).toContain(REPLY);
    expect(body).not.toContain("small_business_capital");
    expect(turn.assistantText).toBe(REPLY);

    // Persisted as audit-only, not as a message tool call.
    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.auditOnly).toHaveLength(1);
    expect(turn.auditOnly![0]!.toolName).toBe(SHADOW_DECISION_TOOL_NAME);
    expect(turn.auditOnly![0]!.approvalStatus).toBe("executed");
    const summary = JSON.parse(turn.auditOnly![0]!.resultSummary!);
    expect(summary.lane).toBe("small_business_capital");
    expect(summary.off_topic).toBe(0.02);

    // Runtime log line carries a hash, never the text or the address.
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line.startsWith("[concierge.shadow] ")).toBe(true);
    const payload = JSON.parse(line.slice("[concierge.shadow] ".length));
    expect(payload.userTextHash).toMatch(/^[0-9a-f]{16}$/);
    expect(payload.validatorHit).toBe(false);
    expect(payload.decision.lane).toBe("small_business_capital");
    expect(line).not.toContain("bakery");
    expect(line).not.toContain("Jeffery");
    info.mockRestore();
  });

  it("fails open: a null decision leaves the turn untouched and logs nothing", async () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "true");
    evaluateShadowDecisionMock.mockResolvedValue(null);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { body, turn } = await runTurn();
    expect(info).not.toHaveBeenCalled();
    expect(body).toContain(REPLY);
    expect(turn.auditOnly ?? []).toHaveLength(0);
    info.mockRestore();
  });

  it("fails open: a rejected decision promise never breaks the turn", async () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "true");
    evaluateShadowDecisionMock.mockRejectedValue(new Error("boom"));
    const { body, turn } = await runTurn();
    expect(body).toContain(REPLY);
    expect(turn.auditOnly ?? []).toHaveLength(0);
  });

  it("fails open when the model call itself fails, with no unhandled rejection from the shadow promise", async () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "true");
    evaluateShadowDecisionMock.mockRejectedValue(new Error("boom"));
    streamTextMock.mockImplementation(() => ({
      text: Promise.reject(new Error("provider down")),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
    }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(persistMock).not.toHaveBeenCalled();
  });
});
