/**
 * Site Concierge — SHADOW typed decisions (Jev via Vercel AI Gateway).
 *
 * Shadow phase only. Every model-backed turn also asks a System 1 decision
 * model (TypeSafe Jev, served by AI Gateway) four typed questions about the
 * same input the guide sees. The answers are RECORDED and never used:
 *   - they do not change the prompt, the tools, the routing, or the reply;
 *   - they are never shown to the visitor;
 *   - they are never an eligibility judgment (lane/stage/handoff/off-topic only).
 *
 * The call runs concurrently with the guide's own model call, has a hard
 * timeout, and fails open: any error, timeout, or missing credential yields
 * `null` and the turn proceeds exactly as before. Feature-flagged OFF by
 * default (CONCIERGE_SHADOW_DECISIONS === "true").
 *
 * Wire shape is the TypeSafe `systemone` request/response, which the open
 * Laya model also implements, so the endpoint can be repointed by env without
 * touching this file.
 *
 * See docs/concierge-design.md, "Shadow decisions (Jev)".
 */
import { getGatewayApiKey } from "./config";
import type { ConciergePageContext } from "./types";

export const DEFAULT_DECISIONS_ENDPOINT =
  "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const DEFAULT_DECISIONS_MODEL = "typesafe-ai/jev";
/** Hard ceiling; the guide's own stream is never delayed by the shadow call. */
export const DECISIONS_TIMEOUT_MS = 300;
/** Audit row tool_name for concierge_tool_actions (never a real tool). */
export const SHADOW_DECISION_TOOL_NAME = "shadow.jev.decision";

/** Support lanes, mirrored VERBATIM from the routing rubric in system-prompt.ts. */
export const DECISION_LANES = {
  corridor_place_based:
    "Early navigation, local context, licensing, or general next-step help tied to a specific corridor or neighborhood",
  business_navigation:
    "General business navigation and next-step help not tied to a corridor",
  capital_readiness:
    "Organizing financial information, understanding financing options, or preparing for a lender conversation",
  small_business_capital:
    "A business financing need such as equipment, working capital, expansion, or owner-occupied space",
  property_community_development:
    "A complex real estate, vacant-site, nonprofit facility, or community-development project",
  housing_homeownership:
    "A homebuyer, homeowner, or housing-counseling need (not a general business request)",
  none: "No local support organization is being sought in this message",
} as const;

/** Project stages, mirrored from the conversational-aid list in system-prompt.ts. */
export const DECISION_STAGES = {
  exploring_idea: "Exploring an idea; nothing concrete decided yet",
  actively_planning: "Actively planning a specific business or project",
  organizing_information: "Organizing documents, numbers, or details for an application or conversation",
  prepared_for_first_conversation:
    "Prepared for a useful first conversation with a support organization or lender",
  already_connected: "Already working with an organization or lender",
  unclear: "The message does not say where the project stands",
} as const;

export type DecisionLane = keyof typeof DECISION_LANES;
export type DecisionStage = keyof typeof DECISION_STAGES;

/** The state object sent as `state`. Small, non-sensitive, no address or coordinates. */
export interface ShadowDecisionState {
  user_message: string;
  route: string;
  page_label?: string;
  report_summary?: string;
  surfaced_support_lanes: string[];
  has_capital_support_match: boolean;
}

export interface ShadowDecisionAnswers {
  lane: { choice: DecisionLane | string; probabilities: Record<string, number> };
  stage: { choice: DecisionStage | string; probabilities: Record<string, number> };
  /** P(true): the visitor is asking to be connected to a person or organization. */
  wants_handoff: number;
  /** P(true): unrelated to Chicago business incentives, business support, or the page. */
  off_topic: number;
}

export interface ShadowDecisionResult {
  model: string;
  answers: ShadowDecisionAnswers;
  latencyMs: number;
  inputTokens: number | null;
  /** Gateway generation id when present, for tracing in the Gateway dashboard. */
  generationId: string | null;
}

export interface ShadowDecisionDeps {
  fetch?: typeof fetch;
  /** Bearer token override (tests). Default: AI_GATEWAY_API_KEY, then Vercel OIDC. */
  bearerToken?: string | null;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  now?: () => number;
}

export function isShadowDecisionsEnabled(): boolean {
  return process.env.CONCIERGE_SHADOW_DECISIONS === "true";
}

export function getDecisionsEndpoint(): string {
  const fromEnv = process.env.CONCIERGE_DECISIONS_ENDPOINT?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_DECISIONS_ENDPOINT;
}

export function getDecisionsModelId(): string {
  const fromEnv = process.env.CONCIERGE_DECISIONS_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_DECISIONS_MODEL;
}

/** Build the `state` payload from the same inputs the guide receives. */
export function buildShadowDecisionState(input: {
  userText: string;
  pageContext: ConciergePageContext;
}): ShadowDecisionState {
  const { userText, pageContext } = input;
  const lanes = new Set<string>();
  for (const org of pageContext.localSupportOrganizations ?? []) {
    for (const lane of org.supportLanes ?? []) lanes.add(lane);
  }
  return {
    user_message: userText.slice(0, 2000),
    route: pageContext.route,
    page_label: pageContext.pageLabel,
    report_summary: pageContext.reportSummary?.slice(0, 600),
    surfaced_support_lanes: [...lanes].sort(),
    has_capital_support_match: Boolean(pageContext.capitalSupportName),
  };
}

/** The four typed questions. Exported so the eval/diff script asks the same ones. */
export function buildShadowDecisionQuestions() {
  return {
    lane: {
      type: "choice",
      instructions:
        "Which kind of local support organization best fits what this visitor is asking for right now?",
      criteria: DECISION_LANES,
    },
    stage: {
      type: "choice",
      instructions: "Where does this visitor's business or project stand?",
      criteria: DECISION_STAGES,
    },
    wants_handoff: {
      type: "noul",
      instructions:
        "Is the visitor asking to be connected to, introduced to, or put in touch with a person or organization?",
    },
    off_topic: {
      type: "noul",
      instructions:
        "Is this message unrelated to Chicago business incentives, business support, or the page the visitor is on?",
    },
  } as const;
}

async function resolveBearerToken(deps: ShadowDecisionDeps): Promise<string | null> {
  if (deps.bearerToken !== undefined) return deps.bearerToken;
  const key = getGatewayApiKey();
  if (key) return key;
  const fromEnv = process.env.VERCEL_OIDC_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  // Deployed Vercel functions: same OIDC path the Gateway package uses. The
  // package is a transitive dependency; degrade to "no credential" if absent.
  try {
    const mod = (await import("@vercel/oidc")) as {
      getVercelOidcToken?: () => Promise<string>;
    };
    const token = await mod.getVercelOidcToken?.();
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function probMap(x: unknown): Record<string, number> {
  if (!x || typeof x !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** Parse the TypeSafe `systemone` response. Returns null on any shape mismatch. */
export function parseShadowDecisionResponse(
  body: unknown
): Omit<ShadowDecisionResult, "latencyMs"> | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const answers = rec.answers as Record<string, Record<string, unknown>> | undefined;
  if (!answers || typeof answers !== "object") return null;

  const lane = answers.lane;
  const stage = answers.stage;
  const wants = answers.wants_handoff;
  const off = answers.off_topic;
  if (!lane || !stage || !wants || !off) return null;
  if (typeof lane.choice !== "string" || typeof stage.choice !== "string") return null;
  const wantsP = num(wants.noul);
  const offP = num(off.noul);
  if (wantsP === null || offP === null) return null;

  const usage = rec.usage as Record<string, unknown> | undefined;
  const meta = rec.provider_metadata as
    | { gateway?: { generationId?: unknown } }
    | undefined;
  const generationId = meta?.gateway?.generationId;

  return {
    model: typeof rec.model === "string" ? rec.model : "unknown",
    answers: {
      lane: { choice: lane.choice, probabilities: probMap(lane.probabilities) },
      stage: { choice: stage.choice, probabilities: probMap(stage.probabilities) },
      wants_handoff: wantsP,
      off_topic: offP,
    },
    inputTokens: num(usage?.input_tokens),
    generationId: typeof generationId === "string" ? generationId : null,
  };
}

/**
 * Ask the decision model. NEVER throws and never takes longer than the timeout.
 * Returns null when disabled-by-credential, on timeout, on non-2xx, or on a
 * response that does not match the expected shape.
 */
export async function evaluateShadowDecision(
  input: { userText: string; pageContext: ConciergePageContext },
  deps: ShadowDecisionDeps = {}
): Promise<ShadowDecisionResult | null> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DECISIONS_TIMEOUT_MS;
  const started = now();
  try {
    const token = await resolveBearerToken(deps);
    if (!token) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(deps.endpoint ?? getDecisionsEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: deps.model ?? getDecisionsModelId(),
          state: buildShadowDecisionState(input),
          questions: buildShadowDecisionQuestions(),
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const parsed = parseShadowDecisionResponse(await res.json());
      if (!parsed) return null;
      return { ...parsed, latencyMs: now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Compact, non-sensitive summary for the audit row / runtime log. */
export function summarizeShadowDecision(result: ShadowDecisionResult): string {
  const a = result.answers;
  const p = (r: Record<string, number>, k: string) =>
    typeof r[k] === "number" ? Number(r[k].toFixed(3)) : null;
  return JSON.stringify({
    model: result.model,
    lane: a.lane.choice,
    lane_p: p(a.lane.probabilities, a.lane.choice),
    stage: a.stage.choice,
    stage_p: p(a.stage.probabilities, a.stage.choice),
    wants_handoff: Number(a.wants_handoff.toFixed(3)),
    off_topic: Number(a.off_topic.toFixed(3)),
    latency_ms: result.latencyMs,
    input_tokens: result.inputTokens,
    generation_id: result.generationId,
  });
}
