# Data-Intelligence Sweep — November 2026

Run date: 2026-11-02 (first Monday of the month). First-Monday automated sweep
of `data/curated/investment-inputs/`. Honesty rails from `README.md` and
`REFRESH.md` apply throughout: awarded ≠ received; announced ≠ awarded;
appropriations/authorized ceilings are not awards; unverifiable amounts stay
null; recipient HQ ≠ project site; closed programs are historical.

This sweep starts fresh from `main` per the delivery rules. It follows the
October 5, 2026 sweep (`sweeps/2026-10-findings.md`, branch `sweep/2026-10`,
still an open, unmerged draft PR as of this run), which resolved all 13
tracked foundation EINs against an S3 datalake index dated 2026-08-25, found
6 megaproject updates, and found nothing new for CDG or Chicago Prize. None
of October's proposed changes are included here; this sweep independently
re-checked from the same baselines through today.

**DCEO Capital Appropriations (item 5) is out of scope this month.** The task
only requires that check in January, April, July, and October; November is
not one of those months, so it was not run.

## Delta table

| # | Source | Result | Action taken |
|---|---|---|---|
| 1 | CDG rounds | Nothing new since June 2026 | No changes |
| 2 | Chicago Prize | Nothing new since the Dec 2025 winner | No changes |
| 3 | Foundation 990s | **1 of 13 EINs has a confirmed newer itemized filing** (Chicago Community Trust, 4,316 rows, $1,215,357,534 — does **not** tie exactly to the filing's printed total; see delta below). 12 of 13 confirmed no newer filing. | New candidate CSV for a human reviewer; no change to any committed `foundation_grants_*.csv` |
| 4 | Megaprojects | 2 confirmed updates (Foundry Park groundbreaking; Bears/Bridgeport concept) | Proposed-updates CSV only, no direct edits |
| 5 | DCEO Capital Appropriations | Not a check month (Jan/Apr/Jul/Oct only) | Skipped |

---

## 1. CDG rounds — nothing new

No City of Chicago Community Development Grant round was found announced
after the already-captured **June 2026** round (~$42.5M, 56 projects,
`chicago.gov` press release) and on or before 2026-11-02.

**Reachability:** WebFetch failed with DNS resolution errors (`ENOTFOUND`)
for every external host attempted this sweep, including a Wikipedia control
— broader than the chicago.gov/web.archive.org-specific block noted in
September and October. All findings below rest on WebSearch's indexed
snippets, not directly fetched pages. A maintainer running from an
unblocked environment should re-verify directly against `chicago.gov/cdg`
and DPD's news feed.

A January 2026 round (~$33M, 58 businesses/orgs, part of a $90M
public-private figure) and the already-captured June 2026 round (~$42.5M, 56
grants) were both reconstructed from search snippets, consistent with
what's already in `cdg_awards.csv`. No round dated after June 2026 appears
in any search result.

**Adjacent-but-out-of-scope program, confirmed NOT CDG** (not added to
`cdg_awards.csv`, consistent with the file's existing scope boundary):

| Program | Date | Amount | Why excluded |
|---|---|---|---|
| Neighborhood Opportunity Fund (NOF) | Aug 14, 2025 | ~$1.9M, 14 finalists | Separate DPD program, routinely co-announced with CDG in city press releases but tracked as distinct in this dataset |

---

## 2. Chicago Prize — nothing new; finalist matching-grant figure now corroborated (still not primary-sourced)

No evidence of any Chicago Prize activity (new call for applications, new
finalists, new winner) since the December 2025 "Reclaiming Chicago" award,
already in `chicago_prize.csv`.

**The 2025 finalist matching-grant amount — $650,000 — is now corroborated by
two independently-worded search snippets** (City Club of Chicago's June 11,
2025 event page, and ABC7 Chicago's coverage), both naming the same four
2025 finalists already in the CSV and the same $650,000 figure. This is
stronger evidence than the single-snippet "$650,000 vs. conflicting $500,000"
state the August 2026 sweep left it in, but **neither page was successfully
fetched** (same network block as Task 1) — it remains search-snippet
evidence, not a directly-read primary source. **Not added to the CSV** per
the "unverifiable amounts stay null" rule; the existing finalist rows'
`amount` field stays blank. A maintainer with working WebFetch/network
access could likely close this out in one fetch of either
`cityclub-chicago.org` or `ptfound.org/chicago-prize`.

For context only (not changed): earlier-round per-finalist matching amounts
were $100,000 (2019) and $500,000 (2022) — the $650,000 figure for 2025 is
consistent with that escalation trend.

---

## 3. Foundation 990s — 1 newer itemized filing found; does not reconcile exactly

**Method:** ProPublica Nonprofit Explorer was DNS-blocked this session
(`projects.propublica.org` not resolvable). Fell back to the IRS e-file S3
datalake, which now publishes a newer cumulative index than the one prior
sweeps used —
`index_all_years_efiledata_xmls_created_on_2026-10-28.csv` (3.3GB, rows
indexed through 2026-10-27; no 2026-11-xx index exists yet). Streamed and
grepped the full index for all 13 EINs (156 matching filing-index rows),
then diffed each EIN's filing history against the October 2026 sweep's own
recorded object_id/tax-year baseline (not the original README baseline) —
i.e., checking what's new **since the last sweep**, not since the start of
this project. Every XML fetched was checked for `<!DOCTYPE`/`<!ENTITY`
before parsing; neither appeared in the one filing examined below.

| Foundation | EIN | Verdict |
|---|---|---|
| MacArthur Foundation | 237093598 | No newer filing (Oct baseline still latest) |
| **Chicago Community Trust** | 362167000 | **Newer filing found — extracted, see below** |
| Robert R McCormick Foundation | 363689171 | No newer filing (Oct baseline still latest) |
| Joyce Foundation | 366079185 | No newer filing (Oct baseline still latest) |
| Field Foundation of Illinois | 366059408 | No newer filing (Oct baseline still latest) |
| Arie and Ida Crown Memorial | 366076088 | No newer filing (Oct's object_id 202533159349101983 still latest) |
| Polk Bros Foundation | 366108293 | No newer filing (Oct's object_id 202641069349100149 still latest) |
| Lloyd A Fry Foundation | 366108775 | No newer filing (Oct's object_id 202521289349101547 still latest) |
| Grand Victoria Foundation | 364107162 | No newer filing (Oct's object_id 202533189349105313 still latest) |
| Woods Fund of Chicago | 363917968 | No newer filing (Oct's object_id 202533109349101883 still latest) |
| Wieboldt Foundation | 362167955 | No newer filing (Oct's object_id 202502889349101705 still latest; a TY2022 990-T also indexed, not grant-bearing) |
| Pritzker Traubert Foundation | 364347781 | No newer filing (Oct's object_id 202543099349102304, aggregate-only, still latest) |
| Steans Family Foundation | 363486843 | No newer filing (Oct's object_id 202513219349100446, aggregate-only, still latest) |

**Scope caveat:** this covers filings indexed through ~2026-10-27, the
datalake's latest published index. Anything e-filed and indexed in the last
~5 days before this run (2026-10-28 through 2026-11-02) is not yet visible
to this method — a gap inherent to the datalake's publication cadence, not
a gap in method.

### Chicago Community Trust — newer filing, reconciliation gap flagged

New filing: Form 990, TY2024 (period 2024-10-01 to 2025-09-30), object_id
`202632239349302058`, indexed 2026-10-27 (inside this sweep's window). The
October baseline had only confirmed TY2023 (Oct2023–Sep2024) as current for
this funder. **Chicago Community Trust already has ~2,900 rows under its
earlier filing in the committed `foundation_grants_geocoded.csv`** — this is
a refresh/newer-year candidate for an already-present funder, not a new
funder; it would need to supersede, not simply append to, the existing rows
if it ships, and the funder-disjointness assumption the Tier-1/Phase-2/
Phase-3 files rely on does not apply here since this funder already has
exported rows.

Extracted the Schedule I `RecipientTable` repeating group directly from the
XML (TaxYr confirmed as `2024` from the XML itself, not inferred from the
object_id prefix):

| Metric | Value |
|---|---|
| Itemized rows | 4,316 |
| Parsed sum | $1,215,357,534 |
| Filing's printed total (Form 990 Part I, `CYGrantsAndSimilarPaidAmt`) | $1,225,337,518 |
| Delta | $9,979,984 (~0.8%) |

**Unlike every prior foundation extraction in this project (all of which
tied to $0 delta), this one does not reconcile exactly.** The Schedule I
XML for this filing contains no separate individual-grants/scholarship block
that could independently account for the gap, so the delta could not be
further attributed from the XML alone — it is reported here rather than
rounded away or silently absorbed. A human reviewer should resolve this
(e.g. by checking the filing's PDF directly for a grants-to-individuals
schedule, or Schedule I Part III) before this candidate ships, same as the
existing attachment-gap handling for aggregate-only funders.

**Extracted rows** (verified independently by re-summing the saved CSV with
a fresh Python pass — 4,316 rows, $1,215,357,534, matching the research
agent's reported figures exactly): committed to
`sweeps/2026-11-candidate-foundation-grants.csv`
(`foundation,tax_year,recipient,address_line1,city,state,zip,amount,purpose,source_form`),
same posture as October's candidate file — raw, unsourced-city-filtered,
ungeocoded, **not** merged into any committed foundation file and **not**
read by the export. Largest grants (first 5 of 4,316, by original source
order, not amount-sorted) are all large, non-Chicago, pass-through-style
grants to national intermediaries (ImpactAssets, Climate Imperative
Foundation, Breakthrough Energy Catalyst Foundation, Low Income Investment
Fund, National Fish and Wildlife Foundation — $30-47M each) — a reminder
that this trust's grantmaking spans far beyond Chicago and the eventual
Chicago-recipient filter will cut the row count substantially, as it did for
every prior foundation file.

---

## 4. Megaprojects — 2 confirmed updates, proposed for human review

Checked all priority volatile projects (Bears, One Central, Lincoln
Yards/Foundry Park, White Sox Railyards, IQMP/PsiQuantum, Bronzeville
Lakefront, Obama Center) plus a lighter pass on other tracked projects, for
anything dated between October 5, 2026 (the last sweep) and today.

### Confirmed updates (proposed, see `2026-11-proposed-updates-developments_major.csv`)

1. **Lincoln Yards / Foundry Park** — Phase 1 groundbreaking occurred as
   scheduled on **Oct. 21, 2026**, on the former Finkl Steel site (Mayor
   Johnson and Kayne Anderson's David Selznick attended). This resolves
   October's flagged risk that it might slip to November — it did not slip.
   4-source confirmed (Sun-Times, Crain's, Bisnow, Construction Review
   Online). No dollar-figure change; a `status_2026` change from `announced`
   to `under_construction` is proposed for maintainer judgment, not applied.
2. **Chicago Bears Stadium** — on **Oct. 28, 2026**, architecture firm SOM
   released unsolicited conceptual renderings for a domed Bears stadium at
   the Rate Field/Bridgeport site, contingent on the White Sox relocating to
   the proposed "Railyards" site. The Bears have not endorsed this and
   maintain Hammond, IN remains their sole focus; WBEZ frames both this
   concept and the Railyards plan as having "gone nowhere" since September.
   No site, status, or dollar change to the Hammond row. 4-source confirmed
   that the event occurred (Sun-Times, WBEZ, Bisnow, Fox32); single-source/
   unconfirmed on any actual Bears interest.

### Checked, no change found (priority projects)

- **White Sox "Railyards"** — no movement past the already-known Sept 5-9,
  2026 announcement; WBEZ's Oct 28 "gone nowhere" characterization
  reconfirms no-change rather than indicating one.
- **One Central** — essentially no dateable 2025-2026 coverage found this
  sweep. **Correction to a prior sweep's own research note, not to any
  committed file:** the October findings report described "Pritzker's
  rejection of a KPMG-study funding ask" as an unresolved date to check;
  this sweep found no 2025-2026 source naming KPMG at all, and the only
  dateable feasibility-study reference found (2021) was attributed to WSP,
  not KPMG. `developments_major.csv` itself never contained a KPMG
  reference — this was only ever prose in a sweep report, now flagged so a
  future sweep doesn't keep chasing a possibly-misattributed firm name.
  Recommend checking Illinois GOMB or Landmark Development press releases
  directly next time rather than general web search.
- **Bronzeville Lakefront** — 2-acre park still tracking Q4 2026, no new
  news.
- **Obama Presidential Center** — no material news this window.
- **IQMP/PsiQuantum** — last concrete news predates the window (Aug 2026
  STEM/workforce investment).

### Flagged, unresolved (not proposed as edits — informational only)

- **Bally's Chicago Permanent Casino** — no resolution found to the Aug
  2026 construction-slowdown/video-gambling dispute between Bally's and the
  City. Last confirmed status is Aug 17-21, 2026 (aldermen demanding full
  resumption; Bally's "going concern" disclosure; early-2027 opening target
  maintained). No source found confirming resumed construction, formal
  default, or a new opening date as of 2026-11-02. Single-source/stale —
  worth a dedicated, date-bounded search next sweep rather than general web
  search.
- **Northwestern Memorial Cancer Tower** — a June 2026 report projected
  Phase 1 demolition for "late 2026." No source confirms whether this has
  actually begun. Single-source, unconfirmed.
- **1901 Project** — minor, single-source construction-progress item (Oct
  20, 2026 Sun-Times: Phase 1 construction has removed 1,100+ parking spots
  around the United Center); consistent with, not additive to, the
  already-known Sept 2026 design/permit milestones. Not proposed as an edit.

### Secondary pass (remaining lower-priority projects)

No in-window status-change news found for: Southbridge, Riverline/Southbank,
Advocate Health South Side, Ogden Commons, Fulton Labs, Pullman hotel, 1000M,
43 Green, Halsted Landing/Pointe, Inherent L3C, Chicago Fire FC Stadium,
Salesforce Tower, Bank of America Tower. (`Inherent L3C` could not be
located under that name via general web search this sweep — it remains
correctly and well-sourced in `developments_major.csv` under its full name
"Inherent L3C modular homes (Humboldt Park / Cook County pilot)"; this is a
search-method gap, not evidence of any problem with the existing row.)

---

## 5. DCEO Capital Appropriations — not a check month

Per the task's own schedule, this check runs only in January, April, July,
and October. November 2026 is not one of those months, so it was skipped
entirely this sweep. Next scheduled check: January 2027.

---

## Files changed this sweep

- `data/curated/investment-inputs/sweeps/2026-11-findings.md` — this report
- `data/curated/investment-inputs/sweeps/2026-11-proposed-updates-developments_major.csv` —
  new, 3 proposed updates (2 note refinements + 1 proposed status change) for
  a human reviewer
- `data/curated/investment-inputs/sweeps/2026-11-candidate-foundation-grants.csv` —
  new, 4,316 candidate grant rows from Chicago Community Trust's newly-found
  TY2024 filing, for a human reviewer to resolve the $9,979,984 reconciliation
  gap and run through the standard Chicago-filter/geocoding/supersede pipeline
  before it can ship

No changes to `cdg_awards.csv`, `chicago_prize.csv`, any committed foundation
grants file, `developments_major.csv` itself, or
`dceo_capital_appropriations.csv` — nothing cleared this sweep's verification
bar for a direct edit this cycle. `npm run data:export:investment` was
**not** run — no curated input file that the exporter reads changed.
