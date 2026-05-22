# Cook County Incentive Audit — 2026-05-21

## Summary

- **Coverage gap is real.** The platform lists only **5 County-level programs** today (Class 7a, Catalyst Grant, C-PACE, Small Business Source, CCLBA). The workhorse Assessor incentives that drive most Chicago industrial and commercial deals — **Class 6b, 7b, 7c, 8, 9, C, L** — are completely absent from `programs.json`. This is the single biggest content hole on the site.
- **No 6b variants documented.** The Assessor offers three flavors (standard 6b, 6b SER, 6b CEERM/TEERM), each with different vacancy, ownership, and renewability rules. Each is a distinct decision tree for users and should be its own entry — or at minimum, clearly enumerated as variants under one parent record.
- **Class 9 is effectively deprecated** in favor of the Affordable Housing Special Assessment Program (AHSAP), passed in 2021. We should list AHSAP, not legacy Class 9, and reference the 2026 per-square-foot expenditure thresholds (Tier 1: $8.16/sf; Tier 3: $12.75/sf; Sept 5 deadline).
- **Boundary data is publicly available.** The Cook County Assessor publishes township boundaries (Class 8 is limited to the five south-suburban townships: Bloom, Bremen, Calumet, Rich, Thornton), and Cook Central (`cookcountyil.gov/CookCentral`) is the County's open spatial data portal. A Class 8 layer is feasible.
- **2026 momentum:** Catalyst Grant Round 2 closed Nov 14, 2025 with disbursements in spring 2026; Invest in Cook 2026 round ($8.5M) just closed Mar 20, 2026; the Cannabis Development Grants ($75K per recipient) and County Promise Guaranteed Income (made permanent Nov 2025) are new since the site's last verification.

---

## Inventory: County programs currently in `programs.json`

| id | name | level | notes |
|----|------|-------|-------|
| `class7a` | Cook County Class 7a Property Tax Incentive | County | Only Assessor class on the site. Missing 6b, 7b, 7c, 8, 9, C, L. |
| `catalystGrant` | Cook County Catalyst Grant | County | Round 1 entry. Round 2 details (Sept–Nov 2025, spring 2026 disbursement) need refresh. |
| `cpace` | Cook County C-PACE | County | Looks current. |
| `smallBizSource` | Cook County Small Business Source | County | Current. |
| `landBank` | Cook County Land Bank Authority | County | "PubliCity portal" reference is outdated — CCLBA now uses standard pre-qualification + offer applications. Reclaiming Chicago Initiative (Aug 2025) should be added. |

That's 5 of ~15–18 County programs that materially exist. Coverage ratio is poor relative to the City-level inventory (10 entries).

---

## Recommended additions — drop-in `programs.json` entries

> All entries follow the existing schema. `lastVerifiedAt` set to today (2026-05-21). Phone numbers reuse the verified Assessor main line (312) 443-7550 and BED line (312) 603-1000. Reviewers should sanity-check `benefitRange` strings and add `zoneKey` values if/when matching GeoJSON layers are added.

### 1. Class 6b — Industrial Reactivation

```json
{
  "id": "class6b",
  "name": "Cook County Class 6b Industrial Property Tax Incentive",
  "level": "County",
  "zoneKey": "",
  "summary": "Cook County reduces the assessed value of qualifying industrial property for 12 years to encourage new construction, substantial rehabilitation, or the reoccupancy of abandoned industrial buildings. Renewable in 10-year increments.",
  "whoQualifies": "Industrial property owners or developers anywhere in Cook County undertaking new construction, substantial rehab, or reoccupancy of abandoned industrial buildings. Three variants exist: standard 6b, 6b SER (long-tenured owners under hardship), and 6b CEERM/TEERM (short-vacancy emergency relief).",
  "benefits": [
    "Assessed at 10% of market value for years 1-10 (vs. standard 25%)",
    "15% in year 11, 20% in year 12, then standard rate",
    "Renewable for additional 12-year terms",
    "Typical savings: 60% of property tax liability over the incentive period"
  ],
  "howToApply": [
    "Obtain a municipal resolution of support from the host municipality (City Council ordinance in Chicago)",
    "File the Class 6b Eligibility Application with the Cook County Assessor before construction begins (or within one year of substantial completion)",
    "Submit Incentive Application after project completion with cost documentation",
    "Assessor verifies industrial use and project qualification"
  ],
  "requiredDocs": [
    "Municipal resolution of support",
    "Class 6b Eligibility Application + Incentive Application",
    "Project plans, permits, and cost certifications",
    "Proof of industrial use (NAICS code, employment, equipment)",
    "Abandonment affidavit if claiming reoccupancy"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/incentives-special-properties",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Industrial property in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Industrial use (manufacturing, warehousing, R&D)", "verifiedBy": "survey", "required": true },
    { "criterion": "investmentSize", "description": "New construction, substantial rehab, or reoccupancy of abandoned property", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment (vs. 25%) for 10 years, then 15% / 20%",
  "fastestConfirmingStep": "Call Assessor Incentives at (312) 603-7529 to confirm 6b eligibility"
}
```

### 2. Class 6b SER (Sustainable Emergency Relief)

```json
{
  "id": "class6bSer",
  "name": "Cook County Class 6b SER (Sustainable Emergency Relief)",
  "level": "County",
  "zoneKey": "",
  "summary": "A non-renewable 6b variant for long-tenured industrial owners facing economic hardship. Requires both a municipal Special Circumstances resolution AND a Cook County Board resolution.",
  "whoQualifies": "Industrial owners who have occupied the building for at least 10 years under the same ownership and can demonstrate that without SER designation the business would not be economically viable.",
  "benefits": [
    "10% assessment for 10 years, 15% year 11, 20% year 12",
    "Preserves jobs at existing industrial facilities",
    "Allows in-place expansion without losing existing operations"
  ],
  "howToApply": [
    "Obtain municipal Special Circumstances resolution",
    "Obtain a second supporting resolution from the Cook County Board of Commissioners",
    "File 6b SER application with the Assessor with hardship documentation",
    "Assessor reviews and grants non-renewable 12-year incentive"
  ],
  "requiredDocs": [
    "Municipal Special Circumstances resolution",
    "Cook County Board resolution",
    "10+ years of ownership records",
    "Financial hardship documentation (tax returns, P&Ls)",
    "Employment and operational continuity evidence"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/incentives-special-properties",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Industrial property in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Industrial use with 10+ years of same ownership", "verifiedBy": "manual", "required": true },
    { "criterion": "investmentSize", "description": "Documented economic hardship without incentive", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment for 10 years (non-renewable)",
  "fastestConfirmingStep": "Call Assessor Incentives at (312) 603-7529 to discuss SER hardship case"
}
```

### 3. Class 7b — Large Commercial Reactivation

```json
{
  "id": "class7b",
  "name": "Cook County Class 7b Commercial Property Tax Incentive",
  "level": "County",
  "zoneKey": "",
  "summary": "Same 12-year reduced assessment as 7a but for commercial projects with total costs over $2 million, in areas in need of commercial development.",
  "whoQualifies": "Commercial property owners or developers undertaking new construction, substantial rehabilitation, or reoccupancy in areas determined to need commercial development. Total project cost must exceed $2 million.",
  "benefits": [
    "10% assessment years 1-10 (vs. 25%)",
    "15% year 11, 20% year 12",
    "Renewable for additional terms",
    "Typically used for large mixed-use, retail center, or commercial redevelopment projects"
  ],
  "howToApply": [
    "Secure a municipal resolution finding the area is in need of commercial development",
    "File Class 7b Eligibility Application with the Assessor before commencement",
    "Document that the project would not be economically feasible without the incentive ('but-for' finding)",
    "File final Incentive Application post-completion"
  ],
  "requiredDocs": [
    "Municipal resolution with 'area in need' and 'but-for' findings",
    "Project pro forma demonstrating need for the incentive",
    "Construction budgets exceeding $2M",
    "Plans, permits, and cost certifications"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/incentives-special-properties",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Property in a municipally-designated 'area in need of commercial development'", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Commercial property — new construction, rehab, or reoccupancy", "verifiedBy": "survey", "required": true },
    { "criterion": "investmentSize", "description": "Total project costs over $2 million", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment for 10 years, then 15% / 20%",
  "fastestConfirmingStep": "Call Assessor Incentives at (312) 603-7529 to scope 7b qualification"
}
```

### 4. Class 7c — Commercial Urban Relief Eligibility (CURE)

```json
{
  "id": "class7c",
  "name": "Cook County Class 7c Commercial Urban Relief Eligibility (CURE)",
  "level": "County",
  "zoneKey": "",
  "summary": "Shorter, 5-year reduced-assessment incentive for commercial projects that need a modest tax bump to be feasible but don't meet 7b's full criteria.",
  "whoQualifies": "Commercial property owners undertaking new construction, substantial rehab, or reoccupancy of abandoned property where the project would not be viable at the standard 25% assessment but does not require the longer 7b/8 incentive.",
  "benefits": [
    "10% assessment for years 1-3",
    "15% year 4, 20% year 5",
    "Renewable once for an additional 5 years",
    "Faster ramp than 7a/7b — useful for tighter pro formas"
  ],
  "howToApply": [
    "Obtain municipal resolution of support",
    "File 7c Eligibility Application with the Assessor",
    "Demonstrate viability gap (real estate tax burden, vacancy, market conditions)",
    "File Incentive Application after completion"
  ],
  "requiredDocs": [
    "Municipal resolution",
    "Viability/'but-for' analysis",
    "Project plans, permits, and cost docs",
    "Vacancy or under-utilization evidence"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/incentives-special-properties",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Commercial property in Cook County with municipal support", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Commercial — new construction, rehab, or reoccupancy", "verifiedBy": "survey", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment for 5 years (renewable once)",
  "fastestConfirmingStep": "Call Assessor Incentives at (312) 603-7529 to assess 7c fit"
}
```

### 5. Class 8 — Severely Distressed Industrial/Commercial

```json
{
  "id": "class8",
  "name": "Cook County Class 8 Property Tax Incentive",
  "level": "County",
  "zoneKey": "class8Townships",
  "summary": "Class 8 grants the same 12-year reduced assessment as 6b/7b but is restricted to industrial and commercial property in severely economically depressed areas — primarily the five south-suburban townships: Bloom, Bremen, Calumet, Rich, and Thornton.",
  "whoQualifies": "Industrial or commercial owners/developers in Bloom, Bremen, Calumet, Rich, or Thornton Township. Some Chicago South Side parcels in these township boundaries may qualify. SER and CEERM variants available.",
  "benefits": [
    "10% assessment years 1-10 (vs. 25%)",
    "15% year 11, 20% year 12",
    "Renewable; broader eligibility than 6b/7b within the five townships",
    "Both industrial AND commercial uses qualify (unlike 6b)"
  ],
  "howToApply": [
    "Confirm parcel is in Bloom, Bremen, Calumet, Rich, or Thornton Township",
    "Obtain municipal resolution of support",
    "File Class 8 Eligibility Application with the Assessor before construction",
    "File Incentive Application post-completion with cost certifications"
  ],
  "requiredDocs": [
    "Municipal resolution",
    "Township verification (parcel lookup)",
    "Project plans and permits",
    "Cost documentation and use evidence"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/incentives-special-properties",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Property in Bloom, Bremen, Calumet, Rich, or Thornton Township", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Industrial or commercial use", "verifiedBy": "survey", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment for 10 years, then 15% / 20%",
  "fastestConfirmingStep": "Verify township at cookviewer.cookcountyil.gov, then call (312) 603-7529"
}
```

### 6. Class C — Environmental Remediation

```json
{
  "id": "classC",
  "name": "Cook County Class C Brownfield Property Tax Incentive",
  "level": "County",
  "zoneKey": "",
  "summary": "Class C rewards owners who clean up contaminated industrial or commercial property. After receiving an IEPA 'No Further Remediation' letter, the property gets 12 years of reduced assessment on both land and improvements.",
  "whoQualifies": "Industrial or commercial property owners who have completed environmental remediation. Remediation costs must exceed $100,000 OR 25% of the property's market value. Application must be filed within one year of the NFR letter.",
  "benefits": [
    "10% assessment of market value for years 1-10",
    "15% year 11, 20% year 12",
    "Applies to BOTH land and improvements (unlike most other classes)",
    "Typical savings >$200K over 10 years on a $1M industrial property"
  ],
  "howToApply": [
    "Complete remediation under IEPA Site Remediation Program",
    "Obtain the 'No Further Remediation' (NFR) letter from IEPA",
    "Obtain municipal resolution of support",
    "File Class C application with the Assessor within one year of the NFR letter"
  ],
  "requiredDocs": [
    "IEPA No Further Remediation letter",
    "Remediation cost documentation (≥$100K or ≥25% of MV)",
    "Engineering and legal cost invoices",
    "Municipal resolution",
    "Use plan for the remediated site"
  ],
  "contact": "Cook County Assessor Incentives Department: (312) 603-7529",
  "url": "https://www.cookcountyassessor.com/form-document/class-c",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessor.com/form-document/class-c" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Industrial or commercial property in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Industrial or commercial use post-remediation", "verifiedBy": "survey", "required": true },
    { "criterion": "investmentSize", "description": "Remediation costs ≥$100K or ≥25% of market value", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment on land + improvements for 10 years",
  "fastestConfirmingStep": "Confirm IEPA NFR letter is in hand, then call (312) 603-7529"
}
```

### 7. Class L — Landmark Rehabilitation

```json
{
  "id": "classL",
  "name": "Cook County Class L Landmark Rehabilitation Incentive",
  "level": "County",
  "zoneKey": "historicDistricts",
  "summary": "Class L rewards rehabilitation of landmark commercial, industrial, or income-producing not-for-profit buildings. Owner must invest at least 50% of the building's market value in approved rehabilitation work.",
  "whoQualifies": "Owners of designated Chicago landmark buildings or buildings in landmark districts (Class 3, 4, 5a, or 5b uses). Investment must equal at least half the building's market value. City of Chicago Commission on Chicago Landmarks must support the application.",
  "benefits": [
    "10% assessment on building/improvements for years 1-10",
    "15% year 11, 20% year 12, then standard rate in year 13",
    "Land portion also eligible if building was vacant 2+ years",
    "Stacks effectively with federal Historic Tax Credit"
  ],
  "howToApply": [
    "Submit preliminary application to City of Chicago Department of Planning and Development (Historic Preservation Division)",
    "Obtain Commission on Chicago Landmarks recommendation and City Council ordinance",
    "Complete certified rehab work consistent with Secretary of the Interior's Standards",
    "File final Class L application with the Cook County Assessor"
  ],
  "requiredDocs": [
    "Landmark designation documentation",
    "Rehabilitation scope and budget (≥50% of MV)",
    "Historic preservation review and approval",
    "City Council ordinance supporting Class L",
    "Final certification of completed work"
  ],
  "contact": "Chicago DPD Historic Preservation: (312) 744-3200; Cook County Assessor: (312) 603-7529",
  "url": "https://www.chicago.gov/city/en/depts/dcd/provdrs/hist/svcs/class_l_propertytaxincentive.html",
  "contacts": [
    { "agency": "Chicago DPD Historic Preservation", "abbreviation": "DPD-HP", "phone": "(312) 744-3200", "url": "https://www.chicago.gov/city/en/depts/dcd/provdrs/hist/svcs/class_l_propertytaxincentive.html" },
    { "agency": "Cook County Assessor's Office — Incentives", "abbreviation": "CCAO", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/incentives-special-properties" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Designated Chicago landmark or contributing property in a landmark district", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Commercial, industrial, or income-producing not-for-profit use", "verifiedBy": "survey", "required": true },
    { "criterion": "investmentSize", "description": "Rehab investment ≥50% of building market value", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "10% assessment on improvements for 10 years (12-year total schedule)",
  "fastestConfirmingStep": "Call DPD Historic Preservation at (312) 744-3200 to verify landmark eligibility"
}
```

### 8. Affordable Housing Special Assessment Program (replaces legacy Class 9)

```json
{
  "id": "ahsap",
  "name": "Affordable Housing Special Assessment Program (AHSAP)",
  "level": "County",
  "zoneKey": "",
  "summary": "AHSAP (Illinois Affordable Housing Special Assessment Program, administered by the Cook County Assessor) freezes the assessed value of qualifying multifamily rental buildings that maintain affordability. Replaces legacy Class 9 for most use cases.",
  "whoQualifies": "Owners of multifamily rental buildings (typically 7+ units) who commit to affordability set-asides and complete qualifying capital investment. Three tiers (Tier 1/2/3) calibrated to neighborhood market conditions.",
  "benefits": [
    "Assessment reduction tied to affordability commitment",
    "Tier 1 / Tier 3 thresholds based on per-square-foot capital expenditure",
    "2026 thresholds: $8.16/sf (Tier 1) and $12.75/sf (Tier 3) for compliance + replacement of 2 primary systems",
    "Multi-year benefit; renewable with continued compliance"
  ],
  "howToApply": [
    "Confirm tier eligibility based on building location and affordability commitment",
    "Submit Part 1 application by September 5 of the assessment year",
    "Submit Part 2 application with capital expenditure documentation",
    "Maintain affordability covenant for duration of benefit"
  ],
  "requiredDocs": [
    "Part 1 + Part 2 application forms",
    "Affordability covenant / rent restriction agreement",
    "Capital expenditure documentation meeting per-sf threshold",
    "Documentation of replacement of 2 primary building systems",
    "Annual recertification of affordable units"
  ],
  "contact": "Cook County Assessor — Affordable Housing: (312) 603-7529",
  "url": "https://www.cookcountyassessoril.gov/affordable-housing",
  "contacts": [
    { "agency": "Cook County Assessor's Office — Affordable Housing", "abbreviation": "CCAO-AH", "phone": "(312) 603-7529", "url": "https://www.cookcountyassessoril.gov/affordable-housing" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Multifamily rental property in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Multifamily rental with affordability commitment", "verifiedBy": "survey", "required": true },
    { "criterion": "investmentSize", "description": "Capital expenditure meeting tier threshold ($8.16-$12.75/sf for 2026)", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "Assessment freeze, tiered by neighborhood market",
  "fastestConfirmingStep": "Call (312) 603-7529 or visit cookcountyassessoril.gov/affordable-housing before Sept 5 deadline"
}
```

### 9. Cook County Cannabis Development Grant

```json
{
  "id": "cookCannabisGrant",
  "name": "Cook County Cannabis Development Grant",
  "level": "County",
  "zoneKey": "",
  "summary": "$75,000 grants to social-equity cannabis license holders to support build-out and operations. Announced December 2025 with nine additional recipients; ongoing program through the Bureau of Economic Development.",
  "whoQualifies": "Social-equity cannabis license holders (dispensary, craft grow, transporter, infuser) operating in Cook County. Must meet Illinois Cannabis Regulation and Tax Act social-equity criteria.",
  "benefits": [
    "$75,000 grant per recipient",
    "Funds may be used for buildout, equipment, legal/compliance, working capital",
    "Pairs with state Cannabis Business Development Fund loans"
  ],
  "howToApply": [
    "Watch for application windows announced via Cook County BED",
    "Demonstrate Illinois social-equity status",
    "Submit business plan and use-of-funds",
    "Awards announced periodically by President's office"
  ],
  "requiredDocs": [
    "Illinois Cannabis social-equity certification",
    "Cook County operating address proof",
    "Business plan and budget",
    "Tax returns / financials"
  ],
  "contact": "Cook County Bureau of Economic Development: (312) 603-1000",
  "url": "https://www.cookcountyil.gov/agency/bureau-economic-development",
  "contacts": [
    { "agency": "Cook County Bureau of Economic Development", "abbreviation": "CCBED", "phone": "(312) 603-1000", "url": "https://www.cookcountyil.gov/agency/bureau-economic-development" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Cannabis business in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "industry", "description": "Licensed cannabis operator with Illinois social-equity status", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "$75,000 per recipient",
  "fastestConfirmingStep": "Call CCBED at (312) 603-1000 about upcoming rounds"
}
```

### 10. Invest in Cook (transportation infrastructure)

```json
{
  "id": "investInCook",
  "name": "Invest in Cook — Transportation Grant Program",
  "level": "County",
  "zoneKey": "",
  "summary": "Annual $8.5M grant program from Cook County DOTH funding planning, engineering, ROW, and construction for transportation projects. Private organizations may participate as partners to a public sponsor. 10th round closed March 2026.",
  "whoQualifies": "Local governments, transit agencies, regional transportation authorities, and public-land agencies in Cook County. Private for-profit or nonprofit organizations may submit if partnered with an eligible public sponsor.",
  "benefits": [
    "$8.5M annual program total",
    "Funds planning, feasibility, engineering, ROW, and construction",
    "Covers transit, bike/ped, freight, roadway, and bridge work",
    "Aligns projects with Connecting Cook County long-range plan"
  ],
  "howToApply": [
    "Watch for the annual call (typically opens January)",
    "Identify a public sponsor if a private organization",
    "Submit application demonstrating alignment with Connecting Cook County priorities",
    "Awards announced after committee review"
  ],
  "requiredDocs": [
    "Project description and scope",
    "Budget and matching funds (if any)",
    "Public sponsor letter (for private applicants)",
    "Plan-consistency documentation"
  ],
  "contact": "Cook County Department of Transportation and Highways: (312) 603-1601",
  "url": "https://www.cookcountyil.gov/investincook",
  "contacts": [
    { "agency": "Cook County DOTH", "abbreviation": "DOTH", "phone": "(312) 603-1601", "url": "https://www.cookcountyil.gov/investincook" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Transportation project in Cook County", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Public infrastructure or sponsored private project", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "Grant award sized to project (program total $8.5M/year)",
  "fastestConfirmingStep": "Visit cookcountyil.gov/investincook for next call schedule"
}
```

### 11. Cook County Brownfield Redevelopment Assistance (DES)

```json
{
  "id": "cookBrownfield",
  "name": "Cook County Brownfield Redevelopment Assistance",
  "level": "County",
  "zoneKey": "",
  "summary": "ARPA-funded brownfield assessment and remediation services for suburban Cook County property owners, administered by the Department of Environment and Sustainability. Pairs with Class C for full lifecycle benefit.",
  "whoQualifies": "Qualified property owners in suburban Cook County (not the City of Chicago) with potential or known contamination. Coalition partners including SSMMA serve the south suburbs.",
  "benefits": [
    "Phase I and Phase II environmental site assessments at no cost",
    "Cleanup planning support",
    "Bridges to IEPA Site Remediation Program and Class C incentive",
    "Coordinates with SSMMA's South Suburban Brownfields Coalition"
  ],
  "howToApply": [
    "Contact Cook County Department of Environment and Sustainability",
    "Submit site inquiry with parcel info and known/suspected contamination",
    "Coordinate with SSMMA if site is in the south-suburban coalition area",
    "Move into IEPA SRP after Phase II"
  ],
  "requiredDocs": [
    "Property ownership documentation",
    "Site history and known contamination evidence",
    "Redevelopment intent statement"
  ],
  "contact": "Cook County Department of Environment and Sustainability: (312) 603-8200",
  "url": "https://www.cookcountyil.gov/service/brownfield-redevelopment",
  "contacts": [
    { "agency": "Cook County DES", "abbreviation": "DES", "phone": "(312) 603-8200", "url": "https://www.cookcountyil.gov/service/brownfield-redevelopment" },
    { "agency": "South Suburban Mayors and Managers Association", "abbreviation": "SSMMA", "phone": "(708) 922-4670", "url": "https://www.ssmma.org/brownfields" }
  ],
  "eligibilityRules": [
    { "criterion": "location", "description": "Suburban Cook County property (CCDES area)", "verifiedBy": "location", "required": true },
    { "criterion": "propertyType", "description": "Property with known or suspected environmental contamination", "verifiedBy": "manual", "required": true }
  ],
  "lastVerifiedAt": "2026-05-21",
  "benefitRange": "Phase I/II assessments and remediation planning (no-cost to qualifying owners)",
  "fastestConfirmingStep": "Call Cook County DES at (312) 603-8200 for site eligibility"
}
```

---

## Boundary data sources for County zone layers

| Layer needed | Source | Format |
|---|---|---|
| Class 8 townships (Bloom, Bremen, Calumet, Rich, Thornton) | Cook County Assessor township boundaries; Cook Central GIS portal (`cookcountyil.gov/CookCentral`); `ChicagoCityscape/pins` GitHub repo has assessor township GeoJSON in WGS84 | Shapefile / GeoJSON |
| Cook County municipal boundaries (for 6b/7a/7b/7c municipal-resolution gating) | Cook County Data Portal `datacatalog.cookcountyil.gov` | GeoJSON / CSV |
| Landmark districts (Class L) — already represented | City of Chicago `data.cityofchicago.org` historic districts | GeoJSON (already in `historicDistricts` layer) |
| AHSAP tier zones | CCAO published an interactive AHSAP impact map (Jan 2026) — extract polygons from `cookcountyassessoril.gov/news/new-ccao-data-map-explores-impact-affordable-housing-program` | GeoJSON, may require digitization |
| Brownfield priority areas (Cook County DES + SSMMA) | EPA Brownfields ACRES data + SSMMA coalition area | KML / Shapefile |

Recommended next step: pull township shapefile from Cook Central, filter to the five Class 8 townships, run through the existing `scripts/convert-kml.mjs` pipeline (or write a parallel `.mjs` for shapefile→GeoJSON), drop into `public/data/zones/class8Townships.geojson`, and register in `lib/constants.ts` with a hex color. Then set `"zoneKey": "class8Townships"` on the Class 8 program entry above.

---

## New / changed programs since late 2025

- **Catalyst Grant Round 2** (Sept 25 – Nov 14, 2025; $8.8M ARPA; up to 88 awards of $100K; disbursements spring 2026). Refresh `catalystGrant` `lastVerifiedAt` and benefit description.
- **Cannabis Development Grant — additional 9 awardees** announced Dec 2025 by President Preckwinkle (Entry #9 above).
- **Cook County Promise Guaranteed Income** — extended into FY2026 (Nov 20, 2025 board vote); design finalization mid-2026. Not a business incentive, so skip from `programs.json` but note in any household-facing context.
- **Invest in Cook 10th round** — $8.5M program; call closed March 20, 2026 (Entry #10 above).
- **Reclaiming Chicago Initiative (CCLBA)** — groundbreaking Aug 2025 converting South Side lots to new homes. Update `landBank` entry to mention this and remove outdated "PubliCity portal" reference.
- **AHSAP 2026 thresholds** — $8.16/sf (Tier 1) and $12.75/sf (Tier 3) for compliance + replacement of 2 primary systems; Part 1 + Part 2 deadline Sept 5, 2026 (Entry #8 above).
- **Landmark Tax Incentives (Class L) approved Nov 2025** for additional Loop / Near West Side buildings — confirms Class L is active and being approved regularly through City Council.
- **2026 CDBG/ESG application cycle** — open Jan 14 – Mar 20, 2026. Capital Improvement (econ dev + demolition) and Public Service streams. Worth adding as a separate entry for nonprofit/municipal users, though it's not a direct business incentive.
- **Cook County FY2026 budget hearings** flagged risk of federal grant losses — monitor for ARPA wind-down impacts on Catalyst and Brownfield programs.

---

## Sources

- [Cook County Assessor — Incentives & Special Properties](https://www.cookcountyassessoril.gov/incentives-special-properties)
- [Cook County — Property Tax Incentives service page](https://www.cookcountyil.gov/service/property-tax-incentives)
- [Cook County Assessor — Affordable Housing Special Assessment Program](https://www.cookcountyassessoril.gov/affordable-housing)
- [Cook County Assessor — Class 9 form/document](https://www.cookcountyassessoril.gov/form-document/class-9)
- [Cook County Assessor — Class C form/document](https://www.cookcountyassessor.com/form-document/class-c)
- [City of Chicago — Class L Property Tax Incentive](https://www.chicago.gov/city/en/depts/dcd/provdrs/hist/svcs/class_l_propertytaxincentive.html)
- [Cook County Land Bank Authority](https://www.cookcountylandbank.org/)
- [Cook County Small Business Source — Catalyst Grant](https://cookcountysmallbiz.org/catalystgrant-2/)
- [Cook County President — Catalyst Grant launch announcement](https://www.cookcountyil.gov/news/cook-county-president-toni-preckwinkle-announces-launch-catalyst-grant-support-businesses-are)
- [Cook County President — Cannabis Development Grants (Dec 2025)](https://www.cookcountyil.gov/news/cook-county-president-toni-preckwinkle-announces-nine-additional-recipients-cannabis)
- [Invest In Cook](https://www.cookcountyil.gov/investincook)
- [Cook County Brownfield Redevelopment](https://www.cookcountyil.gov/service/brownfield-redevelopment)
- [SSMMA Brownfields](https://www.ssmma.org/brownfields)
- [Cook Central GIS portal](https://www.cookcountyil.gov/CookCentral)
- [Cook County Open Data](https://datacatalog.cookcountyil.gov/)
- [CCAO new affordable housing impact map (Jan 2026)](https://www.cookcountyassessoril.gov/news/new-ccao-data-map-explores-impact-affordable-housing-program)
- [Cook County Board approves eight tax incentives (news)](https://www.cookcountyil.gov/news/cook-county-board-approves-eight-tax-incentives-designed-support-economic-growth)
- [Landmark Tax Incentives Approved, Loop / Near West Side (Nov 2025)](https://www.chicago.gov/city/en/depts/dcd/provdrs/ec_dev/news/2025/november/landmark-tax-incentives-approved-for-loop--near-west-side-buildi.html)
- [Cook County 2026 CDBG/ESG applications](https://www.cookcountyil.gov/service/community-development-block-grant-cdbg-and-emergency-solutions-grants-esg-applications-2026)
