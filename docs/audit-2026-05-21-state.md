# Illinois State Incentive Programs — Audit
**Date:** 2026-05-21
**Scope:** All 6 entries in `public/data/programs.json` where `"level": "State"` (illinoisOZ, enterprise, edge, rev, micro, dataCenter), plus a scan for new IL state programs since late 2025.

---

## Summary

- **All 6 listed programs are still active**, but every one of them has an out-of-date or 404 `url` field. DCEO restructured its site in 2024–2025 (path `expandrelocate/incentives/edgetaxcredit.html` → `edge.html`; `aboutdceo/reportstopublications/rev-illinois-act.html` removed; `opportunityzones.html` → `oppzn.html`; Enterprise Zone moved under `taxassistance/`). Six of six `url`/`contacts[].url` entries need updating.
- **Material legal change to EDGE, REV, MICRO, and Data Center** via FY2026 budget bill HB2755 (Public Act 104-0006, signed June 16, 2025): expanded withholding-credit elections, mandatory 10-day public posting of EDGE agreement terms, and inclusion of new high-voltage DC converter stations.
- **Data Center incentive faces a 2-year suspension for *new* projects starting July 1, 2026** (Pritzker announcement, May 2026). Existing recipients are not affected, but this is a high-visibility flag for any user clicking through.
- **Illinois Opportunity Zones are entering a transition.** The current 327 IL OZ tracts remain valid through 2026; under the federal "OZ 2.0" permanence (July 2025), Illinois must nominate ~238 new zones in H2 2026, taking effect January 1, 2027. The `illinois-oz.geojson` snapshot (24 features) will go stale on Jan 1, 2027 — schedule a refresh.
- **All six Chicago Enterprise Zones expire in 2030** (redesignated in 2016 for 15 years). No EZ is at immediate risk, but the user-facing copy on programs.json says "Expires: 2030" already — that matches reality. Recertification application window opens 2028.
- **At least one entirely new program is missing from programs.json:** the **Advancing Innovative Manufacturing (AIM) tax credit** (effective Jan 1, 2026; 3–7% capital credit; $10M minimum investment; DCEO-administered). Also worth adding: **Quantum Enterprise Zone Program**, **High Impact Business**, **Illinois Innovation Voucher**, **Film Production Services Tax Credit** (extended to 2038), and the **Live Theater Production Tax Credit** (rules amended Dec 4, 2025 to add Broadway touring + nonprofit theater).

---

## Program-by-program findings

### 1. `illinoisOZ` — Illinois Opportunity Zones
- **Status:** Active. The state does not operate a separate tax credit, but DCEO offers complementary grants (Regional Site Readiness; $12M OZ capital grants round noted on DCEO press releases).
- **Accuracy issues:**
  - `url` and `contacts[0].url` → `https://dceo.illinois.gov/opportunityzones.html` returns **HTTP 404**. Canonical page is now `https://dceo.illinois.gov/oppzn.html`.
  - `summary` overstates the state-level benefit. Illinois does **not** offer a state OZ income-tax deduction that stacks with the federal. The IL benefit is mainly (a) federal conformity and (b) DCEO discretionary grants/scoring preferences for OZ projects (affordable housing, site readiness). Recommend rewording.
  - `contact` should add email: `opportunityzones@illinois.gov`.
- **Boundary:** `illinois-oz.geojson` has 24 features — that looks like a Chicago-area subset, not the full ~327 IL OZ tracts. Confirm whether this is intentional (Chicago focus) or a partial load. Either way, plan a refresh: all OZ tracts re-designate on **Jan 1, 2027** under OZ 2.0.
- **Suggested edits:**
  - `programs[illinoisOZ].url` → `https://dceo.illinois.gov/oppzn.html`
  - `programs[illinoisOZ].contacts[0].url` → same
  - `programs[illinoisOZ].contacts[0].email` → `opportunityzones@illinois.gov` (add field)
  - `programs[illinoisOZ].summary` → "Illinois supports federal Opportunity Zone investments through DCEO discretionary grants (Regional Site Readiness, OZ capital grants) and scoring preference for projects in designated zones. A new round of IL-nominated zones takes effect January 1, 2027."
  - `programs[illinoisOZ].benefits` → remove "State income tax deduction on OZ investment income" (incorrect); keep the affordable-housing point.
  - `programs[illinoisOZ].lastVerifiedAt` → `2026-05-21`.

### 2. `enterprise` — Enterprise Zones
- **Status:** Active. All six Chicago EZs (I–VI) redesignated 2016, **expire 2030**.
- **Accuracy issues:**
  - `url` and second `contacts[].url` → `https://dceo.illinois.gov/expandrelocate/incentives/enterprisezone.html` is **404**. Canonical is now `https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/enterprisezone.html`.
  - `benefits[0]` says "6.25% state sales tax exemption" — the geojson description block correctly says "Up to 9.25% (state + local)". programs.json is undercounting; building-materials exemption is **up to 9.25%** combined.
  - Phone (312) 744-4190 in `contacts[0]` is the general DCD line; the EZ administrator email `ezadministrator@cityofchicago.org` should be added (consistent with the geojson description text).
  - Missing the IL DCEO M&E contact: Christofer Albert, 217-524-0615, `Albert@illinois.gov` (per geojson description). Worth adding to `contacts[]` for utility/M&E exemptions.
  - Missing IL Dept of Revenue line for tax-credit reporting: 1-800-732-8866, `EZreporting@illinois.gov`.
- **Boundary:** `enterprise-zones.geojson` has 6 polygons (Chicago I–VI) with designated/expires metadata embedded — fresh.
- **Suggested edits:**
  - `programs[enterprise].url` → `https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/enterprisezone.html`
  - `programs[enterprise].contacts[1].url` → same
  - `programs[enterprise].benefits[0]` → "Up to 9.25% sales tax exemption on building materials (state + local)"
  - Add `contacts[0].email` → `ezadministrator@cityofchicago.org`
  - Append two new `contacts[]` entries (DCEO M&E and IDOR reporting; see geojson description text).
  - `programs[enterprise].lastVerifiedAt` → `2026-05-21`.
  - Add `expirationNote`: "All Chicago EZs (I–VI) expire 2030; recertification window opens 2028."

### 3. `edge` — EDGE Tax Credit
- **Status:** Active and recently amended (HB2755, P.A. 104-0006).
- **Accuracy issues:**
  - `url` → `https://dceo.illinois.gov/expandrelocate/incentives/edgetaxcredit.html` is **404**. Canonical is `https://dceo.illinois.gov/expandrelocate/incentives/edge.html`.
  - `benefits[0]` says "25–100% of state income tax withholdings." Current DCEO page describes the credit as **50% of withholdings for new hires, 25% for retained jobs, with an additional 25% boost in underserved areas** (total can reach 75% for new hires in underserved areas, not 100%). The "100% zones" framing in programs.json is unsupported by DCEO documentation; recommend rewording.
  - Missing the 2025 transparency requirement: DCEO must post each agreement's terms within 10 days. Worth a one-liner.
- **Boundary:** `edge-zones.geojson` (114 features) is shared with REV/MICRO/Data Center and labels itself a "stateIncentiveZones" proxy of high-unemployment tracts. EDGE itself is **not** a geographic program — there are no formal "EDGE zones". The "additional 25% underserved-area boost" is mapped to high-poverty/high-unemployment tracts, which this dataset approximates. Worth a `boundaryDisclaimer` noting that the polygon is an unemployment-rate proxy, not an official DCEO map.
- **Suggested edits:**
  - `programs[edge].url` → `https://dceo.illinois.gov/expandrelocate/incentives/edge.html`
  - `programs[edge].contacts[0].url` → same
  - `programs[edge].benefits[0]` → "50% of state withholding for new jobs, 25% for retained jobs, plus 25% boost in underserved areas"
  - `programs[edge].benefits[1]` → "Up to 75% credit on new-hire withholding in underserved areas" (replaces the misleading "100% credit in designated zones (like parts of SSA #50)")
  - `programs[edge].lastVerifiedAt` → `2026-05-21`.

### 4. `rev` — REV Illinois
- **Status:** Active. No 2026 substantive change to REV itself, but FY2026 budget added HVDC converter stations to related credit categories. Companion Electric Vehicle Rebate Act (EPA-administered, separate from REV) was amended (HB2380) — distinct program, not the REV tax credit.
- **Accuracy issues:**
  - `url` → `https://dceo.illinois.gov/aboutdceo/reportstopublications/rev-illinois-act.html` is **404**. There is no clean DCEO landing page; the best canonical state page is `https://ev.illinois.gov/incentives/rev-tax-credit.html`.
  - `benefits` are too vague. Should reference the actual investment thresholds: Large EV $1.5B + 500 jobs (5 yrs); EV component $300M + 150 jobs; Small EV $20M + 50 jobs (4 yrs); converted manufacturer $100M + 75 jobs.
  - "Bonus incentives in 100% designated zones" is misleading — REV is project-by-project, not zone-based.
- **Boundary:** `rev-zones.geojson` (114 features, identical to edge-zones/data-center-zones/micro-zones) is the high-unemployment proxy, not an official REV zone map. Add `boundaryDisclaimer`.
- **Suggested edits:**
  - `programs[rev].url` → `https://ev.illinois.gov/incentives/rev-tax-credit.html`
  - `programs[rev].contacts[0].url` → same
  - `programs[rev].benefits` → rewrite to include the four investment/job tiers above.
  - Drop "100% designated zones" language; replace with "Underserved-area projects qualify for enhanced credit value."
  - `programs[rev].lastVerifiedAt` → `2026-05-21`.

### 5. `micro` — MICRO Program
- **Status:** Active (live since Jan 1, 2023; 35 ILCS 45). No substantive 2026 change found.
- **Accuracy issues:**
  - `url` → `https://dceo.illinois.gov/` (generic root) and `contacts[0].url` same. Canonical is `https://dceo.illinois.gov/expandrelocate/incentives/micro.html`.
  - `whoQualifies` / `benefits` should reference thresholds: $2.5M minimum capital investment and the lesser of 50 jobs or 10% of worldwide baseline.
  - "100% credit in designated bonus zones" is misleading — same project-by-project framing as REV.
- **Boundary:** Same 114-feature shared proxy. Add disclaimer.
- **Suggested edits:**
  - `programs[micro].url` → `https://dceo.illinois.gov/expandrelocate/incentives/micro.html`
  - `programs[micro].contacts[0].url` → same
  - `programs[micro].whoQualifies` → "Semiconductor / microchip manufacturers, packagers, testers, or supply-chain firms investing ≥ $2.5M and creating the lesser of 50 jobs or 10% of worldwide baseline."
  - `programs[micro].lastVerifiedAt` → `2026-05-21`.

### 6. `dataCenter` — Data Center Tax Incentive
- **Status:** Active **but suspended for new applicants** starting July 1, 2026 (Pritzker announcement, May 2026). Existing certified data centers continue receiving exemptions. The Illinois Senate is pushing to end the exemption as early as January 2027 (8 years ahead of the statutory 2035 sunset); negotiations ongoing.
- **Accuracy issues:**
  - `url` → root `https://dceo.illinois.gov/`. Canonical is `https://dceo.illinois.gov/expandrelocate/incentives/datacenters.html`.
  - Missing the **20% construction-wage tax credit** for projects in underserved areas (a documented benefit).
  - Missing a critical caveat: the 2-year moratorium on new certifications.
- **Boundary:** `data-center-zones.geojson` is the same 114-tract shared proxy. No official "data center zone" exists.
- **Suggested edits:**
  - `programs[dataCenter].url` → `https://dceo.illinois.gov/expandrelocate/incentives/datacenters.html`
  - `programs[dataCenter].contacts[0].url` → same
  - Add `programs[dataCenter].suspensionNote` → "New project certifications suspended July 1, 2026 – June 30, 2028. Existing certifications unaffected."
  - Add to `benefits`: "20% credit on construction wages for projects in underserved areas."
  - `programs[dataCenter].lastVerifiedAt` → `2026-05-21`.

---

## New programs recommended

**Advancing Innovative Manufacturing (AIM) Tax Credit.** Effective for tax years beginning on/after January 1, 2026 (P.A. 104-0006). Provides 3% credit on $10M–$50M capital investments, 5% on $50M–$100M, and 7% on $100M+, against income tax over 5 years. Carries forward 10 years. Targets automotive, aerospace, life sciences, energy, food, advanced materials, robotics, semiconductors. DCEO-administered. Highly relevant for any Chicago manufacturer in the explorer's audience. Source: <https://www.keatax.com/illinois-rolls-out-new-manufacturing-tax-credit-and-expands-incentive-programs-in-2026-budget/>; statutory background <https://ryan.com/about-ryan/news-and-insights/2025/illinois-budget-credit-expansion/>.

**Quantum Enterprise Zone (QEZ) Program.** New DCEO program supporting tenants of designated quantum campuses (notably Illinois Quantum & Microelectronics Park on the former South Works site). Provides utility-tax exemptions, sales-tax exemptions, and income-tax credits for quantum-tech tenants. Geographically concentrated in Chicago — directly relevant to SECCC's footprint. Source: <https://dceo.illinois.gov/expandrelocate/incentives/quantum-enterprise-zone-program.html>.

**High Impact Business (HIB).** Long-standing DCEO program (analog to Enterprise Zones for projects outside EZ boundaries): minimum $12M investment + 500 new jobs, or $30M + 1,500 retained. Sales-tax exemption on building materials, utilities, and manufacturing M&E. Missing from programs.json entirely. Source: <https://dceo.illinois.gov/expandrelocate/incentives/highimpactbusinessprogram.html>.

**Illinois Innovation Voucher Program.** Rolling-application grants up to $75,000 (75% reimbursement) pairing IL small businesses with university researchers. Industries include AI, quantum, clean energy, advanced manufacturing, semiconductors, life sciences. Third round announced February 2026 (~$2.6M available). Source: <https://innovate-illinois.com/dceo-incentives/>.

**Film Production Services Tax Credit (extended).** P.A. 104-0453 extended the credit to December 31, 2038, raised the in-state labor / vendor spend credit to up to 35%, and expanded qualified non-resident positions. Worth adding as a State program for South Side production users. Source: <https://dceo.illinois.gov/whyillinois/film/filmtaxcredit.html>; <https://www.withum.com/resources/illinois-film-production-services-tax-credit-overview-and-sb-1911-updates/>.

**Live Theater Production Tax Credit (amended Dec 4, 2025).** 20% transferable credit on qualified IL expenditures; rules amended to add commercial Broadway touring shows and nonprofit theater categories with per-category caps. Relevant to Chicago's theater corridor. Source: <https://dceo.illinois.gov/whyillinois/film/live-theater-tax-credit.html>.

**Cannabis Social Equity Loan Program — Round III.** DCEO Office of Economic Equity opened Round III on Aug 11, 2025; $31.8M awarded to 95 businesses. Forgivable-loan structure for social-equity licensed craft growers, infusers, transporters, dispensaries. Highly relevant to SECCC's equity-focused users. Source: <https://dceo.illinois.gov/oe3/cannabisequity/cannabis-social-equity-r3.html>.

**Restore, Reinvest, Renew (R3) Program.** 25% of adult-use cannabis tax revenue funds grants for disinvested communities — civic legal aid, economic development, reentry, violence prevention, youth dev. Next deadline March 6, 2026. Source: <https://r3.illinois.gov/news/restore-reinvest-renew-r3-program-grants-apply-now/>.

---

## Quick-reference change table

| id | url change needed | benefit/copy fixes | New flags |
|---|---|---|---|
| illinoisOZ | → `dceo.illinois.gov/oppzn.html` | Remove "state OZ deduction"; clarify OZ 2.0 transition | Plan geojson refresh by Jan 1, 2027 |
| enterprise | → `.../taxassistance/enterprisezone.html` | Building-materials exemption "up to 9.25%" not 6.25% | All Chicago EZs expire 2030 |
| edge | → `.../incentives/edge.html` | "25–100%" → "50% new / 25% retained / +25% underserved" | Note 10-day public posting rule |
| rev | → `ev.illinois.gov/incentives/rev-tax-credit.html` | Add 4-tier investment/job thresholds | Boundary is a proxy, not official |
| micro | → `.../incentives/micro.html` | Add $2.5M / 50-job thresholds | Boundary is a proxy, not official |
| dataCenter | → `.../incentives/datacenters.html` | Add 20% construction wage credit | **Moratorium on new certs July 1, 2026** |

---

## Sources cited

All accessed 2026-05-21.

- DCEO EDGE program page — <https://dceo.illinois.gov/expandrelocate/incentives/edge.html>
- DCEO Enterprise Zone — <https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/enterprisezone.html>
- DCEO Opportunity Zones — <https://dceo.illinois.gov/oppzn.html>
- DCEO MICRO — <https://dceo.illinois.gov/expandrelocate/incentives/micro.html>
- DCEO Data Center incentives — <https://dceo.illinois.gov/expandrelocate/incentives/datacenters.html>
- DCEO High Impact Business — <https://dceo.illinois.gov/expandrelocate/incentives/highimpactbusinessprogram.html>
- DCEO Quantum Enterprise Zone — <https://dceo.illinois.gov/expandrelocate/incentives/quantum-enterprise-zone-program.html>
- Electrify Illinois REV Tax Credit — <https://ev.illinois.gov/incentives/rev-tax-credit.html>
- NRDC: Pritzker 2-year data center moratorium (May 2026) — <https://www.nrdc.org/press-releases/pritzker-announces-two-year-suspension-state-tax-incentives-new-data-center>
- IDOR Bulletin FY 2026-15 (EDGE / withholding changes, Dec 2025) — <https://tax.illinois.gov/content/dam/soi/en/web/tax/research/publications/bulletins/documents/2026/fy-2026-15.pdf>
- IDOR Bulletin FY 2026-16 (film withholding) — <https://tax.illinois.gov/research/news/fy-2026-16-wit-film-production-changes.html>
- Vorys: EDGE reinstatement/revisions — <https://www.vorys.com/publication-Illinois-Reinstates-and-Revises-the-EDGE-Tax-Credit>
- Ryan: IL FY2026 budget credit expansion — <https://ryan.com/about-ryan/news-and-insights/2025/illinois-budget-credit-expansion/>
- KE Andrews: AIM Tax Credit + 2026 budget — <https://www.keatax.com/illinois-rolls-out-new-manufacturing-tax-credit-and-expands-incentive-programs-in-2026-budget/>
- BDO: IL credits & incentives update — <https://www.bdo.com/insights/tax/illinois-updates-credits-incentives-programs>
- Withum: Film tax credit SB1911 updates — <https://www.withum.com/resources/illinois-film-production-services-tax-credit-overview-and-sb-1911-updates/>
- Capitol News Illinois: IBM at IQMP (Apr 29, 2026) — <https://capitolnewsillinois.com/news/ibm-will-bring-innovation-hub-750-new-jobs-to-chicagos-quantum-park/>
- Cannabis Social Equity Loan Round III — <https://dceo.illinois.gov/oe3/cannabisequity/cannabis-social-equity-r3.html>
- R3 Program — <https://r3.illinois.gov/news/restore-reinvest-renew-r3-program-grants-apply-now/>
- IL Senate GOP: $2.4M Innovation Voucher awards (Feb 2026) — <https://ilsenategop.org/2026/02/09/2-4-million-awarded-through-illinois-innovation-voucher-program-additional-funding-available/>
- Chicago Contrarian / City of Chicago: EZ I–VI expire 2030 — <https://www.chicagocontrarian.com/blog/urban-renewal-chicago-enterprise-zones>
- IHDA 2026 LIHTC QAP — <https://www.ihda.org/wp-content/uploads/2025/07/2026-Qualified-Allocation-Plan_7.1.2025.pdf>
