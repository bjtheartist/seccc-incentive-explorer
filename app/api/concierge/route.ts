import { NextRequest, NextResponse } from "next/server";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createGateway } from "@ai-sdk/gateway";
import {
  CONCIERGE_MAX_MESSAGE_CHARS,
  CONCIERGE_MAX_MESSAGES,
  CONCIERGE_MAX_STEPS,
  getConciergeModelId,
  getGatewayApiKey,
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

/** Guard: reject payloads that are too many messages or too long. */
function messagesWithinCaps(messages: UIMessage[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  if (messages.length > CONCIERGE_MAX_MESSAGES) return false;
  for (const m of messages) {
    const text = (m.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (text.length > CONCIERGE_MAX_MESSAGE_CHARS) return false;
  }
  return true;
}

/** Latest user message text (for the audit row). */
function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    return (m.parts ?? [])
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
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
  if (!apiKey) {
    return NextResponse.json(
      { error: "concierge_disabled", message: CONCIERGE_DISABLED_MESSAGE },
      { status: 503 }
    );
  }

  // 2. Session cookie (created if absent) + signed-in identity.
  let sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = newSessionId();

  const userId = await getCurrentUserId().catch(() => null);

  // Session-scoped rate-limit key: tied to the account for signed-in users
  // (not a clearable cookie), to the cookie session for guests.
  const sessionKey = userId ? `user:${userId}` : sessionId;
  const backoffKey = userId ? `user:${userId}` : `ip:${clientIp(request)}`;

  // 3. Rate limits (fail closed) with repeated-429 backoff.
  const decision = checkConciergeRateLimit(clientIp(request), sessionKey);
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

  // 4. Global daily budget (design note §6). Friendly 429 when exhausted.
  const budget = await consumeDailyBudget();
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

  clearConciergeRejection(backoffKey);

  // 5. Parse + validate body.
  let body: { messages?: UIMessage[]; pageContext?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!messagesWithinCaps(messages)) {
    return NextResponse.json(
      { error: "invalid_messages", message: "Message payload rejected." },
      { status: 400 }
    );
  }

  // 6. Sanitize then SCREEN the page context for prompt-injection markers.
  const { context: pageContext } = screenPageContext(
    sanitizePageContext(body.pageContext)
  );

  // 7. Build tools. Guests get the read-only Stage-1 map exactly. Signed-in
  //    users additionally get the approval-gated action tools — but only when
  //    the DB is configured (the action tools need ownership queries).
  const sql = getSQL();
  let actions: ConciergeActionDeps | undefined;
  if (userId && sql) {
    actions = {
      userId,
      sql,
      requestOrigin: requestOrigin(request),
      cookieHeader: request.headers.get("cookie") ?? "",
    };
  }

  const gateway = createGateway({ apiKey });
  const tools = buildConciergeTools({ pageContext, actions });
  const modelMessages = await convertToModelMessages(messages);
  const modelId = getConciergeModelId();

  const result = streamText({
    model: gateway(modelId),
    system: CONCIERGE_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(CONCIERGE_MAX_STEPS),
    temperature: 0.3,
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
            userText: latestUserText(messages),
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

  if (isNewSession) {
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`
    );
  }

  return response;
}
