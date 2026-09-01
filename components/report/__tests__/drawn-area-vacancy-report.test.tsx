// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportDisplay } from "@/components/report/ReportDisplay";
import { createDrawnAreaReportScope } from "@/lib/drawn-area-report-scope";
import { unavailableCclbaSourceCoverage, type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import {
  PERMIT_AREA_DATA_WINDOW_LABEL,
  PERMIT_AREA_PORTAL_URL,
  PERMIT_AREA_SOURCE_LABEL,
  PERMIT_AREA_SOURCE_URL,
  type PermitAreaResult,
} from "@/lib/permit-area";
import { SECTION_IDS, type GeneratedReport } from "@/lib/report-engine";
import { INITIAL_WIZARD_STATE } from "@/lib/report-wizard-config";

const { downloadCsvMock } = vi.hoisted(() => ({
  downloadCsvMock: vi.fn(),
}));

vi.mock("@/lib/vacancy-spreadsheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-spreadsheet")>();
  return { ...actual, downloadCsv: downloadCsvMock };
});

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

const PERMIT_MONTHS = Array.from({ length: 36 }, (_, index) => {
  const month = new Date(Date.UTC(2023, 8 + index, 1))
    .toISOString()
    .slice(0, 7);
  return {
    month,
    count: month === "2025-07" || month === "2026-08" ? 1 : 0,
  };
});

const CURRENT_PERMIT_ANALYSIS: PermitAreaResult = {
  status: "ready",
  source: {
    label: PERMIT_AREA_SOURCE_LABEL,
    url: PERMIT_AREA_SOURCE_URL,
    portalUrl: PERMIT_AREA_PORTAL_URL,
  },
  dataWindow: PERMIT_AREA_DATA_WINDOW_LABEL,
  sourceRefresh: {
    asOf: "2026-08-28T00:00:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 2,
  distinctAddresses: 2,
  issueDateSpan: { first: "2025-07-01", latest: "2026-08-04" },
  rollingPulse: {
    asOf: "2026-08-04",
    current: {
      start: "2025-08-05",
      end: "2026-08-04",
      filings: 1,
      distinctAddresses: 1,
      addressedFilings: 1,
    },
    previous: {
      start: "2024-08-05",
      end: "2025-08-04",
      filings: 1,
      distinctAddresses: 1,
      addressedFilings: 1,
    },
    changeCount: 0,
    changePercent: 0,
  },
  monthlyBreakdown: PERMIT_MONTHS,
  topAddresses: [{ address: "100 S TARGET ST", count: 1 }],
  typeBreakdown: [
    {
      key: null,
      label: "Not recorded",
      sourceValue: "Not recorded",
      color: "#64748B",
      count: 2,
    },
  ],
  yearBreakdown: [
    { year: 2026, count: 1 },
    { year: 2025, count: 1 },
  ],
  statusBreakdown: [
    { status: "Issued", count: 1 },
    { status: "Pending", count: 1 },
  ],
  records: [
    {
      permitId: "PERMIT-TARGET",
      permitTypeKey: null,
      permitTypeLabel: "Not recorded",
      rawPermitType: null,
      address: "100 S TARGET ST",
      issueDate: "2026-08-04",
      permitStatus: "Issued",
      permitMilestone: null,
      workType: null,
      workDescription: "Target storefront work",
    },
    {
      permitId: "PERMIT-DROP",
      permitTypeKey: null,
      permitTypeLabel: "Not recorded",
      rawPermitType: null,
      address: "200 S DROP ST",
      issueDate: "2025-07-01",
      permitStatus: "Pending",
      permitMilestone: null,
      workType: null,
      workDescription: "Unrelated work",
    },
  ],
  recordsReturned: 2,
  recordsTruncated: false,
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

function savedWorkstationReport(): GeneratedReport {
  const created = createDrawnAreaReportScope({
    name: "79th saved field scan",
    geometry: POLYGON,
    generatedAt: "2026-08-26T12:00:00.000Z",
    vacancy: {
      loadFailed: false,
      coverage: {
        ...COMPLETE_META,
        returnedCount: 2,
        freshness: {
          ...COMPLETE_META.freshness,
          returnedCounts: { recent: 0, stale: 0, unknownDate: 2 },
        },
        licenseScreening: {
          ...COMPLETE_META.licenseScreening,
          candidateCount: 2,
          checkedCount: 2,
          matchedPropertyCount: 0,
        },
      },
      freshnessFilter: "current_screening",
      licenseFilter: "all",
      returnedCountBeforeFilters: 2,
      selectedFeatures: [{ properties: { recordId: "cols:keep" } }],
    },
    permit: { analysis: CURRENT_PERMIT_ANALYSIS },
    workstation: {
      activeEvidenceFamily: "permits",
      practitionerNotes: "Call the block club first.",
      vacancyFilters: {
        query: "KEEP",
        freshness: "current_screening",
        licenseConflict: "all",
        canonicalType: "land",
        ownerType: "all",
        zoneKey: "all",
        source: "cols",
      },
      permitFilters: {
        query: "TARGET",
        type: "all",
        status: "Issued",
        issueYear: "2026",
      },
    },
  });
  if (!created.ok) throw new Error(created.detail);

  return {
    title: "Area Analysis Report — 79th saved field scan",
    subtitle: "Drawn-area public-record vacancy signals and permit context",
    reportType: "best-location",
    generatedAt: created.scope.generatedAt,
    summary: "Saved exact-area workstation report.",
    sections: [
      {
        title: "Area Snapshot",
        description: "Saved evidence summary.",
        items: [{ label: "Vacancy Signals Shown", value: "1" }],
      },
      {
        title: "Practitioner Notes",
        description: "User-authored context.",
        items: [
          {
            label: "User-authored note",
            value: "Call the block club first.",
          },
        ],
      },
      {
        title: "Permit Filing Context",
        description: "Saved full-polygon permit summary.",
        items: [{ label: "Total Geocoded Filings", value: "2" }],
      },
      {
        title: "Recent Permit Records in Current View",
        description: "Saved filtered permit records.",
        items: [{ label: "PERMIT-TARGET", value: "100 S TARGET ST" }],
      },
      {
        title: "Provenance Chain",
        description: "Boundary provenance.",
        items: [
          {
            label: "Boundary Fingerprint",
            value: created.scope.scope.fingerprint,
          },
        ],
      },
    ],
    recommendedActions: [],
    metadata: {},
    drawnAreaScope: created.scope,
  };
}

afterEach(() => {
  cleanup();
  downloadCsvMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReportDisplay drawn-area vacancy fidelity", () => {
  it("rebuilds a saved area CSV from both current polygon feeds while preserving the saved workstation view", async () => {
    const currentKeep: GeoJSON.Feature = {
      ...CURRENT_NO_MATCH,
      properties: {
        ...CURRENT_NO_MATCH.properties,
        id: "keep",
        recordId: "cols:keep",
        address: "100 S KEEP ST",
      },
    };
    const currentDrop: GeoJSON.Feature = {
      ...CURRENT_NO_MATCH,
      properties: {
        ...CURRENT_NO_MATCH.properties,
        id: "drop",
        recordId: "cols:drop",
        address: "200 S DROP ST",
      },
    };
    const currentCoverage: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 2,
      freshness: {
        ...COMPLETE_META.freshness,
        returnedCounts: { recent: 0, stale: 0, unknownDate: 2 },
      },
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        candidateCount: 2,
        checkedCount: 2,
        matchedPropertyCount: 0,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [currentKeep, currentDrop],
            meta: currentCoverage,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response(JSON.stringify(CURRENT_PERMIT_ANALYSIS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={savedWorkstationReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    const downloadButton = screen.getByRole("button", { name: "Download CSV" });
    await waitFor(() => expect(downloadButton).toHaveProperty("disabled", false));
    expect(
      screen.getByRole("heading", {
        name: "Area Analysis — 79th saved field scan",
      }),
    ).toBeTruthy();

    const permitCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith("/api/permit-area?"),
    );
    expect(permitCall).toBeDefined();
    const permitUrl = new URL(String(permitCall?.[0]), "http://localhost");
    expect(JSON.parse(permitUrl.searchParams.get("polygon") ?? "null")).toEqual(
      POLYGON,
    );

    fireEvent.click(downloadButton);
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalledTimes(1));

    const [csv, filename] = downloadCsvMock.mock.calls[0] as [string, string];
    expect(filename).toMatch(
      /^area-report-79th-saved-field-scan-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv).toContain('"Area Name","79th saved field scan"');
    expect(csv).toContain('"Section","Boundary provenance"');
    expect(csv).toContain('"Section","Practitioner notes"');
    expect(csv).toContain("Call the block club first.");
    expect(csv).toContain(
      '"79th saved field scan","Active workstation filters","Search: KEEP; Evidence: Current inventory and recent reports; Vacancy type: Tracked land signal; Source: City-Owned Land Inventory"',
    );
    expect(csv).toContain('"79th saved field scan","cols:keep"');
    expect(csv).not.toContain('"79th saved field scan","cols:drop"');
    expect(csv).toContain(
      '"79th saved field scan","Active workstation filters","Search: TARGET; Recorded status: Issued; Issue year: 2026"',
    );
    expect(csv).toContain(
      '"79th saved field scan","Geocoded permit filings","2"',
    );
    expect(csv).toContain(
      '"79th saved field scan","Recent records before filters","2"',
    );
    expect(csv).toContain(
      '"79th saved field scan","Recent records exported","1"',
    );
    expect(csv).toContain('"79th saved field scan","PERMIT-TARGET"');
    expect(csv).not.toContain('"79th saved field scan","PERMIT-DROP"');

    expect(screen.getAllByText("Call the block club first.")).toHaveLength(1);
    expect(
      screen
        .getByText("Recent Permit Records in Current View")
        .closest("section")?.id,
    ).toBe("saved-area-permits");
  });

  it("exports an explicit unavailable permit disclosure after a saved-polygon permit refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const currentCoverage: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      returnedCount: 1,
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        matchedPropertyCount: 0,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                ...CURRENT_NO_MATCH,
                properties: {
                  ...CURRENT_NO_MATCH.properties,
                  id: "keep",
                  recordId: "cols:keep",
                  address: "100 S KEEP ST",
                },
              },
            ],
            meta: currentCoverage,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response("unavailable", { status: 503 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={savedWorkstationReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await screen.findByText(/Current permit records could not be refreshed/);
    const downloadButton = screen.getByRole("button", { name: "Download CSV" });
    await waitFor(() => expect(downloadButton).toHaveProperty("disabled", false));
    fireEvent.click(downloadButton);
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalledTimes(1));

    const [csv] = downloadCsvMock.mock.calls[0] as [string, string];
    expect(csv).toContain('"Section","Permit coverage"');
    expect(csv).toContain(
      '"79th saved field scan","Coverage status","Unavailable"',
    );
    expect(csv).not.toContain(
      '"79th saved field scan","Geocoded permit filings","0"',
    );
  });

  it("distinguishes a saved-filter zero from a source-level zero", async () => {
    const currentCoverage: VacancyCoverageMetadata = {
      ...COMPLETE_META,
      licenseScreening: {
        ...COMPLETE_META.licenseScreening,
        matchedPropertyCount: 0,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [CURRENT_NO_MATCH],
            meta: currentCoverage,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response(JSON.stringify(CURRENT_PERMIT_ANALYSIS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={savedWorkstationReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    expect(
      await screen.findByText(
        "No vacancy signals match the saved filters. The current source refresh returned 1 record inside this area before the saved evidence and workstation filters.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "No tracked vacancy records returned for this saved area.",
      ),
    ).toBeNull();
  });

  it("keeps the existing vacancy-only CSV contract for community-area reports", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?communityArea=")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [CURRENT_NO_MATCH],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const report: GeneratedReport = {
      title: "Vacancy Analysis",
      subtitle: "Community-area public-record signals",
      reportType: "best-location",
      generatedAt: "2026-08-26T12:00:00.000Z",
      summary: "Community-area vacancy report.",
      sections: [],
      recommendedActions: [],
      metadata: {},
    };

    render(
      <ReportDisplay
        report={report}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    const downloadButtons = screen.getAllByRole("button", {
      name: "Download CSV",
    });
    await waitFor(() =>
      expect(downloadButtons[0]).toHaveProperty("disabled", false),
    );
    fireEvent.click(downloadButtons[0]);
    await waitFor(() => expect(downloadCsvMock).toHaveBeenCalledTimes(1));

    const [csv, filename] = downloadCsvMock.mock.calls[0] as [string, string];
    expect(filename).toMatch(
      /^vacant-properties-chatham-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv).toContain("Record ID");
    expect(csv).toContain("cols:current-no-match");
    expect(csv).not.toContain('"Area Name","Chatham"');
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("/api/permit-area?"),
      ),
    ).toBe(false);
  });

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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(input).startsWith("/api/permit-area?")
            ? CURRENT_PERMIT_ANALYSIS
            : partialResponse,
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
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

/**
 * R3: both of VacancySpreadsheetSection's action rows used to be
 * hand-rebuilt copies of the controls ReportActionButtons owns — including
 * its seven copy strings and an inline re-implementation of the share gate
 * that lib/report-action-policy.ts owns. They now render the shared
 * component. These tests pin the two rows' EXISTING behavior, which the
 * consolidation had to preserve exactly: the workstation row has never had
 * a Share control, and the spreadsheet row's says "Share Spreadsheet".
 */
describe("vacancy action rows render through the shared ReportActionButtons", () => {
  it("the drawn-area workstation row keeps its generic controls and still has NO share button", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({ type: "FeatureCollection", features: [CURRENT_NO_MATCH] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response(JSON.stringify(CURRENT_PERMIT_ANALYSIS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={savedWorkstationReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy(),
    );
    // The vacancy policy's labels — the ones this row used to hardcode.
    expect(screen.getByRole("button", { name: "Save Report" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email This to Me" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New Search" }).length).toBeGreaterThan(0);
    // A drawn-area report is not shareable, and this row has never offered it.
    expect(screen.queryByRole("button", { name: "Share Report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share Spreadsheet" })).toBeNull();
  });

  it("the community-area spreadsheet row leads with the CSV export and labels its share control 'Share Spreadsheet'", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?communityArea=")) {
        return new Response(
          JSON.stringify({ type: "FeatureCollection", features: [CURRENT_NO_MATCH] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={{
          title: "Vacancy Analysis",
          subtitle: "Community-area public-record signals",
          reportType: "best-location",
          generatedAt: "2026-08-26T12:00:00.000Z",
          summary: "Community-area vacancy report.",
          sections: [],
          recommendedActions: [],
          metadata: {},
        }}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Download CSV" }).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole("button", { name: "Save Report" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Email This to Me" }).length).toBeGreaterThan(0);
    // The share control keeps this row's own wording, not the report wording.
    expect(screen.getAllByRole("button", { name: "Share Spreadsheet" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Share Report" })).toBeNull();
  });

});

/**
 * R3: the drawn-area section dispatch matched literal English titles while
 * persona lenses rename titles at lens time — so a lensed report's sections
 * silently fell out of their slots and reappeared under the generic "Saved
 * report detail" eyebrow at the bottom of the page. The slots are id-first
 * now; a section whose title has been renamed but whose stable id survives
 * must still land where it belongs.
 */
describe("drawn-area section dispatch is id-first", () => {
  function renameTitles(report: GeneratedReport, ids: Record<string, string>): GeneratedReport {
    return {
      ...report,
      sections: report.sections.map((section) => ({
        ...section,
        id: ids[section.title],
        // A persona lens rewrites the title; the id is what survives.
        title: `Lensed · ${section.title}`,
      })),
    };
  }

  async function renderLensedWorkstation() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({ type: "FeatureCollection", features: [CURRENT_NO_MATCH] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response(JSON.stringify(CURRENT_PERMIT_ANALYSIS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReportDisplay
        report={renameTitles(savedWorkstationReport(), {
          "Area Snapshot": SECTION_IDS.areaSnapshot,
          "Practitioner Notes": SECTION_IDS.practitionerNotes,
          "Permit Filing Context": SECTION_IDS.permitFilingContext,
          "Recent Permit Records in Current View":
            SECTION_IDS.recentPermitRecordsInCurrentView,
          "Provenance Chain": SECTION_IDS.provenanceChain,
        })}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Saved snapshot")).toBeTruthy());
  }

  it("keeps a renamed section in its slot when its stable id is intact", async () => {
    await renderLensedWorkstation();

    // The renamed titles are on screen — under their SLOT eyebrows.
    expect(screen.getByText("Lensed · Area Snapshot")).toBeTruthy();
    expect(screen.getByText("Lensed · Provenance Chain")).toBeTruthy();
    expect(screen.getByText("Boundary provenance")).toBeTruthy();
  });

  it("drops nothing into the generic 'Saved report detail' fallback list", async () => {
    await renderLensedWorkstation();

    // Every section in this fixture belongs to a recognized slot. Before the
    // id-first dispatch, renaming their titles pushed all five here.
    expect(screen.queryByText("Saved report detail")).toBeNull();
  });

  it("still dispatches a legacy saved report that has titles but no ids", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/vacant?")) {
        return new Response(
          JSON.stringify({ type: "FeatureCollection", features: [CURRENT_NO_MATCH] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/api/permit-area?")) {
        return new Response(JSON.stringify(CURRENT_PERMIT_ANALYSIS), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // savedWorkstationReport() predates the ids: title-only, as saved.
    render(
      <ReportDisplay
        report={savedWorkstationReport()}
        wizardState={{ ...INITIAL_WIZARD_STATE, neighborhood: "Chatham" }}
        onStartOver={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Saved snapshot")).toBeTruthy());
    expect(screen.getByText("Area Snapshot")).toBeTruthy();
    expect(screen.queryByText("Saved report detail")).toBeNull();
  });
});

