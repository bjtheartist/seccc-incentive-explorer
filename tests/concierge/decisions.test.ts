import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_LANES,
  DECISION_STAGES,
  DEFAULT_DECISIONS_ENDPOINT,
  DEFAULT_DECISIONS_MODEL,
  buildShadowDecisionQuestions,
  buildShadowDecisionState,
  evaluateShadowDecision,
  getDecisionsEndpoint,
  getDecisionsModelId,
  isShadowDecisionsEnabled,
  parseShadowDecisionResponse,
  summarizeShadowDecision,
} from "@/lib/concierge/decisions";
import { CONCIERGE_SYSTEM_PROMPT } from "@/lib/concierge/system-prompt";
import { sanitizePageContext } from "@/lib/concierge/types";

const goodBody = {
  model: "typesafe-ai/jev",
  answers: {
    lane: {
      type: "choice",
      choice: "small_business_capital",
      probabilities: { small_business_capital: 0.81, capital_readiness: 0.12, none: 0.07 },
    },
    stage: {
      type: "choice",
      choice: "actively_planning",
      probabilities: { actively_planning: 0.66, exploring_idea: 0.3, unclear: 0.04 },
    },
    wants_handoff: { type: "noul", noul: 0.42 },
    off_topic: { type: "noul", noul: 0.03 },
  },
  usage: { input_tokens: 275, output_tokens: 20 },
  provider_metadata: { gateway: { generationId: "gen_abc" } },
};

function okFetch(body: unknown = goodBody) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

const input = {
  userText: "I want to open a coffee shop on 71st and need an equipment loan",
  pageContext: sanitizePageContext({
    route: "/report",
    pageLabel: "Incentive report",
    reportSummary: "3 programs mapped",
    address: "7100 S Jeffery Blvd",
    lat: 41.76,
    lon: -87.57,
    capitalSupportName: "Some CDFI",
    localSupportOrganizations: [
      { id: "org-a", name: "A", supportLanes: ["corridor_place_based"] },
      { id: "org-b", name: "B", supportLanes: ["small_business_capital", "corridor_place_based"] },
    ],
  }),
};

afterEach(() => vi.unstubAllEnvs());

describe("shadow decisions — config", () => {
  it("is OFF unless CONCIERGE_SHADOW_DECISIONS === 'true'", () => {
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "");
    expect(isShadowDecisionsEnabled()).toBe(false);
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "1");
    expect(isShadowDecisionsEnabled()).toBe(false);
    vi.stubEnv("CONCIERGE_SHADOW_DECISIONS", "true");
    expect(isShadowDecisionsEnabled()).toBe(true);
  });

  it("defaults to Jev on AI Gateway and can be repointed by env (Laya-compatible)", () => {
    vi.stubEnv("CONCIERGE_DECISIONS_ENDPOINT", "");
    vi.stubEnv("CONCIERGE_DECISIONS_MODEL", "");
    expect(getDecisionsEndpoint()).toBe(DEFAULT_DECISIONS_ENDPOINT);
    expect(getDecisionsModelId()).toBe(DEFAULT_DECISIONS_MODEL);
    vi.stubEnv("CONCIERGE_DECISIONS_ENDPOINT", "http://localhost:8000/v1/decisions");
    vi.stubEnv("CONCIERGE_DECISIONS_MODEL", "convaiinnovations/laya");
    expect(getDecisionsEndpoint()).toBe("http://localhost:8000/v1/decisions");
    expect(getDecisionsModelId()).toBe("convaiinnovations/laya");
  });
});

describe("shadow decisions — questions mirror the guide's rubric", () => {
  it("every lane key except 'none' appears verbatim in the system prompt", () => {
    for (const lane of Object.keys(DECISION_LANES)) {
      if (lane === "none") continue;
      expect(CONCIERGE_SYSTEM_PROMPT).toContain(lane);
    }
  });

  it("asks exactly the four shadow questions and no eligibility question", () => {
    const q = buildShadowDecisionQuestions();
    expect(Object.keys(q).sort()).toEqual(["lane", "off_topic", "stage", "wants_handoff"]);
    const text = JSON.stringify(q).toLowerCase();
    expect(text).not.toMatch(/eligib|qualif|dollar|benefit amount/);
    expect(Object.keys(DECISION_STAGES)).toHaveLength(6);
  });
});

describe("shadow decisions — state payload", () => {
  it("sends the message and page shape but never the address or coordinates", () => {
    const state = buildShadowDecisionState(input);
    expect(state.user_message).toBe(input.userText);
    expect(state.route).toBe("/report");
    expect(state.page_label).toBe("Incentive report");
    expect(state.report_summary).toBe("3 programs mapped");
    expect(state.has_capital_support_match).toBe(true);
    expect(state.surfaced_support_lanes).toEqual([
      "corridor_place_based",
      "small_business_capital",
    ]);
    const raw = JSON.stringify(state);
    expect(raw).not.toContain("Jeffery");
    expect(raw).not.toContain("41.76");
    expect(raw).not.toContain("Some CDFI");
  });

  it("caps the message at 2000 chars", () => {
    const state = buildShadowDecisionState({
      userText: "x".repeat(5000),
      pageContext: sanitizePageContext({ route: "/" }),
    });
    expect(state.user_message).toHaveLength(2000);
  });
});

describe("shadow decisions — response parsing", () => {
  it("parses the TypeSafe systemone shape", () => {
    const r = parseShadowDecisionResponse(goodBody);
    expect(r?.model).toBe("typesafe-ai/jev");
    expect(r?.answers.lane.choice).toBe("small_business_capital");
    expect(r?.answers.lane.probabilities.small_business_capital).toBe(0.81);
    expect(r?.answers.stage.choice).toBe("actively_planning");
    expect(r?.answers.wants_handoff).toBe(0.42);
    expect(r?.answers.off_topic).toBe(0.03);
    expect(r?.inputTokens).toBe(275);
    expect(r?.generationId).toBe("gen_abc");
  });

  it("returns null on any shape mismatch instead of throwing", () => {
    expect(parseShadowDecisionResponse(null)).toBeNull();
    expect(parseShadowDecisionResponse("nope")).toBeNull();
    expect(parseShadowDecisionResponse({ answers: {} })).toBeNull();
    expect(
      parseShadowDecisionResponse({
        answers: { ...goodBody.answers, off_topic: { type: "noul" } },
      })
    ).toBeNull();
    expect(
      parseShadowDecisionResponse({
        answers: { ...goodBody.answers, lane: { type: "choice", choice: 7 } },
      })
    ).toBeNull();
  });
});

describe("shadow decisions — evaluateShadowDecision", () => {
  it("posts the expected request to the gateway with the bearer token", async () => {
    const fetchMock = okFetch();
    const result = await evaluateShadowDecision(input, {
      fetch: fetchMock as unknown as typeof fetch,
      bearerToken: "test-key",
    });
    expect(result?.answers.lane.choice).toBe("small_business_capital");
    expect(typeof result?.latencyMs).toBe("number");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEFAULT_DECISIONS_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(DEFAULT_DECISIONS_MODEL);
    expect(body.state.route).toBe("/report");
    expect(Object.keys(body.questions).sort()).toEqual([
      "lane",
      "off_topic",
      "stage",
      "wants_handoff",
    ]);
    expect(body.questions.lane.type).toBe("choice");
    expect(body.questions.off_topic.type).toBe("noul");
  });

  it("returns null without calling out when there is no credential", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL", "");
    const fetchMock = okFetch();
    const result = await evaluateShadowDecision(input, {
      fetch: fetchMock as unknown as typeof fetch,
      bearerToken: null,
    });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 429 }));
    const result = await evaluateShadowDecision(input, {
      fetch: fetchMock as unknown as typeof fetch,
      bearerToken: "k",
    });
    expect(result).toBeNull();
  });

  it("fails open on a thrown fetch error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await evaluateShadowDecision(input, {
      fetch: fetchMock as unknown as typeof fetch,
      bearerToken: "k",
    });
    expect(result).toBeNull();
  });

  it("aborts and returns null when the model is slower than the timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(
            () => resolve(new Response(JSON.stringify(goodBody), { status: 200 })),
            200
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const started = Date.now();
    const result = await evaluateShadowDecision(input, {
      fetch: fetchMock as unknown as typeof fetch,
      bearerToken: "k",
      timeoutMs: 30,
    });
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(150);
  });
});

describe("shadow decisions — audit summary", () => {
  it("is compact JSON with no free text", () => {
    const r = parseShadowDecisionResponse(goodBody)!;
    const s = JSON.parse(summarizeShadowDecision({ ...r, latencyMs: 41 }));
    expect(s).toMatchObject({
      model: "typesafe-ai/jev",
      lane: "small_business_capital",
      lane_p: 0.81,
      stage: "actively_planning",
      stage_p: 0.66,
      wants_handoff: 0.42,
      off_topic: 0.03,
      latency_ms: 41,
      input_tokens: 275,
      generation_id: "gen_abc",
    });
    expect(JSON.stringify(s)).not.toContain("coffee");
  });
});
