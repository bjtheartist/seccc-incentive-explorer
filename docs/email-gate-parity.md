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
parity doc cited 3 tests that did not exist.
**Gate review round 3 verdict: FIX-FIRST, converging** — 8 of round 2's 10
items VERIFIED-FIXED with red injections (NEW-1, NEW-2 residual noted,
NEW-4, NEW-5, NEW-6, NEW-7, NEW-8, NEW-9); rows 6/7/9/167 accepted as
honest. Round 3 found the engine's own `MAX_ENGINE_GOALS` cap (4) was
itself too low for what the gate can legitimately emit (R3-1), the
call-site pin was STILL executing a mock rather than the real handler for
a third round running (R3-A), a user-visible copy bug in the wizard's own
goal selector ("4/3 selected") that this PR made newly reachable (R3-2),
and a genuine data-loss bug in "Just looking around" un-tapping (R3-5).
**Gate review round 4 verdict: FIX-FIRST on exactly one blocker** —
everything on round 3's punch list VERIFIED-FIXED with red injections
except round 3's own `MAX_ENGINE_GOALS = 5` fix, which was itself
arithmetically wrong: it treated a pass-through id (a raw goal with no
chip — only `vacant-acquisition`/`other` qualify) as consuming a chip
"slot," when the chip budget and the pass-through budget are independent.
True ceiling is 6, confirmed by a brute-force search over every possible
seed rather than a hand-derived formula. Three latent/pre-existing items
the round 4 reviewer noted (a single-call-site closure-read pattern,
unvalidated share-link goal decoding, a `ts-morph` transitive-dependency
pattern) were explicitly marked out of scope for this round and are not
reworked here.
Every finding's fix and current status is tracked in the "Gate review
round 1," "round 2," "round 3," and "round 4" sections near the bottom of
this document. All rows in the tables below reflect the POST-round-4-fix
state and have been corrected in place rather than left standing next to a
rebuttal — the reviewer explicitly re-audits every row in each round's own
list.

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
| Grouped chip feeds its FULL goal-id set into the existing multi-goal path — no truncation, no invention, all the way to the engine — AND the real call site is genuinely covered | `ReportEmailGate.tsx`'s `projectGoalIds()`: pre-toggle emits `originalGoalIds` verbatim; post-toggle emits `gateGoalChipsToGoalIds(selectedGoalChips)` + `passthroughGoalIds` — TWO INDEPENDENT budgets (the chip budget, up to `goalChipCap`; the pass-through budget, uncapped by the chip budget) that both ride together — via `dedupeGoalIds` (uncapped) → `onPrepareReport(goalIds, customGoal)` → `app/report/page.tsx`'s `handlePrepareGatedReport` → `resolveGatePrepareGoals` (`lib/gate-goal-groups.ts`) → `WizardState.projectGoals` → `selectedProjectGoals()` (`MAX_ENGINE_GOALS = 6`, the provable ceiling) → `lib/report-engine.ts` | **Gate review rounds 3-4, MAJOR findings R3-1/R3-A/THE BLOCKER — round 2's version of this row was FALSE on two counts, and round 3's own fix for the first count was ITSELF still wrong; all three now genuinely closed.** (1) Ceiling: round 1 shipped `MAX_ENGINE_GOALS = 4`; round 3 found a 5-id reachable scenario and raised it to 5 — but that derivation treated a pass-through id (a raw goal with no chip at all — only `vacant-acquisition`/`other` qualify) as if it consumed one of the gate's chip "slots," when the chip budget and the pass-through budget are independent. Round 4's reviewer found the real worst case: a 3-raw-id seed carrying BOTH pass-through ids still only floors `goalChipCap` at `MAX_GATE_GOAL_CHIPS` (2) — leaving the visitor free to pick both 2-id chips (4) on top of both pass-through ids (2) = **6**. Raised to 6, the PROVABLE ceiling — `lib/__tests__/gate-goal-groups.test.ts`'s "provable ceiling" describe block now brute-forces every possible seed up to `MAX_PROJECT_GOALS` in size (not a hand-derived formula, which is exactly what let round 3's undercount slip through) and asserts the true max, with the reviewer's own witness seed reproduced directly as its own test. Survival is pinned all the way through `selectedProjectGoals()` — the reviewer's live repro (seed `["vacant-acquisition","other","expansion"]` + customGoal, tap one more chip) is its own end-to-end test in `report-email-gate.test.tsx`, asserting 6 ids emitted, 6 surviving `selectedProjectGoals()`, and the visitor's typed `customGoal` text NOT blanked (the third instance of BLOCKER-2's failure mode, one boundary further downstream each time). (2) R3-A (the THIRD round on the call-site gap specifically): `onPrepareReport` really is a `vi.fn()` in every `ReportEmailGate` test, so `handlePrepareGatedReport` genuinely never executed anywhere in this repo before round 3 — the reviewer proved it by swapping the real call for an inline, capped reimplementation and watching 3822 tests stay green. Two independent fixes close this: `app/report/__tests__/gate-prepare-engine-integration.test.tsx` renders the REAL `ReportPageWrapper` with `ReportEmailGate` deliberately left UNSTUBBED, clicks through a real gate interaction, and inspects the real outgoing `POST /api/report/generate` body; `app/report/__tests__/gate-prepare-call-site-fence.test.ts` parses the real `app/report/page.tsx` source with `ts-morph` (AST, not a string heuristic) and asserts `handlePrepareGatedReport`'s body calls `resolveGatePrepareGoals` and never `selectedProjectGoals` or a raw `JSON.stringify` reimplementation. Both confirmed against the reviewer's exact injection: the fence catches it directly; the integration test does NOT discriminate this specific mutant by value once the ceiling is correct (no reachable UI scenario diverges from the capped reader by construction), so the fence is the operative pin for the wrong-function regression specifically — documented as such rather than overclaimed. | PASS |
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
| Chamber-inbox notification | Same route, `Resend` + `process.env.INCENTIVE_HELP_INBOX` | Same conditional pattern already live in `/api/email-report`'s `wantsHelp` branch — not a new mechanism, genuinely env-conditional. `route.test.ts`'s env-conditional tests prove BOTH branches behave as documented (no key → `notified: false`, Resend never constructed; both keys → a real `Resend.emails.send` call to the configured inbox). Production configuration independently verified 2026-08-23 via `vercel env ls production`: both `RESEND_API_KEY` and `INCENTIVE_HELP_INBOX` exist, Encrypted, on the Production environment. | **PASS** — upgraded from PARTIAL in gate review round 3: the code's behavior in both configurations is tested, and the one thing that was previously unverifiable from inside the repo (whether the two env vars are actually set on Vercel prod) has now been verified externally and dated. Nothing about this row remains untested or unverified. |
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
| R1-BLOCKER-1 carryover | The truncation site itself was unpinned — `onPrepareReport` is a `vi.fn()` in every test, so the real `handlePrepareGatedReport` never executed | Extracted the exact dedupe-and-noop-detect logic into `resolveGatePrepareGoals` (`lib/gate-goal-groups.ts`); `handlePrepareGatedReport` is now a thin wrapper around it | **This round's fix was INSUFFICIENT** — the reviewer proved it in gate review round 3, MAJOR finding R3-A: unit-testing `resolveGatePrepareGoals` in isolation never verified the CALL SITE actually calls it. Swapping the call at `app/report/page.tsx`'s line ~1803 for an inline, capped reimplementation left all 3822 tests green, because nothing here executed the real handler. **See the round 3 table below for the actual fix** (a real integration test that renders the unstubbed gate + an AST fence test) — this row is corrected in place rather than left standing next to the disproven claim. |
| NEW-1 | Seeding silently ADDS goal ids the visitor never picked (`["expansion"]` → chip pre-press → emits `["expansion","equipment"]`), forcing a needless regeneration | `ReportEmailGate.tsx` keeps `originalGoalIds` as separate frozen state, emitted verbatim pre-toggle; chip seeding (`goalIdsToGateChipIds`) is DISPLAY-only now, never emission | `report-email-gate.test.tsx`'s "gate review round 2, NEW-1" describe block (3 tests: single-id no-add, `mixed-use` no-add, a real toggle legitimately switching to the full chip mapping); confirmed by re-injecting always-chip-derived emission — 3 tests fail; reverted, all pass |
| NEW-2 | Seeding bypasses `MAX_GATE_GOAL_CHIPS`; a seeded chip above the cap, once deselected, could never be re-added (stranded) | `toggleGateGoalChip` takes an explicit `cap` parameter; `ReportEmailGate.tsx` computes `goalChipCap = Math.max(MAX_GATE_GOAL_CHIPS, <seeded count>)` once at mount | **VERIFIED-FIXED with a residual, disclosed honestly** (see the ship-with-disclosure list below): `lib/__tests__/gate-goal-groups.test.ts`'s "explicit cap parameter" describe block + `report-email-gate.test.tsx`'s "gate review round 2, NEW-2" describe block (the reviewer's exact reproduction: seed 3, deselect "Energy & building upgrades," reselect it); confirmed by re-injecting a fixed `goalChipCap = MAX_GATE_GOAL_CHIPS` — 1 test fails; reverted, all pass. The residual: `goalChipCap` is a session-wide number with no per-chip memory, so if a freed seeded slot gets spent on a DIFFERENT new chip instead of the same one, the originally-deselected seeded chip is stranded for the rest of the session — recovering "any seeded chip" was never literally true, only "the seeded COUNT stays available." |
| NEW-3 | The 4th goal died one screen later — `ProjectGoalSelector`'s display slice and `selectedProjectGoals()` both truncated a gate-produced 4-goal report to 3 the instant either rendered | New named constant `MAX_ENGINE_GOALS` (`lib/report-wizard-config.ts`, raised again to 5 in round 3 — see R3-1 below) replaces `MAX_PROJECT_GOALS` in `selectedProjectGoals()`'s slice and `ProjectGoalSelector`'s display-read slice; `MAX_PROJECT_GOALS`/`atLimit` (the wizard's own "pick up to 3" fresh-growth limit) are untouched | Round 2 covered this only indirectly and admitted no dedicated `ProjectGoalSelector` render test existed. **Round 3, R3-6 closed that gap**: `components/report/__tests__/project-goal-selector.test.tsx` renders the real component with a 4-5 goal `goals` prop and asserts every one renders checked; confirmed by re-injecting the reviewer's exact `.slice(0, 3)` mutant at the exact site — 5/7 tests fail; reverted, all pass |
| NEW-5 | Order-sensitive `JSON.stringify` equality + chip-definition-order re-derivation flipped a stored `["hiring","rehab"]` to `["rehab","hiring"]` on an untouched gate, regenerating the report and changing `metadata.projectType` | Fixed by the SAME mechanism as NEW-1 — verbatim pre-toggle emission preserves both ids AND order, so the comparison in `resolveGatePrepareGoals` matches and short-circuits to a no-op | `report-email-gate.test.tsx`'s "gate review round 2, NEW-5" describe block: `["hiring","rehab"]` in, `["hiring","rehab"]` out (order asserted, not just set-equality); confirmed by re-injecting always-chip-derived emission (same mutant as NEW-1) — fails; reverted, passes |
| NEW-4 | Parity doc rows 6/7/9 cited test names that did not exist anywhere in the repo | Wrote the real tests rather than rewriting the rows down, per the ruling's explicit preference | `report-email-gate.test.tsx`'s new "persona pre-selection" describe block (3 tests, real `aria-pressed` assertions) |
| NEW-6 | `dedupeGoalIds` dropped the `.filter(Boolean)` `selectedProjectGoals()` has always had — an empty-string goal id could reach the engine unfiltered | Restored the filter | `lib/__tests__/gate-goal-groups.test.ts` "filters falsy entries" |
| NEW-7 | The `showModal()` jsdom fallback (plain `open` attribute, no backdrop/focus trap) would be a bypassable, non-modal gate if it ever ran in production | Guarded to `process.env.NODE_ENV !== "production"`; a real production browser missing `showModal()` gets a closed, non-interactive dialog + a logged error instead of a silently-downgraded one | Environment-guarded by construction; existing 38 `report-email-gate.test.tsx` tests continue to pass under the test-env branch (vitest sets `NODE_ENV=test`) |
| NEW-8 | `report-email-gate.test.tsx` redefined `window.location` via `Object.defineProperty` twice with no restore, leaking the mock into later tests in the file | Original `window.location` descriptor captured once at module load, restored in a shared `afterEach` regardless of whether a given test touched it | Structural fix — all 38 tests in the file continue to pass in file order |
| NEW-9 | §D row 167 verification was "pre-existing, unmodified" — not a test; nothing exercised `app/api/support-request/route.ts` itself, only the mocked client boundary | New `app/api/support-request/route.test.ts` (8 tests) calls the route's real `POST` handler | See §D table above |

## Gate review round 3 — finding-by-finding status

Round 2 items NEW-1, NEW-4, NEW-5, NEW-6, NEW-7, NEW-8, NEW-9 were reviewer-
confirmed VERIFIED-FIXED with red-on-injection proof and are NOT reworked
here. NEW-2 was also confirmed, with a residual disclosed above and in the
ship-with-disclosure list below. Rows 6/7/9/167 were accepted as honest.

| # | Finding | Fix | Test(s) that now pin it |
|---|---|---|---|
| R3-1 | The gate can emit 5-6 goal ids; `lib/report-engine.ts`'s two `selectedProjectGoals()` call sites capped at `MAX_ENGINE_GOALS = 4` and silently dropped the extras — the reviewer's reproduction: an ordinary 3-goal wizard run `["expansion","mixed-use","rehab"]`, one further chip tap, 5 ids emitted, `affordable-housing` (and the programs behind it) dropped at the engine boundary | `MAX_ENGINE_GOALS` raised to 5 — the PROVABLE ceiling, derived from `GATE_GOAL_CHIPS`' actual shape (2 two-id chips + up to `MAX_PROJECT_GOALS` seed slots), not guessed | `lib/__tests__/gate-goal-groups.test.ts`'s "provable ceiling" describe block computes the worst case FROM the chip definitions and asserts `MAX_ENGINE_GOALS >=` it (breaks on future regrouping, not on visitors' reports); the 5-id `resolveGatePrepareGoals` test now also asserts survival THROUGH `selectedProjectGoals()` itself; a new test reproduces the reviewer's exact 3-goal-seed-plus-one-tap scenario end to end |
| R3-A | (Third round on this item.) The call site itself was still unexecuted — the reviewer swapped the real `resolveGatePrepareGoals` call at `app/report/page.tsx`'s line ~1803 for an inline, capped `selectedProjectGoals` + `JSON.stringify` reimplementation and watched 3822 tests stay green | Two independent fixes, per the ruling's stated preference order: (1) PRIMARY — `app/report/__tests__/gate-prepare-engine-integration.test.tsx` renders the real `ReportPageWrapper` with `ReportEmailGate` deliberately left unstubbed (every other heavy child component still stubbed, same list as the established sibling harness) and clicks through a real gate interaction; (2) FALLBACK/defense-in-depth — `app/report/__tests__/gate-prepare-call-site-fence.test.ts` parses the real source with `ts-morph` | Integration test: confirmed by re-injecting the reviewer's exact mutant — the test still PASSES on that specific mutant (see note below), so the fence is the operative pin. Fence test: re-injected the same mutant — 3/4 tests fail; reverted, all pass. **Note on the integration test's limits**: once `MAX_ENGINE_GOALS` is set to the true reachable ceiling (6, as of round 4 — round 3's own attempt at "the true ceiling" was itself still wrong, see the R3-1/THE BLOCKER rows), NO reachable UI scenario can produce more ids than the capped reader also keeps — capped-vs-uncapped divergence and "reachable via the UI" are mutually exclusive by construction once the cap is set correctly. The integration test therefore proves real EXECUTION of the correct path with correct results, not value-divergence from the wrong one; the AST fence is what catches the wrong-function regression directly. Documented here rather than overclaiming what the integration test alone demonstrates. |
| R3-2 | User-visible copy bug, newly reachable because of this PR: `ProjectGoalSelector`'s counter showed "4/3 selected" and the at-limit message said "Three goals selected." while 4 were checked — the old `.slice(0, 3)` made this unreachable before round 2 raised the display cap | Counter and at-limit copy now derive from `displayCap = Math.max(MAX_PROJECT_GOALS, selectedGoals.length)` — shows "4/4"/"4 goals selected." instead of the nonsensical "4/3"/"Three goals selected." `atLimit`'s BLOCKING behavior (still `MAX_PROJECT_GOALS`-based, governing the wizard's own growth limit) is unchanged | `components/report/__tests__/project-goal-selector.test.tsx`'s "counter and at-limit copy" describe block (6 tests: normal 3-goal case unchanged, 4- and 5-goal cases show the honest count, sub-3 case shows no message at all) |
| R3-5 | "Just looking around" permanently destroyed pass-through goals — tapping it cleared `passthroughGoalIds` with no restoration on un-tap. Reviewer's reproduction: seed `["other"]` + custom text, tap looking, untap — disabled button, unrecoverable without a reload | `originalPassthroughGoalIds` (frozen at mount) is the source of truth `toggleGoalChip` restores FROM whenever looking transitions from selected to deselected — whether by re-tapping it directly, or implicitly, by picking a substantive chip that clears looking as a side effect | `report-email-gate.test.tsx`'s "gate review round 3, R3-5" describe block (2 tests: the reviewer's exact probe, plus the implicit-clear-via-substantive-pick path); confirmed by re-injecting the original one-way clear (no restore branch) — 2/2 fail; reverted, both pass |
| R3-6 | No test pinned `ProjectGoalSelector.tsx`'s display-read slice (`.slice(0, MAX_ENGINE_GOALS)`) — the exact site NEW-3 was supposedly fixed at; injecting `.slice(0, 3)` there passed 0 red | New `components/report/__tests__/project-goal-selector.test.tsx` render-tests the real component directly | 2 tests assert a 4-5 goal `goals` prop renders every one checked; confirmed by re-injecting the reviewer's exact `.slice(0, 3)` mutant — 5/7 tests in the file fail; reverted, all 7 pass |

## Ship-with-disclosure (no further code change required — disclosed honestly, not silently accepted)

- **Toggle-then-untoggle residual** (round 2 ruling #1, not literally
  absolute): seeding `["expansion"]` alone, then toggling the pre-pressed
  chip off and back on, emits `["expansion","equipment"]` — chip-derived
  emission applies to the WHOLE selection once any real toggle happens,
  per round 2's own ruling, even for the specific chip that was already
  seeded. This is intentional and matches `report-email-gate.test.tsx`'s
  "an ACTUAL toggle switches emission to the chip-derived mapping" test —
  named here so "no code path may add ids" is understood as "not before
  any real interaction," not as an unconditional absolute for all time.
- **The 4th+ goal is one-way in `ProjectGoalSelector`'s own growth path**
  (already disclosed as judgment call 7): `atLimit` still gates NEW
  additions at `MAX_PROJECT_GOALS` (3), unchanged per the round 2 ruling.
  A gate-seeded report with 4-5 goals displays all of them and can freely
  DESELECT any, but once back down to 3 selected, re-adding a 4th through
  this component's own UI is blocked the same way it always was for a
  fresh wizard run.
- **NEW-2's residual / the R3-4 scenario** (see the NEW-2 row above): a
  freed seeded slot spent on a genuinely NEW chip strands the
  deselected seeded chip for the rest of the session — `goalChipCap` is a
  session-wide count with no per-chip memory. Recovering "the seeded
  COUNT stays selectable" is guaranteed; recovering "this SPECIFIC
  originally-seeded chip, no matter what else gets picked in between" is
  not. This is the actual, disclosed boundary of NEW-2's recoverability
  fix, not the unconditional claim judgment call 6 previously made.

## Gate review round 4 — finding-by-finding status

Everything round 3 shipped was reviewer-confirmed VERIFIED-FIXED with red
injections except round 3's own `MAX_ENGINE_GOALS = 5` fix, which was
itself wrong. Exactly one blocker this round.

| # | Finding | Fix | Test(s) that now pin it |
|---|---|---|---|
| THE BLOCKER | `MAX_ENGINE_GOALS = 5` undercounted — round 3's derivation treated a pass-through id as consuming a chip "slot," but the chip budget (`goalChipCap`, never below `MAX_GATE_GOAL_CHIPS`, fillable with ANY chips once any toggle happens) and the pass-through budget (`unmatchedGoalIds`, uncapped) are INDEPENDENT. Reviewer's witness: seed `["vacant-acquisition","other","expansion"]`, tap "Develop housing or mixed-use" → 6 ids emitted, engine keeps only 5, drops `"other"` — which also blanks the visitor's typed `customGoal` (`app/report/page.tsx`'s `handlePrepareGatedReport` only preserves it when `"other"` survives into the goal set it writes back) | `MAX_ENGINE_GOALS` corrected to 6. `worstCaseReachableEngineGoalCount()` (`lib/__tests__/gate-goal-groups.test.ts`) rewritten to model the two budgets separately and brute-force every possible seed up to `MAX_PROJECT_GOALS` in size (drawn from the real `SITE_PROJECT_TYPE_OPTIONS` universe) instead of a hand-derived closed form — the same verification technique the reviewer used to catch round 3's undercount in the first place | The "provable ceiling" describe block's brute-force search returns `{ max: 6, witness: [...both pass-through ids...] }`; a dedicated test reproduces the reviewer's exact witness seed directly; `report-email-gate.test.tsx`'s new round-4 describe block mounts the real gate with the reviewer's exact live repro (seed + customGoal, one chip tap) and asserts 6 ids emitted, 6 surviving `selectedProjectGoals()`, and `customGoal` NOT blanked; confirmed by re-injecting `MAX_ENGINE_GOALS = 5` — both the derivation test and the live-repro test fail; reverted, both pass |
| NEW-R4-1 | Two comments still hardcoded the literal number instead of referencing the constant (`app/report/page.tsx:1796`, `lib/gate-goal-groups.ts:192`) — exactly the kind of stale reference that let round 3's wrong number go uncorrected in prose even after code changed | Both rewritten to point at `MAX_ENGINE_GOALS`'s own doc comment (which carries the current number and its derivation) instead of restating a copy of the number inline | Comment-only change; no test applicable — verified by re-reading both sites after the edit |

Recorded, no action taken (per the round 4 ruling — explicitly out of
scope): **NEW-R4-2** (MINOR, latent) — `toggleGoalChip`'s closure-read
pattern has only one call site today, noted rather than refactored.
**NEW-R4-3** (INFO, pre-existing) — `lib/url-state.ts`'s `pg=` share-link
goal decoding is unvalidated (a slice at 3, no check against the real
option list), which could in principle push the pass-through budget past
whatever `MAX_ENGINE_GOALS` is; pre-existing on `main`, not introduced by
this branch — logged as a follow-up, not fixed here. **NEW-R4-4** (INFO,
pre-existing) — `ts-morph` is resolved only as a transitive dependency in
this repo, the same pattern already used by `lib/public-claim-surfaces-verify.ts`;
not a new risk this branch introduced.

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
6. **`goalChipCap` generosity — CORRECTED in gate review round 3 (finding
   R3-4/NEW-2 residual):** this judgment call previously claimed the fix
   guaranteed "no seeded chip is ever strandable." That was false, and the
   reviewer disproved it: seed `["rehab","hiring","energy"]` (3 chips,
   cap=3), deselect "Energy & building upgrades" (down to 2), then select
   "Build new" instead of reselecting Energy (back to 3, cap reached) —
   Energy is now stranded for the rest of the session; the freed slot went
   to a different chip. What the fix actually guarantees, precisely: the
   seeded COUNT stays selectable (the cap never drops below however many
   chips were originally seeded), not that any SPECIFIC originally-seeded
   chip survives whatever else gets picked in between. `goalChipCap` has
   no per-chip "was this one seeded" memory — it is a single session-wide
   number, the smallest change that satisfies the count guarantee, and
   chip-identity tracking beyond that was never requested. See the
   ship-with-disclosure list above for this same boundary stated as its
   own item.
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
- The §D chamber-inbox notification row was PARTIAL through gate review
  rounds 1-2 (env-var configuration verification was a ship-ritual
  checklist item this branch's code could not prove from inside the
  repo). Upgraded to PASS in round 3 once that verification was actually
  done (2026-08-23, `vercel env ls production` — both `RESEND_API_KEY` and
  `INCENTIVE_HELP_INBOX` confirmed Encrypted/Production) — no longer a
  deviation, since the row now claims only what is verified.
