# Site Concierge — Design Note: Conversational Navigation & Packet Assistance

**Status:** implemented as a hybrid pilot on 2026-07-12. Common guidance is deterministic and sourced; nuanced signed-in changes use approval-gated model tools when Gateway capacity is available.
**Source:** Billy + Claude working session, 2026-07-12. Builds on the Report & Refine Workflow Audit (2026-07-10) and the Business File spec (`docs/business-file/00-spec-overview.md`).
**Scope recommendation (decided):** build first on the **report page and Incentive Preparedness Packet**, not as an unrestricted site-wide chatbot. That gives businesses free personalized assistance, gives partner governments better-prepared requests, and strengthens the institutional product.

**Boundary reminder:** the model provides the conversation; **the existing Explorer stays the source of truth**. This is a discovery/navigation surface under the 2026-05-21 product boundary — nothing here certifies eligibility.

---

## 1. What the concierge does

### For every visitor (no sign-in)
- Explain the current page or report in plain language.
- Ask what they are trying to accomplish.
- Navigate them to relevant programs and report sections (client-side navigation actions, not just links in prose).
- Answer questions using official program information, with citations to the program data the engine already loads.
- Produce a temporary next-step checklist.
- Explain what information they would need to continue (toward a profile/packet).

### For signed-in users
- Build and update their reusable business profile.
- Start an Incentive Preparedness Packet ("application prep — {Program}").
- Ask for missing information conversationally.
- Record draft answers for packet requirements.
- Update applicant-controlled tasks **after explicit confirmation**.
- Prepare a partner support request (consent-gated, see §3).
- Resume where the business stopped during a previous visit.

### Example conversation
> "I want to remodel my storefront and hire three employees."

The concierge identifies the relevant report sections, asks several project questions, populates the business profile, starts the packet, shows the next three tasks, and offers to connect the owner with a local partner.

## 2. What it will not do
- Decide official eligibility.
- Expose internal scoring (corridor scoring stays internal — see 24a52e2).
- Promise an award or combine individual program figures into a top-line incentive-dollar estimate or deal budget.
- Certify information for the applicant.
- Submit an application or send any external message without approval.
- Invent deadlines, requirements, or source information (no answer without a source in the loaded program data).

All persona copy stays descriptive and mirrors the shipped report language: "may apply / estimate / verify with administrators."

## 3. Existing code already enforces the hard boundaries (verified 2026-07-12)
- **Business profile updates** are auth-gated PATCH — `app/api/business-profiles/[id]/route.ts:194`.
- **Packet task updates** are auth-gated, body-validated, task-scoped PATCH — `app/api/incentive-preparation/[id]/route.ts:220`.
- **Partner support requests** hard-require `consent === true` or 400 — `app/api/incentive-preparation/[id]/support-request/route.ts:72`.

The concierge's action tools call these same routes (or the logic behind them) as the authenticated user — it inherits every guard instead of re-implementing them. Tools never get a service-role bypass.

## 4. What we need to build
1. A contextual concierge panel on report and workspace pages (not site-wide in v1).
2. A streaming `/api/concierge` endpoint.
3. **Read-only tools:** reports, programs, profiles, packets, deadlines, local resources.
4. **Approval-gated tools:** profile updates, packet changes, support requests — using the AI SDK's native tool-approval flow (human confirms in the UI before the tool executes). Ref: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
5. Audit tables: conversation, tool-action, approval, and source-citation records.
6. Rate limits (IP + session), daily budgets, abuse detection, safe failure behavior (degrade to plain navigation links, never to invented answers).
7. An evaluation suite using real business questions **and adversarial prompts** (eligibility fishing, dollar-promise fishing, prompt injection via addresses/program names).

No RAG infrastructure in v1: the ~70-program static dataset fits in context or behind a simple search tool.

## 5. Model and cost (verify rates at build time — do not trust this table blind)
- **Pilot candidate:** `gpt-oss-120b` (Apache 2.0 open-weight, tool-use support) via **Vercel AI Gateway**; route easy navigation turns to a smaller model, harder questions to the larger one. Refs: https://help.openai.com/en/articles/11870455-openai-open-weight-models-gpt-oss , https://vercel.com/ai-gateway/models/gpt-oss-120b/providers , https://vercel.com/docs/ai-gateway/pricing
- Gateway provider rates as of 2026-07: ~$0.10–$0.35 / M input, ~$0.50–$0.75 / M output; $5/month free-tier experimentation credit.
- A substantial session (~100k in / 10k out) ≈ **1.5–4.3¢** before retries and safety checks.
- Budget: **5–15¢ per completed session; ~$50–$150/month at 1,000 substantial sessions.** Little additional database cost during the pilot. At current traffic (~842 pv/30d) real spend rounds to zero.
- **No self-hosted GPUs initially** — hosted open-weight inference is cheaper and easier at low volume. Self-hosting stays an option later for privacy, scale, or government data-residency requirements.
- Keep the model swappable (Gateway abstraction): if open-weight tool-calling quality disappoints in evals, Haiku-class hosted models are the fallback at comparable cost.

## 6. Build estimate
| Phase | Scope | Estimate |
|---|---|---|
| 1 | Read-only guest concierge (panel, endpoint, read tools, citations, rate limits) | 5–7 working days |
| 2 | Signed-in profile + packet actions (approval-gated tools) | +1–2 weeks |
| 3 | Approvals hardening, persistence/resume, evaluations, abuse controls, partner escalation | +1–2 weeks |
| 4 | Secure document extraction + application drafting (uploads, extraction, retention rules, application-specific schemas — the missing layer for 80–90% application completion) | +2–4 weeks |

A trustworthy action-capable pilot ≈ **3–4 weeks** (phases 1–3); document completion is the next phase, not the pilot.

## 7. Instrumentation
`concierge_opened`, `concierge_message`, per-tool-call events, `concierge_action_approved` / `_declined`, `concierge_handoff_requested` — added to `ANALYTICS_EVENT_TYPES` like `map_preview_clicked` was. Success metric: movement in the activation funnel (baseline 2%, ~34 product touches/30d) and packet starts/completions per session.

## 8. Open questions
1. The first release mounts the guide on the report builder, generated report, and signed-in workspace routes.
2. Guest transcripts are never stored. Signed-in audit conversations are retained for 90 days by default, configurable from 1–365 days.
3. Who reviews the adversarial eval set before launch — Billy only, or SECCC staff too?
4. Production starts at 100 model-backed turns/day. Deterministic guidance remains available without model spend; a throttled model turn shows the resting message.

## 9. Verify before building (stale-docs rule)
- AI SDK tool-approval API shape against live docs (feature is current as of 2026-07 but the API surface moves).
- Gateway model availability + current per-provider rates for `gpt-oss-120b`.
- Open-weight tool-calling quality on our actual tool set (run the eval suite against 2–3 candidate models before committing).

---

## Stage 1 implementation notes (2026-07-12)

Stage 1 (read-only guest concierge) is implemented on `feat/concierge-stage1`. Scope is exactly §1 "for every visitor" + §2 boundaries — no signed-in profile/packet actions, no approval-gated tools, no audit tables, no DB writes (those are Stages 2–4).

### Feature flag — safe to merge with no keys
The guide is OFF unless \`CONCIERGE_ENABLED === "true"\`. With the flag on, common sourced guidance works without a model credential. Model-backed turns use \`AI_GATEWAY_API_KEY\` locally or Vercel's automatic \`VERCEL_OIDC_TOKEN\` in deployments.

### Environment variables (add to Vercel / \`.env.local\` when enabling — no \`.env.example\` in this repo)
| Var | Required | Default | Purpose |
|---|---|---|---|
| \`CONCIERGE_ENABLED\` | to turn on | (off) | Must equal \`"true"\` to enable. |
| \`AI_GATEWAY_API_KEY\` | local model eval only | — | Vercel AI Gateway credential. Production uses deployment OIDC. **Secret — never commit.** |
| \`CONCIERGE_MODEL\` | no | \`openai/gpt-oss-120b\` | Gateway model id. Swappable for a Haiku-class fallback (§5). |
| \`CONCIERGE_RETENTION_DAYS\` | no | \`90\` | Signed-in conversation audit retention, bounded to 1–365 days. Guest transcripts are never stored. |

No secrets are committed. Keys are read from \`process.env\` only.

### Verified against live AI SDK docs (2026-07-12)
- \`ai-sdk.dev/docs/getting-started/nextjs-app-router\` — route handler shape, \`convertToModelMessages\` (async in this version), \`toUIMessageStreamResponse\`.
- \`ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling\` — \`tool({ inputSchema, execute })\`, multi-step via \`stopWhen: stepCountIs(n)\`.
- \`ai-sdk.dev/docs/ai-sdk-ui/chatbot\` — \`useChat\` + \`DefaultChatTransport\`, per-request \`sendMessage(msg, { body })\`, \`message.parts\` tool-part shape.
- Exact exports re-confirmed against the installed packages. Versions installed: **\`ai@7.0.22\`**, **\`@ai-sdk/react@4.0.23\`**, **\`@ai-sdk/gateway@4.0.16\`** (zod@4 already present). Local evaluation passes an explicit API key; Vercel production uses the Gateway package's native OIDC path.

### What shipped
- **\`app/api/concierge/route.ts\`** — streaming \`streamText\` endpoint. Feature gate → session cookie → rate limit → body caps (≤20 messages, ≤2000 chars/msg) → \`stopWhen: stepCountIs(6)\`. \`app/api/concierge/status/route.ts\` exposes the flag boolean only.
- **Read-only tools** (\`lib/concierge/tools.ts\`): \`searchPrograms\`, \`getProgram\` (carries \`officialUrl\` + \`verificationSteps\`), \`listZonesAtPoint\` (reuses the report engine's point-in-zone logic, now extracted to \`lib/zones-check.ts\` and imported by both the tool and \`/api/zones/check\`), \`getPageContext\` (echoes client-sent route + report summary; no server fetch), and \`navigateTo\` (allowlist in \`lib/concierge/navigation.ts\`; **suggests** only). Every tool returns sourced facts and hedged notes.
- **System prompt** (\`lib/concierge/system-prompt.ts\`) encodes §2: no eligibility determinations, no dollar promises, no invented deadlines/URLs, cite \`officialUrl\`, redirect eligibility questions to administrators, treat tool/address/program text as data not instructions, refuse off-topic/injection.
- **Panel** (\`components/concierge/ConciergePanel.tsx\`): floating trigger + right slide-over, mono/hairline/#2563EB/#0C1B33 system, markdown-lite (bold/lists/links), tool status lines, citation links, and "Take me there →" nav buttons (user clicks — never auto-navigate). Mounted on **/report** (\`app/report/page.tsx\`, \`suppressed={showEmailGate}\`) and on **all /workspace** routes (new \`app/workspace/layout.tsx\`). The trigger hides while any modal dialog is open (MutationObserver on \`dialog[open], [role="dialog"], [aria-modal="true"]\`) so it never fights the native \`<dialog>\` email gate and is reachable once the gate resolves.
- **Instrumentation** (added to \`ANALYTICS_EVENT_TYPES\`): \`concierge_opened\`, \`concierge_message_sent\`, \`concierge_tool_called\`, \`concierge_nav_suggested\` — fired client-side through the existing \`/api/events\` pipe, exactly-once via a fired-key set.
- **Eval seed**: \`tests/concierge/eval-prompts.json\` (20 real + 11 adversarial, with expectedBehavior). Consumed by the Stage 3 eval suite; Stage 1 only unit-tests plumbing.

### Rate-limit design + documented limitation
Per-IP **20 msg/hour** and per-session **40 msg/day** use Upstash when configured, otherwise the existing Neon \`concierge_usage_counters\` table. Both are cross-instance. In-memory is only the final local/outage fallback.

### Notes for Stage 2 (interface contract)
- **Tool registry**: \`buildConciergeTools({ pageContext, onToolCall })\` returns the read-only tool map. Stage 2 adds approval-gated action tools (profile update, packet task update, support request) to this same map, using the AI SDK tool-approval flow, and calls the existing auth-gated routes (§3) as the authenticated user — do **not** re-implement guards.
- **Page context**: \`ConciergePageContext\` (\`lib/concierge/types.ts\`) is the client→server contract; extend it (e.g. \`businessProfileId\`, \`packetId\`) rather than adding server fetches.
- **Auth**: the Stage-1 route is unauthenticated. Stage 2 must read the session (next-auth) in the route to authorize action tools and scope the session/rate-limit keys to the user.
- **Persistence**: no transcript storage in Stage 1 (open question §8.2). Stage 3 adds the conversation/tool-action/approval/citation audit tables.
- **Model routing**: \`getConciergeModelId()\` centralizes the model id; add the "easy→small, hard→large" split (§5) here.

---

## Stage 2 & 3 implementation notes (2026-07-12)

Stages 2 (signed-in, approval-gated actions) and 3 (trust infrastructure) are implemented. Everything stays OFF unless \`CONCIERGE_ENABLED === "true"\`; model credentials are optional because the sourced deterministic path remains available without them.

### Verified approval API shape (against installed \`ai@7.0.22\` + \`@ai-sdk/react@4.0.23\`, and live docs 2026-07-12)
The AI SDK moved to a tool-level / \`streamText\`-level approval model. Confirmed exports and shapes:
- **Tool declares approval**: \`tool({ inputSchema, execute, needsApproval: true })\` — \`needsApproval\` is a real field on the installed \`Tool\` type (\`boolean | ToolNeedsApprovalFunction\`). We set \`needsApproval: true\` on each of the five action tools only; the read tools omit it and auto-execute. (\`streamText\` also accepts a \`toolApproval: { toolName: 'user-approval' }\` map — equivalent; we chose the per-tool flag so the approval intent lives at the tool definition.)
- **Server route**: no special config — the same \`streamText(...).toUIMessageStreamResponse()\` handles the approval round-trip. When a tool needs approval the stream emits an \`approval-requested\` tool part instead of executing.
- **Client**: \`useChat({ transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })\` (both exported from \`ai\`). The panel reads \`part.approval.id\` on the \`approval-requested\` part and calls \`addToolApprovalResponse({ id, approved })\` (from \`useChat\`). On approve/decline the \`sendAutomaticallyWhen\` helper resubmits so the server runs (or skips) the tool.
- **Tool part states rendered**: \`approval-requested\` → approval card; \`approval-responded\`/\`input-*\` → "Working…"; \`output-available\` → success/deep-link; \`output-denied\` → "you declined — nothing changed".

### Action tools (all \`needsApproval: true\`) — \`lib/concierge/action-tools.ts\`
\`updateBusinessProfile\`, \`updatePacketTask\`, \`createFoundationPacket\`, \`selectPacketProgram\`, \`prepareSupportRequest\`. Merged into the **same** \`buildConciergeTools\` map only when \`actions\` deps are passed (signed-in + DB configured). Boundary re-asserted: actions PREPARE/ORGANIZE only. \`prepareSupportRequest\` **drafts** and deep-links into the existing consent-gated packet form; it never POSTs the support request (consent checkbox + submit stay in that UI).

### Ownership re-verification (never trust model-supplied ids)
The session \`userId\` is captured server-side in the route (\`getCurrentUserId()\`) and closed over in the action deps — it is **never** read from tool input. Every executor re-checks ownership with a \`WHERE ... AND user_id = \${userId}\` query (\`ownedProfileId\` / \`ownsPacket\`) **before** acting; an unowned id returns a polite tool result and touches nothing. Actions then COMPOSE with the existing auth-gated routes (they inherit every guard):
- \`updateBusinessProfile\` → dynamic-import + call the exported \`PATCH\` of \`app/api/business-profiles/[id]/route\`.
- \`updatePacketTask\` → exported \`PATCH\` of \`app/api/incentive-preparation/[id]/route\` (its applicant-only / certification guard is preserved).
- \`createFoundationPacket\` → exported \`POST\` of \`app/api/incentive-preparation/route\`.

The handlers are **dynamically imported inside the executors** (not at module top level) so the next-auth adapter chain — which is not ESM-\`exports\`-clean under plain \`tsx\` — never loads for consumers that merely import the tool map (e.g. the eval runner). Session auth still resolves correctly because the nested handler's \`getServerSession\` reads the same ambient request context.

### Business File composition
\`selectPacketProgram\` composes directly with the merged, authenticated packet \`PATCH\` route and supplies \`programId\`, \`programName\`, and \`goalType\` together. The route permits an idempotent re-selection of the same target and rejects repointing a packet to another program. \`createFoundationPacket\` composes with the existing authenticated packet-creation route.

### Stage 3 — trust infrastructure
- **Audit tables** (\`scripts/migrate-concierge.ts\`, idempotent, follows \`migrate-incentive-preparation.ts\`; applied to production on 2026-07-12): \`concierge_conversations\` (user, session, page, model, message_count), \`concierge_messages\` (role, content, \`tool_calls_json\`, \`citations_json\` for source/officialUrl records), \`concierge_tool_actions\` (tool, \`input_json\`, \`approval_status\` proposed|approved|declined|executed|failed, \`result_summary\`), and \`concierge_usage_counters\` for shared limits. npm script \`db:migrate:concierge\` remains outside the general migration chain because persistence is optional/best-effort.
- **Persistence** (\`lib/concierge/persistence.ts\`): route persists in \`streamText.onFinish\` **only when DB configured AND user signed in**; guests are never written to the DB (their usage stays in analytics events). Strictly best-effort — every write is wrapped so a missing table (migration not run) or any error can never break the chat. Conversation keyed by (user, session).
- **Daily budget** (\`lib/concierge/budget.ts\`): global per-day model-turn cap, env \`CONCIERGE_DAILY_BUDGET\` (default 500). Uses Upstash when configured, otherwise the existing Neon database; in-memory is the final outage fallback. Deterministic turns do not consume model budget.
- **Abuse controls**: max input length (Stage-1 caps retained); \`screenPageContext\` redacts prompt-injection markers in client-supplied page-context fields (address/summary/program names) and flags them; \`noteConciergeRejection\`/\`clearConciergeRejection\` add an escalating repeated-429 backoff; a profanity/off-domain refusal note is added to the system prompt. Session-scoped rate-limit keys for signed-in users (\`user:{id}\`) instead of the clearable cookie.
- **Eval RUNNER** (\`scripts/concierge-eval.ts\`, \`npm run concierge:eval\`, NOT in CI): runs \`tests/concierge/eval-prompts.json\` against the live gateway, scores boundary behavior, and supports \`CONCIERGE_EVAL_LIMIT\` plus a custom report filename. It skips cleanly without a local key. See \`docs/concierge-eval-report.md\` for the launch result.

### New env vars (Stage 2/3)
| Var | Required | Default | Purpose |
|---|---|---|---|
| \`CONCIERGE_DAILY_BUDGET\` | no | \`500\` | Global per-day model-turn cap. Production is configured to \`100\` for the pilot. |
| \`UPSTASH_REDIS_REST_URL\` / \`_TOKEN\` | no | — | Optional fast counter store. Neon provides the cross-instance fallback. |

No new dependencies were added. Additive API only; no changes to Business File / packet page / report page beyond the existing concierge mount; persona/corridor code untouched.

### Judgment calls
1. **Per-tool \`needsApproval\` over the \`streamText.toolApproval\` map** — approval intent belongs at the tool definition, and it cleanly marks exactly the action tools without a parallel config list.
2. **Compose by calling exported route handlers (dynamic import) rather than HTTP-to-self**. Profile, task, packet creation, and program selection all call the merged guarded route handlers directly.
3. **Ownership pre-check in the executor AND the route's own \`WHERE user_id\`** — double enforcement; the executor short-circuits with friendlier copy before any handler call.
4. **No packet-page edits for \`packetId\` context** — the model reads the packet id from the route path (\`/workspace/incentive-preparation/{id}\`) via \`getPageContext\`, so \`ConciergePageContext\` did not need new populated fields (scope fence).
5. **HMAC \`experimental_toolApprovalSecret\` not enabled** — ownership is re-verified server-side in every executor and actions inherit the auth-gated routes, so a forged approval cannot exceed what the user could already do; the secret is available as future hardening.
