// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import { unavailableCclbaSourceCoverage, type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import type { GeneratedReport } from "@/lib/report-engine";
import { INITIAL_WIZARD_STATE } from "@/lib/report-wizard-config";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { email: "test@example.com" } } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/incentive-preparation/StartPreparationPacketButton", () => ({
  StartPreparationPacketButton: () => null,
}));

vi.mock("@/components/workspace/SaveReportModal", () => ({
  SaveReportModal: () => null,
}));

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[
    [-87.65, 41.87],
    [-87.6, 41.87],
    [-87.6, 41.9],
    [-87.65, 41.9],
    [-87.65, 41.87],
  ]],
};

const COMPLETE_META: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-04T18:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-04T18:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-14T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-14T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 0, stale: 0, unknownDate: 1 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-15T04:38:00.000Z",
    candidateCount: 1,
    checkedCount: 1,
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
  returnedCount: 1,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
  cclbaSourceCoverage: unavailableCclbaSourceCoverage("snapshot_not_recorded"),
};

const CURRENT_NO_MATCH: GeoJSON.Feature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-87.62, 41.88] },
  properties: {
    id: "current-no-match",
    recordId: "cols:current-no-match",
    address: "101 S STATE ST",
    source: "cols",
    status: "city_owned",
    propertyType: "vacant_land",
    canonicalType: "land",
    sourceRecordDate: null,
    freshnessClass: "unknown_date",
    explorerRefreshedAt: COMPLETE_META.explorerRefreshedAt,
    zoneMatches: [],
    incentiveCount: 0,
    ownerType: "city_public",
    licenseCheckState: "no_match",
    currentLicenseMatches: [],
    licenseCheckedAt: COMPLETE_META.licenseScreening.checkedAt,
  },
};

function conflictsReport(): GeneratedReport {
  const created = createDrawnAreaReportScope({
    name: "79th Corridor — Ward 6",
    geometry: POLYGON,
    generatedAt: "2026-08-26T12:00:00.000Z",
    vacancy: {
      loadFailed: false,
      coverage: COMPLETE_META,
      freshnessFilter: "current_screening",
      licenseFilter: "conflicts",
      returnedCountBeforeFilters: 1,
      selectedFeatures: [{ properties: { recordId: "cols:saved-conflict" } }],
    },
  });
  if (!created.ok) throw new Error(created.detail);
  return {
    title: "79th Corridor — Ward 6",
    subtitle: "Drawn-area public-record vacancy signals and permit context",
    reportType: "best-location",
    generatedAt: created.scope.generatedAt,
    summary: "Saved exact-area conflict report.",
    sections: [],
    recommendedActions: [],
    metadata: {},
    drawnAreaScope: created.scope,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReportDisplay drawn-area vacancy fidelity", () => {
  it("fails closed when a conflict-only polygon refresh has partial license screening", async () => {
    const partialResponse = {
      type: "FeatureCollection",
      features: [CURRENT_NO_MATCH],
      meta: {
        ...COMPLETE_META,
        licenseScreening: {
          ...COMPLETE_META.licenseScreening,
          status: "partial",
          matchedPropertyCount: 0,
          malformedRowCount: 1,
          partialReasons: ["malformed_source_rows"],
        },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(partialResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={conflictsReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await screen.findByText(
      "Current license-conflict screening is partial. Record drift is withheld because the current conflict selection was not completely screened.",
    );

    const vacancyCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith("/api/vacant?"),
    );
    expect(vacancyCall).toBeDefined();
    const requestedUrl = new URL(String(vacancyCall?.[0]), "http://localhost");
    expect(requestedUrl.searchParams.has("communityArea")).toBe(false);
    expect(JSON.parse(requestedUrl.searchParams.get("polygon") ?? "null")).toEqual(
      POLYGON,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Incomplete")).toHaveLength(4);
    });
    expect(
      screen.getByText(
        "No conflict rows were returned, but current license screening is incomplete and cannot establish a clean zero.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No tracked vacancy records returned/)).toBeNull();
    for (const button of screen.getAllByRole("button", { name: "Download CSV" })) {
      expect(button).toHaveProperty("disabled", true);
    }
  });
});
