/**
 * scripts/smoke-report.ts
 *
 * Smoke test for the integrated report engine.  Invokes generateReportData
 * directly with a static context representing an address inside a TIF district
 * (T-087 Fullerton/Milwaukee — expires 2027-12-31, within 24 months, $63M fund).
 *
 * Run:  npx tsx scripts/smoke-report.ts
 *
 * Checks:
 *   1. Report generates without throwing.
 *   2. "Upcoming Deadlines Near This Address" section is present and has items.
 *   3. "Corridor Context" section is absent (no static file or ctx metric).
 *   4. TIF Financial Context item appears in Neighborhood Economic Context
 *      (since we inject tifFinance via neighborhoodEconomics).
 *   5. programs.json iraCleanElectricity deadlines[] includes 2026-07-04.
 */

import { generateReportData } from "@/lib/report-engine";
import type { ReportContext } from "@/lib/report-engine";
import { getProgramsSync } from "@/lib/programs-data";
import { orderSectionsForPdf } from "@/lib/pdf-report";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  const programs = getProgramsSync();

  // Minimal wizard state for an address near Fullerton/Milwaukee (TIF T-087)
  const state = {
    reportType: "site-incentives" as const,
    address: "2600 N Milwaukee Ave, Chicago, IL",
    lat: 41.9296,
    lon: -87.6974,
    neighborhood: "Logan Square",
    industry: "",
    budgetRange: "",
    projectType: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [] as string[],
    jobsImpact: "",
    supportNeeded: [] as string[],
    creditsToAnalyze: [] as string[],
  };

  // Provide a minimal context that places the address in a TIF and a couple
  // of other zones so the report engine has something to work with.
  const ctx: ReportContext = {
    zones: {
      tif: true,
      federalOZ: false,
      enterprise: false,
      stateIncentiveZones: false,
      ssa: false,
      highUnemployment: true,
      industrialCorridors: false,
      microMarketRecovery: false,
      nof: false,
      ccsa: false,
      nmtcEligible: true,
      qct: true,
      landmarkDistricts: false,
      nrhpDistricts: false,
      energyCommunities: false,
      hubzone: false,
    },
    zoneNames: {
      tif: "T-087",  // normalizeTifKey("T-087") → "T-087"
      highUnemployment: "Logan Square High Unemployment Area",
      nmtcEligible: "NMTC Eligible Census Tract",
      qct: "Qualified Census Tract",
    },
    census: {
      medianIncome: 65000,
      medianHomeValue: 380000,
      population: 4100,
      walkScore: 14,
      tractId: "17031210100",
    },
    neighborhoodEconomics: {
      geographyLabel: "Logan Square (ZIP 60647)",
      // T-087 Fullerton/Milwaukee: expires 2027-12-31, fund $63M
      tifFinance: {
        districtId: "T-087",
        districtName: "Fullerton/Milwaukee",
        reportYear: 2024,
        expirationDate: "2027-12-31",
        expirationYear: 2027,
        fundBalance: 63162041,
        sourceLabel: "City of Chicago TIF Annual Reports",
        sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
        caution: "District-level City annual report data; not proof of funding availability.",
      },
    },
  };

  const report = generateReportData(state, programs, ctx);

  // Check 1: report generated
  assert(Boolean(report), "Report generated without throwing");
  assert(typeof report.title === "string" && report.title.length > 0, "Report has a title");

  // Check 2: Deadlines section present and has items
  const deadlinesSection = report.sections.find(
    (s) => s.title === "Upcoming Deadlines Near This Address"
  );
  assert(Boolean(deadlinesSection), "Deadlines section is present");
  assert((deadlinesSection?.items.length ?? 0) > 0, "Deadlines section has at least one item");
  console.log(
    `  Deadlines items (${deadlinesSection?.items.length}):`,
    deadlinesSection?.items.map((i) => `${i.label} → ${i.value}`).join("; ")
  );

  // Check 2b: TIF expiration alert in deadlines (T-021 expires 2027 = within 24 months)
  const tifExpiryItem = deadlinesSection?.items.find(
    (i) => i.label?.toLowerCase().includes("tif district expiration")
  );
  assert(Boolean(tifExpiryItem), "TIF expiration alert is in deadlines section");
  assert(
    tifExpiryItem?.detail?.toLowerCase().includes("act soon") ?? false,
    "TIF expiration alert contains 'act soon' note"
  );

  // Check 3: Corridor Context section is absent (no corridor-metrics.json or ctx metric)
  const corridorSection = report.sections.find((s) => s.title === "Corridor Context");
  assert(!corridorSection, "Corridor Context section is absent when no metrics available");

  // Check 4: TIF financial context appears in Neighborhood Economic Context
  const econSection = report.sections.find((s) => s.title === "Neighborhood Economic Context");
  assert(Boolean(econSection), "Neighborhood Economic Context section is present");
  const tifItem = econSection?.items.find(
    (i) => i.label?.toLowerCase().includes("tif") && i.label?.toLowerCase().includes("district")
  );
  assert(Boolean(tifItem), "TIF District Funding Overview item appears in Neighborhood Economic Context");

  // Check 5: iraCleanElectricity has 2026-07-04 in deadlines[]
  const ira = programs.find((p) => p.id === "iraCleanElectricity");
  assert(Boolean(ira), "iraCleanElectricity program exists");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iraDeadlines: Array<{ label: string; date: string }> = (ira as any).deadlines ?? [];
  const constructionDeadline = iraDeadlines.find((d) => d.date === "2026-07-04");
  assert(Boolean(constructionDeadline), "iraCleanElectricity has 2026-07-04 construction-start deadline");
  assert(
    constructionDeadline?.label?.toLowerCase().includes("wind") ||
    constructionDeadline?.label?.toLowerCase().includes("solar") ||
    constructionDeadline?.label?.toLowerCase().includes("48e"),
    "Construction-start deadline label references wind/solar/48E"
  );
  // Check sunsetWarning is forward-looking
  assert(
    !(ira?.sunsetWarning?.toLowerCase().includes("has now passed") ?? false),
    "sunsetWarning does not say 'has now passed'"
  );
  assert(
    ira?.sunsetWarning?.toLowerCase().includes("must begin") ?? false,
    "sunsetWarning uses imminent-deadline framing ('must begin')"
  );

  // Check 6: PDF section ordering — Deadlines should appear before Corridor Context
  // (Corridor is absent here, but ordering logic should not error)
  const pdfSections = orderSectionsForPdf(report.sections);
  assert(pdfSections.length >= 1, "PDF ordering returns sections without error");
  console.log(
    `  PDF section order: ${pdfSections.map((s) => s.title).join(" → ")}`
  );

  console.log("\n✓ All smoke checks passed.");
}

main().catch((e) => {
  console.error("SMOKE TEST ERROR:", e);
  process.exit(1);
});
