## Track 2 — Handoff, Roles & Verification

### 0. Scope and the boundary this track must never cross

The packet is a **handoff artifact**: at several points it leaves the applicant's hands and is read, answered, or acted on by an external party (an accountant, a landlord, a chamber advisor, a program intake desk). This track designs who those parties are, what they receive, how consent gates every share, how the packet moves from `needs_information` to `ready_to_submit`, and the copy for every handoff moment. Everything here layers on top of the persistent business profile designed in Track 1 — the handoff never re-collects foundational facts, it references them.

The 2026-05-21 product boundary (verbatim in `docs/audit-2026-05-21-summary-and-plan.md` lines 169–220, restated in `docs/growth-playbook.md` line 26) governs every decision in this track. Restating it here because Track 2 is where it is most tempting to violate:

**The packet DOES:** identify zones, explain incentives, name administering agencies, link to official sources and application portals, flag "verify before spending money," and *prepare users to talk to advisors / chambers / lenders / DCEO / DPD / SomerCor / Cook County*. Organizing a handoff and recording an intent-to-share are squarely inside "prepare users to talk to advisors."

**The packet DOES NOT:** determine final eligibility, certify businesses, track compliance deadlines, interpret tax rules, submit applications, maintain a compliance calendar, or tell users what they are legally required to file. Therefore this track's handoff flow **never emails an agency on the user's behalf, never asserts the packet is complete/eligible/approved, never routes a submission, and never tells a user they are obligated to file anything.** It records that the user *intends* to share, and it produces an artifact the user *themselves* hands over. The only actor who can certify or submit is the applicant or an authorized representative (`completionAuthority: "applicant_or_authorized_representative"`, `lib/incentive-preparation.ts` line 718).

This is consistent with the existing support-request route, which today "does not send any email/notification — nothing is routed to anyone; it is purely a logged record of intent-to-share." That property is a feature, not a limitation, and this track preserves it.

---

### (a) The cast — who receives a packet, mapped onto existing task owners

`lib/incentive-preparation.ts` (line ~24, `PREPARATION_TASK_OWNERS`) already defines six owners: `business`, `advisor`, `accountant`, `landlord`, `local_partner`, `program_administrator`. Every task carries exactly one owner. These six are the complete cast — we do **not** add new owner types. Instead we give each non-`business` owner a real-world identity, the tasks that route to them, and the handoff surface they touch.

| Owner (code) | Real-world receiver | Tasks routed to them (from `buildPreparationTasks`) | What they do with the packet | Boundary note |
|---|---|---|---|---|
| `business` | The applicant themselves (or an authorized rep) | Foundation identity/address/contact tasks; the final `official-certification-submission` task | Fills, reviews, and is the **only** party who certifies/submits | Never delegable for certification (line 717 `applicantOnly: true`) |
| `accountant` | The business's CPA / bookkeeper | "Prepare accountant-reviewed financials"; "Obtain tax and good-standing records" | Verifies or supplies financial artifacts (3-yr returns, income/bank statements, net-worth figures per the matrix 1C) | Accountant *verifies* facts; does not certify eligibility |
| `landlord` | Property owner / lessor | "Document site control or landlord authorization" | Confirms or provides deed / lease / landlord authorization (matrix 1C site-control doc) | Landlord *authorizes*; the determination is still the agency's |
| `local_partner` | Chamber (SECCC), delegate agency, ward office | "Request a local support letter" | Provides a support/impact letter (NOF scored factor, 6b/7a necessity narrative per matrix 2B/2C) | Support letter ≠ approval |
| `program_administrator` | SomerCor (SBIF intake), DPD/NOF reviewer, Cook County Assessor, DCEO | "Confirm current program requirements"; "Confirm zoning and permit path"; and the surfacing of every "Official next step" | Answers requirements questions; ultimately makes the eligibility/award decision | **The only party who determines eligibility and award** — must be stated at every touch |
| `advisor` | Chamber advisor, delegate-agency counselor, attorney | "Review the preparation packet with an advisor" | Reviews the assembled packet before the applicant certifies | Advisor *reviews*; does not certify on the applicant's behalf |

Implementation: add an `owner` → receiver-metadata map (label, one-line role description, the boundary-safe verb) in a new `lib/incentive-preparation-handoff.ts` (keep `lib/incentive-preparation.ts` focused on task/timeline computation). This map drives the dependency UX (section e) and the handoff copy (section f). The verbs are fixed and boundary-safe: accountant → **verifies**, landlord → **authorizes**, local_partner → **provides a letter**, program_administrator → **determines** (agency-only) / **answers requirements**, advisor → **reviews**, business → **certifies and submits** (applicant-only).

---

### (b) The handoff artifact — what a shared/exported packet contains

The packet is handed over in two forms. Both are **applicant-driven** (the user exports/shares; the tool never transmits to a third party).

**Form 1 — Print / PDF (the thing the applicant physically hands to their accountant, landlord, or carries to a SomerCor intake appointment).**

Generate a print-optimized route `app/workspace/incentive-preparation/[id]/print/page.tsx` (server-rendered, `@media print` styles, Warm Bureau tokens: `#FAF9F6` bg, `#0C1B33` navy, `.font-editorial` headers, `.font-mono-bureau` micro-labels — per the design system in the reader findings). The PDF is produced by the browser's own print-to-PDF; we do not add a server PDF dependency. Contents, in order (foundation-first per the brief):

1. **Header band** — packet title, the mandatory boundary disclaimer verbatim: *"This packet supports application preparation and does not certify eligibility or an award. Final determinations belong to the program administrator."* (already live at `new/page.tsx` lines 508–512). This appears on **page 1 and in the running print footer** so it survives being printed and re-shared.
2. **Business profile facts** — the foundational profile from Track 1 (identity, addresses, contact, entity, ownership, financials as applicable), each with a provenance/`asOf` line so a reviewer sees how fresh each fact is (matrix Section 3 staleness).
3. **Selected program** — labeled *"Likely match"* with the existing hedge copy: *"This is a likely match for preparation purposes, not an eligibility decision, award estimate, or official certification."* (`[id]/page.tsx` lines 288–290).
4. **The two timelines** (Track 1's dual-timeline model) — foundation-packet timeline and, if a program is chosen, the incentive-specific timeline.
5. **Task list grouped by owner** — so an accountant sees only the accountant tasks, a landlord only the site-control task. Each task shows status and which party it waits on.
6. **Official next steps** — the `VerificationStep[]` links for the selected program, using the locked "Official next steps" block pattern from `app/programs/page.tsx` (~line 508), every link `target="_blank" rel="noopener noreferrer"` with the `ExternalLink` affix. Verbatim: *"Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work."*

**Form 2 — Share link (a read-only view the applicant can send to one named party).**

A share link is **consent-scoped and content-filtered**. It renders a subset of Form 1 determined by the consent scopes the applicant selected (section c). New route `app/share/incentive-preparation/[token]/page.tsx`, backed by a new `incentive_packet_shares` table:

```
incentive_packet_shares(
  id, packet_id (FK, ON DELETE CASCADE), user_id (owner, for scoping),
  token (opaque, unguessable), target_organization TEXT,
  target_owner_role TEXT,           -- one of PREPARATION_TASK_OWNERS, drives which tasks show
  consent_scope_json JSONB,         -- reuse ALLOWED_CONSENT_SCOPES vocabulary
  consented_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,  -- default now()+14d; links are not permanent
  revoked_at TIMESTAMPTZ,           -- applicant can revoke
  created_at, updated_at
)
```

The share view is **strictly read-only and non-actionable**: the recipient cannot mark tasks complete, cannot certify, cannot submit, cannot see un-scoped data. It carries the same header disclaimer as the PDF plus a recipient-facing banner (section f). A recipient reaching an expired/revoked token sees a plain "This shared view is no longer available" page — no data. This mirrors the existing per-user ownership model (every route scopes `WHERE user_id = ${userId}`); the token is the only mechanism by which a non-owner sees any packet data, and it exposes strictly less than the owner sees.

**What the receiving party sees** depends on `target_owner_role`: an `accountant` link shows business identity + financial tasks + the specific documents requested, but not (for example) the ownership demographics (voluntary, matrix 1B) unless `business_profile` scope was explicitly granted. A `program_administrator`/intake link shows the full assembled profile and official-next-step links, because that is what the applicant would hand across a SomerCor desk — but it still shows the "not an eligibility decision" hedges.

---

### (c) Consent — how it works, extended from the existing route

Consent is already implemented correctly and must be preserved. `app/api/incentive-preparation/[id]/support-request/route.ts` enforces:
- `body.consent === true` or `400 "Explicit consent is required"`
- non-empty `requestedHelp` and `targetOrganization`
- `scope` restricted to `ALLOWED_CONSENT_SCOPES = {business_profile, packet, documents, contact_information}` or `400 "scope must include only approved consent scopes"`
- packet ownership check (`WHERE id = ${id} AND user_id = ${userId}`) before insert
- `status: 'pending'`, `consented_at: NOW()`, and **no transmission** — UI success copy: *"Recorded. This request has not been accepted or routed."*

Extend, do not replace:
1. **Reuse the same scope vocabulary** for share links (`consent_scope_json` above uses `ALLOWED_CONSENT_SCOPES`). One consent vocabulary across support-requests and shares keeps the model honest and auditable.
2. **Consent is per-share and per-scope, and re-affirmed each time.** Generating a new share link requires ticking the same explicit consent checkbox (*"I explicitly consent to share only the selected business data with this target organization for this request."* — existing label, `[id]/page.tsx` line 353). No standing/implicit consent, no "share with everyone."
3. **Revocation.** The applicant can revoke a share link (`revoked_at`), which immediately dead-ends the token. This is the applicant retaining control of their own handoff — inside the boundary.
4. **`consented_at` is the audit anchor.** Because the tool never routes anything, the consent timestamp is the record that the *applicant* chose to share; it is never evidence that a third party received or accepted anything.

---

### (d) Packet state machine — `needs_information` → `ready_to_submit`, and the certification gate

The state machine already exists in `summarizePreparationStatus()` (`lib/incentive-preparation.ts` lines 843–871) and is computed from task statuses, not stored as mutable state — this is correct and we keep it derived. The six `PreparationPacketStatus` values and their exact derivation:

```
needs_information   ← any non-cert task is needs_document or needs_owner_answer
                       (also the empty-tasks default)
waiting_on_others   ← remaining open non-cert tasks are external_dependency
                       (owner is landlord / accountant / local_partner / program_administrator)
needs_advisor       ← an open non-cert task is needs_advisor (the advisor-review task)
requires_certification ← all prep work done; a requires_certification task remains
ready_to_submit     ← every non-cert task complete AND cert task(s) present
                       → label shown to user: "Prepared for applicant certification"
foundation_complete ← foundation done, no program/cert layered yet (Track 1 base packet)
```

Rendered as a linear progress rail on `[id]/page.tsx`, most states are transient collector states, not a strict ladder — a packet can sit in `waiting_on_others` and `needs_information` conceptually at once; `summarizePreparationStatus` picks the **most-blocking** status to display (information gaps before external waits before advisor before certification). The `STATUS_LABELS` map already provides plain labels: *Foundation complete / Needs information / Waiting on others / Needs advisor review / Applicant certification required / Prepared for applicant certification*.

**The certification gate — presentation.** The terminal task is always `official-certification-submission` (`OFFICIAL_CERTIFICATION_TASK_ID`, sorted last by `normalizePreparationTasks`). It is protected on three layers, all of which stay:
- **Data:** `applicantOnly: true`, `completionAuthority: "applicant_or_authorized_representative"`, status `requires_certification` (lines 711–718).
- **Server:** `canApplicantUpdateTask()` returns false for `requires_certification` (line 836–841), and `app/api/incentive-preparation/[id]/route.ts` explicitly blocks any transition into `complete` on a `requires_certification` task, returning *"This task is protected. Final certification and submission belong only to the applicant or an authorized representative."*
- **Client:** `task.mutable` is false, so the Mark-complete/Reopen toggle is replaced by a `LockKeyhole` notice: *"Only the applicant or authorized representative can complete official certification. This packet does not automate it."* (`[id]/page.tsx` line 321).

The gate is presented as the honest end of the tool's involvement. When a packet reaches `ready_to_submit` ("Prepared for applicant certification"), the UI shows: the assembled artifact (print/share buttons), the **Official next steps** links for the selected program (the real portal where the applicant themselves certifies/submits), and the lock notice. There is deliberately **no "Submit" button in the tool** — the CTA is "Open the official application" (external link), never "Submit." This is the concrete UI expression of the 5/21 "does not submit applications / does not certify" rules.

---

### (e) Dependency UX — "waiting on your accountant / landlord / program administrator"

Tasks whose owner is not `business` and whose status is `external_dependency` (or `needs_document`/`needs_advisor` with a non-business owner) are the packet's external dependencies. The dependency UX makes the wait legible without ever nudging the *third party* (the tool has no channel to them) — it nudges the *applicant* to make the handoff.

**On the task row** (`[id]/page.tsx`, task list): render an owner chip using the receiver map from section (a): e.g. *"Waiting on: your accountant"*, *"Waiting on: your landlord"*, *"Waiting on: program administrator"* with the boundary-safe verb (*verifies / authorizes / provides a letter / answers requirements*). Below it, a single action: **"Prepare a handoff for this"** → opens the consent-scoped share/support-request flow (section b/c) pre-filled with `target_owner_role` = that task's owner and a suggested `requestedHelp` string derived from the task title. For `program_administrator` tasks the primary action is instead **"Open the official source"** (the `VerificationStep` link), because the administrator is reached through the official portal, not through a shared packet.

**Nudges are applicant-facing and passive.** Because nothing is routed, a "nudge" is a reminder to *the applicant* that a dependency is open — never a message to the third party. Options, all inside the boundary:
- A count on the packet card and in the state rail: *"2 items waiting on others."*
- If the daily/weekly digest infrastructure from PR #47 (`lib/watchlist-digest.ts`) is extended, an **opt-in** applicant reminder: *"Your packet has items waiting on your accountant and landlord."* This reminds Billy's user to chase their own accountant; it does not contact the accountant. Mark this explicitly out-of-scope-of-compliance: it is a personal reminder, not a "compliance deadline" (the 5/21 does-not list forbids maintaining a compliance calendar). If a task has a program clock (matrix Section 3, e.g. SBIF 120-day financing window), the reminder states the fact descriptively and links to the official source for the authoritative date — it does not compute or assert the deadline as the tool's own determination.

**Analytics.** Reuse the existing snake_case events (`lib/analytics-events.ts` lines 31–34): `preparation_support_requested` fires on a handoff record. Add, following the same convention, `preparation_packet_shared` (metadata `{ targetOwnerRole, scopeCount }`) and `preparation_packet_exported` (metadata `{ format: "print" }`). Do not invent new casing or shapes.

---

### (f) Boundary-safe copy for every handoff moment

Every string below is plain/descriptive, free of banned sales language (unlock, leverage, boost, empower, game-changing), free of urgency, and never implies the tool certifies, approves, submits, or determines anything. Where existing copy already nails it, reuse verbatim.

**Starting a handoff (applicant side):**
- Section heading: *"Prepare a handoff"* (neutral; no "send," which implies routing).
- Sub: *"Organize what one person or organization needs from this packet. Nothing is sent from here — you choose what to share and hand it over yourself."*
- Scope picker heading (reuse): *"Choose exactly what may be shared. A request is recorded only; it is not accepted or routed automatically."* (`[id]/page.tsx` lines 347–348).
- Consent checkbox (reuse verbatim): *"I explicitly consent to share only the selected business data with this target organization for this request."*
- Confirmation (reuse verbatim): *"Recorded. This request has not been accepted or routed."*

**On the exported/printed packet (recipient reads this):**
- Header disclaimer (reuse verbatim): *"This packet supports application preparation and does not certify eligibility or an award. Final determinations belong to the program administrator."*
- Program label (reuse verbatim): *"Likely match — this is a likely match for preparation purposes, not an eligibility decision, award estimate, or official certification."*

**On a share link (recipient banner):**
- *"You are viewing a preparation packet that [business name] chose to share with you. It is a working document, not an application and not an approval. It was prepared with the SECCC Chicago Incentive Explorer, a tool for finding and preparing for incentives. Final eligibility and award decisions are made only by the administering agency."*

**Dependency rows (applicant side):**
- Accountant: *"Waiting on your accountant to verify the financial records for this step."*
- Landlord: *"Waiting on your landlord or property owner to provide site control or authorization."*
- Local partner: *"Waiting on a support letter from your chamber or a local partner."*
- Program administrator: *"This step is confirmed with the administering agency. Use the official source below."* (paired with the official-next-step link, not a handoff).
- Advisor: *"Ready for an advisor to review before you certify."*

**At the certification gate (reuse verbatim + framing):**
- Lock notice (reuse): *"Only the applicant or authorized representative can complete official certification. This packet does not automate it."*
- Terminal CTA: *"Open the official application"* (external link to the program portal) — **never** *"Submit."*
- Adjacent (reuse the locked verification pattern from `app/programs/page.tsx`): *"Some incentives require certification, pre-approval, or reporting through the administering agency. Verify current requirements with the official source before applying, purchasing materials, or beginning work."* under an **"Official next steps"** header, links `target="_blank" rel="noopener noreferrer"` + `ExternalLink` icon.

**Banned across all of the above:** any phrasing that says the packet is "complete," "eligible," "approved," "qualified," "submitted," or "on file"; any deadline stated as the tool's own determination; any message addressed to or auto-delivered to a third party.

---

### 5/21 does / does-not, resolved against this track

| 5/21 rule | How Track 2 honors it |
|---|---|
| DOES: name administering agencies | Owner map names SomerCor/DPD/NOF/Assessor/DCEO as `program_administrator`; share view and PDF label them |
| DOES: link to official sources & portals | Certification gate and every `program_administrator` dependency route to `VerificationStep` official links, not to an in-tool action |
| DOES: flag "verify before spending money" | Verbatim verification copy on PDF, share view, and gate |
| DOES: prepare users to talk to advisors/chambers/lenders/DCEO/DPD/SomerCor | The entire handoff/dependency UX is exactly this: organize what to bring to those parties |
| DOES NOT: determine final eligibility / certify | No status ever asserts eligibility; certification task is applicant-only, triple-locked; "Likely match" hedge everywhere |
| DOES NOT: submit applications | No Submit button; terminal CTA is an external "Open the official application" link |
| DOES NOT: maintain a compliance calendar / track deadlines | Dependency reminders are opt-in personal nudges to the applicant, descriptive not authoritative; program clocks link out to the official source for the real date |
| DOES NOT: tell users what they are legally required to file | Copy says "some incentives require…verify current requirements with the official source," never "you must file X" |
| DOES NOT: route/submit on anyone's behalf | Support-request and share both *record consent only*; no email/notification is sent to any third party; the applicant hands the artifact over themselves |

---

### Implementation checklist (files)

1. **`lib/incentive-preparation-handoff.ts` (new)** — owner→receiver metadata map (label, role sentence, boundary-safe verb) keyed on the existing `PREPARATION_TASK_OWNERS`. No new owner types.
2. **`scripts/migrate-incentive-preparation.ts` (extend)** — add `incentive_packet_shares` table (schema in section b) with `ON DELETE CASCADE` on `packet_id`, `token` unique, `expires_at`/`revoked_at`. Keep the existing immutable-`profile_snapshot_json` trigger untouched.
3. **`app/api/incentive-preparation/[id]/share/route.ts` (new)** — POST creates a consent-scoped share (mirror the support-request validation: `consent===true`, scope ∈ `ALLOWED_CONSENT_SCOPES`, ownership check); DELETE revokes. Fire `preparation_packet_shared`.
4. **`app/api/incentive-preparation/[id]/support-request/route.ts` (keep as-is)** — already correct; reuse its consent pattern rather than duplicating.
5. **`app/share/incentive-preparation/[token]/page.tsx` (new)** — read-only, scope-filtered, non-actionable recipient view with recipient banner; handles expired/revoked → plain unavailable page.
6. **`app/workspace/incentive-preparation/[id]/print/page.tsx` (new)** — print/PDF form with running-footer disclaimer.
7. **`app/workspace/incentive-preparation/[id]/page.tsx` (extend)** — owner chips + "Prepare a handoff" / "Open the official source" per dependency; "N items waiting on others" count; Print/Share buttons; keep the certification lock and derived state rail exactly as they are.
8. **`lib/analytics-events.ts` (extend)** — add `preparation_packet_shared`, `preparation_packet_exported` following existing snake_case convention.
9. **Do not change** `summarizePreparationStatus`, `canApplicantUpdateTask`, the certification-block in `[id]/route.ts`, or the profile-snapshot immutability trigger — these enforce the boundary and are correct.
