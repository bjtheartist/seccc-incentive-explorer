import { NextRequest, NextResponse } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createGateway } from "@ai-sdk/gateway";
import {
  CONCIERGE_MAX_MESSAGE_CHARS,
  CONCIERGE_MAX_MESSAGES,
  CONCIERGE_MAX_OUTPUT_TOKENS,
  CONCIERGE_MAX_PAYLOAD_CHARS,
  CONCIERGE_MAX_STEPS,
  getConciergeModelId,
  getGatewayApiKey,
  hasGatewayCredential,
  isConciergeEnabled,
} from "@/lib/concierge/config";
import {
  CONCIERGE_DISABLED_MESSAGE,
  CONCIERGE_RESTING_MESSAGE,
  CONCIERGE_SYSTEM_PROMPT,
} from "@/lib/concierge/system-prompt";
import {
  checkConciergeRateLimit,
  clearConciergeRejection,
  noteConciergeRejection,
} from "@/lib/concierge/rate-limit";
import { consumeDailyBudget } from "@/lib/concierge/budget";
import { screenPageContext } from "@/lib/concierge/abuse";
import { buildConciergeTools } from "@/lib/concierge/tools";
import {
  CONCIERGE_ACTION_TOOL_NAMES,
  type ConciergeActionDeps,
} from "@/lib/concierge/action-tools";
import { sanitizePageContext } from "@/lib/concierge/types";
import {
  buildDeterministicConciergeResponse,
  shouldUseSignedInActionTools,
} from "@/lib/concierge/fallback";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import {
  extractCitations,
  persistConciergeTurn,
  type PersistedToolCall,
} from "@/lib/concierge/persistence";

export const runtime = "nodejs";

const SESSION_COOKIE = "concierge_sid";
const ACTION_TOOL_SET = new Set<string>(CONCIERGE_ACTION_TOOL_NAMES);

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown-ip";
}

function requestOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return request.nextUrl.origin;
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  return part.type === "text" && typeof part.text === "string";
}

function isActionApprovalResponsePart(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  const type = typeof part.type === "string" ? part.type : "";
  const toolName = type.startsWith("tool-") ? type.slice("tool-".length) : "";
  if (!ACTION_TOOL_SET.has(toolName) || part.state !== "approval-responded") {
    return false;
  }
  if (!part.approval || typeof part.approval !== "object") return false;
  const approval = part.approval as Record<string, unknown>;
  return (
    typeof approval.id === "string" &&
    Boolean(approval.id.trim()) &&
    typeof approval.approved === "boolean"
  );
}

/** Guard: reject payloads that are too many messages or too long. */
function messagesWithinCaps(messages: UIMessage[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  if (messages.length > CONCIERGE_MAX_MESSAGES) return false;
  for (const m of messages) {
    if (!m || typeof m !== "object" || !Array.isArray(m.parts)) return false;
    if (typeof m.id !== "string" || !m.id.trim()) return false;
    if (!(["user", "assistant"] as string[]).includes(m.role)) {
      return false;
    }
    const text = m.parts
      .filter(isTextPart)
      .map((p) => p.text)
      .join("");
    if (text.length > CONCIERGE_MAX_MESSAGE_CHARS) return false;
  }
  const lastMessage = messages[messages.length - 1]!;
  if (lastMessage.role === "user") return true;

  // The AI SDK resubmits the assistant message after the owner approves or
  // declines a native tool-approval card. Accept only that narrow continuation
  // shape, and only for this guide's known action tools.
  return lastMessage.parts.some(isActionApprovalResponsePart);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function appendSessionCookie(
  response: Response,
  sessionId: string,
  isNewSession: boolean
) {
  if (!isNewSession) return;
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`
  );
}

function deterministicStreamResponse(
  text: string,
  sessionId: string,
  isNewSession: boolean
): Response {
  const partId = `guide_${newSessionId()}`;
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "text-start", id: partId });
      writer.write({ type: "text-delta", id: partId, delta: text });
      writer.write({ type: "text-end", id: partId });
    },
  });
  const response = createUIMessageStreamResponse({ stream });
  appendSessionCookie(response, sessionId, isNewSession);
  return response;
}

/** Latest user message text (for the audit row). */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    return (m.parts ?? [])
      .filter(isTextPart)
      .map((p) => p.text)
      .join(" ")
      .slice(0, 4000);
  }
  return "";
}

export async function POST(request: NextRequest) {
  // 1. Feature gate — safe to merge with no keys provisioned.
  if (!isConciergeEnabled()) {
    return NextResponse.json(
      { error: "concierge_disabled", message: CONCIERGE_DISABLED_MESSAGE },
      { status: 503 }
    );
  }

  const apiKey = getGatewayApiKey();
  const gatewayCredentialAvailable = hasGatewayCredential();

  // 2. Reject malformed payloads before they can consume a shared rate or
  // daily-budget slot.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (JSON.stringify(rawBody).length > CONCIERGE_MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const validation = await safeValidateUIMessages<UIMessage>({
    messages: rawBody.messages,
  });
  const messages = validation.success ? validation.data : [];
  if (!messagesWithinCaps(messages)) {
    return NextResponse.json(
      { error: "invalid_messages", message: "Message payload rejected." },
      { status: 400 }
    );
  }

  // 3. Session cookie (created if absent) + signed-in identity.
  let sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = newSessionId();

  const userId = await getCurrentUserId().catch(() => null);
  const sql = getSQL();

  // Session-scoped rate-limit key: tied to the account for signed-in users
  // (not a clearable cookie), to the cookie session for guests.
  const sessionKey = userId ? `user:${userId}` : sessionId;
  const backoffKey = userId ? `user:${userId}` : `ip:${clientIp(request)}`;

  // 4. Shared rate limits with repeated-429 backoff.
  const decision = await checkConciergeRateLimit(
    clientIp(request),
    sessionKey,
    Date.now(),
    sql
  );
  if (!decision.allowed) {
    const extra = noteConciergeRejection(backoffKey);
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: decision.scope,
        message: CONCIERGE_RESTING_MESSAGE,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(decision.retryAfterSeconds + extra),
        },
      }
    );
  }

  clearConciergeRejection(backoffKey);

  // 5. Sanitize then SCREEN the page context for prompt-injection markers.
  const { context: pageContext } = screenPageContext(
    sanitizePageContext(rawBody.pageContext)
  );
  const userText = latestUserText(messages);

  // 6. Common requests use a sourced, zero-model path. This keeps navigation,
  // goal discovery, report explanations, and hard boundaries available even
  // when a model provider is throttled.
  const deterministicText = await buildDeterministicConciergeResponse({
    userText,
    pageContext,
    signedIn: Boolean(userId),
  });
  if (deterministicText) {
    if (userId && sql) {
      await persistConciergeTurn(
        {
          sql,
          userId,
          sessionId,
          pageRoute: pageContext.route,
          modelId: "deterministic-v1",
        },
        {
          userText,
          assistantText: deterministicText,
          toolCalls: [],
          citations: [],
        }
      );
    }
    return deterministicStreamResponse(
      deterministicText,
      sessionId,
      isNewSession
    );
  }

  // No credential means signed-in action requests still fail safely and direct
  // the owner to the existing guarded UI.
  if (!gatewayCredentialAvailable) {
    const actionRequest = shouldUseSignedInActionTools({
      text: userText,
      pageContext,
      signedIn: Boolean(userId),
    });
    return deterministicStreamResponse(
      actionRequest
        ? "The live assistant is unavailable for that saved-record change right now. Nothing was changed. You can continue securely in [your workspace](/workspace), where profile and packet updates stay under your control."
        : "The live assistant is unavailable for that question right now. You can still explore [programs](/programs), check an address on the [report builder](/report), or tell me whether the business plans to improve its space, hire, buy equipment, open, or relocate.",
      sessionId,
      isNewSession
    );
  }

  // 7. Only model-backed turns consume the global daily model budget.
  const budget = await consumeDailyBudget(Date.now(), sql);
  if (!budget.allowed) {
    const extra = noteConciergeRejection(backoffKey);
    return NextResponse.json(
      {
        error: "daily_budget_exhausted",
        message: CONCIERGE_RESTING_MESSAGE,
      },
      { status: 429, headers: { "Retry-After": String(3600 + extra) } }
    );
  }

  // 8. Build tools. Guests get the read-only Stage-1 map exactly. Signed-in
  //    users additionally get the approval-gated action tools — but only when
  //    the DB is configured (the action tools need ownership queries).
  let actions: ConciergeActionDeps | undefined;
  if (userId && sql) {
    actions = {
      userId,
      sql,
      requestOrigin: requestOrigin(request),
      cookieHeader: request.headers.get("cookie") ?? "",
    };
  }

  const gateway = createGateway(apiKey ? { apiKey } : {});
  const tools = buildConciergeTools({ pageContext, actions });
  const modelMessages = await convertToModelMessages(messages);
  const modelId = getConciergeModelId();

  const result = streamText({
    model: gateway(modelId),
    system: CONCIERGE_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(CONCIERGE_MAX_STEPS),
    maxOutputTokens: CONCIERGE_MAX_OUTPUT_TOKENS,
    temperature: 0.3,
    providerOptions: {
      gateway: { disallowPromptTraining: true },
    },
    onFinish: async (event) => {
      // Stage 3 persistence: signed-in + DB only, strictly best-effort.
      if (!userId || !sql) return;
      try {
        const rawCalls = (event.toolCalls ?? []) as Array<{
          toolName?: string;
          toolCallId?: string;
          input?: unknown;
        }>;
        const toolCalls: PersistedToolCall[] = rawCalls.map((c) => ({
          toolName: String(c.toolName ?? "unknown"),
          toolCallId: c.toolCallId,
          input: c.input,
          needsApproval: ACTION_TOOL_SET.has(String(c.toolName ?? "")),
        }));
        const citations = extractCitations(
          (event.toolResults ?? []) as unknown[]
        );
        await persistConciergeTurn(
          {
            sql,
            userId,
            sessionId: sessionId!,
            pageRoute: pageContext.route,
            modelId,
          },
          {
            userText,
            assistantText: event.text ?? "",
            toolCalls,
            citations,
          }
        );
      } catch {
        /* best-effort — never surface a persistence failure */
      }
    },
  });

  const response = result.toUIMessageStreamResponse({
    onError: () => CONCIERGE_RESTING_MESSAGE,
  });

  appendSessionCookie(response, sessionId, isNewSession);

  return response;
}
