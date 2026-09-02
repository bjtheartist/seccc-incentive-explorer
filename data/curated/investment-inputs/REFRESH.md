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

The run is three steps, in this order, and the order is load-bearing:

1. **refresh** — re-pull each live source, rewrite the input only if its bytes
   changed;
2. **regenerate the manifest** — `manifest.json`'s `contentHash` per file;
3. **export** — `npm run data:export:investment`.

Step 2 is a hard precondition for step 3, not bookkeeping. The export verifies
every input's live sha256 against the `contentHash` committed in `manifest.json`
and throws on a mismatch — and refreshing an input is exactly what creates that
mismatch. (Skipping step 2 is what broke the 2026-09-02 run: the first month a
source actually moved, the export died on `nof_large.json`.) All three files —
the changed inputs *and* the regenerated `manifest.json` — land in the same
review PR, which is the only state in which that PR's test job can pass.

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
| `illinois_arts_council_fy26_q1_source.json`, `illinois_arts_council_fy26_q1_chicago.csv` | Illinois Arts Council Grant Summaries | `npm run data:import:iac-arts` against the newly published official table; re-baseline only after reviewing source and Chicago-subset contract changes |

---

## Annual, manual

**Foundation files** (previously hand-listed here and already caught omitting
Phase-3 — audit finding 13's "prose-only manifests rot" — now generated FROM
the shared manifest, one file, so this table cannot omit a published file
again):

<!-- GENERATED:FOUNDATION_CADENCE:BEGIN -->
| File | What it is | How it refreshes |
| --- | --- | --- |
| `foundation_grants_geocoded.csv` | Foundation grants — base parse (12 funders, pre-recon-discipline) | scripts/foundation/ base parse (predates the reconciliation gate) |
| `foundation_grants_tier1_expansion.csv` | Foundation grants — Tier-1 expansion (20 funders) | scripts/foundation/phase2_pipeline.py + phase2_integrate.py (PHASE_TARGETS=phase2_targets.json) |
| `foundation_grants_phase2_expansion.csv` | Foundation grants — Phase-2 expansion (65 funders, 80% coverage bar) | scripts/foundation/phase2_pipeline.py + phase2_integrate.py |
| `foundation_grants_phase3_expansion.csv` | Foundation grants — Phase-3 expansion (79 funders, census closeout) | scripts/foundation/phase2_pipeline.py (PHASE_TARGETS=phase3_targets.json) + phase3_integrate.py |

Source of truth: `data/curated/investment-inputs/manifest.json` (regenerate with
`npm run data:manifest:generate`). This table is generated FROM that manifest —
edit `scripts/lib/investment-manifest.ts`'s `AUTHORED_SOURCES`, never this table
directly.
<!-- GENERATED:FOUNDATION_CADENCE:END -->

| File | Source |
| --- | --- |
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

## Held source snapshots

These files are verified source captures but are deliberately not read by the
export. Refresh them only as part of resolving the documented release condition.

| File | Source | Hold |
| --- | --- | --- |
| `impact_grants_chicago_DO_NOT_EXPORT.csv` | Impact Grants Chicago official all-recipient roster | Downstream awards must be linked to intermediary inflows before either stage can enter a shared gross-dollar total without double-count risk |

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
# Everything: re-pull all six live sources, regenerate manifest.json, then
# regenerate the export — in that order.
npm run data:refresh:live

# Look before you leap — fetch and report the delta, write nothing.
npx tsx scripts/refresh/refresh-live-sources.ts --dry-run

# One or two sources only.
npx tsx scripts/refresh/refresh-live-sources.ts --only sbif,tif

# Refresh the inputs but skip BOTH the manifest regeneration and the export
# (e.g. batching several changes). You then own running data:manifest:generate
# before you export — the script says so out loud when you pass this.
npx tsx scripts/refresh/refresh-live-sources.ts --skip-export

# Write the markdown delta table somewhere (this is how the PR body is built).
npx tsx scripts/refresh/refresh-live-sources.ts --summary-out /tmp/delta.md
```

The script writes a file **only when its bytes actually change**, fails loudly
per source but keeps going, prints a summary table, and exits nonzero if any
source failed. Re-running it immediately should report every source `unchanged`
— if it does not, something is non-deterministic and that is a bug.

After any manual change to a curated input, run `npm run data:manifest:generate`
and **then** `npm run data:export:investment`. The export refuses to read an
input whose bytes no longer match the `contentHash` in `manifest.json`, so the
regeneration is not optional — commit the refreshed manifest alongside the input
that changed.

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
