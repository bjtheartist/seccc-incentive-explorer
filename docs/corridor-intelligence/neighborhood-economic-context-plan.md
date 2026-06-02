# Neighborhood Economic Context Integration Plan

## Goal

Upgrade the report's market context from basic demographics into a neighborhood economic intelligence layer without overclaiming what public data can prove.

The report should separate:

- directly measured signals,
- modeled estimates,
- and partner-verified information.

Address-level reports should stay safe for public use. Sensitive row-level business, owner, parcel, and address outputs belong in preview-gated exports or partner workbooks until reviewed locally.

## Milestone 1 Scope

This milestone adds the report framework and supports measured ZBP / license-continuity values when they are provided by the report context.

Included:

- Rename `Market Analysis` to `Neighborhood Economic Context`.
- Preserve existing ACS income, home value, population, walkability, and zone coverage.
- Define the license-based business-continuity score as a neighborhood-level signal, not proof of closure or survival for a specific business.
- Show Census ZIP Business Patterns jobs/payroll values when a matched geography is supplied.
- Add conservative placeholder rows for leakage, multiplier potential, permit reinvestment, and assessor ownership/value change when those signals are not yet attached to the report context.
- Add source citations only when measured optional datasets are passed into the report context.

Not included:

- Production database migrations.
- Public row-level owner/business/address views.
- LEHD/LODES ingestion into the live report path.
- Citywide permit or assessor backfills.
- Paid API dependencies.

## Milestone 2 Scope

This milestone wires the first aggregate data source into public reports.

Included:

- Add `GET /api/neighborhood-economics?zip=...` for aggregate ZIP-level context.
- Back the endpoint with `data/exports/southeast-resilience/neighborhood_growth_signal.json`.
- Return only summarized ZIP-level metrics, not business, owner, parcel, or address rows.
- Attach the context to report generation when the report address, parcel, or corridor field contains a ZIP.
- Keep reports working when the ZIP is not part of the current proof-of-concept dataset.

Current coverage:

- 60617
- 60619
- 60649

This is intentionally a proof-of-concept coverage area. A citywide version should move this data into a durable aggregate table or scheduled export once funding and storage capacity are resolved.

## Milestone 3 Scope

This milestone expands the proof of concept from three Southeast ZIPs to an aggregate citywide ZIP artifact.

Included:

- Add `npm run neighborhood:economics:export`.
- Export aggregate-only ZIP context to `data/exports/chicago-neighborhood-economics/neighborhood_economics_by_zip.json`.
- Export a matching aggregate CSV to `data/exports/chicago-neighborhood-economics/neighborhood_economics_by_zip.csv`.
- Cover active Chicago ZIPs found in City of Chicago business-license records, including `606xx`, `60707`, and `60827`.
- Add measured Census ZIP Business Patterns employment and payroll values.
- Add license-based business continuity from 2020 to 2025.
- Add resident spending-power context from 2024 ACS tract data using a local tract join when no Census API key is available.
- Add aggregate permit volume, reported cost, and demolition permit counts using City of Chicago Building Permits ZIP-region IDs.
- Add aggregate parcel mix using Cook County Parcel Universe class counts by ZIP.
- Prefer the citywide artifact in `GET /api/neighborhood-economics?zip=...`, with the Southeast proof-of-concept snapshot retained as fallback.

Still intentionally not included:

- Production database migration or backfill.
- Public row-level business, owner, parcel, address, contact, or mailing-address output.
- A claim that license disappearance proves business closure.
- A claim that public property records prove beneficial ownership or owner intent.
- Verified leakage or multiplier calculations.

Current report role:

The citywide artifact is enough for a first public MVP of `Neighborhood Economic Context` inside incentive reports. It can compare ZIP-level conditions, but it should remain framed as context for incentive strategy rather than a definitive neighborhood ranking.

## Source Freshness Gate

Current-context sources should use 2024 or newer data when that data is available at the geography needed for the report. If a dataset's latest official reference year is older than 2024, it may only be used as a clearly labeled benchmark or trend input, not as a current-condition claim.

Current preferred sources:

- ACS: use 2024 ACS 5-year ZCTA data through the Census API when `CENSUS_API_KEY` is available; otherwise use the local 2024 tract fallback.
- Chicago business licenses: use the live City of Chicago business-license dataset for 2020 to current license-continuity signals.
- Chicago building permits: use recent City of Chicago permit records, with the report showing the measured trailing window.
- Cook County parcels: use current public parcel aggregates only in public reports; keep owner/address rows out of public UI.

Latest-official benchmark sources:

- Census ZIP Business Patterns / County Business Patterns: the current report artifact uses 2020 and 2023 ZBP totals. Census has not published a 2024 ZBP totals file at the official CBP dataset path checked on June 2, 2026. Treat ZBP as the latest official jobs/payroll benchmark, not a 2024 current-condition source, until a newer reference year is published.

Dataset review rule:

- Include in the public report now if the data is 2024+ and supports ZIP/address context without exposing sensitive row-level records.
- Include as benchmark-only if it is the newest official release but has a pre-2024 reference year.
- Keep out of the public report if it is national/state/county only, too old for current local context, or would require modeled claims we cannot explain simply.

## Signal Definitions

### Business Continuity

Data basis: Chicago business licenses.

Definition: compare active license entities in a baseline year with active license entities in a later year. The retained share is a continuity signal.

Safe language: license-based continuity signal.

Avoid saying: the business definitely closed, survived, relocated, or failed.

### Jobs & Payroll

Data basis: Census ZIP Business Patterns.

Definition: establishments, employment, and annual payroll by ZIP and year.

Safe language: measured ZIP-level employment and payroll context.

Limit: ZBP is geography-level and industry-aggregated. It does not identify individual businesses or actual project payroll.

### Resident Spending Power

Data basis: ACS income and population, optionally modeled into a resident spending-power proxy.

Safe language: resident purchasing-capacity context.

Limit: this does not measure actual local sales capture.

### Reinvestment Signals

Data basis: City of Chicago Building Permits.

Definition: permit volume and applicant-reported project cost by geography and time window.

Safe language: visible reinvestment signal.

Limit: reported cost is directional and does not capture unpermitted work, private financing terms, or project quality.

### Property Ownership / Value Change

Data basis: Cook County Assessor parcel universe, sales, and assessed values.

Definition: ownership fragmentation, local/outside ownership proxies, sales activity, and assessed-value movement.

Safe language: public property-record signal.

Limit: public records do not prove beneficial ownership or owner intent. Use confidence labels before outreach.

### Leakage Signals

Data basis: modeled from resident spending power, business mix, employment flows, and partner-verified sales context.

Safe language: modeled leakage hypothesis.

Limit: leakage cannot be claimed from ACS or licenses alone.

### Multiplier Potential

Data basis: modeled from local business mix, jobs, project type, anchor assets, and spending capture assumptions.

Safe language: scenario-planning estimate.

Limit: not a guaranteed economic impact, job count, sales increase, or tax-revenue forecast.

## Next Data Phases

### Phase 2: LEHD / LODES

Add workplace/resident job flows, earnings bands, and commute patterns.

Report use:

- jobs held by residents vs jobs located in the area,
- worker inflow/outflow,
- wage-band context,
- leakage implications tied to labor flows.

Implementation notes:

- Start ZIP/community-area level only.
- Keep outputs aggregated.
- Label as measured job-flow context from Census LEHD/LODES.

### Phase 3: Building Permits

Attach permit volume and reported cost by ZIP, community area, or custom corridor.

Report use:

- reinvestment trend,
- areas with visible construction activity,
- comparison against vacancy and incentives.

Implementation notes:

- Use trailing 24 months first.
- Keep address-level rows out of public UI unless in partner workbook.
- Distinguish demolition permits from new construction or renovation.

### Phase 4: Assessor Parcels, Sales, and Assessed Values

Attach property ownership and value-change context by geography.

Report use:

- ownership fragmentation,
- local/outside ownership proxies,
- sales velocity,
- assessed-value movement,
- reinvestment/vacancy mismatch.

Implementation notes:

- Treat owner names and mailing addresses as sensitive implementation data.
- Public reports should show aggregate counts and shares only.
- Partner workbooks may include row-level owner/contact leads with confidence/provenance labels.

### Phase 5: Leakage and Multipliers

Build transparent models only after measured data is stable.

Report use:

- identify categories where spending may be leaving the neighborhood,
- show which business types or projects could have stronger local multiplier potential,
- support incentive narratives with scenario language.

Implementation notes:

- Use public benchmarks and partner validation.
- Never present leakage or multiplier outputs as verified facts.
- Keep assumptions visible in the report or workbook.

## Verification Checklist

- Report section renders for standard site incentive reports.
- Vacancy report flow keeps working.
- Optional ZBP values render as measured jobs/payroll context.
- License continuity definition appears even when no values are loaded.
- Leakage and multiplier rows use conservative modeled / needs-verification language.
- Sensitive row-level data is not introduced into public report UI.
