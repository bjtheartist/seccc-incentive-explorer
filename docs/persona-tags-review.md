# Persona Tag Review — Instant Snapshot Lens (Tier 1b, BM4)

**DRAFT — review with SECCC staff before treating as editorial truth.**


These tags drive the `VIEWING AS` persona chips on the instant snapshot. A
persona is a *viewing lens*: selecting one ranks its tagged programs first and
collapses the rest under "Also at this address" (nothing is hidden or removed).
Tags are descriptive ("most often used by ..."), never an eligibility gate.
Untagged programs appear in the **All** lens only.

Canonical source: `public/data/programs.json` (`personas`), mirrored for the
client lens in `lib/report-personas.ts` (`PROGRAM_PERSONA_TAGS`). A unit test
keeps the two in sync.

**Coverage:** 68/70 programs tagged · Starting 19 · Growing/property owner 40 · Developer/investor 44 · Untagged (All only) 2

| Program | Level | Starting | Growing / owner | Developer / investor |
| --- | --- | :---: | :---: | :---: |
| TIF Districts | City |  | ● | ● |
| Federal Opportunity Zones | Federal |  |  | ● |
| Illinois Opportunity Zones | State |  |  | ● |
| Enterprise Zones | State |  | ● | ● |
| Small Business Improvement Fund (SBIF) | City | ● | ● |  |
| EDGE Tax Credit | State |  | ● | ● |
| REV Illinois | State |  |  | ● |
| MICRO Program | State |  |  | ● |
| Data Center Tax Incentive | State |  |  | ● |
| Special Service Area (SSA) | City |  | ● |  |
| High Unemployment Zone (Information Overlay) | Federal |  |  |  |
| Cook County Class 7a Property Tax Incentive | County |  | ● | ● |
| Cook County Catalyst Grant | County | ● | ● |  |
| Cook County C-PACE (Clean Energy Financing) | County |  | ● | ● |
| Cook County Small Business Source | County | ● | ● |  |
| Cook County Land Bank Authority | County |  |  | ● |
| Neighborhood Opportunity Fund (NOF) | City | ● | ● |  |
| New Markets Tax Credits (NMTC) | Federal |  |  | ● |
| Qualified Census Tract (QCT) — LIHTC Boost | Federal |  |  | ● |
| Chicago Landmark District Incentives | City |  | ● | ● |
| Federal Historic Tax Credit (HTC) | Federal |  |  | ● |
| Micro Market Recovery Program | City |  | ● | ● |
| Industrial Corridor Protections | City |  |  |  |
| Commercial Corridor Storefront Activation (CCSA) | City | ● | ● |  |
| SBA HUBZone Program | Federal | ● | ● |  |
| IRA Energy Community Tax Credit Bonus | Federal |  |  | ● |
| IRA Clean Electricity Credits (§48E / §45Y) + Low-Income Communities Bonus | Federal |  |  | ● |
| Elective Pay & Transferability (Clean Energy Credits) | Federal |  |  | ● |
| §179D — Energy Efficient Commercial Buildings Deduction | Federal |  | ● | ● |
| HUD Section 108 Loan Guarantee | Federal |  |  | ● |
| CDFI Fund Bond Guarantee Program | Federal |  |  | ● |
| SBA 7(a) and 504 Loans (Cumulative Cap Doubled to $10M) | Federal | ● | ● | ● |
| SBA Disaster EIDL — Cook County Flood Declaration | Federal | ● | ● |  |
| CHIPS Investment Tax Credit (§48D) | Federal |  |  | ● |
| SSBCI — Advantage Illinois & INVENT VCP | Federal | ● | ● |  |
| EDA Build to Scale (B2S) | Federal |  | ● | ● |
| Building Materials Exemption Certificate (BMEC) | State |  | ● | ● |
| Advancing Innovative Manufacturing (AIM) Tax Credit | State |  | ● | ● |
| Quantum Enterprise Zone (QEZ) Program | State |  |  | ● |
| High Impact Business (HIB) | State |  |  | ● |
| Illinois Innovation Voucher Program | State | ● | ● |  |
| Economic Empowerment Centers (EEC) Grant Program — Round 2 | State | ● |  |  |
| Illinois Film Production Services Tax Credit | State |  | ● |  |
| Illinois Live Theater Production Tax Credit | State |  | ● |  |
| Illinois Cannabis Social Equity Loan Program — Round III | State | ● |  |  |
| Restore, Reinvest, Renew (R3) Program | State | ● |  |  |
| Cook County Class 6b Industrial Property Tax Incentive | County |  | ● | ● |
| Cook County Class 6b SER (Sustainable Emergency Relief) | County |  | ● | ● |
| Cook County Class 7b Commercial Property Tax Incentive | County |  | ● | ● |
| Cook County Class 7c Commercial Urban Relief Eligibility (CURE) | County |  | ● | ● |
| Cook County Class 8 Property Tax Incentive | County |  | ● | ● |
| Cook County Class 8a MICRO (Semiconductor) | County |  |  | ● |
| Cook County Class C Brownfield Property Tax Incentive | County |  |  | ● |
| Cook County Class L Landmark Rehabilitation Incentive | County |  | ● | ● |
| Affordable Housing Special Assessment Program (AHSAP) | County |  |  | ● |
| Cook County Cannabis Development Grant | County | ● |  |  |
| Invest in Cook — Transportation Grant Program | County |  | ● | ● |
| Cook County Brownfield Redevelopment Assistance | County |  |  | ● |
| Community Development Grant — Small (≤ $250K) | City | ● | ● |  |
| Community Development Grant — Medium ($300K – $5M) | City |  | ● | ● |
| Community Development Grant — Large (> $5M) | City |  |  | ● |
| Workforce Solutions Program (formerly TIFWorks) | City |  | ● |  |
| Climate Infrastructure Fund (CIF) / Equitable Transit-Oriented Development (ETOD) | City |  |  | ● |
| ComEd EV Charger and Installation Rebate | Utility |  | ● |  |
| ComEd Small Business Energy Efficiency (Adjacent Capital — NOT a grant incentive) | Utility | ● | ● |  |
| ComEd Distributed Generation Solar + Battery Rebate (Adjacent Capital — NOT a grant incentive) | Utility |  | ● | ● |
| Peoples Gas C&I Energy Efficiency Rebates 2026-2029 (Adjacent Capital — NOT a grant incentive) | Utility |  | ● |  |
| Kiva Chicago 0% Microloan (Adjacent Capital — NOT a grant incentive) | Nonprofit / CDFI | ● |  |  |
| Greenwood Archer Capital CDFI Loans (Adjacent Capital — NOT a grant incentive) | Nonprofit / CDFI | ● | ● |  |
| Allies for Community Business (A4CB) Term & Revenue-Based Loans (Adjacent Capital — NOT a grant incentive) | Nonprofit / CDFI | ● | ● |  |

## Untagged (All lens only)

- `highUnemployment` — High Unemployment Zone (Information Overlay)
- `industrialCorridors` — Industrial Corridor Protections
