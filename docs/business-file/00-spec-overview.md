# The Business File — reconciled spec

**Date:** 2026-07-10 · **Status:** Tier 1 shipping (this PR); Tiers 2–3 specified, not built
**Feature this governs:** the incentive preparation feature merged in a8f5add (business profiles, preparation packets, support requests)
**How this doc was made:** 18-agent fan-out — 4 repo readers, 4 live-web researchers (SBIF/NOF/Cook County/city-state common prerequisites), a common-core synthesis, 3 design tracks, a 24-candidate naming panel with judge, and 2 adversarial critics. Raw outputs are the numbered files in this directory. This overview is the reconciliation: where tracks conflicted or overreached, the rulings below are canonical.

---

## 1. The name

**The persistent base layer is the "Business File."** Each program-specific packet is "application prep" built from it.

- Judge's pick over 24 candidates (see `05-naming.json`): owner-instant ("the stuff about my business, kept in one place"), receiver-adoptable ("send me your business file" is real counselor speech), zero compliance overpromise, clean in UI copy ("your Business File is reused for every application you prepare").
- Runner-up: *Business Profile* (best on persistence, loses on handoff credibility — a profile is displayed, not verified). Third: the incumbent *Incentive Preparation Packet* (honest but one-shot-flavored and jargon-led; defensible hold if the rename is vetoed).
- Two-layer glossary used across copy:
  - **Business File** = the persistent business profile + the reusable foundation/continuity work (Part 1).
  - **Application prep — {Program}** = one packet: the Business File plus that program's specific pieces (Part 2).
- Internal identifiers (table names, type names, event names) do not rename. Copy only.

## 2. The two timelines (reconciliation ruling)

Track 1 (§1.1, `phase` field) and Track 3 (§1a, predicate) proposed incompatible mechanisms; the critics confirmed the `phase` field would be silently dropped by `normalizePreparationTasks` and that the tracks partition financials/tax oppositely. **Ruling — Track 3's predicate wins, with one dependency fix:**

- `isFoundationScopeTask(task) = task.category === "foundation" || CONTINUITY_TASK_IDS.has(task.id)` where `CONTINUITY_TASK_IDS = { accountant-financials, tax-good-standing }`. No new persisted field; `category` and `id` both survive normalization.
- **Financials/tax ARE foundation scope** (they are program-agnostic continuity documents a business prepares once) — Track 3's ruling, not Track 1's.
- **Dependency fix:** `accountant-financials` previously depended on the goal-overlay task, which made the foundation subset dependency-open (the skeptic's understated-critical-path finding). Financials now depends only on business identity — true to reality (you can prepare financials before defining a project scope) and it closes the subset.
- API returns `timelines: { foundation, application }`; `application` = the full-graph computation (the existing engine, unchanged). The stored `timeline` field remains as the combined alias.
- UI: two stacked sections — **"Your Business File"** (Part 1: reusable, owner-grouped) and **"This application — {Program}"** (Part 2: program pieces, with Part-1 items shown collapsed under "From your Business File (reused)"). Part 2's header is explicit that it assumes Part 1: *"after your Business File basics are in place."* The combined earliest-realistic date stays visible so end-to-end truth is never hidden.

## 3. Honesty rulings (from the adversarial critics — canonical)

| Design proposal | Ruling |
|---|---|
| Readiness **percentage** ("80% ready") | **Rejected.** Eligibility-shaped, brushes the 5/21 boundary. Show a neutral count only: "N of M items confirmed." |
| `PROGRAM_PROCESS` table with agency stage durations and posted window **dates** (NOF Aug 14/Nov 13, SBIF monthly windows) | **Rejected.** A compliance calendar in effect, and static dates rot. Program grounding ships through the existing boundary-approved `verificationSteps` shape instead — qualitative, source-linked, no dates ("confirm the current window with SomerCor"). |
| Weekly-digest program-window opt-in | **Deferred, likely never.** Closest to the banned compliance calendar. |
| Tokenized share-link subsystem (new table, public route) | **Deferred to Tier 3.** Print/PDF handoff satisfies the brief. If built: never for `program_administrator` — a URL sent to an agency is functionally a transmission; administrators get official-portal links only. |
| `complianceSelfChecks` with clear/issue-found results feeding readiness | **Rejected.** Scoring compliance is determining eligibility. Un-scored notes at most. |
| Field named `eligibilityAreaDetermination` | **Rejected as named.** "Determination" is the boundary line itself; rename to `locatorCheckResult` if ever built, never counted toward readiness. |
| `business_properties` table + owner demographics | **Deferred pending Billy's call.** Research-grounded but expands the sensitive-data footprint (net worth, demographics) with no stated retention/encryption policy. Do not store until that policy exists. |
| Administrator as packet **receiver** | **Reframed.** Realistic receivers are the accountant (verify), landlord (authorize), advisor (review), local partner (letter). Administrators receive applications through their own systems — the packet points at official portals, it doesn't land on their desk. |

## 4. Foundation-first packets (Tier 2 — designed, not shipped)

The brief wants foundation work to start before a program is chosen. The skeptic proved this is **not** a validation relaxation: `buildPreparationTasks` unconditionally requires a goal overlay, and financials/tax only generate once a goal exists. Shipping it needs: a real foundation-only task path, nullable `goal_type`/`program_name` (DB migration), a program-picker state on the detail page, and a task-merge when a program is later chosen (the existing all-or-nothing rebuild would clobber user-set statuses — a surgical merge seam must be built). Specified in `04-design-timelines.md` §2 and `02-design-structure.md`; **do not attempt as a copy change.**

Related Tier-2 items: live-profile → packet foundation-status refresh (same merge-seam prerequisite); one-click "start another application from this Business File" entry point on the packet detail page; profile home page (`/workspace/business-file`).

## 5. What ships in this PR (Tier 1)

1. **Copy rename** to the Business File glossary (all user-facing strings enumerated by reader 1 in the run output; internal names unchanged).
2. **Dual timelines**: `isFoundationScopeTask` + `calculateFoundationTimeline` + financials-dependency fix in `lib/incentive-preparation.ts`; `timelines: {foundation, application}` from the packet API; two-section rendering on the packet detail page; two-line packet cards on the workspace index.
3. **Program grounding** for the flagships via `verificationSteps` in `public/data/programs.json`: SBIF (window confirmation, Stage-1 eligibility review, EDS + DPD conditional commitment), NOF (round + corridor check, finalist legal documents, proof-of-financing after CAL), Workforce Solutions (cycle + TIF confirmation), TIF (per-project negotiation + district term), and a strengthened Class 6b pre-occupancy note (file BEFORE construction/reoccupation begins; up to one year early). All sourced from live official documents (see `07-research-live-requirements.json`), qualitative, no dates. These flow into generated packet tasks through the existing `programVerificationSteps` pipe.
4. **Spec docs** (this directory).

Data-quality flag from research, not fixed here: DCEO B2B/B2B-NewBiz and OE3 are confirmed closed — audit their `status` in programs.json separately.

## 6. Database state

`scripts/migrate-incentive-preparation.ts` was verified on disposable Neon branch `br-misty-breeze-aewnirud` on 2026-07-10 (tables, indexes, snapshot-immutability trigger fires, FK cascade clean). **Prod (`winter-hill-01244713`, branch `br-rapid-credit-aekjpelt`) does not have the tables yet** — the merged feature 500s on prod for any signed-in user. Tier 1 adds no schema changes beyond that already-written migration. Run it on prod (with explicit approval, per standing doctrine) before or with this PR's deploy.
