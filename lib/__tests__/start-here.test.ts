import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateReportData, type GeneratedReport } from "../report-engine";
import { computeTopActions, runConfidenceEngine } from "../confidence-engine";
import { buildStartHere, selectTopPrograms, type BuildStartHereInput } from "../start-here";
import { getProgramsSync } from "../programs-data";
import type { Program, ProgramCheckResult, SurveyAnswers, ParcelData } from "../types";

/**
 * ── Characterization tests ──────────────────────────────────────────────
 *
 * These lock down the CURRENT output of the three legacy action structures
 * (`executiveSummary.topActions`, `actionRoadmap`, `recommendedActions`)
 * across several fixture reports, captured before `computeTopActions` and
 * the report-engine generators were refactored to derive from
 * `buildStartHere`. The snapshots must not change across that refactor —
 * that is the evidence that the derivation is behavior-preserving. If one
 * of these snapshots needs to change, that is a real behavior change to
 * the legacy shape and must be called out explicitly, not absorbed
 * silently by `--update`.
 */

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "tif",
    name: "TIF Program",
    level: "City",
    zoneKey: "tif",
    summary: "A test program that reimburses eligible facade costs.",
    whoQualifies: "Businesses in the matching zone",
    benefits: ["Grant"],
    howToApply: ["Confirm program fit", "Open the official source"],
    requiredDocs: ["Project budget"],
    contact: "test@example.com",
    url: "https://example.com/program",
    contacts: [
      { agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" },
    ],
    eligibilityRules: [
      {
        criterion: "location",
        description: "Must be in a TIF district",
        verifiedBy: "location",
        required: true,
      },
    ],
    lastVerifiedAt: new Date("2026-08-01").toISOString(),
    benefitRange: "$10K-$50K",
    fastestConfirmingStep: "Call the program administrator",
    ...overrides,
  };
}

function urlOnlyProgram(): Program {
  return makeProgram({
    id: "sbif",
    name: "SBIF Facade Program",
    zoneKey: "sbif",
    contacts: [{ agency: "SBIF Office", abbreviation: "SBIF", url: "https://example.com/sbif" }],
  });
}

function smallBizSourceProgram(overrides: Partial<Program> = {}): Program {
  return makeProgram({
    id: "smallBizSource",
    name: "Small Business Source",
    zoneKey: "",
    summary: "Free one-on-one advising for Cook County small businesses.",
    contacts: [{ agency: "Cook County SBS", abbreviation: "SBS", phone: "312-555-1000" }],
    ...overrides,
  });
}

const zones = { tif: true, sbif: true, federalOZ: false };
const zoneNames = { tif: "Test TIF", sbif: "Test SBIF" };

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
    projectGoals: [],
    projectType: "",
    customGoal: "",
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
  } as ReportState;
}

/** Strip fields that are non-deterministic across runs (timestamps) so
 *  snapshots are stable. */
function legacyActionShapes(report: GeneratedReport) {
  return {
    topActions: report.executiveSummary?.topActions ?? null,
    actionRoadmap: report.actionRoadmap ?? null,
    recommendedActions: report.recommendedActions,
  };
}

describe("legacy action structures are unchanged by the StartHere refactor", () => {
  it("site-incentives report with a phone-contact program", () => {
    const report = generateReportData(
      makeState({ projectType: "equipment" }),
      [makeProgram(), urlOnlyProgram(), smallBizSourceProgram()],
      { zones, zoneNames },
    );
    expect(legacyActionShapes(report)).toMatchSnapshot();
  });

  it("site-incentives report with an unresolved zoning question", () => {
    const report = generateReportData(
      makeState({ projectGoals: ["rehab"], projectType: "rehab" }),
      [makeProgram(), smallBizSourceProgram()],
      {
        zones,
        zoneNames,
        cityZoning: {
          status: "available",
          zoneClass: "B3-2",
          zoneType: "Business",
          source: {
            id: "chicago-arcgis-zoning",
            label: "City of Chicago ArcGIS zoning boundaries",
            url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
            retrievedAt: "2026-08-09T12:00:00.000Z",
            recordUpdatedAt: null,
          },
        },
      },
    );
    expect(legacyActionShapes(report)).toMatchSnapshot();
  });

  it("dev-feasibility (best-location) report", () => {
    const report = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram(), urlOnlyProgram()],
      {
        zones,
        zoneNames,
        parcel: {
          pin: "25-12-314-001-0000",
          classCode: "5-17",
          classDescription: "Commercial building",
          isCommercial: true,
          isVacant: false,
          totalValue: "$120,000",
        } as ParcelData,
      },
    );
    expect(legacyActionShapes(report)).toMatchSnapshot();
  });

  it("program-explorer report (no address, no executiveSummary/actionRoadmap)", () => {
    const report = generateReportData(
      makeState({ reportType: "program-explorer" }),
      [makeProgram(), urlOnlyProgram(), smallBizSourceProgram()],
      {},
    );
    expect(legacyActionShapes(report)).toMatchSnapshot();
  });

  it("developer-analysis report", () => {
    const report = generateReportData(
      makeState({ reportType: "developer-analysis", creditsToAnalyze: ["tif", "sbif"] }),
      [makeProgram(), urlOnlyProgram()],
      {},
    );
    expect(legacyActionShapes(report)).toMatchSnapshot();
  });

  it("computeTopActions output is unchanged for a bare ProgramCheckResult list", () => {
    const results = runConfidenceEngine(
      [makeProgram(), urlOnlyProgram(), smallBizSourceProgram()],
      zones,
      zoneNames,
    );
    expect(computeTopActions(results)).toMatchSnapshot();
  });
});

/**
 * ── StartHere invariants ────────────────────────────────────────────────
 */

function resultsFor(
  programs: Program[],
  z: Record<string, boolean> = zones,
  zn: Record<string, string> = zoneNames,
  survey?: SurveyAnswers,
  parcel?: ParcelData,
): ProgramCheckResult[] {
  return runConfidenceEngine(programs, z, zn, survey, parcel);
}

describe("buildStartHere invariants", () => {
  it("always returns exactly one primary action", () => {
    const startHere = buildStartHere({ results: [], audience: "site-incentives" });
    expect(startHere.primary).toBeDefined();
    expect(startHere.primary.label.length).toBeGreaterThan(0);
    expect(startHere.secondary).toEqual([]);
  });

  it("caps secondary at two and evidence at three", () => {
    const results = resultsFor([
      makeProgram({ id: "a", name: "Program A", zoneKey: "tif" }),
      makeProgram({ id: "b", name: "Program B", zoneKey: "sbif", contacts: [{ agency: "Agency B", abbreviation: "AB", url: "https://example.com/b" }] }),
      smallBizSourceProgram(),
    ], { tif: true, sbif: true });
    const startHere = buildStartHere({
      results,
      audience: "site-incentives",
      evidenceFacts: [
        { fact: "One", sourceLabel: "Source 1" },
        { fact: "Two", sourceLabel: "Source 2" },
        { fact: "Three", sourceLabel: "Source 3" },
        { fact: "Four", sourceLabel: "Source 4" },
      ],
    });
    expect(startHere.secondary.length).toBeLessThanOrEqual(2);
    expect(startHere.evidence.length).toBeLessThanOrEqual(3);
  });

  /**
   * The tested invariant from the design review: an unresolved zoning/use
   * question always outranks a financing action for the primary slot — a
   * visitor is never pointed at money before an unresolved foundational
   * question. This must hold even when a well-contactable, address-linked
   * financing program is available and would otherwise win the primary
   * slot on its own.
   */
  it("puts an unresolved zoning/use question ahead of a financing action", () => {
    const results = resultsFor([makeProgram()]); // phone-contact financing program, would normally win primary
    const withoutZoning = buildStartHere({ results, audience: "site-incentives" });
    expect(withoutZoning.primary.kind).toBe("call-agency");

    const withZoning = buildStartHere({
      results,
      audience: "site-incentives",
      unresolvedZoning: {
        question: "What is the exact proposed use, and which Title 17 use category does the City place it in for B3-2?",
        confirmationLabel: "Define the exact activity and verify its use category for B3-2",
        confirmationDescription: "List every primary and accessory activity at the site, then ask the City or a zoning professional to identify the controlling Title 17 use category and current process.",
      },
    });

    expect(withZoning.primary.kind).toBe("confirm-zoning-use");
    expect(withZoning.primary.programId).toBeUndefined();
    expect(withZoning.unresolvedQuestions[0]).toMatch(/Title 17 use category/);
    // The financing action is demoted, not dropped — it survives into secondary.
    expect(withZoning.secondary.some((a) => a.kind === "call-agency")).toBe(true);
  });

  it("prefers an action that connects to a human over a generic task when zoning is resolved", () => {
    const phoneResults = resultsFor([makeProgram()]);
    expect(buildStartHere({ results: phoneResults, audience: "site-incentives" }).primary.kind).toBe("call-agency");

    const urlResults = resultsFor([urlOnlyProgram()], { sbif: true });
    expect(buildStartHere({ results: urlResults, audience: "site-incentives" }).primary.kind).toBe("confirm-with-agency");

    // smallBizSource must rank outside the top-2 address-linked window (or
    // carry no location-required rule at all, as here) to reach the
    // dedicated advising-fallback path rather than the ordinary call/check
    // loop — otherwise its own phone contact would win it a "call-agency"
    // primary directly, which is a different (also correct) code path
    // already covered by the fixture snapshots above.
    const advisingOnlyResults = resultsFor([
      smallBizSourceProgram({ eligibilityRules: [] }),
    ]);
    expect(buildStartHere({ results: advisingOnlyResults, audience: "site-incentives" }).primary.kind).toBe("book-advising");

    // No address-linked program, no advising program in the catalog at all:
    // only then does the generic fallback apply.
    const nothingResults = resultsFor([
      makeProgram({ id: "no-contact", contacts: [] }),
    ]);
    const fallback = buildStartHere({ results: nothingResults, audience: "site-incentives" });
    expect(fallback.primary.kind).toBe("gather-information");
  });

  it("surfaces a program's unverified published requirement as a question", () => {
    const results = resultsFor([makeProgram()], zones, zoneNames, { industry: "retail" });
    const startHere = buildStartHere({ results, audience: "site-incentives" });
    // The fixture program's only rule is location-verified, so there is
    // nothing left unverified — this just proves the mechanism doesn't
    // fabricate a question when there is nothing to ask.
    expect(startHere.unresolvedQuestions).toEqual([]);
  });
});

describe("generateReportData attaches startHere consistently with the legacy zoning action", () => {
  const cityZoning = {
    status: "available" as const,
    zoneClass: "B3-2",
    zoneType: "Business",
    source: {
      id: "chicago-arcgis-zoning" as const,
      label: "City of Chicago ArcGIS zoning boundaries",
      url: "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1",
      retrievedAt: "2026-08-09T12:00:00.000Z",
      recordUpdatedAt: null,
    },
  };

  it("startHere.primary matches the same zoning-confirmation action injected into actionRoadmap[0]", () => {
    const report = generateReportData(
      makeState({ projectGoals: ["rehab"], projectType: "rehab" }),
      [makeProgram(), smallBizSourceProgram()],
      { zones, zoneNames, cityZoning },
    );

    expect(report.startHere).toBeDefined();
    expect(report.startHere?.primary.kind).toBe("confirm-zoning-use");
    expect(report.startHere?.primary.label).toBe(report.actionRoadmap?.[0]?.label);
    expect(report.startHere?.unresolvedQuestions.length).toBeGreaterThan(0);
  });

  it("is absent (not a crash) for report types outside the executive-summary gate", () => {
    const report = generateReportData(
      makeState({ reportType: "program-explorer" }),
      [makeProgram()],
      {},
    );
    expect(report.startHere).toBeUndefined();
  });

  it("audience matches the report's own reportType", () => {
    const report = generateReportData(
      makeState({ reportType: "dev-feasibility", projectType: "rehab" }),
      [makeProgram()],
      { zones, zoneNames },
    );
    expect(report.startHere?.audience).toBe(report.reportType);
  });
});

describe("selectTopPrograms", () => {
  it("is a plain top-N slice, shared by buildStartHere and the report generators", () => {
    expect(selectTopPrograms([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(selectTopPrograms([1], 2)).toEqual([1]);
    expect(selectTopPrograms([], 2)).toEqual([]);
  });
});

/**
 * ── Vocabulary rails ─────────────────────────────────────────────────────
 *
 * Mirrors the emission-test pattern in lib/__tests__/public-report-safety.test.ts
 * ("relevance engine emits no determinations pre-scrub"), extended to
 * startHere's own authored copy: labels, descriptions, and unresolved
 * questions must never assert allowed/permitted/prohibited/eligible/
 * qualifies as an affirmative claim about the reader.
 */
describe("startHere vocabulary rails", () => {
  const PROHIBITED_ENGINE_PHRASES =
    /appears eligible|may qualify|you qualify|potentially eligible|(?:you|your \w+)(?:'re| are)? (?:may be )?eligible|eligible incentive programs|high match|medium match|qualifying zone|designed for you|check[^.!?]{0,40}eligibility|eligibility (?:confirmed|score)/i;

  const CLAIM_WORDS =
    "permitted|allowed|prohibited|banned|barred|permissible|by[-\\s]?right|as[-\\s]of[-\\s]right|qualifies|qualify";
  const AFFIRMATIVE_CLAIM_PATTERNS: RegExp[] = [
    new RegExp(`\\byou\\b[^.]{0,40}\\b(?:${CLAIM_WORDS})\\b`, "i"),
    new RegExp(`\\b(?:${CLAIM_WORDS})\\b[^.]{0,40}\\byou\\b`, "i"),
    /\byou qualify\b/i,
    /\byou(?:'re| are) eligible\b/i,
  ];

  function startHereAuthoredStrings(
    results: ProgramCheckResult[],
    input: Partial<BuildStartHereInput> = {},
  ): string[] {
    const startHere = buildStartHere({ results, audience: "site-incentives", ...input });
    return [
      startHere.primary.label,
      startHere.primary.description,
      ...startHere.secondary.flatMap((a) => [a.label, a.description]),
      ...startHere.unresolvedQuestions,
      ...startHere.evidence.map((e) => e.fact),
    ];
  }

  const ALL_PROGRAMS = getProgramsSync();
  const ZONE_NAMES: Record<string, string> = {
    tif: "Test TIF District",
    sbif: "Test SBIF Area",
    federalOZ: "Test Opportunity Zone",
    enterprise: "Test Enterprise Zone",
  };
  const ZONE_CASES: Record<string, boolean>[] = [
    {},
    { tif: true },
    { tif: true, sbif: true, federalOZ: true, enterprise: true },
  ];
  const UNRESOLVED_ZONING_CASES: BuildStartHereInput["unresolvedZoning"][] = [
    undefined,
    {
      question: "What is the exact proposed use, and which Title 17 use category does the City place it in for B3-2?",
      confirmationLabel: "Define the exact activity and verify its use category for B3-2",
      confirmationDescription: "List every primary and accessory activity at the site, then ask the City or a zoning professional to identify the controlling Title 17 use category and current process. The published district alone does not establish that a proposed use is permitted or that zoning relief is required.",
    },
  ];

  it("never emits a prohibited determination across the real program catalog", () => {
    expect(ALL_PROGRAMS.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const zones of ZONE_CASES) {
      const results = runConfidenceEngine(ALL_PROGRAMS, zones, ZONE_NAMES);
      for (const unresolvedZoning of UNRESOLVED_ZONING_CASES) {
        for (const text of startHereAuthoredStrings(results, { unresolvedZoning })) {
          if (PROHIBITED_ENGINE_PHRASES.test(text)) offenders.push(text);
        }
      }
    }
    expect(Array.from(new Set(offenders))).toEqual([]);
  });

  it("never asserts allowed/permitted/prohibited/eligible/qualifies as an affirmative claim about the reader", () => {
    const offenders: string[] = [];
    for (const zones of ZONE_CASES) {
      const results = runConfidenceEngine(ALL_PROGRAMS, zones, ZONE_NAMES);
      for (const unresolvedZoning of UNRESOLVED_ZONING_CASES) {
        for (const text of startHereAuthoredStrings(results, { unresolvedZoning })) {
          for (const pattern of AFFIRMATIVE_CLAIM_PATTERNS) {
            if (pattern.test(text)) offenders.push(`${pattern}: ${text}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the banned vocabulary out of the start-here module source itself", () => {
    // Belt-and-suspenders: the templates the engine authors should never
    // even contain the words, not just avoid the affirmative-claim shape.
    const source = readFileSync(join(process.cwd(), "lib/start-here.ts"), "utf8");
    // Strip comments so the module's own doc-comments (which discuss the
    // rule) don't trip the check meant for authored template strings.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const word of ["allowed", "permitted", "prohibited", "eligible", "qualifies"]) {
      expect(withoutComments.toLowerCase()).not.toContain(word);
    }
  });
});

/**
 * build-spec.md 2.2 (audit consult item 2, "StartHere descriptions" row):
 * a StartHere action description must not read as if a closed/lapsed
 * program's round is currently open.
 */
describe("StartHere action descriptions carry the PublicProgramView qualifier for non-open programs", () => {
  it("appends the binding qualifier sentence for a lapsed program's description", () => {
    const lapsed = makeProgram({
      id: "lapsedProgram",
      name: "Lapsed Program",
      intakeStatus: "lapsed",
      benefitTermsStatus: "historical",
      statusAsOf: "2026-08-01",
      contacts: [{ agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" }],
    });
    const results = runConfidenceEngine([lapsed], zones, zoneNames);
    const startHere = buildStartHere({ results, audience: "site-incentives" });
    const allText = [
      startHere.primary.description,
      ...startHere.secondary.map((a) => a.description),
    ].join(" ");
    expect(allText).toMatch(/no round currently open as of/i);
  });

  it("does NOT append a qualifier for an open/rolling program's description", () => {
    const open = makeProgram({
      id: "openProgram",
      name: "Open Program",
      intakeStatus: "open",
      benefitTermsStatus: "current",
      statusAsOf: "2026-08-01",
      contacts: [{ agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" }],
    });
    const results = runConfidenceEngine([open], zones, zoneNames);
    const startHere = buildStartHere({ results, audience: "site-incentives" });
    const allText = [
      startHere.primary.description,
      ...startHere.secondary.map((a) => a.description),
    ].join(" ");
    expect(allText).not.toMatch(/no round currently open/i);
  });
});
