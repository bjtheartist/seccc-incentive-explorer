# Audit 2026-05-21 — Consolidated Findings & Implementation Plan

Cross-reference: per-level reports under same date stamp (`audit-2026-05-21-federal.md`, `-state.md`, `-county.md`, `-city.md`).

---

## Part 1 — Audit at a glance

### 1A. Programs to FIX (existing entries with material errors)

| Program | Level | Severity | Fix |
|---|---|---|---|
| `federalOZ` | Federal | High | Replace "defer until 2026 / 10% step-up" benefits with permanent-OZ language per OBBBA (Jul 2025). Existing 181-tract boundary valid through 12/31/2028; flag OZ 2.0 effective 1/1/2027. |
| `nmtcEligible` | Federal | Med | Note permanence (OBBBA). Verify CDFI Fund phone — published number is (202) 653-0421. |
| `qct` | Federal | Med | Re-pull HUD 2026 QCT designations (effective 1/1/2026). Add vintage metadata to geojson. |
| `highUnemployment` (WOTC ref) | Federal | High | Disclaimer: **WOTC expired 12/31/2025**, awaiting reauthorization. |
| `illinoisOZ` | State | High | Remove fake "state income tax deduction" claim — IL only offers grants/scoring preferences. |
| `enterprise` | State | High | 6.25% → **up to 9.25%** (state + local) sales-tax exemption on building materials. |
| `edge` | State | High | Replace "25–100%" with actual 50% new-hire / 25% retained / +25% underserved boost. |
| `dataCenter` | State | High | Add flag: **2-year moratorium on new certifications effective 7/1/2026** (Pritzker). |
| All 6 State programs | State | High | **All `url` fields return 404** — DCEO restructured site. Need replacement URLs (mapping in state report). |
| All City programs | City | Med | **DCD → DPD** rename (Department of Planning and Development). URL slug retains "dcd." |
| `tif` | City | Med | geojson missing ~24 districts (current count 124 vs 100 in file). Drop 9 expired 12/31/2025. |
| `nof` | City | High | Caps are $250K @ 75% + $50K TA bonus. "$1.5M catalytic" tier no longer exists. |
| `sbif` | City | High | Real caps: $75K multi-tenant / $150K commercial / **$250K industrial** at up to 90% reimbursement. |
| `microMarketRecovery` | City | High | Moved to Dept. of Housing; now homeownership-focused. Either remove or major rewrite. |
| `landmarkDistricts` | City | Low | geojson 59 vs current 62 (2025 Landmarks Ordinance). |
| `landBank` (CCLBA) | County | Med | Refresh — Reclaiming Chicago Initiative launched Aug 2025; drop retired PubliCity portal copy. |
| REV/EDGE/MICRO/Data Center geojson | State | Med | All four currently share one 114-tract high-unemployment proxy. Add `boundaryDisclaimer` until DCEO publishes official maps. |

### 1B. Programs to ADD (28 new entries proposed across all levels)

**Federal (9):** IRA §48E/§45Y clean-energy PTC/ITC + low-income bonus, IRS Elective Pay / Transferability, §179D (urgent — sunsets 6/30/2026), HUD Section 108, CDFI Bond Guarantee, SBA 7(a)/504 ($10M cap as of 7/4/2026), CHIPS §48D, SSBCI / Advantage Illinois, EDA Build to Scale.

**State (8):** AIM Tax Credit (new, effective 1/1/2026, 3–7% on $10M+ manufacturing), Quantum Enterprise Zone, High Impact Business, Illinois Innovation Voucher, Film Production Credit (extended to 2038), Live Theater Credit (amended 12/4/2025), Cannabis Social Equity R3, R3 Program grants.

**County (11):** `class6b`, `class6bSer`, `class7b`, `class7c`, `class8`, `classC` (brownfield), `classL` (landmark — intersects with city landmark layer), `ahsap` (replaces Class 9), `cookCannabisGrant`, `investInCook`, `cookBrownfield`. **County audit drafted these as drop-in `programs.json` entries** (`docs/audit-2026-05-21-county.md`).

**City + Utility (5):** Community Development Grant (small/medium/large variants), Workforce Solutions Program (new 2026), Climate Infrastructure Fund / ETOD, ComEd EV Charger Rebate (introduces a new `Utility` level).

### 1C. Programs to REMOVE / sunset

- Bring Chicago Home (referendum failed Mar 2024)
- Microbusiness Recovery (closed)
- Same Day Pay (not active)
- Together Now / Cultivate (closed)
- Retail Thrive Zones (no current cycle)
- INVEST South/West (folded into CDG pipeline)
- Brownfields §198 (Federal) — still expired, do not add
- USDA RBDG — Chicago ineligible, do not add

### 1D. Boundary / geojson refresh work

| Layer | Current state | Action |
|---|---|---|
| `qct.geojson` | 418 features, no vintage | Pull HUD 2026 (effective 1/1/2026) |
| `tif-districts.geojson` | 100 features | Pull current 124, remove 9 that expired 12/31/2025 |
| `landmark-districts.geojson` | 59 features | Pull current 62 |
| `micro-market-recovery.geojson` | 13 features | Refresh to 19 (or remove layer if program scope retires) |
| `illinois-oz.geojson` | 327 features | Watch for IL nominations H2 2026 → effective 1/1/2027 |
| `rev-zones / edge-zones / data-center-zones / micro-zones` | All point to same 114-tract proxy | Add disclaimer; replace with official maps when DCEO publishes |
| New: `class8-townships.geojson` | n/a | Build from Cook Central / `ChicagoCityscape/pins` for the 5 SCC townships |
| New: `federal-oz-2.0.geojson` | n/a | Stand up shell now; populate when Treasury releases 2027 designations |

### 1E. Time-bombs to track (calendared)

- **2026-06-30** — Federal §179D sunsets (urgency banner if added)
- **2026-07-01** — IL Data Center 2-year moratorium begins
- **2026-12-31** — Federal OZ 1.0 holding period winds down to permanence-pivot
- **2027-01-01** — Federal OZ 2.0 + new IL OZ tracts effective; `illinois-oz.geojson` rotates
- **2028** — IL Enterprise Zone (all 6 Chicago zones) recertification window opens
- **2028-12-31** — Federal OZ 1.0 expires
- **2030** — IL Enterprise Zones expire

---

## Part 2 — Implementation Plan (3 features)

### Feature A — Submittable application portals

**Why:** City audit found 13 programs route through `cocdpd.submittable.com`. NOF, SBIF, CCSA, CDG, Workforce Solutions, Property Tax Incentives, and a Universal Financial Incentives form for projects >$250K all live there. We need a first-class field for it.

**Schema change (`public/data/programs.json` + `lib/types.ts`):**
```ts
applicationPortals?: Array<{
  type: 'submittable' | 'web' | 'pdf' | 'email' | 'in_person';
  label: string;                  // "Apply via Submittable", "Download PDF application"
  url: string;
  language?: 'en' | 'es';         // NOF has en + es Submittable forms
  notes?: string;                 // e.g., "Universal form for projects > $250K"
}>;
```
Backwards compatible — old single-`url` field stays for the program's marketing page.

**Surfaces:**
1. `/programs` cards — pill button "Apply via Submittable" (only if `applicationPortals[].type === 'submittable'`).
2. `/programs/[id]` detail (or program drawer) — full list of portals with language toggles.
3. `/report` PDF — under each matched program, "How to apply" appendix includes portal link.
4. `/qualify` match list — primary CTA on each program card flips from "Learn more" to "Apply" when a portal exists.

**Components touched:**
- `lib/types.ts` — add `ApplicationPortal` type
- `lib/programs-data.ts` — pass-through
- `components/programs/ProgramCard.tsx` — portal pill
- `lib/pdf-report.ts` — append portal in "How to apply" section
- `lib/schemas.ts` — Zod validation

**Effort:** Small. ~½ day including data backfill from the 13-row inventory in the City audit.

---

### Feature B — Federal / State / County / City demarcation on /map

**Why:** Today the legend lists 20 zone layers in a flat list, sorted only by display order. Users can't see at a glance "which of these is City vs State." Programs are tagged by `level` but zone layers are not.

**Schema change (`lib/constants.ts`):**
Each `ZONE_LAYER` entry gains:
```ts
{
  key: 'tif',
  label: 'TIF Districts',
  color: '#...',
  level: 'City',                       // NEW
  jurisdictions?: ('Federal'|'State'|'County'|'City'|'Utility')[]; // optional for shared layers like federal-oz used by both federal + IL OZ programs
  level_disclaimer?: string;           // for the 4 IL proxy layers
}
```

**UI changes (`components/map/MapView.tsx` + sidebar):**
1. **Legend grouped by gov level** with four collapsible sections (Federal / State / County / City) and a Utility section if/when ComEd lands. A small color-coded chip on each row repeats the level.
2. **Quick filter buttons** above the legend: `All · Federal · State · County · City` — toggles all layers at that level on/off.
3. **Layer chip color border** — each layer chip on the map already shows its zone color; we add a 2px left border in the gov-level accent color (e.g., federal navy, state IL-blue, county green, city Warm-Bureau accent).
4. **Map popups (point-in-zone clicks)** — when a zone is clicked, the popup header shows the level badge above the zone name.

**Default state:** All gov levels on. Persists in URL (`lib/url-state.ts`) so shared map links keep filter state.

**Effort:** Medium. ~1 day. Most of the lift is taxonomy in `constants.ts` + sidebar UX.

---

### Feature C — Downloadable one-pager cheat sheet

**Why:** Many users (esp. SECCC member businesses) want a take-home reference of "what zones cover me and what programs exist" without the full report flow.

**Two variants:**
1. **Generic cheat sheet (`/cheat-sheet` route, also linked from `/programs` header + map sidebar):**
   - One-page PDF (or 2-page if needed), portrait letter.
   - Top: title, date generated, project URL.
   - Section 1: zone map thumbnail (city-wide overview, gov-level color-coded).
   - Section 2: program matrix — 4 columns (Federal / State / County / City), rows = up to ~6 programs per column with name, benefit range (1-line), fastest-confirming-step.
   - Footer: legend, qrcode → chicagoincentiveexplorer.com, version stamp.
2. **Address-specific cheat sheet (button on `/report`):**
   - Same layout but program list is the address-matched subset.
   - Already 80% in reach via existing `lib/pdf-report.ts` engine — we extract a "compact" mode.

**Implementation:**
- New `lib/cheat-sheet.ts` — exports `renderCheatSheet({ matchedPrograms? })` using jsPDF.
- New `app/cheat-sheet/page.tsx` — server component renders a preview and a "Download PDF" button.
- New `app/api/cheat-sheet/route.ts` — POST that streams PDF; can take optional `?lat=&lon=` for address-specific.
- `public/data/programs.json` already has `benefitRange` and `fastestConfirmingStep` populated — perfect for the matrix.
- Zone overview thumbnail: render once via Mapbox static-tiles API and cache to `public/images/cheat-sheet-overview.png`, regenerate on data refresh.

**Effort:** Medium. ~1–1.5 days. Most novel piece is the layout in jsPDF; existing `pdf-report.ts` has reusable primitives (tables, headers, snapshot embedding).

---

---

## Part 2.5 — Product boundary (locked 2026-05-21)

The Explorer is a **discovery + navigation tool**, not a compliance product. All certification/filing/reporting pathways below surface as **"Official next step"** or **"Verification step"** links, never as workflows we own.

We do: identify zones, explain incentives, name administering agencies, link to official sources + application portals, flag "verify before spending money," prepare users to talk to advisors/chambers/lenders/DCEO/DPD/SomerCor/Cook County.

We don't: determine final eligibility, certify businesses, track compliance deadlines, interpret tax rules, submit applications, maintain a compliance calendar, tell users what they are legally required to file.

Default copy pattern:
> Some incentives may require certification, pre-approval, or reporting through the administering agency. Use the official links below to verify current requirements before applying, purchasing materials, or beginning work.

### Schema additions to support this framing

On top of `applicationPortals[]` (Feature A), each program also gets:

```ts
verificationSteps?: Array<{
  label: string;           // "DCEO project certification", "IDOR BMEC", "IDOR Business Incentives Reporting"
  agency: string;          // "DCEO", "IDOR", "Cook County Assessor"
  url: string;
  kind: 'certification' | 'reporting' | 'filing' | 'preapproval';
  appliesBefore?: 'application' | 'purchase' | 'construction' | 'annual';
  note?: string;
}>;
status: 'active' | 'verify' | 'sunset' | 'pending';   // WOTC → 'verify'
sourceUrl: string;         // canonical official page, separate from marketing url
lastVerifiedAt: string;    // already partially used; standardize
```

### "Unlock pathways" inventory to add as `verificationSteps[]`

| Pathway | Surfaces on which programs | Source |
|---|---|---|
| **BMEC (Building Materials Exemption Certificate)** | Enterprise Zone, REV, MICRO, HIB, AIM, Quantum, RERZ | tax.illinois.gov/businesses/incentives.html |
| **IDOR Business Incentives Reporting** (annual) | Enterprise Zone, RERZ, HIB, REV, MICRO, Quantum, AIM | tax.illinois.gov/businesses/incentives.html |
| **Utility tax exemptions** (telecom/gas/electric) | Enterprise Zone, HIB | IDOR |
| **EDGE Employee Project Location Certification + reporting** | EDGE | DCEO EDGE page |
| **QNBV Certification (precondition for Angel Investment Tax Credit)** | (new) Angel Investment Tax Credit | dceo.illinois.gov |
| **DPD Submittable portal** | NOF, SBIF, CCSA, CDG, Workforce Solutions, Property Tax Incentives, Universal Financial Incentives | cocdpd.submittable.com |
| **Cook County Assessor Incentive Filing** | Class 6b, 6b SER, 7a, 7b, 7c, 8, 8a MICRO, C, L | cookcountyassessor.com |
| **Municipal support/consent (City Council resolution)** | All Cook County Class incentives | Cook County |
| **DCEO NOFO portal** (rolling opportunities, separate from stable programs) | New "Current opportunities" section | dceo.illinois.gov/businesshelp/incentivesandtaxcredits.html |

### BMEC as its own State entry

Add `bmec` program at `level: "State"` covering sales tax exemption on building materials for Enterprise Zone, RERZ, HIB, REV, MICRO, Quantum, and AIM projects. Cross-link from each of those program entries via `verificationSteps[]`.

### Class 8a MICRO

Cook County audit's `class8` entry covers township-eligibility Class 8. **8a MICRO** is the semiconductor/microchip variant and is currently under-covered. Add as its own `class8aMicro` entry alongside the County drop-in entries.

---

## Part 2.6 — Boundary provenance

Create `docs/boundary-sources.md` (or `public/data/zones/manifest.json`) with one row per active layer:

| Field | Example |
|---|---|
| `key` | `tif` |
| `source_agency` | City of Chicago, Department of Planning and Development |
| `source_url` | https://data.cityofchicago.org/.../tif-districts |
| `fetched_on` | 2026-05-21 |
| `transformed_file` | `public/data/zones/tif-districts.geojson` |
| `scope` | citywide |
| `vintage` | 2025-Q4 |
| `caveats` | clipped to city boundary; expired-2025 districts removed |

This addresses the audit finding that REV/EDGE/MICRO/Data Center share a high-unemployment proxy with no disclaimer.

---

## Part 3 — Sequencing recommendation

Per refined scope (2026-05-21), three phases:

**Phase 1 — Data hygiene patch (data-only, no UI risk)**
- Fix 17 existing programs per audit (URLs, naming DCD→DPD, benefit copy, WOTC → `status: 'verify'`, OZ language).
- Remove 6 sunset programs.
- Add 28 new programs: 9 Federal, 8 State (incl. BMEC), 12 County (incl. `class8aMicro`), 5 City/Utility.
- Introduce schema fields: `applicationPortals[]`, `verificationSteps[]`, `status`, `sourceUrl`, `lastVerifiedAt` standardized.
- Backfill `applicationPortals[]` from City audit's 13-row Submittable inventory.
- Backfill `verificationSteps[]` for the 9 unlock-pathway entries (BMEC, IDOR reporting, utility exemptions, EDGE certification, QNBV, DPD Submittable, Assessor filing, municipal consent, DCEO NOFO).
- Add "OZ 2027 watch" note + SBIF 2026 monthly rollout windows + NOF active + Catalyst/Forging Growth closed flags.
- Touch only: `public/data/programs.json`, `lib/types.ts`, `lib/schemas.ts`, `lib/programs-data.ts`.

**Phase 2 — Explorer UX patch**
- Federal/State/County/City badges on program cards (programs list, report cards, map snapshot top program cards).
- Quick filter chips by government level on `/programs` and `/map` legend.
- "Apply / Start Application" button where `applicationPortals[]` present.
- "Official Source" and "Last verified" links on every program.
- "Verification step" callout block where `verificationSteps[]` present, framed as next-step navigation (not compliance).
- Boundary provenance via `docs/boundary-sources.md` or `public/data/zones/manifest.json`.
- Boundary refreshes (QCT 2026, TIF 124, Landmark 62, MMRP 19, disclaimers on REV/EDGE/MICRO/Data Center proxy layers).

**Phase 3 — Downloadable one-pager cheat sheet**
- Branded "Chicago Incentive Explorer Cheat Sheet."
- Sections: Zones vs Programs, Federal / State / County / City, common project types, what to verify first, QR/link to Explorer.
- Downloadable as HTML/PDF from `/cheat-sheet` route + button on `/programs` and `/map`.
- Reuses Phase 1 schema (levels, portals, verification steps) + Phase 2 boundary provenance.

Phase 1 unblocks everything. Phase 2 + 3 build on cleaner data.
