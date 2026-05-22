# Federal Incentive Audit — chicagoincentiveexplorer.com

**Date:** 2026-05-21
**Scope:** All `level: "Federal"` entries in `public/data/programs.json` and supporting boundary geojsons (federal-oz, qct, nmtc-eligible). Verified against IRS, Treasury, HUD, CDFI Fund, NPS, and EPA sources.

## Summary

- **All four listed federal programs remain active**, but every one has material 2025-2026 changes that the platform copy does not yet reflect. The Opportunity Zone program in particular has been overhauled by the One Big Beautiful Bill Act (OBBBA, Pub. L. 119-21, July 2025).
- **OZ boundaries:** Existing (OZ 1.0) designations remain in effect through 12/31/2028, but new OZ 2.0 tracts will be designated by 1/1/2027. The `federal-oz.geojson` file is still correct for now but will need a refresh by Q4 2026.
- **QCT boundaries are stale.** The current geojson appears to predate the 2026 HUD designations effective 1/1/2026 (published in Federal Register 9/30/2025 using 2020 census tract boundaries). Refresh from HUD USER.
- **NMTC made permanent by OBBBA**, with a CY 2024-25 double round ($10B) awarded 12/23/2025 and CY 2026 ($5B) under the new framework. Eligibility tracts also re-baseline against latest ACS — geojson likely usable but should be refreshed.
- **WOTC has lapsed** (expired 12/31/2025). The `highUnemployment` city-level program still references WOTC up to $9,600 per hire — needs an "awaiting reauthorization" disclaimer.
- **High-value federal programs missing entirely:** IRA Clean Electricity ITC §48E low-income/energy-community bonus, IRS elective pay/transferability, §179D (sunsetting 6/30/2026), HUD Section 108, CDFI Bond Guarantee, and SBA 7(a)/504 (cumulative cap doubled to $10M on 7/4/2026).

---

## Program-by-program findings

| ID | Program | Status | Severity of edits needed |
|---|---|---|---|
| `federalOZ` | Federal Opportunity Zones | Active; major OBBBA reform | High |
| `nmtcEligible` | New Markets Tax Credits | Active; made permanent (OBBBA) | Medium |
| `qct` | QCT — LIHTC Boost | Active; 2026 designations effective 1/1/2026 | Medium (boundary refresh) |
| `nrhpDistricts` | Federal Historic Tax Credit | Active; no statutory change in 2025-2026 | Low |

### 1. `federalOZ` — Federal Opportunity Zones

**Active?** Yes, but the program was substantially rewritten by OBBBA (July 2025) and is now permanent on a 10-year designation cycle. Existing OZ 1.0 tracts remain valid investment targets through 12/31/2028; new OZ 2.0 tracts become effective 1/1/2027.

**Accuracy issues in current entry:**
- `benefits[0]` ("Defer capital gains taxes until 2026") is **outdated**. Under the original program, the deferred-gain recognition date was 12/31/2026; OBBBA replaces this with a new 5-year rolling deferral for OZ 2.0 investments and clarifies that pre-2027 OZ 1.0 investments still trigger inclusion on 12/31/2026 unless rolled into OZ 2.0.
- `benefits[1]` ("10% reduction on deferred gains if held 5+ years") — the 5/7-year step-up basis benefits are **no longer available** for OZ 1.0 investments because the holding windows have closed. OZ 2.0 introduces a 10% basis step-up at 5 years (30% for rural QOFs).
- `benefits[2]` (10-year zero capital gains exclusion) — still accurate, but OZ 2.0 caps the exclusion at 30 years post-investment.
- `summary` mentions only the 2017 TCJA; should reference OBBBA Sec. 70421.
- `howToApply` — Form 8996 reporting will expand significantly starting 2027 (annual disclosures for QOFs). Should be flagged.

**Suggested edits (exact field paths):**
- `programs[id=federalOZ].summary` → rewrite to acknowledge OBBBA permanence and 2027 transition.
- `programs[id=federalOZ].benefits` → replace all three bullets with current OZ 1.0 status + forthcoming OZ 2.0 (10%/30% rural basis step-up, decennial redesignation).
- `programs[id=federalOZ].howToApply[2]` → "File IRS Form 8996 annually (expanded reporting beginning 2027)."
- `programs[id=federalOZ].benefitRange` → "Tax deferral + 0% gains after 10 yrs (OZ 1.0 through 2028; OZ 2.0 effective 1/1/2027)."
- `programs[id=federalOZ].lastVerifiedAt` → "2026-05-21".

**Boundaries:** `public/data/zones/federal-oz.geojson` contains 181 features for Illinois OZ 1.0 census tracts. Treasury Rev. Proc. 2018-16 list of designations has not changed; geojson is current. **Action:** add a `vintage: "OZ 1.0 (TCJA 2017, valid through 12/31/2028)"` property and plan a refresh against the new Treasury list once OZ 2.0 designations are certified (expected late 2026).

### 2. `nmtcEligible` — New Markets Tax Credits

**Active?** Yes, and **made permanent by OBBBA**. Treasury awarded $10B in CY 2024-25 (announced 12/23/2025, 142 awardees, $20M-$95M range). CY 2026 round opens with ~$5B under the new permanent framework.

**Accuracy issues:**
- `summary` calls out the 39% credit correctly but should note program is now permanent.
- `contact` phone `(202) 653-0300` — the CDFI Fund's general help desk is `(202) 653-0421`. The 0300 number reaches Treasury main; recommend updating to the published CDFI Fund Help Desk.
- `howToApply` is accurate. Could add reference to the NMTC Qualified Equity Investment Report (CDFI Fund publishes monthly).
- `requiredDocs` — no changes needed.
- The new CDFI Fund allocation agreement reforms (Dec 2025) add anti-discrimination/EO compliance monitoring; minor disclaimer worth adding for prospective borrowers.

**Suggested edits:**
- `programs[id=nmtcEligible].summary` → add "Made permanent by the One Big Beautiful Bill Act (2025)."
- `programs[id=nmtcEligible].contacts[0].phone` → verify; current CDFI Fund Help Desk: `(202) 653-0421` (cdfihelp@cdfi.treas.gov).
- `programs[id=nmtcEligible].lastVerifiedAt` → "2026-05-21".

**Boundaries:** `public/data/zones/nmtc-eligible.geojson` (695 features) uses pre-2020-ACS poverty/income flags. NMTC eligibility re-baselines with each ACS 5-year release; the 2018-2022 ACS triggered the current "highly distressed" determinations and the CDFI Fund published an updated NMTC eligibility lookup in 2024. **Action:** re-extract eligibility from CIMS (CDFI Information Mapping System) using the 2019-2023 ACS once published (expected mid-2026).

### 3. `qct` — Qualified Census Tract (LIHTC Boost)

**Active?** Yes. HUD published 2026 QCT designations in the Federal Register on 9/30/2025 (effective 1/1/2026), using 2020 decennial census tract boundaries.

**Accuracy issues:** Listed content is accurate (130% LIHTC basis boost). No copy changes needed beyond `lastVerifiedAt`.

**Boundaries:** `public/data/zones/qct.geojson` has 418 features for Cook County. Properties (`OBJECTID`, `GEOID`, `TRACT`, `Shape__Area`) suggest a direct HUD Open Data Site export, but the vintage is not embedded. The 2026 dataset uses 2020 census tract boundaries and was published 9/30/2025. **Action:** Re-download from `https://hudgis-hud.opendata.arcgis.com/datasets/HUD::qualified-census-tracts-2026/` and add a `vintage: "HUD 2026 QCT (eff. 2026-01-01)"` property to each feature, plus a top-level `metadata` object.

**Suggested edits:**
- `programs[id=qct].lastVerifiedAt` → "2026-05-21".
- Optional: add note in `summary` that QCTs are re-designated annually each January 1.

### 4. `nrhpDistricts` — Federal Historic Tax Credit

**Active?** Yes. 20% credit under IRC §47 is unchanged. The 2017 TCJA change (5-year ratable claim, 10% non-historic credit repealed) remains the operative framework. No material 2025-2026 changes.

**Accuracy issues:**
- `benefits[3]` "Credit claimed over 5 years (4% per year)" — accurate.
- `contact` Illinois SHPO phone `(217) 785-4512` — still correct.
- NPS contact `(202) 513-7270` — verified against NPS Technical Preservation Services page.
- `url` `https://www.nps.gov/subjects/taxincentives/index.htm` — works as of audit date.

**Suggested edits:**
- `programs[id=nrhpDistricts].lastVerifiedAt` → "2026-05-21".
- Consider adding a contact for the **Federal Historic Preservation Tax Incentives** annual report (NPS publishes statistics each year).

### Related federal-credit content on non-federal entries

- **`highUnemployment` (City level)** — references WOTC up to $9,600/hire. **WOTC expired 12/31/2025** and is awaiting reauthorization. Add disclaimer to `benefits[0]`, `requiredDocs[0]` (Form 8850), and `benefitRange`: "WOTC authority lapsed 1/1/2026; pre-screen on Form 8850 to preserve retroactive eligibility if reauthorized." Suggested edit: `programs[id=highUnemployment].benefits[0]` → "Work Opportunity Tax Credit (lapsed 1/1/2026; pending reauthorization — continue Form 8850 pre-screening for retroactive eligibility)."

---

## New federal programs recommended for inclusion

### A. IRA §48E/§45Y Clean Electricity Credits + Energy Community / Low-Income Bonus
Chicago has multiple census tracts that qualify as **energy communities** (brownfield sites, MSA fossil-fuel employment thresholds) and **low-income communities** for the §48E(h) bonus credit. The base 30% ITC stacks up to **+10% (energy community)** and **+10% or +20% (low-income community / qualified low-income economic benefit project)**. Solar, storage, and small wind projects <5 MW are the typical Chicago use case. Applications for the **2026 §48E(h) program year open 2/2/2026 and close 8/7/2026** with 1.8 GW total capacity. This is the single most under-publicized credit relevant to SECCC-area commercial property owners.
Source: https://www.irs.gov/credits-deductions/clean-electricity-low-income-communities-bonus-credit-amount-program

### B. IRS Elective Pay (Direct Pay) and Transferability of Clean Energy Credits
Nonprofits, places of worship, schools, and local governments in the SECCC corridor — historically excluded from tax credits — can now monetize §48E, §30C (EV charging), and several other clean-energy credits via **elective pay** (direct cash refund). For-profit owners that lack tax appetite can **sell** the credits via transferability. Pre-file registration through IRS Energy Credits Online (ECO) portal is mandatory. This is a foundational delivery mechanism that should be cross-referenced from multiple program entries, not buried.
Source: https://www.irs.gov/credits-deductions/elective-pay-and-transferability

### C. IRC §179D — Energy Efficient Commercial Buildings Deduction (SUNSET WARNING)
Up to $5.94/sf deduction for energy-efficient HVAC, lighting, and envelope improvements. **OBBBA terminated §179D for construction beginning after 6/30/2026** — a 6-week window from this audit date. Should be listed with a prominent sunset banner so SECCC corridor property owners can act before the deadline. Designers working on tax-exempt-owned buildings (parks, schools, churches) can also claim.
Source: https://www.congress.gov/crs-product/IF12862

### D. HUD Section 108 Loan Guarantee Program
Chicago is a CDBG entitlement city and can issue Section 108 guaranteed loans for economic development, public facilities, and housing. FY 2026 fee is **0.58%** (down from 0.82% in FY 2025), making it cheaper this year. HUD has prioritized $250M of $400M FY 2026 authority for affordable housing. Useful for catalytic SECCC corridor projects that exceed NOF grant size but don't fit conventional bank lending.
Source: https://www.hud.gov/hud-partners/community-section108

### E. CDFI Fund Bond Guarantee Program
Treasury-guaranteed bonds (30-year maturity) issued by Qualified Issuer CDFIs for $100M+ aggregate financings. While individual small businesses don't apply directly, the program is the source of large flexible loans deployed by local CDFIs (Chicago Community Loan Fund, IFF, LISC) to SECCC-area commercial real estate, charter schools, and health centers. FY 2026 authority estimated at **$500M**.
Source: https://www.cdfifund.gov/programs-training/programs/cdfi-bond

### F. SBA 7(a) and 504 Loans (Cumulative Cap Doubled in 2026)
Effective **7/4/2026**, the SBA cumulative borrowing limit for 7(a) + 504 combined doubled from **$5M to $10M**. The Community Advantage SBLC program (loans up to $350K for underserved markets) remains active. The Chicago SBA District Office should be the primary contact. These are foundational small-business capital tools currently absent from the platform.
Source: https://www.sba.gov/article/2026/05/18/sba-doubles-cumulative-7a-504-loan-limit-10-million

### G. CHIPS Investment Tax Credit (§48D — Advanced Manufacturing Investment Credit)
**25% credit** for investments in semiconductor manufacturing facilities or specialized equipment, eligible for direct pay. Investment must be **initiated by end of 2026** to qualify. While the city-level `MICRO` program exists (Illinois only), the federal §48D credit is the corresponding federal incentive and should be listed for the few Chicago-area chip ecosystem suppliers.
Source: https://www.irs.gov/businesses/advanced-manufacturing-investment-credit

### H. State Small Business Credit Initiative (SSBCI) — Advantage Illinois & INVENT VCP
Federal Treasury allocation of **$354.6M to Illinois** (administered by DCEO) funds the Advantage Illinois loan participation/guarantee program, INVENT Venture Capital Program, and Climate Bank Finance LPP. Active and accepting applications in 2026. Most useful for early-stage growth capital, including loans up to $1.5M with state guarantees and equity investments through certified VC funds. Should be listed as **Federal** (Treasury funds passed through to a state administrator).
Source: https://home.treasury.gov/policy-issues/small-business-programs/state-small-business-credit-initiative-ssbci

### I. EDA Build to Scale (B2S)
$500K-$5M federal grants for regional tech-ecosystem capacity, applicant pool is nonprofits/EDOs/universities. SECCC could partner as a sub-awardee for entrepreneur capacity building in the Calumet corridor. **FY 2026 cycle closed; next NOFO expected late summer 2026.** Worth listing as forward-looking opportunity.
Source: https://www.eda.gov/funding/programs/build-to-scale

### Not recommended (yet)
- **Brownfields Tax Incentive (IRC §198)** — still expired since 12/31/2011. Reauthorization Act of 2025 (H.R. 815) introduced but stalled in House Ways and Means. Add only if Congress passes.
- **USDA Rural Business Development Grants** — Chicago city proper is ineligible (urbanized area >50K population). Skip.

---

## Sources cited

All accessed 2026-05-21.

- IRS — OBBBA OZ State Nomination Guidance: https://www.irs.gov/newsroom/treasury-irs-provide-guidance-to-states-for-nominating-census-tracts-as-qualified-opportunity-zones-under-the-one-big-beautiful-bill
- IRS — Opportunity Zones main page: https://www.irs.gov/credits-deductions/businesses/opportunity-zones
- Economic Innovation Group — OZ 2.0 Status: https://eig.org/opportunity-zones-2-0-where-things-stand/
- IEDC — OZ Permanence Analysis: https://www.iedconline.org/news/2025/08/13/community-updates/opportunity-zone-program-overhaul-made-permanent-in-the-one-big-beautiful-bill-act
- Illinois DCEO — Opportunity Zones: https://dceo.illinois.gov/opportunityzones.html
- Treasury — NMTC $10B Award Announcement (12/23/2025): https://home.treasury.gov/news/press-releases/sb0345
- CDFI Fund — NMTC: https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit
- Novogradac — NMTC Permanent: https://www.novoco.com/periodicals/articles/the-nmtc-is-permanentnow-what
- HUD USER — QCT/DDA Data: https://www.huduser.gov/portal/datasets/qct.html
- Federal Register — 2026 QCT/DDA Designations (9/30/2025): https://www.federalregister.gov/documents/2025/09/30/2025-19007/statutorily-mandated-designation-of-difficult-development-areas-and-qualified-census-tracts-for-2026
- HUD Open Data — 2026 QCT Layer: https://hudgis-hud.opendata.arcgis.com/datasets/HUD::qualified-census-tracts-2026/about
- NPS — Historic Preservation Tax Incentives: https://www.nps.gov/subjects/taxincentives/index.htm
- IRS — Rehabilitation Credit: https://www.irs.gov/businesses/small-businesses-self-employed/rehabilitation-credit
- IRS — Energy Communities FAQ: https://www.irs.gov/credits-deductions/frequently-asked-questions-for-energy-communities
- IRS — §48E Low-Income Communities Bonus: https://www.irs.gov/credits-deductions/clean-electricity-low-income-communities-bonus-credit-amount-program
- IRS — Elective Pay & Transferability: https://www.irs.gov/credits-deductions/elective-pay-and-transferability
- Congressional Research Service — §179D: https://www.congress.gov/crs-product/IF12862
- HUD — Section 108: https://www.hud.gov/hud-partners/community-section108
- Federal Register — Section 108 FY 2026 Fee: https://www.federalregister.gov/documents/2025/11/19/2025-20345/section-108-loan-guarantee-program-announcement-of-fee-to-cover-credit-subsidy-costs-for-fy-2026
- CDFI Fund — Bond Guarantee: https://www.cdfifund.gov/programs-training/programs/cdfi-bond
- SBA — 7(a)/504 Cumulative Limit Doubled (5/18/2026): https://www.sba.gov/article/2026/05/18/sba-doubles-cumulative-7a-504-loan-limit-10-million
- Treasury — SSBCI: https://home.treasury.gov/policy-issues/small-business-programs/state-small-business-credit-initiative-ssbci
- Illinois DCEO — SSBCI / Advantage Illinois: https://dceo.illinois.gov/smallbizassistance/advantageillinois/ssbci.html
- EDA — Build to Scale: https://www.eda.gov/funding/programs/build-to-scale
- UHY — WOTC 2026 Lapse: https://uhy-us.com/insights/news/2025/december/work-opportunity-tax-credit-wotc-expiration-extension-and-what-employers-need-to-know
- Congress.gov — H.R. 815 (Brownfields Tax Incentive Reauthorization): https://www.congress.gov/bill/119th-congress/house-bill/815/text/ih
- USDA Rural Development — RBDG: https://www.rd.usda.gov/programs-services/business-programs/rural-business-development-grants
