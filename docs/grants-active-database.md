# Active grants database

Built September 11, 2026. Answers three questions per record: **does this business fit, what can it fund, and when can they apply.**

## Where it lives

- Postgres table `grants_active` (plus `grants_active_loads` for load history). Originally verified on `grants-db-load-2026-09-11`; now also merged into the workspace test branch `grants-workspace-20260911`. Not loaded to production.
- Files (gitignored, regenerate with the scripts): `output/grants-db/grants-active.jsonl`, `grants-active.csv`, `grants-active.meta.json`, `SUMMARY.md`.
- Curated Chicago core: `data/grants-active.json` (80 programs verified by hand on live pages).

## Record shape (schema v2)

Every record carries the same seven groups, whatever the source:

| Group        | Fields                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| program      | name, funder, officialUrl, applyUrl, fundingSource (public, philanthropic, corporate, utility), level                                                                                                                        |
| window       | status (open, scheduled, rolling, standing), opensAt, deadline, recurs (one_time, recurring_scheduled, recurring_unscheduled, rolling, rolling_with_cutoff), nextExpected, closingSoon                                       |
| funding      | amountMin, amountMax, amountDisplay, type (grant, reimbursement, rebate, in_kind, award_drawing, forgivable_loan, cooperative_agreement), requiredContribution, paymentTiming (upfront, reimbursement, unknown), costToApply |
| applicants   | businessTypes, industriesIncluded, industriesExcluded, operatingStage, location, landlordOrTenant (owner, tenant, either, not_applicable, unknown), demographicRestriction, sizeLimits                                       |
| uses         | eligible, exclusions, summary, observedPurposes (foundations: purposes of grants actually paid)                                                                                                                              |
| requirements | licenses, taxStatus, financialDocuments, permits, revenueLimit, employeeLimit, applicationMaterials, other                                                                                                                   |
| verification | sourceUrl, evidence, dateChecked, checkedBy, staffOwner, nextReviewDate, legitimacy (official, pay_to_apply, lead_gen, sweepstakes)                                                                                          |

`readiness.status` is `ready` only when businessTypes, location, funding type, at least one use or purpose, a dated or rolling window, and a source with a check date are all present. Otherwise it is `needs_research` and `readiness.missing` names exactly what to find. Incomplete records are kept on purpose; they leave `needs_research` when evidence is added.

`recordType` is honest about what a row is: `opportunity` (a round with dates), `standing_program` (a program that funds through recurring rounds; check when its round opens), `foundation` (a private foundation whose IRS 990-PF Part XV says it accepts applications). `chicagoRelevance` is high for curated Chicago programs and Illinois-focused foundations, medium where a Chicago business, nonprofit, or resident can meet the applicant type, low for government-only or geographically restricted elsewhere.

## Sources

| Source        | What                                                                                                                                       | How                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| curated       | Chicago, Cook, Illinois, federal, utility, corporate, and foundation programs verified on live pages by five research agents on Sept 10–11 | `scripts/grants-db/CURATED-RESEARCH-SPEC.md`, merged by `merge_curated.py` |
| grants.gov    | every posted and forecasted federal opportunity                                                                                            | daily XML extract, `fetch_grantsgov.sh` then `norm_grantsgov.py`           |
| sam.gov       | every active federal assistance listing, linked to open grants.gov rounds by CFDA                                                          | `fetch_sam.sh`                                                             |
| illinois_csfa | every Illinois state program in the GATA catalog with a non-government applicant type                                                      | `fetch_csfa.sh` then `parse_csfa.py`                                       |
| illinois_nofo | the GATA funding-opportunities list                                                                                                        | parsed inside `parse_csfa.py` run                                          |
| irs_990pf     | every US private foundation whose latest 990-PF (2025 or 2026 filing year) does not check "only preselected" and gives application info    | `fetch_irs_zips.sh`, `run_parse_990pf.sh`                                  |

## Refresh

Run from a scratch directory (the scripts write next to themselves), in this order: the three bulk fetches, the IRS fetch and parse loop, `merge_curated.py`, `unify2.py`, then run `node scripts/grants-db/load_neon.mjs <jsonl>` from the repository with `BRANCH_DATABASE_URL` set to an isolated Neon branch. Truncation is disabled; the loader preserves existing records. The workspace wrapper is `node scripts/grants/load-catalog.mjs <jsonl>` and uses the configured local test database. Curated rows are the only hand-verified ones; re-run the five research agents against the spec to refresh them.

## Workspace integration

The imported inventory is browsable in the gated **Funding database** view. Its `ready` field describes source completeness only. The workspace treats foundation filings and standing programs as application-window unconfirmed, and recalculates dated status at request time. New staff reviews begin unverified; exact deadline times, costs, geography and eligibility must be checked. See `docs/grants/merge-verification.md`.
