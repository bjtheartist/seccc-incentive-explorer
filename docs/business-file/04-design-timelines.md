## Track 3 — The Two Timelines

### 0. Where this slots in

`calculatePreparationTimeline(tasks, asOf)` (lib/incentive-preparation.ts:892) already does the hard math: topological sort over the `dependsOn` graph, `min/maxFinish` per task, longest-max-path critical path, `parallelizableWork` grouped by dependency level (levels with >1 remaining task), and `earliestRealisticDate = asOf + ceil(estimatedMaxWeeks × 7 days)`. Completed tasks contribute 0 duration (lib/incentive-preparation.ts:954–955), so every timeline shrinks as work is confirmed — that is the engine that makes continuity of effort visible. **Track 3 does not rewrite this engine. It runs it over two task subsets and layers a program-process band on top of the second one.** No promise language, no compliance calendar — the boundary doctrine (docs/audit-2026-05-21-summary-and-plan.md Part 2.5) is load-bearing throughout.

The single combined timeline surfaced today (API `packetTimeline`, app/api/incentive-preparation/[id]/route.ts:86; rendered as one "Preparation timeline" section, app/workspace/incentive-preparation/[id]/page.tsx:294–301) is replaced by two named timelines with a clear parent/child relationship.

---

### 1. The two timelines are a subset relationship, not two separate graphs

The honest mental model, and the one the code already supports: **the application timeline (Timeline 2) contains the foundation timeline (Timeline 1) as its opening subgraph.** Foundation tasks are `dependsOn` predecessors of every goal/program task (e.g. `storefront-improvement-scope` depends on `FOUNDATION_IDENTITY_TASK_ID` + `FOUNDATION_ADDRESS_TASK_ID`, lib/incentive-preparation.ts:180). So "the foundation is a prerequisite you can finish once and reuse" is literally true in the DAG.

This drives the copy pairing the brief asks for:

- **Timeline 1 = "your packet."** The reusable base. Owned by the business and its standing advisors/accountant. Persists across every application. Phrase: *"Your business packet — done once, reused for every program."*
- **Timeline 2 = "this application."** The foundation plus one target incentive's specific work and the program's own process. Phrase: *"This application — [Program name], layered on top of your packet."*

#### 1a. Partition rule (the one new lever)

Timeline 1 is computed over a **foundation-scope subset**; Timeline 2 over the **full task array**.

Add to lib/incentive-preparation.ts:

```ts
// Tasks that are program-agnostic and bank into the reusable base packet.
// category "foundation" today = identity/address/contact.
// The continuity-of-effort documents (financials, tax standing, and — as the
// field-expansion track lands them — good-standing, COI, ownership chart) are
// program-agnostic and MUST bank into Timeline 1, even though they carry
// category "dependency" today (lib/incentive-preparation.ts:549,613 etc.).
const CONTINUITY_TASK_IDS = new Set<string>([
  FINANCIALS_TASK_ID,      // accountant-financials
  TAX_STANDING_TASK_ID,    // tax-good-standing
  // future: good-standing-certificate, certificate-of-insurance, ownership-chart
]);

export function isFoundationScopeTask(task: PreparationTask): boolean {
  return task.category === "foundation" || CONTINUITY_TASK_IDS.has(task.id);
}

export function calculateFoundationTimeline(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimeline {
  return calculatePreparationTimeline(tasks.filter(isFoundationScopeTask), asOf);
}

// Timeline 2 is just the existing full-graph call — kept as-is.
export function calculateApplicationTimeline(
  tasks: readonly PreparationTask[],
  asOf: Date | string = new Date()
): PreparationTimeline {
  return calculatePreparationTimeline(tasks, asOf);
}
```

Keying on a predicate (not on category alone) avoids fighting the field-expansion track: when EIN, structured ownership, good-standing, and COI tasks land (matrix §4), they either carry `category: "foundation"` or get added to `CONTINUITY_TASK_IDS`, and they bank into Timeline 1 automatically. **Coordination note for the field track:** author every genuinely reusable continuity item as foundation-scope, and keep anything CAL/window/finalist-gated (matrix "NOT core" list — EDS, 50%-financing proof, contractor bids, triennial affidavits) OUT of foundation scope so the base packet never dishonestly reads "done."

The API (app/api/incentive-preparation/[id]/route.ts `packetSummary`/`packetDetail`, lines 96–121) returns **both** objects:

```ts
timelines: {
  foundation: calculateFoundationTimeline(tasks),   // Timeline 1
  application: calculateApplicationTimeline(tasks),  // Timeline 2 (= today's `timeline`)
}
```

Keep the existing `timeline` field as an alias of `timelines.application` for one release so nothing breaks, then remove it. The cached `timeline_json` fast-path in `packetTimeline` (route.ts:86–94) generalizes to caching `timelines`; on cache miss, recompute both.

---

### 2. Timeline 1 — foundational-packet completion

**What the owner sees at a glance (the header line):** a readiness count plus an honest range, derived entirely from `calculateFoundationTimeline`:

> **Base packet: 6 of 9 pieces confirmed. About 2–4 weeks of work left if pieces move in parallel.**

`6 of 9` = foundation-scope tasks with `status === "complete"` over total. Range = `estimatedWeeks.min`–`estimatedWeeks.max`. When `estimatedMaxWeeks === 0` (all confirmed): **"Base packet complete. Reused automatically by every application you start."**

**Render as owner-grouped swimlanes, not an ordered checklist.** Justification: foundation-scope tasks are highly parallel — most sit at dependency level 0 (identity, address, contact have empty `dependsOn`), and `parallelizableWork` already proves it. The value at this altitude is *"here is who needs to act, and most of it can happen at once,"* which a linear checklist hides. Group by `PreparationTaskOwner` (business / accountant / advisor — foundation scope rarely touches landlord/program_administrator/local_partner). Within a lane, order by dependency level so the rare sequence (financials before advisor review) still reads correctly.

Swimlane spec (component `<FoundationTimeline>`):

- One lane per owner present in the foundation subset (`timelines.foundation.owners`).
- Lane header: owner label (reuse existing `statusLabel(task.owner)`, page.tsx:318) + count "2 of 3 confirmed."
- Each task chip: title, status pill (reuse `statusClass`/`statusLabel`, page.tsx:315), and its own `estimatedMinWeeks–estimatedMaxWeeks` as "~1–3 wks." Confirmed tasks render collapsed/checked.
- A thin "critical path" marker on the chips whose ids are in `timelines.foundation.criticalPathTaskIds`, labeled once above the lanes: *"Longest chain: Confirm financials → Advisor review."* Never a date on a chip — only the aggregate range.
- Mark-complete affordance identical to today (page.tsx:322–326): only `task.mutable` tasks get the button; certification/protected tasks never appear in foundation scope.

**Empty state (no foundation work outstanding, i.e. brand-new packet with prefilled profile):** *"Your base packet is ready. When you choose a program, only the program-specific pieces get added."* — with a primary action to choose a target incentive.

**Foundation-first is now possible.** Today program+goal are mandatory at creation (POST validation, app/api/incentive-preparation/route.ts). Track 3 requires making `goalType`/`programName` optional so a user can build the base packet before choosing an incentive (the brief's "couple of program-specific fields, layered on afterward"). When no program is selected, the detail page shows **only Timeline 1** plus a "Choose a target incentive" panel; Timeline 2 does not exist yet. This is the persistent-profile promise made real.

---

### 3. Timeline 2 — program-specific application

Only rendered once a target incentive is chosen. It has **three bands**, left to right / top to bottom:

**Band A — Preparation (owned by the applicant + partners).** The full-graph `calculateApplicationTimeline` output. Foundation-scope tasks render **de-emphasized and collapsed under a "From your base packet (reused)" divider** — visually signaling these are already-banked, not re-work. Program/goal/dependency tasks render active. Same task chips, same mark-complete rules, same critical-path marker (`timelines.application.criticalPathTaskIds`). Header line mirrors Timeline 1's honesty: *"About 3–8 weeks of preparation work before this application is ready to hand off."*

**Band B — The program's process (owned by the administering agency — NOT the applicant).** This is the new data Track 3 adds and the reader findings say is missing. Model program process as reference data, keyed by program id, sourced from the research matrix §2 — never invented, never a promise:

```ts
export interface ProgramProcessStage {
  label: string;            // "Stage 1 review"
  typicalDurationLabel: string; // "about 20 days" — verbatim-ish from program docs
  note?: string;            // order-of-operations caveats
  sourceUrl: string;        // official link, same pattern as VerificationStep
}
export interface ProgramDeadlineWindow {
  label: string;            // "Monthly TIF submission window" | "Fall round"
  windowLabel: string;      // "1st 9:00am – 30th 5:00pm, monthly" | "Nov 13, 2026"
  note?: string;
  sourceUrl: string;
}
export interface ProgramProcess {
  programId: string;
  stages: ProgramProcessStage[];
  windows: ProgramDeadlineWindow[];
  orderOfOperations?: string[]; // pre-occupancy / pre-construction traps
}
```

Seed a `PROGRAM_PROCESS: Record<string, ProgramProcess>` in a new `lib/program-process.ts` from the matrix:

- **SBIF (§2A):** stages Stage 1 ≈ 20 days → Stage 2 ≈ 120 days → construction ≈ 300 days → reimbursement ≈ 4–6 weeks; window = property's monthly TIF window (1st 9am–30th 5pm, rotating), with a "lottery if oversubscribed" note; order-of-operations note = per-property 3-year Maximum-Assistance cooldown.
- **NOF (§2B):** stages scoring ≈ 1–3 months → Advisory Committee → Commissioner → finalist → legal ≈ 21 days → CAL → proof-of-financing within 4 months of CAL → construction ≈ 12 months; windows = quarterly, next posted **Aug 14, 2026** and **Nov 13, 2026**.
- **Cook County 6b/7a/7b/8 (§2C):** the **pre-occupancy / pre-construction trap** is the headline `orderOfOperations` entry: *"The eligibility application must be filed BEFORE construction, rehab, or reoccupation begins (6b up to 1 year early). Filing after work starts can forfeit the classification."* Stage: 7a determination ≈ 60 days, lapses after 1 year if not commenced.

Band B renders as a **read-only horizontal reference strip** clearly separated from Band A by an "Official next steps" divider (mirroring app/programs/page.tsx:504–531). Each stage/window is a card with the duration/window label, an `ExternalLink`-suffixed official source link (`target="_blank" rel="noopener noreferrer"`), and the locked verification copy:

> *"These stages and dates are reported by the administering agency and can change. Verify current requirements and windows with the official source before applying, purchasing materials, or beginning work."*

The 6b pre-occupancy trap renders as a **prominent order-of-operations callout at the very top of Band B**, not buried — it is the single most consequential honest warning in the whole feature. It is framed as navigation ("here is the order the program requires"), never as a deadline we track for the user.

**Band C — Combined honest outlook.** One sentence tying prep to process without adding them into a false total:

> *"Preparation: about 3–8 weeks of your work. After you submit, [Program] reports its own review process (see Official next steps). Windows and timelines are set by the program — verify them at the source."*

We deliberately do **not** sum Band A + Band B into a single "you'll be approved by" date. Doing so would manufacture a promise and imply we track the agency's clock — both boundary violations.

---

### 4. How the two relate — visual + copy

- **One page, two stacked sections**, replacing the single "Preparation timeline" block (page.tsx:294–301):
  1. `<FoundationTimeline>` under heading **"Your packet"** with subtext *"Reused for every program. Complete once."*
  2. `<ApplicationTimeline>` under heading **"This application — [Program name]"** with subtext *"Your base packet plus [Program]'s specific pieces."* Absent entirely until a program is chosen.
- **Reuse is shown, not just claimed:** in Band A the foundation tasks appear collapsed under "From your base packet (reused)", so a returning user literally sees the banked work carried in.
- **Progress framing:** Timeline 1 answers *"is my business ready to apply for things?"*; Timeline 2 answers *"is this specific application ready to hand off, and what does the program do next?"*
- Packet status labels already distinguish these (`foundation_complete` vs `ready_to_submit` → "Prepared for applicant certification", lib/incentive-preparation.ts:26–33; STATUS_LABELS in [id]/page.tsx). Wire `foundation_complete` to Timeline-1-done and keep `ready_to_submit`/`requires_certification` tied to Timeline 2's certification tail (`OFFICIAL_CERTIFICATION_TASK_ID`, applicant-only, unchanged).

---

### 5. Honest date language (enforced everywhere)

- **Only ranges.** Always `estimatedWeeks.min`–`estimatedWeeks.max` as "about X–Y weeks," never a single number.
- **"Earliest realistic date"** stays the label for `earliestRealisticDate` (already honest; it's max-path based). Always prefix *"Earliest realistic — if pieces move in parallel and external parties respond promptly."* Empty/zero → "Pending task review," as today (page.tsx:298).
- **External work is called out as not ours to promise:** any Band-A task owned by landlord/accountant/program_administrator/local_partner carries "depends on [owner]; timing is theirs."
- **Program process = reported, not guaranteed:** every Band-B duration reads *"the program reports about N days,"* never "takes N days."
- **Banned per voice rules:** no "unlock/leverage/boost/empower/game-changing," no urgency, no countdowns, no "guaranteed," no "by [date]." (Note: pre-existing "unlock" copy elsewhere is not propagated here.)
- **Staleness stamp:** every timeline surface shows `asOfDate` ("Estimated as of 2026-07-10") so numbers are never read as fixed truth — this also carries the matrix §3 staleness discipline into the UI.

---

### 6. Weekly deadline digest integration (opt-in, discovery-side only)

The brief asks to connect Timeline 2's real windows to the existing weekly digest (PR #47: lib/watchlist-digest.ts, app/api/cron/watchlist-digest/route.ts). Boundary-safe design:

- Band B's next posted window gets an **opt-in** control: *"Include [Program]'s next posted window as a reference line in my weekly email."* Default off.
- When on, the digest adds **one informational line**, not an alert: *"[Program] posted window: [windowLabel]. Reported by the program — verify at the source before relying on it. [official link]"*
- We do **not** compute "days remaining," do **not** send reminders keyed to obligation, and do **not** claim the user must file by any date. This stays navigation ("here is a posted window we found"), consistent with the locked boundary that we never maintain a compliance calendar or track compliance deadlines.
- Storage: a nullable `digest_window_optin` flag on the packet row; the cron reads packets with the flag set for the current user (same per-user ownership model as all packet routes) and appends the reference line to their existing digest payload. If a program has no posted window (only rolling/quarterly TBD), the opt-in is disabled with copy *"No posted window to reference yet."*

---

### 7. Exact rendering spec

#### 7a. Workspace — packet detail (app/workspace/incentive-preparation/[id]/page.tsx)

Replace the single `Preparation timeline` `<section>` (lines 294–301) with:

- **`<FoundationTimeline timeline={timelines.foundation} tasks={foundationTasks} />`**
  - Header: readiness count + range (§2). States: `loading` (skeleton lanes), `outstanding` (lanes with active chips), `complete` (single confirmation line + "Choose a target incentive" CTA when no program yet). Empty state per §2.
- **`<ApplicationTimeline timeline={timelines.application} process={programProcess} tasks={allTasks} />`** — only when `programId`/`programName` present.
  - Band A collapsible "From your base packet (reused)" group + active program tasks.
  - Band B "Official next steps" reference strip with pre-occupancy callout on top for 6b-class programs; each card an official `ExternalLink`.
  - Band C outlook sentence.
  - **Not-yet-chosen state:** in place of Band A/B, a panel *"No target incentive chosen yet. Your base packet is being prepared and will carry into any application."* + program picker (the "couple of program-specific fields" step).
  - **No-process-data state:** if `PROGRAM_PROCESS[programId]` is missing, Band B renders *"We don't have this program's posted process on file. Use the official source to confirm its steps and dates."* + the program's `sourceUrl`. Never fabricate stages.

Keep the existing Profile facts sidebar and Request-support panel unchanged (page.tsx:334–360).

#### 7b. Workspace — the workspace index (app/workspace/page.tsx)

In each packet card, replace the single combined range with two compact lines: **"Packet: N of M confirmed"** (foundation) and, when a program is set, **"[Program]: ~X–Y wks prep"** (application). Cards with `foundation_complete` and no program show **"Base packet ready — choose a program to start an application."**

#### 7c. Exported packet PDF (existing `report_pdf_downloaded` pipeline; new event §8)

Two-part document, boundary disclaimer on every page footer (*"Preparation support only. This packet does not certify eligibility or submit anything. Final determinations belong to the administering agency."* — mirrors the footer at new/page.tsx:508–512):

1. **"Your packet"** — foundation profile facts + Timeline 1 as an **owner-grouped checklist** (PDF is static, so swimlanes flatten to grouped checklists with confirmed/outstanding and the aggregate range + as-of date).
2. **"This application — [Program]"** (only if a program is chosen) — Band A grouped as prepared/outstanding, then a **"The program's reported process"** section listing Band-B stages/windows verbatim with printed official URLs and the verification copy, and the 6b order-of-operations callout boxed at the top.
3. Every date rendered as a range with the as-of stamp; no single completion date anywhere.

Empty-program PDF is valid and useful (that's the reusable base a business hands to an advisor) — it prints part 1 only, with *"No target incentive selected. This is the reusable base packet."*

---

### 8. Analytics events (repo snake_case convention, `preparation_*` prefix per lib/analytics-events.ts:31–34)

Register in `ANALYTICS_EVENT_TYPES` and fire via `trackEvent()` (fire-and-forget, never blocks UI):

- `preparation_timeline_viewed` — `{ packetId, view: "foundation" | "application", programId }`
- `preparation_program_selected` — the "layer on top" moment; `{ packetId, goalType, programId, programName }` (fires when a foundation-first packet gains a target incentive)
- `preparation_foundation_completed` — fires when the foundation subgraph reaches all-complete (`foundation_complete`); `{ packetId }`
- `preparation_deadline_reference_viewed` — Band B window seen; `{ packetId, programId, windowLabel }`
- `preparation_deadline_reference_added` — digest opt-in toggled on; `{ packetId, programId, windowLabel }`
- `preparation_packet_pdf_downloaded` — distinct from the report-level `report_pdf_downloaded`; `{ packetId, hasProgram: boolean }`

These let the funnel read: base-packet-built → program-selected → application-prepared → handed off (PDF), and measure whether the two-timeline split actually moves people from "looked something up" to "ready to apply."

---

### 9. Files touched (summary)

- **lib/incentive-preparation.ts** — add `CONTINUITY_TASK_IDS`, `isFoundationScopeTask`, `calculateFoundationTimeline`, `calculateApplicationTimeline`. Engine (`calculatePreparationTimeline`, lines 892–1017) unchanged.
- **lib/program-process.ts (new)** — `ProgramProcessStage/Window/Process` types + `PROGRAM_PROCESS` seeded from matrix §2A–2C, each entry carrying official `sourceUrl`.
- **app/api/incentive-preparation/route.ts** — make `goalType`/`programName` optional (foundation-first); persist optional program later.
- **app/api/incentive-preparation/[id]/route.ts** — return `timelines: { foundation, application }` (keep `timeline` alias one release); attach `programProcess` when program set; recompute both on PATCH (currently line 274).
- **app/workspace/incentive-preparation/[id]/page.tsx** — replace single timeline section with `<FoundationTimeline>` + `<ApplicationTimeline>` (bands A/B/C), program-picker state, digest opt-in.
- **app/workspace/page.tsx** — two-line packet-card summary + base-packet-ready state.
- **lib/analytics-events.ts** — register six events (§8).
- **lib/watchlist-digest.ts + cron** — append opt-in program-window reference line (§6), read `digest_window_optin`.
- **PDF export** — two-part document (§7c).
- **DB migration** — nullable `program_id`/`goal_type` (foundation-first) + `digest_window_optin`. Verify on a disposable Neon branch before prod, per standing rule.