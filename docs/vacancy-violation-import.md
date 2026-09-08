# Vacancy citations added to the vacancy database

Owner request: add building-violation vacancy records, retaining the existing five-year window.

## Source and inclusion rules

Use the official City of Chicago [Building Violations dataset](https://data.cityofchicago.org/Buildings/Building-Violations/22u3-xenr), not the community-created `u7si-yh3t` view. The latter also contains vacant-land citations.

The first import includes three explicit building-vacancy codes: `CN193110` (VACANT BUILDING - REGISTER), `CN193100` (REGISTER/SECURE/INSURE-VACANT), and `CN193105` (VACANTBUILDING-REGISTER/SECURE). It excludes general building violations, land-use citations, and the separately scoped financial-institution enforcement dataset `kc9i-wq85`.

Fetch all statuses within five Chicago calendar years. Group by the City's property-group ID, using normalized address only when that ID is absent. Select the latest citation; a non-open status wins a same-day conflict. Import only OPEN signals with valid coordinates. Modification dates never refresh the age of an old violation.

These are dated public-record signals, not proof of current vacancy or property availability. A citation can concern an individual unit, part of a building, a rear structure, or an alternate address within the same City property group. Preserve the inspector's scope comments in `property_status`, the original status in `status`, and the exact source-row link. Leave PIN, ownership, measured space, and zoning class unverified. Incentive-zone membership uses the existing PostGIS zone intersection logic.

## Reproduce and review

```sh
npx tsx scripts/import-vacancy-violations.ts
```

This command reads public data and writes `output/vacancy-violations/source.json`, `import.json`, and `import.sql`. It does not connect to or write to a database. Review the import, compare addresses with existing inventory, and execute the generated SQL on a disposable Neon branch first. The SQL is additive and idempotent and does not delete records, modify other sources, or replace manually enriched fields.

This is an operator-reviewed addition, not a recurring source reconciliation job. Before a subsequent import, review previously imported records against current source statuses and the retention cutoff; this script does not automatically remove records that later resolve or age out.

## Verified 2026-09-08 run

- Cutoff: 2021-09-08, based on the original violation date.
- Fetched: 126 citations; 119 property groups.
- Withheld: 94 property groups whose selected citation was not OPEN.
- Imported: 25 property-level signals, all with valid coordinates and incentive-zone matches.
- Address comparison: 18 addresses absent from existing inventory; seven already represented by another source. Six of the 18 unmatched addresses have an existing record within 20 metres, so 18 new addresses must not be described as 18 proven distinct new properties.
- Preserved other sources: COLS 18,103; 311 building 16,313; 311 clean lot 17,352; CCLBA 913.
- Verification branch: `vacancy-violations-verify-20260908` (`br-silent-butterfly-aeviba1z`). Repeated inserts left the count at 25. Retained for review; not deleted.
- Production: `main` (`br-rapid-credit-aekjpelt`) in project `winter-hill-01244713`; 25 rows written and read back. Original date, source ID/link, OPEN status, scope comments, unknown ownership/PIN, and zone-count consistency all passed.
- Live verification: `/api/vacant?bounds=-87.95,41.6,-87.5,42.05&source=violations&limit=100` returned HTTP 200 and 25 features.
- Code checks: 22 importer tests, TypeScript, touched-file ESLint, and diff checks passed.

## Publication boundary

The live database and vacancy API are updated. No application redeployment was required. Existing cached map responses may retain their normal cache lifetime.

The committed vacancy-index and ranked Site Matchmaker universe were not rebuilt by this database addition. Their legacy exporter currently maps violation sources into the `311_building` evidence category; a future snapshot refresh must first model building-violation evidence explicitly so it is not mislabeled as a 311 report. Do not imply the saved ranked shortlist has incorporated these additions.
