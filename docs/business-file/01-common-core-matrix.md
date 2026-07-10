## Canonical Common-Core Matrix — SECCC Incentive Preparation Packet

**Purpose of this document.** Define the persistent business profile that lets the packet honestly claim "80–90% ready." A field/document earns a place in the CORE only if it recurs across two or more of the four researched program families (SBIF, NOF, Cook County 6b/7a/7b/8, and the cross-program city/state prerequisite cluster) AND is stable enough to obtain once and reuse. Everything program-triggered, per-application, or CAL/finalist-gated is pushed down into the per-program delta (Section 2), never banked as "done" in the base profile.

Grouping is exactly as specified: **A. General information** (identity the business always knows) → **B. Background & context** (narrative + qualifying facts assembled once) → **C. Continuity-of-effort documents** (artifacts obtained once and reused, each with an expiry rule). Foundational information first; incentive-specific pieces layer on top in Section 2.

---

### 1A. CORE — General Information (identity; the always-true base layer)

| Core field | Recurs in | In snapshot today? | Notes |
|---|---|---|---|
| Legal business/entity name | SBIF, NOF, 6b/7a/7b/8, prereq cluster | ✅ `legalName` | Must match site-control docs and SOS filing exactly. |
| DBA / assumed / trade name | SBIF, prereq cluster | ✅ `dbaName` | SBIF form requires literal "Not Applicable" if none. |
| Entity type / organization structure | All four | ✅ `entityType` | Drives who may sign (beneficiary/officer/GP for trust/corp/partnership). |
| Formation / establishment date (year) | SBIF, NOF, 6b/7a, prereq cluster | ✅ `formationDate` | SBIF also needs the derived "start-up (<3 yr)?" flag — see 1B. |
| **Federal EIN / Tax ID** | NOF, 6b/7a/7b/8, prereq cluster (W-9, EDS, IDOR) | ❌ **MISSING** | Hard gap. Needed for W-9, EDS, tax-clearance, every state/county filing. |
| Physical business address(es) | All four | ✅ `physicalAddress` | Single string today; programs need per-site + project-address distinct from mailing. |
| Mailing / correspondence address | SBIF (explicit separate field), NOF | ✅ `mailingAddress` | |
| Primary contact: name | All four | ✅ `contactName` | |
| Primary contact: email | All four | ✅ `contactEmail` | |
| Primary contact: phone | All four | ✅ `contactPhone` | |
| Industry / business description | All four | ⚠️ partial `industry` | `industry` is a bucket; programs want a free-text **business description** narrative too (SBIF, NOF, 6b occupant description). Add distinct field. |
| NAICS code | prereq cluster, general intake | ✅ `naicsCode` | |
| Employee count (current FT/PT, Cook County) | SBIF (industrial ≤200 FTE), 6b/7a/7b/8 (employment data), prereq | ⚠️ `employeeCount` (single int) | Cook County wants FT and PT split, current vs projected, plus projected construction jobs. Single int is too coarse. |
| **IL Secretary of State file/registration number** | 6b/7a/7b/8, prereq cluster | ❌ **MISSING** | Needed to pull Certificate of Good Standing and for SOS-registration confirmation. |
| **City of Chicago business license number + status** | SBIF, NOF, prereq cluster | ❌ **MISSING** (buried in `licenses` JSON at best) | Should be a first-class, queryable field with active/standing state, not free JSON. |

### 1B. CORE — Background & Context (qualifying facts + narratives assembled once)

| Core field | Recurs in | In snapshot today? | Notes |
|---|---|---|---|
| **Structured ownership** — each owner/entity, % interest, controlling entities, flag for >7.5% and <7.5% cases | SBIF (≥7.5% & child-support/SSN logic), NOF (ownership chart, Principal Profile), 6b/7a/7b/8 (all interested parties), EDS (>7.5% disclosers) | ⚠️ only `ownershipNotes` free text | **Major gap.** Free text cannot drive the SBIF "≥7.5% owner" branch, the EDS >7.5% disclosure list, or NOF's org/ownership chart. Needs a repeatable owner sub-record: name, address, % , role (owner/GP/LP/beneficiary/developer/occupant), is-controlling. |
| **Owner demographics (voluntary)** — race/ethnicity, gender, LGBTQIA, veteran, family-owned | SBIF "Additional Information" section; reusable for MBE/WBE certification | ❌ **MISSING** | Explicitly voluntary / no-effect-on-outcome; store separately with clear consent framing. Enables future MBE/WBE reuse. |
| **Annual gross sales / revenue, 3-year history (+ 3-yr projection for start-ups)** | SBIF (<$9M eligibility + reimbursement tier), prereq cluster | ❌ **MISSING** | Determines both eligibility and the 90/60/30% tier. Needs 3 discrete years, not one number. |
| **Net worth + liquid assets** (per individual/entity) | SBIF landlord (≤$9M net worth / ≤$500K liquid) | ❌ **MISSING** | Landlord/property-owner eligibility gate. |
| Start-up flag (<3 yr) + "in business ≥X years" | SBIF, 6b SER (≥10-yr same-ownership), NOF | ❌ derivable but not stored | Derive from `formationDate` but store the boolean the forms ask for. |
| National chain / franchise? (Yes disqualifies SBIF) | SBIF | ❌ **MISSING** | Binary disqualifier — cheap to capture once. |
| Other business locations (addresses + activity) | SBIF | ❌ **MISSING** | |
| Ineligible-use self-screen (bank/tavern/payday/adult/worship/etc.) | SBIF (long ineligible list), NOF (worship/residential/heavy-industrial exclusions) | ❌ **MISSING** | Store as a screening result so the packet can honestly surface "you may be ineligible for SBIF because…". |
| **Property PIN(s)** + township + ward | 6b/7a/7b/8 (per-PIN), SBIF (ward), NOF (corridor) | ❌ **MISSING** | Cook County keys everything on Permanent Real Estate Index Number; SBIF/NOF key on ward/corridor. Needed on the property record, not the business record. |
| **TIF district / corridor / eligibility-area determination** | SBIF (TIF), NOF (corridor), 6b/7a/7b/8 (certified area/township) | ❌ **MISSING** | Result of the locator/eligibility-map check; the binary geographic gate. Store the determination + date checked. |
| Site-control basis: own vs. lease vs. purchase-agreement | SBIF, NOF, 6b/7a/7b/8 | ⚠️ partial | The *document* is in 1C; the *basis flag* belongs here. |
| Prior/pending City/County incentive history (SBIF/NOF/CDG/TIF, per property + date + amount) | SBIF (offset rule + 3-yr property cooldown), NOF, prereq (award-reduction) | ❌ **MISSING** | Offset and cooldown rules are **per-property**, so track history keyed to property, not just applicant. |
| Community-impact / benefit narrative | NOF (scored factor), 6b/7a/7b (necessity narrative) | ❌ **MISSING** | Reusable narrative asset. |
| Outstanding City-debt / scofflaw self-disclosure + child-support compliance status | SBIF, NOF, prereq cluster | ❌ **MISSING** | Status can be self-checked ahead even though SSN submission is program-triggered. Store the self-check result + date. |
| Cook County property-tax standing (current?) | SBIF, NOF, 6b/7a/7b/8 | ❌ **MISSING** | Recency-sensitive gate (see expiry table). |

### 1C. CORE — Continuity-of-Effort Documents (obtained once, reused; expiry-governed)

| Document | Recurs in | Front-loadable? | Expiry / refresh rule |
|---|---|---|---|
| Proof of site control — deed / executed lease (≥5-yr for NOF) / purchase-and-sale agreement | SBIF, NOF, 6b/7a/7b/8 | ✅ gather & organize now | No fixed expiry, but names must match applicant + site exactly; lease can lapse — track lease end date. |
| W-9 (payee/taxpayer certification) | NOF, prereq cluster | ✅ | No expiry unless business info changes. |
| Federal EIN documentation | all | ✅ | Permanent. |
| IL Secretary of State **Certificate of Good Standing / Existence** | 6b/7a/7b/8, prereq cluster | ✅ (minutes online) | No statutory shelf life, but reviewers want a *recently issued* copy — treat as ~90-day "fresh." Cheap to re-pull. |
| 3 years of **business + personal tax returns** | SBIF (net-worth/sales verify), prereq | ✅ assemble now | Rolls annually — most recent 3 years; refresh each tax year. |
| Income statements + bank statements (3-yr) | SBIF | ✅ assemble now | Rolls annually; SBIF-stage financing proof (50%) is program-triggered, not this. |
| Start-up business plan + 36-month income/expense projections | SBIF, NOF, 6b/7a start-ups | ✅ if start-up | Refresh if scope/financing changes. |
| Certificate/Proof of Insurance (business general liability) | prereq cluster (where required), GC insurance is program-side | ✅ | **Annually renewing** — must be active through any construction; track renewal date. |
| Community-impact narrative doc | NOF, 6b/7a/7b | ✅ | Static asset; revise as project changes. |
| Organization / ownership chart + Principal Profile groundwork | NOF, 6b/7a/7b/8, EDS | ✅ | Refresh when ownership changes. |
| 6-year real-estate tax / AV / EAV analysis (property) | 6b/7a/7b | ✅ (data doesn't change once pulled) | Refresh if reassessment year passes. |
| Pro forma financials (with vs. without incentive) | 6b/7a/7b, NOF Sources-and-Uses groundwork | ✅ | Refresh with financing/scope changes. |

**NOT core (intentionally excluded — pushed to Section 2):** EDS filing, scofflaw/City-debt clearance *result*, SSN submission, 2 competing licensed-contractor bids + GC license/insurance, permit / permit application, 50%-financing proof tied to a CAL, redevelopment agreement, triennial/annual compliance affidavits, all Stage-4 proof-of-payment. These are finalist/window/CAL-gated and expire against program clocks — banking them as "done" would be dishonest about readiness.

---

### 2. Incentive-Specific Delta (residual per program — NOT covered by the core)

#### 2A. SBIF (SomerCor / DPD) — delta beyond core
- **Fields:** Applicant Type single-select (10 mutually-exclusive types: Commercial/Industrial/Non-Profit × Owner/Tenant/Multi-Tenant/Landlord); reimbursement-tier self-placement (<$3M=90% / $3–6M=60% / $6–9M=30%; industrial flat 50%); project-plan description; project **budget table** (cost category / amount / notes / total); funds-or-financing-available Y/N; seeking-loan Y/N; need-help-financing Y/N; amount-secured-so-far $; "did anyone help you fill this out" + helper contact; LaSalle Central special-rule fields (max $250K/project, LMI-expansion +$50K bonus).
- **Docs:** Stage-1 individualized document request (per applicant type); Economic Disclosure Affidavit; **full SSN via SomerCor secure portal** for ≥7.5% owners; 2 apples-to-apples licensed-contractor bids + each contractor's City license + insurance; proof of financing (≥50% equity or lender commitment letter) within 120 days of Conditional Commitment Letter; permit or permit-application receipt (120-day window); Stage-4 sworn statement, invoices, cancelled checks, final lien waiver, permits; grantee 3-yr non-relocation affidavit; SBIF decal photo post-completion; religious-org worship-use affidavit if applicable.
- **Steps/gates unique:** submission only during the property's **TIF district monthly window** (1st 9am–30th 5pm, rotating calendar); lottery if oversubscribed; Stage 1 = 20 days; Stage 2 = 120 days; construction 300 days; reimbursement 4–6 wks; **per-property 3-yr Maximum-Assistance cooldown**; offset dollar-for-dollar vs other Direct City Financial Assistance.

#### 2B. NOF (DPD, Bureau of Small Business Development) — delta beyond core
- **Fields:** corridor type (Eligible vs Priority) confirmed on Eligibility Map; project type = capital real-estate (new construction / addition / rehab — acquisition-only is ineligible); Sources-and-Uses table; hard/soft/acquisition cost breakdown; requested grant amount (≤75%, cap $250K); Technical Assistance Fund opt-in (+20%/$50K); total-project-cost >$150K + 30% contingency check.
- **Docs:** ≥2 itemized GC bids (no lump sum) + GC City license + COI; architectural/permit-ready drawings; construction timeline; EDS; Affidavit of Child-Support Compliance; Affidavit & Certification of Property Owner; Principal Profile Form; cleared scofflaw (Dept. of Finance); Certificate of Occupancy; recorded **NOF recapture covenant**; SOS-registration confirmation; escrow-path sworn owner's + GC statements + lien waivers; Completion Survey; **annual status-report surveys (3-yr term)**.
- **Steps/gates unique:** rolling submission / **quarterly deadline** (Aug 14 2026, Nov 13 2026); scoring on 4 factors 1–3 mo; Advisory Committee → Commissioner → Finalist; Stage-1 legal 21 days; Stage-2 → CAL 120 days; proof-of-financing within **4 months of CAL**; construction 12 mo from CAL; project complete within 2 yr of CAL; 3-yr recapture term.

#### 2C. Cook County Classes 6b / 7a / 7b / 8 (Assessor + municipal/DPD support) — delta beyond core
- **Fields:** class selection + basis-of-area-eligibility (certified area / Bloom-Bremen-Calumet-Rich-Thornton township for Class 8); development type (new construction / substantial rehab / reoccupation-of-abandoned, with/without special circumstance / TEERM); legal description + site & building dimensions/sq ft; estimated commencement/completion (or reoccupation) dates; abandonment claim data (purchase date, purchaser, seller, purchaser-seller relationship, vacancy duration + evidence); employment baseline + projected new/construction jobs; municipal resolution status.
- **7a/7b-only:** five Sec. 74-65(a) exhibits (area designation; 6-yr tax/AV/EAV analysis; development plan; pro forma with/without incentive; financing terms; principals' background; schedule). **6b SER-only:** 10-yr same-ownership occupancy + hardship/viability showing.
- **Docs:** class Eligibility Application + filing fee ($1,000 6b / $500 7a/7b/8); **certified municipal (or County Board) consent ordinance/resolution**; abandonment evidence bundle (sworn vacancy statements, utility statements, sale contract, closing statement, recorded deed, AOBI, transfer declaration); Cook County Living Wage affidavit (6b); permits + itemized cost + contractor affidavits; Incentives Appeal Form (fee $100 for 7a) on township deadline; **notarized triennial affidavit** (use + employment); renewal application + fresh consent resolution.
- **Chicago-property overlay:** DPD Submittable intake; **Redevelopment Agreement** (mandatory since 11/1/2020); Economic Disclosure Statement; Committee on Economic/Capital/Tech Development → Community Development Commission → City Council vote.
- **Steps/gates unique:** Eligibility App must be filed **before** construction/rehab/reoccupation begins (6b up to 1 yr early); 7a determination within 60 days, lapses after 1 yr if not commenced; abandonment thresholds 12 mo (6b) vs 24 mo (7a/7b/8; TEERM bridges 12–24, not renewable); triennial affidavit 3-week no-cure return window; renewal in final 10%-level year.

#### 2D. Cross-Program Prerequisite Cluster (city/state common bundle + Workforce Solutions) — delta beyond core
- **Fields:** prior-relief history (B2B/BIG/RRF/EHG etc.) for award-reduction logic; controlling-entity list (>7.5% for EDS).
- **Docs/steps:** **IDOR Tax Clearance Letter (Form ITR-1)** — ~10 business days, unobtainable while any return unfiled or balance owed (hard gate, not a bankable artifact); **EDS** filing per Matter (draft auto-deletes in 60 days; non-contract data expires at 1 yr; recertify before Council action/closing); City Debt Check / license-standing clearance (gate, not a dated doc); Chicago Workforce Solutions (ex-TIF-Works) Q3 (Jul 1–30) / Q4 (Oct 1–30) 2026 cycles + year-round TIF-district applications.
- **Status flags to encode (do NOT model as open):** DCEO **B2B / B2B-NewBiz CLOSED** (2023 windows lapsed); DCEO **OE3 Capital & Infrastructure Grant CLOSED 4/7/2025, no relaunch** — no current open DCEO direct-capital equivalent; surface as closed rather than fabricate a replacement.

---

### 3. Document-Expiry / Staleness Table (encode these rules in the data model)

| Item | Class | Staleness rule | Refresh trigger |
|---|---|---|---|
| IL Certificate of Good Standing | Soft-fresh | No statutory expiry; reviewers want "recently issued" | Treat >~90 days as stale; re-pull online (minutes) |
| IDOR Tax Clearance (ITR-1) | Hard gate | Cannot be issued at all while delinquent; ~10 biz-day processing | Re-request per application; blocked until filings+balances current |
| City Debt Check / license standing | Gate (no date) | Not a dated document — a pass/fail state | Re-verified at each program stage; blocked until debt cleared/on plan |
| EDS draft | Expiring | **Auto-deletes 60 days** unsubmitted | Re-file; recertify before Council action/closing |
| EDS submitted (non-contract data) | Expiring | Expires **1 year** | Refresh annually |
| Cook County property-tax standing | Recency gate | Must be current **at each gate** (SBIF: commitment-letter AND reimbursement; verified twice) | Re-verify before each disbursement stage |
| SBIF SSN / child-support & scofflaw check | Point-in-time | Must be clear at time of check; **re-verified at commitment + reimbursement** | Re-run at each gate |
| Proof of financing (50%) — SBIF | Window-bound | Due within **120 days** of Conditional Commitment Letter | Tied to approved contract price (post-bids) |
| Proof of financing — NOF | Window-bound | Must be demonstrated within **4 months of CAL** | Refresh against CAL date |
| 3-yr tax returns / income / bank statements | Rolling | Most-recent-3-years window | Refresh each tax year |
| Certificate of Insurance / GC COI | Annual | Renews annually; must stay active through construction | Track renewal date |
| Triennial affidavit (Cook County) | Strict recurring | Signed + notarized + returned within **3 weeks**, no cure | Every 3-yr reassessment; miss = incentive forfeited |
| NOF annual status-report survey | Recurring | Due each year of the 3-yr post-completion term | Annual |
| Lease (site control) | Event-based | Lapses at lease end; NOF needs ≥5-yr term | Track lease end date |
| SBIF/NOF/County prior-grant record | Cooldown clock | SBIF per-property Max-Assistance **once / 3 yr**; offset window 3 yr | Track per-property, not per-applicant |
| 7a class determination | Expiring approval | Lapses after **1 year** if project not commenced | Re-file if project slips |

---

### 4. Where `BusinessProfileSnapshot` Falls Short of the Core

Current snapshot (verified, lib/incentive-preparation.ts lines 69–85) has **15 fields**: `legalName, dbaName, physicalAddress, mailingAddress, contactName, contactEmail, contactPhone, entityType, formationDate, industry, naicsCode, employeeCount, ownershipNotes, licenses (JsonValue), fieldProvenance`. It covers basic identity + contact well, but cannot honestly support "80–90% ready" because the following core elements are absent or too coarse:

**Hard-missing scalar fields (add as first-class, queryable columns):**
1. `ein` — Federal EIN / Tax ID. Blocks W-9, EDS, IDOR clearance, every county/state filing. **Highest-priority gap.**
2. `businessLicenseNumber` + `businessLicenseStatus` — currently at best buried in the untyped `licenses` JSON; needed as a standing flag (SBIF/NOF/prereq).
3. `ilSosFileNumber` — for Good-Standing pull + SOS-registration confirmation.
4. `businessDescription` (narrative) — distinct from the `industry` bucket; every program asks for it.
5. `annualGrossSales` — **3-year history** (year/amount) + start-up 3-yr projection. Drives SBIF eligibility and the 90/60/30% tier. Single number is insufficient.
6. `netWorth` + `liquidAssets` — SBIF landlord gate (≤$9M / ≤$500K).
7. `startupFlag`, `isNationalChainOrFranchise`, `otherLocations[]` — SBIF disqualifier/branch inputs.

**Structural gaps (a scalar field can't hold these):**
8. **Ownership** — replace free-text `ownershipNotes` with a repeatable owner sub-record: `{name, address, ownershipPct, role (owner/GP/LP/beneficiary/developer/occupant), isControllingEntity}`. Required to compute SBIF's ≥7.5% branch, EDS >7.5% disclosers, and NOF's ownership chart / Principal Profile. Keep `ownershipNotes` only as a supplemental free-text field.
9. **Owner demographics (voluntary)** — `{race/ethnicity, gender, LGBTQIA, veteran, familyOwned}` per owner, consent-flagged. Feeds SBIF's Additional-Information section and future MBE/WBE certification reuse. Absent today.
10. **Employee count granularity** — `employeeCount` is a single int; Cook County needs FT vs PT, current vs projected, plus projected construction jobs.
11. **Property record (new entity, keyed separately from the business):** `pin[]` (Permanent Real Estate Index Number), `township`, `ward`, `tifDistrictOrCorridor`, `eligibilityAreaDetermination` + `dateChecked`, `siteControlBasis` (own/lease/purchase) + `leaseEndDate`, `propertyTaxStanding` + `asOfDate`, and **per-property prior-incentive history** `[{program, amount, date}]` for SBIF cooldown/offset. None of this exists; a business ↔ property one-to-many relationship is needed because SBIF/NOF/County rules attach to the *property*, not the applicant.
12. **Compliance self-check state:** `cityDebtStatus`, `childSupportComplianceStatus`, `scofflawSelfCheck` (each + `asOfDate`). Front-loadable status checks that the packet needs to honestly surface eligibility risk.

**Typed-but-weak:**
13. `licenses: JsonValue` — untyped JSON blob is where license number/insurance/permits currently hide. Promote the recurring items (business license number+status, COI + renewal date) to typed fields with expiry metadata; keep JSON only for genuinely program-specific extras.

**What snapshot already handles well (no change needed):** legal name, DBA, entity type, formation date, both addresses, all three contact fields, NAICS. `fieldProvenance` is the right mechanism to extend — every new core field above should carry provenance + an `asOf`/expiry timestamp so the packet can render the Section-3 staleness rules and drive the two required timelines (base-packet completion vs. chosen-incentive application). The `licenses` JSON escape hatch stays for true program-specific overflow, but the twelve items above must become structured to make the "done once, reused everywhere" continuity-of-effort promise truthful.
