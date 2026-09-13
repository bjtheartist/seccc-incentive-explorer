# Site Matchmaker implementation and release evidence

September 13, 2026. Baseline production `9dbbde6`; implementation base `267fd52`. Owner: Codex implementation/QA; Billy product and release authorization. No matching Linear issue was found by title search; this document tracks the approved plan. Release status is recorded at the end.

## Scope and acceptance

| Package | Implementation and verification |
|---|---|
| A0 | New briefs use `sm_v=2` with explicit existing types, conversion opt-in, measurement basis and optional official community area. Legacy briefs retain broad behavior with a refinement prompt. Unsupported or conflicting new parameters stop at review. Criteria round-trip and real map-page tests cover this. |
| A1 | Intake and results identify the actual ZIP. Unsupported preferences are disclosed. Missing evidence has a separate verification state; it is not a zero-supply assertion. Mobile browser flow passed at 390px without horizontal overflow. |
| A2 | Checksum/build-validated local sidecars join before selection. A cached deterministic runtime join derives screening rows from committed offline sources; no County request occurs during filtering. This implements the offline-source intent without a second redundant generated dataset. Evidence includes retrieval time, effective year, typed measurements and source lineage. Valid sparse joins stay unknown. A missing, stale, checksum-invalid or malformed sidecar fails closed as unavailable; it cannot silently produce a partial shortlist. Screening identity and facts come from the same validated ZIP file. Coverage is visible. An eight-entry cache reuses prepared public-record calculations for identical criteria, source build, ZIP and rail station data; authentication is evaluated on every request. |
| A3 | Detailed County classes distinguish houses, apartments, commercial, industrial and mixed use. Both reproduced mismatch directions fail strict type screening. Conversion possibilities stay separate, off by default. Unknown/exempt classes need verification. |
| A4 | Assessor, lot, available interior and footprint are separate. Only the selected measurement can satisfy bounds. Available-interior/footprint coverage is currently absent in this committed screening source; these filters produce verification records rather than substituted measurements. 1857 E 79th passes the 3,000–4,000 assessor-area fixture with 3,375 sq ft and never passes an available-space bound. |
| A5 | Same-PIN, same-normalized-address leads merge with every original key retained. Multiple addresses on one PIN remain separate and require review. Conflicting source types never become ordinary matches. Full-universe tests preserve all 31,296 source keys. |
| A6 | The named community polygon is evaluated at the saved point, separately from ZIP. Missing/boundary ambiguity requires review. Coordinates and raw PINs are not moved. A dated exception registry quarantines known parcel/point or zoning contradictions until adjudicated. Saved PINs are not universally geometry-certified. |
| A7 | Building type and broad zoning family are separate tests. PD/PMD and unresolved districts require review under the aligned-only requirement. Exact-use ordinance/approval research remains the later bounded module described in the plan. |
| A8 | Rail radii use 402.336/804.672/1609.344 meters. Full and visible CSV controls disclose counts and preserve original ranks. Refined map links stay on the filtered shortlist. Real browser B1-2 filter: 2 cards, 2 pins, 2 visible CSV rows at ranks 1 and 6; full CSV retained all 9 displayed shortlist records. |

## Full-data reconciliation

This comparison uses an unconstrained `either`/any-recorded-type refined brief, not a citywide suitability metric. All 1,343 consolidated duplicate rows retain source lineage. Counts of multiple-address cases are retained rows, not distinct PIN groups. Those rows require review rather than destructive merging.

| ZIP | Source rows | Consolidated leads | Evaluated matches | Verification | Multiple-address rows |
|---|---:|---:|---:|---:|---:|
| 60617 | 3,726 | 3,621 | 3,081 | 540 | 40 |
| 60619 | 2,879 | 2,789 | 2,222 | 567 | 18 |
| 60621 | 6,363 | 6,144 | 5,574 | 570 | 26 |
| 60623 | 3,736 | 3,552 | 3,006 | 546 | 38 |
| 60624 | 4,160 | 3,939 | 3,370 | 569 | 66 |
| 60636 | 5,689 | 5,400 | 4,797 | 603 | 26 |
| 60644 | 2,247 | 2,118 | 1,728 | 390 | 22 |
| 60649 | 1,033 | 1,003 | 734 | 269 | 2 |
| 60651 | 1,463 | 1,387 | 1,076 | 311 | 16 |

The automated matrix covers 180 combinations (9 ZIPs × 5 existing types × 2 zoning settings × 2 size settings). It checks every ordinary result for type, identity status, source conflict, selected size and broad zoning, as well as bucket disjointness and source lineage. It does not certify source truth.

## New holdout, independent of the original cases

Seed: `matchmaker-independent-holdout-2026-09-13-v1`. Five building and five land-only records per ZIP, 90 total, selected by SHA-256 order before live inspection; excludes the original 30, retail top 20 and named targeted cases. The frozen adjudication fixture is `lib/__tests__/fixtures/matchmaker-holdout-2026-09-13.json`. This diagnostic stratification is not a representative citywide error rate; no pooled prevalence assertion is made.

Live County point/claimed-PIN and City zoning requests completed for all 90 records:

- PIN containment: 69 agreements, one disagreement, 20 unresolved saved identities. Unresolved does not mean the geocoder's first polygon can be borrowed.
- Point zoning: 87 agreements and three disagreements.
- Seven land records had County building evidence; some are unresolved-address cases, not safe joins.
- All 11 records with observed parcel, zoning or land/building contradictions are in verification. Nine unresolved land identities remain useful as independent source leads when the brief requires no County facts; unresolved building identities and known contradictions require review. Overall, 66 holdout records are ordinary matches for the broad test brief and 24 require verification. Ordinary matched records with County facts had no observed class or assessor-area discrepancy in this live comparison.

New discrepancies: 3000 E 106th's saved PIN disagrees with the point parcel; 2426 E 75th, 2351 E 75th and 2524 E 79th have saved B3-2 versus observed B2-3. Two unresolved land locations, 4829 W Race and 2825 E 77th Pl, also have conflicting County building observations. All six exceptions are quarantined with dated source URLs in `data/curated/shortlist-screening-exceptions.json`. The source fields remain unchanged; no presumed replacement is adopted. Quarantines persist across builds until a reviewer resolves them, so a source refresh cannot silently erase a known contradiction.

## Classification coverage and limits

The mapping uses detailed codes from the [County classification dictionary](https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/Class_codes_definitions_12.16.24_0.pdf), cross-checked against the [County sales-ratio classification appendix](https://prodassets.cookcountyassessoril.gov/s3fs-public/reports/2019_IAAO_sales_ratio_study_final.pdf). Supported codes are enumerated in `lib/shortlist-screening-evidence.ts`. Industrial land 550 is land; 535 golf-course land/improvements, 580/590 minor improvements, 587 special improvements and unsupported incentive/ancillary codes remain unknown. We deliberately do not infer a building from a major-class prefix. This trades coverage for fewer unsupported inclusions. Classification is dated assessment evidence, not a current occupancy finding.

No new measurement feed or universal parcel-geometry certification ships here. A source update must rerun identity/checksum validation, the full-data matrix, holdout/frozen regressions, and exception adjudication. Use positive confirmation to remove a quarantine; never clear it to increase counts.

## Verification record

- Production build passed; trace explicitly includes community polygons, all nine universe files and parcel-identity sidecars.
- Full suite: 6,439 passed initially, four failed and two skipped. Recheck of the four files: all 61 tests passed. Failures were an old export-label expectation (updated), two sandbox IPC restrictions, and a loaded-worker timeout. Relevant new tests and final reruns are recorded below; this is not a claim that all tests passed in one initial run.
- Focused suite before final review-panel optimization: 652 passed. Real page tests, map-handoff tests, review-panel test and holdout tests additionally exercise the production entry points.
- Typecheck and touched-file lint passed before final optimization; final checks below.
- Browser: commercial and housing in both directions, explicit type intake, B1-2 CSV/card/map parity, parcel dossier, mobile, available-space unknown state, conversion group, unsupported filter and legacy refinement.
- No production schema migration, new secret or external source mutation. Local test authentication used only a local test secret. Public production signup remains gated.

## Performance and release

The initial production-mode local comparison used 30 alternating requests per version after five warmups. p95 increased from 13.43ms to 16.41ms (2.98ms, 22%). Although below the absolute 250ms budget, it exceeded the proposed relative 10% budget. The optional verification records were therefore changed to expand on demand; their counts and limits remain visible without rendering every detail initially. Final measurement and release evidence follow after validation.

This is evidence screening: not certified current vacancy, availability, ownership, usable interior space, exact-use permission, conversion feasibility, building entrance position, whole-parcel zoning or exhaustive inventory. Old brief links retain legacy broad screening and explicitly invite refinement.

Final focused run before the prepared-brief cache: 669 passed across 36 files.

Final prepared-brief cache validation: cache/page tests pass, touched-file lint and production build/typecheck pass. After the sidecar review fixes, the controlled 30-request p95 is 9.91ms refined versus 11.07ms legacy (-10.4%). Both proposed regression limits pass. First observed requests were 112ms refined and 251ms legacy, but these are single observations with shared source warmup, not a cold-start distribution. These local server timings do not establish production end-to-end load time.

Release PR: #303. Review fixes are undergoing final validation before merge and deployment.

## Keeping unresolved-PIN leads useful

Missing PIN is a field-level limitation. Independent source land evidence can satisfy a source-type search without County measurements; it does not establish current vacancy. Known identity disputes and observed land/building contradictions still require review. County-dependent building classification and measurements cannot pass without the needed evidence. This policy recovers useful records without treating missing evidence as proof.

Follow-up UX and enrichment work, not implemented in this release: replace repetitive missing-field text with one explanation of available source facts, County facts awaiting verification, and an address/parcel verification action. Candidate address aliases or parcel matches must remain separate from verified joins. Independently sourced footprint or listing measurements would require their own date, provenance, measurement definition and validation before use; footprint must never stand in for usable floor area. Success is more supported fields and adjudicated identities, with no rise in known filter contradictions, rather than simply fewer unknown labels.

## Completeness-first refinement

Billy requested that more complete records receive priority. For refined briefs, screening still runs first and the match/review/conversion buckets stay separate. Within each bucket, five equally weighted evidence categories lead the order: usable PIN, dated recorded type, any published typed measurement, resolved zoning and resolved community area. Selected rail score and broad zoning alignment then break ties, followed by a stable key. Multiple measurements do not inflate the bonus. No unverified owner, value or incentive count affects completeness. Legacy ordering is unchanged.

Tests exercise a sparse aligned record versus a more complete unaligned record, hard zoning exclusion despite completeness, higher rail score remaining secondary, deterministic ties and real-page explanation. This ranking expresses evidence availability, not accuracy, present availability or suitability.

Final review and completeness focused suite: 795 passed across 47 files. First-head CI verify/browser-smoke passed; the separate report/PDF test timed out while still generating a location snapshot, with a pending mobility-access request in the captured trace. No report or mobility code is changed by this PR. Updated-head CI and production smoke remain release gates.

Final completeness build and touched-file lint passed. The unchanged report/PDF browser test passed locally against that production build, including a valid downloaded PDF (22.1s total).

Final browser export recheck after ordering changes: unconstrained commercial brief has 10 displayed records; B1-2 narrows to two cards, the map reports two plotted, and downloaded visible CSV contains two rows at original ranks 1 and 6. The downloaded full CSV contains all 10. Earlier nine-record comparison used the narrower aligned set.
