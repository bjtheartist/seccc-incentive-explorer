// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { PermitAreaResult } from "@/lib/permit-area";
import {
  DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS,
  DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
  type AreaAnalysisEvidenceFamilyId,
  type AreaPermitWorkstationFilters,
  type AreaVacancyWorkstationFilters,
} from "@/lib/area-analysis-workstation";
import {
  unavailableCclbaSourceCoverage,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";
import type { CommunityInvestmentLayerResult } from "@/lib/community-investment-layer";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { email: "practitioner@example.com" } },
    status: "authenticated",
  }),
}));
vi.mock("@/components/workspace/SaveReportModal", () => ({
  SaveReportModal: () => null,
}));

import MapPolygonPanel, {
  __resetPolygonInvestmentCache,
} from "@/components/map/MapPolygonPanel";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[
    [-87.7, 41.8],
    [-87.69, 41.8],
    [-87.69, 41.81],
    [-87.7, 41.81],
    [-87.7, 41.8],
  ]],
};

function vacancyFeature(
  id: string,
  address: string,
  ownerName: string,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.63, 41.88] },
    properties: {
      id,
      address,
      ownerName,
      ownerType: "local_private",
      source: "dpd_vacant",
      status: "Open",
      propertyType: "vacant_building",
      canonicalType: "building",
      sourceRecordDate: "2026-01-01T00:00:00.000Z",
      freshnessClass: "recent",
      licenseCheckState: "no_match",
      currentLicenseMatches: [],
      zoneMatches: [],
    },
  };
}

const PERMITS: PermitAreaResult = {
  status: "ready",
  source: {
    label: "City of Chicago Building Permits",
    url: "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    portalUrl: "https://webapps1.chicago.gov/buildingrecords/",
  },
  dataWindow: "Issued since 2006",
  sourceRefresh: {
    asOf: "2026-08-28T00:00:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 2,
  distinctAddresses: 2,
  issueDateSpan: { first: "2025-01-01", latest: "2026-08-01" },
  rollingPulse: {
    asOf: "2026-08-01",
    current: { start: "2025-08-02", end: "2026-08-01", filings: 1, distinctAddresses: 1, addressedFilings: 1 },
    previous: { start: "2024-08-02", end: "2025-08-01", filings: 1, distinctAddresses: 1, addressedFilings: 1 },
    changeCount: 0,
    changePercent: 0,
  },
  monthlyBreakdown: [],
  topAddresses: [],
  typeBreakdown: [
    { key: "new_construction", label: "New Construction", sourceValue: "PERMIT - NEW CONSTRUCTION", color: "#059669", count: 1 },
    { key: null, label: "PERMIT - SOLAR", sourceValue: "PERMIT - SOLAR", color: "#64748B", count: 1 },
  ],
  yearBreakdown: [{ year: 2026, count: 1 }, { year: 2025, count: 1 }],
  statusBreakdown: [{ status: "ACTIVE", count: 1 }, { status: "PENDING", count: 1 }],
  records: [
    {
      permitId: "P-100",
      permitTypeKey: "new_construction",
      permitTypeLabel: "New Construction",
      rawPermitType: "PERMIT - NEW CONSTRUCTION",
      address: "100 S BUILD WAY",
      issueDate: "2025-01-01",
      permitStatus: "ACTIVE",
      permitMilestone: "Issued",
      workType: "New construction",
      workDescription: "Construct a mixed-use building",
    },
    {
      permitId: "P-200",
      permitTypeKey: null,
      permitTypeLabel: "PERMIT - SOLAR",
      rawPermitType: "PERMIT - SOLAR",
      address: "500 W SOLAR WAY",
      issueDate: "2026-08-01",
      permitStatus: "PENDING",
      permitMilestone: "Review",
      workType: "Solar",
      workDescription: "Install rooftop solar array",
    },
  ],
  recordsReturned: 2,
  recordsTruncated: false,
};

const VACANCY_COVERAGE: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-28T00:00:00.000Z",
  asOfBasis: "explorer_refresh_timestamp",
  explorerRefreshedAt: "2026-08-28T00:00:00.000Z",
  freshness: {
    policyVersion: "source-record-date-v1",
    referenceDate: "2026-08-28T00:00:00.000Z",
    recentWithinYears: 3,
    cutoffDate: "2023-08-28T00:00:00.000Z",
    retainedWithinYears: 5,
    retentionPolicyCutoffDate: "2021-08-28T00:00:00.000Z",
    retentionCutoffBasis: "current_request_reference_policy",
    returnedCounts: { recent: 2, stale: 0, unknownDate: 0 },
  },
  licenseScreening: {
    policyVersion: "issued-exact-address-v4",
    sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
    status: "available",
    checkedAt: "2026-08-28T00:00:00.000Z",
    candidateCount: 2,
    checkedCount: 2,
    matchedPropertyCount: 0,
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
};

const ZERO_VACANCY_COVERAGE: VacancyCoverageMetadata = {
  ...VACANCY_COVERAGE,
  freshness: {
    ...VACANCY_COVERAGE.freshness,
    returnedCounts: { recent: 0, stale: 0, unknownDate: 0 },
  },
  licenseScreening: {
    ...VACANCY_COVERAGE.licenseScreening,
    candidateCount: 0,
    checkedCount: 0,
    matchedPropertyCount: 0,
  },
  returnedCount: 0,
};

const EMPTY_INVESTMENT_LAYER: CommunityInvestmentLayerResult = {
  status: "ready",
  pointFeatures: [],
  presentFunderTypes: [],
  presentGovernmentFundingPurposes: [],
  presentCapitalClasses: [],
  citywide: { count: 0, totalDollars: 0 },
  citywideEntries: [],
  countyReliefByZip: [],
  state2020ReliefByZip: [],
  stateRecoveryByZip: [],
  stateCapitalCitywideCount: 0,
  federalRestaurantReliefCitywideCount: 0,
  state2020HospitalityCitywideCount: 0,
  citywideDevelopmentNames: [],
  funderHqs: [],
};

function WorkstationHarness() {
  const [open, setOpen] = useState(true);
  const [areaName, setAreaName] = useState("South Shore field review");
  const [notes, setNotes] = useState("");
  const [family, setFamily] = useState<AreaAnalysisEvidenceFamilyId>("overview");
  const [vacancyFilters, setVacancyFilters] =
    useState<AreaVacancyWorkstationFilters>({
      ...DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
      freshness: "current_screening",
    });
  const [permitFilters, setPermitFilters] =
    useState<AreaPermitWorkstationFilters>({
      ...DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS,
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Reopen workstation</button>
      {open && (
        <MapPolygonPanel
          results={{
            type: "FeatureCollection",
            features: [
              vacancyFeature("100", "100 S STATE ST", "Alpha Owner"),
              vacancyFeature("200", "200 S BETA AVE", "Beta Bakery LLC"),
            ],
          }}
          loading={false}
          polygon={POLYGON}
          permitArea={PERMITS}
          vacancyCoverage={VACANCY_COVERAGE}
          areaName={areaName}
          onAreaNameChange={setAreaName}
          practitionerNotes={notes}
          onPractitionerNotesChange={setNotes}
          activeEvidenceFamily={family}
          onActiveEvidenceFamilyChange={setFamily}
          vacancyWorkstationFilters={vacancyFilters}
          onVacancyWorkstationFiltersChange={setVacancyFilters}
          permitWorkstationFilters={permitFilters}
          onPermitWorkstationFiltersChange={setPermitFilters}
          onClose={() => setOpen(false)}
          onClear={() => {}}
        />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  __resetPolygonInvestmentCache();
});

describe("Area Analysis practitioner workstation", () => {
  it("preserves the label, notes, active evidence family, and filters through close and reopen", async () => {
    render(<WorkstationHarness />);

    fireEvent.change(screen.getByLabelText("Area Name"), {
      target: { value: "79th Street acquisition scan" },
    });
    fireEvent.change(screen.getByLabelText("Practitioner notes"), {
      target: { value: "Confirm title holder before the CDFI handoff." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Vacancy 2$/ }));
    fireEvent.change(screen.getByLabelText("Search vacancy records"), {
      target: { value: "Beta Bakery" },
    });

    expect(screen.getByRole("button", { name: /^Vacancy 1$/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("200 S BETA AVE")).toBeTruthy();
    expect(screen.queryByText("100 S STATE ST")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close area analysis" }));
    expect(screen.queryByTestId("area-analysis-workstation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen workstation" }));

    expect((screen.getByLabelText("Area Name") as HTMLInputElement).value).toBe(
      "79th Street acquisition scan",
    );
    expect((screen.getByLabelText("Practitioner notes") as HTMLTextAreaElement).value).toBe(
      "Confirm title holder before the CDFI handoff.",
    );
    expect((screen.getByLabelText("Search vacancy records") as HTMLInputElement).value).toBe(
      "Beta Bakery",
    );
    expect(screen.getByRole("button", { name: /^Vacancy 1$/ }).getAttribute("aria-current")).toBe("page");

    await waitFor(() => expect(screen.getByText("200 S BETA AVE")).toBeTruthy());
  });

  it("filters the returned permit ledger without rewriting full-polygon aggregates", () => {
    render(<WorkstationHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Permit activity 2$/ }));
    fireEvent.change(screen.getByLabelText("Search permit records"), {
      target: { value: "solar array" },
    });

    expect(screen.getByText(/1 of 2 recent records in view/i)).toBeTruthy();
    expect(screen.getByText("500 W SOLAR WAY")).toBeTruthy();
    expect(screen.getByText(/The 2 full-polygon filing total and aggregate charts do not change/i)).toBeTruthy();
  });

  it("does not offer Reset filters for the baseline current-screening view", () => {
    render(<WorkstationHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Vacancy 2$/ }));

    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search vacancy records"), {
      target: { value: "Beta Bakery" },
    });
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    fireEvent.change(screen.getByLabelText("Vacancy evidence timeframe"), {
      target: { value: "all_records" },
    });
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });

  it("explains a zero-match vacancy filter while keeping the evidence view exportable", () => {
    render(<WorkstationHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Vacancy 2$/ }));
    fireEvent.change(screen.getByLabelText("Search vacancy records"), {
      target: { value: "No matching parcel" },
    });

    const emptyState = screen.getByTestId("vacancy-filter-empty-state");
    expect(emptyState).toBeTruthy();
    expect(within(emptyState).getByText("No vacancy signals match these filters")).toBeTruthy();
    expect(within(emptyState).getByText(/boundary returned 2 tracked signals/i)).toBeTruthy();
    expect(screen.queryByTestId("vacancy-clean-zero-state")).toBeNull();
    expect(screen.queryByTestId("vacancy-partial-state")).toBeNull();
    expect(screen.queryByTestId("vacancy-unavailable-state")).toBeNull();
    expect(screen.getByRole("button", { name: "Export Area Data (CSV)" }).hasAttribute("disabled")).toBe(false);
  });

  it("identifies a completed zero-result vacancy lookup without implying complete occupancy", () => {
    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        vacancyCoverage={ZERO_VACANCY_COVERAGE}
        polygon={POLYGON}
        permitArea={PERMITS}
        activeEvidenceFamily="vacancy"
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    const zeroState = screen.getByTestId("vacancy-clean-zero-state");
    expect(within(zeroState).getByText("No tracked vacancy signals returned")).toBeTruthy();
    expect(within(zeroState).getByText(/lookup completed successfully with zero returned signals/i)).toBeTruthy();
    expect(within(zeroState).getByText(/does not establish that every property is occupied or available/i)).toBeTruthy();
    expect(screen.queryByTestId("vacancy-partial-state")).toBeNull();
    expect(screen.queryByTestId("vacancy-unavailable-state")).toBeNull();
  });

  it("identifies partial vacancy coverage as incomplete evidence rather than a clean zero", () => {
    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        vacancyCoverage={{
          ...ZERO_VACANCY_COVERAGE,
          sourceMode: "static_fallback",
          sourcePath: "/data/vacant-properties.json",
          asOfBasis: "static_export_generated_at",
          coverageStatus: "partial",
          queryLimit: null,
          fallbackReason: "database_query_failed",
        }}
        polygon={POLYGON}
        permitArea={PERMITS}
        activeEvidenceFamily="vacancy"
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    const partialState = screen.getByTestId("vacancy-partial-state");
    expect(within(partialState).getByText("Partial vacancy source coverage")).toBeTruthy();
    expect(within(partialState).getByText(/published static fallback was used/i)).toBeTruthy();
    expect(within(partialState).getByText(/not evidence that no tracked vacancy exists/i)).toBeTruthy();
    expect(screen.queryByTestId("vacancy-clean-zero-state")).toBeNull();
  });

  it("identifies an unavailable vacancy lookup as a failure rather than a clean zero", () => {
    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        vacancyLoadFailed
        polygon={POLYGON}
        permitArea={PERMITS}
        activeEvidenceFamily="vacancy"
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    const unavailableState = screen.getByTestId("vacancy-unavailable-state");
    expect(within(unavailableState).getByText("Vacancy lookup unavailable")).toBeTruthy();
    expect(within(unavailableState).getByText(/lookup failure, not evidence/i)).toBeTruthy();
    expect(screen.queryByTestId("vacancy-clean-zero-state")).toBeNull();
  });

  it("keeps a failed admin investment fetch visible and distinct from a successful zero", async () => {
    const investmentFetchImpl = vi.fn(async () => {
      throw new Error("investment source offline");
    }) as unknown as typeof fetch;

    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        vacancyCoverage={ZERO_VACANCY_COVERAGE}
        polygon={POLYGON}
        permitArea={PERMITS}
        adminSessionActive
        investmentFetchImpl={investmentFetchImpl}
        activeEvidenceFamily="investment"
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    const unavailableState = await screen.findByTestId("investment-unavailable-state");
    expect(within(unavailableState).getByText("Public investment lookup unavailable")).toBeTruthy();
    expect(within(unavailableState).getByText(/source failure, not evidence/i)).toBeTruthy();
    expect(screen.queryByTestId("investment-clean-zero-state")).toBeNull();
    expect(investmentFetchImpl).toHaveBeenCalledOnce();
  });

  it("identifies a successful zero-result investment lookup without implying no investment", () => {
    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        vacancyCoverage={ZERO_VACANCY_COVERAGE}
        polygon={POLYGON}
        permitArea={PERMITS}
        adminSessionActive
        investmentLayer={EMPTY_INVESTMENT_LAYER}
        activeEvidenceFamily="investment"
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    const zeroState = screen.getByTestId("investment-clean-zero-state");
    expect(within(zeroState).getByText("No sited investment records returned")).toBeTruthy();
    expect(within(zeroState).getByText(/lookup completed successfully/i)).toBeTruthy();
    expect(within(zeroState).getByText(/does not establish that no public or private investment has occurred/i)).toBeTruthy();
    expect(screen.queryByTestId("investment-unavailable-state")).toBeNull();
  });

  it("explains an empty Area Context view instead of rendering a blank tab", () => {
    render(
      <MapPolygonPanel
        results={{ type: "FeatureCollection", features: [] }}
        loading={false}
        polygon={POLYGON}
        permitArea={{
          ...PERMITS,
          totalFilings: 0,
          distinctAddresses: 0,
          issueDateSpan: null,
          typeBreakdown: [],
          yearBreakdown: [],
          statusBreakdown: [],
          records: [],
          recordsReturned: 0,
        }}
        onClose={() => {}}
        onClear={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Area context" }));
    expect(screen.getByTestId("area-context-empty-state")).toBeTruthy();
    expect(screen.getByText("No mapped context is visible in this view")).toBeTruthy();
    expect(screen.getByText(/does not establish that the area has no owners or incentive zones/i)).toBeTruthy();
  });
});
