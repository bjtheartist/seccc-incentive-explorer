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
});
