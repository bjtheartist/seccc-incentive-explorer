// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test@example.com" } }, status: "authenticated" }),
}));
vi.mock("@/components/workspace/SaveReportModal", () => ({
  SaveReportModal: ({ reportData }: { reportData: unknown }) => (
    <output data-testid="saved-report-payload">{JSON.stringify(reportData)}</output>
  ),
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
};

function panel(overrides: Partial<React.ComponentProps<typeof MapPolygonPanel>> = {}) {
  return (
    <MapPolygonPanel
      results={{ type: "FeatureCollection", features: FEATURES }}
      loading={false}
      vacancyCoverage={COVERAGE}
      polygon={POLYGON}
      permitFetchImpl={vi.fn(() => new Promise<Response>(() => {})) as typeof fetch}
      onClose={() => {}}
      onClear={() => {}}
      {...overrides}
    />
  );
}

afterEach(cleanup);

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
});
