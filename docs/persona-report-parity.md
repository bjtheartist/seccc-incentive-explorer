# Persona report parity — element inventory (spec v2)

Source of truth: the four R5 board files in `scratchpad/persona-mocks/`
(R5OwnerFinal, R5SupporterFinal, R5DeveloperFinal, R5LookingFinal). Each row
maps one board element to where it lives in the implementation and how it's
verified. Status is PASS, INTENTIONAL-DIFF (with a reason class a-d from
spec v2), or DEFERRED (not built this session — reason given; not one of the
four permitted classes, called out honestly rather than mis-filed).

Escape hatch (spec v2): parity is complete when every unresolved row is class
(a)-(d). This build additionally uses DEFERRED for the civic-representation
data input, which needs a real, sourced boundary dataset this offline build
session could not responsibly fabricate — see that section.

## Header / Executive Summary panel

| Board element | Locus | Verification | Status |
|---|---|---|---|
| "Location report · {persona}" eyebrow + "Viewing as {persona}" chip | shared header block, both forks | existing PersonaChips + header render | PASS |
| Address / goal line | existing report header | existing | PASS |
| Executive Summary label row | disclosure panel, both forks | `report-page-live-renderer` / new snapshot test | PASS |
| Glance tiles: Zoning / Mapped zones / Programs / Data verified | disclosure panel | new test asserting tile values | PASS |
| "Programs matched here" row — names as anchor links to cards, "— details below" | disclosure panel | new test: panel names ≡ rendered card set, in order | PASS |
| Screening sentence ("not an eligibility determination... confirm with ZBA") | disclosure panel | floor-suite test (non-suppressible) | PASS |
| just-looking: panel doubles as snapshot, uses notable-programs set | disclosure panel, persona="all" path | same component, `all`-branch test | INTENTIONAL-DIFF (d) — "all" keeps the pre-existing flat kitchen-sink render (no guidepost bands) per spec v2's own "guidepost never on all" rule, which supersedes the Looking board's use of guidepost bands; the panel row itself still renders on "all" | 

## Guidepost anatomy (PART 01/02/03 bands)

| Board element | Locus | Verification | Status |
|---|---|---|---|
| PART 01/02/03 black bands + serif titles + rule | `PersonaGuidepostBand` shared component | render test, both forks | PASS (starting/growing/supporter/developer only — never on "all", matching spec v2 text) |
| Part boundaries fixed regardless of persona | `lib/report-personas.ts` PART_BUCKET map | order-map test | PASS |

## Part 01 — Site & Standing (owner/developer show Site facts; supporter/looking show Neighborhood context)

| Board element | Locus | Verification | Status |
|---|---|---|---|
| Site facts (PIN/class/lot/building/county record/tax code) | existing `Site Facts` section (report-engine) | existing | PASS (owner, developer) |
| Neighborhood context section | existing `Neighborhood Economic Context` section | existing, reordered into Part 01 for supporter | PASS |
| Logistics access (L, bus, expressway, airports, Metra) | NEW `buildLogisticsAccessSection` | new unit test + fixture | PASS (owner, developer) — truck-route line cut per spec (no source) |
| Civic representation (ward/alder, CA, police district, SSA, county district) | NEW data input + `buildCivicRepresentationSection` | generator script + point-in-polygon test | DEFERRED — no committed, sourced ward/police-district/county-commissioner boundary dataset exists in this repo or was fetchable in this offline session; fabricating boundaries/alderperson names would violate the product's core no-fabrication rule. Section omitted entirely (not a placeholder) until a sourced dataset lands. |
| Zoning (code + district family + authority line + handoff button, LAST in part 01) | `ZoningStarterHandoff` shared component (A2/A3 extraction) | `zoneClass-never-without-detail` test + fork-parity | PASS |

## Part 02 — Capital & Programs

| Board element | Locus | Verification | Status |
|---|---|---|---|
| Program card: header (name, administrator, type pill, status/window pill) | existing item render + `programReportItem` fields | existing | PASS |
| Glance row (Amount / Type / Window / Decision-by) | existing item fields (value/detail) | existing | PASS |
| What-it-funds sentence | existing `detail` | existing | PASS |
| "Commonly required" list + administrator-confirms footer | existing `eligibilityRules` render | existing | PASS |
| "Why this is shown" reason chips | existing `matchExplanation` / `whyOneLine` render | existing | PASS |
| "Can combine with" + caveat | existing stacking-analysis data where present | existing | INTENTIONAL-DIFF (b) — only rendered where the engine already has a stacking rule for the program; not fabricated for the rest |
| "What to expect" (competitive · duration · reimbursement) | NEW `expectations` field, `ProgramCardExpectations` block | floor-suite test (non-suppressible when field present) | PASS where the program record carries `expectations`; INTENTIONAL-DIFF (a) elsewhere — full content population across the catalog is future work, tracked in `lib/program-types.ts` schema comment |
| Next step + contact | existing `applicationPortals` / contact render | existing | PASS |
| "Verify at the source" block (dated program rules, official page, district profile) + "every figure traces to a public record" | NEW `verifySources`, `VerifyAtSourceBlock` | floor-suite test (non-suppressible) | PASS where `sourceUrl`/`lastVerifiedAt` present (existing fields feed it); full multi-link `verifySources[]` population is INTENTIONAL-DIFF (a) |
| Sibling collapsed rows w/ reason pills | existing goal-match/other-confirmed items | existing | PASS |
| ONE "Also at this address (N)" line | `applyPersonaLens` hard filter | `report-personas.test.ts` | PASS |
| No timeline diagram anywhere | (absence) | grep-based lint/test asserting no timeline component import in program card path | PASS |
| TIF/negotiated-capital: authorized ≠ promised nouns, but-for line, ward office entry point | existing TIF item copy (`lib/report-engine.ts` TIF enrichment) | existing | PASS (copy already uses "authorized"; ward-office line added) |
| Chart: Owner funding-window intervals (amber <60 days) | NEW `FundingWindowChart` from `sbif-rollout.json` + program deadlines | renders-nothing-when-no-data test | PASS |
| Chart: Supporter corridor investment-by-year | NEW `CorridorInvestmentChart` from community-investment per-CA export | renders-nothing-when-no-data test | DEFERRED — `data/private/community-investment.json` is a private-tier dataset; wiring a public report chart to it needs a public export step this session did not build. No chart renders (no empty shell) rather than reading the private file from a public surface. |
| Chart: Developer incentive-horizon (TIF/OZ terms) | NEW `IncentiveHorizonChart` from `tif-financials.json` + OZ term data | renders-nothing-when-no-data test | PASS where TIF expiration data exists for the address; renders nothing otherwise |
| Chart: Just-looking program-mix bars | NEW `ProgramMixChart` | n/a | INTENTIONAL-DIFF (d) — "all" keeps the flat kitchen-sink render (see header row); no guidepost-scoped chart slot exists to mount it in |
| Financing resources | existing capital-partner section | existing | PASS |

## Part 03 — Partners & Next Steps

| Board element | Locus | Verification | Status |
|---|---|---|---|
| Local support (lane-ranked) | existing support-organizations section, NEW lane ranking | `report-personas.test.ts` | PASS |
| Contact sheet & next steps (program/org/capital contacts, numbered next steps) | NEW `ContactSheet` shared component | fork-parity + render test | PASS |
| Sources + vintage footer | existing `dataSources` + `generatedAt` | floor-suite test (non-suppressible) | PASS |

## Cross-cutting / floor items

| Item | Locus | Verification | Status |
|---|---|---|---|
| Hard filter: visible = goal-matched ∩ persona-tagged ∪ pinned overlays | `applyPersonaLens` | `report-personas.test.ts` | PASS |
| Section state keyed by section.id | both forks | existing test file extended | PASS |
| showPersonaLens derived from `derivePersonaLensVisible(wizardState)` everywhere | both forks + comparison view | `refine-tier1.test.ts` extended | PASS |
| Gate chip row, inferred, optional | `ReportEmailGate` | new test | PASS |
| Shared-link recipients never re-blocked; "Viewing as X — switch to All" affordance | `app/report/page.tsx` | new test | PASS |
| Zero inline persona branching in either fork | lib/report-personas.ts + shared components only | fork-parity grep test | PASS |
| zoneClass never renders without detail | `ZoningStarterHandoff` | new test | PASS |
| No ownership confidence on public/printed surfaces | unchanged (not touched) | existing `pdf-report-admin-ownership-exclusion.test.ts` | PASS (untouched) |

## Late amendments (received after the build was underway)

| Item | Locus | Verification | Status |
|---|---|---|---|
| "Documents to Gather" section (owner + supporter, first in Part 03) | would derive from Business File preparation-task defs + program requirements | floor-suite presence test | DEFERRED — arrived after Tier 1 (engine hard-filter, section-id state, share fix, supporter id, lane ranking, gate chips, share-link fix, contact sheet, A2/A3 zoning extraction) and Tier 2 core (executive-summary cross-links, guidepost bands, verify/expectations blocks, logistics access) were already committed to as this session's deliverable set. Not built this session — needs its own pass wiring the real Business File task registry and workspace route rather than inventing checklist copy. |
| Cost signals chips (`costSignals[]`, owner + supporter) | would extend the program schema again | floor-suite non-suppressible-caption test | DEFERRED — same reason; flagged for a follow-up session so the signal content is populated from real program-rules text per program rather than guessed under time pressure. |

## Data input: civic representation (ward / police district / county commissioner)

DEFERRED, whole feature. This needs a committed, provenance-tracked
boundary dataset (ward remap, police districts, county commissioner
districts) plus an alderperson roster, verified against real counts (50
wards, 22 police districts) — none of which exists in this repo and none of
which this offline build session could source without inventing coordinates
or names. Per the product's own no-fabrication doctrine (the same doctrine
that governs every other claim in this report), the section is omitted
entirely rather than shipped with placeholder or guessed data. Follow-up:
source ward-boundary GeoJSON + police-district GeoJSON + county-commissioner
districts from the City/County open-data portals, build the point-in-polygon
generator on the `scripts/sync-*`/`zones-check` pattern, and wire
`buildCivicRepresentationSection` (left as a documented no-op stub) once the
data lands.
