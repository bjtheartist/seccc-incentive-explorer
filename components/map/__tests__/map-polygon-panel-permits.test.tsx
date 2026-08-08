import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitAreaResult } from "@/lib/permit-area";
import type { VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

const MapPolygonPanel = (await import("../MapPolygonPanel")).default;
const { buildDrawnAreaCsv } = await import("@/lib/polygon-investment");

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.65, 41.87],
      [-87.6, 41.87],
      [-87.6, 41.9],
      [-87.65, 41.9],
      [-87.65, 41.87],
    ],
  ],
};

const EMPTY_VACANCY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const PERMITS: PermitAreaResult = {
  status: "ready",
  source: {
    label: "City of Chicago Building Permits (ydr8-5enu)",
    url: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data",
    portalUrl: "https://webapps1.chicago.gov/buildingrecords/",
  },
  dataWindow: "Since 2015",
  sourceRefresh: {
    asOf: "2026-08-04T18:22:00.000Z",
    asOfBasis: "latest_queried_row_fetched_at",
  },
  locatedRecordsOnly: true,
  totalFilings: 8,
  distinctAddresses: 7,
  issueDateSpan: { first: "2024-01-10", latest: "2026-08-04" },
  typeBreakdown: [
    {
      key: "new_construction",
      label: "New Construction",
      sourceValue: "PERMIT - NEW CONSTRUCTION",
      color: "#059669",
      count: 2,
    },
    {
      key: "signs",
      label: "Signs",
      sourceValue: "PERMIT - SIGNS",
      color: "#D97706",
      count: 1,
    },
    {
      key: "renovation_alteration",
      label: "Renovation/Alteration",
      sourceValue: "PERMIT - RENOVATION/ALTERATION",
      color: "#2563EB",
      count: 1,
    },
    {
      key: "wrecking_demolition",
      label: "Wrecking/Demolition",
      sourceValue: "PERMIT - WRECKING/DEMOLITION",
      color: "#DC2626",
      count: 1,
    },
    {
      key: "scaffolding",
      label: "Scaffolding",
      sourceValue: "PERMIT - SCAFFOLDING",
      color: "#475569",
      count: 1,
    },
    {
      key: "elevator_equipment",
      label: "Elevator Equipment",
      sourceValue: "PERMIT - ELEVATOR EQUIPMENT",
      color: "#0891B2",
      count: 1,
    },
    {
      key: null,
      label: "SOURCE-ONLY TYPE ABSENT FROM RECENT RECORDS",
      sourceValue: "SOURCE-ONLY TYPE ABSENT FROM RECENT RECORDS",
      color: "#64748B",
      count: 1,
    },
  ],
  yearBreakdown: [
    { year: 2026, count: 5 },
    { year: 2024, count: 3 },
  ],
  statusBreakdown: [
    { status: "ACTIVE", count: 5 },
    { status: "COMPLETE", count: 3 },
  ],
  records: [
    {
      permitId: "100012345",
      permitTypeKey: "new_construction",
      permitTypeLabel: "New Construction",
      rawPermitType: "PERMIT - NEW CONSTRUCTION",
      address: "123 S STATE ST",
      issueDate: "2026-08-04",
      permitStatus: "ACTIVE",
      permitMilestone: "PERMIT ISSUED",
      workType: "NEW CONSTRUCTION",
      workDescription: "Construct a two-story commercial building",
    },
  ],
  recordsReturned: 1,
  recordsTruncated: true,
};

const COMPLETE_VACANCY_COVERAGE: VacancyCoverageMetadata = {
  sourceMode: "database",
  sourcePath: "database:vacant_properties",
  asOf: "2026-08-04T18:00:00.000Z",
  asOfBasis: "latest_queried_row_updated_at",
  returnedCount: 0,
  configuredLimit: 10_000,
  queryLimit: 10_001,
  coverageStatus: "complete",
  potentiallyTruncated: false,
  fallbackReason: null,
};

function render(
  permitArea: PermitAreaResult = PERMITS,
  vacancyState: {
    vacancyCoverage?: VacancyCoverageMetadata | null;
    vacancyLoadFailed?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <MapPolygonPanel
      results={EMPTY_VACANCY}
      loading={false}
      polygon={POLYGON}
      permitArea={permitArea}
      vacancyCoverage={vacancyState.vacancyCoverage}
      vacancyLoadFailed={vacancyState.vacancyLoadFailed}
      onClose={() => {}}
      onClear={() => {}}
    />,
  );
}

describe("MapPolygonPanel permit analysis", () => {
  it("renders source-honest permit analysis without a score or cost total", () => {
    const html = render();
    const permitSection = html.slice(
      html.indexOf("Permit filings in this area"),
      html.indexOf("Export Area Data (CSV)"),
    );
    expect(html).toContain("Permit filings in this area");
    expect(html).toContain("Public record");
    expect(html).toContain("filing activity, not that construction started or finished");
    expect(html).toContain("Records without a map location cannot be assigned");
    expect(html).toContain("New Construction");
    expect(html).toContain("Recent filing years");
    expect(html).toContain("Recorded statuses");
    expect(html).toContain("123 S STATE ST");
    expect(html).toContain("Aug 4, 2026");
    expect(html).toContain("Since 2015; database updated Aug 4, 2026");
    expect(permitSection).not.toMatch(/reported.?cost/i);
    expect(permitSection).not.toContain("$");
    expect(permitSection.toLowerCase()).not.toContain("activity score");
    expect(permitSection.toLowerCase()).not.toContain("construction completed");
  });

  it("keeps permit-only areas useful and exportable", () => {
    const html = render(PERMITS, { vacancyCoverage: COMPLETE_VACANCY_COVERAGE });
    expect(html).toContain("No tracked vacant properties found");
    expect(html).toContain("Save Report");
    expect(html).toContain("Email This to Me");
    expect(html).toContain("Export Area Data (CSV)");
  });

  it("does not convert vacancy failure or partial fallback into a clean zero", () => {
    const failedHtml = render(PERMITS, { vacancyLoadFailed: true });
    expect(failedHtml).toContain("Vacancy records unavailable");
    expect(failedHtml).toContain("lookup failure, not evidence");
    expect(failedHtml).not.toContain("No tracked vacant properties found");
    expect(failedHtml).toContain("Permit filings in this area");

    const partialHtml = render(PERMITS, {
      vacancyCoverage: {
        ...COMPLETE_VACANCY_COVERAGE,
        sourceMode: "static_fallback",
        sourcePath: "/data/vacant-properties.json",
        asOfBasis: "static_export_generated_at",
        coverageStatus: "partial",
        queryLimit: null,
        fallbackReason: "database_query_failed",
      },
    });
    expect(partialHtml).toContain("Partial vacancy records");
    expect(partialHtml).toContain("published static fallback");
    expect(partialHtml).not.toContain("No tracked vacant properties found");
    expect(partialHtml).toContain("Permit filings in this area");
  });

  it("distinguishes a ready zero result from a lookup failure", () => {
    const html = render({
      ...PERMITS,
      totalFilings: 0,
      distinctAddresses: 0,
      issueDateSpan: null,
      typeBreakdown: [],
      yearBreakdown: [],
      statusBreakdown: [],
      records: [],
      recordsReturned: 0,
      recordsTruncated: false,
    });
    expect(html).toContain("No geocoded permit filings fall inside this shape");
    expect(html).not.toContain("Save Report");
    expect(html).not.toContain("Export Area Data (CSV)");
  });

  it("exports complete permit types and recent-record coverage as separate tables", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Loop test area",
      vacancyFeatures: [],
      permitArea: PERMITS,
      investment: null,
    });
    expect(csv).toContain('"Section","Permit filing summary"');
    expect(csv).toContain('"Loop test area","Source coverage","Since 2015; database updated Aug 4, 2026"');
    expect(csv).toContain('"Section","Permit type breakdown"');
    expect(csv).toContain(
      '"Loop test area","SOURCE-ONLY TYPE ABSENT FROM RECENT RECORDS","SOURCE-ONLY TYPE ABSENT FROM RECENT RECORDS","Unmapped","1"',
    );
    expect(csv).toContain('"Section","Recent permit record coverage"');
    expect(csv).toContain('"Section","Recent permit filing records"');
    expect(csv).toContain('"Loop test area","100012345","123 S STATE ST"');
    expect(csv).toContain("Aggregate summary and type-breakdown tables use all 8 geocoded filings");
    const recentRecordsTable = csv.slice(
      csv.indexOf('"Section","Recent permit filing records"'),
    );
    expect(recentRecordsTable).not.toContain('"Coverage note"');
    expect(csv).not.toMatch(/reported.?cost/i);
    expect(csv).not.toContain("999999999");
  });

  it("exports vacancy lookup failure as unavailable without an empty vacancy table", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Failure test area",
      vacancyFeatures: [],
      vacancyLoadFailed: true,
      permitArea: PERMITS,
      investment: null,
    });
    expect(csv).toContain('"Section","Vacancy coverage"');
    expect(csv).toContain('"Failure test area","Coverage status","Unavailable"');
    expect(csv).toContain("lookup failure, not evidence");
    expect(csv.split("\n")).not.toContain('"Section","Vacancy"');
    expect(csv).toContain('"Section","Permit filing summary"');
  });
});
