// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { unavailableCclbaSourceCoverage, type VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import type { PermitAreaResult } from "@/lib/permit-area";

const generateReportPdfMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } }, status: "authenticated" }),
}));
vi.mock("@/components/workspace/SaveReportModal", () => ({
  SaveReportModal: ({ reportData }: { reportData: unknown }) => (
    <output data-testid="saved-report-payload">{JSON.stringify(reportData)}</output>
  ),
}));
vi.mock("@/lib/pdf-report", () => ({
  generateReportPdf: generateReportPdfMock,
}));

import MapPolygonPanel from "@/components/map/MapPolygonPanel";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[
    [-87.7, 41.8],
    [-87.6, 41.8],
    [-87.6, 41.9],
    [-87.7, 41.8],
  ]],
};

function vacancyFeature(
  id: string,
  properties: Record<string, unknown>,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.63, 41.88] },
    properties: {
      id,
      address: `${id} S STATE ST`,
      explorerRefreshedAt: "2026-08-14T00:00:00.000Z",
      zoneMatches: [],
      currentLicenseMatches: [],
      licenseCheckedAt: "2026-08-14T00:00:00.000Z",
      ...properties,
    },
  };
}

const FEATURES = [
  vacancyFeature("100", {
    source: "cols",
    status: "city_owned",
    propertyType: "vacant_land",
    canonicalType: "land",
    sourceRecordDate: null,
    freshnessClass: "unknown_date",
    licenseCheckState: "no_match",
    zoneMatches: [
      { zoneKey: "energyCommunities", zoneName: "IRA Energy Community" },
      { zoneKey: "energyCommunities", zoneName: "IRA Energy Community" },
    ],
  }),
  vacancyFeature("200", {
    source: "dpd_vacant",
    status: "Open",
    propertyType: "vacant_building",
    canonicalType: "building",
    sourceRecordDate: "2026-01-01T00:00:00.000Z",
    freshnessClass: "recent",
    licenseCheckState: "match",
    currentLicenseMatches: [
      { name: "Current Cafe", description: "Retail Food", status: "AAI", expirationDate: "2027-01-01" },
    ],
  }),
  vacancyFeature("300", {
    source: "311_clean_lot",
    status: "Completed",
    propertyType: "reported_vacant_lot",
    canonicalType: "land",
    sourceRecordDate: "2021-07-01T00:00:00.000Z",
    freshnessClass: "stale",
    licenseCheckState: "match",
    currentLicenseMatches: [
      { name: "Older Signal Shop", description: "Limited Business", status: "AAI", expirationDate: "2027-04-01" },
    ],
  }),
];

const COVERAGE: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-14T00:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-14T00:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-14T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-14T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-14T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 1, stale: 1, unknownDate: 1 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-14T00:00:00.000Z",
    candidateCount: 3,
    checkedCount: 3,
    matchedPropertyCount: 2,
    capped: false,
    addressCap: 500,
    sourceCallCount: 1,
    successfulBatches: 1,
    failedBatches: 0,
    malformedRowCount: 0,
    partialReasons: [],
    caveats: [],
  },
  returnedCount: 3,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
  cclbaSourceCoverage: unavailableCclbaSourceCoverage("snapshot_not_recorded"),
};

const EMPTY_PERMIT_AREA: PermitAreaResult = {
  status: "ready",
  source: {
    label: "City of Chicago Building Permits",
    url: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    portalUrl:
      "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
  },
  dataWindow: "Issued since 2006",
  sourceRefresh: { asOf: null, asOfBasis: null },
  locatedRecordsOnly: true,
  totalFilings: 0,
  distinctAddresses: 0,
  issueDateSpan: null,
  rollingPulse: {
    asOf: null,
    current: {
      start: null,
      end: null,
      filings: 0,
      distinctAddresses: 0,
      addressedFilings: 0,
    },
    previous: {
      start: null,
      end: null,
      filings: 0,
      distinctAddresses: 0,
      addressedFilings: 0,
    },
    changeCount: 0,
    changePercent: null,
  },
  monthlyBreakdown: [],
  topAddresses: [],
  typeBreakdown: [],
  yearBreakdown: [],
  statusBreakdown: [],
  records: [],
  recordsReturned: 0,
  recordsTruncated: false,
};

const PERMIT_RECORDS = Array.from({ length: 30 }, (_, index) => ({
  permitId: `P-${String(index + 1).padStart(3, "0")}`,
  permitTypeKey: "new_construction" as const,
  permitTypeLabel: "New Construction",
  rawPermitType: "PERMIT - NEW CONSTRUCTION",
  address: `${100 + index} S BUILD WAY`,
  issueDate: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
  permitStatus: index % 2 === 0 ? "ACTIVE" : "PENDING",
  permitMilestone: "Issued",
  workType: "New construction",
  workDescription: `Construct project ${index + 1}`,
}));

const PERMIT_AREA_WITH_RECORDS: PermitAreaResult = {
  ...EMPTY_PERMIT_AREA,
  sourceRefresh: {
    asOf: "2026-08-28T00:00:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  totalFilings: 30,
  distinctAddresses: 30,
  issueDateSpan: { first: "2026-08-01", latest: "2026-08-28" },
  typeBreakdown: [
    {
      key: "new_construction",
      label: "New Construction",
      sourceValue: "PERMIT - NEW CONSTRUCTION",
      color: "#059669",
      count: 30,
    },
  ],
  yearBreakdown: [{ year: 2026, count: 30 }],
  statusBreakdown: [
    { status: "ACTIVE", count: 15 },
    { status: "PENDING", count: 15 },
  ],
  records: PERMIT_RECORDS,
  recordsReturned: 30,
};

const ZERO_COVERAGE: VacancyCoverageMetadata = {
  ...COVERAGE,
  freshness: {
    ...COVERAGE.freshness,
    returnedCounts: { recent: 0, stale: 0, unknownDate: 0 },
  },
  licenseScreening: {
    ...COVERAGE.licenseScreening,
    candidateCount: 0,
    checkedCount: 0,
    matchedPropertyCount: 0,
  },
  returnedCount: 0,
};

function panel(overrides: Partial<React.ComponentProps<typeof MapPolygonPanel>> = {}) {
  return (
    <MapPolygonPanel
      results={{ type: "FeatureCollection", features: FEATURES }}
      loading={false}
      vacancyCoverage={COVERAGE}
      polygon={POLYGON}
      permitArea={EMPTY_PERMIT_AREA}
      permitFetchImpl={vi.fn(() => new Promise<Response>(() => {})) as typeof fetch}
      onClose={() => {}}
      onClear={() => {}}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  generateReportPdfMock.mockClear();
});

describe("MapPolygonPanel vacancy evidence interactions", () => {
  it("cascades freshness and license filters into the displayed map feature set", async () => {
    const onDisplayedFeaturesChange = vi.fn();
    render(panel({ onDisplayedFeaturesChange }));

    expect(screen.getByText("100 S STATE ST")).toBeTruthy();
    expect(screen.getByText(/1 bounded source calls/)).toBeTruthy();
    expect(screen.getByText("200 S STATE ST")).toBeTruthy();
    expect(screen.queryByText("300 S STATE ST")).toBeNull();
    await waitFor(() => {
      const calls = onDisplayedFeaturesChange.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toHaveLength(2);
    });

    fireEvent.change(screen.getByLabelText("Vacancy evidence timeframe"), {
      target: { value: "all_records" },
    });
    expect(screen.getByText("300 S STATE ST")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Current-license conflict filter"), {
      target: { value: "conflicts" },
    });
    expect(screen.queryByText("100 S STATE ST")).toBeNull();
    expect(screen.getByText("200 S STATE ST")).toBeTruthy();
    expect(screen.getByText("300 S STATE ST")).toBeTruthy();
    await waitFor(() => {
      const calls = onDisplayedFeaturesChange.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toHaveLength(2);
    });
  });

  it("keeps edit lifecycle explicit, hides stale findings, and is keyboard-addressable", async () => {
    const onEdit = vi.fn();
    const onEditDone = vi.fn();
    const onEditCancel = vi.fn();
    const onDisplayedFeaturesChange = vi.fn();
    const view = render(
      panel({ onEdit, onEditDone, onEditCancel, onDisplayedFeaturesChange }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit area" }));
    expect(onEdit).toHaveBeenCalledOnce();

    view.rerender(
      panel({
        editing: true,
        editDirty: true,
        onEdit,
        onEditDone,
        onEditCancel,
        onDisplayedFeaturesChange,
      }),
    );
    expect(
      screen.getAllByRole("status").some((node) =>
        node.textContent?.includes("Boundary changed"),
      ),
    ).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Done" }),
      );
    });
    expect(screen.getByRole("button", { name: "Done" }).className).toContain(
      "min-h-11",
    );
    expect(screen.queryByText("100 S STATE ST")).toBeNull();
    await waitFor(() => {
      const calls = onDisplayedFeaturesChange.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual([]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    view.rerender(
      panel({
        editing: false,
        loading: true,
        onEdit,
        onEditDone,
        onEditCancel,
        onDisplayedFeaturesChange,
      }),
    );
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("Analyzing area");
    });
    view.rerender(
      panel({
        editing: false,
        loading: false,
        onEdit,
        onEditDone,
        onEditCancel,
        onDisplayedFeaturesChange,
      }),
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit area" }),
      );
    });
    view.rerender(
      panel({
        editing: true,
        onEdit,
        onEditDone,
        onEditCancel,
        onDisplayedFeaturesChange,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEditDone).toHaveBeenCalledOnce();
    expect(onEditCancel).toHaveBeenCalledOnce();
  });

  it("bounds the on-screen property DOM while preserving the full-set disclosure", () => {
    const manyFeatures = Array.from({ length: 150 }, (_, index) =>
      vacancyFeature(`scale-${index}`, {
        source: "cols",
        status: "city_owned",
        propertyType: "vacant_land",
        canonicalType: "land",
        sourceRecordDate: null,
        freshnessClass: "unknown_date",
        licenseCheckState: "no_match",
      }),
    );
    render(
      panel({
        results: { type: "FeatureCollection", features: manyFeatures },
      }),
    );

    expect(screen.getAllByTitle(/Generate location snapshot for/)).toHaveLength(100);
    expect(screen.getByText(/Showing the first 100 of 150 signals/)).toBeTruthy();
    expect(screen.getByText(/CSV contains every row/)).toBeTruthy();
  });

  it("distinguishes Cook County land-bank inventory from City ownership", () => {
    const cclba = vacancyFeature("cclba-42", {
      source: "cclba",
      status: "Acquired",
      propertyType: "vacant_land",
      canonicalType: "land",
      sourceRecordDate: null,
      freshnessClass: "unknown_date",
      licenseCheckState: "no_match",
      ownerName: "Cook County Land Bank Authority",
      ownerType: "city_public",
      ownerJurisdiction: "cook_county",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceUrl: "https://public-cclba.epropertyplus.com/",
      programName: null,
      managingOrganization: null,
      applicationUrl: null,
      programContext: [
        {
          sourceRowId: "42",
          currentStatus: "Acquired",
          inventoryType: "Vacant Land",
          propertyClass: "Residential Land",
        },
      ],
    });
    render(
      panel({
        results: { type: "FeatureCollection", features: [cclba] },
        vacancyCoverage: { ...COVERAGE, returnedCount: 1 },
      }),
    );

    expect(screen.getByText(/classified as public ownership/i)).toBeTruthy();
    expect(screen.queryByText(/is city-owned/i)).toBeNull();
    expect(
      screen
        .getByRole("link", {
          name: "Cook County Land Bank Authority Published Property Inventory",
        })
        .getAttribute("href"),
    ).toBe("https://public-cclba.epropertyplus.com/");
    expect(
      screen.getByText(/Source status: Acquired/),
    ).toBeTruthy();
    expect(screen.getByText(/Source row ID=42/)).toBeTruthy();
    expect(screen.getByText(/Inventory type=Vacant Land/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review published program record ↗" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));
    const payload = screen.getByTestId("saved-report-payload").textContent ?? "";
    expect(payload).toContain(
      "Source status: Acquired",
    );
    expect(payload).toContain("Source row ID=42");
    expect(payload).not.toContain("Published program / disposition context");
    expect(payload).toContain('"id":"cook-county-land-bank-inventory"');
    expect(payload).toContain(
      '"url":"https://public-cclba.epropertyplus.com/"',
    );
  });

  it("does not turn a metadata-less CCLBA row into an official inventory source", () => {
    const legacyCclba = vacancyFeature("cclba-legacy", {
      source: "cclba",
      status: "Acquired",
      propertyType: "vacant_land",
      canonicalType: "land",
      sourceRecordDate: null,
      freshnessClass: "unknown_date",
      licenseCheckState: "no_match",
      ownerName: "Cook County Land Bank Authority",
      ownerType: "city_public",
      ownerJurisdiction: "cook_county",
    });
    render(
      panel({
        results: { type: "FeatureCollection", features: [legacyCclba] },
        vacancyCoverage: { ...COVERAGE, returnedCount: 1 },
      }),
    );

    expect(
      screen.getByText("Cook County Land Bank Authority public record"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Data: source-attributed public records/),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Data:.*Cook County Land Bank Authority public inventory/),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));
    const payload = screen.getByTestId("saved-report-payload").textContent ?? "";
    const report = JSON.parse(payload) as {
      dataSources?: Array<{ id?: string; label?: string; url?: string }>;
    };
    expect(
      report.dataSources?.some(
        (source) => source.id === "cook-county-land-bank-inventory",
      ),
    ).toBe(false);
    expect(payload).not.toContain(
      "Cook County Land Bank Authority Published Property Inventory",
    );
    expect(
      report.dataSources?.some(
        (source) =>
          source.url === "https://public-cclba.epropertyplus.com/",
      ),
    ).toBe(false);
  });

  it("holds save, email, and CSV actions until vacancy and permit lookups settle", () => {
    render(panel({ permitArea: undefined }));

    for (const name of ["Save Report", "Email This to Me", "Export Area Data (CSV)"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(
      screen.getByText(
        "Save, email, PDF, and CSV export will be available after the vacancy and permit lookups finish.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("saved-report-payload")).toBeNull();
  });

  it("fails closed when exact boundary provenance cannot be created", () => {
    const featureWithMalformedSnapshot = vacancyFeature("invalid-snapshot", {
      source: "cols",
      status: "city_owned",
      propertyType: "vacant_land",
      canonicalType: "land",
      sourceRecordDate: null,
      freshnessClass: "unknown_date",
      licenseCheckState: "no_match",
      sourceSnapshotId: 123,
    });
    render(
      panel({
        results: { type: "FeatureCollection", features: [featureWithMalformedSnapshot] },
        vacancyCoverage: { ...COVERAGE, returnedCount: 1 },
      }),
    );

    for (const name of ["Save Report", "Email This to Me", "Export Area Data (CSV)"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(
      screen.getByText(
        "Save, email, PDF, and CSV export are unavailable because the exact boundary provenance could not be created.",
      ),
    ).toBeTruthy();
  });

  it("keeps a completed zero-result analysis available for every export action", () => {
    render(
      panel({
        results: { type: "FeatureCollection", features: [] },
        vacancyCoverage: ZERO_COVERAGE,
        permitArea: EMPTY_PERMIT_AREA,
      }),
    );

    for (const name of [
      "Save Report",
      "Email This to Me",
      "Download PDF",
      "Export Area Data (CSV)",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", false);
    }
  });

  it("labels the email artifact as an Area Analysis", () => {
    render(panel());

    fireEvent.click(screen.getByRole("button", { name: "Email This to Me" }));

    expect(screen.getByText("Email Area Analysis")).toBeTruthy();
    expect(screen.queryByText("Email Vacancy Report")).toBeNull();
  });

  it("carries zero-match permit filters into saved and PDF reports", async () => {
    render(
      panel({
        permitArea: PERMIT_AREA_WITH_RECORDS,
        permitWorkstationFilters: {
          query: "no matching permit",
          type: "all",
          status: "all",
          issueYear: "all",
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));
    const report = JSON.parse(
      screen.getByTestId("saved-report-payload").textContent ?? "{}",
    ) as {
      sections?: Array<{
        title?: string;
        description?: string;
        items?: Array<{ label?: string; value?: string; detail?: string }>;
      }>;
    };
    const permitContext = report.sections?.find(
      (section) => section.title === "Permit Filing Context",
    );
    const recentRecords = report.sections?.find(
      (section) => section.title === "Recent Permit Records in Current View",
    );

    expect(
      permitContext?.items?.find((item) => item.label === "Active Permit Record Filters")?.value,
    ).toContain("Search: no matching permit");
    expect(recentRecords?.description).toContain("0 of 30 recent records");
    expect(
      recentRecords?.items?.find((item) => item.label === "Matching Recent Records")?.value,
    ).toBe("0 of 30");
    expect(
      recentRecords?.items?.find((item) => item.label === "Records Included in This Snapshot")?.value,
    ).toBe("0 of 0");

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(generateReportPdfMock).toHaveBeenCalledOnce());
    const pdfReport = generateReportPdfMock.mock.calls[0]?.[0] as typeof report;
    expect(
      pdfReport.sections
        ?.find((section) => section.title === "Permit Filing Context")
        ?.items?.find((item) => item.label === "Active Permit Record Filters")
        ?.value,
    ).toContain("Search: no matching permit");
  });

  it("discloses the 25-record report snapshot cap while preserving the full filtered count", () => {
    render(panel({ permitArea: PERMIT_AREA_WITH_RECORDS }));
    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));

    const report = JSON.parse(
      screen.getByTestId("saved-report-payload").textContent ?? "{}",
    ) as {
      sections?: Array<{
        title?: string;
        description?: string;
        items?: Array<{ label?: string; value?: string; detail?: string }>;
      }>;
    };
    const recentRecords = report.sections?.find(
      (section) => section.title === "Recent Permit Records in Current View",
    );

    expect(recentRecords?.description).toContain("includes 25 of those 30");
    expect(
      recentRecords?.items?.find((item) => item.label === "Records Included in This Snapshot")?.value,
    ).toBe("25 of 30");
    expect(
      recentRecords?.items?.find((item) => item.label === "Records Included in This Snapshot")?.detail,
    ).toContain("Export the CSV for all 30 filtered recent records");
  });

  it("serializes clean-lot, source-date, freshness and license evidence into the saved report", () => {
    render(panel());
    fireEvent.change(screen.getByLabelText("Vacancy evidence timeframe"), {
      target: { value: "all_records" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));
    const payload = screen.getByTestId("saved-report-payload").textContent ?? "";
    expect(payload).toContain("300 S STATE ST");
    expect(payload).toContain("Tracked land signal");
    expect(payload).toContain("311 Clean Vacant Lot Request");
    expect(payload).toContain("2021-07-01");
    expect(payload).toContain("Source status: Completed");
    expect(payload).toContain("Current-license conflict");
    expect(payload).toContain("Vacancy Evidence Filter");
    expect(payload).toContain("All retained source records");
    expect(payload).toContain("License Screening Coverage");
    expect(payload).toContain("Checked 3 of 3 candidate exact addresses");
    expect(payload).toContain(
      '"value":"1 signal","detail":"33% of the displayed vacancy signals fall within this zone."',
    );
    expect(payload).not.toContain('300 S STATE ST\",\"value\":\"Vacant building');
  });

  it("uses the editable area name as the saved report identity", () => {
    render(panel());
    fireEvent.change(screen.getByLabelText("Area Name"), {
      target: { value: "79th Corridor — Ward 6" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Report" }));

    const payload = JSON.parse(
      screen.getByTestId("saved-report-payload").textContent ?? "{}",
    ) as {
      title?: string;
      metadata?: { address?: string };
      drawnAreaScope?: {
        name?: string;
        scope?: { geometry?: GeoJSON.Polygon; fingerprint?: string };
        provenance?: {
          vacancy?: {
            selectedCount?: number;
            recordRefsAtGeneration?: Array<{ recordId?: string }>;
          };
        };
      };
    };
    expect(payload.title).toBe("Area Analysis Report — 79th Corridor — Ward 6");
    expect(payload.metadata?.address).toBe("79th Corridor — Ward 6");
    expect(payload.drawnAreaScope?.name).toBe("79th Corridor — Ward 6");
    expect(payload.drawnAreaScope?.scope?.geometry).toEqual(POLYGON);
    expect(payload.drawnAreaScope?.scope?.fingerprint).toMatch(/^polygon-v1-/);
    expect(payload.drawnAreaScope?.provenance?.vacancy?.selectedCount).toBe(2);
    expect(
      payload.drawnAreaScope?.provenance?.vacancy?.recordRefsAtGeneration,
    ).toEqual([{ recordId: "100" }, { recordId: "200" }]);
  });
});
