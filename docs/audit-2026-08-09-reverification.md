# Program re-verification — 2026-08-09

Re-verification of the 47 programs whose `lastVerifiedAt` still read **2026-05-21**
(see `docs/audit-2026-05-21-*.md`), each checked against the administering
agency's own live page.

## Method

Ten agents, ~5 programs each, loaded every program's `url` and `sourceUrl` and
compared the stored `summary`, `whoQualifies`, `benefits`, `howToApply`,
`contact`, `benefitRange`, and `applicationPortals` against what the source
actually says. Every proposed change was then re-checked by a second,
independent adjudicator instructed to refuse anything it could not confirm by
loading the page itself. Replacement URLs were additionally curl-verified by
hand before being written.

**Three proposed changes were rejected and are deliberately absent** —
`landBank`, `aim`, and `quantumEZ`. In each case the adjudicator found the
proposed edit would have deleted a fact the agency or statute does document.

## Result

| | |
|---|---|
| Programs re-verified | **47 of 47** — every one reached; zero `cannot_verify` |
| Confirmed unchanged | 11 |
| Materially changed | 36 |
| Change bundles adjudicated | 37 (34 upheld, 3 rejected) |
| Field edits written | 93 across 33 programs, plus 2 outside the cohort |
| Programs found no longer open | 3 lapsed, 1 statutorily sunset, 2 unresolved |

## Dead links found

Four programs pointed users at a hard 404, and one at a domain that no longer
resolves at all:

| Program | Dead link | Replaced with |
|---|---|---|
| `landmarkDistricts` | `chicago.gov/…/dcd/provdrs/landmark.html` (404) | DPD Historic Preservation Division page |
| `industrialCorridors` | `chicago.gov/…/supp_info/industrial-corridors.html` (404) | Industrial Corridor Modernization Initiative |
| `ccsa` | `chicago.gov/…/supp_info/ccsa.html` (404) | City storefront-activation microsite |
| `chips48d` | `irs.gov/businesses/advanced-manufacturing-investment-credit` (404) | current IRS credit page |
| `energyCommunityBonus` | `energycommunities.gov` — **no DNS record; the site is gone** | IRS energy-communities FAQ |

`energyCommunityBonus` was outside the 47-program cohort. It was surfaced by the
extended link checker on its first run and fixed here because the new CI gate
would otherwise block on it.

## Why these sat undetected

`scripts/check-submittable-links.mjs` ran nightly but only pinged
`applicationPortals[].url` where `type === "submittable"` — 12 links. It never
checked `program.url` or `program.sourceUrl`, the "official source" links that
appear on every program card, detail page, and report. **92 links were
unwatched.** The checker now covers all of them and CI fails on a dead one.

A third verdict, `blocked`, was added for hosts whose WAF rejects automated
clients (403/429). Scoring those as `broken` would publish an absence of
evidence as evidence of a defect — the same error the zoning provenance work
removed. CI notes them and does not fail.

## Programs no longer accepting applications

Routed through `resolveAvailability()` as `lapsed` with a sourced
`sunsetWarning`, which renders a visible lapse notice. They are deliberately
**not** given an `expiresOn`, which would hide them entirely — a stronger claim
than the evidence supports, since future rounds remain possible.

- **`catalystGrant`** — window closed 2025-11-14, awards notified 2026-05-22. Cook County: "we do not anticipate grant programs in 2026 or 2027".
- **`cannabisR3`** — closed 2025-09-25; $31.8M awarded to 95 businesses; no Round IV announced.
- **`climateInfrastructureFund`** — CIF application closed, no successor; the ETOD half closed 2023-08-18.
- **`sec179d`** — `sunset`. IRS: terminated for property whose construction begins after 2026-06-30. That date has passed.
- **`cookCannabisGrant`**, **`microMarketRecovery`** — `verify`. Both have a closed or unannounced round and material fact changes; flagged to users rather than silently re-dated.

## The corrections that would have misled someone

- **`comedEvRebate`** — stored "$1,000 – $2,500 residential rebate". The published maximum for a customer who does *not* qualify as low-income is **$750**. Stored commercial "up to $8,000/port" against an actual $5,000 ($7,500 LI/EIEC), and the commercial window is closed.
- **`microMarketRecovery`** — program renamed to Chicago Neighborhood Recovery Program; assistance is **$15,000**, not the stored $30,000; **11** target areas, not 19; NHS purchase-assistance intake is closed.
- **`ahsap`** — stored described an assessment **freeze**; it is a 25% (Tier 15) or 35% (Tier 35) assessed-value **reduction**. Wrong phone number, an entire missing tier, and undisclosed $750–$1,500 filing fees.
- **`dataCenter`** — stored eligibility omitted the **$250M capital investment over 60 months** and 20-job floors. A small business reading it would think it qualified.
- **`chips48d`** — 25% stored; the credit is **35%** for property placed in service after 2025.
- **`class8aMicro`** — 10% assessment for **30 years**, not the stored 10.
- **`ssbciAdvantageIL`** — state participation/guarantee runs to **$2M**, not $1.5M.
- **`ccsa`** — a live quarterly deadline, **5 p.m. Friday, August 21, 2026**, was recorded nowhere.

## Every program touched

| id | name | fields changed |
|---|---|---|
| `ahsap` | Affordable Housing Special Assessment Program (AHSAP) | `summary`, `whoQualifies`, `benefits`, `howToApply`, `contact`, `benefitRange` |
| `bmec` | Building Materials Exemption Certificate (BMEC) | `howToApply` |
| `cannabisR3` | Illinois Cannabis Social Equity Loan Program — Round III | `status`, `sunsetWarning` |
| `catalystGrant` | Cook County Catalyst Grant | `whoQualifies`, `howToApply`, `fastestConfirmingStep`, `status`, `sunsetWarning` |
| `ccsa` | Commercial Corridor Storefront Activation Program (CCSAP) | `whoQualifies`, `howToApply`, `benefitRange`, `fastestConfirmingStep`, `url`, `sourceUrl` |
| `cdfiBond` | CDFI Fund Bond Guarantee Program | `howToApply` |
| `chips48d` | CHIPS Investment Tax Credit (§48D) | `benefits`, `benefitRange`, `url`, `sourceUrl` |
| `class6bSer` | Cook County Class 6b SER (Sustainable Emergency Relief) | `whoQualifies` |
| `class7b` | Cook County Class 7b Commercial Property Tax Incentive | `whoQualifies` |
| `class7c` | Cook County Class 7c Commercial Urban Relief Eligibility (CURE) | `howToApply` |
| `class8` | Cook County Class 8 Property Tax Incentive | `whoQualifies` |
| `class8aMicro` | Cook County Class 8a MICRO (Semiconductor) | `whoQualifies`, `benefits`, `benefitRange` |
| `classC` | Cook County Class C Brownfield Property Tax Incentive | `url` |
| `climateInfrastructureFund` | Climate Infrastructure Fund (CIF) / Equitable Transit-Oriented Development (ETOD) | `howToApply`, `contact`, `benefitRange`, `url`, `status`, `sunsetWarning` |
| `comedEvRebate` | ComEd EV Charger and Installation Rebate | `summary`, `whoQualifies`, `benefits`, `howToApply`, `benefitRange` |
| `cookBrownfield` | Cook County Brownfield Redevelopment Assistance | `summary`, `whoQualifies`, `howToApply`, `benefitRange` |
| `cookCannabisGrant` | Cook County Cannabis Development Grant | `summary`, `benefits`, `howToApply`, `benefitRange`, `url`, `status` |
| `dataCenter` | Data Center Tax Incentive | `summary`, `whoQualifies`, `contact`, `suspensionNote` |
| `edaBuildToScale` | EDA Build to Scale (B2S) | `summary`, `howToApply` |
| `edge` | EDGE Tax Credit | `benefits`, `contact` |
| `electivePay` | Elective Pay & Transferability (Clean Energy Credits) | `benefits` |
| `energyCommunityBonus` | IRA Energy Community Tax Credit Bonus | `url`, `sourceUrl` |
| `hib` | High Impact Business (HIB) | `howToApply`, `contact` |
| `hudSection108` | HUD Section 108 Loan Guarantee | `benefits` |
| `illinoisOZ` | Illinois Opportunity Zones | `summary`, `benefits`, `howToApply`, `contact` |
| `industrialCorridors` | Industrial Corridor Protections | `url` |
| `innovationVoucher` | Illinois Innovation Voucher Program | `whoQualifies`, `howToApply`, `url` |
| `landmarkDistricts` | Chicago Landmark District Incentives | `url` |
| `micro` | MICRO Program | `whoQualifies`, `benefits`, `contact`, `benefitRange` |
| `microMarketRecovery` | Chicago Neighborhood Recovery Program (CNRP, formerly MMRP) | `name`, `whoQualifies`, `howToApply`, `contact`, `benefitRange`, `url`, `status` |
| `nrhpDistricts` | Federal Historic Tax Credit (HTC) | `contact` |
| `qct` | Qualified Census Tract (QCT) — LIHTC Boost | `whoQualifies` |
| `r3Grants` | Restore, Reinvest, Renew (R3) Program | `howToApply`, `url` |
| `sec179d` | §179D — Energy Efficient Commercial Buildings Deduction | `status`, `sunsetWarning` |
| `ssbciAdvantageIL` | SSBCI — Advantage Illinois & INVENT VCP | `benefits`, `benefitRange` |

`lastVerifiedAt` advanced to **2026-08-09** for all 47 re-verified programs plus
`energyCommunityBonus`. No program's date was advanced without its source being
reached.

## Note on staleness policy

`isStaleProgramData()` (lib/confidence-engine.ts) treats a program as stale at
**six months**. These 47 were at 80 days and were *not* being flagged to users.
The defects above were therefore invisible to both the freshness badge and the
nightly link check — the gap this PR closes.
