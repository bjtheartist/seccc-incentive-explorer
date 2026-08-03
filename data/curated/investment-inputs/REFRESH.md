# Refresh cadence

Every file in this directory is public-record source data for the admin-gated
Community Investment export. They do **not** all refresh on the same clock, and
treating them as if they did is the main way this dataset can go wrong: a closed
program's published totals are an integrity contract, not a feed.

The rule of thumb: **if it has an API, it refreshes automatically; if it came out
of a PDF, it is a snapshot and only a human replaces it.**

---

## Monthly, automatic

Refreshed by `.github/workflows/data-refresh.yml` (cron: 07:40 UTC on the 2nd of
each month) via `npm run data:refresh:live`. The job opens a **pull request** and
never merges it — a month-over-month change in public data gets read by a person
before it reaches the map.

| File | Upstream | Dataset |
| --- | --- | --- |
| `nof_small.json` | Socrata (City of Chicago) | `rym7-49n8` — NOF Small Business Improvement |
| `nof_large.json` | Socrata | `j7ew-b73u` — NOF Large |
| `sbif.json` | Socrata | `etqr-sz5x` — SBIF completions |
| `tif_projects.csv` | Socrata ×2 | `mex4-ppfc` (RDA/IGA) + `72uz-ikdv` (Annual Report) |
| `chicago_cares_program_ledger.csv` | Socrata ×2 | `rsxa-ify5` (contracts) + `iyu8-jkf8` (mid-year grants) |
| `hud_cpd_activities.csv` | HUD ArcGIS ×2 | `CDBG_PROGRAM_ACTIVITY` + `HOME_Program_Activity`, `GRANTEE_ID=17408` |

Notes worth knowing before you review one of these PRs:

- **HUD is filtered by grantee, not by city.** `GRANTEE_ID=17408` is the City of
  Chicago as a CPD entitlement grantee. A handful of Chicago-funded activities
  carry a suburban *administrative* address that a `CITY='Chicago'` filter would
  wrongly drop. Rows whose coordinates fall outside Chicago are dropped later, by
  the export's `inChicagoBounds()` check.
- **The CARES ledger shows a diff most months even when nothing changed.** It
  carries `source_dataset_updated_at`, the upstream dataset's own publish
  timestamp, and the City bumps it daily. Trust the delta table, not the diff
  size.
- **TIF annual-report rows are context, not records.** Only the RDA/IGA rows with
  coordinates become map records; the annual-report rows feed the per-district
  series in `data/private/capital-context.json`.

---

## Quarterly, manual

No API. A new publication is a new snapshot: download it, re-run the importer,
review the integrity contract in `README.md`, commit.

| File | Source | How |
| --- | --- | --- |
| `dceo_capital_appropriations.csv` | DCEO Capital Appropriation List (PDF) | `npm run data:import:dceo-capital -- --input <pdf>` |
| `state_awards.csv` | Illinois GATA award snapshot | manual export |

---

## Annual, manual

| File | Source |
| --- | --- |
| `foundation_grants_geocoded.csv` | IRS 990 filings |
| `foundation_grants_tier1_expansion.csv` | IRS 990-PF e-file XML (Tier-1 funders) |
| `foundation_grants_phase2_expansion.csv` | IRS 990-PF / 990 e-file XML (Phase-2 funders, `scripts/foundation/` pipeline) |
| `lihtc_chicago.csv` | HUD LIHTC placed-in-service database |
| `nmtc_chicago.csv` | CDFI Fund NMTC public data |
| `cra_by_community_area.csv` | FFIEC CRA disclosure |
| `cdfi_by_geo.csv` | CDFI Fund transaction-level report |

---

## Per announcement

Updated when something is announced — there is no schedule to wait for.

| File | Source |
| --- | --- |
| `cdg_awards.csv` | Community Development Grant press-release rounds |
| `chicago_prize.csv` | Pritzker Traubert Foundation Chicago Prize |
| `developments.csv`, `developments_major.csv` | curated megaproject list |
| `ellen_nof_awardees.tsv` | partner-supplied corridor list |

---

## Never — closed programs

These are **frozen by design**. Every one is a closed relief program whose
published row count and dollar total are pinned as integrity contracts in
`lib/__tests__/`, and those pins stay absolute precisely because the programs
cannot change. Re-pulling them would either fail (no API) or silently break a
contract that exists to catch corruption.

| File | Program | Pinned contract |
| --- | --- | --- |
| `cook_county_source_grants_2023.csv` | Cook County Source Grant | 3,003 rows / $50,050,000 |
| `cook_county_cares_2020_programs.csv` | Cook County 2020 CARES | 4 context rows / $77M umbrella |
| `illinois_business_interruption_grants.csv` | Illinois BIG | 8,998 rows / $276,275,000 |
| `illinois_hospitality_emergency_grant_awards.csv` | IL Hospitality Emergency | 699 rows / $13,995,000 |
| `illinois_back_to_business_awards.csv` | Illinois B2B | 6,687 rows / $249,510,000 |
| `sba_restaurant_revitalization_chicago.csv` | SBA RRF | 100,828 source / 1,523 Chicago |
| `chicago_arpa_road_to_recovery_programs.csv` | Chicago ARPA | 77 programs / 67 financial |

`geocode-cache.json` is not a source at all — it is a derived cache, read and
written by the export itself.

---

## Running it by hand

```bash
# Everything: re-pull all six live sources, then regenerate the export.
npm run data:refresh:live

# Look before you leap — fetch and report the delta, write nothing.
npx tsx scripts/refresh/refresh-live-sources.ts --dry-run

# One or two sources only.
npx tsx scripts/refresh/refresh-live-sources.ts --only sbif,tif

# Refresh the inputs but skip the export (e.g. batching several changes).
npx tsx scripts/refresh/refresh-live-sources.ts --skip-export

# Write the markdown delta table somewhere (this is how the PR body is built).
npx tsx scripts/refresh/refresh-live-sources.ts --summary-out /tmp/delta.md
```

The script writes a file **only when its bytes actually change**, fails loudly
per source but keeps going, prints a summary table, and exits nonzero if any
source failed. Re-running it immediately should report every source `unchanged`
— if it does not, something is non-deterministic and that is a bug.

After any manual change to a curated input, run `npm run data:export:investment`.

## When a source shrinks

`lib/__tests__/community-investment.test.ts` holds monotonic floors
(`REFRESHED_SOURCE_FLOORS`) for the five refreshed export sources. A source that
loses more than 2% of its records fails the suite and the refresh PR arrives
titled `[NEEDS ATTENTION]`.

That is working as intended. Upstream republications do lose rows — HUD removed
431 CDBG activity ids in July 2026 — and the point is that a person decides
whether the loss is real. If it is, **re-baseline the floor in the same PR that
accepts the data**, so the new number is something a reviewer approved rather
than something a job assumed.
