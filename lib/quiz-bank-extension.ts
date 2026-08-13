import type { QuizQuestion } from "./quiz-data";

export const QUIZ_QUESTIONS_EXTENSION: QuizQuestion[] = [
  // ---------- FEDERAL (18) — ids 11-28 ----------
  {
    id: 11,
    topic: "Federal",
    question: "Which 2025 federal law made the New Markets Tax Credit (NMTC) permanent?",
    choices: [
      "The Inflation Reduction Act",
      "The CHIPS and Science Act",
      "The One Big Beautiful Bill Act (OBBBA)",
      "The American Rescue Plan",
    ],
    correctIndex: 2,
    explanation:
      "OBBBA (Pub. L. 119-21, July 2025) made NMTC permanent. Treasury then announced a combined CY 2024-25 award of $10B to 142 CDEs on 12/23/2025, with a CY 2026 round of about $5B under the new framework.",
  },
  {
    id: 12,
    topic: "Federal",
    question: "What percentage credit do investors in a Community Development Entity claim under the NMTC over 7 years?",
    choices: ["20%", "30%", "39%", "45%"],
    correctIndex: 2,
    explanation:
      "NMTC investors receive a 39% federal tax credit on their Qualified Equity Investment, claimed over a 7-year compliance period (5% in each of the first three years, 6% in each of the next four).",
  },
  {
    id: 13,
    topic: "Federal",
    question: "Effective 7/4/2026, what is the new combined SBA 7(a) + 504 borrowing cap per borrower?",
    choices: ["$5 million", "$7.5 million", "$10 million", "$25 million"],
    correctIndex: 2,
    explanation:
      "SBA doubled the cumulative 7(a) + 504 borrowing limit from $5M to $10M effective 7/4/2026. The Community Advantage SBLC program (up to $350K for underserved markets) remains active alongside.",
  },
  {
    id: 14,
    topic: "Federal",
    question: "Under the IRA §48E low-income communities bonus, what is the maximum bonus credit a qualified low-income economic benefit project can stack on top of the 30% base ITC?",
    choices: ["+5%", "+10%", "+20%", "+30%"],
    correctIndex: 2,
    explanation:
      "The §48E(h) bonus adds up to +10% for projects in low-income communities or on Indian land, or up to +20% for qualified low-income economic benefit projects. Energy-community status (brownfields, fossil-fuel MSAs) can add another +10%.",
  },
  {
    id: 15,
    topic: "Federal",
    question: "What date does the IRC §179D Energy Efficient Commercial Buildings Deduction sunset under OBBBA?",
    choices: [
      "December 31, 2025",
      "June 30, 2026",
      "December 31, 2027",
      "It was made permanent",
    ],
    correctIndex: 1,
    explanation:
      "OBBBA terminated §179D for construction beginning after 6/30/2026. The deduction goes up to $5.94/sf for qualifying HVAC, lighting, and envelope improvements — designers on tax-exempt-owned buildings can also claim it.",
  },
  {
    id: 16,
    topic: "Federal",
    question: "Which federal agency administers the New Markets Tax Credit program?",
    choices: [
      "U.S. Department of Housing and Urban Development (HUD)",
      "Small Business Administration (SBA)",
      "Treasury's CDFI Fund",
      "Economic Development Administration (EDA)",
    ],
    correctIndex: 2,
    explanation:
      "The CDFI Fund (within Treasury) certifies Community Development Entities and allocates NMTC authority. The Fund's Help Desk is (202) 653-0421; allocations re-baseline against the latest ACS poverty/income data.",
  },
  {
    id: 17,
    topic: "Federal",
    question: "When do the 2026 HUD Qualified Census Tract (QCT) designations take effect?",
    choices: [
      "October 1, 2025",
      "January 1, 2026",
      "April 1, 2026",
      "January 1, 2027",
    ],
    correctIndex: 1,
    explanation:
      "HUD published 2026 QCT/DDA designations in the Federal Register on 9/30/2025, effective 1/1/2026, using 2020 decennial census tract boundaries. QCTs trigger a 130% basis boost for Low-Income Housing Tax Credit deals.",
  },
  {
    id: 18,
    topic: "Federal",
    question: "Under OBBBA, what is the new OZ 2.0 basis step-up at 5 years for rural Qualified Opportunity Funds?",
    choices: ["5%", "10%", "20%", "30%"],
    correctIndex: 3,
    explanation:
      "OZ 2.0 offers a 10% basis step-up after 5 years for standard QOFs, and an enhanced 30% step-up for rural QOFs. The 10-year zero capital gains exclusion remains, but is now capped at 30 years post-investment.",
  },
  {
    id: 19,
    topic: "Federal",
    question: "What does the IRS 'elective pay' mechanism allow nonprofits, churches, and local governments to do?",
    choices: [
      "Defer property tax payments for 5 years",
      "Receive clean-energy tax credits as a direct cash refund",
      "Elect to skip Form 990 filing",
      "Pay federal income tax in installments",
    ],
    correctIndex: 1,
    explanation:
      "Elective pay (direct pay) lets tax-exempt entities monetize §48E, §30C, and other clean-energy credits as a cash refund. For-profit owners without tax appetite can instead sell credits via transferability. Pre-file registration through IRS Energy Credits Online (ECO) is mandatory.",
  },
  {
    id: 20,
    topic: "Federal",
    question: "What percentage is the federal Historic Tax Credit under IRC §47, and over how many years is it claimed?",
    choices: [
      "10% claimed in one year",
      "20% claimed over 5 years (4% per year)",
      "25% claimed over 7 years",
      "30% claimed over 10 years",
    ],
    correctIndex: 1,
    explanation:
      "The federal HTC equals 20% of qualified rehabilitation expenditures on a certified historic structure, claimed ratably over 5 years (4% per year) — a 2017 TCJA change from the prior single-year claim. The 10% non-historic credit was repealed at the same time.",
  },
  {
    id: 21,
    topic: "Federal",
    question: "What is the FY 2026 HUD Section 108 loan-guarantee credit-subsidy fee?",
    choices: ["0.28%", "0.58%", "0.82%", "1.25%"],
    correctIndex: 1,
    explanation:
      "HUD's FY 2026 Section 108 fee is 0.58%, down from 0.82% in FY 2025 — making this cycle cheaper. Section 108 lets CDBG entitlement cities like Chicago issue federally-guaranteed loans for economic development, public facilities, and housing.",
  },
  {
    id: 22,
    topic: "Federal",
    question: "What is the credit rate of the CHIPS Investment Tax Credit (§48D)?",
    choices: ["20%", "25%", "30%", "35%"],
    correctIndex: 3,
    explanation:
      "§48D provides a 35% credit for qualifying semiconductor manufacturing facilities or specialized equipment placed in service after 2025, with direct-pay eligibility.",
  },
  {
    id: 23,
    topic: "Federal",
    question: "Which federal program is funded by Treasury but administered by Illinois DCEO?",
    choices: [
      "New Markets Tax Credit",
      "State Small Business Credit Initiative (SSBCI)",
      "EDA Build to Scale",
      "HUD Section 108",
    ],
    correctIndex: 1,
    explanation:
      "SSBCI is a federal Treasury program — Illinois received a $354.6M allocation, deployed through DCEO as Advantage Illinois (loan participation/guarantee), the INVENT Venture Capital Program, and Climate Bank Finance LPP.",
  },
  {
    id: 24,
    topic: "Federal",
    question: "Federal Opportunity Zone tracts designated under the original 2017 law (OZ 1.0) remain valid investment targets through which date?",
    choices: [
      "December 31, 2026",
      "December 31, 2027",
      "December 31, 2028",
      "December 31, 2030",
    ],
    correctIndex: 2,
    explanation:
      "OZ 1.0 designations remain valid through 12/31/2028. OZ 2.0 tracts (newly nominated by states in late 2026) take effect 1/1/2027 on a 10-year redesignation cycle under OBBBA Sec. 70421.",
  },
  {
    id: 25,
    topic: "Federal",
    question: "What is the typical maximum term of bonds issued under the CDFI Fund Bond Guarantee Program?",
    choices: ["10 years", "20 years", "30 years", "40 years"],
    correctIndex: 2,
    explanation:
      "CDFI Bond Guarantee bonds carry 30-year maturities and are issued by Qualified Issuer CDFIs for aggregate financings of $100M+. In Chicago, locally-deployed capital flows through CDFIs like CCLF, IFF, and LISC.",
  },
  {
    id: 26,
    topic: "Federal",
    question: "What was the maximum federal WOTC credit per qualified hire before the program lapsed at the end of 2025?",
    choices: ["$2,400", "$4,800", "$9,600", "$24,000"],
    correctIndex: 2,
    explanation:
      "WOTC capped at $9,600 for the highest-tier qualifying group (disabled veterans). The credit lapsed 12/31/2025; employers should keep filing Form 8850 pre-screenings to preserve retroactive eligibility if Congress reauthorizes.",
  },
  {
    id: 27,
    topic: "Federal",
    question: "What is the size range of EDA Build to Scale grants?",
    choices: [
      "$25K to $250K",
      "$500K to $5M",
      "$5M to $25M",
      "$25M to $100M",
    ],
    correctIndex: 1,
    explanation:
      "EDA Build to Scale awards $500K to $5M to nonprofits, EDOs, and universities for regional tech-ecosystem capacity. The most recent competition (FY 2024) closed October 28, 2024; EDA's program page announces no upcoming NOFO and no expected date.",
  },
  {
    id: 28,
    topic: "Federal",
    question: "Which 2017 law also repealed the federal 10% non-historic rehabilitation tax credit?",
    choices: [
      "The American Recovery and Reinvestment Act",
      "The Tax Cuts and Jobs Act (TCJA)",
      "The Bipartisan Budget Act",
      "The CARES Act",
    ],
    correctIndex: 1,
    explanation:
      "TCJA (2017) preserved the 20% Historic Tax Credit but repealed the 10% non-historic rehab credit and required the 20% credit to be claimed ratably over 5 years rather than in the year placed in service.",
  },

  // ---------- STATE (18) — ids 29-46 ----------
  {
    id: 29,
    topic: "State",
    question: "Under the new Illinois Advancing Innovative Manufacturing (AIM) tax credit, what credit rate applies to capital investments above $100 million?",
    choices: ["3%", "5%", "7%", "10%"],
    correctIndex: 2,
    explanation:
      "AIM tiers the credit: 3% on $10M-$50M, 5% on $50M-$100M, and 7% on $100M+ investments, claimed over 5 years with a 10-year carryforward. Effective for tax years beginning on/after 1/1/2026; targets manufacturing, aerospace, life sciences, robotics, and semiconductors.",
  },
  {
    id: 30,
    topic: "State",
    question: "How many Chicago Enterprise Zones are currently designated, and when do they all expire?",
    choices: [
      "3 zones, expiring 2028",
      "6 zones, expiring 2030",
      "8 zones, expiring 2035",
      "12 zones, expiring 2040",
    ],
    correctIndex: 1,
    explanation:
      "Chicago has 6 Enterprise Zones (I-VI), redesignated in 2016 for 15-year terms, all expiring in 2030. The recertification window for the next cycle opens in 2028.",
  },
  {
    id: 31,
    topic: "State",
    question: "Under the amended EDGE program, what credit rate applies to retained jobs (not new hires)?",
    choices: [
      "10% of state withholding",
      "25% of state withholding",
      "50% of state withholding",
      "75% of state withholding",
    ],
    correctIndex: 1,
    explanation:
      "EDGE is structured as 50% of state withholding for new jobs and 25% for retained jobs, with a +25% boost for underserved areas — so new hires in underserved areas can reach 75%. The 2025 amendment (P.A. 104-0006) also requires DCEO to post agreement terms within 10 days.",
  },
  {
    id: 32,
    topic: "State",
    question: "What is the minimum investment threshold for the 'Large EV manufacturer' tier of the REV Illinois credit?",
    choices: [
      "$20M and 50 jobs",
      "$100M and 75 jobs",
      "$300M and 150 jobs",
      "$1.5B and 500 jobs",
    ],
    correctIndex: 3,
    explanation:
      "REV's Large EV tier requires $1.5B in capital and 500 jobs over 5 years. The other tiers: EV component manufacturer ($300M + 150 jobs), Small EV ($20M + 50 jobs over 4 years), converted manufacturer ($100M + 75 jobs).",
  },
  {
    id: 33,
    topic: "State",
    question: "When does Illinois' Data Center Tax Incentive moratorium on new certifications begin?",
    choices: [
      "January 1, 2026",
      "July 1, 2026",
      "January 1, 2027",
      "July 1, 2028",
    ],
    correctIndex: 1,
    explanation:
      "Governor Pritzker announced a 2-year suspension of new data center certifications beginning 7/1/2026 (through 6/30/2028). Existing certified data centers continue receiving exemptions; the statutory program otherwise runs to 2035.",
  },
  {
    id: 34,
    topic: "State",
    question: "What is the minimum capital investment threshold for the Illinois MICRO program?",
    choices: ["$500K", "$2.5M", "$10M", "$50M"],
    correctIndex: 1,
    explanation:
      "MICRO requires a minimum of $2.5M in capital investment AND the lesser of 50 new jobs or 10% of worldwide baseline employment. It's the semiconductor/microchip analog to REV and is codified at 35 ILCS 45.",
  },
  {
    id: 35,
    topic: "State",
    question: "What is the maximum grant under the Illinois Innovation Voucher Program?",
    choices: [
      "$25,000 at 50% reimbursement",
      "$75,000 at 75% reimbursement",
      "$150,000 at 50% reimbursement",
      "$250,000 at 90% reimbursement",
    ],
    correctIndex: 1,
    explanation:
      "Innovation Vouchers award up to $75K at 75% reimbursement, pairing Illinois small businesses with university researchers in AI, quantum, clean energy, advanced manufacturing, semiconductors, and life sciences. Round 3 in Feb 2026 had ~$2.6M available.",
  },
  {
    id: 36,
    topic: "State",
    question: "Through what year is the Illinois Film Production Services Tax Credit now authorized, following P.A. 104-0453?",
    choices: ["2028", "2032", "2038", "Made permanent"],
    correctIndex: 2,
    explanation:
      "The Film Credit was extended to 12/31/2038, with the in-state labor/vendor spend credit raised to up to 35% and expanded qualified non-resident positions. Companion Live Theater credit (20%, transferable) was amended in Dec 2025 to add Broadway touring and nonprofit categories.",
  },
  {
    id: 37,
    topic: "State",
    question: "Where is Illinois' new Quantum Enterprise Zone primarily anchored?",
    choices: [
      "Argonne National Laboratory campus",
      "The former U.S. Steel South Works site",
      "Northwestern University Evanston campus",
      "Fermilab in Batavia",
    ],
    correctIndex: 1,
    explanation:
      "The Illinois Quantum & Microelectronics Park (IQMP) sits on the former South Works site on Chicago's Southeast Side. Tenants of designated quantum campuses get utility-tax exemptions, sales-tax exemptions, and income-tax credits. IBM announced a 750-job innovation hub at IQMP in April 2026.",
  },
  {
    id: 38,
    topic: "State",
    question: "What are the two job/investment paths to qualify as an Illinois High Impact Business (HIB)?",
    choices: [
      "$5M + 100 jobs, OR $15M + 500 retained",
      "$12M + 500 new jobs, OR $30M + 1,500 retained",
      "$25M + 250 jobs, OR $50M + 1,000 retained",
      "$50M + 100 jobs, OR $100M + 500 retained",
    ],
    correctIndex: 1,
    explanation:
      "HIB requires either $12M + 500 new jobs or $30M + 1,500 retained jobs. It functions as Illinois' Enterprise Zone analog for projects outside designated EZ boundaries: sales-tax exemption on building materials, utilities, and manufacturing M&E.",
  },
  {
    id: 39,
    topic: "State",
    question: "Which Illinois agency issues a Building Materials Exemption Certificate (BMEC)?",
    choices: [
      "Illinois Department of Commerce and Economic Opportunity (DCEO)",
      "Illinois Department of Revenue (IDOR)",
      "Illinois Environmental Protection Agency (IEPA)",
      "Illinois Housing Development Authority (IHDA)",
    ],
    correctIndex: 1,
    explanation:
      "IDOR issues the BMEC, but a project must first be certified by DCEO or a zone administrator under Enterprise Zone, REV, MICRO, HIB, AIM, or Quantum EZ before applying. The exemption can reach 9.25% (state + local) on qualifying building materials.",
  },
  {
    id: 40,
    topic: "State",
    question: "What was the size of the Illinois Cannabis Social Equity Loan Program Round III, opened in August 2025?",
    choices: [
      "$5.4M to 12 businesses",
      "$14.2M to 40 businesses",
      "$31.8M to 95 businesses",
      "$75M to 200 businesses",
    ],
    correctIndex: 2,
    explanation:
      "Round III opened 8/11/2025 and awarded $31.8M to 95 social-equity cannabis licensees through DCEO's Office of Economic Equity. Funds are structured as forgivable loans for craft growers, infusers, transporters, and dispensaries.",
  },
  {
    id: 41,
    topic: "State",
    question: "What share of Illinois adult-use cannabis tax revenue funds the Restore, Reinvest, Renew (R3) grant program?",
    choices: ["10%", "15%", "25%", "40%"],
    correctIndex: 2,
    explanation:
      "R3 receives 25% of Illinois adult-use cannabis tax revenue, funding civil legal aid, economic development, reentry, violence prevention, and youth development grants in disinvested communities. Next deadline: 3/6/2026.",
  },
  {
    id: 42,
    topic: "State",
    question: "What is the maximum combined (state + local) sales-tax exemption on building materials inside a designated Illinois Enterprise Zone?",
    choices: ["6.25%", "7.50%", "9.25%", "10.25%"],
    correctIndex: 2,
    explanation:
      "Enterprise Zones offer up to 9.25% combined (state + local) sales-tax exemption on building materials used in qualifying projects — substantially more than the 6.25% state-only rate. The exemption is administered via the BMEC.",
  },
  {
    id: 43,
    topic: "State",
    question: "Under the 2025 EDGE amendments, DCEO must publicly post each new agreement's terms within how many days?",
    choices: ["2 days", "10 days", "30 days", "90 days"],
    correctIndex: 1,
    explanation:
      "P.A. 104-0006 (HB2755, signed June 2025) requires DCEO to post each EDGE agreement's terms within 10 days — a new transparency rule designed to expose deal structure and incentive value to public scrutiny.",
  },
  {
    id: 44,
    topic: "State",
    question: "Which of these is NOT a benefit category under the Illinois Live Theater Production Tax Credit?",
    choices: [
      "20% credit on qualified Illinois expenditures",
      "Transferable to other taxpayers",
      "Refundable as cash if no tax liability",
      "Per-category caps for Broadway touring and nonprofit",
    ],
    correctIndex: 2,
    explanation:
      "The Live Theater Credit is 20% of qualified Illinois expenditures and is transferable, but it is not refundable — taxpayers monetize unused credit by selling it. Dec 2025 rule amendments added Broadway touring shows and nonprofit theater categories with per-category caps.",
  },
  {
    id: 45,
    topic: "State",
    question: "On the Chicago Incentive Explorer map, the 'state incentive zones' shown for EDGE, REV, MICRO, and Data Center are best described as…",
    choices: [
      "Official DCEO program boundaries",
      "A high-unemployment census-tract proxy, not an official map",
      "TIF districts overlaid with EZ boundaries",
      "Federal Opportunity Zones recolored",
    ],
    correctIndex: 1,
    explanation:
      "EDGE, REV, MICRO, and Data Center are project-by-project — not geographic — programs. The shared 114-feature layer is a proxy of high-unemployment tracts that approximates where the underserved-area boost applies, not an official DCEO designation.",
  },
  {
    id: 46,
    topic: "State",
    question: "When do the next round of Illinois Opportunity Zone (OZ 2.0) tracts take effect?",
    choices: [
      "January 1, 2026",
      "January 1, 2027",
      "January 1, 2028",
      "January 1, 2030",
    ],
    correctIndex: 1,
    explanation:
      "Under OBBBA's 10-year redesignation cycle, states nominate new OZ tracts in H2 2026 with effect 1/1/2027. Illinois will nominate approximately 238 new zones; the existing 327 IL OZ 1.0 tracts remain valid through 12/31/2028.",
  },

  // ---------- COUNTY (18) — ids 47-64 ----------
  {
    id: 47,
    topic: "County",
    question: "Cook County Class 6b reduces a qualifying industrial property's assessment from 25% to what rate during years 1-10?",
    choices: ["5%", "10%", "15%", "20%"],
    correctIndex: 1,
    explanation:
      "Class 6b assesses at 10% of market value for years 1-10, then 15% in year 11 and 20% in year 12 before reverting to the standard 25%. Total savings typically run about 60% of property tax liability over the incentive period.",
  },
  {
    id: 48,
    topic: "County",
    question: "What is the threshold project cost that distinguishes Cook County Class 7a from Class 7b?",
    choices: ["$500,000", "$1 million", "$2 million", "$5 million"],
    correctIndex: 2,
    explanation:
      "Class 7a covers commercial projects under $2M; Class 7b covers commercial projects over $2M. Both deliver the 10%/15%/20% schedule for 12 years, but 7b is reserved for larger 'area in need of commercial development' deals.",
  },
  {
    id: 49,
    topic: "County",
    question: "What is the assessment-schedule ramp for Cook County Class 7c (CURE)?",
    choices: [
      "10% for 5 years, 15% year 6, 20% year 7",
      "10% for 3 years, 15% year 4, 20% year 5",
      "10% for 10 years, 15% year 11, 20% year 12",
      "10% for 12 years flat",
    ],
    correctIndex: 1,
    explanation:
      "Class 7c (Commercial Urban Relief Eligibility, or CURE) runs 10% for years 1-3, 15% year 4, 20% year 5 — a shorter ramp than 7a/7b — and is renewable once for an additional 5 years. It's designed for projects with tighter pro formas.",
  },
  {
    id: 50,
    topic: "County",
    question: "What document must a property owner secure from IEPA before applying for Cook County Class C?",
    choices: [
      "An Environmental Impact Statement (EIS)",
      "A No Further Remediation (NFR) letter",
      "A Site Remediation Action Plan (SRAP)",
      "A Phase III Closure Certificate",
    ],
    correctIndex: 1,
    explanation:
      "Class C requires an IEPA 'No Further Remediation' (NFR) letter, and the Class C application must be filed within one year of receipt. Remediation costs must exceed $100K or 25% of the property's market value. Class C uniquely reduces both land AND improvements.",
  },
  {
    id: 51,
    topic: "County",
    question: "Class L requires that an owner invest at least what share of the building's market value in approved rehabilitation work?",
    choices: ["25%", "50%", "75%", "100%"],
    correctIndex: 1,
    explanation:
      "Class L requires rehabilitation investment equal to at least 50% of the building's market value. It runs 10%/15%/20% for 12 years on the building portion (land too if vacant 2+ years) and stacks effectively with the federal 20% Historic Tax Credit.",
  },
  {
    id: 52,
    topic: "County",
    question: "What's the 2026 Tier 1 per-square-foot capital expenditure threshold for the Affordable Housing Special Assessment Program (AHSAP)?",
    choices: ["$4.50/sf", "$8.16/sf", "$12.75/sf", "$22.00/sf"],
    correctIndex: 1,
    explanation:
      "AHSAP 2026 thresholds are $8.16/sf (Tier 1) and $12.75/sf (Tier 3), plus replacement of 2 primary building systems. AHSAP — administered by the Cook County Assessor — replaces legacy Class 9 for most multifamily use cases. Part 1 + Part 2 deadline: 9/5/2026.",
  },
  {
    id: 53,
    topic: "County",
    question: "What annual program total does Invest in Cook fund?",
    choices: ["$2.5M", "$5M", "$8.5M", "$15M"],
    correctIndex: 2,
    explanation:
      "Cook County DOTH's Invest in Cook awards $8.5M annually for planning, engineering, ROW, and construction on transit, bike/ped, freight, roadway, and bridge projects. The 10th round closed 3/20/2026.",
  },
  {
    id: 54,
    topic: "County",
    question: "What grant amount does the Cook County Cannabis Development Grant award per recipient?",
    choices: ["$25,000", "$50,000", "$75,000", "$100,000"],
    correctIndex: 2,
    explanation:
      "$75,000 per recipient, awarded by Cook County's Bureau of Economic Development to Illinois social-equity cannabis licensees (dispensary, craft grow, transporter, infuser). Nine additional awardees were named in December 2025.",
  },
  {
    id: 55,
    topic: "County",
    question: "Cook County's Catalyst Grant Round 2 awarded up to how much per recipient?",
    choices: ["$25,000", "$50,000", "$100,000", "$250,000"],
    correctIndex: 2,
    explanation:
      "Catalyst Grant Round 2 (Sept-Nov 2025, $8.8M of ARPA funds) capped awards at $100,000 each, with up to 88 awards. Disbursements began spring 2026 through the Cook County Small Business Source.",
  },
  {
    id: 56,
    topic: "County",
    question: "What is unique about Class 6b SER (Sustainable Emergency Relief) compared to standard Class 6b?",
    choices: [
      "It applies only to industrial property in landmark districts",
      "It is non-renewable and requires a Cook County Board resolution",
      "It runs 20 years instead of 12",
      "It is available only to woman-owned businesses",
    ],
    correctIndex: 1,
    explanation:
      "6b SER is for long-tenured industrial owners (10+ years same ownership) facing economic hardship. Unlike standard 6b, it requires BOTH a municipal Special Circumstances resolution AND a Cook County Board resolution, and it is non-renewable.",
  },
  {
    id: 57,
    topic: "County",
    question: "Cook County C-PACE financing typically runs for terms as long as…",
    choices: ["10 years", "20 years", "30 years", "50 years"],
    correctIndex: 2,
    explanation:
      "Commercial Property Assessed Clean Energy (C-PACE) loans can run up to 30 years — long enough to match the useful life of energy efficiency, renewable, water-conservation, and resiliency improvements. The financing is repaid as a property-tax assessment, transferable to new owners.",
  },
  {
    id: 58,
    topic: "County",
    question: "What is the 'PubliCity portal' reference in the CCLBA description, and what is its current status?",
    choices: [
      "An active CCLBA acquisition portal",
      "An outdated reference — CCLBA now uses standard pre-qualification and offer applications",
      "A new program launching 2027",
      "A federally funded CDFI portal",
    ],
    correctIndex: 1,
    explanation:
      "The 'PubliCity portal' reference is outdated. CCLBA today uses standard pre-qualification and offer applications. The Reclaiming Chicago Initiative (groundbreaking August 2025) is converting South Side lots into new homes — that's the headline current effort.",
  },
  {
    id: 59,
    topic: "County",
    question: "Which Cook County Assessor's phone line should you call to discuss property tax incentive eligibility?",
    choices: [
      "(312) 443-7550 (Main)",
      "(312) 603-1000 (BED)",
      "(312) 603-7529 (Incentives)",
      "(312) 744-4190 (DPD)",
    ],
    correctIndex: 2,
    explanation:
      "The Cook County Assessor's Incentives Department line is (312) 603-7529 — the right number for 6b, 7a/7b/7c, 8, C, L, and AHSAP. The main Assessor line is (312) 443-7550 and the County's Bureau of Economic Development is (312) 603-1000.",
  },
  {
    id: 60,
    topic: "County",
    question: "Which agency administers free Phase I and Phase II environmental assessments for suburban Cook County brownfields?",
    choices: [
      "Cook County Department of Environment and Sustainability (DES)",
      "Illinois EPA Office of Brownfields",
      "Chicago Department of Public Health",
      "U.S. EPA Region 5",
    ],
    correctIndex: 0,
    explanation:
      "Cook County DES — using ARPA funds — provides no-cost Phase I and Phase II assessments to qualified suburban Cook owners. It coordinates with SSMMA's South Suburban Brownfields Coalition and bridges into the IEPA Site Remediation Program and Class C incentive.",
  },
  {
    id: 61,
    topic: "County",
    question: "Which Cook County class lets BOTH industrial AND commercial uses qualify within the same incentive?",
    choices: ["Class 6b", "Class 7b", "Class 8", "Class L"],
    correctIndex: 2,
    explanation:
      "Class 8 is unique in covering both industrial and commercial uses within the five south-suburban townships (Bloom, Bremen, Calumet, Rich, Thornton). Class 6b is industrial-only; Class 7a/7b/7c is commercial-only.",
  },
  {
    id: 62,
    topic: "County",
    question: "Cook County's Class 8a MICRO is a tax incentive tied to what kind of business activity?",
    choices: [
      "Microbreweries and craft distilleries",
      "Semiconductor manufacturing supply chain",
      "Microloans under $50,000",
      "Microbusinesses with under 10 employees",
    ],
    correctIndex: 1,
    explanation:
      "Class 8a MICRO is Cook County's property-tax companion to the state MICRO program, supporting semiconductor and microchip manufacturers, packagers, testers, and supply-chain firms with reduced assessment.",
  },
  {
    id: 63,
    topic: "County",
    question: "Which Cook County Assessor incentive uniquely reduces assessment on BOTH land and improvements (not just the building)?",
    choices: ["Class 6b", "Class 7a", "Class C", "Class L"],
    correctIndex: 2,
    explanation:
      "Class C — the brownfield incentive — applies the 10% assessment to both land AND improvements for the 12-year schedule. Most other classes (6b, 7a/b/c, L) apply primarily to improvements; Class L can pick up land only if the building was vacant 2+ years.",
  },
  {
    id: 64,
    topic: "County",
    question: "Across Cook County's full Assessor incentive ladder (6b, 7a, 7b, 7c, 8, C, L), what is the typical first-step requirement before the Assessor will accept an application?",
    choices: [
      "Federal tax-exempt status (501(c)(3))",
      "A municipal resolution of support from the host municipality",
      "An LEED Silver design certification",
      "Pre-qualification through CCLBA",
    ],
    correctIndex: 1,
    explanation:
      "Almost every Cook County Assessor incentive — 6b, 7a, 7b, 7c, 8, C, L — requires a municipal resolution of support first (a City Council ordinance in Chicago). The Assessor then verifies use, project scope, and 'but-for' findings before granting the reduced assessment.",
  },

  // ---------- CITY (18) — ids 65-82 ----------
  {
    id: 65,
    topic: "City",
    question: "What is the maximum reimbursement RATE for eligible construction costs under SBIF?",
    choices: ["50%", "75%", "90%", "100%"],
    correctIndex: 2,
    explanation:
      "SBIF reimburses up to 90% of pre-approved permanent building improvements (HVAC, roofing, electrical, fire suppression). Caps vary by tier: $75K multi-tenant, $150K commercial, $250K industrial.",
  },
  {
    id: 66,
    topic: "City",
    question: "Which Chicago department was formerly known as 'DCD' but is now officially called DPD?",
    choices: [
      "Department of Cultural Development",
      "Department of Community Development",
      "Department of Planning and Development",
      "Department of Capital Development",
    ],
    correctIndex: 2,
    explanation:
      "The Department of Planning and Development (DPD) is the current name; 'DCD' persists only as a legacy URL slug. DPD runs TIF, NOF, CCSA, CDG, and Workforce Solutions, all routed through cocdpd.submittable.com.",
  },
  {
    id: 67,
    topic: "City",
    question: "The Neighborhood Opportunity Fund (NOF) base grant caps at what amount and reimbursement rate?",
    choices: [
      "$100,000 at 100% reimbursement",
      "$250,000 at 75% reimbursement",
      "$500,000 at 50% reimbursement",
      "$1.5 million catalytic tier",
    ],
    correctIndex: 1,
    explanation:
      "NOF base grant: $250K at 75% reimbursement, plus a $50K (or 20%) technical-assistance bonus when paired with an approved TA provider. The legacy '$1.5M catalytic' tier is gone — large catalytic projects now route through the Community Development Grant program.",
  },
  {
    id: 68,
    topic: "City",
    question: "Chicago's Commercial Corridor Storefront Activation (CCSA) deploys roughly how much across how many corridors?",
    choices: [
      "$10M across 5 corridors",
      "$30.5M across 12 corridors",
      "$50M across 20 corridors",
      "$100M across 30 corridors",
    ],
    correctIndex: 1,
    explanation:
      "CCSA deploys $30.5M across 12 corridors over 3 years, with Allies for Community Business as the lead administrator. Applications live at cocdpd.submittable.com/submit/343419.",
  },
  {
    id: 69,
    topic: "City",
    question: "What is the size tier of a 'Medium' Community Development Grant (CDG)?",
    choices: [
      "$50K to $250K",
      "$300K to $5M",
      "$5M to $25M",
      "$25M to $100M",
    ],
    correctIndex: 1,
    explanation:
      "CDG tiers: Small (up to $250K), Medium ($300K-$5M), Large (over $5M). The umbrella replaced Chicago Recovery Plan branding post-ARPA close-out and is DPD's flagship grant family.",
  },
  {
    id: 70,
    topic: "City",
    question: "Which department administers the Micro Market Recovery Program (MMRP) today?",
    choices: [
      "Department of Planning and Development (DPD)",
      "Department of Housing (DOH)",
      "Department of Business Affairs and Consumer Protection (BACP)",
      "Department of Cultural Affairs (DCASE)",
    ],
    correctIndex: 1,
    explanation:
      "MMRP migrated to the Department of Housing and now functions primarily as a homeownership program: $15,000 down-payment grants via Neighborhood Housing Services (formerly branded MMRP; the program is now the Chicago Neighborhood Recovery Program, CNRP). The original 'commercial-storefront activation' framing is outdated.",
  },
  {
    id: 71,
    topic: "City",
    question: "How many designated landmark districts does Chicago have under the 2025 Landmarks Ordinance?",
    choices: ["24", "42", "62", "108"],
    correctIndex: 2,
    explanation:
      "Chicago has 62 landmark districts under the 2025 Landmarks Ordinance. The Commission on Chicago Landmarks (within DPD) handles designation and Class L applications; final tax benefit is administered by the Cook County Assessor.",
  },
  {
    id: 72,
    topic: "City",
    question: "How many designated Industrial Corridors does Chicago have?",
    choices: ["12", "18", "26", "36"],
    correctIndex: 2,
    explanation:
      "Chicago has 26 designated Industrial Corridors, established to protect manufacturing land use from residential conversion. The Industrial Corridor Modernization Initiative recently finalized Armitage, with Burnside and Calumet plans still in progress.",
  },
  {
    id: 73,
    topic: "City",
    question: "Which Chicago program is run by Allies for Community Business (a4cb.org) on behalf of DPD?",
    choices: [
      "SBIF",
      "NOF",
      "Commercial Corridor Storefront Activation (CCSA)",
      "TIF redevelopment agreements",
    ],
    correctIndex: 2,
    explanation:
      "Allies for Community Business administers CCSA: $30.5M across 12 corridors over 3 years. SBIF is administered by SomerCor; NOF and TIF/CDG sit directly with DPD.",
  },
  {
    id: 74,
    topic: "City",
    question: "Approximately how many TIF districts in Chicago expired on 12/31/2025?",
    choices: ["3", "9", "13", "24"],
    correctIndex: 1,
    explanation:
      "9 TIF districts expired 12/31/2025, with 13 more set to sunset 12/31/2026. About 124 TIFs are currently active per the Civic Federation (May 2025). The map of eligible SBIF areas evolves with these expirations.",
  },
  {
    id: 75,
    topic: "City",
    question: "Which Chicago grant program targets training and upskilling of existing employees?",
    choices: [
      "NOF Technical Assistance bonus",
      "Workforce Solutions Program",
      "SBIF Tier 3",
      "Climate Infrastructure Fund",
    ],
    correctIndex: 1,
    explanation:
      "The 2026 Workforce Solutions Program (DPD) is a new grant for training and upskilling of existing employees. Applications run through cocdpd.submittable.com/submit/346309. SBIF covers capital improvements, not workforce.",
  },
  {
    id: 76,
    topic: "City",
    question: "Which Chicago fund supports renewable energy, EV charging, and green stormwater infrastructure projects?",
    choices: [
      "Industrial Corridor Modernization Fund",
      "Climate Infrastructure Fund (CIF)",
      "Neighborhood Opportunity Fund",
      "Together Now Grants",
    ],
    correctIndex: 1,
    explanation:
      "CIF — Climate Infrastructure Fund — and ETOD (Equitable Transit-Oriented Development) launched in 2022 and continue under DPD via the Universal Small Grant Application. CIF funds renewables, EV charging, and green stormwater; ETOD funds projects near CTA/Metra.",
  },
  {
    id: 77,
    topic: "City",
    question: "Who is the service provider for Special Service Area (SSA) #50 on Chicago's Southeast Side?",
    choices: [
      "Allies for Community Business",
      "SomerCor",
      "Southeast Chicago Chamber of Commerce (SECCC)",
      "Neighborhood Housing Services",
    ],
    correctIndex: 2,
    explanation:
      "SECCC is the SSA #50 service provider. SSAs are local property-tax-funded districts (Chicago has 58 active) that deliver corridor maintenance, marketing, and small-business support beyond standard city services.",
  },
  {
    id: 78,
    topic: "City",
    question: "Where do most DPD grant applications live online in 2026?",
    choices: [
      "On chicago.gov/grants",
      "Through Submittable at cocdpd.submittable.com",
      "Through SAM.gov",
      "Via paper submission to City Hall",
    ],
    correctIndex: 1,
    explanation:
      "DPD has consolidated 13+ live forms at cocdpd.submittable.com — SBIF, NOF (English + Spanish), CCSA, CDG small/medium/large, Workforce Solutions, Property Tax Incentives, Universal Financial Incentives, and Delegate Agency contracts.",
  },
  {
    id: 79,
    topic: "City",
    question: "What is the maximum NOF Technical Assistance bonus when an applicant pairs with an approved TA provider?",
    choices: [
      "$10,000",
      "$25,000",
      "$50,000 (or +20% for pre-development)",
      "$100,000",
    ],
    correctIndex: 2,
    explanation:
      "On top of the $250K base grant at 75% reimbursement, NOF awards up to $50,000 (or +20% of project costs for pre-development) when the applicant works with an approved TA provider. This is meaningful for first-time applicants navigating design and permitting.",
  },
  {
    id: 80,
    topic: "City",
    question: "What does TIF actually generate revenue from?",
    choices: [
      "A new sales tax inside the district",
      "The incremental rise in property tax revenue above a frozen base assessment",
      "Federal Treasury allocations",
      "A surcharge on hotel and amusement taxes",
    ],
    correctIndex: 1,
    explanation:
      "Tax Increment Financing captures the rise in property tax revenue above a frozen base year assessment. That 'increment' funds redevelopment in the district for the life of the TIF (typically 23 years, sometimes extended).",
  },
  {
    id: 81,
    topic: "City",
    question: "Which is the correct Submittable form ID category for grants over $250K (TIF RDAs and large capital deals)?",
    choices: [
      "2026 SBIF Application",
      "Universal Financial Incentives Application",
      "Workforce Solutions Program",
      "Small CDG (Spanish)",
    ],
    correctIndex: 1,
    explanation:
      "TIF redevelopment agreements and other grants above $250K route through DPD's Universal Financial Incentives Application at cocdpd.submittable.com/submit/219899. SBIF, CCSA, and CDG tiers have their own dedicated forms.",
  },
  {
    id: 82,
    topic: "City",
    question: "What is the SBIF cap for an industrial property?",
    choices: ["$75,000", "$150,000", "$250,000", "$500,000"],
    correctIndex: 2,
    explanation:
      "SBIF caps at $75K for multi-tenant, $150K for commercial, and $250K for industrial — all reimbursing up to 90% of pre-approved permanent building improvements. The 2026 program rolls out in monthly rounds April-October.",
  },

  // ---------- UTILITY (6) — ids 83-88 ----------
  {
    id: 83,
    topic: "Utility",
    question: "Which Illinois utility administers the residential and commercial EV charger rebate program covering Chicago?",
    choices: ["Peoples Gas", "ComEd", "Nicor Gas", "Ameren Illinois"],
    correctIndex: 1,
    explanation:
      "ComEd runs the EV Charger and Installation Rebate, plus the EV Make-Ready program for fleet and multi-unit dwellings. Residential rebates run $1,000-$2,500; commercial sites can get up to $8,000 per port.",
  },
  {
    id: 84,
    topic: "Utility",
    question: "What is the typical residential rebate range under the ComEd EV charger program?",
    choices: [
      "$250-$500",
      "$1,000-$2,500",
      "$3,000-$5,000",
      "$5,000-$10,000",
    ],
    correctIndex: 1,
    explanation:
      "Residential ComEd EV rebates run $1,000-$2,500 depending on whether the installation includes home electrical upgrades. Commercial sites — via the EV Make-Ready program — can stack up to $8,000 per port.",
  },
  {
    id: 85,
    topic: "Utility",
    question: "Which federal credit is most commonly stacked with ComEd's EV charger rebate?",
    choices: [
      "§45L New Energy Efficient Home Credit",
      "§30C Alternative Fuel Vehicle Refueling Property Credit",
      "§48 Solar Investment Tax Credit",
      "§25D Residential Clean Energy Credit",
    ],
    correctIndex: 1,
    explanation:
      "The federal §30C Alternative Fuel Vehicle Refueling Property Credit stacks with the ComEd rebate. For business installations §30C is up to 30% of cost (subject to caps); for individuals the credit applies to home installations in eligible census tracts.",
  },
  {
    id: 86,
    topic: "Utility",
    question: "Which type of site is eligible for ComEd's higher-tier 'EV Make-Ready' commercial rebate?",
    choices: [
      "Only single-family detached homes",
      "Only state government buildings",
      "Multi-unit dwellings, workplaces, and fleet sites",
      "Only data centers",
    ],
    correctIndex: 2,
    explanation:
      "EV Make-Ready targets multi-unit dwellings, workplaces, public sites, and fleet locations — paying ComEd to bring power to the parking space (the 'make-ready' work) plus a per-port rebate up to $8,000.",
  },
  {
    id: 87,
    topic: "Utility",
    question: "On the Chicago Incentive Explorer, the ComEd EV rebate is categorized at which level?",
    choices: ["Federal", "State", "County", "Utility"],
    correctIndex: 3,
    explanation:
      "ComEd is the only program currently classified as 'Utility' on the Explorer. It's a regulated-utility program (overseen by the Illinois Commerce Commission) — neither a federal, state, county, nor city incentive, but stackable with all four.",
  },
  {
    id: 88,
    topic: "Utility",
    question: "Why does the Chicago Incentive Explorer treat ComEd's program as its own level rather than rolling it under 'State'?",
    choices: [
      "Because it's funded by federal Department of Energy dollars",
      "Because it's a regulated investor-owned utility program, not a state agency program",
      "Because the city contracts ComEd directly",
      "Because Cook County administers the funds",
    ],
    correctIndex: 1,
    explanation:
      "ComEd is an Exelon-subsidiary investor-owned utility. Its programs are rate-recovered and approved by the Illinois Commerce Commission — a distinct mechanism from DCEO grants or IDOR-administered tax credits, which is why the Explorer gives it its own 'Utility' tier.",
  },

  // ---------- MIXED / "spot the imposter" (12) — ids 89-100 ----------
  {
    id: 89,
    topic: "City",
    question: "Which of the following is NOT a real Chicago incentive program?",
    choices: [
      "Neighborhood Opportunity Fund (NOF)",
      "Small Business Improvement Fund (SBIF)",
      "Bring Chicago Home Real Estate Transfer Tax Fund",
      "Commercial Corridor Storefront Activation (CCSA)",
    ],
    correctIndex: 2,
    explanation:
      "Bring Chicago Home was a ballot referendum proposing a graduated real-estate transfer tax to fund homelessness services — it FAILED at the ballot box on 3/19/2024. NOF, SBIF, and CCSA are all live DPD-administered programs.",
  },
  {
    id: 90,
    topic: "State",
    question: "Which of these is NOT a real Illinois state incentive?",
    choices: [
      "REV Illinois",
      "MICRO Program",
      "AIM Tax Credit",
      "Illinois Growth Bond Refundable Credit",
    ],
    correctIndex: 3,
    explanation:
      "There is no 'Illinois Growth Bond Refundable Credit.' REV (EV manufacturing), MICRO (semiconductor), and AIM (advanced manufacturing, effective 1/1/2026) are all DCEO-administered tax credit programs.",
  },
  {
    id: 91,
    topic: "County",
    question: "Which Cook County Assessor incentive does NOT exist?",
    choices: ["Class 6b", "Class 7c", "Class C", "Class M"],
    correctIndex: 3,
    explanation:
      "There is no Class M. Cook County's Assessor incentive ladder includes 6b (industrial), 7a/7b/7c (commercial), 8 (severely distressed townships), 9 (legacy affordable, largely replaced by AHSAP), C (brownfield), and L (landmark).",
  },
  {
    id: 92,
    topic: "Federal",
    question: "Which of these is NOT a real federal incentive on chicagoincentiveexplorer.com?",
    choices: [
      "CHIPS Investment Tax Credit (§48D)",
      "HUD Section 108 Loan Guarantee",
      "SSBCI Advantage Illinois",
      "Federal Storefront Activation Voucher (FSAV)",
    ],
    correctIndex: 3,
    explanation:
      "There is no 'Federal Storefront Activation Voucher.' §48D (25% chip credit), HUD Section 108 (FY 2026 fee 0.58%), and SSBCI ($354.6M to Illinois) are all real federal programs. Chicago's storefront-activation program is CCSA — that one's a CITY program.",
  },
  {
    id: 93,
    topic: "City",
    question: "Which Chicago program has been DISCONTINUED and should not be relied on in 2026?",
    choices: [
      "Industrial Corridor Protections",
      "Together Now / Cultivate Grants",
      "Special Service Area #50",
      "Climate Infrastructure Fund (CIF)",
    ],
    correctIndex: 1,
    explanation:
      "Together Now and Cultivate were pandemic-era (2020-2021) emergency grants and have been closed for years. Industrial Corridors, SSA #50, and CIF all remain active in 2026.",
  },
  {
    id: 94,
    topic: "Federal",
    question: "Which of these federal tax credits is NOT eligible for 'elective pay' (direct cash refund to tax-exempt entities)?",
    choices: [
      "IRA §48E Clean Electricity ITC",
      "§30C Alternative Fuel Vehicle Refueling Property",
      "§48D CHIPS Manufacturing Credit",
      "WOTC (Work Opportunity Tax Credit)",
    ],
    correctIndex: 3,
    explanation:
      "WOTC is a tax-liability credit only — it cannot be monetized via elective pay or transferability, and it's currently lapsed (expired 12/31/2025). §48E, §30C, and §48D are all elective-pay eligible.",
  },
  {
    id: 95,
    topic: "State",
    question: "Which of these is NOT one of Illinois' four REV investment tiers?",
    choices: [
      "Large EV manufacturer: $1.5B + 500 jobs",
      "EV component manufacturer: $300M + 150 jobs",
      "Small EV manufacturer: $20M + 50 jobs",
      "Micro EV startup: $1M + 10 jobs",
    ],
    correctIndex: 3,
    explanation:
      "REV's four tiers are Large EV ($1.5B/500), EV component ($300M/150), Small EV ($20M/50 over 4 yrs), and Converted Manufacturer ($100M/75). There is no 'Micro EV startup' tier — the smallest is Small EV.",
  },
  {
    id: 96,
    topic: "City",
    question: "Which of these does NOT exist as a real DPD Submittable application form?",
    choices: [
      "2026 SBIF Application",
      "Universal Financial Incentives Application",
      "Large Community Development Grant",
      "Chicago Recovery Plan Round 4 Application",
    ],
    correctIndex: 3,
    explanation:
      "Chicago Recovery Plan branding was retired and rolled into the Community Development Grant umbrella post-ARPA close-out — there is no 'Round 4' application. The other three are live forms on cocdpd.submittable.com.",
  },
  {
    id: 97,
    topic: "County",
    question: "Which of these is NOT one of the five Cook County Class 8 townships?",
    choices: ["Bloom", "Bremen", "Calumet", "Cicero"],
    correctIndex: 3,
    explanation:
      "Cicero is not a Class 8 township. The five south-suburban Class 8 townships are Bloom, Bremen, Calumet, Rich, and Thornton. Cicero sits in central/west Cook and uses standard 6b/7a/7b classes.",
  },
  {
    id: 98,
    topic: "Federal",
    question: "Which of these has NOT been reauthorized as of 2026 and is currently lapsed?",
    choices: [
      "New Markets Tax Credit",
      "Federal Historic Tax Credit",
      "Work Opportunity Tax Credit (WOTC)",
      "Federal Opportunity Zone program",
    ],
    correctIndex: 2,
    explanation:
      "WOTC expired 12/31/2025 and awaits Congressional reauthorization. NMTC was made permanent by OBBBA (July 2025); HTC has no statutory change; OZ was also made permanent under OBBBA on a 10-year designation cycle.",
  },
  {
    id: 99,
    topic: "State",
    question: "Which of these benefits is NOT actually available under Illinois Enterprise Zones?",
    choices: [
      "Up to 9.25% sales-tax exemption on building materials",
      "Utility tax exemptions for qualifying users",
      "Manufacturing machinery & equipment sales tax exemption",
      "10-year state income tax holiday for all zone businesses",
    ],
    correctIndex: 3,
    explanation:
      "There is no blanket 'income tax holiday' for EZ businesses. Real EZ benefits include the up-to-9.25% building-materials exemption (via BMEC), utility-tax exemptions, M&E sales-tax exemption, an investment tax credit, and a job-creation income-tax credit — all project-specific.",
  },
  {
    id: 100,
    topic: "City",
    question: "Which of these statements about Chicago incentives is actually TRUE?",
    choices: [
      "TIF redevelopment agreements have a hard $250,000 per-project cap",
      "NOF still offers a $1.5M catalytic grant tier",
      "Chicago has roughly 124 active TIF districts as of 2026",
      "MMRP is administered by DPD and focuses on commercial storefronts",
    ],
    correctIndex: 2,
    explanation:
      "Chicago had about 124 active TIF districts in 2026 (Civic Federation). TIF RDAs are negotiated and have no per-project cap; NOF's '$1.5M catalytic' tier was discontinued (large catalytic projects now route through CDG); and MMRP moved to the Department of Housing, was renamed the Chicago Neighborhood Recovery Program (CNRP), and now focuses on $15,000 down-payment grants, not storefronts.",
  },
];
