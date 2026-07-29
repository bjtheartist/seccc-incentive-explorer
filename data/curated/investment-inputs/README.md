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

Run `npm run data:export:investment` after either curated input changes.
