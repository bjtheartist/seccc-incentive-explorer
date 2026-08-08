/**
 * Answer-engine pages: short, direct answers to practical questions Chicago
 * business owners search for. Each renders at /answers/[slug] and routes into
 * the free location snapshot. Built for long-tail search + AI answer engines.
 *
 * Keep `answer` to ~40 words (a direct, quotable response).
 * `relatedProgramSlugs` must match slugs from lib/programs-data (slugifyProgramName).
 */

export interface AnswerSource {
  label: string;
  url: string;
}

export interface AnswerPage {
  slug: string;
  /** The user-facing question (also the H1 and FAQ question). */
  question: string;
  /** SEO title; brand is appended by the layout template. */
  title: string;
  /** Meta description (~150 chars). */
  description: string;
  /** ~40-word direct answer rendered at the top of the page. */
  answer: string;
  /** 3-5 supporting points. */
  bullets: string[];
  /** Program slugs to cross-link (must exist in programs-data). */
  relatedProgramSlugs: string[];
  /** Optional neighborhood slugs to cross-link. */
  relatedNeighborhoodSlugs?: string[];
  /** Official / authoritative sources. */
  sources: AnswerSource[];
}

/**
 * Seed entries so the sitemap and route compile. Expanded to ~24 by the
 * answer-pages build step.
 */
export const ANSWER_PAGES: AnswerPage[] = [
  {
    slug: "how-do-i-check-chicago-business-incentives-by-address",
    question: "How do I check Chicago business incentives by address?",
    title: "How to Check Chicago Business Incentives by Address",
    description:
      "Enter any Chicago address to see which public incentive programs and zones may apply — TIF, NOF, SBIF, Opportunity Zones, and more — in one free snapshot.",
    answer:
      "Enter your Chicago address into the Chicago Incentive Explorer and generate a free location snapshot. It cross-references city, county, state, and federal incentive zones for that address and lists the programs and local support partners that may apply.",
    bullets: [
      "One address returns every overlapping incentive zone in one view.",
      "Covers city (TIF, SBIF, NOF, SSA), county (Cook 7a/7b), state (Enterprise Zone), and federal (Opportunity Zone, NMTC) layers.",
      "Results are a starting point — verify exact eligibility with the administering agency before you spend money.",
      "No login or fee required.",
    ],
    relatedProgramSlugs: [],
    sources: [
      {
        label: "City of Chicago — Tax Increment Financing",
        url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
      },
    ],
  },
  {
    slug: "is-my-business-in-a-tif-district",
    question: "Is my business in a TIF district?",
    title: "Is My Business in a Chicago TIF District?",
    description:
      "Check whether your Chicago address falls inside a Tax Increment Financing (TIF) district and what that may unlock — in a free location snapshot.",
    answer:
      "Enter your address into the Chicago Incentive Explorer to see whether it falls inside one of Chicago's TIF districts. TIF can support eligible building improvements and development; smaller storefront work often routes through the SBIF program.",
    bullets: [
      "Chicago has well over 100 active TIF districts citywide.",
      "TIF Redevelopment Agreements are negotiated per project; smaller facade/interior work typically uses SBIF.",
      "Confirm the exact boundary and program fit with the Department of Planning and Development.",
    ],
    relatedProgramSlugs: [],
    sources: [
      {
        label: "City of Chicago — TIF",
        url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
      },
    ],
  },
  {
    slug: "what-is-sbif-in-chicago",
    question: "What is SBIF in Chicago?",
    title: "What Is SBIF (Small Business Improvement Fund) in Chicago?",
    description:
      "SBIF reimburses Chicago businesses and property owners for building improvements using TIF funds. Use a free snapshot to check whether your address is inside a participating district, then verify the current rules.",
    answer:
      "The Small Business Improvement Fund (SBIF) reimburses Chicago businesses and commercial property owners for permanent building improvements — like facade, interior build-out, and equipment — using TIF district funds. Grants are need-based and tied to specific funding rounds by area.",
    bullets: [
      "Funded through local TIF districts and administered with SomerCor.",
      "Covers permanent improvements: facade, build-out, ADA, roofing, HVAC, and more.",
      "Availability and rounds vary by TIF district — check your address before applying.",
    ],
    relatedProgramSlugs: ["small-business-improvement-fund", "tif-districts"],
    sources: [
      {
        label: "SomerCor — SBIF",
        url: "https://somercor.com/sbif/",
      },
    ],
  },
  {
    slug: "what-is-a-tif-district-in-chicago",
    question: "What is a TIF district in Chicago?",
    title: "What Is a TIF District in Chicago?",
    description:
      "A TIF district reinvests growth in property tax revenue into local improvements. Chicago has 124 active TIF districts — see if your address is in one.",
    answer:
      "A Tax Increment Financing (TIF) district captures the growth in property tax revenue inside a set boundary and reinvests it locally — into infrastructure, streetscaping, and building rehab. Chicago has 124 active TIF districts; smaller building work often routes through SBIF.",
    bullets: [
      "TIF freezes the base property tax value; the 'increment' above it funds improvements in the district.",
      "Large projects use negotiated TIF Redevelopment Agreements through the Department of Planning and Development.",
      "Smaller storefront and interior work typically flows through the SBIF reimbursement program.",
      "Several Chicago TIFs are sunsetting in 2025-2026, so confirm your district is still active.",
    ],
    relatedProgramSlugs: ["tif-districts", "small-business-improvement-fund"],
    sources: [
      {
        label: "City of Chicago — Tax Increment Financing",
        url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
      },
    ],
  },
  {
    slug: "is-my-property-in-a-nof-zone",
    question: "Is my property in a NOF zone?",
    title: "Is My Property in a Neighborhood Opportunity Fund (NOF) Zone?",
    description:
      "Check whether your Chicago property sits in an eligible Neighborhood Opportunity Fund area — and what the grant can reimburse — in a free address snapshot.",
    answer:
      "The Neighborhood Opportunity Fund covers commercial and industrial projects on Chicago's South, Southwest, and West Sides. Enter your address into the Chicago Incentive Explorer to see if it falls in an eligible NOF area before you apply.",
    bullets: [
      "NOF reimburses up to $250,000, covering 75% of eligible project costs.",
      "Eligibility is geographic — only properties in qualifying community areas can apply.",
      "Funded by downtown development fees and administered by the Department of Planning and Development.",
      "Applications run through DPD's Submittable portal (English and Spanish).",
    ],
    relatedProgramSlugs: ["neighborhood-opportunity-fund"],
    sources: [
      {
        label: "City of Chicago — Neighborhood Opportunity Fund",
        url: "https://www.chicago.gov/city/en/sites/neighborhood-opportunity-fund/home.html",
      },
    ],
  },
  {
    slug: "what-grants-help-renovate-a-storefront-in-chicago",
    question: "What grants help renovate a storefront in Chicago?",
    title: "Grants to Renovate a Storefront in Chicago",
    description:
      "SBIF, NOF, and the Commercial Corridor Storefront Activation program all reimburse Chicago storefront renovations. See which apply to your address in a free snapshot.",
    answer:
      "Chicago storefront renovations are commonly funded by SBIF (TIF-based reimbursement), the Neighborhood Opportunity Fund, and the Commercial Corridor Storefront Activation (CCSA) program. Which one fits depends on your address, building type, and corridor — check your location first.",
    bullets: [
      "SBIF reimburses up to 90% of permanent building improvements in eligible TIF districts.",
      "NOF reimburses 75% of costs (up to $250,000) for commercial projects in qualifying areas.",
      "CCSA offers reimbursable storefront grants plus free technical assistance across 12 corridors.",
      "Most are reimbursement-based — you pay first, then get paid back, so confirm the funding round before you spend.",
    ],
    relatedProgramSlugs: [
      "small-business-improvement-fund",
      "neighborhood-opportunity-fund",
      "commercial-corridor-storefront-activation",
    ],
    sources: [
      {
        label: "SomerCor — SBIF",
        url: "https://somercor.com/sbif/",
      },
      {
        label: "City of Chicago — Commercial Corridor Storefront Activation",
        url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/ccsa.html",
      },
    ],
  },
  {
    slug: "am-i-in-a-chicago-opportunity-zone",
    question: "Am I in a Chicago Opportunity Zone?",
    title: "Am I in a Chicago Opportunity Zone?",
    description:
      "Find out if your Chicago address sits in a federal Opportunity Zone census tract — and what tax benefits investors can claim — in a free location snapshot.",
    answer:
      "Opportunity Zones are designated census tracts where investors can defer and reduce capital gains taxes through a Qualified Opportunity Fund. Enter your address into the Chicago Incentive Explorer to see if it falls inside a designated zone.",
    bullets: [
      "Existing OZ 1.0 tracts remain valid through 12/31/2028; new OZ 2.0 designations take effect 1/1/2027.",
      "Benefits go to investors with capital gains, but business owners can use OZ status to attract that investment.",
      "Investment must flow through a Qualified Opportunity Fund (QOF), not a direct purchase.",
      "Always confirm zone status and tax treatment with a tax advisor — rules changed under the 2025 OBBBA law.",
    ],
    relatedProgramSlugs: ["federal-opportunity-zones", "new-markets-tax-credits"],
    sources: [
      {
        label: "IRS — Opportunity Zones",
        url: "https://www.irs.gov/credits-deductions/businesses/opportunity-zones",
      },
    ],
  },
  {
    slug: "what-is-an-enterprise-zone-in-chicago",
    question: "What is an Enterprise Zone in Chicago?",
    title: "What Is an Enterprise Zone in Chicago?",
    description:
      "Illinois Enterprise Zones give Chicago businesses sales tax exemptions on building materials and other tax breaks. See if your address is in one of the six zones.",
    answer:
      "An Enterprise Zone is a state-designated area where businesses get tax incentives — most notably a sales tax exemption on building materials and a utility tax exemption. Chicago has six Enterprise Zones; check your address to see if you're inside one.",
    bullets: [
      "Up to 9.25% combined sales tax exemption on building materials used in your project.",
      "0.5% state investment tax credit plus utility tax exemptions on gas, electric, and telecom.",
      "You must apply to the local Enterprise Zone Administrator and obtain a Building Materials Exemption Certificate (BMEC) before purchasing.",
      "All six Chicago Enterprise Zones (I-VI) are set to expire in 2030.",
    ],
    relatedProgramSlugs: ["enterprise-zones"],
    sources: [
      {
        label: "Illinois DCEO — Enterprise Zone Program",
        url: "https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/enterprisezone.html",
      },
    ],
  },
  {
    slug: "what-cook-county-property-tax-incentives-exist-for-businesses",
    question: "What Cook County property tax incentives exist for businesses?",
    title: "Cook County Property Tax Incentives for Businesses (7a, 7b, 6b)",
    description:
      "Cook County's Class 6b, 7a, 7b, and 8 incentives cut commercial and industrial assessments from 25% to 10% for years. See which fits your project.",
    answer:
      "Cook County offers property tax incentives that lower a property's assessment from 25% to 10% for years. Class 7a covers small commercial projects (under $2M), 7b larger commercial ($2M+), 6b industrial, and Class 8 depressed areas.",
    bullets: [
      "Class 7a: commercial projects under $2M — 10% assessment for 10 years, then 15% and 20%.",
      "Class 7b: commercial projects over $2M in areas needing development, with a 'but-for' finding.",
      "Class 6b: industrial new construction, rehab, or reoccupancy of abandoned buildings.",
      "All require a municipal resolution of support and a filing with the Cook County Assessor before construction.",
    ],
    relatedProgramSlugs: [
      "cook-county-class-7a-property-tax-incentive",
      "cook-county-class-7b-commercial-property-tax-incentive",
      "cook-county-class-6b-industrial-property-tax-incentive",
    ],
    sources: [
      {
        label: "Cook County Assessor — Incentives & Special Properties",
        url: "https://www.cookcountyassessoril.gov/incentives-special-properties",
      },
    ],
  },
  {
    slug: "what-incentives-help-a-manufacturer-in-chicago",
    question: "What incentives help a manufacturer in Chicago?",
    title: "Incentives for Manufacturers in Chicago",
    description:
      "Chicago manufacturers can tap Class 6b property tax relief, Industrial Corridor protections, Enterprise Zone material exemptions, and state EDGE credits. See what fits your site.",
    answer:
      "Chicago manufacturers most often use Cook County Class 6b property tax relief, Industrial Corridor zoning protections, Enterprise Zone sales tax exemptions on materials, and state EDGE job-creation credits. The right mix depends on your site and investment — check your address.",
    bullets: [
      "Class 6b cuts industrial assessments from 25% to 10% for a renewable 12-year period.",
      "Industrial Corridors protect manufacturing sites from residential conversion and prioritize infrastructure.",
      "Enterprise Zones exempt building materials and machinery purchases from sales tax.",
      "EDGE credits reward job creation against state withholding for qualifying expansions.",
    ],
    relatedProgramSlugs: [
      "cook-county-class-6b-industrial-property-tax-incentive",
      "industrial-corridor-protections",
      "enterprise-zones",
      "edge-tax-credit",
    ],
    sources: [
      {
        label: "Cook County Assessor — Incentives & Special Properties",
        url: "https://www.cookcountyassessoril.gov/incentives-special-properties",
      },
      {
        label: "City of Chicago — Industrial Corridors",
        url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/industrial-corridors.html",
      },
    ],
  },
  {
    slug: "are-there-grants-to-hire-employees-in-chicago",
    question: "Are there grants to hire employees in Chicago?",
    title: "Grants and Credits to Hire Employees in Chicago",
    description:
      "Chicago hiring support can include state EDGE credits, the Cook County Catalyst Grant, and the federal WOTC. Compare the published requirements for your hiring plan.",
    answer:
      "Hiring support is usually a tax credit, not a grant. Illinois EDGE credits reward job creation against state withholding, the federal Work Opportunity Tax Credit rewards hiring from target groups, and Cook County's Catalyst Grant can fund new-hire salaries.",
    bullets: [
      "EDGE provides 50% of state withholding for new jobs (25% for retained), up to 10 years.",
      "The Catalyst Grant (up to $100,000) can cover salaries and recruitment for growing Cook County firms.",
      "WOTC offered up to $9,600 per qualifying hire — but its authority lapsed 1/1/2026; keep filing Form 8850 to preserve retroactive eligibility.",
      "Most hiring incentives require documenting jobs created or retained.",
    ],
    relatedProgramSlugs: ["edge-tax-credit", "cook-county-catalyst-grant"],
    sources: [
      {
        label: "Illinois DCEO — EDGE Tax Credit",
        url: "https://dceo.illinois.gov/expandrelocate/incentives/edge.html",
      },
      {
        label: "U.S. DOL — Work Opportunity Tax Credit",
        url: "https://www.dol.gov/agencies/eta/wotc",
      },
    ],
  },
  {
    slug: "what-is-the-neighborhood-opportunity-fund",
    question: "What is the Neighborhood Opportunity Fund?",
    title: "What Is the Neighborhood Opportunity Fund (NOF)?",
    description:
      "The Neighborhood Opportunity Fund reimburses commercial and industrial projects in underinvested Chicago neighborhoods. Learn how it works and check your address.",
    answer:
      "The Neighborhood Opportunity Fund (NOF) is a City of Chicago grant that reimburses commercial and industrial projects in underinvested South, Southwest, and West Side neighborhoods. It's funded by downtown development fees and reimburses up to $250,000, covering 75% of eligible costs.",
    bullets: [
      "Covers construction, renovation, and equipment for community-serving projects.",
      "An additional technical-assistance bonus (up to $50,000) is available with an approved TA provider.",
      "Eligibility is geographic — your project must sit in a qualifying community area.",
      "Administered by the Department of Planning and Development with rolling, quarterly-evaluated applications.",
    ],
    relatedProgramSlugs: ["neighborhood-opportunity-fund"],
    sources: [
      {
        label: "City of Chicago — Neighborhood Opportunity Fund",
        url: "https://www.chicago.gov/city/en/sites/neighborhood-opportunity-fund/home.html",
      },
    ],
  },
  {
    slug: "what-is-a-special-service-area",
    question: "What is a Special Service Area (SSA)?",
    title: "What Is a Special Service Area (SSA) in Chicago?",
    description:
      "Chicago's Special Service Areas fund enhanced corridor services — streetscaping, marketing, security — through a local self-tax. See if your business is in one.",
    answer:
      "A Special Service Area (SSA) is a defined commercial district where properties pay a small extra tax to fund enhanced local services like streetscaping, marketing, security, and facade help. Chicago has 58 active SSAs, each run by a local delegate agency.",
    bullets: [
      "Benefits are automatic by location — no application is needed to receive the core services.",
      "Each SSA is managed by a delegate agency (a chamber, EDO, or nonprofit) that may run sub-grants.",
      "Common services: streetscaping, business marketing, public safety, and facade improvement assistance.",
      "Find your corridor's delegate agency on the City's SSA Provider List.",
    ],
    relatedProgramSlugs: ["special-service-area"],
    sources: [
      {
        label: "City of Chicago — Special Service Areas & Provider List",
        url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/special_service_areasandproviderlist.html",
      },
    ],
  },
  {
    slug: "what-is-an-industrial-corridor-in-chicago",
    question: "What is an Industrial Corridor in Chicago?",
    title: "What Is an Industrial Corridor in Chicago?",
    description:
      "Chicago's Industrial Corridors preserve land for manufacturing and logistics through zoning protections. See if your site sits inside one in a free snapshot.",
    answer:
      "An Industrial Corridor is a city-designated area reserved for manufacturing, logistics, and industrial uses. Zoning protections prevent conversion to residential, shield industrial businesses from displacement, and prioritize the corridor for infrastructure investment.",
    bullets: [
      "Protects industrial sites from residential rezoning and rising land costs.",
      "Corridors get priority for infrastructure and proximity to freight and transit networks.",
      "Industrial users generally align with M-zoning inside corridor boundaries.",
      "Useful for manufacturers choosing or defending a long-term location.",
    ],
    relatedProgramSlugs: ["industrial-corridor-protections"],
    sources: [
      {
        label: "City of Chicago — Industrial Corridors",
        url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/industrial-corridors.html",
      },
    ],
  },
  {
    slug: "how-do-i-get-a-facade-grant-in-chicago",
    question: "How do I get a facade grant in Chicago?",
    title: "How to Get a Facade Grant in Chicago",
    description:
      "Facade improvements in Chicago are funded through SBIF, the CCSA storefront program, and some SSA sub-grants. See which applies to your address in a free snapshot.",
    answer:
      "Chicago facade improvements are typically funded through SBIF reimbursement grants in TIF districts, the Commercial Corridor Storefront Activation (CCSA) program in select corridors, and some Special Service Area sub-grants. Eligibility depends on your address and building.",
    bullets: [
      "SBIF reimburses up to 90% of eligible facade and building work in qualifying TIF districts.",
      "CCSA offers reimbursable storefront grants plus free technical assistance in 12 corridors.",
      "Your SSA delegate agency may run a separate facade rebate — ask them directly.",
      "These are reimbursement programs: get approval and contractor bids before starting work.",
    ],
    relatedProgramSlugs: [
      "small-business-improvement-fund",
      "commercial-corridor-storefront-activation",
      "special-service-area",
    ],
    sources: [
      {
        label: "SomerCor — SBIF",
        url: "https://somercor.com/sbif/",
      },
      {
        label: "City of Chicago — Commercial Corridor Storefront Activation",
        url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/ccsa.html",
      },
    ],
  },
  {
    slug: "what-is-the-new-markets-tax-credit",
    question: "What is the New Markets Tax Credit?",
    title: "What Is the New Markets Tax Credit (NMTC)?",
    description:
      "The New Markets Tax Credit funds large projects in low-income census tracts through certified CDEs. Learn how it works and check your address eligibility.",
    answer:
      "The New Markets Tax Credit (NMTC) attracts private investment into low-income communities by giving investors a 39% federal tax credit over seven years on equity invested through a certified Community Development Entity (CDE). It typically backs larger projects of $5M or more.",
    bullets: [
      "39% credit is claimed over 7 years (5% in years 1-3, 6% in years 4-7).",
      "Investment must flow through a certified CDE, not directly to the business.",
      "The project must sit in an NMTC-eligible low-income census tract — check your address.",
      "Can combine with historic and Opportunity Zone credits; the program was made permanent in 2025.",
    ],
    relatedProgramSlugs: ["new-markets-tax-credits", "federal-opportunity-zones"],
    sources: [
      {
        label: "CDFI Fund — New Markets Tax Credit Program",
        url: "https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit",
      },
    ],
  },
  {
    slug: "what-is-a-qualified-census-tract",
    question: "What is a Qualified Census Tract?",
    title: "What Is a Qualified Census Tract (QCT)?",
    description:
      "HUD's Qualified Census Tracts boost Low-Income Housing Tax Credits by 30%. See if your Chicago project site is in a QCT in a free address snapshot.",
    answer:
      "A Qualified Census Tract (QCT) is a HUD-designated area where at least half of households earn below 60% of area median income. Affordable housing projects in a QCT receive a 30% boost to their Low-Income Housing Tax Credit basis.",
    bullets: [
      "QCT status raises the LIHTC eligible basis to 130% — meaning more tax credits per project.",
      "It mainly benefits developers building or substantially rehabbing affordable rental housing.",
      "HUD updates QCT designations every January 1, so confirm current status.",
      "LIHTC allocations in Illinois are awarded through the Illinois Housing Development Authority (IHDA).",
    ],
    relatedProgramSlugs: ["qualified-census-tract-qct-lihtc-boost"],
    sources: [
      {
        label: "HUD User — Qualified Census Tracts",
        url: "https://www.huduser.gov/portal/datasets/qct.html",
      },
    ],
  },
  {
    slug: "is-my-address-in-a-hubzone",
    question: "Is my address in a HUBZone?",
    title: "Is My Address in an SBA HUBZone?",
    description:
      "SBA HUBZone certification gives small businesses an edge on federal contracts. Check whether your Chicago address sits in a HUBZone in a free snapshot.",
    answer:
      "A HUBZone is an SBA-designated Historically Underutilized Business Zone where certified small businesses get set-aside federal contracts and a 10% price preference. Many South and West Side Chicago corridors qualify — check your address to confirm.",
    bullets: [
      "Your principal office must be in a HUBZone and 35% of employees must live in one.",
      "Certified firms can compete for HUBZone set-aside federal contracts.",
      "You also receive a 10% price evaluation preference in full and open bidding.",
      "HUBZone maps update periodically, so verify current status on the SBA map before certifying.",
    ],
    relatedProgramSlugs: ["sba-hubzone-program"],
    sources: [
      {
        label: "SBA — HUBZone Program",
        url: "https://www.sba.gov/federal-contracting/contracting-assistance-programs/hubzone-program",
      },
    ],
  },
  {
    slug: "what-clean-energy-incentives-can-a-chicago-building-use",
    question: "What clean energy incentives can a Chicago building use?",
    title: "Clean Energy Incentives for Chicago Buildings",
    description:
      "Chicago buildings can use C-PACE financing, IRA clean electricity credits, the §179D deduction, and ComEd rebates for energy upgrades. See what applies.",
    answer:
      "Chicago buildings can combine C-PACE financing for energy upgrades, federal IRA clean electricity credits (a 30% base ITC plus bonuses) for solar and storage, the §179D deduction for efficiency, and utility rebates. The right stack depends on the project.",
    bullets: [
      "C-PACE provides up to 100% upfront financing repaid through the property tax bill.",
      "IRA §48E/§45Y credits cover solar and storage, with +10% energy community and +10-20% low-income bonuses.",
      "§179D gives up to $5.94/sq ft for efficient HVAC, lighting, and envelope work — but sunsets for construction after 6/30/2026.",
      "Tax-exempt owners can monetize credits as a cash refund through elective (direct) pay.",
    ],
    relatedProgramSlugs: [
      "cook-county-c-pace",
      "ira-clean-electricity-credits-48e-45y-low-income-communities-bonus",
      "179d-energy-efficient-commercial-buildings-deduction",
    ],
    sources: [
      {
        label: "Cook County — Clean Energy (C-PACE) Program",
        url: "https://www.cookcountyil.gov/service/clean-energy-cpace-program",
      },
      {
        label: "IRS — Clean Electricity Low-Income Communities Bonus",
        url: "https://www.irs.gov/credits-deductions/clean-electricity-low-income-communities-bonus-credit-amount-program",
      },
    ],
  },
  {
    slug: "what-incentives-help-open-a-restaurant-in-chicago",
    question: "What incentives help open a restaurant in Chicago?",
    title: "Incentives to Help Open a Restaurant in Chicago",
    description:
      "Opening a Chicago restaurant? SBIF, NOF, and CCSA can reimburse build-out, while free advising helps with planning. See what applies to your address.",
    answer:
      "A new Chicago restaurant can tap reimbursement grants for build-out — SBIF in TIF districts, the Neighborhood Opportunity Fund, and the CCSA storefront program — plus free advising from Cook County Small Business Source. Eligibility depends on your address and corridor.",
    bullets: [
      "SBIF reimburses up to 90% of permanent improvements like kitchens, HVAC, and facades in eligible TIF areas.",
      "NOF reimburses 75% of costs (up to $250,000) for community-serving commercial projects.",
      "CCSA offers reimbursable storefront grants plus free technical assistance in 12 corridors.",
      "Cook County Small Business Source provides free one-on-one advising on plans, permits, and financing.",
    ],
    relatedProgramSlugs: [
      "small-business-improvement-fund",
      "neighborhood-opportunity-fund",
      "commercial-corridor-storefront-activation",
      "cook-county-small-business-source",
    ],
    sources: [
      {
        label: "SomerCor — SBIF",
        url: "https://somercor.com/sbif/",
      },
      {
        label: "Cook County Small Business Source",
        url: "https://cookcountysmallbiz.org/",
      },
    ],
  },
  {
    slug: "what-is-c-pace-financing-in-cook-county",
    question: "What is C-PACE financing in Cook County?",
    title: "What Is C-PACE Financing in Cook County?",
    description:
      "Cook County C-PACE provides up to 100% upfront financing for energy and water upgrades, repaid through the property tax bill. Learn how it works.",
    answer:
      "C-PACE (Commercial Property Assessed Clean Energy) lets Cook County commercial owners finance up to 100% of energy efficiency, renewable energy, and water conservation upgrades with private capital, repaid over up to 30 years as a line item on the property tax bill.",
    bullets: [
      "No large out-of-pocket cost — financing covers up to 100% of the project.",
      "Repayment terms run up to 30 years, matching the useful life of the improvements.",
      "Eligible: office, retail, industrial, multi-family (5+ units), hotels, and nonprofits.",
      "Covers HVAC, lighting, solar, insulation, and water systems.",
    ],
    relatedProgramSlugs: ["cook-county-c-pace"],
    sources: [
      {
        label: "Cook County — Clean Energy (C-PACE) Program",
        url: "https://www.cookcountyil.gov/service/clean-energy-cpace-program",
      },
    ],
  },
  {
    slug: "how-do-incentives-stack-in-chicago",
    question: "How do incentives stack in Chicago?",
    title: "How Do Incentives Stack in Chicago?",
    description:
      "A single Chicago address can sit in overlapping zones — TIF, Opportunity Zone, Enterprise Zone — letting programs combine. Learn how stacking works.",
    answer:
      "Incentives stack because zones overlap: one Chicago address can sit in a TIF district, an Opportunity Zone, and an Enterprise Zone at once. Programs at different government levels — city, county, state, federal — can often be combined on the same project.",
    bullets: [
      "Zones are the eligibility gate; programs are the actual benefits you apply for.",
      "Example: SBIF (city/TIF) can pair with Class 7a property tax relief (county) and an Enterprise Zone material exemption (state).",
      "Federal credits like NMTC, historic, and Opportunity Zone are designed to combine with each other.",
      "Stacking rules and caps vary — confirm with each administering agency before assuming two programs combine.",
    ],
    relatedProgramSlugs: [
      "tif-districts",
      "federal-opportunity-zones",
      "enterprise-zones",
    ],
    sources: [
      {
        label: "City of Chicago — Tax Increment Financing",
        url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
      },
    ],
  },
  {
    slug: "what-help-is-available-for-a-vacant-commercial-property-in-chicago",
    question: "What help is available for a vacant commercial property in Chicago?",
    title: "Help for a Vacant Commercial Property in Chicago",
    description:
      "Class 7a/7b reoccupancy incentives, NOF, CCSA, or Land Bank acquisition can be relevant to vacant Chicago commercial property. Review what is mapped at the address, then confirm each program's requirements.",
    answer:
      "Vacant Chicago commercial property can tap several tools: Cook County Class 7a/7b incentives reward reoccupancy of abandoned buildings, the CCSA program funds storefront activation, NOF reimburses renovation, and the Cook County Land Bank can clear title on distressed parcels.",
    bullets: [
      "Class 7a/7b cut assessments from 25% to 10% for projects that reoccupy abandoned commercial buildings.",
      "CCSA specifically targets vacant and existing storefronts with reimbursable capital grants.",
      "NOF reimburses up to 75% of renovation costs in qualifying neighborhoods.",
      "The Cook County Land Bank acquires and clears back taxes on vacant and tax-delinquent properties.",
    ],
    relatedProgramSlugs: [
      "cook-county-class-7a-property-tax-incentive",
      "commercial-corridor-storefront-activation",
      "neighborhood-opportunity-fund",
      "cook-county-land-bank-authority",
    ],
    sources: [
      {
        label: "Cook County Assessor — Incentives & Special Properties",
        url: "https://www.cookcountyassessoril.gov/incentives-special-properties",
      },
      {
        label: "Cook County Land Bank Authority",
        url: "https://www.cookcountylandbank.org/",
      },
    ],
  },
  {
    slug: "where-can-a-chicago-small-business-get-free-advising",
    question: "Where can a Chicago small business get free advising?",
    title: "Where Can a Chicago Small Business Get Free Advising?",
    description:
      "Cook County Small Business Source offers free one-on-one advising to any Cook County business — no cost, no eligibility hurdles. Learn how to get matched.",
    answer:
      "Any Cook County small business can get free one-on-one advising through Cook County Small Business Source, which connects you with a Business Support Organization. There's no cost and no revenue or industry requirement — just request an advisor online.",
    bullets: [
      "Free help with business plans, accessing customers, and grant or loan applications.",
      "Delivered through 13 Business Support Organizations plus 30+ referral partners.",
      "No application fee and no eligibility requirements beyond being in Cook County.",
      "Also offers government contracting readiness assessments.",
    ],
    relatedProgramSlugs: ["cook-county-small-business-source"],
    sources: [
      {
        label: "Cook County Small Business Source",
        url: "https://cookcountysmallbiz.org/",
      },
    ],
  },
];

export function getAnswerBySlug(slug: string): AnswerPage | undefined {
  return ANSWER_PAGES.find((a) => a.slug === slug);
}

export function allAnswerSlugs(): string[] {
  return ANSWER_PAGES.map((a) => a.slug);
}
