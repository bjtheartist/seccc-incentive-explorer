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
 *   6. PDF section ordering does not error.
 *   7. Availability gating: an expired oneTime fixture is excluded from every
 *      report section (while a non-expired control fixture appears).
 *   8. Availability gating: sbif resolves window-closed (with note) for a
 *      district whose rollout window has passed, and active/next-window for
 *      an in-window or future-window district.
 */

import { generateReportData, loadSbifRollout } from "@/lib/report-engine";
import type { ReportContext } from "@/lib/report-engine";
import { getProgramsSync } from "@/lib/programs-data";
import { orderSectionsForPdf } from "@/lib/pdf-report";
import { resolveAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";

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

  // Check 3: no standalone Corridor Context section exists anymore — corridor
  // signals are merged into Neighborhood Economic Context (and its ownership
  // rows are omitted entirely while county owner data is pending)
  const corridorSection = report.sections.find((s) => s.title === "Corridor Context");
  assert(!corridorSection, "no standalone Corridor Context section (merged into econ context)");

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
    Boolean(
      constructionDeadline?.label?.toLowerCase().includes("wind") ||
      constructionDeadline?.label?.toLowerCase().includes("solar") ||
      constructionDeadline?.label?.toLowerCase().includes("48e")
    ),
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

  // Check 6: PDF section ordering runs without error
  const pdfSections = orderSectionsForPdf(report.sections);
  assert(pdfSections.length >= 1, "PDF ordering returns sections without error");
  console.log(
    `  PDF section order: ${pdfSections.map((s) => s.title).join(" → ")}`
  );

  // Check 7: Availability gating — an expired oneTime fixture never reaches a
  // report section, while an otherwise-identical non-expired control does
  // (guards against the check passing because the fixture wouldn't render anyway).
  const fixtureBase: Program = {
    id: "expiredFixtureGrant",
    name: "Expired Fixture Grant",
    level: "City",
    zoneKey: "tif", // matches ctx.zones.tif → would render if not gated
    summary: "Smoke-test fixture verifying expired one-time programs are hidden.",
    whoQualifies: "Smoke tests only.",
    benefits: [],
    howToApply: [],
    requiredDocs: [],
    contact: "",
    url: "",
    oneTime: true,
    deadlines: [{ label: "Final application round", date: "2026-01-15" }],
  };
  const controlFixture: Program = {
    ...fixtureBase,
    id: "controlFixtureGrant",
    name: "Control Fixture Grant",
    oneTime: false, // past date without oneTime/expiresOn → stays active
  };
  const gatedReport = generateReportData(
    state,
    [...programs, fixtureBase, controlFixture],
    ctx
  );
  const sectionHasProgram = (id: string, name: string) =>
    gatedReport.sections.some((s) =>
      s.items.some((i) => i.programId === id || i.label === name)
    );
  assert(
    !sectionHasProgram("expiredFixtureGrant", "Expired Fixture Grant"),
    "Expired oneTime fixture does not appear in any report section"
  );
  assert(
    sectionHasProgram("controlFixtureGrant", "Control Fixture Grant"),
    "Non-expired control fixture appears in report sections (gate is exclusion, not omission)"
  );

  // Check 8: SBIF availability against the real rollout calendar.
  const rollout = loadSbifRollout();
  assert(Boolean(rollout && rollout.length > 0), "sbif-rollout.json loads with windows");
  const sbifCard = programs.find((p) => p.id === "sbif");
  assert(Boolean(sbifCard), "sbif program card exists");
  const now = new Date();
  const dayDiff = (iso: string) =>
    Math.round((new Date(`${iso}T00:00:00Z`).getTime() - now.getTime()) / 86_400_000);
  const pastWin = rollout!.find((w) => dayDiff(w.windowEnd) < 0);
  const inWin = rollout!.find((w) => dayDiff(w.windowStart) <= 0 && dayDiff(w.windowEnd) >= 0);
  const futureWin = rollout!.find((w) => dayDiff(w.windowStart) > 0);
  let sbifAssertions = 0;
  if (pastWin) {
    const a = resolveAvailability(sbifCard!, now, {
      sbifRollout: rollout,
      tifDistrict: pastWin.tifDistrict,
    });
    assert(
      a.state === "window-closed" && /applications currently closed/i.test(a.note ?? ""),
      `sbif shows window-closed note for past-window district (${pastWin.tifDistrict})`
    );
    sbifAssertions++;
  }
  if (inWin) {
    const a = resolveAvailability(sbifCard!, now, {
      sbifRollout: rollout,
      tifDistrict: inWin.tifDistrict,
    });
    assert(
      a.state === "active" && a.nextWindow?.endDate === inWin.windowEnd,
      `sbif is active with open window for in-window district (${inWin.tifDistrict})`
    );
    sbifAssertions++;
  } else if (futureWin) {
    const a = resolveAvailability(sbifCard!, now, {
      sbifRollout: rollout,
      tifDistrict: futureWin.tifDistrict,
    });
    assert(
      a.state === "window-closed" && a.nextWindow?.date === futureWin.windowStart,
      `sbif shows next-window date for future-window district (${futureWin.tifDistrict})`
    );
    sbifAssertions++;
  }
  assert(sbifAssertions > 0, "At least one SBIF rollout district was assertable");

  console.log("\n✓ All smoke checks passed.");
}

main().catch((e) => {
  console.error("SMOKE TEST ERROR:", e);
  process.exit(1);
});
