import { describe, expect, it } from "vitest";
import { generateReportData } from "../report-engine";
import type { Program } from "../types";

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "tif",
    name: "TIF Program",
    level: "City",
    zoneKey: "tif",
    summary: "A test program",
    whoQualifies: "Businesses in the matching zone",
    benefits: ["Grant"],
    howToApply: ["Confirm program fit", "Open the official source"],
    requiredDocs: ["Project budget"],
    contact: "test@example.com",
    url: "https://example.com/program",
    contacts: [
      {
        agency: "Test Agency",
        abbreviation: "TA",
        phone: "312-555-0000",
      },
    ],
    eligibilityRules: [
      {
        criterion: "location",
        description: "Must be in a TIF district",
        verifiedBy: "location",
        required: true,
      },
    ],
    lastVerifiedAt: new Date().toISOString(),
    benefitRange: "$10K-$50K",
    fastestConfirmingStep: "Call the program administrator",
    ...overrides,
  };
}

const zones = { tif: true, sbif: false, federalOZ: false };
const zoneNames = { tif: "Test TIF" };
type ReportState = Parameters<typeof generateReportData>[0];

function makeState(overrides: Partial<ReportState> = {}): ReportState {
  return {
    reportType: "site-incentives",
    address: "100 E Test St",
    lat: 41.8,
    lon: -87.6,
    neighborhood: "",
    industry: "",
    budgetRange: "",
    projectType: "",
    proposedUse: "",
    fundingCommitted: "",
    remainingGap: "",
    timeline: "",
    siteControl: "",
    documentsAvailable: [],
    jobsImpact: "",
    supportNeeded: [],
    creditsToAnalyze: [],
    ...overrides,
  };
}

describe("generateReportData", () => {
  it("attaches executive summaries to current site-incentives reports", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.reportType).toBe("site-incentives");
    expect(report.executiveSummary).toBeDefined();
    expect(report.executiveSummary?.zoneCount).toBe(1);
    expect(report.executiveSummary?.topPrograms.map((p) => p.programId)).toContain("tif");
  });

  it("attaches executive summaries to current dev-feasibility reports", () => {
    const report = generateReportData(
      makeState({
        reportType: "dev-feasibility",
        projectType: "rehab",
      }),
      [makeProgram()],
      { zones, zoneNames },
    );

    expect(report.reportType).toBe("dev-feasibility");
    expect(report.executiveSummary).toBeDefined();
    expect(report.executiveSummary?.zoneCount).toBe(1);
  });

  it("keeps no-zone programs out of address-confirmed eligibility claims", () => {
    const globalProgram = makeProgram({
      id: "global",
      name: "Global Program",
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    });

    const report = generateReportData(
      makeState(),
      [globalProgram],
      { zones: {}, zoneNames: {} },
    );

    expect(report.summary).toContain("matching 0 address-confirmed programs");
    expect(report.executiveSummary?.topPrograms).toEqual([]);
    expect(report.sections.find((s) => s.title === "Eligible Incentive Programs")).toBeUndefined();
    expect(report.sections.find((s) => s.title === "Additional Programs to Explore")?.items[0].programId).toBe("global");
  });

  it("prioritizes Cook County discovery programs without treating them as address-confirmed", () => {
    const federalPrograms = Array.from({ length: 9 }, (_, index) => makeProgram({
      id: `federal-${index}`,
      name: `A Federal Discovery ${index}`,
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    }));
    const countyProgram = makeProgram({
      id: "smallBizSource",
      name: "Cook County Small Business Source",
      level: "County",
      zoneKey: "",
      eligibilityRules: [
        {
          criterion: "location",
          description: "Business in Cook County",
          verifiedBy: "manual",
          required: true,
        },
      ],
    });
    const suburbanOnlyCountyProgram = makeProgram({
      id: "cookBrownfield",
      name: "Cook County Brownfield Redevelopment Assistance",
      level: "County",
      zoneKey: "",
      eligibilityRules: [],
    });

    const report = generateReportData(
      makeState(),
      [...federalPrograms, countyProgram, suburbanOnlyCountyProgram],
      { zones: {}, zoneNames: {} },
    );

    const additionalSection = report.sections.find((s) => s.title === "Additional Programs to Explore");
    expect(report.summary).toContain("matching 0 address-confirmed programs");
    expect(report.sections.find((s) => s.title === "Eligible Incentive Programs")).toBeUndefined();
    expect(additionalSection?.description).toContain("Cook County tools");
    expect(additionalSection?.items[0].programId).toBe("smallBizSource");
    expect(additionalSection?.items.map((item) => item.programId)).not.toContain("cookBrownfield");
  });

  it("prioritizes Cook County discovery programs in dev-feasibility reports", () => {
    const federalPrograms = Array.from({ length: 9 }, (_, index) => makeProgram({
      id: `federal-dev-${index}`,
      name: `A Federal Dev Discovery ${index}`,
      level: "Federal",
      zoneKey: "",
      eligibilityRules: [],
    }));
    const countyProgram = makeProgram({
      id: "cpace",
      name: "Cook County C-PACE (Clean Energy Financing)",
      level: "County",
      zoneKey: "",
      eligibilityRules: [
        {
          criterion: "location",
          description: "Commercial property in Cook County",
          verifiedBy: "manual",
          required: true,
        },
      ],
    });

    const report = generateReportData(
      makeState({
        reportType: "dev-feasibility",
        projectType: "rehab",
      }),
      [...federalPrograms, countyProgram],
      { zones: {}, zoneNames: {} },
    );

    const additionalSection = report.sections.find((s) => s.title === "Additional Programs to Explore");
    expect(additionalSection?.description).toContain("Cook County tools");
    expect(additionalSection?.items[0].programId).toBe("cpace");
  });

  it("propagates Phase 1 provenance fields onto report items", () => {
    const applicationPortals = [
      {
        type: "submittable" as const,
        label: "Apply on Submittable",
        url: "https://example.com/apply",
      },
    ];
    const verificationSteps = [
      {
        label: "Confirm certification",
        agency: "Test Agency",
        url: "https://example.com/verify",
        kind: "certification" as const,
      },
    ];
    const program = makeProgram({
      sourceUrl: "https://example.com/source",
      applicationPortals,
      verificationSteps,
    });

    const report = generateReportData(
      makeState(),
      [program],
      { zones, zoneNames },
    );

    const item = report.sections
      .find((s) => s.title === "Eligible Incentive Programs")
      ?.items.find((i) => i.programId === "tif");

    expect(item?.sourceUrl).toBe(program.sourceUrl);
    expect(item?.applicationPortals).toEqual(applicationPortals);
    expect(item?.verificationSteps).toEqual(verificationSteps);
  });

  it("estimates benefits only for address-confirmed programs using current assumptions", () => {
    const report = generateReportData(
      makeState({
        budgetRange: "500k-2m",
      }),
      [
        makeProgram({ id: "tif", zoneKey: "tif" }),
        makeProgram({ id: "sbif", name: "SBIF", zoneKey: "sbif" }),
        makeProgram({ id: "federalOZ", name: "Federal OZ", zoneKey: "federalOZ" }),
      ],
      { zones, zoneNames },
    );

    const ids = report.benefitEstimates?.items.map((i) => i.programId) ?? [];
    expect(ids).toContain("tif");
    expect(ids).not.toContain("sbif");
    expect(ids).not.toContain("federalOZ");

    const sbifReport = generateReportData(
      makeState({
        budgetRange: "500k-2m",
      }),
      [makeProgram({ id: "sbif", name: "SBIF", zoneKey: "sbif" })],
      { zones: { sbif: true }, zoneNames: { sbif: "Test SBIF" } },
    );

    const sbifEstimate = sbifReport.benefitEstimates?.items.find((i) => i.programId === "sbif");
    expect(sbifEstimate?.label).toContain("90%");
    expect(sbifEstimate?.estimatedValue).toBeLessThanOrEqual(250_000);
  });

  it("adds neighborhood economic context with measured ZBP and license-continuity signals when provided", () => {
    const report = generateReportData(
      makeState(),
      [makeProgram()],
      {
        zones,
        zoneNames,
        census: {
          medianIncome: 58000,
          medianHomeValue: 210000,
          population: 4200,
          walkScore: 13,
          tractId: "17031000100",
        },
        neighborhoodEconomics: {
          geographyLabel: "ZIP 60619",
          businessContinuity: {
            baselineYear: 2020,
            comparisonYear: 2025,
            baselineActive: 1000,
            comparisonActive: 920,
            retained: 620,
            newSinceBaseline: 300,
            continuityRate: 0.62,
          },
          jobsPayroll: {
            baselineYear: 2020,
            comparisonYear: 2023,
            baselineEstablishments: 420,
            comparisonEstablishments: 455,
            baselineEmployment: 3200,
            comparisonEmployment: 3600,
            employmentGrowthRate: 0.125,
            baselineAnnualPayroll: 180000000,
            comparisonAnnualPayroll: 230000000,
            payrollGrowthRate: 0.278,
          },
          reinvestment: {
            permitCount: 80,
            reportedCost: 12500000,
            windowLabel: "the trailing 24 months",
          },
          property: {
            distinctOwners: 500,
            assessedValueChangeRate: 0.08,
          },
          tifFinance: {
            districtId: "T-087",
            districtName: "Fullerton/Milwaukee",
            reportYear: 2024,
            expirationYear: 2027,
            fundBalance: 63162041,
            propertyTaxIncrementCurrent: 21911518,
            amountDesignatedProjectCosts: 63011079,
            sourceLabel: "City of Chicago TIF Annual Report",
            sourceUrl: "https://data.cityofchicago.org/resource/qm7s-3ctt.json",
            caution: "District-level City annual report data. Not proof of funding availability.",
          },
        },
      },
    );

    const section = report.sections.find((s) => s.title === "Neighborhood Economic Context");
    expect(section).toBeDefined();
    expect(section?.items.find((i) => i.label === "Business Continuity")?.value).toContain("62%");
    expect(section?.items.find((i) => i.label === "Jobs & Payroll")?.detail).toContain("Census ZIP Business Patterns");
    expect(section?.items.find((i) => i.label === "Jobs & Payroll")?.value).toContain("jobs +13%");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.value).toContain("Reported district fund balance");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.detail).toContain("Not proof of funding availability");
    expect(section?.items.find((i) => i.label === "TIF District Funding Overview")?.detail).toContain("capture growth in property-tax revenue");
    expect(section?.items.find((i) => i.label === "Local Retail Demand")?.value).toContain("Modeled");
    expect(report.dataSources?.map((source) => source.id)).toContain("zbp");
    expect(report.dataSources?.map((source) => source.id)).toContain("buildingPermits");
    expect(report.dataSources?.map((source) => source.id)).toContain("assessorValues");
    expect(report.dataSources?.map((source) => source.id)).toContain("tifFinance");
  });

  it("generates corridor intelligence reports from corridor metrics", () => {
    const report = generateReportData(
      makeState({
        reportType: "corridor-intelligence",
        neighborhood: "60617",
        address: "",
        lat: null,
        lon: null,
      }),
      [makeProgram()],
      {
        corridorMetrics: {
          corridorType: "zip",
          corridorId: "60617",
          vacancyRate: 0.12,
          turnoverRate: 0.08,
          ownershipHHI: 0.23,
          localOwnershipShare: 0.41,
          permitCount: 19,
          incentiveCoverage: null,
          healthScore: 64,
          details: {
            vacancy: { vacantCount: 120, totalParcels: 1000 },
            turnover: { openings: 18, closures: 7 },
            ownershipConcentration: { distinctOwners: 720, topOwnerShare: 0.03, totalParcels: 1000 },
            ownershipOrigin: { localCount: 280, outsideCount: 400, unknownCount: 320 },
            permits: { totalReportedCost: 1500000, demolitionCount: 2 },
          },
        },
      },
    );

    expect(report.reportType).toBe("corridor-intelligence");
    expect(report.title).toContain("ZIP 60617");
    expect(report.metadata.corridorLabel).toBe("ZIP 60617");
    expect(report.subtitle).toContain("Market and resilience signals");
    expect(report.sections.find((section) => section.title === "Market Signal Summary")?.table?.rows.length).toBeGreaterThan(0);
    expect(report.sections.map((section) => section.title)).toContain("What The Signals Say");
    expect(report.sections.map((section) => section.title)).toContain("How To Read This");
    expect(report.sections.map((section) => section.title)).toContain("What A Funded Version Unlocks");
    expect(report.sections.map((section) => section.title)).not.toContain("Intervention Buckets");
    expect(report.recommendedActions).toEqual([]);
  });
});
