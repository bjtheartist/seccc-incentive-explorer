"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
    a: "NMTC is a federal program that provides a 39% tax credit over 7 years to investors who make qualified equity investments through Community Development Entities (CDEs) in low-income census tracts. It's typically used for larger projects ($5M+) and can be combined with Historic Tax Credits and Opportunity Zone benefits.",
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

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen">
      {/* Page Header — soft blue */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/chicago-map-hero.png')" }} />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-3xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Reference
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-white/50 text-base max-w-xl">
            Everything you need to know about business incentives in Chicago.
          </p>
        </div>
      </div>

      {/* Warm off-white body */}
      <div className="container mx-auto max-w-3xl px-6 py-10 bg-[#FAF9F6]">
        <div className="space-y-0">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border-b border-[#0C1B33]/8">
              <button
                className="w-full py-5 text-left flex items-center gap-4 group"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="font-mono-bureau text-[10px] text-[#2563EB]/30 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-sm text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors">
                  {item.q}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#0C1B33]/25 shrink-0 transition-transform ${
                    openIndex === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIndex === i && (
                <div className="pb-5 pl-10 pr-8">
                  <p className="text-sm text-[#0C1B33]/50 leading-relaxed">
                    {item.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA — Still have questions */}
        <div className="mt-16 border border-[#0C1B33]/10 p-6 md:p-10 bg-[#EFF3FB]">
          <div className="text-center mb-8">
            <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33]/90 mb-3">
              Still have questions?
            </h2>
            <p className="text-sm text-[#0C1B33]/50 max-w-md mx-auto">
              Our team at the Southeast Chicago Chamber of Commerce is here to help you navigate incentive programs and find the right fit for your business.
            </p>
          </div>

          <div className="flex justify-center">
            <a
              href="tel:7737211999"
              className="flex flex-col items-center gap-2 bg-[#0C1B33] text-white px-10 py-5 hover:bg-[#1E3054] transition-colors text-center"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase">
                Call Us
              </span>
              <span className="text-[11px] text-white/60">
                (773) 721-1999
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
