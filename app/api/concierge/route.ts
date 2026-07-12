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
import { checkConciergeRateLimit } from "@/lib/concierge/rate-limit";
import { buildConciergeTools } from "@/lib/concierge/tools";
import { sanitizePageContext } from "@/lib/concierge/types";

export const runtime = "nodejs";

const SESSION_COOKIE = "concierge_sid";

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown-ip";
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

  // 2. Session cookie (created if absent) + rate limits (fail closed).
  let sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const isNewSession = !sessionId;
  if (!sessionId) sessionId = newSessionId();

  const decision = checkConciergeRateLimit(clientIp(request), sessionId);
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: decision.scope,
        message: CONCIERGE_RESTING_MESSAGE,
      },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      }
    );
  }

  // 3. Parse + validate body.
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

  const pageContext = sanitizePageContext(body.pageContext);

  // 4. Stream with read-only tools and a bounded multi-step loop.
  const gateway = createGateway({ apiKey });
  const tools = buildConciergeTools({ pageContext });
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: gateway(getConciergeModelId()),
    system: CONCIERGE_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(CONCIERGE_MAX_STEPS),
    temperature: 0.3,
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
