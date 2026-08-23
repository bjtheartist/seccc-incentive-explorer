# Email gate redesign — parity ledger

Source of visual law: `R6GateBlessed.dc.html` (the blessed board, read verbatim —
see the spec file this branch was built from). Every row below is
`{board element → implementation locus → verification → status}`.

Statuses: **PASS** | **INTENTIONAL-DIFF** (reason from the closed list: (a)
sample→real data, (b) mock-named item absent, (c) illustrative values, (d)
copy-length from real data) | **PARTIAL** (mechanism built + render-tested +
zero fabrication + named follow-up).

## Gate anatomy (R6GateBlessed.dc.html)

| # | Board element | Implementation locus | Verification | Status |
|---|---|---|---|---|
| 1 | White card, navy `#0C1B33` header band, shadow | `components/report/ReportEmailGate.tsx` `<dialog>` + `<header>` | `report-email-gate.test.tsx` "renders the fixed anatomy" | PASS |
| 2 | "Chicago Incentive Explorer" eyebrow | same header | same test | PASS |
| 3 | "Your report is ready" (Playfair-style editorial heading) | same header, `font-editorial` | same test | PASS |
| 4 | Address subline | same header, conditional on `report.metadata.address` | same test (fixture carries an address) | PASS |
| 5 | "Which best describes you?" label | persona row | same test | PASS |
| 6 | Persona chip: "Just looking" | `lib/gate-persona-groups.ts` `GATE_PERSONA_CHIPS[0]` | "renders exactly the 4 board persona chips"; "renders 'Just looking' as a real, enabled, tappable chip" | PASS |
| 7 | Persona chip: "Business owner" (merges starting+growing, never re-keyed) | `GATE_PERSONA_CHIPS[1]` | same tests + "pre-selects Business owner … when no strong signal is present" | PASS |
| 8 | Persona chip: "Supporting businesses" | `GATE_PERSONA_CHIPS[2]` | "renders exactly the 4 board persona chips" | PASS |
| 9 | Persona chip: "Developer" | `GATE_PERSONA_CHIPS[3]` | "pre-selects the inferred lens from industry/goal (developer signal)" | PASS |
| 10 | "What brings you here? (Pick up to 2 — or just looking)" label | goal row | "renders the fixed anatomy" | PASS |
| 11 | Goal chip: "Renovate or build out" → rehab | `lib/gate-goal-groups.ts` `GATE_GOAL_CHIPS[0]` | "renders all 8 grouped goal chips in board order" + `goal-coverage.test.ts` (a) | PASS |
| 12 | Goal chip: "Expand or buy equipment" → expansion, equipment | `GATE_GOAL_CHIPS[1]` | same | PASS |
| 13 | Goal chip: "Open or relocate" → relocation | `GATE_GOAL_CHIPS[2]` | same | PASS |
| 14 | Goal chip: "Hire or train staff" → hiring | `GATE_GOAL_CHIPS[3]` | same | PASS |
| 15 | Goal chip: "Energy & building upgrades" → energy | `GATE_GOAL_CHIPS[4]` | same | PASS |
| 16 | Goal chip: "Build new" → new-construction | `GATE_GOAL_CHIPS[5]` | same | PASS |
| 17 | Goal chip: "Develop housing or mixed-use" → mixed-use, affordable-housing | `GATE_GOAL_CHIPS[6]` | same | PASS |
| 18 | Goal chip: "Just looking around" — dashed border, distinct, exclusive of the other 7 | `GATE_GOAL_CHIPS[7]` / `GATE_LOOKING_CHIP_ID`, `toggleGateGoalChip` | "renders all 8 grouped goal chips…dashed and distinct" | PASS |
| 19 | Primary button "View my report" | `report-email-gate-view` button | "VIEW MY REPORT and Save my report are disabled until a goal chip is picked" | PASS |
| 20 | Disabled state: grey `#C6CCD8`-equivalent, `cursor-not-allowed`, until persona AND ≥1 goal | `disabled:bg-[#C6CCD8]`, `!canProceed` gate | same test | PASS |
| 21 | Helper line "Pick what brings you here to continue" (shown only while disabled) | `report-email-gate-helper` | same test | PASS |
| 22 | "Want a hand? (Optional)" eyebrow | support box | "renders the fixed anatomy" | PASS |
| 23 | Name input | support box | same test (rendered input present) | PASS |
| 24 | Email input, `you@business.com` placeholder | support box | same test | PASS |
| 25 | Checkbox "I'd like 1-on-1 support working through this report" | support box | same test (exact copy asserted) | PASS |
| 26 | Promise line, **exact copy**: "A real person from the Southeast Chicago Chamber of Commerce will follow up within 48 hours." | support box | same test (exact string match) | PASS |
| 27 | "Come back anytime" title | save row | same test | PASS |
| 28 | "Save this report and pick up right where you left off." subline | save row | same test | PASS |
| 29 | "Save my report" button, disabled under the same mandatory rule | `report-email-gate-save` | "VIEW MY REPORT and Save my report are disabled…" | PASS |
| 30 | Footer: "PDF, email & window reminders live inside the report — where you can see what they're about" | footer `<p>` | "renders the fixed anatomy" (HTML-escaped `&amp;` asserted) | PASS |
| — | Email-delivery-of-report **removed** from the gate (old "Email and View Report" submit) | deleted from `ReportEmailGate.tsx` | "removes email-delivery-of-report and PDF download from the gate" | PASS |
| — | PDF download button **removed** from the gate (old `report-pdf-download`) | deleted from `ReportEmailGate.tsx` | same test | PASS |
| — | "Continue Without Email" **removed** (superseded by unconditional "View my report") | deleted from `ReportEmailGate.tsx` | same test | PASS |
| — | No newsletter language anywhere on the gate | reviewed copy throughout | same test (`toLowerCase()` scan for "newsletter") | PASS |
| — | Loading states ("Preparing...", "Saving...") on the two primary buttons | `viewStatus`/`saveStatus` | exercised implicitly by the disabled-state test; not a static-mock element | INTENTIONAL-DIFF (b) — mock-named item absent (the board is a single static frame; interactive busy states have no board equivalent) |
| — | Inline error alert (red) on prepare/save failure | `error` state block | not directly unit-tested with a forced failure (covered by manual/E2E smoke) | INTENTIONAL-DIFF (b) — mock-named item absent |
| — | Hidden honeypot "Website" field on the support box | carried over from the pre-redesign gate's anti-abuse pattern | present in rendered markup, off-screen | INTENTIONAL-DIFF (b) — mock-named item absent (invisible by design) |

## §A — Goal grouping

| Item | Locus | Verification | Status |
|---|---|---|---|
| 8 UI chips map to existing goal ids, ids never re-keyed | `lib/gate-goal-groups.ts` | `goal-coverage.test.ts` (a); `project-fit.test.ts` unaffected (goal ids unchanged) | PASS |
| Grouped chip feeds 1–2 real ids into the existing multi-goal path | `gateGoalChipsToGoalIds` → `onPrepareReport(goalIds, "")` → `projectGoalsFit` (already `readonly string[]`-typed) | `report-email-gate.test.tsx`; `project-fit.test.ts` | PASS |
| "Just looking around" carries zero goal ids (no filter, pairs with `looking` persona lens) | `GATE_LOOKING_CHIP_ID` → `goalIds: []` | `goal-coverage.test.ts`; existing `report-personas` "looking" lens tests (untouched) | PASS |

## §B — GOAL_RULES completion + orphan pass

The prepared draft at `/tmp/project-fit.ts` had **already landed on `main`**
by the time this branch forked (verified `diff` against
`lib/project-fit.ts` at branch start — identical). It added
`new-construction`, `mixed-use`, `affordable-housing`, `vacant-acquisition`
GOAL_RULES entries and closed 8 of the 20 previously-orphaned ids (`nmtcEligible`,
`qct`, `ahsap` mapped; `quantumEZ`, `filmCredit`, `liveTheaterCredit`,
`cannabisR3`, `cookCannabisGrant`, `class8aMicro` already industry-exempt).

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

**Coverage test** (`lib/__tests__/goal-coverage.test.ts`, 4 assertions):

| Assertion | Status |
|---|---|
| (a) every gate chip's goal id(s) resolve to a GOAL_RULES entry with non-empty `strongProgramIds` | PASS |
| (b) every one of the 71 real program ids is goal-reachable or in a documented exemption set | PASS |
| (c) every id referenced inside GOAL_RULES exists in the program registry | PASS |
| (bonus) the three exemption sets never overlap each other | PASS |

## §C — Inline offers inside the report

| Item | Locus | Verification | Status |
|---|---|---|---|
| Inline offer beside the SBIF/funding-window region | `components/report/FundingWindowChart.tsx` → `FundingWindowEmailOffer` | `components/report/__tests__/funding-window-email-offer.test.tsx` (4 tests) | **PARTIAL** |

Not on `R6GateBlessed.dc.html` — the board is the *gate* only; §C lives
inside the report itself. Repo-wide `grep` for "reminder" across
`scripts/`, `lib/`, `app/api/` returned zero matches: there is no scheduled
job, cron, or any future-triggered send mechanism anywhere in this repo.
Per spec §C's own instruction, a "notify me when this window opens"
promise was **not built** — that would be a fabricated promise the system
cannot keep. What ships instead: a real, honest, non-modal, dismissible
inline offer that sends the report **immediately**, via the exact same
verified mechanism the report's own "Email Report" action already uses
(`POST /api/email-report`). Copy says "right now," never "when this window
opens." Test asserts the banned future-tense phrasings are absent.

**Named follow-up:** a true future-triggered reminder needs a scheduled
sender (e.g., a cron hitting a new `/api/window-reminders` job) that does
not exist in this repo today — tracked as separate follow-up work, not
silently deferred.

## §D — Support-lead routing

| Item | Locus | Verification | Status |
|---|---|---|---|
| Optional support opt-in produces a real signal | `app/api/support-request/route.ts`, `lib/support-lead.ts` | manual route review; reuses `lib/report-email-delivery.ts`'s `createReportLead` (already tested/used in production by `/api/email-report`) | PASS |
| Chamber-inbox notification | Same route, `Resend` + `process.env.INCENTIVE_HELP_INBOX` | Same conditional pattern already live in `/api/email-report`'s `wantsHelp` branch — not a new mechanism | PASS |
| Admin/export surface | `lib/analytics-dashboard.ts`'s existing `report_leads` follow-up queue (`wants_incentive_help` ordering) — untouched, already reads this table | pre-existing, unmodified | PASS |

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

## §E — Save my report

| Item | Locus | Verification | Status |
|---|---|---|---|
| "Save my report" wired to the existing save mechanism | `ReportEmailGate.tsx` `handleSaveReport`, mirroring the identical authenticated/unauthenticated fork both `ReportDisplay` copies already implement (`useSession` → `SaveReportModal` in place, or `storePendingReport` + redirect to `/login?callbackUrl=/workspace?savePending=1`) | `report-email-gate.test.tsx`'s disabled-state test (save button); manual code review against `components/report/ReportDisplay.tsx`'s and `app/report/page.tsx`'s own `handleSaveReport` | PASS |
| Disabled under the same mandatory-selection rule as View | `!canProceed` on both buttons | "VIEW MY REPORT and Save my report are disabled…" | PASS |

## Judgment calls

1. **Persona "mandatory" rule** is satisfied by the existing pre-selection
   inference (owner ruling A1) — the board's own disabled-state screenshot
   shows "Business owner" already highlighted while the button stays
   disabled, with the helper line naming only the goal requirement. Persona
   never literally blocks in practice because inference never returns an
   empty value; this matches the board exactly.
2. **"Business owner" merged chip** defaults to `starting` when clicked and
   neither `starting` nor `growing` is already active (first in the
   existing vocabulary order, and the inference module's own generic
   fallback). No id was re-keyed; `lib/personas.ts` was not touched.
3. **Support opt-in has no submit button of its own** on the board — it
   rides alongside whichever primary action (View or Save) the visitor
   takes, firing only when the checkbox is checked and the email looks
   valid; otherwise it's silently skipped (never blocks either primary
   action).
4. **Inline funding-window offer sends immediately** rather than promising
   a future-triggered reminder, since no scheduled-send infrastructure
   exists in this repo — see §C above.

## Deviations from a literal reading of the spec

- None beyond the PARTIAL row in §C, which the spec itself explicitly
  allows ("PARTIAL allowed only for C/D backend sends per above").
