# Community Investment Inputs

These files are public-record source data used to build the private,
admin-gated Community Investment export. They are not served directly to public
visitors.

This file documents what each source MEANS and the integrity contract it must
satisfy. For how often each one changes and who changes it — six sources refresh
themselves monthly, the rest are frozen snapshots — see [REFRESH.md](./REFRESH.md).

## Cook County 2023 Source Grant

- Source: Cook County Small Business Source awardee list, version 2024-11-20
- Import: `npm run data:import:cook-source -- /path/to/source.pdf`
- Integrity contract for the published PDF: 74 pages, 3,003 listed rows,
  $50,050,000 in completed awards
- Source discrepancy: Cook County's program page describes 3,000 businesses and
  $50,000,000; the later 2024-11-20 awardee PDF contains three additional listed
  rows totaling $50,000. The import preserves the list instead of deleting rows
  to force the earlier headline.
- Location precision: municipality and ZIP only; never infer recipient addresses
- Admin UX: the map receives ZIP aggregates; recipient names load only after an
  authenticated user explicitly opens one ZIP's historical-recipient panel, and
  the panel closes on every teardown path (its overlay, the Community Investment
  master toggle, or the admin session dropping)
- Program state: historical and fully disbursed by February 2024, not active

## Cook County 2020 CARES Program Context

- Source: Cook County 2020 Community Recovery Initiative impact report
- Import: `npm run data:import:cook-cares-2020 -- --input /path/to/report.pdf`
- Integrity contract: 24 pages and four non-additive context rows: one $77
  million umbrella portfolio row plus three direct program outcomes
- Direct outcomes: 1,690 small-business grants ($16.9 million), 410 business
  forgivable loans ($7.6 million), and 148 gig-worker forgivable loans
  ($1.4 million)
- Chicago scope: award eligibility was suburban Cook County only; every row
  records that City of Chicago businesses and residents were excluded
- Map policy: no recipient roster, address, ZIP, coordinate, or map marker
- Money policy: the umbrella and child amounts are distinct source-reported
  contexts and must never be added together

## Illinois DCEO FY26 Capital Appropriations

- Source: DCEO Capital Appropriation List, PDF created 2026-04-10
- Import: `npm run data:import:dceo-capital -- --input /path/to/source.pdf`
- Integrity contract: 885 pages; parsed line-item and lump-sum amounts must
  reconcile exactly to the source's published group balances
- Location precision: retain only literal numbered addresses from source text;
  multi-site and ambiguous rows remain unplotted. "Multi-site" includes an
  explicit various/multiple-locations phrase, two separate matched addresses, AND
  two house numbers sharing one street suffix ("6808 O 6816 S HALSTED ST",
  "4111/4113 N PULASKI AVE") — the last shape collapses to a single regex match,
  so a match-count test alone would plot it as one confident point
- Chicago scope: require a source-literal 606 ZIP, an explicit Chicago location
  phrase, or a City-jurisdiction public entity; an organization name containing
  "Chicago" is not location evidence by itself
- Bad geocodes: a source-literal address that resolves outside Chicago's
  community-area polygons loses its POINT but keeps its record, held citywide.
  A bad geocode is not a bad appropriation — the row already cleared the source's
  own Chicago evidence, and its published balance still counts
- Money meaning: source-published appropriation balance, not an active NOFO,
  confirmed GATA award, payment, project budget, or estimate of incentive dollars
- Lifecycle: the platform identifies executed awards and disbursements as
  separate DCEO Grant Tracker stages; they are not yet ingested or added to the
  appropriation balance, and future crosswalks require an official shared
  identifier or documented manual verification

## Illinois Business Interruption Grants

- Source: Illinois DCEO combined BIG awardee PDF, source version 2021-04-09
- Import: `npm run data:import:illinois-big -- --input /path/to/bigawardsall.pdf`
- Integrity contract: 135 pages, 8,998 rows, and exactly $276,275,000 in
  historical grants across the two published rounds
- Funding lineage: 2020 CARES Act Coronavirus Relief Fund administered by DCEO
- Location precision: municipality and ZIP only; never infer street addresses
- Admin UX: Chicago rows render as ZIP aggregates, with recipient names loaded
  only through the authenticated one-ZIP drilldown
- Program state: closed historical grants, not an active opportunity

## Illinois Hospitality Emergency Grants

- Source: Illinois DCEO Hospitality Emergency Grant awardee PDF, dated
  2020-04-27
- Import: `npm run data:import:illinois-hospitality -- --input /path/to/awardees.pdf`
- Integrity contract: 12 pages, 699 rows, and exactly $13,995,000 in historical
  grants, reconciling to DCEO's program page
- Funding lineage: existing DCEO tourism, job-training, and operating funds,
  not CARES funding
- Location precision: municipality and county only; never infer ZIPs or street
  addresses
- Admin UX: explicit Chicago records remain citywide and unplotted; the map
  reports that count instead of placing recipients at a centroid
- Program state: closed historical grants, not an active opportunity

## Illinois Back to Business

- Source: Illinois DCEO Back to Business awardee PDF, dated 2022-07-26
- Import: `npm run data:import:illinois-b2b -- --input /path/to/b2bawards.pdf`
- Integrity contract: 99 pages, 6,687 rows, and exactly $249,510,000 in the
  dated recipient list
- Source reconciliation: DCEO's program page rounds the program headline to
  $250 million; the importer preserves the row-level PDF values
- Location precision: municipality and ZIP only; never infer street addresses
- Admin UX: Chicago rows render as ZIP aggregates, with recipient names loaded
  only through the authenticated one-ZIP drilldown; the drilldown panel closes
  on every teardown path, exactly like the Cook one
- Program state: historical ARPA-funded grants, not an active opportunity
- Money meaning: each amount is a source-reported historical grant and stays in
  `recovery.historicalAmount`, outside ordinary awarded-dollar totals

## SBA Restaurant Revitalization Fund

- Source: SBA RRF FOIA dataset; curated source version 2024-10-21
- Import: `npm run data:import:sba-rrf -- --input /path/to/rrf_foia.csv`
- Integrity contract: 100,828 source rows; 1,523 explicit Chicago, Illinois
  records; one known warning for a source row missing city/state
- Location precision: source-published street addresses; points are created only
  when the Census geocoder resolves the address inside official Chicago
  community-area boundaries. A geocode miss or an out-of-bounds hit loses the
  POINT, never the record — the row is held citywide and its dollars still count
- Program state: closed historical ARPA grants, not a current opportunity
- Money meaning: each amount is a source-reported historical grant and stays in
  `recovery.historicalAmount`, outside ordinary awarded-dollar totals

## Chicago ARPA Road to Recovery

- Sources: Chicago Data Portal Program Details (`m9g9-cj96`) and Grants Summary
  (`9yp3-9pdz`)
- Import: `npm run data:import:chicago-arpa`
- Join contract: all 67 financial-summary rows must match Program Details; the
  10 detail-only cost centers remain in the ledger with null financial fields
- Integrity contract: 77 programs; 67 financial rows; 10 metadata-only; and
  exactly $1,886,591,388 allocated / $1,886,591,388 obligated /
  $1,851,247,214.66 expended. Pinned like the other three sources, so a silent
  upstream shift on the next Socrata pull fails the import instead of publishing
- Grain: citywide program context only, never recipient awards or map points
- Money meaning: allocated, obligated, and expended stages remain separate; the
  platform does not combine them into a headline or present them as active site
  incentive dollars. Allocated and obligated are EQUAL on all 67 rows because the
  City's Grants Summary reports them at the same stage — an upstream
  characteristic, not a copy in this code; do not present them as two independent
  signals

## Private Foundation Grants — Tier-1 Expansion

`foundation_grants_tier1_expansion.csv` adds 2,990 Chicago-recipient grant rows
($437,837,713) from 20 further private funders, in the exact 13-column schema of
`foundation_grants_geocoded.csv` and read through the same mapper, so the two
files' funder-name sets must stay disjoint (the export asserts it). Thirty
funders were parsed from IRS 990-PF e-file XML across 90 filings, and every
filing was reconciliation-gated before a single row was allowed out — the parsed
grant-row sum had to tie to the filing's own printed Part I line-3a total —
yielding 75 reconciled and 15 known attachment gaps, with zero failures. Those
gaps are concentrated in 5 aggregate-only funders that together disclose
$384,982,870 in grantmaking with **zero public itemization** — Paul M Angell
Family Foundation ($114.0M), Pritzker Foundation ($98.2M), Steans Family
Foundation ($83.5M), Anthony Pritzker Fam Foundation ($56.6M), and The Richard H
Driehaus Foundation ($32.7M) — whose filings publish only a grant-schedule total
pointing at an unpublished attachment; their rows are quarantined in
`foundation_grants_tier1_quarantined_DO_NOT_EXPORT.csv` for provenance, are never
read by the export, and are flagged as funder-exchange targets (the itemization
exists, it is simply not public, so it has to be asked for). `funder_census.csv`
records the completed Gate A census of all 2,623 Chicago private foundations with
each one's disposition, and `foundation_grants_tier1_reconciliation_report.csv`
carries the per-filing audit trail (EIN, object id, parsed sum, line-3a, delta,
status, source URL, SHA-256). Note that the four Pritzker-named entities here are
four different filers with four different EINs and are never merged.

## Location confidence

Records carry EXACTLY ONE tier per geometry kind — there is no separate
confidence model and no tier the data cannot produce:

| tier | geometry | meaning |
| --- | --- | --- |
| `sited` | `point` | plotted at a real, in-boundary address |
| `zip_area` | `zip_area` | the source publishes a ZIP but no street address |
| `citywide` | `citywide` | genuinely unplotted (intermediary, multi-site, bad geocode) |

`zip_area` is named rather than folded into `citywide` because a ZIP aggregate is
a meaningfully narrower claim than "somewhere in Chicago".

## Chicago CARES-Era Program Ledger

- Sources: City Contracts (`rsxa-ify5`), Mid-Year Grants (`iyu8-jkf8`),
  Chicago Treasurer Catalyst Fund, and the Chicago Urban League's official
  Microbusiness Recovery Grant administrator page
- Import: `npm run data:import:chicago-cares`
- Query boundary: four exact contract predicates plus CDBG-CV project codes
  `CARES20CD` and `CARES20DB`, each capped at 5,000 ordered rows
- Grain: 7 program records, 77 administrator-contract records, and 17
  program-accounting records; no business-recipient records or map points
- Contract policy: revisions are retained as lineage but never summed; 39
  duplicate PO mirrors collapse to one authorization, and two source-literal
  vendor cleanups are documented by exact PO and identity
- Address policy: administrator addresses are excluded because they are not
  funded business locations
- Money policy: authorization, budget, encumbrance, and expenditure stages
  remain separate and are never presented as one total

Run `npm run data:export:investment` after any curated input changes.
