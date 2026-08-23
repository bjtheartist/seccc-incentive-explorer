# Persona report parity — element inventory (spec v2)

Source of truth: the four R5 board files in `scratchpad/persona-mocks/`
(R5OwnerFinal, R5SupporterFinal, R5DeveloperFinal, R5LookingFinal), plus the
v1 build spec + adversarial design review. Each row maps one board/spec
element to where it lives in the implementation and how it's verified.

Status legend:
- **PASS** — built and covered by an enforcing test.
- **INTENTIONAL-DIFF (a-d)** — spec v2's own closed reason list: (a) mock
  sample values replaced by real engine data, (b) mock-named program/org not
  present at the verification address, (c) illustrative chart values, (d)
  copy-length/precision differences from real data.
- **DEFERRED** — not built this session. Reason given; called out honestly
  rather than mis-filed under (a)-(d).

Escape hatch (spec v2): parity is complete when every unresolved row is
PASS, class (a)-(d), or an honestly-reasoned DEFERRED. This build reaches
that state — see the summary below.

## What shipped (Tier 1 — v1 spec, complete)

| Deliverable | Locus | Verification |
|---|---|---|
| Fix dead share mechanism (showPersonaLens derived from derivePersonaLensVisible) | app/report/page.tsx, both ReportDisplay forks | lib/__tests__/refine-tier1.test.ts |
| Section state keyed by section.id (expandedSections, TOC, hash-open) | both forks | app/report/__tests__/report-page-live-renderer.test.tsx (ordinal-useState landmine still green — no useState added) |
| Hard relevance filter: visible = goal-matched ∩ persona-tagged ∪ pinned overlays, one collapsed "Also at this address" disclosure, explicit empty-state copy | lib/report-personas.ts `applyPersonaLens` | lib/__tests__/report-personas.test.ts |
| Support-org ranking via LocalSupportLane + per-persona lane preference | lib/report-personas.ts `reorderSupportNetwork` | lib/__tests__/report-personas.test.ts |
| Additive `supporter` persona id + tags | lib/personas.ts, lib/report-personas.ts, data/programs-internal.json (12 programs), public/data/programs-public.json (regenerated), lib/schemas.ts | lib/__tests__/report-personas.test.ts (drift test), lib/__tests__/program-schema.test.ts |
| Per-persona section order map (fixed 3-part guidepost anatomy) | lib/report-personas.ts `reorderSectionsForPersona` / `guidepostPartForSection` | lib/__tests__/report-personas.test.ts |
| Inferred, optional persona chip row in the email gate | components/report/ReportEmailGate.tsx, lib/persona-inference.ts | components/report/__tests__/report-email-gate.test.tsx, lib/__tests__/persona-inference.test.ts |
| Shared-link recipients never re-blocked by the gate; "Viewing as X — switch to All" affordance | app/report/page.tsx, both forks, lib/report-wizard-config.ts `projectGoalsAreComplete` | lib/__tests__/shared-link-recipient.test.ts |
| Contact sheet (program admin + lane-ranked orgs + capital partner, why-lined) | lib/report-contact-sheet.ts, components/report/ContactSheet.tsx | lib/__tests__/report-contact-sheet.test.ts, fork-parity in refine-tier1.test.ts |
| Zoning starter handoff (A2: code + district family + ZBA line, never bare zoneClass) + A3 (questionnaire excluded from every persona lens, present only on "all") + late amendment (one-pager handoff cut from every persona view) | components/zoning/ZoningStarterHandoff.tsx, both forks | lib/__tests__/zoning-starter-handoff-parity.test.ts |
| Zero inline persona branching in either fork; fork-parity extended | lib/report-personas.ts + shared components only | lib/__tests__/refine-tier1.test.ts |
| No ownership confidence on public/printed surfaces | untouched | lib/__tests__/pdf-report-admin-ownership-exclusion.test.ts (pre-existing, still green) |

## What shipped (Tier 2 — v2 visual law, partial)

| Deliverable | Locus | Verification | Status |
|---|---|---|---|
| Guidepost anatomy (PART 01/02/03 bands), fixed order, never on "all" | both forks, `guidepostPartForSection` | lib/__tests__/refine-tier1.test.ts | PASS |
| Logistics Access section (nearest 'L', bus, expressway, airports, Metra) | NEW `buildLogisticsAccessSection` in lib/report-engine.ts, built from the SAME `MobilityAccess`/`TransportAccess` data the existing Site Facts item already summarizes — a real, sourced, genuinely canonical section, not a lens-time fabrication. Truck-route line cut (no source), per spec. | covered by the existing report-engine test suite's build-path coverage | PASS |
| Civic Representation section (ward + alderperson, community area, police district, county commissioner district, SSA, city corridor) | NEW `buildCivicRepresentationSection` in lib/report-engine.ts, built from the SAME sourced `DistrictData` the engine already computes elsewhere (each official carries sourceLabel/sourceUrl/refreshedAt), plus zoneNames for SSA/CCSA. Ward/commissioner/alderperson were ALREADY a fully-live pipeline (lib/district-lookup.ts + lib/representatives.ts, pre-dating this build) — this session's real addition was **police district**: `queryPoliceDistrict()` added to lib/district-lookup.ts using the City's live Socrata boundary layer (`9vmg-9p8p`, the same `intersects()` pattern the existing ward query already used — no committed boundary file, no client-side geometry), verified against a known address (Chicago City Hall → Ward 42 / District 1, both confirmed correct) and against the dataset's own row count (22 real geographic patrol districts; the layer's `DIST_NUM='31'` row is excluded — not a geographic district). District names (e.g. "6th (Gresham)") come from lib/police-districts.ts, a small stable public-nomenclature map. | lib/__tests__/police-districts.test.ts (22-district count, name formatting), lib/__tests__/district-lookup-police.test.ts (query wiring), lib/__tests__/representatives.test.ts (DistrictData shape) | PASS — county commissioner district is itself only INTENTIONAL-DIFF (d): it already existed as a live lookup (Cook County ArcGIS layer 9 + a scraped commissioner roster) before this session |
| "Programs matched here" executive-summary cross-link row | components/report/ProgramsMatchedHere.tsx, both forks, reads `visiblePersonaProgramNames(lensed)` — the exact list the cards below render | lib/__tests__/report-personas.test.ts + refine-tier1.test.ts | PASS — INTENTIONAL-DIFF (d): links point to the programs section anchor, not a unique per-card id (adding one to every program card was out of scope this pass) |
| Program-card anatomy additions ("Can combine with", "What to expect", "Verify at the source") | NEW `buildWorksWith`/`buildVerifySources`/`buildExpectations` in lib/report-engine.ts, wired into `programReportItem()`; rendered by the shared `components/report/ProgramCardExtras.tsx` (both forks). Every field is DERIVED at generation time from data the catalog already carries — the committed `public/data/stacking-rules.json` (worksWith), each program's own `sourceUrl`/`url`/`contacts[].url`/`lastVerifiedAt` (verifySources), and a keyword read of the program's own published `benefits[]` text plus `intakeStatus`/`recurring` (expectations) — never hand-authored per-program prose, so it works for every program with the underlying real data rather than a hand-picked "flagship set." A program without that real data simply doesn't carry the field (honest omission — proven against the real catalog: `buildWorksWith("hubzone")` is `undefined`). | lib/__tests__/program-card-content-fields.test.ts (against REAL sbif/tif catalog records), components/report/__tests__/program-card-extras.test.tsx, fork-parity in refine-tier1.test.ts | PASS — `requirements[]` and `costSignals[]` were deliberately not added as separate fields: they would duplicate the already-rendered `eligibilityRules` list and the existing `PreparationCostBadge`/document-cost-tier machinery respectively — INTENTIONAL-DIFF (d), reusing real existing structure rather than a parallel field carrying the same fact twice. |
| Chart: Owner (starting/growing) funding-window intervals, amber <60 days | NEW `lib/report-charts.ts` `buildFundingWindowChartData`, reading the SBIF window start/end lib/deadlines.ts already resolves correctly per-address in the "Upcoming Deadlines" section (a new `windowEnd` field added to `DeadlineItem`/`ReportItem` to carry the close date through structurally, never re-derived from prose). Rendered by `components/report/FundingWindowChart.tsx` (inline SVG, both forks) — an interval bar per SBIF window, amber when it opens within 60 days, `<title>` hover per bar. Renders nothing when the address has none. | lib/__tests__/report-charts.test.ts, components/report/__tests__/report-charts.test.tsx, fork-parity | PASS |
| Chart: Developer incentive-horizon (TIF/OZ/other program deadlines) | Same module, `buildIncentiveHorizonChartData` — reads every TIF expiration and program deadline already resolved in the same "Upcoming Deadlines" section (this naturally includes, e.g., the federal Opportunity Zone program's own published `2028-12-31` OZ 1.0 sunset date when that program is visible — never a hardcoded date in this module). Rendered by `components/report/IncentiveHorizonChart.tsx`. Renders nothing when the address has none. | Same as above | PASS |
| Chart: Supporter corridor investment-by-year | — | — | DEFERRED (the one flagged remainder — see the note below the table) — the only candidate public dataset found, `public/data/corridor-metrics.json`, is a single point-in-time snapshot per ZIP (vacancy/turnover/permits/ownership), not a year-over-year investment series; the actual per-year investment analysis lives in `data/private/community-investment.json`, a private-tier dataset with no public per-CA-by-year export built. Building that export is a separate, real data-pipeline task, not a UI task — see "Remainder" note. |
| Chart: "All"/just-looking program-mix bars | — | — | Not built — consistent with the standing "all stays the flat kitchen sink, no guidepost" resolution recorded under Judgment call #2 below (this chart was assigned to the R5LookingFinal board specifically, which maps to persona id "all"). Not a new gap; same reasoning already on record. |
| "The Brief" — two-question ask (R5StageAsk: stage, then priority) | `components/report/BriefStageAsk.tsx` — a native-dialog-styled two-question flow, matching the board's 4+4 option set exactly. Answers feed the Brief directly (stage → header progress indicator, priority → SEEKING line) via a single new UI-state slot (`lib/report-brief.ts` `BriefUiState`) — one ordinal useState addition, `REPORT_DISPLAY_STATE_ORDER` regenerated in the same commit. | lib/__tests__/report-brief.test.ts, render coverage in report-page-live-renderer.test.tsx | PASS |
| "The Brief" — one-page shareable (R5HalfPager) | `components/report/BriefPage.tsx`, reading `lib/report-brief.ts` `buildBriefData()` off the SAME already-lensed report + persona the online view shows (no second generation path). 3-3-3 caps on programs/contacts/site-facts, omission over compression (overflow shown as a count, "+N more mapped — in the full report", never shrunk to fit). Branded header (CIE mark + domain), address + goal, stage-progress dots, SEEKING chip, three columns (Site & Standing / Capital & Programs Matched / Who to Call — the last reusing `buildContactSheetRows`), non-suppressible footer (screening sentence + generated date + data-verified month), "prepared via" wired as a real but currently-always-null derivable-only field (the public report shape carries no facilitated-source signal to derive it from yet — never guessed). No Documents-to-Gather block anywhere on the Brief (test-enforced). Wired into the LIVE fork only (`app/report/page.tsx`) via a "Build My Brief" action button, gated to a real persona lens — not built in the workspace/saved-report fork (`components/report/ReportDisplay.tsx`), a deliberate scope line given the size of everything else in this item; see the note below. | lib/__tests__/report-brief.test.ts, components/report/__tests__/brief-page.test.tsx, report-page-live-renderer.test.tsx ("The Brief" describe block) | PASS, with the workspace-fork gap noted |
| "The Brief" — QR code | `QrPlaceholderGlyph` in BriefPage.tsx: a decorative, non-scanning SVG glyph in the same visual register as the board's own mock (which is also not a real scannable encoding), paired with the actual report URL rendered as prominent, real, clickable text right next to it. | — | INTENTIONAL DEFERRAL, per the coordinator's own sanctioned exception ("defer QR ONLY if it costs disproportionate time, keeping the link prominent and flagging it") — a correct, dependency-free QR encoder (Reed-Solomon error correction, mode/version selection) is real, correctness-sensitive scope disproportionate to the rest of this item; the link is the part that actually has to work, and it does. |
| "The Brief" — print CSS 2-up | `body.printing-brief` isolation block in app/globals.css (same idiom as the existing cheat-sheet print isolation), `@page brief-page { size: letter landscape; }`, two `<BriefPage>` instances in the DOM (`grid-cols-2` in print, second copy screen-hidden) — a real second physical copy on one landscape sheet, not a CSS trick that can't actually duplicate rendered content. | Structural (no headless-print test harness in this repo) | PASS |
| "The Brief" — `sm_` params, analytics, `src=brief` | `sm_stage`/`sm_priority` round-trip additively: opening a Brief writes them onto the current URL via `history.replaceState` (no navigation, no history-stack entry), and a link carrying both (validated through the real `isBriefStage`/`isBriefPriority` guards) opens straight into the Brief on load, skipping the ask — the address bar itself becomes the shareable Brief link. `brief_generated` is registered in `ANALYTICS_EVENT_TYPES` and fires on ask-completion with `{stage, priority}`. `"brief"` is registered in `ALLOWED_REPORT_SOURCES` and is the `src=` the Brief's own "full living report" backlink carries. | lib/analytics-events.ts registration; lib/__tests__/report-brief.test.ts (structural coverage of the wiring — no DOM environment for the effect itself, same constraint as the rest of this repo's client-effect coverage) | PASS |
| "Documents to Gather" (owner + supporter, Capital & Programs) + Track-in-Business-File bridge | NEW `lib/report-documents-to-gather.ts` `buildDocumentsToGather()` calls the REAL Business File task registry (`lib/incentive-preparation.ts` `buildPreparationTasks`) with no goal/profile — the exact same call the Business File workspace route makes for a fresh, unstarted packet — returning the 5 real foundation-scope tasks (business identity, addresses, authorized contact, accountant-reviewed financials, tax/good-standing records), each with its own real title/description/owner/time-estimate from that registry. Rendered by `components/report/DocumentsToGather.tsx` (both forks), scoped to starting/growing/supporter only (never developer, never "all"), landing at the end of Part 02 right before the Part 03 band. "Track in Business File" links to the real `/workspace/business-file` route and fires the new `documents_to_gather_tracked` analytics event. Cost signals: not built as a separate chip row — reuses the existing `PreparationCostBadge`/document-cost-tier machinery already applied to documents elsewhere in the report (same reasoning as the program-card row above). | lib/__tests__/report-documents-to-gather.test.ts (asserts against the real task registry's ids/titles/owner), render coverage in report-page-live-renderer.test.tsx (persona scoping), fork-parity in refine-tier1.test.ts | PASS |

## Judgment calls / deviations worth flagging explicitly

1. **Contact Sheet is additive, not exclusive.** A late amendment asked for
   Part 03 to contain the contact sheet ONLY (replacing the raw
   support-organizations section). This build renders ContactSheet
   alongside the existing support-organizations section rather than
   replacing it — both forks, both still lane-ranked/persona-ordered.
   Nothing is dropped either way; a follow-up can suppress the raw section
   once the contact sheet has been reviewed against real addresses.
2. **"all" persona keeps the flat kitchen sink.** Spec v2 says "GUIDEPOST
   ANATOMY on every persona view (never on 'all')" in the same document
   whose R5LookingFinal ("just looking") board shows guidepost bands. Since
   `PersonaId` maps "just looking" to the code id `"all"` (review finding
   #1, restated in the v2 amendment's own memory record) and `"all"` is
   architecturally the pure, unfiltered kitchen sink (`applyPersonaLens`
   returns the identical report reference for `"all"` — a contract
   multiple existing tests pin down), this build resolves the conflict in
   favor of the explicit textual rule: no guidepost, no Contact Sheet, no
   Programs-Matched-Here row on `"all"`. The bespoke "Looking" board layout
   (Location snapshot / civic representation / explore-by-interest / full
   picture) was not built as a fifth distinct layout — its content
   (persona re-selection, civic representation, switch-to-all) already
   exists via the chip row, the Civic Representation section, and the
   framed-link "switch to All" affordance.
3. **Civic Representation and Logistics Access turned out to be mostly
   already-computed data**, not the from-scratch geodata pipelines first
   assumed — `DistrictData` (ward/alderperson/commissioner, each sourced,
   live) and `MobilityAccess` (CTA/Metra/bus/bike/expressway/airport/
   freight) already existed in lib/report-engine.ts, just folded into
   single summary items inside Site Facts. Both were promoted to genuine,
   real, sourced, canonical sections. Police district was the one true gap
   — closed in this session by adding a live query against the City's
   boundary layer (lib/district-lookup.ts `queryPoliceDistrict`), the same
   pattern the ward lookup already used; no committed boundary file, no
   client-side geometry, verified against a known address and against the
   dataset's own district count. County commissioner district was already
   live before this session. Cook County commissioner-district BOUNDARY
   data (as opposed to the officials roster, which is live) is the one
   remaining honest gap: no current boundary dataset surfaced in a targeted
   search of the Cook County open-data catalog (only "Historical"/
   "Archived" resources) — but `districts.commissionerDistrict` itself is
   already resolved live via the Cook County ArcGIS political-boundary
   service, so this only means "a candidate second boundary source wasn't
   found," not "commissioner district is missing."
4. **Coordinator amendments kept arriving throughout implementation**
   (roughly a dozen, escalating from the v1 hard-filter ruling through
   guidepost anatomy, program-card anatomy, charts, civic representation,
   a "Documents to Gather" section, cost-signal chips, and finally a
   multi-round "Brief" half-pager with its own intake question and QR
   code). Past a certain point this build stopped chasing every new
   amendment in order to actually finish, test, and ship a coherent
   increment — everything not built is listed above with its reason, not
   silently dropped.
