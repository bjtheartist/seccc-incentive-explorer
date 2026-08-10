# Data-Intelligence Sweep — August 2026

Run date: 2026-08-03. First-Monday-of-month automated sweep of
`data/curated/investment-inputs/`. Honesty rails from `README.md` and
`REFRESH.md` apply throughout: awarded ≠ received; announced ≠ awarded;
unverifiable amounts stay null; recipient HQ ≠ project site; closed programs
are historical.

## Delta table

| # | Source | Result | Action taken |
|---|---|---|---|
| 1 | CDG rounds | **2 new rounds found** (Jan 2026 "~$33M", Jun 2026 "~$42.5M") | Appended 17 verified rows to `cdg_awards.csv` |
| 2 | Chicago Prize | Nothing new | No changes |
| 3 | Foundation 990s | No newer tax-year filings confirmed for any of 13 EINs | No changes; informational notes below |
| 4 | Megaprojects | 1 confirmed update (Fire FC stadium public financing); 1 already-current; 1 unconfirmed detail flagged | Proposed-updates CSV only, no direct edit |
| 5 | DCEO Capital Appropriations | Skipped — not a Jan/Apr/Jul/Oct check month | N/A |

---

## 1. CDG rounds — 2 new rounds appended to `cdg_awards.csv`

Both rounds are confirmed by 2+ independent sources. `chicago.gov` and the
Wayback Machine were unreachable from this session (network-policy blocks,
not site-side); all figures below come from direct news coverage instead.

### January 2026 round — ~$33 million, 58 projects (~400 applicants)

Announced January 6, 2026 at the Chicago Cultural Center. Sources: WBEZ,
Chicago Sun-Times, Block Club Chicago, CBS Chicago, Chicago City Wire,
Little Village Chamber of Commerce.

7 recipient rows appended (6 large, 1 small with no published amount):
Axiom Flame LLC ($1.3M), Carehaus Chicago ($5M), Chicago Community Justice
Foundation ($2.3M), Funkytown Brewery ($3.7M), Institute for Nonviolence
($4.8M), Little Village Chamber of Commerce Small Business Visitor Center
($1.3M), Blue Sky Enterprise (small grant, amount not published).

**Not captured (gap, needs manual follow-up once chicago.gov is reachable):**
the remaining ~51 of 58 recipients, including amounts for most of the 45
small-grant awards (round range $51,800–$250,000) and one named "Roseland
coffee shop" recipient whose name/address/amount never surfaced in available
coverage.

Sources:
- https://blockclubchicago.org/2026/01/06/black-owned-brewery-and-little-village-visitor-center-among-58-projects-getting-33-million-from-city/
- https://blockclubchicago.org/2026/02/18/funkytown-brewery-bringing-a-black-owned-taproom-to-the-near-west-side/
- https://littlevillagechamber.org/mayor-brandon-johnson-announces-33-million-in-grant-awards-for-community-development-projects/
- https://www.chicago.gov/city/en/depts/mayor/press_room/press_releases/2026/january/community-development-grants.html (city URL pattern; unreachable this session, cited for record)

### June 2026 round — ~$42.5 million, 56 projects (>$148M total community investment cited)

Announcement coverage is dated June 24, 2026 (Block Club Chicago, Austin
Weekly News, CBS Chicago, Chicago Construction News, Chicago Defender,
thecentersquare.com/cities929.com). **Date discrepancy noted:** the
chicago.gov URL path for this release is `/2026/may/community-development-grants.html`,
suggesting the release may have originally been filed under May — filed here
as "June 2026" to match the confirmed announcement date across 6 independent
outlets, but flagging the URL-vs-coverage-date mismatch for a maintainer to
resolve if the city's own page becomes reachable.

10 recipient rows appended, all in the "12 largest projects" tier
($490,714–$5,000,000) singled out by coverage: Floreciendo: La Villita /
Erie House Community Center ($5M), PrimeCare Hermosa ($5M), Hoste ($4.8M),
MLK East: Arts, Enterprise & Community Hub ($4.7M), Black Fire Brigade First
Responder Training Academy ($3.9M), Grace's Furniture Building/Logan Square
Athletic Club ($3M), West Town Bikes and Ciclo Urbano ($2.5M), 433
Missionary NFP ($1.8M), National Museum of Mexican Art ($1.4M), Community
Creation Center at Chicago Urban League ($490,714).

**Not captured (gap):** 1 of the 12 largest-project slots (a project in the
5544 W. North Ave., Austin address — $2,100,000, 22 mixed-income
residences/6 commercial spaces — was reported by Austin Weekly News without
a recipient name; excluded from the CSV append since we do not append rows
without a recipient name, but the amount/address/purpose are recorded here
for a maintainer to name once available:
https://www.austinweeklynews.com/2026/07/06/west-side-grant-money/); the
remaining ~44 smaller recipients in this round.

### Adjacent program excluded as out of scope

Neighborhood Opportunity Fund (NOF) grants were bundled into the same press
releases as CDG in both August 2025 (~$1.9M, 14 grants) and May 2026 (11
grants) but are a separate DPD program that `cdg_awards.csv` does not track
even when co-announced — excluded, consistent with existing file scope.
Flagging in case a future sweep should track NOF separately.

### Cadence note (unverified, informational only)

Search results suggested CDG-Medium rounds may run semi-annually (~February
and ~August application close, finalists announced ~4-5 months later),
which would explain the May 2025 → January 2026 → June 2026 pattern. Not
independently confirmed against an official DCD policy document — treat as
a hint for scheduling future sweeps, not a verified fact.

---

## 2. Chicago Prize — nothing new

No evidence of a new Chicago Prize round (call for applications, finalists,
or winner) beyond the 2025 cycle already in `chicago_prize.csv`. Consistent
with the program's historical 2-3 year cadence (2020 → 2023 → 2025); next
round not expected until ~2027-2028.

- 2025 winner "Reclaiming Chicago" has ongoing progress coverage (purchasing
  a ~17-acre lot at 74th & Talman, ~125 homes planned, 19 already
  built/sold in Back of the Yards) but **no new dollar figure** beyond the
  already-captured $10M prize — not row-worthy per our "verified new amount"
  bar.
- Matching-grant amounts for the 3 non-winning 2025 finalists (currently
  blank in our CSV) could not be confirmed: search turned up conflicting
  figures ($650,000 vs "up to $500,000") that could not be reconciled
  without direct access to primary sources (ptfound.org and Block Club were
  proxy-blocked this session). Left blank; worth a manual check via
  https://blockclubchicago.org/2025/06/12/meet-the-finalists-for-the-10-million-chicago-prize-to-revitalize-south-west-sides/
  and https://www.ptfound.org/chicago-prize/chicago-prize-2025.
- **Out of scope, flagging only:** the Pritzker Traubert Foundation also
  runs a separate "Chicago Talent Challenge" ($5M workforce-development
  competition, distinct from Chicago Prize). Inaugural winner HealthCatalyst
  Chicago (City Colleges of Chicago + Cook County Health) was announced
  ~Feb 26, 2026, $5M. Not a Chicago Prize round — no action taken, but
  noting in case a future maintainer wants a separate tracked file for it.

---

## 3. Foundation 990s — no confirmed newer filings

`projects.propublica.org` was unreachable this session (403 at both the
sandbox egress proxy and via WebFetch — bot-protection / policy block, not
specific to any one EIN). The S3 XML datalake (`gt990datalake-rawdata.s3.amazonaws.com`)
was reachable directly and used to verify tax years by content, cross-checked
against web-search-indexed ProPublica metadata to locate object_ids. This is
a workaround, not exhaustive enumeration.

7 XML files were fetched and inspected (MacArthur, Chicago Community Trust,
Field Foundation ×2, McCormick, Joyce, Fry). **None contained `<!DOCTYPE` or
`<!ENTITY`** — none were rejected.

| Foundation | EIN | Newer filing confirmed? |
|---|---|---|
| MacArthur Foundation | 237093598 | No — TY2024 confirmed current via XML |
| Chicago Community Trust | 362167000 | No — TY2023 (period 2023-10 to 2024-09) confirmed same year already captured |
| Arie and Ida Crown Memorial | 366076088 | Unconfirmed — Nov 2025 filing date is consistent with already-captured TY2024; object_id not locatable |
| Robert R McCormick Foundation | 363689171 | No — TY2024 confirmed current via XML |
| Polk Bros Foundation | 366108293 | Unconfirmed — possible FYE Aug 2025 filing; object_id not locatable |
| Joyce Foundation | 366079185 | No — most recent locatable object was TY2023, older than already-captured 2024 |
| Field Foundation of Illinois | 366059408 | No — TY2024 (period 2024-05 to 2025-04) confirmed same year already captured |
| Lloyd A Fry Foundation | 366108775 | Unconfirmed — FYE June 2025 (TY2024) filing may exist; object_id not locatable |
| Grand Victoria Foundation | 364107162 | No — TY2024 confirmed current |
| Woods Fund of Chicago | 363917968 | No — TY2024 confirmed current |
| Wieboldt Foundation | 362167955 | No — TY2024 confirmed current; TY2025 explicitly noted as still processing |
| Pritzker Traubert Foundation | 364347781 | Unconfirmed — Nov 2025 filing date consistent with already-captured TY2024, aggregate-only as expected |
| Steans Family Foundation | 363486843 | No — still filing "SEE ATTACHED" non-itemized, consistent with absence from our dataset |

**No CSV changes made** — no foundation had a confirmed genuinely newer
itemized year, so no extraction was performed (per the sweep's own
effort-budget rule: only extract when a newer filing is confirmed).

**Informational only, out of scope for this sweep, flagged for a maintainer:**
- Arie & Ida Crown, Polk Bros, Fry, and Pritzker Traubert are the four with
  the highest residual chance of an actual newer filing existing — direct
  ProPublica access (unavailable this session) would resolve this faster
  than the S3/search workaround.
- Bonus finding, not a "newer year" but a completeness gap in already-captured
  data: Chicago Community Trust's TY2023 filing has 3,976 Schedule I
  recipients; our CSV currently holds 963 rows for that year (~24%
  coverage). Field Foundation's TY2024 filing has 299 grant lines vs. 262
  captured (37 short). Both are backfill opportunities for the *existing*
  year, not new-year additions — out of this sweep's scope, noted for a
  future maintainer decision.

---

## 4. Megaprojects — 1 confirmed update, 1 already current, 1 flagged

Checked all 7 priority projects in depth (Bears stadium, One Central,
Lincoln Yards/Foundry Park, White Sox ballpark, IQMP/PsiQuantum, Bronzeville
Lakefront, Obama Center) plus a lighter news pass on the remaining 32.
`developments_major.csv` was last updated 2026-07-28, so the effective
lookback window is short.

### Confirmed, proposed update (see `2026-08-proposed-updates-developments_major.csv`)

**Chicago Fire FC Stadium at The 78** — City Council approved a ~$424-425M
TIF-backed public financing package for surrounding infrastructure
(~$174M utilities/roadways + ~$250M city-owned parking garage/podium).
Committee approval July 13, 2026; full Council vote July 15, 2026.
2-source confirmed (WTTW + Block Club), figures consistent within
tolerance. This is new *public-subsidy* detail — does not change the
$650M privately-funded stadium cost already in `announced_investment_usd`.
Proposed as a `public_subsidy_note` update for maintainer review, not
applied directly per the "no amount edits without 2-source confirmation"
delivery rule.

### Already current — no action needed

**Lincoln Yards / Foundry Park** — research surfaced the Feb 18, 2026
zoning/Council approval and the June 9, 2026 $200M public-funding news, but
both are **already reflected** in the current `developments_major.csv` row
(`public_subsidy_note` and `source_urls` already cite the June 9, 2026 Block
Club article). No update needed.

One additional, unconfirmed detail surfaced during research: a reported JDL
Development partnership with Remedy Medical Properties for ~200,000 sq ft
of medical office space at Foundry Park (~July 2026). Both sources found
(Hoodline, Bisnow) appear to derive from the same underlying JDL
disclosure — effectively single-sourced. Not added to the proposed-updates
CSV per the 2-source rule; flagged here for a future sweep to re-check
once independently corroborated.

### Priority projects checked, no change found

- **Chicago Bears Stadium** — still Hammond, IN evaluation; no site finalized.
- **One Central** — still stalled; no update since March 2026 revival attempt.
- **White Sox Ballpark at The 78** — still stalled; Amtrak rail-yard talks unresolved (per Block Club, May 2026).
- **IQMP/PsiQuantum campus** — still under construction, no new milestone.
- **Bronzeville Lakefront** — still under construction, no new milestone.
- **Obama Presidential Center** — confirmed opened June 19, 2026, consistent with tracked status.

### Secondary pass (32 remaining projects)

No status-change news dated within the lookback window for Southbridge,
Riverline/Southbank, Advocate Health South Side, Ogden Commons, Salesforce
Tower, Bank of America Tower, Fulton Labs, Pullman hotel, 1000M, Bally's
Chicago Casino, Thompson Center/Google, LaSalle Street Reimagined
sub-projects, 43 Green, Halsted Landing/Pointe, Northwestern Memorial Cancer
Tower, Inherent L3C, or Chase Tower Renovation.

---

## 5. DCEO Capital Appropriations — skipped (not a check month)

Per instructions, this check only runs in January, April, July, and
October. August is not one of those months — skipped this cycle. Next
check: October 2026 (first Monday sweep).

---

## Files changed this sweep

- `data/curated/investment-inputs/cdg_awards.csv` — 17 rows appended (2 new
  verified rounds: January 2026, June 2026)
- `data/curated/investment-inputs/sweeps/2026-08-proposed-updates-developments_major.csv` — new, 1 proposed update for a human reviewer
- `data/curated/investment-inputs/sweeps/2026-08-findings.md` — this report
- `data/curated/investment-inputs/geocode-cache.json` — rewritten by the export
  run below (the appended rows' addresses)
- `data/private/community-investment.json`, `data/private/capital-context.json` —
  regenerated by that run, both stamped `2026-08-10T03:06:57.135Z`

No changes to `chicago_prize.csv`, `foundation_grants_geocoded.csv`, or
`developments_major.csv` (proposed changes are staged in the sidecar CSV
above, not applied directly). `npm run data:export:investment` **was** run
after the append — an earlier version of this line said it was not, which was
wrong; the three regenerated files above are the proof. It ran twice: once after
the append, and again after the citywide-hold fix described below. The committed
payload is that second run and carries 43,965 records / $3,162,275,577.66. A
reviewer still needs to re-run the export after deciding whether to accept the
proposed megaproject update, per the README's standing instruction.

**What the first export did not carry, and how the second one fixed it.** The
exporter DROPPED any CDG row whose address does not geocode, so 2 of the 17
appended rows never reached the first run: "Floreciendo: La Villita / Erie House
Community Center" ($5,000,000 — the round's largest single grant) and "Black Fire
Brigade First Responder Training Academy" ($3,900,000), both published by the
city with a community area instead of a street address. That run moved the
awarded total $42,090,714, not the $50,990,714 the 17 rows carry. Nine older CDG
rows ($7,358,316, including a $4,870,000 February 2023 grocery award) were absent
for the same reason — 11 rows / $16,258,316 of published award dollars represented
by nothing but `meta.droppedNoGeocode: 13`. `scripts/export-community-investment.ts`
now HOLDS an ungeocodable CDG row citywide (unplotted, dollars counted,
disclosed by the map legend's citywide note) instead of dropping it, and the
export was re-run on that fix, so **those 11 CDG records and their $16,258,316
are in the committed payload** — it carries `meta.droppedNoGeocode: 2` and the
full $50,990,714 from the 17 appended rows. Jim's corridor rows stay dropped on a
geocode miss — that partner list re-states official NOF awards and the supersede-dedupe
only fires on plotted rows, so holding those citywide would double-count.
