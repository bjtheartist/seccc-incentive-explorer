# Site Matchmaker accuracy: action plan

Prepared September 13, 2026. Planning deliverable only; no application change, issue publication or deployment is included. Baseline: the [South Chicago audit](site-matchmaker-baseline.md) and [both-direction building-use investigation](site-matchmaker-baseline.md), against production revision `9dbbde67231f9042cbb7eaf465aab7ca0479a7ae`. Recheck the current branch/deployment before implementation.

## Objective and definition of success

A user must be able to distinguish **records that match their evaluated requirements**, **records that need more evidence**, and **conversion/redevelopment possibilities**. A house should not silently appear as an existing commercial-building match; a commercial building should not silently appear as an existing-home match. Unknown measurements must not masquerade as evidence that no suitable properties exist.

Success means reliable screening against disclosed, dated evidence. It does **not** mean certified suitability, current vacancy, availability, ownership, legal permission, or accurate citywide inventory. “Matches evaluated filters” is the strongest general result claim we should use. It must identify any unevaluated requirements.

The audit's passing tests are useful but insufficient: 144 combinations followed the old rules while those rules still admitted the wrong recorded building types. Acceptance tests must assert the user's intended distinction, not merely reproduce the current implementation.

## Proposed product contract

These are recommended decisions to implement deliberately, not claims about existing behavior:

- **Existing property sought:** house, multifamily residential, commercial building, industrial building, mixed-use building, vacant-land record, or any. Offer multiple selections explicitly when wanted. Proposed activity is a separate field.
- **Conversion possibilities:** off by default for a strict existing-property search. If enabled, mismatched existing types appear in a separate “Conversion review” group, not as ordinary matches. Inclusion makes no claim that conversion is feasible.
- **Requirement outcomes:** pass, does not match, needs verification, or not evaluated. Evaluate these per criterion; a missing PIN need not invalidate unrelated facts, but must prevent unverified parcel facts from being joined.
- **Main results:** all active hard requirements pass using accepted evidence. Any unknown hard requirement routes to “Needs verification,” with the failed/unknown reasons retained. Preferences are visibly separate from hard requirements. A conflict can never become a pass merely because one source is convenient.
- **Measurements:** distinguish lot area, assessor total building area, building footprint/ground coverage, and reported available interior space. Never substitute one for another. If available-space evidence is absent, say so and offer an explicit change of measurement basis.
- **Geography:** the initial corrected search is “ZIP 60617,” not “South Chicago.” A later community-area mode uses the named polygon and describes its boundary convention. Informal neighborhood names must not silently stand in for official community areas.
- **Mixed use:** preserve detailed classification. Class 212 is not a residential-only false positive; mixed use is included only when the requested property types allow it. “Homes” must distinguish houses from apartment buildings.

## Phased delivery and narrow work packages

### Phase 0 — Freeze evidence and agree on semantics

**A0. Acceptance contract and baseline**

Action: turn this plan into scoped work items, each with a responsible implementer and reviewer assigned before work starts. Freeze the current fixtures, source versions, criteria URLs and observed results. Record counts before/after screening and reasons for exclusion. Add the new property-type/conversion/measurement fields to a versioned criteria contract before wiring UI behavior.

Why this closes the gap: implementation is judged against explicit user intent rather than broad labels or the previous engine's rules.

Limits: the original 30-record sample was a deterministic, stratified diagnostic sample, not a citywide random sample or formal double-blind study. Subsequent address cases were targeted reproductions. Neither provides a citywide error estimate.

Success: each audited finding maps to a work package and test; existing links have a documented migration path; no legacy “Existing building” link is silently reinterpreted as “commercial only.” Proposed policy: retain legacy broad behavior with an explanation and invite refinement, while new searches use explicit choices.

### Phase 1 — Correct current claims and build screening-ready evidence

**A1. Honest geography, controls and empty states — independent first release**

Action: replace neighborhood-only labels with the actual ZIP scope throughout intake, headings, links and exports. Mark every control before submission as a filter, ranking preference, contextual fact or unsupported preference. Replace “no records match” when evidence is missing with counts explaining what is known versus unassessable. Rename the zoning control to “Broadly aligned district families”; show PD/PMD separately as site-specific review.

Why narrow: this corrects what the product claims without moving pins, inventing measurements, adding unsupported filters, or changing eligibility rules.

Limits: relabeling a ZIP does not create a neighborhood search; clearer warnings alone do not solve bad membership. This release must not be announced as the accuracy fix being complete.

Success: zero neighborhood-only geographic claims on ZIP results in the reviewed flows; every selected control has a disclosed effect; zero-results copy separates no source records, known exclusions, unknown evidence and service/data failure. Users see PD/PMD review status before relying on an alignment control.

**A2. Resolve and join evidence before screening — shared prerequisite**

Action: build a versioned offline screening dataset that joins validated parcel identity and County facts before filtering/ranking. Keep each fact's source, effective year/date, retrieval time, status and method. Preserve the original coordinate and address alongside any validated replacement. Validate build IDs/checksums, numeric units, class mappings and joins; switch datasets atomically. Keep public record fetching out of the interactive ranking path.

Why narrow: existing County class and measurement facts are currently attached after top-20 selection. Moving trustworthy facts into the screening input makes the existing evidence usable without pretending to collect new truth.

Limits: a 2024 assessment remains a 2024 assessment even when retrieved today. A resolved PIN is not ownership verification. An address mismatch, stale join, split/merged parcel or missing source must remain explicit.

Success: 100% of joins have accepted identity evidence and provenance; no cross-parcel facts in negative tests; missing/mismatched files produce an explicit unavailable state, not a valid empty dataset. All twelve frozen building-sample sidecar measurements are represented accurately under the assessor-area field, never under available interior space. Counts reconcile against the input files.

Before launch, define source-specific freshness policies with the data reviewer; do not invent a universal cutoff. Display effective date and retrieval date separately even where a source refresh schedule is unknown.

### Phase 2 — Fix membership, one rule at a time

**A3. Existing building type in both directions — highest-priority user-facing fix; depends on A0/A2**

Action: derive a reviewed existing-property classification from detailed County codes and other attributed evidence. Add the property-type and conversion controls described above. Enforce them before ranking. Keep houses, multifamily, commercial, industrial, mixed use, land, exempt, unknown and conflicting evidence separate. Review the complete code dictionary used by the exports; a major-class prefix is not sufficient.

Why narrow: it checks what type of building the record describes, independently of what district contains it or what project the user wants to undertake.

Limits: recorded type does not establish today's use, current condition or legal convertibility. Classifications can lag conversions or demolition. Exempt is not a physical building type.

Success: strict commercial searches exclude 9513 S Oglesby, 10802 S Torrence and the three documented apartment records from ordinary matches; strict existing-residential searches exclude 3100 E 92nd St. Houses-only excludes apartments. Mixed-use examples are included when explicitly selected and excluded otherwise. Conversion opt-in moves eligible-to-review exceptions into its own group. Unknown/exempt/conflicting records never silently pass a required building-type test. All rules operate across the full candidate universe, not just the first page.

**A4. Typed size screening and truthful coverage — depends on A2; coordinate with A3**

Action: screen against the user's chosen measurement type and show that type on cards and exports. Assessor total building area can support an explicitly labeled total-building-area search; it cannot satisfy an available-space requirement. Treat missing values as unknown, not zero. Support inclusive minimum/maximum bounds with validated positive finite numbers and consistent units.

Why narrow: it removes the pipeline-induced mass exclusion while preserving the distinction between a whole building's size and space that could actually be occupied.

Limits: a real available-space search may still have no verified matches. That can be an evidence gap rather than a software failure. Do not create a “success” target requiring a nonzero result count for every search.

Success: fixture records with qualifying measurements pass the appropriate size filter; out-of-band records fail; unknown measurements move to review. No substitution between lot, footprint, assessor area and available space, including “either” property searches. The frozen assessor-measured examples become assessable for that basis, while remaining unknown for available interior space. The funnel uses enriched screening facts and distinguishes exclusions from missing evidence.

**A5. Land/building conflicts and parcel deduplication — depends on A2**

Action: surface contradictions between land evidence and building facts, preserving dates and lineage. Investigate 8408 S Burley and 9139 S Buffalo with newer evidence before resolving their status. Group duplicate parcel/site identities before top-N selection, with explicit exceptions for independently identified units and multi-parcel sites. Keep source events as evidence, not additional leads.

Why narrow: it prevents a disputed property type from passing unqualified and prevents the same undifferentiated property from consuming multiple slots.

Limits: older County building facts cannot disprove a later demolition. A demolition permit alone is not proof the work was completed. One parcel may legitimately contain multiple buildings or leasable units; a matching PIN does not justify indiscriminate merging.

Success: both conflict cases show their conflicting sources and never appear as uncomplicated land matches without review. The Ridgeland and Merrill duplicate examples become one undifferentiated lead each with all evidence retained. Zero duplicate undifferentiated lead IDs in result/export checks; documented unit/multi-parcel cases remain distinct. Review all 125 duplicate-PIN groups in 60617 and analogous groups across the nine exports, reporting consolidated groups and justified exceptions separately.

### Phase 3 — Tighten location, zoning and output consistency

**A6. Parcel location confidence and actual community boundaries — depends on A2**

Action: retain confidence for source point, parcel match and building footprint separately. Validate exact parcel containment and address consistency, support evidenced corner-address aliases, and route no-intersection/ambiguous cases to review. Never use automatic nearest-parcel snapping. Add a distinct official community-area mode using a documented inclusion rule; show boundary/split-site ambiguity explicitly.

Why narrow: this reduces wrong-parcel attribution and geographic overclaim without representing a parcel point as a verified building entrance or footprint.

Limits: a point inside a parcel proves neither that it is on a building nor that the entire parcel lies in one zoning/community polygon. Informal neighborhood boundaries can differ from official community areas.

Success: preserve the 26 resolved sample containment passes; keep all four unresolved cases unresolved until new evidence meets the documented rule. Test boundary points, multiple intersections, aliases and parcel changes. Every ordinary community-area result satisfies the chosen geometry rule; disputed/missing geometry is counted separately. ZIP results remain available as a separate scope. Any changed coordinate triggers recomputation/versioning of dependent zoning, overlays and distances.

**A7. Zoning screening limits — basic separation in Phase 1; specific-use work later**

Action: keep mapped district, recorded building use, proposed activity and approval research as separate facts. Basic release: split broad alignment from PD/PMD/ambiguous review; make clear that alignment is not permission. Later, only for a bounded set of concrete uses with sufficient inputs, create a source-cited, versioned ordinance-table screening module reviewed by a zoning subject-matter reviewer. Unsupported activities remain not evaluated. Use changes, overlays and site-specific provisions require explicit handling.

Why narrow: it removes the inference from “commercial district” to “commercial building” and from “broad family alignment” to “this activity is permitted.” A specific-use module adds only the rule coverage actually researched.

Limits: no blanket by-right, legal-conformity, approval, conversion-feasibility or no-rezoning-needed claims. A table result alone cannot settle all site-specific standards, existing rights or approvals. This plan does not itself supply a legal interpretation.

Success: no PD/PMD/ambiguous record is labeled an ordinary aligned-family pass; frozen district lookups remain accurate; a future supported-use result includes the exact input activity, district, source/version, conditions and unresolved checks. Missing rules never default to permission. This advanced module is not a prerequisite for shipping honest recorded-type and measurement filters.

**A8. Filters, distance boundaries and export parity — after criteria contract stabilizes**

Action: use exact mile-to-meter conversions; label straight-line distance. Preserve current post-selection zoning controls explicitly as “filter this shortlist” for the first release. Add “Export visible results” and “Export full shortlist (20)” with accurate counts. If full-universe zoning search is added later, make it a separate versioned search criterion applied before top-N rather than silently changing local display-filter semantics. Unsupported bus/freight/access/footfall requirements stay not evaluated until suitable datasets and methods exist.

Why narrow: this closes known boundary exclusions and aligns output with the requested operation without pretending to measure walking routes, freight access or foot traffic.

Limits: straight-line proximity is not routed access, service frequency or travel time; expressway proximity is not distance to an entrance. A full shortlist is not the full inventory. A preference must not be presented as a requirement that was satisfied.

Success: all nine frozen rail cases match independent exact-distance expectations; endpoint tests cover just inside/on/outside each threshold. In the B1-2 display test, the three visible card IDs equal the three map IDs and three exported visible IDs, preserving rank numbers. Full shortlist export retains the original twenty. Include zero-result, reset, sorting, share-link reload and criteria-edit tests. Every active hard filter applies; unsupported hard requirements prevent an unqualified “all requirements matched” claim.

## Release sequence and change boundaries

Recommended sequence: **A0 → A1 → A2 → A3 → A4 → A5 → A6/A8**, with A7's basic claim separation in A1 and advanced use-table research as a later bounded project. A6 and A8 may be independent after the shared contract settles; this is a dependency suggestion, not a request to launch parallel agents.

Use a separate reviewable change for each work package. Each should state its acceptance criteria, non-goals, evidence, risk, migration behavior and rollback. Assign actual owners and dates when work is scheduled; do not attach speculative effort estimates before confirming the latest schema and branches. Do not mix these fixes with map redesign, unrelated rankings, new availability listings or a broad refactor.

Candidate implementation surfaces: `lib/shortlist-universe-schema.ts`, export/resolution scripts and manifests (A2/A5); `lib/site-matchmaker.ts` and criterion registry (A0/A1/A3/A4/A8); `lib/shortlist-engine.ts` (A3/A4/A5/A8); shortlist page, cards/map and CSV modules (A1/A3/A4/A6/A8). Confirm current implementation and linked issues before editing.

## Success scorecard and release gates

These are proposed release targets, not achieved results.

| Measure | Definition and target | Guard against misleading success |
|---|---|---|
| Requirement consistency | Zero known violations of active, supported hard filters across regression fixtures and all-nine-ZIP deterministic checks | Unknown evidence must not be counted as a pass |
| Both-direction type leakage | Zero recorded residential-only buildings in strict commercial matches; zero recorded commercial-only buildings in strict residential matches, subject to reviewed class rules | Conversions and mixed use remain separately visible; no blanket Class 2/5 rule |
| Evidence-backed coverage | Report assessable records / all relevant candidates, per field and ZIP; 100% of safely joinable frozen facts integrated | No arbitrary coverage promise; publish decreases and causes rather than hide unknowns |
| Size correctness | Zero wrong measurement types, unit errors or bound violations; zero available-space claims derived solely from assessor/lot/footprint area | A zero-match search can still be correct when verified data is absent |
| Identity and uniqueness | Zero unsupported PIN assignments/cross-parcel joins; zero duplicate undifferentiated leads | Unit/multi-parcel exceptions documented; low resolution coverage remains visible |
| Geography/output consistency | 100% adherence to selected geometry rule; exact ID/count parity for each card/map/export scope | Distinguish full inventory, selected shortlist and visible subset |
| Classification truth check | Report confirmed mismatch count / independently assessable sampled records, by stratum, with unknown count separately | Zero observed errors is not proof of zero real-world errors |
| Performance | Same-environment before/after benchmark: proposed p95 shortlist interactive time increase ≤10%, with an absolute cap of +250 ms; no new request-time County fan-out | Measure at least 30 runs per version under fixed cache/device/network conditions; no unverified sub-two-second promise |

Before release:

1. Replay the frozen 30-record sample, 144-case matrix, nine rail cases and sixteen building-use runs with revised expected behavior. Preserve originals as the baseline. Add edge cases for conflicts, source failures, missing values, boundary equality, mixed use, units and parcel changes.
2. Compare all nine ZIP datasets before/after offline. Produce a reason for every changed inclusion, exclusion, identity, coordinate and measurement. No unexplained loss of qualifying fixtures or source lineage.
3. Freeze a **new holdout sample before inspecting its results**: proposed 90 records across all nine ZIPs, stratified by evidence/property categories and selected deterministically with a recorded seed, excluding all frozen and targeted records already inspected. Audit underlying candidates as well as returned and excluded records so false negatives are visible. Keep additional targeted edge cases outside the prevalence denominator. Report strata separately or use documented sampling weights; do not pool an oversampled edge-case rate as citywide accuracy.
4. Run targeted tests plus relevant type/build checks. Independently verify actual browser intake → results → map → parcel detail → both CSV exports, including residential/commercial in both directions, mobile, legacy links and failure states. Existing 201 passing tests remain a baseline, not sufficient release proof.
5. Treat any known unsupported PIN assignment, cross-parcel fact, wrong typed measurement, or hard-filter violation as a release blocker. A fully disclosed unknown is a coverage limitation, not automatically a blocker. Unadjudicated conflicts in ordinary matches are blockers.
6. Release versioned data/code together, retain the previous compatible pair, and smoke the named counterexamples in production. Roll back for identity/measurement/filter violations or a material unexplained coverage drop; investigate performance regressions against the stated budget. Never roll back merely to inflate result counts.

Ongoing follow-up proposal: rerun consistency checks for each data build, and repeat independent adjudication on a fixed cadence agreed with the data owner. Track stale/unknown/conflicting records by source. No recurring automation is created by this plan.

## Claims we can and cannot make after these fixes

We can say: “These records match the selected evaluated filters, using the stated sources and dates.” We can explain why each record passed, which requirements were not evaluated, and which require verification.

We cannot say, without additional evidence: “This is currently vacant,” “available to buy or lease,” “has this much usable/available space,” “owned by this verified party,” “the pin marks the actual building entrance,” “the whole parcel has one zoning designation,” “your exact business is permitted,” “conversion is feasible,” or “we found every suitable property.” Assessment classification and public complaints are evidence, not those conclusions.

The first meaningful milestone is **correct existing-type screening in both directions plus truthful size and uncertainty handling**. Better source coverage and specific-use feasibility research can then improve usefulness without weakening those boundaries.
