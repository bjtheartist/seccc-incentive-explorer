"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQ_ITEMS = [
  {
    q: "What is a TIF District?",
    a: "A Tax Increment Financing (TIF) district captures growth in property tax revenue within a designated area and reinvests it into local improvements. When property values increase within the TIF district, the extra tax revenue goes toward projects like infrastructure, building rehabilitation, and streetscaping — not into the city's general fund. Over 80% of mapped Chicago businesses are within a TIF district.",
  },
  {
    q: "What is an Opportunity Zone?",
    a: "Opportunity Zones are federally designated low-income census tracts where investors can receive significant tax benefits for investing capital gains. If you invest capital gains through a Qualified Opportunity Fund (QOF) and hold the investment for 10+ years, you can pay zero capital gains tax on the new investment profits. About 49% of mapped Chicago businesses are in an Opportunity Zone.",
  },
  {
    q: "What is the SBIF program?",
    a: "The Small Business Improvement Fund (SBIF) provides grants of up to $150,000 per building for permanent improvements like HVAC, plumbing, electrical, roofing, and fire suppression systems. It's one of the most direct funding sources for small businesses in TIF districts. The program is reimbursement-based — you complete the work, then get paid. You must attend a mandatory orientation session and apply during open enrollment.",
  },
  {
    q: "How do I know if my business qualifies for incentives?",
    a: "Use the lookup tool on our homepage! Enter your business name or address and we'll instantly check which of 11 incentive zones your business falls within. Each result shows the specific programs you qualify for, what they offer, and how to apply.",
  },
  {
    q: "Can I qualify for multiple incentive programs at the same time?",
    a: "Yes! This is called 'incentive stacking' and it's one of the biggest advantages of many Chicago neighborhoods. The average business qualifies for 3-4 programs simultaneously. Some locations qualify for up to 9 overlapping incentives. Each program is applied for separately, and the benefits stack.",
  },
  {
    q: "What is an Enterprise Zone?",
    a: "Illinois Enterprise Zones offer state tax incentives to businesses in economically depressed areas. Benefits include a 6.25% state sales tax exemption on building materials, a 0.5% state investment tax credit, and potential utility tax exemptions. About 46% of mapped Chicago businesses are in an Enterprise Zone.",
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
    a: "The Economic Development for a Growing Economy (EDGE) program provides income tax credits to businesses that create or retain jobs in Illinois. In designated 100% zones across Chicago, businesses can receive tax credits equal to 100% of state income tax withholdings for up to 10 years.",
  },
  {
    q: "What are REV and MICRO zones?",
    a: "REV Illinois (Reimagining Energy and Vehicles) provides tax credits for businesses in the electric vehicle and renewable energy supply chain. MICRO (Manufacturing Illinois Chips for Real Opportunity) supports semiconductor and microchip-related businesses. Both offer bonus incentives in designated 100% zones.",
  },
  {
    q: "How can I get help with my application?",
    a: "Chicago's network of chambers of commerce and business development organizations can help you understand which incentives apply to your specific situation, guide you through application processes, connect you with resources and advisors, and provide ongoing business support. Use our lookup tool to identify your eligible programs, then reach out to the relevant program administrator.",
  },
  {
    q: "What is a Triple Benefit Zone?",
    a: "A Triple Benefit Zone is an area where three or more major incentive programs overlap — typically TIF, Opportunity Zone, and Enterprise Zone. Businesses in these areas can stack the maximum combination of tax benefits, grants, and development incentives. These zones represent the highest-value locations for business incentives in Chicago.",
  },
  {
    q: "Are incentives only for new businesses?",
    a: "No! Many incentive programs benefit existing businesses too. SBIF grants can fund improvements to existing buildings. TIF funding supports rehabilitation of existing properties. Enterprise Zone tax exemptions apply to any qualifying purchases. And hiring incentives in High Unemployment Zones apply whenever you hire.",
  },
  {
    q: "How accurate is this tool?",
    a: "Our tool uses the same geographic zone data published by the City of Chicago and State of Illinois. We use Turf.js point-in-polygon analysis against official zone boundaries to determine which incentive zones apply to any address. While this is highly accurate, we recommend confirming eligibility directly with each program administrator before applying.",
  },
  {
    q: "Where does the data come from?",
    a: "Incentive zone boundaries come from official City of Chicago and State of Illinois KML/GeoJSON data. SBIF project data comes from the City of Chicago open data portal. Census data is sourced from the American Community Survey (ACS 5-Year estimates). All zone boundaries are verified against official sources.",
  },
  {
    q: "What is the difference between an incentive zone and a program?",
    a: "An incentive zone is a geographic designation — a boundary on the map drawn by a government agency. Being inside a zone is the first eligibility gate. A program is the actual benefit (grant, tax credit, financing) that you apply for. Some programs require you to be in a specific zone (e.g., SBIF requires a TIF district). Others, like Cook County's Catalyst Grant, are available county-wide regardless of zone status.",
  },
  {
    q: "What is the Neighborhood Opportunity Fund (NOF)?",
    a: "The NOF provides grants up to $250,000 for small projects and up to $1.5 million for large catalytic projects on Chicago's South, Southwest, and West Sides. Funded by downtown development fees, it targets commercial and industrial projects that create jobs and fill community needs in underinvested neighborhoods.",
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
    a: "The Micro Market Recovery Program targets high-vacancy commercial corridors with storefront improvement grants, technical assistance, and marketing support. It's designed to activate empty storefronts and revitalize neighborhood commercial streets across Chicago.",
  },
  {
    q: "What is the Cook County Class 7a incentive?",
    a: "Class 7a reduces property tax assessments from 25% to 10% for 10 years (then 15% in year 11, 20% in year 12) for qualifying small commercial projects under $2 million. It covers new construction, substantial rehabilitation, or reoccupancy of abandoned commercial buildings in Cook County.",
  },
  {
    q: "What is C-PACE financing?",
    a: "Cook County C-PACE (Commercial Property Assessed Clean Energy) provides up to 100% upfront financing for energy efficiency, renewable energy, and water conservation improvements to commercial buildings. The loan is repaid through your property tax bill over terms up to 30 years, matching the useful life of the improvements. No large out-of-pocket costs required.",
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

        {/* CTA — blue section */}
        <div className="mt-16 border border-[#0C1B33]/10 p-8 bg-[#EFF3FB] text-center">
          <h2 className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/50 mb-3">
            Still have questions?
          </h2>
          <p className="text-sm text-[#0C1B33]/50 mb-6">
            Need help finding incentives for your Chicago business?
          </p>
          <a
            href="tel:7737211999"
            className="inline-flex items-center gap-3 bg-[#0C1B33] text-white px-8 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase hover:bg-[#1E3054] transition-colors"
          >
            Call (773) 721-1999
          </a>
        </div>
      </div>
    </div>
  );
}
