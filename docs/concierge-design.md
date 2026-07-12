# Site Concierge — Design Note: Conversational Navigation & Packet Assistance

**Status:** proposed (not built). Shelf note — pick up after Tier 1b persona chips ships and funnel data is read.
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
- Promise or estimate incentive dollars beyond the existing, already-shipped estimate surfaces and their copy.
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
1. Where does the guest panel live first — report page only, or report + homepage "tell me your address and what you're trying to do" (the activation-lever variant)?
2. Conversation retention: how long do guest transcripts live, and do signed-in transcripts attach to the profile?
3. Who reviews the adversarial eval set before launch — Billy only, or SECCC staff too?
4. Daily budget cap value and what the panel shows when it's hit.

## 9. Verify before building (stale-docs rule)
- AI SDK tool-approval API shape against live docs (feature is current as of 2026-07 but the API surface moves).
- Gateway model availability + current per-provider rates for `gpt-oss-120b`.
- Open-weight tool-calling quality on our actual tool set (run the eval suite against 2–3 candidate models before committing).
