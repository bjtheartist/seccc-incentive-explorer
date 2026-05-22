# City of Chicago Incentive Programs Audit

**Date:** 2026-05-21
**Auditor:** Claude (chicagoincentiveexplorer.com)
**Scope:** 9 City-level programs in `public/data/programs.json` and 9 boundary layers in `public/data/zones/`

---

## Summary

- All 9 listed City programs are still active in some form, but several need accuracy fixes. Most urgent: relabel every "DCD" reference as **DPD** (Department of Planning and Development). DCD is a legacy URL-slug artifact, not the department's current title.
- TIF layer is significantly out of date. Chicago has **124 active TIF districts** (Civic Federation, 2025); the geojson holds only **100**. 9 expired 12/31/2025 and 13 more sunset 12/31/2026.
- NOF benefit structure changed: cap is **$250K reimbursing 75% of eligible costs**, plus up to **$50K** (or 20%) technical-assistance bonus. The legacy "$1.5M catalytic" tier no longer exists.
- **Submittable is the de-facto DPD application portal.** `cocdpd.submittable.com` hosts 13+ live forms (SBIF, NOF, CCSA, CDG small/medium/large, Workforce Solutions, Property Tax Incentives). Strong case for the planned "Apply via Submittable" UI feature.
- Recommended additions: **Community Development Grant** family, **Workforce Solutions Program**, **Climate Infrastructure Fund / ETOD**. Skip: Bring Chicago Home (failed at ballot 3/2024), Microbusiness Recovery (closed), Together Now / Cultivate (Lightfoot-era, closed).

---

## Program-by-program findings

### 1. TIF Districts (`id: tif`)

| Field | Finding |
|---|---|
| Status | ACTIVE. 124 active TIFs citywide (Civic Federation, May 2025). |
| Boundary | `tif-districts.geojson` has 100 features. Undercount of ~24. Also, 9 TIFs expired 12/31/2025 and need removal; 13 more expire 12/31/2026. |
| Contact name | "City of Chicago Department of Community Development" is **incorrect**. Should be "Department of Planning and Development (DPD)". |
| Phone | (312) 744-4190 still correct (DPD main line). |
| Benefits | "$250,000 for building rehabilitation" conflates SBIF with general TIF assistance. TIF redevelopment agreements have no per-project cap (they are negotiated). Recommend rephrasing. |
| Submittable | TIF redevelopment agreements use the **Universal Financial Incentives Application** (grants above $250K) at `cocdpd.submittable.com/submit/219899` |
| Suggested edits | (a) Rename agency to DPD throughout. (b) Refresh geojson from data.cityofchicago.org TIF boundaries dataset. (c) Remove the misleading $250K cap from `benefits`. (d) Add Submittable URL. |

### 2. Small Business Improvement Fund (SBIF) (`id: sbif`)

| Field | Finding |
|---|---|
| Status | ACTIVE. 2026 rollout calendar published; rounds open monthly Apr-Oct 2026. |
| Benefits | **Outdated.** Current caps are: $75K (multi-tenant), $150K (commercial), **$250K (industrial)**. The site shows only the $150K commercial figure. Reimbursement is now up to 90% of pre-approved construction costs. |
| Contact | SomerCor (312) 360-3384 still correct. |
| Submittable | **2026 SBIF Application: `https://cocdpd.submittable.com/submit/a9b7c762-50de-4ac3-87dc-0590a08708a5/2026-sbif-application`** |
| Boundary | `sbif-projects.geojson` is a 100-point sample of past projects, not eligibility boundary. Eligibility = active TIF districts (see above). Layer is informational and acceptable. |
| Suggested edits | Update benefits to show all three caps, add Submittable URL, update `lastVerifiedAt` to 2026-05-21. |

### 3. Special Service Area #50 (`id: ssa`)

| Field | Finding |
|---|---|
| Status | ACTIVE. SECCC remains the service provider. |
| Boundary | `special-service-areas.geojson` has 58 features. Matches current citywide count (58 active SSAs, per chicago.gov SSA Provider List). Layer OK. |
| Contact | SECCC (773) 721-1999 still correct. |
| Suggested edits | None. Consider adding note that 2026 RFPs for several SSAs are out (DPD published 2026 SSA RFPs in late 2025). |

### 4. High Unemployment Zone (`id: highUnemployment`)

| Field | Finding |
|---|---|
| Status | ACTIVE (federal WOTC still in force). |
| Concern | Not technically a Chicago city program — it relies on IDES (state) and IRS Form 8850 (federal). Consider reclassifying `level: "State"` or `"Federal"`. The "Chicago high-unemployment census tract" framing is a custom map overlay, not an actual designated City program. |
| Suggested edits | Reclassify level, or add a disclaimer that this is an information overlay, not a Chicago-administered incentive. |

### 5. Neighborhood Opportunity Fund (NOF) (`id: nof`)

| Field | Finding |
|---|---|
| Status | ACTIVE. Mayor Johnson announced 11 new NOF awardees in May 2026 ($5.5M). |
| Benefits | **Needs rewrite.** Current rules (NOF Program Manual v.9.18.25): max grant **$250,000** reimbursing **75%** of eligible costs; **+$50,000** technical-assistance bonus (or +20% of project for pre-development) if applicant pairs with approved TA provider. The "$1.5M catalytic" track from the legacy NOF Large Grant program is no longer a current offering — large catalytic projects now route through the Community Development Grant program. |
| Application | Rolling, evaluated quarterly. **Next deadline: 11:59 p.m. Friday, Feb. 13, 2026** (likely already past by 2026-05-21 — next 2026 deadline TBD). |
| Submittable | **`https://cocdpd.submittable.com/submit/328194/neighborhood-opportunity-fund-nof-grant-application`** (English); Spanish: `https://cocdpd.submittable.com/submit/320126/neighborhood-opportunity-fund-nof-grant-application-spanish` |
| Contact name | Change DCD → DPD. |
| Suggested edits | Rewrite benefits block; add Submittable URL (and Spanish URL); fix DPD name. |

### 6. Chicago Landmark District Incentives (`id: landmarkDistricts`)

| Field | Finding |
|---|---|
| Status | ACTIVE. 62 landmark districts citywide per the 2025 Landmarks Ordinance. |
| Boundary | `landmark-districts.geojson` has 59 features — 3 short of current 62. New designations added 2024–2025 (e.g., Pilsen extensions, recent industrial-heritage districts). Refresh from Chicago Data Portal. |
| Contact | (312) 744-3200 (Historic Preservation Division within DPD) still correct. |
| Benefits | Class L (10% assessment for 10 years) language correct, but Class L is administered by **Cook County Assessor**, not the City. Make sure copy distinguishes the city designation step from the county tax step. |
| Suggested edits | Refresh geojson; clarify the Cook County Assessor handoff. |

### 7. Micro Market Recovery Program (`id: microMarketRecovery`)

| Field | Finding |
|---|---|
| Status | ACTIVE but **migrated to Department of Housing** (not DPD). The program now focuses on home purchase/rehab assistance — $30,000 down-payment grants via Neighborhood Housing Services. The original "commercial-storefront activation" framing in our copy is outdated. |
| Boundary | `micro-market-recovery.geojson` has 13 features. Current MMRP areas (per chicago.gov/doh) number 19 (added: West Englewood, Roseland, Woodlawn, Fuller Park, North Lawndale, South Lawndale). Update needed. |
| Contact | Should be **Chicago Department of Housing (DOH)** plus NHS Chicago; current copy points to DPD which is wrong. |
| URL | Current correct URL is `https://www.chicago.gov/city/en/depts/doh/provdrs/lenders/svcs/micro-market-recovery-program.html` (DOH, not DCD). |
| Submittable | None — handled by NHS Chicago directly (`nhschicago.org/mmrp-purchase-assistance-grant`). |
| Suggested edits | Major rewrite. Consider whether MMRP belongs in this commercial-incentive explorer at all; it is now primarily a homeownership program. |

### 8. Industrial Corridor Protections (`id: industrialCorridors`)

| Field | Finding |
|---|---|
| Status | ACTIVE. 26 corridors confirmed (chicago.gov ICM page). |
| Boundary | `industrial-corridors.geojson` has 26 features. Matches. Armitage Industrial Corridor framework completed 2025, Burnside and Calumet plans in progress — confirm geometry matches latest "current" dataset on the Chicago Data Portal (`vdsr-p25b`). |
| Contact | DPD (312) 744-4190 still correct. |
| Suggested edits | Verify Armitage and recently-modernized corridor geometries against the Data Portal `vdsr-p25b` dataset; correct the "Department of Planning and Development" label (currently correct here — good). |

### 9. Commercial Corridor Storefront Activation (CCSA) (`id: ccsa`)

| Field | Finding |
|---|---|
| Status | ACTIVE. $30.5M / 12 corridors / 3 years. |
| Boundary | `ccsa-corridors.geojson` has 12 features. Matches. |
| Contact | Allies for Community Business (312) 275-3000 correct. |
| Submittable | **`https://cocdpd.submittable.com/submit/343419/commercial-corridor-storefront-activation-grant`** |
| `lastVerifiedAt` | Already 2026-04-23 — freshest in the dataset, good. |
| Suggested edits | Add Submittable URL. Otherwise solid. |

---

## New programs to consider adding

**Community Development Grant (CDG) — Small / Medium / Large.** DPD's flagship grant umbrella post–ARPA close-out (replaced Chicago Recovery Plan branding). Tiers: Small (≤$250K), Medium ($300K–$5M), Large (>$5M). Capital projects citywide; not corridor-restricted. Source: https://www.chicago.gov/city/en/sites/community-development-grant/home.html

**Workforce Solutions Program.** New 2026 DPD grant for training/upskilling current employees. Useful for SECCC-corridor manufacturers and small businesses. Source/Submittable: https://cocdpd.submittable.com/submit/346309

**Climate Infrastructure Fund (CIF) and Equitable Transit-Oriented Development (ETOD).** Launched 2022, continued under DPD. CIF funds renewable energy, EV charging, green stormwater infrastructure. ETOD funds projects near CTA/Metra. Both flow through the Universal Small Grant Application. Source: https://www.chicago.gov/city/en/sites/dpd-recovery-plan/home/CRPFinalistResources.html

**ComEd EV Charger Rebate (utility, not City).** 2026 rebate: $1,000–$2,500 residential, up to $8,000/port commercial via EV Make-Ready. Stackable. Add as `level: "Utility"`. Source: https://www.comed.com/about-us/clean-energy/electric-vehicle-charger-and-installation-rebate

**Not recommended:** Bring Chicago Home (failed 3/19/2024), Chicago Microbusiness Recovery (closed), Same Day Pay (no active program by that name), Together Now / Cultivate (closed 2020–2021 pandemic grants), INVEST South/West (folded into CDG pipeline under Johnson), Retail Thrive Zones (no current RFP cycle).

---

## Submittable inventory (deliverable for the upcoming "Apply via Submittable" UI feature)

The City of Chicago Department of Planning and Development uses **`cocdpd.submittable.com`** as the centralized portal. Each form below is a live application URL.

| # | Program | Submittable URL | Cap / Notes |
|---|---|---|---|
| 1 | 2026 SBIF Application | `https://cocdpd.submittable.com/submit/a9b7c762-50de-4ac3-87dc-0590a08708a5/2026-sbif-application` | $75K / $150K / $250K tiers; 90% reimbursement |
| 2 | Neighborhood Opportunity Fund (English) | `https://cocdpd.submittable.com/submit/328194/neighborhood-opportunity-fund-nof-grant-application` | $250K, 75% reimbursement; +$50K TA bonus |
| 3 | NOF (Spanish) | `https://cocdpd.submittable.com/submit/320126/neighborhood-opportunity-fund-nof-grant-application-spanish` | Same as #2 |
| 4 | Commercial Corridor Storefront Activation (CCSA) | `https://cocdpd.submittable.com/submit/343419/commercial-corridor-storefront-activation-grant` | Reimbursable capital grants; 12 corridors |
| 5 | Small Community Development Grant (≤ $250K) | `https://cocdpd.submittable.com/submit/348438/small-community-development-grants-up-to-250-000` | Replaces legacy Small CDG / Recovery Plan |
| 6 | Small CDG — Spanish 2026 | `https://cocdpd.submittable.com/submit/354576/subvencion-de-desarrollo-comunitario-hasta-250-000-2026` | Same as #5 |
| 7 | Medium Community Development Grant | `https://cocdpd.submittable.com/submit/345760/medium-community-development-grant-application` | $300,001 – $5,000,000 |
| 8 | Large Community Development Grant | `https://cocdpd.submittable.com/submit/345775/large-community-development-grant-application` | > $5,000,000 |
| 9 | 2026 Workforce Solutions Program | `https://cocdpd.submittable.com/submit/346309/2026-workforce-solutions-program-grant-application` | Workforce training/upskilling grants |
| 10 | City of Chicago / Cook County Property Tax Incentive | `https://cocdpd.submittable.com/submit/302696/city-of-chicago-cook-county-property-tax-incentive-application` | Class 6b / Class L / Class 7 etc. |
| 11 | Universal Financial Incentives (grants > $250K) | `https://cocdpd.submittable.com/submit/219899/city-of-chicago-department-of-planning-development-universal-financial-incenti` | TIF RDAs, large capital deals |
| 12 | 2026 Delegate Agency Contracts | `https://cocdpd.submittable.com/submit/342640/2026-delegate-agency-contracts` | For SSA / corridor lead agencies |
| 13 | 2026 Delegate Agency Contract Amendment | `https://cocdpd.submittable.com/submit/356288/2026-delegate-agency-contract-amendment` | SSA / corridor lead amendments |

**Implementation note for the UI feature:** A simple `submittableUrl` field on each program in `programs.json` is enough. For NOF, store the English URL on the main program and put the Spanish URL on a `submittableUrlEs` field. CCSA needs only one. CDG should likely be three sibling programs (small/medium/large) sharing the same `zoneKey`.

---

## Sources

- Chicago DPD, Planning and Development home: https://www.chicago.gov/city/en/depts/dcd.html
- Chicago DPD Submittable portal (live form index): https://cocdpd.submittable.com/submit
- NOF Program Manual (9/18/2025): https://www.chicago.gov/content/dam/city/sites/neighborhood-opportunity-fund/pdfs/NOF_Program_Manual_9.18.25.pdf
- NOF Apply page: https://www.chicago.gov/city/en/sites/neighborhood-opportunity-fund/home/Apply.html
- SBIF home and rollout calendar: https://www.chicago.gov/city/en/sites/small-business-improvement-fund/home.html and https://www.chicago.gov/city/en/sites/small-business-improvement-fund/home/rollout-calendar.html
- SomerCor SBIF program rules (Jan 2026): https://resources.somercor.com/hubfs/2-%20SBIF%20PDF/SBIF%20Program%20Rules.pdf
- Civic Federation, Understanding Chicago's 2026 Record TIF Surplus: https://www.civicfed.org/understanding-chicagos-2026-record-tif-surplus
- DPD TIF District Extension Framework (11/17/2025): https://www.chicago.gov/content/dam/city/depts/dcd/general/TIF_District_Extension_Framework_1125.pdf
- WTTW, Share of Chicago Property Taxes Claimed by TIF Funds, 5/8/2025: https://news.wttw.com/2025/05/08/share-chicago-property-taxes-claimed-tif-funds-soared-47-5-years-data
- City of Chicago SSA Provider List: https://www.chicago.gov/city/en/depts/dcd/supp_info/special_service_areasandproviderlist.html
- Industrial Corridor Modernization Initiative: https://www.chicago.gov/city/en/depts/dcd/supp_info/repositioning-chicago-s-industrial-corridors-for-today-s-economy.html
- Chicago Data Portal, Industrial Corridors (current): https://data.cityofchicago.org/Community-Economic-Development/Boundaries-Industrial-Corridors-current-/e6xh-nr8w
- Chicago Landmarks Ordinance 2025: https://www.chicago.gov/content/dam/city/depts/zlup/Historic_Preservation/Publications/Chicago_Landmarks_Ordinance_2025.pdf
- Department of Housing — Micro Market Recovery Program: https://www.chicago.gov/city/en/depts/doh/provdrs/lenders/svcs/micro-market-recovery-program.html
- NHS Chicago MMRP Purchase Assistance: https://nhschicago.org/mmrp-purchase-assistance-grant/
- Mayor Johnson NOF awards announcement, May 2026: https://www.chicago.gov/city/en/depts/dcd/provdrs/ec_dev/news/2026/may/mayor-brandon-johnson--department-of-planning-and-development-an.html
- Bring Chicago Home referendum result (Block Club, 3/22/2024): https://blockclubchicago.org/2024/03/22/bring-chicago-home-referendum-fails/
- ComEd EV Charger Rebate (2026 program): https://www.comed.com/about-us/clean-energy/electric-vehicle-charger-and-installation-rebate
- City of Chicago Recovery Plan finalist resources (CIF / ETOD): https://www.chicago.gov/city/en/sites/dpd-recovery-plan/home/CRPFinalistResources.html
- Allies for Community Business grants page: https://a4cb.org/services/grants/
- Community Development Grant home: https://www.chicago.gov/city/en/sites/community-development-grant/home.html
