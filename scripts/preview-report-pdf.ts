/**
 * scripts/preview-report-pdf.ts
 *
 * Visual-iteration tool for the five-page "action report" PDF (lib/pdf-report.ts).
 * Builds a realistic, Near-North-Side-like GeneratedReport fixture — mirroring
 * the object-literal style used in lib/__tests__/pdf-section-order.test.ts and
 * lib/__tests__/report-engine.test.ts — and renders it through the exact same
 * builder the live app uses (generateReportPdfBase64), so what you read here is
 * what a real user would download.
 *
 * The fixture intentionally stress-tests layout edge cases the target design
 * spec calls out: a long program title, a long deadline label paired with a
 * long date-framing value, run-on contact detail strings, "≤ / ≥" glyphs that
 * jsPDF's standard fonts can't render, and required-document names that must
 * survive grouping/deduping into the Priority Documents section.
 *
 * Run:  npx tsx scripts/preview-report-pdf.ts
 * Or:   npm run report:preview
 *
 * Output: output/pdf/vision-preview.pdf (gitignored; regenerate anytime).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateReportPdfBase64 } from "@/lib/pdf-report";
import { CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import { CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";

const report: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "Chicago Incentive Explorer report",
  reportType: "site-incentives",
  generatedAt: "2026-07-16T12:00:00.000Z",
  summary:
    "Your address at 1200 N State Pkwy, Chicago, IL falls within 1 incentive zone, matching 1 address-confirmed program. 8 additional programs appear as discovery next steps. Start with the recommended actions, then use the later sections to prepare and verify.",
  sections: [
    // §1 Address-linked (confirmed) — 1 item, long title stress test
    {
      title: CONFIRMED_PROGRAMS_SECTION_TITLE,
      description:
        "Programs connected to this address through mapped incentive-zone boundaries. Confirm the applicable requirements for each program.",
      items: [
        {
          label:
            "IRA Energy Community Tax Credit Bonus for Clean Energy Manufacturing and Advanced Grid Modernization Projects Located in a Designated Energy Community",
          value: "+10 points on ITC / +10% PTC",
          detail:
            "Clean energy projects located in a designated energy community can earn a 10 percentage point bonus on the federal Investment Tax Credit or a 10% increase to the Production Tax Credit under the Inflation Reduction Act.",
          programId: "iraEnergyCommunity",
          url: "https://energycommunities.gov/energy-community-tax-credit-bonus",
          sourceUrl: "https://energycommunities.gov/energy-community-tax-credit-bonus",
        },
      ],
    },
    // §2 Explore — 8 items, values with defect-8 style clamp cases
    {
      title: "Additional Programs to Explore",
      description:
        "Programs not confirmed by this address alone, including Cook County tools that may apply countywide but still need project, property, and administrator review.",
      items: [
        {
          label: "Cook County Class 7a Property Tax Incentive",
          value: "10% assessment (vs. 25%) for 10 years",
          detail:
            "Cook County reduces property tax assessments for small commercial projects to encourage new construction, substantial rehabilitation, or reoccupancy of abandoned commercial buildings.",
        },
        {
          label: "Cook County Class 7b Commercial Property Tax Incentive",
          value: "10% assessment (vs. 25%) for 10 years, then 15% / 20%",
          detail:
            "Same 12-year reduced assessment as 7a but for commercial projects with total costs over $2 million, in areas in need of commercial development.",
        },
        {
          label: "Cook County Class 6b Industrial Property Tax Incentive",
          value: "10% assessment (vs. 25%) for 10 years, then 15% / 20%",
          detail:
            "Cook County reduces the assessed value of qualifying industrial property for 12 years to encourage new construction, substantial rehabilitation, or reoccupancy.",
        },
        {
          label: "Cook County Land Bank Authority",
          value: "Below-market property acquisition + Reclaiming Chicago pipeline",
          detail: "The CCLBA acquires and returns vacant, abandoned, and tax-delinquent properties to productive use.",
        },
        {
          label: "Cook County Class L Landmark Property Tax Incentive",
          value: "Assessment level frozen for 12 years (≥50% of investment required)",
          detail: "Encourages the preservation of landmark commercial and industrial buildings by reducing the property tax assessment.",
        },
        {
          label: "Illinois Enterprise Zone Investment Tax Credit",
          value: "0.5% credit on qualified property (≤ $5M cap)",
          detail: "A state income tax credit for investment in qualified property placed in service within an Illinois enterprise zone.",
        },
        {
          label: "Cook County Sustainability Fee Rebate",
          value: "Up to 100% rebate for LEED-certified projects",
          detail: "Rebates the county sustainability fee for projects meeting green building certification thresholds.",
        },
        {
          label: "Chicago Small Business Improvement Fund (SBIF)",
          value: "Reimburses up to 90% of eligible façade and interior costs",
          detail: "District-specific matching grant for facade, interior build-out, and code-compliance improvements.",
        },
      ],
    },
    // §3 Upcoming dates — 3 items incl. a long label + long date-framing value
    {
      title: "Upcoming Deadlines Near This Address",
      description: "Dates tied to this address or its matched programs.",
      items: [
        {
          label: "IRA Clean Electricity Credits (§48E) Low-Income Bonus window closes",
          value: "2026-08-07",
          detail: "Construction must begin before this date to qualify for the bonus credit allocation round.",
          programId: "iraCleanElectricity",
        },
        {
          label: "Community Development Grant - Medium application deadline",
          value: "2026-08-14",
          detail: "Medium-tier award round reviewed on a rolling basis until the window closes.",
        },
        {
          label:
            "Community Development Grant - Small (≤ $250K) for Storefront and Facade Improvement Projects in Qualified Corridors application deadline",
          value: "In 30 days — 2026-08-14",
          detail:
            "Small-tier award round for storefront and facade improvement projects located in a qualified commercial corridor.",
        },
      ],
    },
    // §4 Financing resources — 2 items
    {
      title: CAPITAL_PARTNER_SECTION_TITLE,
      description:
        "These organizations describe financing services for certain projects. Contact them directly to ask whether their services may be relevant.",
      items: [
        {
          label: "Allies for Community Business",
          partnerId: "allies",
          value: "Financing resource to explore",
          detail: "Reason: microloans for equipment and working capital.\nPhone: 312-275-3000\nEmail: info@aclf.org",
          url: "https://myalliesforcommunitybusiness.org",
          sourceUrl: "https://myalliesforcommunitybusiness.org",
        },
        {
          label: "Greenwood Archer Capital",
          partnerId: "greenwoodArcher",
          value: "Financing resource to explore",
          detail: "Reason: real estate and business acquisition lending.\nPhone: 312-555-0140",
          url: "https://greenwoodarcher.com",
          sourceUrl: "https://greenwoodarcher.com",
        },
      ],
    },
    // §5 Your Support Network — 5 organizations (index 0 = START HERE hero;
    // run-on contact strings, one org missing a phone, one missing a website).
    {
      title: "Your Support Network",
      description: "Neighborhood-facing organizations that can help business owners turn the report into a clearer next conversation.",
      items: [
        {
          label: "Old Town Merchants & Residents Association",
          value: "Primary local access point",
          detail:
            "Address: 1543 N Wells St, Chicago, IL 60610\nPhone: 312-951-6106\nCan help with: 1:1 consults; licensing; public way permits; technical assistance\nServes: Near North Side\nStatus: Active",
          url: "https://www.oldtownchicago.org",
          sourceUrl: "https://www.oldtownchicago.org",
        },
        {
          label: "The Magnificent Mile Association",
          value: "Secondary local access point",
          detail:
            "Address: 401 N Michigan Ave, Chicago, IL 60611\nPhone: 312-642-3570\nCan help with: Corridor services; local business support; SSA questions\nServes: Near North Side\nStatus: Active",
          url: "https://themagnificentmile.com",
          sourceUrl: "https://themagnificentmile.com",
        },
        {
          label: "River North Residents Association",
          value: "Secondary local access point",
          detail:
            "Can help with: Neighborhood connections; planning and development context\nServes: Near North Side\nStatus: Active",
          url: "https://rivernorthresidents.org",
        },
        {
          label: "Division Street Business Development Association",
          value: "SSA provider",
          detail:
            "Address: 1300 N Division St, Chicago, IL 60622\nPhone: 312-664-6656\nCan help with: Corridor management; beautification; business retention\nServes: Near North Side\nStatus: Active",
          url: "https://divisionstreetchicago.org",
        },
        {
          label: "Oak Street Council",
          value: "SSA provider",
          detail:
            "Phone: 773-575-5822\nCan help with: Corridor management; events; facade and SBIF navigation\nServes: Near North Side\nStatus: Active",
          url: "https://oakstreetchicago.org",
        },
      ],
    },
    // §6 Required documents — 4 categories (≥3 required), with real doc names
    // and program attribution, some categories with several docs to exercise
    // the "+N more" cap.
    {
      title: "Required Documents",
      description: "Documents across address-confirmed and explore programs, organized by category.",
      items: [
        {
          label: "Financial & Tax",
          value: "3 documents",
          detail: [
            "Last 2 years business tax returns — IRA Energy Community Tax Credit Bonus",
            "Profit and loss statement (trailing 12 months) — Cook County Class 7a Property Tax Incentive",
            "Bank statements (last 3 months) — Chicago Small Business Improvement Fund (SBIF)",
          ].join("\n"),
        },
        {
          label: "Business Registration",
          value: "2 documents",
          detail: [
            "Certificate of good standing — Cook County Class 7b Commercial Property Tax Incentive",
            "Business license or registration — Cook County Land Bank Authority",
          ].join("\n"),
        },
        {
          label: "Property & Site",
          value: "4 documents",
          detail: [
            "Proof of ownership or lease — Cook County Class 6b Industrial Property Tax Incentive",
            "Property survey — Cook County Class L Landmark Property Tax Incentive",
            "Site plan drawings — Chicago Small Business Improvement Fund (SBIF)",
            "Parcel identification number (PIN) — Cook County Class 7a Property Tax Incentive",
          ].join("\n"),
        },
        {
          label: "Project Plans",
          value: "1 document",
          detail: ["Scope of work and project budget — IRA Energy Community Tax Credit Bonus"].join("\n"),
        },
      ],
    },
    // §7 Readiness checklist — 8 items, two columns
    {
      title: "Document Readiness Checklist",
      description: "Prepare if available; confirm exact requirements with the program administrator.",
      items: [
        { label: "Project budget", value: "Good to have", detail: "" },
        { label: "Scope of work", value: "Good to have", detail: "" },
        { label: "Contractor bids", value: "Good to have", detail: "" },
        { label: "Proof of ownership or lease", value: "Good to have", detail: "" },
        { label: "Permits / drawings", value: "Good to have", detail: "" },
        { label: "Financial statements", value: "Good to have", detail: "" },
        { label: "Tax clearance", value: "May be needed", detail: "" },
        { label: "W-9", value: "Good to have", detail: "" },
      ],
    },
    // §8 Site overview stats
    {
      title: "Site Overview",
      description: "Zoning and coverage signals at this address.",
      items: [
        { label: "City Zoning Classification", value: "DX-7", detail: "" },
        { label: "Primary Goal", value: "Expand current operations", detail: "" },
        { label: "Mapped Zone Coverage", value: "1 zone", detail: "" },
      ],
    },
    // §9 Neighborhood economic context stats
    {
      title: "Neighborhood Economic Context",
      description: "Census-tract and citywide comparison signals.",
      items: [
        { label: "Median Household Income", value: "Measured (census tract): $164,091", detail: "" },
        { label: "Home Value Context", value: "Measured (census tract): $555,100", detail: "" },
        { label: "Population Base", value: "Measured (census tract): 12,213 residents", detail: "" },
        { label: "Access & Walkability", value: "Measured: 19/20", detail: "" },
        { label: "Incentive Coverage", value: "Measured: 1 zone", detail: "" },
      ],
    },
  ],
  recommendedActions: [
    {
      label: "Confirm fit for IRA Energy Community Tax Credit Bonus",
      description: "Check the site on the official energy communities map, then confirm project fit with a tax advisor.",
      priority: "high",
    },
    {
      label: "Explore Cook County Class 7a Property Tax Incentive",
      description:
        "Cook County reduces property tax assessments for small commercial projects to encourage new construction, substantial rehabilitation, or reoccupancy of abandoned commercial buildings.",
      priority: "medium",
    },
    {
      label: "Book free business advising",
      description: "Schedule a free session with a local business support organization to review all options.",
      priority: "low",
    },
  ],
  metadata: {
    address: "1200 N State Pkwy, Chicago, IL",
    lat: 41.9057,
    lon: -87.6295,
    projectType: "expansion",
    zoneClass: "DX-7",
  },
  dataSources: [
    {
      id: "census",
      label: "U.S. Census Bureau",
      description: "American Community Survey 5-year estimates.",
      url: "https://data.census.gov/",
    },
    {
      id: "dceo",
      label: "City of Chicago & Illinois DCEO",
      description: "Program eligibility and zone boundaries.",
      url: "https://www2.illinois.gov/dceo",
    },
    {
      id: "arcgis",
      label: "Chicago ArcGIS MapServer",
      description: "Zoning and boundary geometries.",
      url: "https://gisapps.chicago.gov/arcgis/rest/services",
    },
    {
      id: "sbrm",
      label: "Chicago Small Business Resource Map",
      description: "Local business support organization directory.",
      url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/small_business_resource_map.html",
    },
  ],
};

function main() {
  const { base64, filename } = generateReportPdfBase64(report);
  const outDir = path.join(process.cwd(), "output", "pdf");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "vision-preview.pdf");
  writeFileSync(outPath, Buffer.from(base64, "base64"));
  console.log(`Wrote ${outPath} (from builder output filename: ${filename})`);
}

main();
