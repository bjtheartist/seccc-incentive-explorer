# Persona report final-surface design QA

## Comparison target

- Source visual truth path: `/var/folders/4d/ndgly42d1r10xqn5q1xd_j140000gp/T/codex-clipboard-05286c9e-1480-4aee-b83f-3a7b4f4d7b93.png`
- Implementation route: `http://localhost:3101/report?wv=2&rt=si&addr=100%20E%20Test%20St&lat=41.75000&lon=-87.60000&pt=rehab&pg=WyJyZWhhYiJd&persona=starting`
- Collapsed implementation screenshot: `output/browser/persona-other-incentives-collapsed.png`
- Expanded implementation screenshot: `output/browser/persona-other-incentives-open.png`
- Document-readiness screenshot: `output/browser/persona-document-readiness.png`
- Contact-sheet screenshot: `output/browser/persona-contact-sheet-all-groups.png`
- Side-by-side comparison: `output/browser/persona-disclosure-comparison.png`
- Viewport: 1454 x 670 CSS px, desktop, light theme.
- Pixel dimensions and density: source 1454 x 670 px; implementation 1454 x 670 px; both compared at equal 1x pixel dimensions with no resize normalization.
- State: Business owner persona; real report engine and catalog; outer “Also at this address” disclosure collapsed for the direct comparison, then open with one nested program menu expanded for interaction evidence.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the existing editorial, sans, and Bureau-mono hierarchy is preserved. Program names, jurisdiction labels, review-state copy, and micro-label tracking follow the source’s weight and density.
- Spacing and layout rhythm: the disclosure keeps the source’s full-width border, compact summary row, left chevron, and program-list rhythm. Nested program bodies align with the existing report grid and do not overflow the desktop viewport.
- Colors and visual tokens: navy text, cool-gray borders, blue evidence blocks, and off-white page background reuse the report’s existing tokens. No new competing surface treatment was introduced.
- Image quality and asset fidelity: this report region contains no source photography or illustration. The disclosure uses the project’s existing Lucide icon library; no placeholder, handcrafted SVG, emoji, or CSS-drawn asset was substituted.
- Copy and content: “Also at this address,” “Why this is here,” and the Financial / Program / Community resource labels are direct, specific, and source-faithful. Real program names and published-document language are rendered rather than mock data.
- Affordance and accessibility: native `details` / `summary` semantics preserve keyboard operation. Each nested program opens independently, and the full program detail is reachable without leaving the report.

The blue rectangle visible around the last automated target in some captures is the in-app browser’s inspection overlay, not an application style.

## Full-view comparison evidence

`output/browser/persona-disclosure-comparison.png` places the equal-size source and implementation captures in one image. The collapsed disclosure preserves the source’s location, border treatment, chevron position, label hierarchy, and restrained density. Surrounding content differs because the implementation uses the real current catalog and the new program-linked readiness section, not the screenshot’s older sample data.

## Focused-region evidence

- `output/browser/persona-other-incentives-open.png` shows one nested program expanded with full administrator, status, window, decision-maker, funding, requirements, and verification details.
- `output/browser/persona-document-readiness.png` shows exact published document rows, each with an explicit “Why this is here” explanation and surfaced-program attribution.
- `output/browser/persona-contact-sheet-all-groups.png` shows Financial resources, Program resources, and Community resources as separate labeled lanes.

## Interaction and runtime checks

- Outer additional-program disclosure starts closed.
- All 16 nested program menus started closed in the first real route; the rehab route rendered 17 additional programs.
- Opening the first nested menu left the second closed.
- Opening the second left the first open; closing the first left the second open.
- Expanded content included the full published program detail and verification links.
- Eleven readiness rows resolved to the same three programs named in the summary.
- The rehab route rendered all three contact-resource categories.
- Browser console errors checked: none.

## Comparison history

- Pass 1: no P0/P1/P2 visual mismatch was found, so no corrective design iteration was required. The direct collapsed-state comparison and the separate expanded-state capture both passed.

## Implementation checklist

- [x] Match the source disclosure’s visual language.
- [x] Add independent full-detail menus for every additional program.
- [x] Tie document readiness to surfaced programs and explain why each row appears.
- [x] Separate contact resources into Financial, Program, and Community groups.
- [x] Verify real-route interactions, responsive containment, and console health.

## Follow-up polish

No P3 follow-up is required for this scope.

final result: passed
---

# Strategic Neighborhood Permit MVP — Final QA

## Comparison target

- Approved visual truth: `mockups/screenshots/permit-activity-desktop-1487x1058.png`
- Current implementation viewport: `output/browser/permit-strategic-mvp-viewport-1487x1058.png`
- Side-by-side comparison input: `output/browser/permit-strategic-source-vs-mvp-viewport.png` (approved source left, implementation right)
- Mobile top and ledger captures: `output/browser/permit-strategic-mvp-mobile-390x844.png` and `output/browser/permit-strategic-mvp-mobile-ledger-390x844.png`
- Route: `/permit-activity/chatham`, with command navigation verified against `/permit-activity/o-hare`.

The local design pass used a temporary, non-committed ready-state response so the complete hierarchy could be inspected without a local database connection. It retained the previously observed real Chatham aggregate totals (5,222 geocoded filings, 2,529 grouped source addresses, August 3, 2026 latest filing, and the reconciled annual/type totals); the new rolling, monthly, address-concentration, and record rows were coherent QA values, not publisher claims. The temporary response was removed before final tests and commit. Production values remain query-derived by the tested permit-area endpoint.

## Findings

No actionable P0, P1, or P2 issue remains.

- The approved Explorer visual language is preserved: Playfair Display report headline, Inter body copy, JetBrains Mono evidence labels, warm paper, navy rules, source blue, square controls, and compact tables.
- The content is reorganized into the confirmed decision order: neighborhood command, recent pulse, interpretation, 36-month momentum, filing-type drivers, grouped-address concentration, recent records, then methods and caveats.
- The database timestamp is labeled as the Explorer load time rather than City publisher freshness.
- Rolling comparisons expose exact inclusive dates and keep valid zero, unavailable, malformed, loading, and truncated-record states distinct.
- Address counts and shares are described as case- and punctuation-insensitive source-address groups. Repeated filings are not presented as distinct projects.
- No activity score, reported-cost total, construction-progress claim, occupancy claim, completion claim, or neighborhood-performance ranking appears.

## Comparison and responsive evidence

- Desktop measured `scrollWidth === innerWidth === 1487` at the approved 1487 × 1058 CSS-pixel viewport.
- Mobile measured `scrollWidth === innerWidth === 390` at 390 × 844 CSS pixels.
- The desktop comparison confirms the same header/tabs, editorial headline, four-cell evidence strip, ruled analysis panels, source chips, and dense record grammar. The longer page is intentional: the 36-month trend, address concentration, and methods disclosure add decision evidence below the original one-screen board.
- Mobile retains a two-by-two pulse ledger, full-width neighborhood command, internally scrollable monthly plot, stacked driver panels, labeled record cards, and no horizontal clipping.

## Interaction and state checks

- The selector exposes all 77 canonical community areas; selecting O'Hare routed to `/permit-activity/o-hare`, updated the heading, and retained the canonical `o-hare` value.
- Selecting a monthly mark updated the live status to its exact month and filing count.
- Permit-record and official-source dialogs opened, exposed only contract-approved fields/links, and closed correctly.
- The native “About this analysis” disclosure opened with recorded status, coverage/data quality, zero-versus-unavailable semantics, and interpretive limits.
- The CSV action enabled only for a valid parsed result; unit coverage confirms rolling windows, monthly counts, grouped addresses, explicit denominators, and the absence of cost fields.
- Browser console review found no application error. Development-only React/HMR/Analytics notices were informational.

## Comparison history

1. The first 390 px ledger capture showed the table caption constrained to a narrow table-caption column (P2).
   - Fix: made the responsive caption a full-width block when the record table changes to stacked cards.
   - Post-fix evidence: `output/browser/permit-strategic-mvp-mobile-ledger-390x844.png`.
2. Provenance review found the UI calling `MAX(fetched_at)` “Source refreshed,” which could be mistaken for publisher freshness (P2 copy risk).
   - Fix: relabeled it “Explorer loaded” in the UI and “Explorer load timestamp” in the CSV.

## Verification

- Strategic permit, boundary, map-integration, and public-claim registry suites: 144 tests passed.
- TypeScript: passed.
- ESLint: zero errors; nine unrelated pre-existing warnings remain.
- Next.js production build: passed; 331 static pages generated and `/permit-activity/[area]` emitted as a dynamic route.
- The full repository run reached 4,812 passing tests and surfaced unrelated baseline failures in existing shortlist dependency, investment-integrity, and timeout-heavy guards; the newly registered permit public surface was fixed and its 54-test registry suite passed independently.

final result: passed

# Real Community Investment Route — Evidence-Brief Parity QA

## Comparison target

- Source visual truth: `mockups/screenshots/public-investment-desktop-1487x1058.png`
- Browser-rendered implementation: `output/browser/investment-evidence-brief-desktop-1487x1058.png`
- Mobile implementation: `output/browser/investment-evidence-brief-mobile-390x844.png`
- Viewport normalization:
  - Desktop source and implementation: 1487 × 1058 CSS px, 1487 × 1058 image px, device scale factor 1.
  - Mobile implementation: 390 × 844 CSS px, 390 × 844 image px, device scale factor 1.
- State: authenticated `/investment/Chatham`, real committed export generated August 13, 2026.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- The live route intentionally retains the Explorer global header, authenticated working-session controls, and the detailed source-record sections below the evidence brief. These are product requirements absent from the isolated illustrative board.
- The live section title is “Key capital instruments” rather than assigning one date range to all six values. This is source-honest: award and non-grant capital classes have different coverage windows.

## Required fidelity surfaces

- Fonts and typography: Playfair Display, Inter, and JetBrains Mono preserve the source hierarchy. The desktop title stays on one line at the reference viewport and wraps cleanly on mobile.
- Spacing and layout rhythm: the wide evidence frame, scope statement, six-cell metric ledger, three analysis columns, square rules, and compact metadata match the source direction. The longer page below is intentional record-explorer content.
- Colors and visual tokens: warm paper `#FAF9F6`, navy `#0C1B33`, blue `#2563EB`, one-pixel rules, and restrained source-state accents map directly to the approved board and existing Explorer system.
- Image and icon fidelity: the screen has no photographic assets. Capital, info, navigation, pin, and Sankey-disclosure controls use Lucide icons; no new text glyph or hand-drawn icon substitute remains in the parity work.
- Copy and content: every visible amount is produced by the live community analysis. Awarded grants, authorized TIF, federal program commitments, community-sited state appropriations, tax-credit capital, and announced private capital remain non-additive. Corporate giving, when present, stays inside awarded grants and separate from private development.

## Full-view and focused comparison evidence

- Full view: `output/browser/investment-evidence-brief-comparison.png`
- Focused top region: `output/browser/investment-evidence-brief-top-comparison.png`

The equal-size paired comparison confirms the same report hierarchy, scope-box proportion, six-column metric grammar, evidence panels, square controls, palette, and density. Focused review confirms that real values and absent-value language remain legible without changing their source meaning.

## Interaction and runtime checks

- Dollar/count trend toggle changed `aria-pressed` from Dollars to Count and exposed the count chart.
- The “Explore funding paths (Sankey)” disclosure opened independently and exposed the real Sankey image/accessible description.
- The existing searchable funder-flow table remains the default record view.
- Browser console errors checked: none.
- Focused tests: 20 passed across the route scope guards, evidence-summary contract, charts, flow-purpose filter, and investment UX suite.
- TypeScript and scoped ESLint checks passed.

## Responsive evidence

- Desktop measured `scrollWidth === innerWidth === 1487`.
- Mobile measured `scrollWidth === innerWidth === 390`.
- The mobile capital ledger renders as two 181.5 px columns, the hero/scope/actions stack, and the analysis panels collapse to one column without horizontal overflow.

## Comparison history

1. Pass 1 found the live title wrapping to two lines at 1487 px, materially changing the source hierarchy (P2).
   - Fix: reduced the responsive display ceiling and widened the available title line while preserving the editorial typeface.
   - Post-fix evidence: `output/browser/investment-evidence-brief-desktop-1487x1058.png`; the title now holds one line.
2. Mobile review found the six metrics stacking one per row instead of following the source’s compact two-column rhythm (P2).
   - Fix: made the metric ledger two columns at the base breakpoint, three at large, and six at extra-large.
   - Post-fix evidence: `output/browser/investment-evidence-brief-mobile-390x844.png`; two columns render with no overflow.
3. Asset review found text glyphs in the live parity actions/disclosure (P2 under the selected build constraint).
   - Fix: replaced them with Lucide ArrowLeft, ArrowRight, Star, and Network icons.
   - Post-fix evidence: the final desktop capture and zero scoped lint errors.

## Follow-up polish

- P3: the existing global concierge launcher can temporarily overlap the bottom-left content edge on a 390 px viewport. It is pre-existing app chrome and does not block scrolling or the investment controls.

final result: passed

---

# Production Neighborhood Permit Brief — Integration QA

## Comparison target

- Approved visual truth: `mockups/screenshots/permit-activity-desktop-1487x1058.png`
- Source-backed browser render: `output/browser/permit-chatham-live-desktop-1487x1058.png`
- Combined comparison input: `output/browser/permit-source-vs-live-desktop.jpg` (approved source left, implementation right)
- Responsive render: `output/browser/permit-chatham-live-mobile-390x844.png`
- State: `/permit-activity/chatham`, official Community Area 44 boundary, live Chicago Building Permits data, August 24, 2026.

## Findings

No actionable P0, P1, or P2 visual differences remain. The implemented page preserves the approved evidence-brief hierarchy while replacing every illustrative value with a validated source response. The live check returned 5,222 geocoded filings, 2,529 normalized source addresses, an August 3, 2026 latest filing, and an August 4, 2026 source refresh.

- Fonts and typography: Playfair Display, Inter, and JetBrains Mono retain the approved headline, body, metadata, and tabular hierarchy.
- Spacing and layout rhythm: the tab bar, trust statement, four-cell metric strip, three-column analysis band, record/quality ledger, interpretation strip, and action bar preserve the approved square-panel composition.
- Colors and visual tokens: warm paper, navy, source blue, restrained rules, and green quality markers use the approved Explorer palette.
- Image and icon fidelity: the brief requires no photography or illustration. Check, information, refresh, external-link, and close actions use Lucide icons; no placeholder or handcrafted visual asset is present.
- Copy and content: the production language removes all illustrative-sample claims, identifies the official community-area boundary, preserves distinct aggregate and recent-record denominators, and never infers project value, completion, occupancy, or compliance.

## Full-view and focused comparison evidence

The combined comparison places the approved board and source-backed implementation in one image for direct review. The live page intentionally accommodates twelve years of annual values and the source's actual filing/status categories while retaining the same panel roles, reading order, density, border treatment, and action hierarchy.

The mobile capture closes the earlier production-integration gap: at 390 × 844 CSS px the metrics form a two-column ledger, evidence panels stack in reading order, record rows gain visible labels, and no content is clipped horizontally.

## Boundary, data-state, and interaction checks

- All 77 canonical neighborhood slugs resolve to City-published community-area geometry.
- Polygon and MultiPolygon geometries are accepted; detached pieces are preserved for multipart boundaries such as O'Hare.
- The largest committed official boundary has 2,424 positions and remains below the guarded 5,000-position API limit.
- Neighborhood geometry is carried in a JSON POST body so official boundaries do not exceed HTTP request-line limits. The existing GET contract remains available for the drawn-area tool.
- Chatham's source-backed ready state reconciled 5,222 annual, filing-type, and status records.
- Ready, valid zero, unavailable, malformed, and truncated-record states remain distinct; charts are withheld for unavailable or malformed responses instead of substituting zero.
- Annual bars and horizontal marks are keyboard-focusable and expose exact counts and shares.
- The permit-record and source-verification dialogs open and expose only contract-approved fields and official publisher links.
- The CSV brief keeps aggregate and recent-record denominators explicit and contains no project-cost field.
- Desktop measured `scrollWidth === innerWidth === 1487`; mobile measured `scrollWidth === innerWidth === 390`.
- Browser console review found no application error; development-only Fast Refresh notices were excluded.

## Comparison history

1. Initial local integration correctly rendered unavailable-state semantics but could not reach the API because a serialized official boundary exceeded the local server request-line limit before route execution (P1 functional integration issue).
   - Fix: added a body-carried POST contract for neighborhood analysis while retaining the existing GET contract.
   - Post-fix evidence: Chatham rendered the complete source-backed ready state with reconciled values.
2. Mobile review confirmed the production route at 390 px and closed the saved-capture gap from the illustrative mockup QA.
3. Semantic review found and removed a nested `main` landmark and changed the permanent failure-state metadata from “Loading” to “Unavailable.”

## Verification

- Focused production-scope suite: 142 tests passed.
- TypeScript: passed.
- ESLint: passed with zero errors; nine warnings are pre-existing outside this scope.
- Next.js production build: passed; 331 static pages generated and `/permit-activity/[area]` emitted as a dynamic route.

final result: passed

---

# Explorer Analysis Mockups — Design QA

## Comparison target

- Source visual truth: `/Users/billyndizeye/Downloads/Explorer-analysis-handoff-2026-08-23.zip`
  - `public-investment-approved.png`
  - `permit-activity-approved.png`
  - `explorer-report-style-reference.png`
- Implementations:
  - `mockups/R7PublicInvestmentAnalysis.html`
  - `mockups/R7PermitActivityAnalysis.html`
- Browser-rendered implementation captures:
  - `mockups/screenshots/public-investment-desktop-1487x1058.png`
  - `mockups/screenshots/permit-activity-desktop-1487x1058.png`
  - `mockups/screenshots/public-investment-mobile-390x844.png`
- Viewports and normalization:
  - Desktop reference and implementation: 1487 × 1058 CSS px, 1487 × 1058 image px, device scale factor 1.
  - Mobile implementation: 390 × 844 CSS px, 390 × 844 image px, device scale factor 1.
- State: default ready state, Chatham, illustrative sample data, report date August 23, 2026.

## Findings

- No actionable P0, P1, or P2 visual differences remain.
- The implementation intentionally differs from the approved Public Investment image in three source-contract areas required by the handoff: it shows all six capital classes including federal program commitments, keeps government as one supported awarded-grant category, and calculates the top-three philanthropic recipient share as $28.0M ÷ $42.7M = 65.6%.
- A behavior audit found that `unavailable` and `malformed` permit responses initially shared one message. The implementation now gives each state distinct copy while withholding charts in both cases; valid zero remains separate, and truncation remains explicit in the recent-record ledger.

## Required fidelity surfaces

- Fonts and typography: Playfair Display carries the report headlines, Inter carries body and table copy, and JetBrains Mono carries labels and metadata. Hierarchy, uppercase tracking, wrapping, and compact table density preserve the source system.
- Spacing and layout rhythm: square panels, one-pixel rules, restrained gaps, compact desktop density, and footer action bars match the evidence-brief language. Pass 2 keeps the full desktop action bars visible.
- Colors and visual tokens: warm paper `#FAF9F6`, navy `#0C1B33`, and blue `#2563EB` map directly to the existing Explorer palette. Status green is limited to source-quality confirmation.
- Image quality and asset fidelity: these analysis boards do not require photographic or illustrative imagery. Capital, info, status, external-link, and close controls use the Lucide icon library; no custom inline SVG or placeholder imagery is used.
- Copy and content: all visible metrics are labeled as illustrative samples. Award timing is not presented as receipt or expenditure. Permit activity is not presented as project value, progress, occupancy, or compliance. Distinct denominators and source caveats stay visible.

## Full-view comparison evidence

- `mockups/screenshots/public-investment-comparison.png`
- `mockups/screenshots/permit-activity-comparison.png`

The paired images place the approved reference and the browser-rendered HTML at equal pixel dimensions. Overall composition, hierarchy, three-column evidence structure, square controls, palette, dense tabular treatment, caveat strips, and action bars remain aligned.

## Focused comparison evidence

- `mockups/screenshots/public-investment-top-detail.png`
- `mockups/screenshots/public-investment-lower-detail.png`
- `mockups/screenshots/permit-activity-top-detail.png`
- `mockups/screenshots/permit-activity-lower-detail.png`

These crops make the headline scale, capital metrics, chart/table alignment, caveat treatments, ledger density, interpretation copy, and footer controls readable at 1:1 source/implementation scale.

## Interaction and accessibility checks

- Tabs navigate between both briefs and retain the `brief` query parameter.
- Every chart mark is a native keyboard-focusable button with an exact-value accessible label and an `aria-live` status target.
- Recipient/funder switching updates `aria-selected` and the visible table.
- Source, methodology, and permit-record dialogs open, focus their close control, populate the allowed fields, and close.
- Both plain-text brief downloads produce the expected filenames.
- Official publisher links use `target="_blank"` and `rel="noreferrer"`.
- Permit `ready`, `zero`, `unavailable`, `malformed`, and truncated-ledger states stay semantically distinct.
- Focus-visible styling, a skip link, semantic headings/tables, dialog labels, 44 px minimum interactive marks, and reduced-motion handling are present.
- JavaScript syntax and DOM interaction tests passed. All annual, funder, permit-type, status, and concentration denominators reconcile.

## Responsive evidence

- Public Investment at 390 × 844 measured `scrollWidth === innerWidth === 390`; the header, tabs, scope statement, and six capital cards reflow without horizontal overflow.
- Permit Activity uses the same shell and breakpoints. At widths below 820 px the evidence and ledger grids collapse to one column; below 560 px the four summary metrics become a two-column grid and the record ledger becomes labeled stacked rows.
- Residual test gap: a second saved Permit Activity mobile browser capture was not produced after the local preview server became unavailable. The responsive rules and DOM behavior were inspected, but this specific capture should be added before production integration.
- Residual capture gap: the final non-layout icon cleanup occurred after the pass-2 screenshots. Icon boxes retain the same dimensions, but the latest Lucide substitutions were not re-captured.

## Comparison history

1. Public Investment pass 1
   - Earlier P2: vertical density placed the persistent action bar below the 1487 × 1058 viewport.
   - Fix: reduced desktop section padding, chart height, panel spacing, and footer rhythm without changing content hierarchy.
   - Post-fix evidence: `mockups/screenshots/public-investment-qa-pass2-1487.png`; the action bar is visible and the page has no horizontal overflow.
2. Permit Activity pass 1
   - Earlier P2: the action bar was clipped below the 1487 × 1058 viewport.
   - Fix: tightened permit-specific panel padding, table rows, chart height, and ledger spacing.
   - Post-fix evidence: `mockups/screenshots/permit-activity-qa-pass2-1487.png`; the action bar is visible and the page has no horizontal overflow.
3. Permit state audit
   - Earlier behavior issue: unavailable and malformed responses collapsed to identical copy.
   - Fix: added distinct unavailable and malformed explanations while preserving chart withholding and non-zero semantics.
   - Post-fix evidence: automated DOM assertions confirm distinct messages for `state=zero`, `state=unavailable`, and `state=malformed`.

## Implementation checklist

- [x] Preserve the Explorer visual system.
- [x] Keep six Public Investment capital classes distinct.
- [x] Reconcile grant, philanthropic, permit-type, status, and concentration totals.
- [x] Keep permit value states and truncation semantics explicit.
- [x] Verify core interactions and keyboard-readable chart values.
- [x] Capture and compare both desktop briefs at the source viewport.
- [x] Verify a representative 390 px responsive capture without horizontal overflow.
- [x] Capture the Permit Activity mobile viewport during the production-integration QA pass.

final result: passed

---

# Production Integration — Final QA Closure

The final source/implementation comparison, source-backed Chatham ready state, 390 px mobile capture, Polygon and MultiPolygon boundary coverage, keyboard interactions, state semantics, TypeScript, focused tests, ESLint, and production build are documented in “Production Neighborhood Permit Brief — Integration QA” above. The browser measurements remained overflow-free, and no actionable P0, P1, or P2 issue remains.

final result: passed

---

# Strategic Neighborhood Permit MVP — QA Closure

The current strategic MVP is documented in “Strategic Neighborhood Permit MVP — Final QA” above. Its final paired comparison is `output/browser/permit-strategic-source-vs-mvp-viewport.png`; the responsive evidence is `output/browser/permit-strategic-mvp-mobile-390x844.png` and `output/browser/permit-strategic-mvp-mobile-ledger-390x844.png`.

- Desktop: `scrollWidth === innerWidth === 1487`.
- Mobile: `scrollWidth === innerWidth === 390`.
- O'Hare command routing, exact-value monthly marks, record/source dialogs, methods disclosure, and export availability were verified in the in-app browser.
- The cramped mobile ledger caption found in the first pass was fixed and re-captured at 390 × 844.
- The temporary local ready-state response was removed; production values remain query-derived.
- Strategic permit/boundary/map/public-claim verification: 144 tests passed, with TypeScript, ESLint, and the 331-page Next.js production build passing.

No actionable P0, P1, or P2 issue remains.

final result: passed

---

# Permit Exhibit Snapshot Design QA

## Target and state

- Reference: Verified Document direction selected for the saved Permit History Exhibit.
- Viewport: 1487 x 1058 for both the reference and implementation captures.
- Implementation state: a real, immutable saved exhibit for PIN `20-36-323-008-0000`, rendered from production-shaped permit and zoning evidence.
- Comparison method: the reference and browser capture were joined side by side and reviewed as one image.

## Iterations

1. The first implementation capture sat lower than the reference because of an extra breadcrumb, used a wider and smaller title lockup, and made the verification certificate visually too light.
2. The breadcrumb was removed from the saved route, the title measure and type scale were brought into line with the reference, the scope statement was aligned to the heading, and the certificate grid, seal, metadata, and action widths were tightened.
3. The final comparison confirmed the intended document hierarchy: global navigation, evidence eyebrow, large parcel title, scope statement, read-only certificate, and S1/S2 evidence sections align with the selected direction.

## Functional visual checks

- The certificate clearly distinguishes a saved, read-only artifact from the current live exhibit.
- Print / Save PDF and Open current exhibit are visible and operable.
- View full provenance expands to show source vintages, application revision, query, row counts, and SHA-256 content hash.
- The no-subject-permit state reads as a recorded zero and leads into nearby context rather than implying missing data.
- The pre-signup route shows the access gate and does not render saved evidence or its snapshot ID.
- The saved page and print route produced no browser console warnings or errors.

## Intentional data-driven differences

The reference illustrates subject-parcel matches. The verified implementation uses a real parcel with zero subject matches and 55 nearby records, so the first viewport advances into S2 instead of showing the reference table. This is the correct truthful state, not a visual regression.

final result: passed
