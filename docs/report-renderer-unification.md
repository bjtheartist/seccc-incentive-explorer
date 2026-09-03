# Report-renderer unification (RF2 / R4) — behavior inventory and merge plan

Companion to PR #251 ("R3: fork stabilization") and PR #258 (ratchet
hardening). #251 deliberately did *not* merge the two report renderers; it
made the debt measurable (`lib/source-guard/fork-similarity-ratchet.ts`,
baseline 1,275 duplicated lines across 22 blocks after #258 normalized the
metric), unified the analytics payload into `lib/report-generated-event.ts`,
and extracted the shared action rows. This round performs the merge.

The two forks:

| | file | consumers |
|---|---|---|
| **live fork** | `app/report/page.tsx`, private `function ReportDisplay` (L3799-5734) | `/report` — main render + two `compact` compare renders |
| **shared fork** | `components/report/ReportDisplay.tsx`, exported `ReportDisplay` | `/workspace/reports/[id]` (saved reports) |

**Survivor: `components/report/ReportDisplay.tsx`.** It is the exported,
directly-testable module; it already owns the analytics-parity contract
(`lib/__tests__/report-analytics-parity.test.ts`), the public-claim surface
list (`lib/public-claim-surfaces.ts`), the heavy-client boundary check, and
three component-level render tests. The live fork is a private function
inside a 5,700-line page whose only test reaches it through a seeded
`useState` ordinal harness. Deleting the private copy removes the fork; the
page imports the survivor and passes what makes `/report` different.

**The law for this round: zero behavior change visible to a reader on
either surface.** Every *visible* difference between the forks is therefore
kept per-surface behind a seam. Only *invisible* differences (analytics
payloads and event wiring, which `renderToStaticMarkup` cannot see and no
reader can) are resolved to one canonical answer.

---

## 1. Prop inventory

| prop | live fork | shared fork | resolution |
|---|---|---|---|
| `report` | yes | yes | same |
| `onStartOver` | yes | yes | same |
| `onRefine` | yes | yes | same |
| `onQuickRefine` | yes | no | **(b)** kept; optional, live-only |
| `quickRefineBusy` | yes | no | **(b)** kept; optional, live-only |
| `refineContext` | yes (`"instant" / "compare_a" / "compare_b"`) | no (derived `compact ? "compare_a" : "workspace"`) | **(b)** kept; default now derives per surface so both call sites keep today's value |
| `isInstantMode` | yes | yes | same |
| `showPersonaLens` | yes | yes | same |
| `persona` / `onPersonaSelect` | yes (controlled by `ReportWizardPage`) | no (own `useState` + mount `resolveInitialPersona`) | **(b)** controlled/uncontrolled seam — see section 4 |
| `wizardState` | yes | yes | same |
| `compact` | yes | yes | same |
| `onCompare` / `compareMode` / `compareAddressInput` / `setCompareAddressInput` / `compareGeocoding` / `onCompareGeocode` / `compareGeoResult` | yes | yes | same |
| `comparisonFailed` | yes | no | **(b)** kept; optional, live-only (compare is a live-only flow) |
| `analyticsSource` | default `"instant_report"` | default `"workspace"` | **(b)** default now derives from `surface` so both defaults survive |
| `surface` (**new**) | — | — | the one seam prop: `"live" | "saved"`, default `"saved"` |

`surface` is the only prop added. It is a mode prop by design: the two call
sites are genuinely two products (a live wizard result vs. a saved
snapshot), and the six visible differences below all fall out of that one
fact. Deriving them from one prop, in one commented block inside the
component, keeps them from drifting apart again — which six independent
booleans at two call sites would invite. The component derives, in one
place:

```
progressiveDisclosure   = surface === "live"    // 3.1
showAdminOwnership      = surface === "live"    // 3.2
elevateSupportNetwork   = surface === "live"    // 3.3 + 3.4
allowDownloadGateSkip   = surface === "live"    // 3.5
showWatchAreaAction     = surface === "saved"   // 3.6
```

---

## 2. Common structure (identical in both forks, no action)

Shared already, via imported components: `RefineValuePanel`,
`ReportActionButtons`, `StartHereCard`, `ActionRoadmapSection`,
`DownloadGateModal`/`EmailReportModal`, `ReportNavigationLinks`/
`FreshnessBadge`, `ExecutiveSummarySection`/`VerdictCard`/
`MatchExplanationDetails`, `useVacancySpreadsheetSection` +
`VacancySpreadsheetSection`, `NeighborhoodEconomics` (`AnchorCards`,
`ComparisonBar`, `EconomicSignalCards`, `visibleSectionItems`),
`ZoningReviewQuestions`, `ZoningStarterHandoff`, `PreparationCostBadge`,
`PersonaChips`, `ContactSheet`, `ContactSheetPointerRow`,
`ProgramCardExtras`, `ProgramRoutingCard`, `ReasonChips`,
`ProgramCardFace`, `LookingOverview` panels, `PersonaReportChrome`,
`PersonaSectionSupplements`, `BriefStageAsk`, `BriefPage`,
`GroupedReportDetail`, `CapitalPartnerHandoff`,
`StartPreparationPacketButton`, `SaveReportModal`, `ReportZoningMapIsland`.

Identical in both forks, line for line (the 1,275 lines the ratchet
measured): `sectionToAnchor` / `sectionStateKey`, `personaProgramsAnchor`,
`tocEntries`, the guidepost band tracker and `personaSectionCounter`, the
persona board header/summary/footer mounts, the whole section-item render
(program cards, accordions, navigation links, zoning handoff), the persona
"Also at this address" disclosure, the Contact Sheet mount and its ordinal,
the recommended-actions / data-sources tails, the Brief ask + overlay,
`handleDownloadAfterCapture`, `handleShareReport`, `briefReportUrl`,
`handleBriefComplete`, `handleEmailReportClick`, `priorityBadge`, and every
section id, `data-testid` and `aria-` attribute other than the ones named
in section 3.

Section ids (identical): `verdict`, `executive-summary`, `action-roadmap`,
`recommended-actions`, `data-sources`, `start-here`, `contact-sheet`,
`brief-overlay`, plus one per `report.sections` entry via `sectionToAnchor`
(id-first, `your-support-network` special-cased).

`data-testid` (identical): `persona-report-header`,
`persona-executive-summary`, `persona-report-footer`,
`persona-also-at-address`, `persona-also-program-list`,
`persona-summary-programs`, `guidepost-part-{1,2,3}`, `contact-sheet`,
`contact-sheet-pointer`, `program-card-face`, `reason-chips`,
`supporter-routing-card`, `supporter-routing-full-record`,
`program-routing-view-note`, `documents-to-gather`, `location-snapshot`,
`explore-by-interest`, `full-picture-line`, `brief-page`.

Persona / lens branches (identical): `showPersonaLens` gating of
`PersonaChips`; `showPersonaView = showPersonaLens && persona !== "all"`
driving the board layout; the four-part `guidepostPartForSection` band
walk; the `looking` board (`WhatsNotablePanel`, `ExploreByInterestPanel`);
the `supporter` routing-card variant and who-to-call pointer; the
Part-03 correction suppressing the raw support-organizations section on any
real persona.

---

## 3. Visible drift — kept per surface (classification **(b)**)

### 3.1 Progressive disclosure of report sections — live only

*Live:* `expandedSections` state, `ALWAYS_OPEN_SECTIONS` ("Programs Mapped
at This Address" + the support-organizations title),
`isSectionOpen(key, idx, title) = expandedSections[key] ?? (idx < 2 || ALWAYS_OPEN)`,
a `hashchange` effect that opens a section a TOC/deep link targets, a
`<button class="section-head ..." aria-expanded>` header carrying a
`Collapse` / `Expand - N` affordance, and `report-section-collapsed` on the
wrapper (styled in `app/globals.css:363`).

*Saved:* no disclosure state at all. Every section renders open, the header
is a plain `<div>` followed by an `<hr>`, and there is no expand
affordance.

Pinned live-side by `app/report/__tests__/report-page-live-renderer.test.tsx`
("opens the first two sections...", "collapses an ordinary section...").
Nothing pins the saved side, but the saved side is what a saved-report
reader sees today.

Kept behind `progressiveDisclosure`. The section number + title fragment is
shared between the two header variants so only the wrapper element differs.

### 3.2 Admin ownership context panel — live only

`extractReportZipCode` + three `useState`s + an `AbortController` effect
that probes the Owner Files admin session and mounts `<AdminOwnershipPanel>`
when `!showPersonaView && !compact`.

Kept behind `showAdminOwnership`, as a **boolean, not a slot**: the JSX is
eight lines but the state and effect are the bulk, and moving three
`useState` calls into a child component would move three ordinal slots out
of `ReportDisplay` and churn the seeded harness (section 7) for no
structural gain. The effect already early-returns on `compact || !reportZip`;
it now also early-returns when the surface is not live, so the saved
surface fires no probe — exactly as today.

### 3.3 Support-network hero band — live only

A `!showPersonaView && supportItems.length > 0 && !compact` band above the
TOC: eyebrow "Local support organizations", the section title,
`SUPPORT_ORGANIZATIONS_DESCRIPTION`, `SUPPORT_ORGANIZATIONS_CAPACITY_NOTE`,
an "N selected - ..." line, a "Visit {org}" CTA (`supportCtaItem` — the
first support item with a `sourceUrl`/`url`) and a "See all organizations"
anchor to `#your-support-network`.

Kept behind `elevateSupportNetwork`. Not a slot: it reads `supportItems` /
`supportCtaItem` / `trackSupportCtaClick`, all internal to the renderer, so
a caller-supplied node would need those threaded back out.

### 3.4 `VerdictPartnerStrip` — live only

A compact `data-tour="report-support"` strip under the verdict card ("Local
support to explore", up to three org chips, "See all"). Declared at
`app/report/page.tsx:3600`; moved verbatim into the survivor file as a
module-local component, on the same `elevateSupportNetwork` gate (both
blocks exist for one reason: elevate the support network on the live
report). Note it is also the `data-tour` anchor the spotlight tour targets.

### 3.5 `DownloadGateModal allowSkip` — live only

`components/report/ReportModals.tsx` already documents this as a live-fork
difference ("The live /report flow also passes allowSkip"). It changes the
modal's subtitle and adds a skip path.

Kept behind `allowDownloadGateSkip`.

### 3.6 `WatchAreaButton` in the action row's `afterSave` slot — **saved only**

The only place the *shared* fork is the richer one on screen: it renders
`StartPreparationPacketButton` **and** a `WatchAreaButton` (when
`metadata.lat`/`lon` are present); the live fork renders only the packet
button.

Kept behind `showWatchAreaAction`. This is arguably an unshipped live
feature rather than an intentional difference, but adding a button to
`/report` is a reader-visible change and out of scope for this round. See
section 6.

### 3.7 Compare-generation failure card — live only

`{compareMode && comparisonFailed && ...}` renders
`data-testid="comparison-generation-error"` with
`REPORT_GENERATION_FAILURE_COPY.comparison`. Compare mode only exists on
`/report`; the prop is optional and the saved surface never sets it, so no
gate beyond the existing `compareMode &&` is needed.

### 3.8 Quick refine — live only

`RefineValuePanel` gets `onQuickRefine` / `quickRefineBusy` on the live
fork only. Optional props; the saved surface passes neither, as today.

---

## 4. Persona ownership — controlled / uncontrolled seam

*Live:* `persona` and `handlePersonaSelect` live in `ReportWizardPage`
(lifted there in the gate-persona-lens-sunset round so `ReportEmailGate`, a
**sibling** of the renderer, can commit a persona). The renderer takes them
as props.

*Saved:* the renderer owns
`const [persona, setPersona] = useState(DEFAULT_PERSONA)` plus a mount
effect calling `resolveInitialPersona(window.location.search)`, and
`handlePersonaSelect` calls `storePersona(next)`.

The survivor supports both: it always calls `useState` + the resolve effect
(hooks stay unconditional), and uses the `persona` prop when one is
supplied. When `persona` is `undefined` the local value wins and the mount
effect resolves it; when it is supplied the effect is inert and selection
delegates to `onPersonaSelect`. `/workspace/reports/[id]` is unchanged and
passes neither.

---

## 5. Invisible drift — resolved to one answer (classification **(a)**)

Per #251's analytics doctrine ("instrumentation added to one report
renderer must be mirrored into the other... an event on only one of them
makes the funnel depend on which surface the user happened to be on"), the
*richer* side wins in every case. None of these are rendered — event
handlers are not serialized by `renderToStaticMarkup` — so no reader sees a
change.

| # | drift | winner | effect |
|---|---|---|---|
| 1 | `originSource: analyticsSource` on `support_resource_viewed`, `support_resource_clicked`, `capital_partner_clicked` | **shared fork** | live events now carry `originSource` |
| 2 | support-view dedupe key includes the analytics source | **shared fork** | a live report viewed from two entry points is counted once per source, as saved reports already were |
| 3 | `onClick={() => trackSupportResourceClick(item)}` on the in-section support-org website link | **shared fork** | `/report` now fires `support_resource_clicked` from the section link; it previously fired only from the hero CTA and the verdict strip |
| 4 | `ActionRoadmapSection onContactClick` -> `support_resource_clicked` with `organizationName`/`organizationType`/`contactMethod`/`programId`/`programName` | **live fork** | saved reports now record roadmap phone/email clicks |
| 5 | `trackSupportCtaClick` (hero-band CTA) | **live fork** | live-only by construction — the block it serves is live-only (3.3) |

Analytics helper functions (`analyticsReportKey`, `reportAnalyticsPayload`)
already come from `lib/report-generated-event.ts` in both forks (#251), so
there is nothing to merge there.

---

## 6. Findings: dead code and latent bugs (recorded; fixed only where the merge required it)

1. **The shared fork's `<details>`/`<summary>` section wrapper is
   unreachable.** `Wrapper = !showPersonaView && section.collapsedByPersona ? "details" : "div"`.
   `collapsedByPersona` is set only by `applyPersonaLens`
   (`lib/report-personas.ts:974`), which only runs when `showPersonaLens`
   is true; and `applyPersonaLens(report, "all")` returns the identical
   report reference, so a section can only carry the flag when
   `persona !== "all"` — i.e. exactly when `showPersonaView` is true. The
   `details` branch, its `<summary>` ("{title} - {N} more"), its
   `persona-collapsed` class and its `onToggle` -> `section_expanded` event
   are therefore dead on every reachable input. **Removed as part of the
   merge** (required: the two header variants cannot both be expressed
   without deciding what the dead branch means).
2. **The live fork carries the same dead condition** in `sectionOpen`:
   `section.collapsedByPersona ? (expandedSections[key] ?? false) : ...`.
   Unreachable for the same reason. Kept as-is inside the merged
   `progressiveDisclosure` branch — removing it is not required to unify
   and it is the live fork's shipped expression.
3. **`report-section` wrapper class had a trailing space on the saved
   surface** (a three-slot template literal whose third slot was empty).
   Normalized away by the merge. Not reader-visible; noted for byte-diff
   reviewers.
4. **`WatchAreaButton` is missing from `/report`** (3.6). Almost certainly
   an unmirrored feature rather than a decision, but shipping it to
   `/report` is a visible change. Left alone; recorded as the one open
   parity item after this round.
5. **`data-persona-section-open`** is `"true"` (string literal) on the
   saved fork and `{sectionOpen}` (boolean `true`) on the live fork. React
   serializes both to `data-persona-section-open="true"`, so the merged
   boolean expression is byte-identical on both surfaces.

---

## 7. Harness and guard consequences

* `app/report/__tests__/report-page-live-renderer.test.tsx` seeds `useState`
  by ordinal across `ReportWizardPage` -> `ReportDisplay`, deriving the real
  order from source via `lib/source-guard/react-state-order.ts`.
  `ReportDisplay` no longer lives in `app/report/page.tsx`, so
  `STATE_ORDER_TARGETS`' second entry moves to
  `components/report/ReportDisplay.tsx`. The slot order is otherwise
  preserved, with one addition: the survivor's uncontrolled-persona
  `useState` (section 4), seeded to `DEFAULT_PERSONA` and inert under the
  page's controlled persona. `REPORT_WIZARD_PAGE_STATE_ORDER` is unchanged.
* `lib/source-guard/fork-parity.ts` and
  `lib/source-guard/fork-similarity-ratchet.ts` both name two fork files.
  With one renderer left they measure a fork that no longer exists. The
  ratchet is retired in place (baseline 0, with a dated note, and the
  "collapse to zero while both forks exist" guard inverted into "the fork
  is gone and must not come back") rather than deleted, so a re-fork lands
  red.
* The "both forks ..." source-grep suites
  (`lib/__tests__/refine-tier1.test.ts`,
  `lib/__tests__/shared-link-recipient.test.ts`,
  `lib/__tests__/zoning-starter-handoff-parity.test.ts`,
  `components/report/__tests__/download-promise-safety-fence.test.ts`,
  `lib/__tests__/report-analytics-parity.test.ts`) each read both fork files
  and assert the same string is present in both. Every assertion is kept,
  applied once, against the survivor.
