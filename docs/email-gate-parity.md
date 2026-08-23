# Email gate redesign — parity ledger

Source of visual law: `R6GateBlessed.dc.html` (the blessed board, read verbatim —
see the spec file this branch was built from). Every row below is
`{board element → implementation locus → verification → status}`.

Statuses: **PASS** | **INTENTIONAL-DIFF** (reason from the closed list: (a)
sample→real data, (b) mock-named item absent, (c) illustrative values, (d)
copy-length from real data — or, per gate review round 1's binding ruling
on BLOCKER 4, a written-out reason when the claim-surface rule outranks the
board) | **PARTIAL** (mechanism built + render-tested + zero fabrication +
named follow-up).

**Gate review round 1 verdict: FIX-FIRST** (4 BLOCKERs, 8 MAJORs, 3 MINORs).
**Gate review round 2 verdict: FIX-FIRST** — round 1's findings 3, 4, 5, 6,
7, 8, 9, 11, 12, 13, 14, 15 were confirmed FIXED with red-on-injection
proof; round 2 found the BLOCKER-2 seeding fix had introduced 3 new
MAJORs (silently ADDING ids, stranding seeded chips above the 2-chip cap,
and relocating BLOCKER-1's truncation one screen downstream), the
BLOCKER-1 truncation site itself was still unexecuted by any test, and the
parity doc cited 3 tests that did not exist. Every finding's fix and
current status is tracked in the "Gate review round 1" and "Gate review
round 2" sections near the bottom of this document. All rows in the tables
below reflect the POST-round-2-fix state and have been corrected in place
rather than left standing next to a rebuttal — the reviewer explicitly
re-audits every row in each round's own list.

## Gate anatomy (R6GateBlessed.dc.html)

| # | Board element | Implementation locus | Verification | Status |
|---|---|---|---|---|
| 1 | White card, navy `#0C1B33` header band, shadow | `components/report/ReportEmailGate.tsx` `<dialog>` + `<header>` | `report-email-gate.test.tsx` "renders every board element with literal, hardcoded copy" | PASS |
| 2 | "Chicago Incentive Explorer" eyebrow | same header | same test — `screen.getByText("Chicago Incentive Explorer")` (a real DOM assertion, not merely present in a larger `toContain` string) | PASS |
| 3 | "Your report is ready" (Playfair-style editorial heading) | same header, `font-editorial` | same test — `screen.getByText("Your report is ready")` | PASS |
| 4 | Address subline | same header, conditional on `report.metadata.address` | same test — `screen.getByText("4200 S California Ave, Chicago, IL")` against the test fixture's real address | PASS |
| 5 | "Which best describes you?" label | persona row | same test | PASS |
| 6 | Persona chip: "Just looking" | `lib/gate-persona-groups.ts` `GATE_PERSONA_CHIPS[0]` | same hardcoded-literal-copy test, PLUS `report-email-gate.test.tsx`'s "persona pre-selection" describe block's "renders 'Just looking' as a real, enabled, tappable chip — not merely inferable" (gate review round 2, NEW-4 fix: this test name was cited in round 1 but did not actually exist in the file — it is now written, asserting `disabled === false` and a real `aria-pressed` flip on click) | PASS |
| 7 | Persona chip: "Business owner" (merges starting+growing, never re-keyed) | `GATE_PERSONA_CHIPS[1]` | same hardcoded-literal test + "pre-selects Business owner via aria-pressed when no strong signal is present" (gate review round 2, NEW-4 fix — genuinely asserts `aria-pressed="true"` on this chip and `"false"` on the other three, not just clicked-and-moved-on) | PASS |
| 8 | Persona chip: "Supporting businesses" | `GATE_PERSONA_CHIPS[2]` | same hardcoded-literal test | PASS |
| 9 | Persona chip: "Developer" | `GATE_PERSONA_CHIPS[3]` | same hardcoded-literal test + "pre-selects the inferred lens from industry/goal (developer signal) via aria-pressed" (gate review round 2, NEW-4 fix — same real `aria-pressed` assertion) | PASS |
| 10 | "What brings you here? (Pick up to 2 — or just looking)" label | goal row | same test | PASS |
| 11 | Goal chip: "Renovate or build out" → rehab | `lib/gate-goal-groups.ts` `GATE_GOAL_CHIPS[0]` | HARDCODED literal (`BOARD_GOAL_LABELS`, F6 fix) + "goal chips render in exact board order" (real DOM-position assertion, not a source-order assumption) + `goal-coverage.test.ts` (a) | PASS |
| 12 | Goal chip: "Expand or buy equipment" → expansion, equipment | `GATE_GOAL_CHIPS[1]` | same, plus `gate-goal-groups.test.ts` "flattens a two-id grouped chip" and the BLOCKER 1 end-to-end test below | PASS |
| 13 | Goal chip: "Open or relocate" → relocation | `GATE_GOAL_CHIPS[2]` | same hardcoded-literal + DOM-order tests | PASS |
| 14 | Goal chip: "Hire or train staff" → hiring | `GATE_GOAL_CHIPS[3]` | same | PASS |
| 15 | Goal chip: "Energy & building upgrades" → energy | `GATE_GOAL_CHIPS[4]` | same | PASS |
| 16 | Goal chip: "Build new" → new-construction | `GATE_GOAL_CHIPS[5]` | same | PASS |
| 17 | Goal chip: "Develop housing or mixed-use" → mixed-use, affordable-housing | `GATE_GOAL_CHIPS[6]` | same, plus the BLOCKER 1 end-to-end test (this chip is one half of the reviewer's 4-id reproduction) | PASS |
| 18 | Goal chip: "Just looking around" — dashed border, distinct, exclusive of the other 7 | `GATE_GOAL_CHIPS[7]` / `GATE_LOOKING_CHIP_ID`, `toggleGateGoalChip` | `lib/__tests__/gate-goal-groups.test.ts` (exclusivity + cap, pure-function, both reviewer mutants confirmed killed) + `report-email-gate.test.tsx`'s DOM-level exclusivity describe block (gate review round 1, MAJOR finding 4/F9 fix — the old test only checked labels/order/`border-dashed`, never exclusivity itself) | PASS |
| 19 | Primary button "View my report" | `report-email-gate-view` button | "View and Save start disabled…" / "picking a goal chip enables both…" (real click-then-assert, not a single static snapshot — gate review round 1, MAJOR finding 5/F5 fix) | PASS |
| 20 | Disabled state: grey `#C6CCD8`-equivalent, `cursor-not-allowed`, until persona AND ≥1 goal | `disabled:bg-[#C6CCD8]`, `canProceed = Boolean(persona) && selectionComplete && !isBusy` | Same enable-transition tests. **Rewritten honestly per gate review round 1, MAJOR finding 11**: persona genuinely is IN the predicate now (`Boolean(persona)`), but this never blocks in practice — `persona` is seeded by inference the instant the component mounts and is never empty (owner ruling A1). The goal chip is the only condition a visitor's own inaction can leave unmet, matching the board's own disabled-state screenshot (helper line names only the goal requirement). `personaTouched` now separately tracks whether the visitor actually tapped a chip, so analytics (row "Persona analytics honesty" below) can tell an untouched pre-selection apart from a real confirmation — the previous version silently reported every gate completion as "confirmed," including ones where the visitor never touched the row. | PASS |
| 21 | Helper line "Pick what brings you here to continue" (shown only while disabled) | `report-email-gate-helper` | "View and Save start disabled, with the exact helper copy" — exact-string `.textContent` match, not `toContain` | PASS |
| 22 | "Want a hand? (Optional)" eyebrow | support box | same anatomy test | PASS |
| 23 | Name input | support box | same test — `screen.getByPlaceholderText("Name")` (gate review round 1, finding 10 — the old test asserted nothing about this input at all) | PASS |
| 24 | Email input, `you@business.com` placeholder | support box | same test — `screen.getByPlaceholderText("you@business.com")` (finding 10 — previously unasserted) | PASS |
| 25 | Checkbox "I'd like 1-on-1 support working through this report" | support box | same test (exact copy asserted against real DOM text, decoded apostrophe) | PASS |
| 26 | Promise line, **exact copy**: "A real person from the Southeast Chicago Chamber of Commerce will follow up within 48 hours." | support box | same test (exact string match) — reviewer confirmed this row was already genuinely pinned pre-fix (F8, 48→72 hours, correctly failed) | PASS |
| 27 | "Come back anytime" title | save row | same test | PASS |
| 28 | "Save this report and pick up right where you left off." subline | save row | same test — `screen.getByText(...)` full-string match (finding 10 — previously unasserted) | PASS |
| 29 | "Save my report" button, disabled under the same mandatory rule | `report-email-gate-save` | enable-transition tests | PASS |
| 30 | Footer copy | footer `<p>` | **Changed** — see BLOCKER 4 below. New exact text: "PDF & email tools live inside the report — where you can see what they're about", asserted in full (finding 10 — the old test only asserted the prefix, never the tail) plus a dedicated negative assertion that "window reminders" and "PDF, email &" never appear | PASS |
| — | Email-delivery-of-report **removed** from the gate (old "Email and View Report" submit) | deleted from `ReportEmailGate.tsx` | "removes email-delivery-of-report, PDF download, and 'Continue Without Email' from the gate" | PASS |
| — | PDF download button **removed** from the gate (old `report-pdf-download`) | deleted from `ReportEmailGate.tsx` | same test | PASS |
| — | "Continue Without Email" **removed** (superseded by unconditional "View my report") | deleted from `ReportEmailGate.tsx` | same test | PASS |
| — | No newsletter language anywhere on the gate | reviewed copy throughout | same test (`toLowerCase()` scan for "newsletter") | PASS |
| — | Loading states ("Preparing...", "Saving...") on the two primary buttons | `viewStatus`/`saveStatus` | exercised by the enable-transition and support-failure tests (button text changes across the awaited submission) | INTENTIONAL-DIFF — implementation-only affordance with no board equivalent (the board is one static frame; a busy-state label cannot appear on it). Gate review round 1, MINOR finding 13: this is the INVERSE of closed-list reason (b) ("mock-named item absent") — the item is absent from the mock, not from the implementation — so it is written out honestly here rather than mis-citing (b). |
| — | Inline error alert (red) on prepare/save failure | `error` state block | **Now genuinely tested** — "shows the alert box when onPrepareReport rejects" / "shows a fallback message when onPrepareReport resolves null" (gate review round 1, finding 10/row 51 — previously claimed "manual/E2E smoke," which the parity contract does not permit as verification; now a real forced-failure DOM test) | PASS |
| — | Hidden honeypot "Website" field on the support box | carried over from the pre-redesign gate's anti-abuse pattern | present in rendered markup, off-screen; exercised functionally by `app/api/support-request/route.ts`'s own honeypot branch | INTENTIONAL-DIFF — implementation-only, invisible-by-design anti-abuse element with no board equivalent (same finding-13 correction as above: not closed-list (b), written out honestly). |

## §A — Goal grouping

| Item | Locus | Verification | Status |
|---|---|---|---|
| 8 UI chips map to existing goal ids, ids never re-keyed | `lib/gate-goal-groups.ts` | `goal-coverage.test.ts` (a); `project-fit.test.ts` unaffected (goal ids unchanged) | PASS |
| Grouped chip feeds its FULL goal-id set into the existing multi-goal path — no truncation, no invention | `ReportEmailGate.tsx`'s `projectGoalIds()`: pre-toggle emits `originalGoalIds` verbatim; post-toggle emits `gateGoalChipsToGoalIds(selectedGoalChips)` + `passthroughGoalIds`, via `dedupeGoalIds` (uncapped) → `onPrepareReport(goalIds, customGoal)` → `resolveGatePrepareGoals` (`lib/gate-goal-groups.ts`) → `projectGoalsFit` (no inherent limit) | **Corrected per gate review round 2, NEW-1/ruling #2 — this row was FALSE as originally written.** Round 1's claim that the reviewer's 4-id test was "end-to-end on the args `handlePrepareGatedReport` receives" was untrue: `onPrepareReport` is a `vi.fn()` in every `ReportEmailGate` test, so the real handler never executed (round 2 finding "R1-BLOCKER-1 carryover"). Now genuinely end-to-end via `resolveGatePrepareGoals` — the exact, extracted function `handlePrepareGatedReport` calls — unit-tested directly in `lib/__tests__/gate-goal-groups.test.ts`'s "resolveGatePrepareGoals — the R1-BLOCKER-1 pin" describe block, including a 5-id probe (an existing pass-through goal plus a fresh 2-chip pick) that a reversion to the wizard's capped `selectedProjectGoals()` would truncate to 4 — confirmed by re-injecting that exact reversion and reverting. Separately, `report-email-gate.test.tsx`'s "2 grouped chips (4 ids) all reach onPrepareReport" pins the chip-toggle path at the component boundary, and the NEW-1 describe block pins that an UNTOUCHED seed never adds an id the visitor didn't choose. | PASS |
| "Just looking around" carries zero goal ids (no filter, pairs with `looking` persona lens) | `GATE_LOOKING_CHIP_ID` → `goalIds: []` | `goal-coverage.test.ts`; existing `report-personas` "looking" lens tests (untouched) | PASS |

**Root cause of BLOCKER 1 (fixed):** `lib/report-wizard-config.ts`'s
`selectedProjectGoals()` slices to `MAX_PROJECT_GOALS = 3` — correct for the
OLD 11-option "pick up to 3" wizard selector, wrong for the gate, whose 2
grouped chips can carry 4 real ids. `app/report/page.tsx`'s
`handlePrepareGatedReport` now calls `resolveGatePrepareGoals`
(`lib/gate-goal-groups.ts`), which dedupes via `dedupeGoalIds` (no cap) for
both the incoming selection AND the existing-report comparison read,
instead of routing either through `selectedProjectGoals()`.
`MAX_PROJECT_GOALS`/`selectedProjectGoals()` themselves were left completely
untouched for the WIZARD's own UI — they still govern the OLD "pick up to
3" selector correctly; only the gate's own prepare path stopped using them.

**Gate review round 2, NEW-1/NEW-5/ruling #2 — seeding is display + pass-
through, not re-derivation:** the round-1 fix above solved dropping ids but
introduced a NEW bug — pre-pressing a grouped chip for display (e.g.
`["expansion"]` pre-presses "Expand or buy equipment") and then RE-DERIVING
emission from that chip on submit silently added `equipment`, an id the
visitor never chose, and forced a needless regeneration (the stored/emitted
arrays no longer matched). `ReportEmailGate.tsx` now keeps the visitor's
ORIGINAL goal-id array as separate frozen state (`originalGoalIds`) and
emits it VERBATIM — same ids, same order — until an actual chip toggle
happens (`hasToggledGoals`); only then does emission switch to the
chip-derived mapping. This also kills NEW-5 (an untouched report's stored
order flipping to chip-definition order, which both regenerated the report
unnecessarily AND changed `metadata.projectType` to a different goal's
label) — the exact stored array, in the exact stored order, is what goes
back out when nothing changed.

**Gate review round 2, NEW-2/ruling #3 — seeded state above the 2-chip cap
stays recoverable:** a legacy 3-goal wizard run pre-presses 3 chips even
though the board says "Pick up to 2." `toggleGateGoalChip` now takes an
explicit `cap` parameter; `ReportEmailGate.tsx` computes
`goalChipCap = Math.max(MAX_GATE_GOAL_CHIPS, <seeded chip count>)` once at
mount, so a visitor with 3 seeded chips can freely deselect/reselect any of
them for the rest of the session, while a fresh visitor (0-2 seeded) keeps
the normal 2-chip cap. Documented tradeoff: this also lets a legacy
3-seed session pick one genuinely NEW 3rd chip (not just re-add a seeded
one), since the cap has no per-chip identity memory — the simplest fix
that guarantees no seeded chip is ever strandable.

**Gate review round 2, NEW-3/ruling #4 — the downstream truncation is
killed, not relocated:** `ProjectGoalSelector.tsx`'s own display read
(`.slice(0, MAX_PROJECT_GOALS)`) and `lib/report-wizard-config.ts`'s
`selectedProjectGoals()` both silently truncated a gate-produced 4-goal
report back to 3 the instant either was opened (the wizard's own
project-intake screen, reachable via "Refine your report," reads
`selectedProjectGoals(wizardState)` directly). A new named constant,
`MAX_ENGINE_GOALS = 4` (`lib/report-wizard-config.ts`), replaces
`MAX_PROJECT_GOALS` in both of those READ paths — `MAX_PROJECT_GOALS`
itself, and `ProjectGoalSelector`'s `atLimit` (the wizard's own "pick up to
3" fresh-selection growth limit), are UNTOUCHED, per the ruling's explicit
instruction not to change the wizard's own selection UI limit.

## §B — GOAL_RULES completion + orphan pass

**Gate review round 1, MINOR finding 15 correction:** the previous version
of this section cited a `diff` against `/tmp/project-fit.ts` as
verification — `/tmp` is gone and nothing in the repo records that diff, so
the claim was unfalsifiable as written. What's actually verifiable in this
repo: `lib/project-fit.ts`'s `GOAL_RULES` carries `new-construction`,
`mixed-use`, `affordable-housing`, and `vacant-acquisition` entries, each
with a non-empty `strongProgramIds` set, and all 71 registry ids resolve —
proven by `lib/__tests__/goal-coverage.test.ts`, not by a historical diff
claim.

This branch closed the remaining **11 orphans** — computed by diffing the
full 71-id program registry (`data/programs-internal.json`) against every id
reachable through `GOAL_RULES` strong/relatedProgramIds or
`SPECIALIZED_INDUSTRY_PROGRAM_IDS`:

| Program id | Disposition | Rationale |
|---|---|---|
| `nrhpDistricts` | Mapped → `rehab.strongProgramIds` | Its entire benefit IS the 20% federal rehab tax credit — direct, not incidental. |
| `landmarkDistricts` | Mapped → `rehab.relatedProgramIds` | "Rehabilitating historically significant buildings" per program copy; the concrete tax benefit routes through the separate Class L entry, hence *related* not *strong*. |
| `cdfiBond` | Mapped → `rehab.relatedProgramIds`, `expansion.relatedProgramIds` | Program copy: funds deploy to "commercial real estate … in SECCC-area neighborhoods" — a financing mechanism, same family as `sba7a504`/`hudSection108` already in those sets. |
| `industrialCorridors` | Mapped → `expansion.relatedProgramIds`, `relocation.relatedProgramIds` | Program copy explicitly: "benefit existing and prospective industrial users" — existing = expansion-adjacent, prospective = relocation-adjacent. |
| `class6bSer` | Mapped → `expansion.relatedProgramIds` | Hardship variant of `class6b` (already strong in `expansion`) for long-tenured industrial operations continuing at the same site. |
| `federalOZ` | Exempt → `PLACE_BASED_EXEMPT_PROGRAM_IDS` | Investor capital-gains deferral tied to Qualified Opportunity Fund investment in a *zone*, not to a renovate/expand/hire project type. |
| `illinoisOZ` | Exempt → `PLACE_BASED_EXEMPT_PROGRAM_IDS` | Same — Illinois-designated OZ tranche of the same mechanism. |
| `hubzone` | Exempt → `PLACE_BASED_EXEMPT_PROGRAM_IDS` | Federal contracting set-aside eligibility keyed to principal-office zone + workforce residence — a location/workforce-composition test, not a project-goal fit. |
| `sbaDisasterEidl` | Exempt → `GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS` | Eligibility turns on the declared July 2025 Cook County storm/flood event — a time-boxed disaster declaration, not a project type. |
| `edaBuildToScale` | Exempt → `GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS` | Prime applicants are nonprofits/EDOs/universities/governments (SECCC could only be a sub-awardee) — not an individual business selecting a project goal. |
| `investInCook` | Exempt → `GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS` | Funds local governments/transit/public-land agencies; private orgs may only partner with an eligible public sponsor — not directly actionable via a project goal. |

All three exemption sets (`SPECIALIZED_INDUSTRY_PROGRAM_IDS`,
`PLACE_BASED_EXEMPT_PROGRAM_IDS`, `GOAL_INDEPENDENT_EXEMPT_PROGRAM_IDS`) are
exported, committed constants in `lib/project-fit.ts` — not comments — each
with an inline reason on every entry.

**Coverage test** (`lib/__tests__/goal-coverage.test.ts`, 4 assertions —
reviewer confirmed F2/F3 injections correctly fail, i.e. the test is real):

| Assertion | Status |
|---|---|
| (a) every gate chip's goal id(s) resolve to a GOAL_RULES entry with non-empty `strongProgramIds` | PASS |
| (b) every one of the 71 real program ids is goal-reachable or in a documented exemption set | PASS |
| (c) every id referenced inside GOAL_RULES exists in the program registry | PASS |
| (bonus) the three exemption sets never overlap each other | PASS |

## §C — Inline offers inside the report

| Item | Locus | Verification | Status |
|---|---|---|---|
| Inline offer beside the SBIF/funding-window region | `components/report/FundingWindowChart.tsx` → `FundingWindowEmailOffer` | `components/report/__tests__/funding-window-email-offer.test.tsx` (6 tests, rewritten to `@testing-library/react` per gate review round 1, MAJOR finding 9 — see below) | **PARTIAL** |

Not on `R6GateBlessed.dc.html` — the board is the *gate* only; §C lives
inside the report itself. Repo-wide `grep` for "reminder" across
`scripts/`, `lib/`, `app/api/` returned zero matches: there is no scheduled
job, cron, or any future-triggered send mechanism anywhere in this repo.
Per spec §C's own instruction, a "notify me when this window opens"
promise was **not built** — that would be a fabricated promise the system
cannot keep. What ships instead: a real, honest, non-modal, dismissible
inline offer that sends the report **immediately**, via the exact same
verified mechanism the report's own "Email Report" action already uses
(`POST /api/email-report`, now also exercised end-to-end by a real
mocked-fetch interaction test asserting the actual POST body).

**Gate review round 1, MAJOR finding 9/F10 fix:** the banned-phrase test
previously checked `we'll remind you` against `renderToStaticMarkup`
output, where React had already escaped the apostrophe to `&#x27;`/`&rsquo;`
— so the check could never fire against the most likely real phrasing. The
test file now uses `@testing-library/react` + real DOM `.textContent`
(always decoded) instead of raw-HTML string matching, and was confirmed by
re-injecting the reviewer's exact mutant (`We'll remind you before this
window closes.`) — the rewritten test fails against it, then passes again
once reverted.

**Named follow-up:** a true future-triggered reminder needs a scheduled
sender (e.g., a cron hitting a new `/api/window-reminders` job) that does
not exist in this repo today — tracked as separate follow-up work, not
silently deferred.

## §D — Support-lead routing

| Item | Locus | Verification | Status |
|---|---|---|---|
| Optional support opt-in produces a real signal | `app/api/support-request/route.ts`, `lib/support-lead.ts` | **Now genuinely exercised at BOTH boundaries.** Client boundary: `report-email-gate.test.tsx`'s "the support path is genuinely exercised end to end" describe block asserts the real payload `submitSupportRequest` is called with (gate review round 1, MAJOR finding 7/F7). Route boundary (gate review round 2, NEW-9/row 167 fix — the reviewer's exact point was that only the mocked `submitSupportRequest` client function was ever exercised, never the route itself): new `app/api/support-request/route.test.ts` (8 tests) calls the route's real `POST` handler directly — validation (400 on an invalid email), the honeypot branch (neutral success, no lead write), a real `createReportLead` call with `wantsHelp: true` and the right fields, the 503/502 error paths, and the env-conditional Resend branch both with and without `RESEND_API_KEY`/`INCENTIVE_HELP_INBOX` set | PASS |
| Chamber-inbox notification | Same route, `Resend` + `process.env.INCENTIVE_HELP_INBOX` | Same conditional pattern already live in `/api/email-report`'s `wantsHelp` branch — not a new mechanism, but genuinely env-conditional and silent when unset. `route.test.ts`'s env-conditional tests now prove BOTH branches behave as documented (no key → `notified: false`, Resend never constructed; both keys → a real `Resend.emails.send` call to the configured inbox) | **PARTIAL** — per gate review round 1's binding ruling on finding 12, unchanged by round 2. Named follow-up: **verify `RESEND_API_KEY` + `INCENTIVE_HELP_INBOX` are configured on the Vercel production project** — a ship-ritual checklist item, not a code change (this is what remains unverifiable from inside the repo — the CODE'S behavior in both configurations is now fully tested). The lead is captured (and surfaced in the admin queue below) regardless of whether these are set; only the live email notification depends on them. |
| Admin/export surface | `lib/analytics-dashboard.ts`'s existing `report_leads` follow-up queue (`wants_incentive_help` ordering) — untouched, already reads this table | pre-existing, unmodified; `route.test.ts`'s "writes a real lead with wantsHelp: true" test now directly proves `createReportLead` is called with that flag (gate review round 2, NEW-9 fix — previously only reviewer-confirmed by inspection, not by a test in this repo) | PASS |

Investigated before building (per spec instruction): `/api/email-report`
already has a `wantsHelp` branch that writes to `report_leads` and
conditionally emails `INCENTIVE_HELP_INBOX` via Resend — but it *requires*
a `pdfBase64` and always emails the visitor their report as a side effect,
which would silently reintroduce the "email-delivery-of-report" the gate
was redesigned to remove. `/api/support-request` reuses the identical
`createReportLead` + Resend-notification pieces **without** the PDF/visitor-
email side effect, so the support box's on-screen promise (48-hour
follow-up) is the only thing it actually does. No new outbound mechanism
was invented — same DB table, same Resend client, same inbox env var as
the pre-existing path.

Also fixed here per BLOCKER 3 (see below): the submission is now AWAITED
and its failure surfaced (visible `role="alert"`, dialog stays mounted)
before either `onReportReady` or the unauthenticated Save redirect fires —
previously both silently killed an in-flight request.

## §E — Save my report

| Item | Locus | Verification | Status |
|---|---|---|---|
| "Save my report" wired to the existing save mechanism | `ReportEmailGate.tsx` `handleSaveReport`, mirroring the identical authenticated/unauthenticated fork both `ReportDisplay` copies already implement (`useSession` → `SaveReportModal` in place, or `storePendingReport` + redirect to `/login?callbackUrl=/workspace?savePending=1`) | `report-email-gate.test.tsx`'s BLOCKER 3(b)/(c) describe block — real interaction tests asserting navigation timing (`window.location.assign` mocked and asserted NOT called until a pending submission resolves) | PASS |
| Disabled under the same mandatory-selection rule as View | `!canProceed` on both buttons | enable-transition tests | PASS |

## Gate review round 1 — finding-by-finding status

| # | Finding | Fix | Test(s) that now pin it |
|---|---|---|---|
| BLOCKER 1 | Two-chip selection silently drops a goal id (`selectedProjectGoals()`'s 3-cap) | `app/report/page.tsx`'s `handlePrepareGatedReport` now uses `dedupeGoalIds` (uncapped) for both the incoming selection and the existing-report comparison read | `gate-goal-groups.test.ts` "two 2-id chips together carry ALL 4 ids"; `report-email-gate.test.tsx` "2 grouped chips (4 ids) all reach onPrepareReport" |
| BLOCKER 2 | Gate destroyed pre-existing `projectGoals`/`customGoal` on every mount | `ReportEmailGate.tsx` seeds `selectedGoalChips` (via `goalIdsToGateChipIds`), `passthroughGoalIds` (via `unmatchedGoalIds`, for ids with no chip), and `customGoal` from `report.metadata` at mount; all resent verbatim on every prepare call | `report-email-gate.test.tsx`'s "BLOCKER 2" describe block (4 tests: single-id seeding, unmatched-id + customGoal survival, unmatched-id alongside a new pick, explicit "Just looking around" override) |
| BLOCKER 3 | Support opt-in failed silently in 3 paths | (a) invalid/blank email while checked now blocks with a visible inline error, validated before any prepare call; (b)/(c) the submission is AWAITED before `onReportReady`/the unauthenticated redirect, with `keepalive: true` on the fetch as defense-in-depth; a first failure is surfaced (dialog stays mounted) and a second click proceeds without re-blocking forever | `report-email-gate.test.tsx`'s BLOCKER 3(a) and 3(b)/(c) describe blocks (6 tests total) |
| BLOCKER 4 | Footer promised "window reminders" — no such mechanism exists | Footer copy changed to "PDF & email tools live inside the report — where you can see what they're about". The board file (`R6GateBlessed.dc.html`) has since been updated to this exact copy, so this is no longer even an INTENTIONAL-DIFF from the current board — it is a literal match, verified by the same hardcoded-copy test as every other row | `report-email-gate.test.tsx` "renders every board element with literal, hardcoded copy"; "BLOCKER 4: footer claims only PDF & email…" (negative assertion) |
| MAJOR 5 (F5) | Nothing tested the enable transition | New `describe("… enable transition (falsification F5)")` block: disabled-at-mount, enabled-after-a-click, "Just looking around" alone also enables | Confirmed by re-injecting the reviewer's `canProceed = false` mutant: 19/28 tests in the file fail; reverted, 28/28 pass |
| MAJOR 6 (F7) | Support-lead path untested | `submitSupportRequest` is now mocked and asserted on directly across 6+ tests (payload shape, awaited timing, failure surfacing) | Confirmed by re-injecting `if (true) return true;` at the top of `submitSupportBoxIfNeeded`: 4/28 tests fail; reverted, 28/28 pass |
| MAJOR 7 (F6) | Board copy parity was self-referential | `BOARD_PERSONA_LABELS`/`BOARD_GOAL_LABELS` are literal string arrays independent of `GATE_GOAL_CHIPS`/`GATE_PERSONA_CHIPS` | Confirmed by re-injecting a relabel (`"Renovate or build out"` → `"Fix up your place"` in the source): 6/28 tests fail; reverted, 28/28 pass |
| MAJOR 8 (F4/F9) | Exclusivity + 2-chip cap untested | `lib/__tests__/gate-goal-groups.test.ts` tests `toggleGateGoalChip` directly (pure function, no render); `report-email-gate.test.tsx` adds a DOM-level exclusivity describe block | Confirmed by re-injecting both reviewer mutants (`[...selected, GATE_LOOKING_CHIP_ID]`, `if (false)` cap guard) into `lib/gate-goal-groups.ts`: each fails exactly the test(s) written for it; reverted, all pass |
| MAJOR 9 (F10/F11) | Banned-phrase guard vacuous against the apostrophe-escaped phrasing | `funding-window-email-offer.test.tsx` rewritten to `@testing-library/react`, asserts against real DOM `.textContent` (always decoded) instead of raw HTML | Confirmed by re-injecting the reviewer's exact mutant string: the rewritten test fails against it; reverted, passes |
| MAJOR 10 | Parity rows cited tests with no matching assertion (rows 2, 4, 23, 24, 28, 30) | Real `screen.getByText`/`getByPlaceholderText` assertions added for every one | See the anatomy table above — every row now names the specific assertion |
| MAJOR 11 | Persona not actually mandatory; analytics always reported "confirmed" | `canProceed` includes `Boolean(persona)`; `personaTouched` state distinguishes an untouched pre-selection from a real tap; `commitPersonaSelection` reports `"inferred"` / `"confirmed"` / `"corrected"` honestly | `report-email-gate.test.tsx`'s "persona analytics honesty" describe block (3 tests: inferred/untouched, confirmed/same-chip-tapped, corrected/different-chip-tapped) |
| MAJOR 12 | §D notification row marked PASS while env-conditional and silent | Row reclassified PARTIAL with a named, non-code follow-up | See §D table above |
| MINOR 13 | INTENTIONAL-DIFF reason (b) misused for impl-only elements | Rows rewritten with an honest, written-out reason instead of mis-citing (b); row 51 (error alert) is now genuinely PASS via a real forced-failure test rather than a diff-reason at all | See anatomy table rows for loading states / error alert / honeypot |
| MINOR 14 | Claim-surface comment pointed at a nonexistent test path | `lib/public-claim-surfaces.ts` corrected to `components/report/__tests__/report-email-gate.test.tsx` | — |
| MINOR 15 | §B provenance claim unfalsifiable (`/tmp` diff) | Rewritten to cite only in-repo, re-verifiable facts (GOAL_RULES entries + the coverage test) | `goal-coverage.test.ts` |

## Gate review round 2 — finding-by-finding status

Round 1 findings 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15 were reviewer-
confirmed FIXED with red-on-injection proof and are NOT reworked here.

| # | Finding | Fix | Test(s) that now pin it |
|---|---|---|---|
| R1-BLOCKER-1 carryover | The truncation site itself was unpinned — `onPrepareReport` is a `vi.fn()` in every test, so the real `handlePrepareGatedReport` never executed | Extracted the exact dedupe-and-noop-detect logic into `resolveGatePrepareGoals` (`lib/gate-goal-groups.ts`); `handlePrepareGatedReport` is now a thin wrapper around it | `lib/__tests__/gate-goal-groups.test.ts`'s "resolveGatePrepareGoals — the R1-BLOCKER-1 pin" describe block, including a 5-id divergence probe against `selectedProjectGoals()`'s cap; confirmed by re-injecting a `.slice(0, 4)`-style reversion — 1 test fails; reverted, all pass |
| NEW-1 | Seeding silently ADDS goal ids the visitor never picked (`["expansion"]` → chip pre-press → emits `["expansion","equipment"]`), forcing a needless regeneration | `ReportEmailGate.tsx` keeps `originalGoalIds` as separate frozen state, emitted verbatim pre-toggle; chip seeding (`goalIdsToGateChipIds`) is DISPLAY-only now, never emission | `report-email-gate.test.tsx`'s "gate review round 2, NEW-1" describe block (3 tests: single-id no-add, `mixed-use` no-add, a real toggle legitimately switching to the full chip mapping); confirmed by re-injecting always-chip-derived emission — 3 tests fail; reverted, all pass |
| NEW-2 | Seeding bypasses `MAX_GATE_GOAL_CHIPS`; a seeded chip above the cap, once deselected, could never be re-added (stranded) | `toggleGateGoalChip` takes an explicit `cap` parameter; `ReportEmailGate.tsx` computes `goalChipCap = Math.max(MAX_GATE_GOAL_CHIPS, <seeded count>)` once at mount | `lib/__tests__/gate-goal-groups.test.ts`'s "explicit cap parameter" describe block + `report-email-gate.test.tsx`'s "gate review round 2, NEW-2" describe block (the reviewer's exact reproduction: seed 3, deselect "Energy & building upgrades," reselect it); confirmed by re-injecting a fixed `goalChipCap = MAX_GATE_GOAL_CHIPS` — 1 test fails; reverted, all pass |
| NEW-3 | The 4th goal died one screen later — `ProjectGoalSelector`'s display slice and `selectedProjectGoals()` both truncated a gate-produced 4-goal report to 3 the instant either rendered | New named constant `MAX_ENGINE_GOALS = 4` (`lib/report-wizard-config.ts`) replaces `MAX_PROJECT_GOALS` in `selectedProjectGoals()`'s slice and `ProjectGoalSelector`'s display-read slice; `MAX_PROJECT_GOALS`/`atLimit` (the wizard's own "pick up to 3" fresh-growth limit) are untouched | Covered indirectly by `resolveGatePrepareGoals`'s 5-id test (proves the gate's own path never routes through the capped function); no dedicated `ProjectGoalSelector` render test was added — the fix is a 2-line constant swap in an already-simple read, and the invariant that matters (the gate's own emission) is pinned at the source |
| NEW-5 | Order-sensitive `JSON.stringify` equality + chip-definition-order re-derivation flipped a stored `["hiring","rehab"]` to `["rehab","hiring"]` on an untouched gate, regenerating the report and changing `metadata.projectType` | Fixed by the SAME mechanism as NEW-1 — verbatim pre-toggle emission preserves both ids AND order, so the comparison in `resolveGatePrepareGoals` matches and short-circuits to a no-op | `report-email-gate.test.tsx`'s "gate review round 2, NEW-5" describe block: `["hiring","rehab"]` in, `["hiring","rehab"]` out (order asserted, not just set-equality); confirmed by re-injecting always-chip-derived emission (same mutant as NEW-1) — fails; reverted, passes |
| NEW-4 | Parity doc rows 6/7/9 cited test names that did not exist anywhere in the repo | Wrote the real tests rather than rewriting the rows down, per the ruling's explicit preference | `report-email-gate.test.tsx`'s new "persona pre-selection" describe block (3 tests, real `aria-pressed` assertions) |
| NEW-6 | `dedupeGoalIds` dropped the `.filter(Boolean)` `selectedProjectGoals()` has always had — an empty-string goal id could reach the engine unfiltered | Restored the filter | `lib/__tests__/gate-goal-groups.test.ts` "filters falsy entries" |
| NEW-7 | The `showModal()` jsdom fallback (plain `open` attribute, no backdrop/focus trap) would be a bypassable, non-modal gate if it ever ran in production | Guarded to `process.env.NODE_ENV !== "production"`; a real production browser missing `showModal()` gets a closed, non-interactive dialog + a logged error instead of a silently-downgraded one | Environment-guarded by construction; existing 38 `report-email-gate.test.tsx` tests continue to pass under the test-env branch (vitest sets `NODE_ENV=test`) |
| NEW-8 | `report-email-gate.test.tsx` redefined `window.location` via `Object.defineProperty` twice with no restore, leaking the mock into later tests in the file | Original `window.location` descriptor captured once at module load, restored in a shared `afterEach` regardless of whether a given test touched it | Structural fix — all 38 tests in the file continue to pass in file order |
| NEW-9 | §D row 167 verification was "pre-existing, unmodified" — not a test; nothing exercised `app/api/support-request/route.ts` itself, only the mocked client boundary | New `app/api/support-request/route.test.ts` (8 tests) calls the route's real `POST` handler | See §D table above |

## Judgment calls

1. **Persona "mandatory" rule** is satisfied by the existing pre-selection
   inference (owner ruling A1) AND is now literally part of `canProceed`
   (finding 11) — it just never blocks in practice, because inference
   never returns an empty value. This matches the board's own
   disabled-state screenshot, whose helper line names only the goal
   requirement.
2. **"Business owner" merged chip** defaults to `starting` when clicked and
   neither `starting` nor `growing` is already active (first in the
   existing vocabulary order, and the inference module's own generic
   fallback). No id was re-keyed; `lib/personas.ts` was not touched.
3. **Support opt-in has no submit button of its own** on the board — it
   rides alongside whichever primary action (View or Save) the visitor
   takes. Per the round 1 fix, a checked box with a blank/invalid email now
   BLOCKS with a visible error instead of silently skipping; a real
   submission failure is surfaced once and does not block a second click
   forever ("never blocks the report" has to mean something once the
   visitor has actually seen the failure).
4. **Inline funding-window offer sends immediately** rather than promising
   a future-triggered reminder, since no scheduled-send infrastructure
   exists in this repo — see §C above.
5. **`supportGaveUp` bypass (new, round 1):** after a support-submission
   failure has been shown once, a second click of View/Save proceeds
   without retrying the failed request. This is a deliberate choice to
   keep "never blocks the report" true even when the chamber-notification
   path is genuinely down, while still surfacing the failure at least once
   rather than swallowing it (the original bug this whole finding was
   about).
6. **`goalChipCap` generosity (new, round 2):** a legacy 3-seeded session's
   cap is raised to 3 for its ENTIRE lifetime, not just for re-adding the
   specific chips that were originally seeded — the toggle function has no
   per-chip "was this one seeded" memory, so it cannot distinguish "the
   visitor recovered a stranded seeded chip" from "the visitor picked one
   genuinely new 3rd chip." Accepted as the smallest change that
   guarantees NEW-2's actual requirement (no seeded chip is ever
   strandable) without adding chip-identity tracking the ruling didn't ask
   for.
7. **`MAX_ENGINE_GOALS` left `ProjectGoalSelector`'s `atLimit` untouched
   (new, round 2):** a gate-produced 4-goal report now displays all 4
   goals as checked in the wizard's project-intake screen, but `atLimit`
   still computes against `MAX_PROJECT_GOALS = 3` — so with all 4 shown,
   the wizard's own UI immediately reads as "at limit" and blocks adding a
   5th, but does NOT block deselecting any of the 4. Re-adding a
   deselected one is blocked once 3 remain selected (the wizard's normal,
   pre-existing behavior) — this asymmetry was not called out by the
   ruling and was left as-is rather than importing the gate's own
   `cap`-parameter pattern into a component the ruling said not to change
   the selection limit of.

## Deviations from a literal reading of the spec

- The §C inline offer remains PARTIAL (spec explicitly allows this: "PARTIAL
  allowed only for C/D backend sends per above").
- The §D chamber-inbox notification row is now ALSO PARTIAL, per gate
  review round 1's binding ruling on finding 12 — env-var configuration
  verification is a ship-ritual checklist item, not something this branch's
  code can prove from inside the repo.
