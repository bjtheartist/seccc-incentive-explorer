# Foundation-universe pipeline (Phase 2+)

The parse-and-verify pipeline behind the private-foundation expansion files in
`data/curated/investment-inputs/`. Committed — not scratchpad — because the
committed CSVs must stay reproducible from source filings long after any
session directory is gone.

| file | role |
| --- | --- |
| `phase2_targets.json` | The 95-funder manifest that takes capacity coverage from 58.2% to the 80% bar (Sol plan §Tier-2): every uncovered funder ranked by SOI grants-paid capacity until the cumulative line crosses 80% of the $2.49B census total. |
| `phase2_pipeline.py` | Per-funder parse: ProPublica object-id resolve → gt990datalake XML fetch (whole-document DTD/ENTITY refusal) → 990-PF Part XV / 990 Schedule I rows + printed control totals → $1 reconciliation gate → Chicago filter → cached Census geocode → precedent-first locType. Checkpoints one JSON per EIN; `GEOCODE_CACHE` env shards the geocode cache for parallel runs. |
| `phase2_integrate.py` | Checkpoints → the three committed CSVs (expansion / quarantine / reconciliation report), applying `phase2_overrides.json` (review-pass display names and exclusions), then restates every census disposition from what the reconciliation reports actually prove. |
| `phase2_overrides.json` | Written by the human/agent review pass, never by the pipeline: `name_overrides` (EIN → curated display name) and `excluded_funders` (EIN → reason). |

Honesty rails (identical to Tier-1): awarded ≠ received; amounts never
invented — a row with no published amount stays null; placeholder-family rows
("SEE ATTACHED/STATEMENT/…") are quarantined and counted, never guessed;
aggregate-only filers become funder-exchange targets, not zeroes; a filing that
fails its own printed total is quarantined whole. 990 Schedule I filers publish
itemized rows only — the sub-$5k remainder the form does not itemize is
disclosed as a bridge in the reconciliation report, never distributed.
