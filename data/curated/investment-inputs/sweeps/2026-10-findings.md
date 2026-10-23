# Data-Intelligence Sweep — October 2026

Run date: 2026-10-05. First-Monday-of-month automated sweep of
`data/curated/investment-inputs/`. Honesty rails from `README.md` and
`REFRESH.md` apply throughout: awarded ≠ received; announced ≠ awarded;
appropriations/authorized ceilings are not awards; unverifiable amounts stay
null; recipient HQ ≠ project site; closed programs are historical.

This sweep follows the September 7, 2026 sweep (`sweeps/2026-09-findings.md`,
still an open, unmerged draft PR — #288), which found no new CDG rounds, no
new Chicago Prize activity, no confirmed newer foundation 990 filings (most
index sites network-blocked that session), and proposed two megaproject
updates (White Sox "Railyards," Bears site due diligence) still awaiting
human review. This sweep starts fresh from `main` per the delivery rules, so
none of September's proposed changes are included here, and some items below
independently re-confirm or extend what September already found.

## Delta table

| # | Source | Result | Action taken |
|---|---|---|---|
| 1 | CDG rounds | Nothing new since June 2026 | No changes |
| 2 | Chicago Prize | Nothing new since the 2025 winner | No changes |
| 3 | Foundation 990s | **6 of 13 EINs had a confirmed newer itemized filing** (2,133 grant rows, $157.3M); 5 confirmed current; 2 confirmed aggregate-only (no itemization) | New candidate CSV for a human reviewer; no change to any committed `foundation_grants_*.csv` |
| 4 | Megaprojects | 6 confirmed updates (Lincoln Yards/Foundry Park, Bears, 1901 Project, Thompson Center/Google, LaSalle Street, Chase Tower) | Proposed-updates CSV only, no direct edits |
| 5 | DCEO Capital Appropriations | Check month (October) — inconclusive, access blocked | No changes; informational note below |

---

## 1. CDG rounds — nothing new

No City of Chicago Community Development Grant round was found announced
after the already-captured June 2026 round (~$42.5M, 56 projects) and before
today (2026-10-05).

**Reachability:** chicago.gov and web.archive.org were both egress-blocked
at the network level this session (confirmed error, not a site-side
anti-bot block) — the same failure mode as the September sweep. Findings
rest on WebSearch's indexed snippets of chicago.gov, Block Club Chicago,
Chicago Sun-Times, WBEZ, CBS Chicago, Chicago Defender, Chicago Crusader,
Austin Weekly News, and Chicago Construction News, not direct fetches.

**Adjacent-but-out-of-scope programs confirmed NOT CDG** (none added to
`cdg_awards.csv`, consistent with the file's existing scope boundary):

| Program | Date | Amount | Why excluded |
|---|---|---|---|
| Neighborhood Opportunity Fund (NOF) | Sept 2026 | $3.8M+ / 18 businesses | Separate DPD program, even when historically co-announced with CDG |
| Neighborhood Market Grant Program (BACP) | deadline Oct 5, 2026 | $10,000 grants | Different department, application window not an award round |
| Small Business Improvement Fund (SBIF) | window opened Oct 1, 2026 | n/a | Reimbursement fund for existing buildings, not CDG |
| "Adopt-a-Landmark" fund (historic preservation) | Oct 2026 | $249,500 (Avalon Regal Theater) + 2 others, $666,400 total | Separate historic-preservation fund, distinct from the Jan 2026 DPD historic-preservation grant release |

One unawarded signal, not a finding: a CDG-Small application deadline of
08/14/2026 was found with no award announcement yet as of today — worth a
re-check next sweep, not acted on now.

---

## 2. Chicago Prize — nothing new

No evidence of a new Chicago Prize call for applications, finalist
announcement, or winner since the December 2025 "Reclaiming Chicago" award.
Consistent with the program's historical 2-3 year cadence (2020 → 2023 →
2025); a next-cycle timeline could not be independently verified or refuted
from any source found.

**2025 finalist matching-grant amount — still not citable.** Two independent
WebSearch queries this sweep both converged on **$650,000** per finalist
(apparently traceable to Block Club Chicago's June 12, 2025 finalist
article), which is consistent with — and now corroborates — the figure the
August 2026 sweep originally found alongside a conflicting "$500,000" claim.
However, `blockclubchicago.org` and `ptfound.org` were both egress-blocked
again this session (same failure mode as September), so this was never
directly fetched. **Not added to the CSV** — still search-snippet-derived,
not a primary-source read. A maintainer with unblocked access could likely
resolve this in one fetch.

**Chicago Talent Challenge (separate PTF program, out of scope, informational
only):** confirmed — in March 2026, PTF announced its first-ever winner,
"HealthCatalyst Chicago" (City Colleges of Chicago + Cook County Health +
other employer partners), a $5M award to train/place Chicagoans in
healthcare roles (~1,000 jobs over 3 years). Sources:
https://colleges.ccc.edu/2026/03/02/532891/,
https://cookcountyhealth.org/press-release/pritzker-traubert-foundation-awards-first-ever-5-million-to-chicago-talent-challenge-to-city-colleges-of-chicago-cook-county-health/,
https://www.ptfound.org/chicago-talent-challenge/recipient. Not a Chicago
Prize round — no action taken on `chicago_prize.csv`.

---

## 3. Foundation 990s — 6 newer filings found and extracted, reconciled exactly

This sweep resolved every EIN that the August and September sweeps had left
"unconfirmed" due to blocked network access. Rather than guessing object_ids
one at a time, this sweep located and grepped the S3 datalake's own
`index_all_years` CSV (dated 2026-08-25) for all 13 EINs, then fetched and
read `TaxYr` directly from the XML of every filing newer than/unconfirmed
against the already-captured baseline — never inferring tax year from an
object_id's leading digits (an object_id's prefix reflects IRS *posting*
date, not the filing's tax year — a lesson carried over from the September
sweep). Direct access to ProPublica, Candid, GuideStar, CauseIQ, and IRS.gov
was blocked at the network-egress level this session too (confirmed via
direct `curl`, not just WebFetch); the S3 datalake fallback was reachable
and resolved all 13 EINs without exception. **Every XML fetched was checked
for `<!DOCTYPE`/`<!ENTITY` before parsing — zero hits, nothing rejected.**

| Foundation | EIN | Verdict | Tax Yr | Object ID |
|---|---|---|---|---|
| MacArthur Foundation | 237093598 | No newer filing (TY2024 confirmed current) | — | — |
| Chicago Community Trust | 362167000 | No newer filing (TY2023, Oct2023-Sep2024, confirmed current for the grant-bearing Form 990; a newer TY2024 Form 990-T also exists but carries no Schedule I/grant data) | — | — |
| Robert R McCormick Foundation | 363689171 | No newer filing (TY2024 confirmed current) | — | — |
| Joyce Foundation | 366079185 | No newer filing (TY2024 confirmed current) | — | — |
| Field Foundation of Illinois | 366059408 | No newer filing (TY2024, May2024-Apr2025, confirmed current) | — | — |
| **Arie and Ida Crown Memorial** | 366076088 | **Newer filing found — extracted** | 2024 | 202533159349101983 |
| **Polk Bros Foundation** | 366108293 | **Newer filing found — extracted** | 2024 (Sep2024-Aug2025) | 202641069349100149 |
| **Lloyd A Fry Foundation** | 366108775 | **Newer filing found — extracted** | 2023 (Jul2023-Jun2024) | 202521289349101547 |
| **Grand Victoria Foundation** | 364107162 | **Newer filing found — extracted** | 2024 | 202533189349105313 |
| **Woods Fund of Chicago** | 363917968 | **Newer filing found — extracted** | 2024 | 202533109349101883 |
| **Wieboldt Foundation** | 362167955 | **Newer filing found — extracted** | 2024 | 202502889349101705 |
| Pritzker Traubert Foundation | 364347781 | Newer filing found — **aggregate-only, confirmed, nothing to extract** (single "SEE ATTACHED" row, $120,496,827 total) | 2024 | 202543099349102304 |
| Steans Family Foundation | 363486843 | Newer filing found — **aggregate-only, confirmed, nothing to extract** (2 pass-through rows, "GRANTS-SEE ATTACHED LIST," $21,919,908 + $19,374,344) | 2024 | 202513219349100446 |

### Extraction and reconciliation — the 6 itemized filings

All 2,133 grant rows were extracted in the project's standard pre-geocoding
schema (`foundation,tax_year,recipient,address_line1,city,state,zip,amount,
purpose,source_form`) to
`sweeps/2026-10-candidate-foundation-grants.csv`. Every filing was gated the
same way the Tier-1/Phase-2/Phase-3 expansions were: the parsed sum of every
`GrantOrContributionPdDurYrGrp` row must tie to the filing's own printed
Part XV grants-paid total.

| Foundation | Tax Yr | Rows | Parsed Sum | Filing's Printed Total | Delta |
|---|---|---|---|---|---|
| Arie and Ida Crown Memorial | 2024 | 897 | $115,224,085 | $115,224,085 | $0 |
| Polk Bros Foundation | 2024 | 568 | $19,251,491 | $19,251,491 | $0 |
| Lloyd A Fry Foundation | 2023 | 404 | $9,995,219 | $9,995,219 | $0 |
| Grand Victoria Foundation | 2024 | 114 | $6,485,223 | $6,485,223 | $0 |
| Woods Fund of Chicago | 2024 | 120 | $5,573,000 | $5,573,000 | $0 |
| Wieboldt Foundation | 2024 | 30 | $765,217 | $765,217 | $0 |
| **Total** | | **2,133** | **$157,294,235** | | **$0** |

Every filing reconciles exactly — $0 delta across the board, no rounding
issues, no attachment gaps. This sweep independently re-verified the sums
against the raw CSV (not just taken on the sub-agent's word).

**This is a candidate CSV only** — raw, unsourced-city-filtered, and
ungeocoded. It is NOT merged into `foundation_grants_tier1_expansion.csv` or
any other committed foundation file, and it is not read by the export. A
maintainer should run it through the same Chicago-recipient filter,
geocoding, and funder-disjointness check the existing Tier-1/Phase-2/Phase-3
pipelines use (`scripts/foundation/`) before it can ship. One foundation,
Crown Memorial, already shows a clearly non-Chicago row in its raw data
(a Scottsdale, AZ recipient) — exactly the kind of row that filter is for.

**No change to any committed file this sweep** — the candidate CSV is new,
sitting only under `sweeps/`, same posture as the quarantine files already
in this directory.

---

## 4. Megaprojects — 6 confirmed updates, proposed for human review

Checked all priority volatile projects (Bears, One Central, Lincoln
Yards/Foundry Park, White Sox, IQMP/PsiQuantum, Bronzeville Lakefront, Obama
Center, Chicago Fire FC Stadium) plus a lighter pass on the remaining ~31
lower-priority projects, for anything dated between September 7, 2026 (the
last sweep) and today.

### Confirmed updates (proposed, see `2026-10-proposed-updates-developments_major.csv`)

1. **Lincoln Yards / Foundry Park** — the ~$202M TIF infrastructure
   financing already described as "estimated/lined up" in the current CSV
   was **approved by City Council on Sept 23, 2026** ($201.6M confirmed TIF,
   ~$235M total with developer contribution), including funding for a 606
   Trail extension. 2-source confirmed (Block Club + The Real Deal). Flag
   only, not proposed as an edit: a trade source suggests the Phase 1
   groundbreaking (previously targeted October 2026) may be slipping toward
   November 2026 — not confirmed as having happened or not.
2. **Chicago Bears Stadium (Hammond, IN)** — Oct 1, 2026: NFL Commissioner
   Goodell met with Gov. Pritzker and Illinois legislative leaders, described
   as aimed at "keeping the Bears in Illinois." Political signal only; the
   Bears maintain Hammond remains their sole focus; no site or dollar change.
   3-source confirmed.
3. **1901 Project (United Center campus)** — design revision (rooftop park
   dropped/relocated, music hall interior renderings released, Phase 1
   permits pulled), Sept 16-18, 2026. No financing change. 2-source
   confirmed.
4. **Thompson Center / Google** — Sept 16, 2026: new renderings released;
   move-in timeline pushed from 2027 to 2028. No cost change. 2-source
   confirmed.
5. **LaSalle Street Reimagined** — Sept 9, 2026: the program's first
   completed conversion (Bellwether Residences, 79 W. Monroe, 117 units)
   opened for leasing. Program-wide total unchanged. 2-source confirmed.
6. **Chase Tower Renovation** — Sept 8, 2026: JPMorgan Chase opened a
   renovated 57th-floor client center, an incremental first-phase milestone.
   No total cost disclosed (unchanged). 2-source confirmed.

None of these change any `announced_investment_usd` figure or `status_2026`
value — all are proposed as `public_subsidy_note`/`investment_note`
refinements for a human reviewer, per the "no amount edits without 2-source
confirmation" delivery rule (all 6 are in fact 2+ source confirmed, but none
involve a dollar-figure change in the first place).

### Checked, no change found (priority projects)

- **White Sox "Railyards" proposal** — no material movement past the
  already-known Sept 5-9, 2026 announcement; nothing dated after Sept 7
  found this sweep.
- **One Central** — Pritzker's rejection of the KPMG-study funding ask could
  not be pinned to a date inside this sweep's window with 2 reliable sources
  (conflicting secondary summaries dated it anywhere from May 2025 to Sept
  2026) — flagged for a manual date-check next sweep, not treated as an
  in-window finding.
- **Bronzeville Lakefront** — 2-acre park still tracking Q4 2026, no new
  news.
- **Obama Presidential Center** — only routine ticket-release news, no
  material project change.
- **IQMP/PsiQuantum** — last concrete news predates the window (March 2026
  steel install); nothing new found.

### Secondary pass (remaining lower-priority projects)

No in-window status-change news found for: Southbridge, Riverline/Southbank,
Advocate Health South Side, Ogden Commons, Salesforce Tower, Bank of America
Tower, Fulton Labs, Pullman hotel (Hampton by Hilton), 1000M, Bally's Chicago
Casino, 43 Green, Halsted Landing/Pointe, Northwestern Memorial Cancer Tower,
Inherent L3C.

---

## 5. DCEO Capital Appropriations — check month, inconclusive

October is a Jan/Apr/Jul/Oct check month. The committed snapshot is the FY26
Capital Appropriation Listings PDF created 2026-04-10 (885 pages, sha256
`670142211a2e76a110be1de119509b447af79edcccb171bd348deb75c91d91d3`), at
`https://dceo.illinois.gov/content/dam/soi/en/web/dceo/aboutdceo/grantopportunities/documents/dceo-cap-approp-list.pdf`.

**Could not be determined this sweep.** Both `dceo.illinois.gov` and
`web.archive.org` were egress-blocked at the network level (same failure
mode affecting several other sources this sweep). WebSearch found no
distinct/newer PDF URL and no news coverage of a new DCEO capital-
appropriation-list posting specifically (general FY2027 Illinois state
capital-budget process news exists but is not evidence about this specific
document, which one search snippet describes as updated quarterly). Per
instructions, the PDF itself was not downloaded or parsed even
speculatively — that remains a separate manual/agent-assisted job. A future
sweep (or a maintainer) should re-check from an environment with unblocked
access to either domain.

---

## Files changed this sweep

- `data/curated/investment-inputs/sweeps/2026-10-findings.md` — this report
- `data/curated/investment-inputs/sweeps/2026-10-proposed-updates-developments_major.csv` —
  new, 6 proposed updates for a human reviewer
- `data/curated/investment-inputs/sweeps/2026-10-candidate-foundation-grants.csv` —
  new, 2,133 candidate grant rows from 6 foundations' newly-found 990-PF
  filings, for a human reviewer to run through the standard Chicago-filter/
  geocoding/dedupe pipeline before it can ship

No changes to `cdg_awards.csv`, `chicago_prize.csv`, any committed foundation
grants file, `developments_major.csv` itself, or `dceo_capital_appropriations.csv` —
nothing cleared this sweep's verification bar for a direct edit this cycle.
`npm run data:export:investment` was **not** run — no curated input file that
the exporter reads changed.
