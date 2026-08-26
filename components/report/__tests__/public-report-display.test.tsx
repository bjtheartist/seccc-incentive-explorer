import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import type { GeneratedReport } from "@/lib/report-engine";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import type { VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import type { WizardState } from "@/lib/report-wizard-config";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("ReportDisplay public safety", () => {
  it("renders a legacy saved report through the neutral public presentation", () => {
    const legacy = {
      title: "Eligible Incentive Programs",
      subtitle: "Appears eligible based on location",
      reportType: "site-incentives",
      generatedAt: "2026-08-01T00:00:00.000Z",
      summary: "You may qualify for a High Match program with a possible benefit of $25,000-$50,000.",
      verdict: {
        signal: "strong",
        headline: "High Match with a potential incentive of $50,000",
        subheadline: "You qualify for an estimated $25,000 benefit",
        topReasons: ["Appears eligible for a benefit range of $25,000-$50,000"],
      },
      executiveSummary: {
        topPrograms: [
          {
            programId: "legacy",
            name: "Legacy Program",
            projectFitLabel: "Strong fit",
            projectFitReason: "High categorical fit based on the selected project.",
            explanation: {
              whyItAppears: ["Appears eligible based on this address."],
              knownFromPublicData: [],
              basedOnUserAnswers: [],
              stillToConfirm: [],
              currentDocumentsToGather: [],
              confirmWith: [],
            },
          },
        ],
        topActions: [],
        zoneCount: 1,
        whyTheseMatter: "Programs to review.",
      },
      sections: [
        {
          title: "Eligible Incentive Programs",
          description: "Appears eligible for a potential incentive of $50,000.",
          items: [
            {
              label: "High Match Legacy Program with projected incentive of $30,000",
              value: "$25,000-$50,000",
              detail: "You qualify for a possible incentive of $20,000.",
              programId: "legacy",
              confidenceLabel: "High Match",
              matchedRules: ["You reported plans to remodel."],
              notVerified: ["Confirm current published requirements."],
              eligibilityRules: [
                { description: "Eligible applicants must be in good standing.", required: true },
              ],
              sourceUrl: "https://example.com/legacy",
            },
          ],
        },
      ],
      recommendedActions: [
        {
          label: "Claim a possible $25,000 incentive",
          description: "You qualify for a projected award of $25,000.",
          priority: "high",
        },
      ],
      actionRoadmap: [
        {
          tier: "do-this-week",
          label: "Pursue an estimated $50,000 benefit",
          description: "Appears eligible for a potential incentive of $50,000.",
          callScript: "Tell them you qualify for up to $50,000.",
        },
      ],
      metadata: { address: "100 E Test St" },
    } as unknown as GeneratedReport;

    const html = renderToStaticMarkup(
      <ReportDisplay report={legacy} onStartOver={() => {}} />,
    );

    expect(html).toContain("Programs Mapped at This Address");
    expect(html).toContain("Legacy Program");
    expect(html).toContain("Review published terms");
    expect(html).toContain("Program review details");
    expect(html).not.toMatch(
      /appears eligible|may qualify|you qualify|eligible incentive programs|high match|medium match/i,
    );
    expect(html).not.toContain("$25,000");
    expect(html).not.toContain("$50,000");
    expect(html).not.toContain("$30,000");
    expect(html).not.toContain("$20,000");
    expect(html).not.toContain("Strong fit");
    expect(html).not.toContain("High categorical fit");

    // report.startHere is absent on this legacy fixture (saved before the
    // field existed) — the card must not render, and the demoted blocks must
    // stay in their ORIGINAL (non-<details>) form, i.e. current layout
    // unchanged.
    expect(html).not.toContain('id="start-here"');
    expect(html).not.toContain("start-here-card");
    expect(html).not.toMatch(/<details[^>]*id="recommended-actions"/);
  });

  it("renders the Start Here card as the first content block, with the primary action dominant, and demotes topActions/recommendedActions behind disclosure when report.startHere is present", () => {
    const report = {
      title: "Location Snapshot",
      subtitle: "",
      reportType: "site-incentives",
      generatedAt: "2026-08-01T00:00:00.000Z",
      summary: "A short overview paragraph.",
      verdict: {
        signal: "strong",
        headline: "Several programs are mapped at this address",
        subheadline: "This address sits inside multiple zones.",
        topReasons: ["Inside a TIF district"],
      },
      executiveSummary: {
        topPrograms: [],
        topActions: [
          { type: "call", label: "Call the TIF program office", programId: "tif" },
        ],
        zoneCount: 1,
        whyTheseMatter: "Programs to review.",
      },
      sections: [],
      recommendedActions: [
        { label: "Gather facade renovation estimates", description: "Prepare a budget.", priority: "medium" },
      ],
      startHere: {
        primary: {
          label: "Call Test Agency about the TIF Program",
          description: "A test program that reimburses a share of facade costs.",
          kind: "call-agency",
          programId: "tif",
          contact: { agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" },
        },
        secondary: [],
        evidence: [],
        unresolvedQuestions: [],
        audience: "site-incentives",
      },
      metadata: { address: "100 E Test St" },
    } as unknown as GeneratedReport;

    const html = renderToStaticMarkup(
      <ReportDisplay report={report} onStartOver={() => {}} />,
    );

    // Card renders, primary action is the dominant tel: control.
    expect(html).toContain('id="start-here"');
    expect(html).toContain("Call Test Agency about the TIF Program");
    expect(html).toContain('href="tel:312-555-0000"');

    // First content block: the card's position precedes the verdict card's.
    const startHereIdx = html.indexOf('id="start-here"');
    const verdictIdx = html.indexOf('id="verdict"');
    expect(startHereIdx).toBeGreaterThanOrEqual(0);
    expect(verdictIdx).toBeGreaterThan(startHereIdx);

    // The verdict block stays visible (not demoted) — no <details> wrapper.
    expect(html).not.toMatch(/<details[^>]*id="verdict"/);
    expect(html).toContain("Several programs are mapped at this address");

    // executiveSummary.topActions demotes behind native disclosure, but the
    // content is still reachable (present in the DOM either way).
    expect(html).toContain("<details");
    expect(html).toContain("Best Next Steps");
    expect(html).toContain("Call the TIF program office");

    // recommendedActions demotes behind native disclosure, content intact.
    expect(html).toMatch(/<details[^>]*id="recommended-actions"/);
    expect(html).toContain("Recommended Actions · 1");
    expect(html).toContain("Gather facade renovation estimates");
  });

  it("uses the authoritative renamed title and never exposes a polygon-dropping share link", () => {
    const coverage = {
      sourceMode: "database",
      sourcePath: "database:vacant_properties",
      asOf: null,
      asOfBasis: null,
      explorerRefreshedAt: null,
      freshness: {},
      licenseScreening: { status: "available" },
      returnedCount: 1,
      configuredLimit: 10_000,
      queryLimit: 10_001,
      coverageStatus: "complete",
      potentiallyTruncated: false,
      fallbackReason: null,
    } as VacancyCoverageMetadata;
    const created = createDrawnAreaReportScope({
      name: "Original generated area label",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-87.7, 41.8],
          [-87.6, 41.8],
          [-87.6, 41.9],
          [-87.7, 41.8],
        ]],
      },
      generatedAt: "2026-08-26T12:00:00.000Z",
      vacancy: {
        loadFailed: false,
        coverage,
        freshnessFilter: "current_screening",
        licenseFilter: "all",
        returnedCountBeforeFilters: 1,
        selectedFeatures: [{ properties: { recordId: "cols:1" } }],
      },
    });
    if (!created.ok) throw new Error(created.detail);
    const report = {
      title: "79th Corridor — Ward 6",
      subtitle: "Drawn-area public-record vacancy signals and permit context",
      reportType: "best-location",
      generatedAt: "2026-08-26T12:00:00.000Z",
      summary: "Saved exact-area report.",
      sections: [],
      recommendedActions: [],
      metadata: {},
      drawnAreaScope: created.scope,
    } as GeneratedReport;

    const html = renderToStaticMarkup(
      <ReportDisplay
        report={report}
        wizardState={{ neighborhood: "Chatham" } as WizardState}
        onStartOver={() => {}}
      />,
    );

    expect(html).toContain("Vacancy Spreadsheet — 79th Corridor — Ward 6");
    expect(html).not.toContain("Share Spreadsheet");
    expect(html).toContain("Loading vacancy records");
    expect(html).not.toContain("No tracked vacancy records returned");
  });

  it("distinguishes malformed drawn-area provenance from a legacy missing boundary", () => {
    const malformed = {
      title: "Malformed drawn-area report",
      subtitle: "Drawn-area public-record vacancy signals and permit context",
      reportType: "best-location",
      generatedAt: "2026-08-26T12:00:00.000Z",
      summary: "Stored summary.",
      sections: [],
      recommendedActions: [],
      metadata: {},
      drawnAreaScope: { kind: "drawn-area", scope: { type: "community-area" } },
    } as unknown as GeneratedReport;

    const html = renderToStaticMarkup(
      <ReportDisplay report={malformed} onStartOver={() => {}} />,
    );

    expect(html).toContain("invalid saved boundary or provenance contract");
    expect(html).not.toContain("legacy drawn-area report did not save its boundary");
  });
});
