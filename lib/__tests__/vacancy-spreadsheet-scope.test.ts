import { describe, expect, it } from "vitest";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import {
  assessDrawnAreaRecordDriftComparability,
  compareDrawnAreaRecordManifest,
  hasCompleteCurrentDrawnAreaSelection,
  resolveVacancySpreadsheetScope,
  safeVacancyProgramUrl,
} from "@/lib/vacancy-spreadsheet-scope";
import { unavailableCclbaSourceCoverage, type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[
    [-87.7, 41.8],
    [-87.6, 41.8],
    [-87.6, 41.9],
    [-87.7, 41.8],
  ]],
};

function baseReport(): GeneratedReport {
  return {
    title: "Vacancy Analysis",
    subtitle: "",
    reportType: "best-location",
    generatedAt: "2026-08-26T12:00:00.000Z",
    summary: "Test",
    sections: [],
    recommendedActions: [],
    metadata: {},
  };
}

function wizard(neighborhood: string): WizardState {
  return { neighborhood } as WizardState;
}

function completeCoverage(
  overrides: Partial<VacancyCoverageMetadata> = {},
): VacancyCoverageMetadata {
  return {
    sourceMode: "database",
    sourcePath: "database:vacant_properties",
    asOf: null,
    asOfBasis: null,
    explorerRefreshedAt: null,
    freshness: {} as VacancyCoverageMetadata["freshness"],
    licenseScreening: {
      policyVersion: "issued-exact-address-v4",
      sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
      status: "available",
      checkedAt: "2026-08-26T12:00:00.000Z",
      candidateCount: 2,
      checkedCount: 2,
      matchedPropertyCount: 1,
      capped: false,
      addressCap: 500,
      sourceCallCount: 1,
      successfulBatches: 1,
      failedBatches: 0,
      malformedRowCount: 0,
      partialReasons: [],
      caveats: [],
    },
    returnedCount: 2,
    configuredLimit: 10_000,
    queryLimit: 10_001,
    coverageStatus: "complete",
    potentiallyTruncated: false,
    fallbackReason: null,
    cclbaSourceCoverage: unavailableCclbaSourceCoverage("snapshot_not_recorded"),
    ...overrides,
  };
}

function comparableScope(licenseFilter: "all" | "conflicts" = "all") {
  const coverage = completeCoverage();
  const created = createDrawnAreaReportScope({
    name: "Two wards",
    geometry: POLYGON,
    generatedAt: "2026-08-26T12:00:00.000Z",
    vacancy: {
      loadFailed: false,
      coverage,
      freshnessFilter: "current_screening",
      licenseFilter,
      returnedCountBeforeFilters: 2,
      selectedFeatures: [
        { properties: { id: "cols:1" } },
        { properties: { id: "cclba:2", sourceSnapshotId: "snapshot-a" } },
      ],
    },
  });
  if (!created.ok) throw new Error(created.detail);
  return created.scope;
}

describe("vacancy spreadsheet scope", () => {
  it("uses the exact saved polygon and never the dominant community area", () => {
    const created = createDrawnAreaReportScope({
      name: "79th Corridor — Ward 6",
      geometry: POLYGON,
      generatedAt: "2026-08-26T12:00:00.000Z",
      vacancy: {
        loadFailed: true,
        freshnessFilter: "current_screening",
        licenseFilter: "all",
        returnedCountBeforeFilters: null,
        selectedFeatures: [],
      },
    });
    if (!created.ok) throw new Error(created.detail);

    const resolved = resolveVacancySpreadsheetScope(
      { ...baseReport(), drawnAreaScope: created.scope },
      wizard("Chatham"),
    );

    expect(resolved.status).toBe("ready");
    if (resolved.status !== "ready") return;
    expect(resolved.kind).toBe("drawn-area");
    expect(resolved.label).toBe("79th Corridor — Ward 6");
    expect(resolved.requestPath).toContain("polygon=");
    expect(decodeURIComponent(resolved.requestPath)).toContain(JSON.stringify(POLYGON));
    expect(resolved.requestPath).not.toContain("communityArea");
  });

  it("fails closed for a legacy drawn-area report with no stored polygon", () => {
    const resolved = resolveVacancySpreadsheetScope(
      {
        ...baseReport(),
        subtitle: "Drawn-area public-record vacancy signals and permit context",
      },
      wizard("Chatham"),
    );

    expect(resolved).toMatchObject({
      status: "unavailable",
      kind: "drawn-area",
      reason: "legacy-scope-missing",
    });
  });

  it("preserves the existing community-area behavior for ordinary vacancy reports", () => {
    expect(resolveVacancySpreadsheetScope(baseReport(), wizard("Chatham"))).toEqual({
      status: "ready",
      kind: "community-area",
      label: "Chatham",
      requestPath: "/api/vacant?communityArea=Chatham&limit=10000",
      drawnArea: null,
    });
  });

  it("reports additions and removals against the saved record manifest", () => {
    const scope = comparableScope();

    expect(
      compareDrawnAreaRecordManifest(scope, [
        { properties: { recordId: "cclba:2", sourceSnapshotId: "snapshot-b" } },
        { properties: { recordId: "cols:3" } },
      ]),
    ).toEqual({
      saved: 2,
      current: 2,
      added: 1,
      removed: 1,
      changedSnapshots: 1,
      snapshotsNotComparable: 0,
      unchanged: 0,
    });
  });

  it("does not claim a snapshot changed when either side has no snapshot id", () => {
    const scope = comparableScope();

    expect(
      compareDrawnAreaRecordManifest(scope, [
        { properties: { recordId: "cols:1", sourceSnapshotId: "now-versioned" } },
        { properties: { recordId: "cclba:2" } },
        { properties: null },
      ]),
    ).toEqual({
      saved: 2,
      current: 2,
      added: 0,
      removed: 0,
      changedSnapshots: 0,
      snapshotsNotComparable: 2,
      unchanged: 0,
    });
  });

  it("does not treat a newer retrieval time for identical row facts as a changed snapshot", () => {
    const created = createDrawnAreaReportScope({
      name: "Two wards",
      geometry: POLYGON,
      generatedAt: "2026-08-26T12:00:00.000Z",
      vacancy: {
        loadFailed: false,
        coverage: completeCoverage(),
        freshnessFilter: "current_screening",
        licenseFilter: "all",
        returnedCountBeforeFilters: 2,
        selectedFeatures: [
          {
            properties: {
              recordId: "cclba:52905642",
              sourceSnapshotId: null,
              sourceRetrievedAt: "2026-08-26T18:00:00.000Z",
              status: "land_bank_inventory",
            },
          },
        ],
      },
    });
    if (!created.ok) throw new Error(created.detail);

    expect(
      compareDrawnAreaRecordManifest(created.scope, [
        {
          properties: {
            recordId: "cclba:52905642",
            sourceSnapshotId: null,
            sourceRetrievedAt: "2026-08-27T18:00:00.000Z",
            status: "land_bank_inventory",
          },
        },
      ]),
    ).toEqual({
      saved: 1,
      current: 1,
      added: 0,
      removed: 0,
      changedSnapshots: 0,
      snapshotsNotComparable: 1,
      unchanged: 0,
    });
  });

  it("requires complete saved and current coverage before calculating drift", () => {
    const scope = comparableScope();
    const partialSaved = {
      ...scope,
      provenance: {
        ...scope.provenance,
        vacancy: {
          ...scope.provenance.vacancy,
          coverage: {
            ...scope.provenance.vacancy.coverage!,
            status: "partial" as const,
          },
        },
      },
    };

    expect(
      assessDrawnAreaRecordDriftComparability(partialSaved, completeCoverage()),
    ).toMatchObject({
      status: "unavailable",
      reason: "saved-coverage-incomplete",
    });
    expect(
      assessDrawnAreaRecordDriftComparability(
        scope,
        completeCoverage({ coverageStatus: "partial" }),
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "current-coverage-incomplete",
    });
  });

  it("requires complete license screening on both ends for conflict-only drift", () => {
    const scope = comparableScope("conflicts");
    const incompleteSaved = {
      ...scope,
      provenance: {
        ...scope.provenance,
        vacancy: {
          ...scope.provenance.vacancy,
          coverage: {
            ...scope.provenance.vacancy.coverage!,
            licenseScreeningStatus: "partial" as const,
          },
        },
      },
    };
    expect(
      assessDrawnAreaRecordDriftComparability(incompleteSaved, completeCoverage()),
    ).toMatchObject({
      status: "unavailable",
      reason: "saved-license-screening-incomplete",
    });
    const partialCurrentScreening = completeCoverage({
      licenseScreening: {
        ...completeCoverage().licenseScreening,
        status: "partial",
      },
    });
    expect(
      assessDrawnAreaRecordDriftComparability(scope, partialCurrentScreening),
    ).toMatchObject({
      status: "unavailable",
      reason: "current-license-screening-incomplete",
    });
    expect(
      hasCompleteCurrentDrawnAreaSelection(scope, partialCurrentScreening),
    ).toBe(false);
    expect(
      hasCompleteCurrentDrawnAreaSelection(scope, completeCoverage()),
    ).toBe(true);
  });

  it("allows only safe external program and application links", () => {
    expect(safeVacancyProgramUrl("https://example.com/apply?q=1")).toBe(
      "https://example.com/apply?q=1",
    );
    expect(safeVacancyProgramUrl("http://example.com/program")).toBe(
      "http://example.com/program",
    );
    expect(safeVacancyProgramUrl("javascript:alert(1)")).toBeNull();
    expect(safeVacancyProgramUrl("not a url")).toBeNull();
  });
});
