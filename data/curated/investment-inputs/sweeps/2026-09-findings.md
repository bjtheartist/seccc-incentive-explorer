# Data-Intelligence Sweep — September 2026

Run date: 2026-09-07. First-Monday-of-month automated sweep of
`data/curated/investment-inputs/`. Honesty rails from `README.md` and
`REFRESH.md` apply throughout: awarded ≠ received; announced ≠ awarded;
appropriations/authorized ceilings are not awards; unverifiable amounts stay
null; recipient HQ ≠ project site; closed programs are historical.

## Delta table

| # | Source | Result | Action taken |
|---|---|---|---|
| 1 | CDG rounds | Nothing new since June 2026 | No CSV changes; one incidental gap flagged below |
| 2 | Chicago Prize | Nothing new since the 2025 winner | No changes |
| 3 | Foundation 990s | No confirmed newer filing for any of 13 EINs | No changes |
| 4 | Megaprojects | 1 material update (White Sox "Railyards" proposal) + 1 incremental update (Bears site due diligence) | Proposed-updates CSV only, no direct edits |
| 5 | DCEO Capital Appropriations | Skipped — not a Jan/Apr/Jul/Oct check month | N/A |

---

## 1. CDG rounds — nothing new

No City of Chicago Community Development Grant round was found announced
after the already-captured June 2026 round (~$42.5M, 56 projects) and before
today (2026-09-07).

Programs found in the Aug–Sept 2026 window that are **confirmed adjacent but
out of scope**, so none were added to `cdg_awards.csv`:

| Program | Date | Amount | Why excluded |
|---|---|---|---|
| My CHI. My Future. Micro-Grants (DFSS) | July 2026 | $750,000 / 43 grants | Different department (DFSS), not DPD/CDG |
| Community-Centered Wellness Microgrant Program (CDPH) | August 2026 | $600,000 | Chicago Dept. of Public Health, not DPD/CDG |
| Neighborhood Market Grant Program (BACP) | Aug 28–Sept 2, 2026 | Not yet awarded (applications just opened) | Program launch, not an award round; also a different department |
| **Neighborhood Opportunity Fund (NOF)** | Sept 1, 2026 | $3.8M+ / 18 businesses (drawn from 50 proposals; $10.5M total project value) | NOF is explicitly out of scope for `cdg_awards.csv` per the file's own tracking boundary, even when co-announced with CDG in the past — this round was NOF-only, no CDG bundling found |

Search-derived, unconfirmed context: CDG large/medium application windows
appear to run semi-annually (~February and ~August close, finalists announced
~4-5 months later), which would put the next award announcement around
**December 2026** — after this sweep's window. Not verified against an
official DCD policy document; treat as scheduling context only, consistent
with the same caveat in the August 2026 sweep.

Sources used (via WebSearch snippet synthesis — see reachability note below):
- https://www.chicago.gov (CDG program pages, snippet-level only)
- https://www.cbsnews.com/chicago/news/city-of-chicago-grants-neighborhood-projects/
- https://www.chicagoconstructionnews.com/chicago-awards-42-5-million-for-56-neighbourhood-development-projects/
- https://www.wbez.org/news/2026/01/07/city-grants-johnson-neighborhood-opportunity-fund
- https://www.wbez.org/money/2026/08/31/chicago-neighborhood-market-10-000-grants-food-access-south-west-sides
- https://www.austinweeklynews.com/2026/07/06/west-side-grant-money/ and /a-house-in-austin/

**Reachability:** chicago.gov, Chicago Defender, Chicago Crusader, and
web.archive.org were all unreachable this session (network-egress block).
Findings above rest on WebSearch's indexed snippets, not full-page fetches —
flagged per the honesty rails as indicative, not primary-source-verified.

### Incidental gap flagged, not acted on

While checking for post-June rounds, the researching pass surfaced two
recipients named in Austin Weekly News's coverage of the **already-captured**
June 2026 round that do not appear in `cdg_awards.csv`'s June 2026 rows:
"Clean Community" ($116,290, 5213 W. Potomac Ave.) and "Excel Community
Development Corp." ($92,106, 4825 W. Chicago Ave.). This is a possible
backfill gap in an existing round, not a new round, so it is out of this
sweep's scope and was **not** appended — flagging for a maintainer to verify
and backfill if confirmed. (The August 2026 sweep's own gap note — a named
$2.1M award at 5544 W. North Ave. with no recipient name published — also
still appears unresolved.)

---

## 2. Chicago Prize — nothing new

No evidence of a new Chicago Prize call for applications, finalist
announcement, or winner since the December 2025 "Reclaiming Chicago" award.
This is a negative finding based on absence of search-index evidence, not a
confirmed absence — ptfound.org and Block Club Chicago (the two most likely
first-to-report sources) were both unreachable this session, so a very recent
announcement could exist without having been indexed yet. Consistent with the
program's historical 2-3 year cadence (2020 → 2023 → 2025); next round not
expected until ~2027-2028.

**2025 finalist matching-grant amount — still unresolved.** The August 2026
sweep flagged conflicting figures ($650,000 vs. "up to $500,000") for the
three non-winning 2025 finalists' matching grants. This sweep could not reach
either primary source (blockclubchicago.org, ptfound.org — both blocked
again) to resolve it directly. WebSearch snippet synthesis suggests a
plausible reconciliation — $650,000 specific to the 2025 finalists (Block
Club, June 12, 2025) vs. $500,000 tracing to the 2022 round (Crain's Chicago
Business, describing 2022 finalists) — and, as arithmetic only (not a quoted
source figure), $500,000 × 5 non-winning 2022/23 finalists = $2.5M would match
the PTF half of the already-captured "$5M follow-on pool" note on the 2023
rows. This is flagged for a maintainer's judgment, not applied to the CSV:
it is inference from search snippets, not a verified primary-source figure.

**Chicago Talent Challenge (out of scope, informational only):** no activity
found beyond the already-known Feb 26, 2026 HealthCatalyst Chicago ($5M)
inaugural-winner announcement (City Colleges of Chicago + Cook County
Health). This is a separate PTF program from Chicago Prize; not tracked in
`chicago_prize.csv`.

**Reachability:** every target URL this sweep (blockclubchicago.org,
ptfound.org, chicagobusiness.com, chicago.suntimes.com, wbez.org,
leverforchange.org, therealdeal.com, abc7chicago.com, prnewswire.com) was
blocked at the network-egress level. All findings rest on WebSearch snippet
synthesis alone — no primary source was directly read this sweep.

---

## 3. Foundation 990s — no confirmed newer filings

All 13 tracked EINs were checked against their already-captured baseline tax
year. **No newer itemized filing was confirmed for any foundation.**

| Foundation | EIN | Newer filing confirmed? | Verification method |
|---|---|---|---|
| MacArthur Foundation | 237093598 | **No** (TY2024 confirmed current) | Direct XML fetch — positively verified |
| Chicago Community Trust | 362167000 | **No** (TY2023, period 2023-10–2024-09, confirmed current) | Direct XML fetch — positively verified |
| Robert R McCormick Foundation | 363689171 | **No** (TY2024 confirmed current; filed late, Nov 2025) | Direct XML fetch — positively verified |
| Joyce Foundation | 366079185 | **No** (TY2024 confirmed current) | Direct XML fetch — positively verified |
| Field Foundation of Illinois | 366059408 | **No** (TY2024, period 2024-05–2025-04, confirmed current) | Direct XML fetch — positively verified |
| Arie and Ida Crown Memorial | 366076088 | Unconfirmed | Search only — all itemization/index sites blocked |
| Polk Bros Foundation | 366108293 | Unconfirmed | Search only — all itemization/index sites blocked |
| Lloyd A Fry Foundation | 366108775 | Unconfirmed | Search only — all itemization/index sites blocked |
| Grand Victoria Foundation | 364107162 | Unconfirmed | Search only — all itemization/index sites blocked |
| Woods Fund of Chicago | 363917968 | Unconfirmed | Search only — all itemization/index sites blocked |
| Wieboldt Foundation | 362167955 | Unconfirmed | Search only — all itemization/index sites blocked |
| Pritzker Traubert Foundation | 364347781 | Unconfirmed (aggregate-only filer either way) | Search only — all itemization/index sites blocked |
| Steans Family Foundation | 363486843 | Unconfirmed (aggregate-only filer either way) | Search only — all itemization/index sites blocked |

**No CSV changes made** — per the sweep's own effort-budget rule, extraction
only happens when a newer filing is positively confirmed, and none was.

**Methodological note worth keeping for future sweeps:** an S3 e-file
object_id's leading digits reflect the IRS's processing/posting date, not the
filing's tax year — confirmed directly this sweep on the Field Foundation
filing (`object_id` prefixed `2026...`, posted ~May 2026, but its XML
`TaxYr` field is 2024, the year already captured). Any newer-looking
object_id must be opened and its `TaxYr`/`TaxPeriodBeginDt` read directly;
the ID prefix alone is not evidence of a newer year.

**Reachability:** `projects.propublica.org` and every other nonprofit-filing
index site tried (GuideStar, CauseIQ, Instrumentl, Charity Navigator, Candid,
IRS.gov) were hard-blocked at the network-egress level (CONNECT tunnel
rejected), not just site-side 403s. The S3 XML datalake
(`gt990datalake-rawdata.s3.amazonaws.com`) remained directly reachable and
was used for the 5 positively-verified "No" results above. No XML fetched
this sweep contained `<!DOCTYPE` or `<!ENTITY` — none were rejected on that
basis.

---

## 4. Megaprojects — 1 material update, 1 incremental update, rest unchanged

Checked all 8 priority projects (Bears, One Central, Lincoln Yards/Foundry
Park, White Sox, IQMP/PsiQuantum, Bronzeville Lakefront, Obama Center,
Chicago Fire FC Stadium) plus a lighter pass on the remaining 31.
`developments_major.csv` was last substantively updated 2026-07-28.

### Material update — White Sox South Loop Ballpark (proposed, see sidecar CSV)

Two linked developments, both since the last sweep:

- **Aug 14, 2026** — the federal government awarded Amtrak grants (reported
  combined across outlets as ~$572M-$696M) to relocate Amtrak's South Loop
  maintenance facility to a Union Pacific yard in Bridgeport; incoming
  White Sox owner Justin Ishbia's entity Canal Edge is separately
  contributing $125M+ to accelerate that relocation. This frees the 47-acre
  South Loop rail yard.
- **Sept 5, 2026** — Canal Edge unveiled renderings for **"The Railyards"**,
  a new proposed White Sox stadium site directly across the Chicago River
  from The 78, on that freed-up rail yard. Explicitly early-stage: a
  "months-long feasibility study" is just beginning, no site is approved, and
  **no total project cost has been published** (coverage says only "will be
  in the billions" — not a citable figure).

5-source confirmed for the Sept 5 proposal (Sun-Times, ABC7, Urbanize
Chicago, Chicago YIMBY, WGN); the Amtrak grant itself is confirmed via
Amtrak's own release plus Crain's, Sun-Times, and The Real Deal. The
original $1B Illinois-legislature ask for a ballpark at The 78 remains dead
— this is a genuinely new site, not a revival. No dollar figure is proposed
for `announced_investment_usd` since none was published. Proposed as
`public_subsidy_note` and `investment_note` updates for maintainer review in
`2026-09-proposed-updates-developments_major.csv` — not applied directly, and
the CSV explicitly leaves the `status_2026` ("stalled") call to a human,
since "feasibility study on a new site with no funding secured" doesn't
cleanly map to any of this file's existing status values.

### Incremental update — Chicago Bears Stadium (proposed, see sidecar CSV)

Aug 13, 2026 press conference (Chairman McCaskey, CEO Warren): due diligence
on the Lost Marsh site (Calumet Ave., Hammond) is now complete and deemed
viable; due diligence on a second candidate, Wolf Lake Terminal, is still
active; the team is weighing merging the two sites. No groundbreaking
timeline given, no site finalized. 4-source confirmed (Sun-Times, the team's
own official statement, NFL.com, Fox59). Does not change the $5B Hammond
figure already captured — proposed as an `investment_note` refinement only,
optional for the maintainer.

### Checked, no change found

- **One Central** — still stalled; NOVA/STAR-bond legislation that failed in
  spring 2026 has not been revived, no news of it returning to a fall 2026
  veto-session agenda.
- **Lincoln Yards / Foundry Park** — groundbreaking is still only *scheduled*
  for October 2026 (Phase 1, ~$800M); has not happened yet as of Sept 7.
  Southern "Lincoln Yards" parcel (Sterling Bay/JPMorgan): no new activity.
- **IQMP/PsiQuantum campus** — no construction/financing milestone; only news
  is a $250,000 PsiQuantum STEM-education gift to South Chicago schools
  (Aug 3, 2026), not a project-status change.
- **Bronzeville Lakefront** — 2-acre public park still targeted Q4 2026, no
  report yet of completion or delay.
- **Obama Presidential Center** — no material change; continued high ticket
  demand (Sept 2026-Jan 2027 window sold out), no new cost revisions.
- **Chicago Fire FC Stadium at The 78** — no news after the already-captured
  July 15, 2026 TIF approval (still staged as a proposed update from the
  August 2026 sweep, not yet applied to the main CSV by a maintainer).
  One secondary source referenced a "$750M privately-funded" figure, but
  that traces to the pre-window May 2026 naming-rights announcement already
  noted in the existing `investment_note` — not new information.

### Secondary pass (31 remaining projects)

No status-change headlines (groundbreaking/opening/stall/cancellation/
ownership/financing change) found within the Aug-Sept 2026 window for:
Southbridge, Riverline/Southbank, Advocate Health South Side, Ogden Commons,
Salesforce Tower, Bank of America Tower, Fulton Labs, Pullman hotel, 1000M,
Bally's Chicago Casino, Thompson Center/Google, LaSalle Street Reimagined
sub-projects, 43 Green, Halsted Landing/Pointe, Northwestern Memorial Cancer
Tower, Inherent L3C, Chase Tower Renovation. Everything found for these
either predates August 2026 or is routine leasing/construction-progress news,
not a status change in the sense this sweep tracks.

### Reachability

Several mainstream outlets (chicago.suntimes.com, abc7chicago.com,
chicagobusiness.com, fox32chicago.com, southsidesox.com, soxon35th.com) were
blocked for direct fetch; findings rely on WebSearch synthesis cross-checked
against directly-reachable sources (Amtrak's own release, chicagobears.com's
official statement, chicagoyimby.com, urbanize.city, blockclubchicago.org via
search). All facts used above are corroborated across 3+ independent outlets
in each case, meeting the 2-source confirmation bar even where a given URL
could not be opened directly.

---

## 5. DCEO Capital Appropriations — skipped (not a check month)

Per instructions, this check only runs in January, April, July, and October.
September is not one of those months — skipped this cycle. Next check:
October 2026 (first Monday sweep).

---

## Files changed this sweep

- `data/curated/investment-inputs/sweeps/2026-09-proposed-updates-developments_major.csv` —
  new, 3 proposed updates for a human reviewer (White Sox ×2, Bears ×1)
- `data/curated/investment-inputs/sweeps/2026-09-findings.md` — this report

No changes to `cdg_awards.csv`, `chicago_prize.csv`, any foundation grants
file, or `developments_major.csv` itself — nothing cleared this sweep's
verification bar for a direct edit, and all research-agent findings rest
substantially on WebSearch snippet synthesis rather than directly-fetched
primary sources, since most target sites (chicago.gov, ProPublica,
ptfound.org, Block Club Chicago, ~10 other outlets, web.archive.org) were
blocked at the network-egress level throughout this session, more broadly
than in the August 2026 sweep. `npm run data:export:investment` was **not**
run — there is nothing to export, since no curated input file changed.

A maintainer should independently verify the above given the degraded source
access this run, particularly: the White Sox "Railyards" proposal (high
material significance, well-sourced but early-stage), and the two flagged
gaps in already-captured CDG data (Clean Community / Excel Community
Development Corp. in the June 2026 round; the unnamed $2.1M Austin recipient
carried over from the August 2026 sweep).
