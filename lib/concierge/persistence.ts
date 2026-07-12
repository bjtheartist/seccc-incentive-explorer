/**
 * Stage 3 best-effort persistence for the Site Concierge audit tables
 * (concierge_conversations / concierge_messages / concierge_tool_actions).
 *
 * RULES (design note §5 / task item 5):
 *   - Persist ONLY when the DB is configured AND the user is SIGNED IN. Guests
 *     are never written to the DB (their usage lives only in analytics events).
 *   - Persistence is strictly BEST-EFFORT. Every write is wrapped so a missing
 *     table (the migration hasn't run) or any DB error can NEVER break the chat.
 *   - A conversation is keyed by (user_id, session_id) so multi-turn exchanges
 *     in one session append to one conversation row.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

type SQL = NeonQueryFunction<false, false>;

export interface ConciergePersistContext {
  sql: SQL;
  userId: string;
  sessionId: string;
  pageRoute?: string | null;
  modelId?: string | null;
}

/** A tool call captured from the stream, for the audit row. */
export interface PersistedToolCall {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  /** proposed | approved | declined | executed | failed */
  approvalStatus?: string;
  resultSummary?: string | null;
  needsApproval?: boolean;
}

export interface PersistedCitation {
  programId?: string;
  officialUrl?: string;
  [key: string]: unknown;
}

/**
 * Find the most recent conversation for this (user, session) or create one.
 * Returns the conversation id, or null if anything fails (best-effort).
 */
export async function ensureConciergeConversation(
  ctx: ConciergePersistContext
): Promise<string | null> {
  try {
    const existing = await ctx.sql`
      SELECT id FROM concierge_conversations
      WHERE user_id = ${ctx.userId} AND session_id = ${ctx.sessionId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (existing.length) return String((existing[0] as { id: string }).id);

    const created = await ctx.sql`
      INSERT INTO concierge_conversations (user_id, session_id, page_route, model_id)
      VALUES (${ctx.userId}, ${ctx.sessionId}, ${ctx.pageRoute ?? null}, ${ctx.modelId ?? null})
      RETURNING id
    `;
    return created.length ? String((created[0] as { id: string }).id) : null;
  } catch {
    return null;
  }
}

async function insertMessage(
  ctx: ConciergePersistContext,
  conversationId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  toolCalls: PersistedToolCall[],
  citations: PersistedCitation[]
): Promise<string | null> {
  try {
    const rows = await ctx.sql`
      INSERT INTO concierge_messages (
        conversation_id, user_id, role, content, tool_calls_json, citations_json
      )
      VALUES (
        ${conversationId},
        ${ctx.userId},
        ${role},
        ${content.slice(0, 20000)},
        ${JSON.stringify(toolCalls)}::jsonb,
        ${JSON.stringify(citations)}::jsonb
      )
      RETURNING id
    `;
    return rows.length ? String((rows[0] as { id: string }).id) : null;
  } catch {
    return null;
  }
}

async function insertToolAction(
  ctx: ConciergePersistContext,
  conversationId: string,
  messageId: string | null,
  call: PersistedToolCall
): Promise<void> {
  const status = call.approvalStatus ?? (call.needsApproval ? "proposed" : "executed");
  try {
    await ctx.sql`
      INSERT INTO concierge_tool_actions (
        conversation_id, message_id, user_id, tool_name, tool_call_id,
        input_json, approval_status, result_summary
      )
      VALUES (
        ${conversationId},
        ${messageId},
        ${ctx.userId},
        ${call.toolName},
        ${call.toolCallId ?? null},
        ${JSON.stringify(call.input ?? {})}::jsonb,
        ${status},
        ${call.resultSummary ?? null}
      )
    `;
  } catch {
    /* best-effort */
  }
}

/**
 * Persist one completed turn: the latest user message, the assistant response
 * (with its tool calls + citations), and an audit row per tool call. Entirely
 * best-effort and never throws.
 */
export async function persistConciergeTurn(
  ctx: ConciergePersistContext,
  turn: {
    userText: string;
    assistantText: string;
    toolCalls: PersistedToolCall[];
    citations: PersistedCitation[];
  }
): Promise<void> {
  try {
    const conversationId = await ensureConciergeConversation(ctx);
    if (!conversationId) return;

    if (turn.userText.trim()) {
      await insertMessage(ctx, conversationId, "user", turn.userText, [], []);
    }

    const assistantId = await insertMessage(
      ctx,
      conversationId,
      "assistant",
      turn.assistantText,
      turn.toolCalls,
      turn.citations
    );

    for (const call of turn.toolCalls) {
      await insertToolAction(ctx, conversationId, assistantId, call);
    }

    try {
      await ctx.sql`
        UPDATE concierge_conversations
        SET message_count = message_count + 2, updated_at = NOW()
        WHERE id = ${conversationId}
      `;
    } catch {
      /* best-effort */
    }
  } catch {
    /* best-effort — never break the chat */
  }
}

/** Pull program citations (officialUrl) out of tool results for the audit row. */
export function extractCitations(toolResults: unknown[]): PersistedCitation[] {
  const citations: PersistedCitation[] = [];
  const seen = new Set<string>();
  const consider = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    const url = typeof rec.officialUrl === "string" ? rec.officialUrl : undefined;
    const id = typeof rec.id === "string" ? rec.id : undefined;
    if (url && !seen.has(url)) {
      seen.add(url);
      citations.push({ programId: id, officialUrl: url });
    }
  };
  for (const result of toolResults) {
    const output = (result as { output?: unknown })?.output ?? result;
    if (!output || typeof output !== "object") continue;
    const rec = output as Record<string, unknown>;
    consider(rec.program);
    if (Array.isArray(rec.programs)) rec.programs.forEach(consider);
  }
  return citations.slice(0, 25);
}
