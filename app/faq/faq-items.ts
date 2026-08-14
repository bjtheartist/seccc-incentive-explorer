/**
 * FAQ content, catalog-derived via programFact (review5 S6). Lives in its
 * own module because Next.js page files may only export Page fields —
 * exporting FAQ_ITEMS from page.tsx fails page-type validation (CI run
 * 31789993586). Tests import from here.
 */
import { programFact, programQualifier } from "@/lib/program-fact";

export const FAQ_ITEMS = [
  {
    q: "What is a TIF District?",
    a: "A Tax Increment Financing (TIF) district captures growth in property tax revenue within a designated area and reinvests it into local improvements. When property values increase within the TIF district, the extra tax revenue can support projects like infrastructure, building rehabilitation, and streetscaping.",
  },
  {
    q: "What is an Opportunity Zone?",
    a: "Opportunity Zones are federally designated low-income census tracts where investors may receive tax benefits for investing eligible capital gains through a Qualified Opportunity Fund (QOF). The exact benefit depends on timing, structure, and current federal rules, so investors should confirm with a tax advisor.",
  },
  {
    q: "What is the SBIF program?",
    a: "The Small Business Improvement Fund (SBIF) provides grants of up to $150,000 per building for permanent improvements like HVAC, plumbing, electrical, roofing, and fire suppression systems. It's one of the most direct funding sources for small businesses in TIF districts. The program is reimbursement-based — you complete the work, then get paid. You must attend a mandatory orientation session and apply during open enrollment.",
  },
  {
    q: "How do I find incentives that may apply to my business?",
    a: "Use the lookup tool on our homepage. Enter your business name or address and we will check mapped incentive layers for likely location-based matches. Each result explains which programs may apply, what they generally offer, and what to verify next.",
  },
  {
    q: "Can I qualify for multiple incentive programs at the same time?",
    // F11 binding replacement copy (build-spec.md 2.4; do not weaken, do not strengthen).
    a: "Overlap shortens the comparison list; it does not show that benefits can be combined. Compare eligible-cost, timing, tax-basis, funding-source, and approval rules for the specific project.",
  },
  {
    q: "What is an Enterprise Zone?",
    a: "Illinois Enterprise Zones offer state tax incentives to encourage investment in designated areas. Benefits can include building-material sales tax exemptions, investment tax credits, and other tax relief, depending on the project and current program rules.",
  },
  {
    q: "What documents do I typically need to apply for incentives?",
    a: "Requirements vary by program, but common documents include: proof of property ownership or lease, business financial statements, a detailed project plan and budget, contractor bids (usually at least 2), building permits, W-9 form, and certificate of insurance. Check each program's specific requirements on our Programs page.",
  },
  {
    q: "What are Special Service Areas (SSAs)?",
    a: "Special Service Areas are localized tax districts across Chicago that fund enhanced services like streetscaping, marketing, safety programs, and business technical assistance. Chicago has dozens of SSAs covering commercial corridors throughout the city. All commercial properties within SSA boundaries automatically benefit from these additional services.",
  },
  {
    q: "What is the EDGE Tax Credit?",
    a: "The Economic Development for a Growing Economy (EDGE) program provides negotiated income tax credits to businesses that create or retain jobs in Illinois. Published criteria provide enhanced consideration for some designated areas, but terms are project-specific.",
  },
  {
    q: "What are REV and MICRO zones?",
    a: "REV Illinois supports electric vehicle, clean energy, and related supply-chain projects. MICRO supports semiconductor and microchip-related businesses. Both are state programs with location and project criteria that should be confirmed with Illinois DCEO.",
  },
  {
    q: "How can I get help with my application?",
    a: "Chicago's network of chambers of commerce and business development organizations can help you understand which incentives apply to your specific situation, guide you through application processes, connect you with resources and advisors, and provide ongoing business support. Use our lookup tool to identify your eligible programs, then reach out to the relevant program administrator.",
  },
  {
    q: "What is a Triple Benefit Zone?",
    a: "A high-overlap incentive area is a location where several major program boundaries intersect, often including TIF, Opportunity Zone, Enterprise Zone, or other place-based layers. These areas can be promising, but the actual value depends on project type, timing, and program rules.",
  },
  {
    q: "Are incentives only for new businesses?",
    // F6 (audit): the closing clause previously asserted hiring incentives
    // in High Unemployment Zones apply "whenever you hire" — WOTC's
    // authorizing statute has lapsed. Derived from the catalog, not
    // hand-authored, so it can't drift again.
    a: `No! Many incentive programs benefit existing businesses too. SBIF grants can fund improvements to existing buildings. TIF funding supports rehabilitation of existing properties. Enterprise Zone tax exemptions apply to any qualifying purchases. ${programQualifier("highUnemployment")}`,
  },
  {
    q: "How accurate is this tool?",
    a: "The tool uses public geographic datasets and spatial analysis to identify likely zone matches for an address. Boundaries, funding rounds, and eligibility rules can change, so we recommend confirming directly with each program administrator before applying.",
  },
  {
    q: "Where does the data come from?",
    a: "The tool draws from public city, county, state, and federal sources, including incentive boundary files, Chicago open data, Cook County property records, and American Community Survey 5-Year estimates. Source availability and formats change over time.",
  },
  {
    q: "What is the difference between an incentive zone and a program?",
    // F3 (audit): "the first eligibility gate" and the prior Catalyst Grant
    // example (now lapsed — F6) removed. Example program name is derived
    // via programFact so it can't silently drift out of sync with the
    // catalog's own status fields the way the hard-coded name did.
    a: `An incentive zone is a geographic designation — a boundary on the map drawn by a government agency. A geocoded point that falls inside a zone is a location signal for the programs that reference that boundary; review the current program source for the boundary's role and any remaining criteria. A program is the actual benefit (grant, tax credit, financing) that you apply for. Some programs require you to be in a specific zone (e.g., SBIF requires a TIF district). Others, like ${programFact("cpace", (p) => p.name)}, are available county-wide regardless of zone status.`,
  },
  {
    q: "What is the Neighborhood Opportunity Fund (NOF)?",
    a: "The NOF provides grant support for qualifying commercial and industrial projects on Chicago's South, Southwest, and West Sides. Award sizes, eligible costs, and application windows vary by funding round, so applicants should verify current guidance with the City.",
  },
  {
    q: "What are New Markets Tax Credits (NMTC)?",
    // review5 S6 (F11): was "...can be combined with Historic Tax Credits and
    // Opportunity Zone benefits" — an unconditional combination claim.
    // Rewritten so overlap with those programs is described as worth
    // comparing, not established as combinable.
    a: "NMTC is a federal program that provides a 39% tax credit over 7 years to investors who make qualified equity investments through Community Development Entities (CDEs) in low-income census tracts. It's typically used for larger projects ($5M+). Historic Tax Credits and Opportunity Zone benefits are worth comparing for the same project, but each has its own separate eligibility, timing, and approval rules to confirm before assuming they combine.",
  },
  {
    q: "What are Qualified Census Tracts (QCTs)?",
    a: "QCTs are HUD-designated census tracts where 50% or more of households earn below 60% of area median income. For developers, the key benefit is a 30% boost to Low-Income Housing Tax Credit (LIHTC) eligible basis, making affordable housing projects more financially viable in these areas.",
  },
  {
    q: "What is the Federal Historic Tax Credit?",
    a: "Properties in National Register Historic Districts qualify for a 20% federal income tax credit on certified rehabilitation costs — with no cap. The rehabilitation must follow the Secretary of the Interior's Standards, and the building must be income-producing (commercial, rental, industrial). This is one of the most valuable credits available for historic building projects.",
  },
  {
    q: "What are Industrial Corridors and why do they matter?",
    a: "Chicago's Industrial Corridor system preserves designated areas for manufacturing, logistics, and industrial uses through zoning protections. This prevents residential conversion and protects existing businesses from displacement. If you're a manufacturer or logistics company, locating in a corridor gives you zoning certainty and access to infrastructure priorities.",
  },
  {
    q: "What is the Micro Market Recovery Program?",
    // F6 (audit): MMRP was migrated to the Department of Housing and
    // renamed CNRP — a homeownership down-payment program, not the
    // storefront-improvement grant this answer previously described.
    // Derived from the catalog so this can't drift again.
    a: `The program formerly known as the Micro Market Recovery Program is now the ${programFact("microMarketRecovery", (p) => p.name)}, a homeownership program administered by the Department of Housing (${programFact("microMarketRecovery", (p) => p.benefit.summary)}). ${programQualifier("microMarketRecovery")}`,
  },
  {
    q: "What is the Cook County Class 7a incentive?",
    a: "Class 7a can reduce the assessment level for qualifying small commercial projects in Cook County. It may apply to new construction, substantial rehabilitation, or reoccupancy of eligible commercial buildings, subject to county approval and current ordinance requirements.",
  },
  {
    q: "What is C-PACE financing?",
    a: "Cook County C-PACE (Commercial Property Assessed Clean Energy) can provide long-term financing for eligible energy efficiency, renewable energy, and water conservation improvements to commercial buildings. Terms depend on the property, project scope, and participating lender.",
  },
];
