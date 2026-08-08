import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitAreaResult } from "@/lib/permit-area";

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
  dataWindow: "2015-present",
  locatedRecordsOnly: true,
  totalFilings: 3,
  distinctAddresses: 2,
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
  ],
  yearBreakdown: [
    { year: 2026, count: 2 },
    { year: 2024, count: 1 },
  ],
  statusBreakdown: [
    { status: "ACTIVE", count: 2 },
    { status: "COMPLETE", count: 1 },
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

function render(permitArea: PermitAreaResult = PERMITS) {
  return renderToStaticMarkup(
    <MapPolygonPanel
      results={EMPTY_VACANCY}
      loading={false}
      polygon={POLYGON}
      permitArea={permitArea}
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
    expect(permitSection).not.toMatch(/reported.?cost/i);
    expect(permitSection).not.toContain("$");
    expect(permitSection.toLowerCase()).not.toContain("activity score");
    expect(permitSection.toLowerCase()).not.toContain("construction completed");
  });

  it("keeps permit-only areas useful and exportable", () => {
    const html = render();
    expect(html).toContain("No tracked vacant properties found");
    expect(html).toContain("Save Report");
    expect(html).toContain("Email This to Me");
    expect(html).toContain("Export Area Data (CSV)");
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

  it("exports permit records as a separate table with no applicant cost", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Loop test area",
      vacancyFeatures: [],
      permitArea: PERMITS,
      investment: null,
    });
    expect(csv).toContain('"Section","Permit filing summary"');
    expect(csv).toContain('"Section","Recent permit filing records"');
    expect(csv).toContain('"Loop test area","100012345","123 S STATE ST"');
    expect(csv).toContain("1 recent filing record exported of 3 total geocoded filings");
    expect(csv).not.toMatch(/reported.?cost/i);
    expect(csv).not.toContain("999999999");
  });
});
