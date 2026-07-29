# Community Investment Inputs

These files are public-record source data used to build the private,
admin-gated Community Investment export. They are not served directly to public
visitors.

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
  authenticated user explicitly opens one ZIP's historical-recipient panel
- Program state: historical and fully disbursed by February 2024, not active

## Illinois DCEO FY26 Capital Appropriations

- Source: DCEO Capital Appropriation List, PDF created 2026-04-10
- Import: `npm run data:import:dceo-capital -- --input /path/to/source.pdf`
- Integrity contract: 885 pages; parsed line-item and lump-sum amounts must
  reconcile exactly to the source's published group balances
- Location precision: retain only literal numbered addresses from source text;
  multi-site and ambiguous rows remain unplotted
- Chicago scope: require a source-literal 606 ZIP, an explicit Chicago location
  phrase, or a City-jurisdiction public entity; an organization name containing
  "Chicago" is not location evidence by itself
- Money meaning: source-published appropriation balance, not an active NOFO,
  confirmed GATA award, payment, project budget, or estimate of incentive dollars

## Illinois Back to Business

- Source: Illinois DCEO Back to Business awardee PDF, dated 2022-07-26
- Import: `npm run data:import:illinois-b2b -- --input /path/to/b2bawards.pdf`
- Integrity contract: 99 pages, 6,687 rows, and exactly $249,510,000 in the
  dated recipient list
- Source reconciliation: DCEO's program page rounds the program headline to
  $250 million; the importer preserves the row-level PDF values
- Location precision: municipality and ZIP only; never infer street addresses
- Admin UX: Chicago rows render as ZIP aggregates, with recipient names loaded
  only through the authenticated one-ZIP drilldown
- Program state: historical ARPA-funded grants, not an active opportunity

## SBA Restaurant Revitalization Fund

- Source: SBA RRF FOIA dataset; curated source version 2024-10-21
- Import: `npm run data:import:sba-rrf -- --input /path/to/rrf_foia.csv`
- Integrity contract: 100,828 source rows; 1,523 explicit Chicago, Illinois
  records; one known warning for a source row missing city/state
- Location precision: source-published street addresses; points are created only
  when the Census geocoder resolves the address inside official Chicago
  community-area boundaries
- Program state: closed historical ARPA grants, not a current opportunity
- Money meaning: each amount is a source-reported historical grant and stays in
  `recovery.historicalAmount`, outside ordinary awarded-dollar totals

## Chicago ARPA Road to Recovery

- Sources: Chicago Data Portal Program Details (`m9g9-cj96`) and Grants Summary
  (`9yp3-9pdz`)
- Import: `npm run data:import:chicago-arpa`
- Join contract: all 67 financial-summary rows must match Program Details; the
  10 detail-only cost centers remain in the ledger with null financial fields
- Grain: citywide program context only, never recipient awards or map points
- Money meaning: allocated, obligated, and expended stages remain separate; the
  platform does not combine them into a headline or present them as active site
  incentive dollars

Run `npm run data:export:investment` after any curated input changes.
