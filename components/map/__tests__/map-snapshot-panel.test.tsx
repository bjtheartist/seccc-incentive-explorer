import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AreaStats } from "../map-helpers";
import type { MapDossierSelection } from "@/lib/map-dossier";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapSnapshotPanel = (await import("../MapSnapshotPanel")).default;

const BASE_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
};

function renderPanel(
  selection?: MapDossierSelection | null,
  areaStats: AreaStats = BASE_STATS,
): string {
  return renderToStaticMarkup(
    <MapSnapshotPanel
      areaStats={areaStats}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={[]}
      snapshotTifFinance={null}
      tifFinanceLoading={false}
      zoningInfo={null}
      isGeneratingSnapshot={false}
      selection={selection}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

describe("MapSnapshotPanel shared dossier", () => {
  it("keeps the existing snapshotLabel contract when no selection model is passed", () => {
    const html = renderPanel();

    expect(html).toContain("3022 E 91st St");
    expect(html).toContain("Address or selected map point");
    expect(html).toContain("Generate location report");
    expect(html).toContain("Site facts");
    expect(html).toContain("Site activity context");
    expect(html).toContain("Data and sources");
    expect(html).toContain("<details");
    expect(html).toContain('aria-label="Close property details"');
  });

  it("renders an address selection with coordinates", () => {
    const html = renderPanel({
      kind: "address",
      title: "7900 S Commercial Ave",
      subtitle: "South Chicago address",
      lat: 41.7512,
      lon: -87.5514,
    });

    expect(html).toContain("7900 S Commercial Ave");
    expect(html).toContain("South Chicago address");
    expect(html).toContain("41.75120, -87.55140");
  });

  it("renders parcel fields and official-record actions without making ownership the headline", () => {
    const html = renderPanel(
      {
        kind: "parcel",
        title: "4312 W Madison St",
        pin: "16153030120000",
        propertyClass: "5-17",
        propertyClassDescription: "Commercial building",
        assessedTotal: 275000,
      },
      {
        ...BASE_STATS,
        parcelPin: "16153030120000",
        ownerName: "MADISON PROPERTY LLC",
        ownerType: "corporate_llc",
      },
    );

    expect(html).toContain("Cook County parcel 16153030120000");
    expect(html).toContain("Commercial building");
    expect(html).toContain("$275,000");
    expect(html).toContain("Check parcel record");
    expect(html).toContain("Review deed history");
    expect(html).toContain("Taxpayer of record");
    expect(html).toContain("MADISON PROPERTY LLC");
    expect(html).not.toMatch(/<h2[^>]*>[^<]*MADISON PROPERTY LLC/);
  });

  it("renders a vacancy selection as a verification lead without a public match score", () => {
    const html = renderPanel({
      kind: "vacancy",
      title: "4312 W Madison St",
      vacancyType: "vacant_land",
      squareFeet: 12450,
      pin: "16153030120000",
      incentiveGeographyCount: 8,
      reasonFlagged: "City/public land record and nearby vacant parcels",
    });

    expect(html).toContain("Vacant land · about 12,450 sq ft");
    expect(html).toContain("8 mapped incentive geographies");
    expect(html).toContain("City/public land record and nearby vacant parcels");
    expect(html).toContain("Verify the parcel record");
    expect(html).not.toContain("Match score");
    expect(html).not.toContain("Eligibility score");
  });

  it("renders a permit selection with applicant-reported cost and verification language", () => {
    const html = renderPanel({
      kind: "permit",
      title: "1000 W Sample St",
      permitId: "B100912345",
      permitType: "PERMIT - RENOVATION/ALTERATION",
      permitStatus: "COMPLETE",
      issueDate: "2026-06-12",
      workDescription: "Interior renovation of existing commercial space",
      reportedCost: 125000,
      sources: [
        {
          label: "City of Chicago building permit record",
          href: "https://data.cityofchicago.org/resource/ydr8-5enu",
          asOf: "August 5, 2026",
        },
      ],
    });

    expect(html).toContain("B100912345");
    expect(html).toContain("PERMIT - RENOVATION/ALTERATION");
    expect(html).toContain("Interior renovation of existing commercial space");
    expect(html).toContain("Applicant-reported cost");
    expect(html).toContain("$125,000");
    expect(html).toContain("not a verified investment amount, award, or available incentive budget");
    expect(html).toContain("Verify permit record");
    expect(html).not.toContain("Potential incentive dollars");
    expect(html).not.toContain("Total incentive");
  });

  it("renders a POI as nearby context rather than a property determination", () => {
    const html = renderPanel({
      kind: "poi",
      title: "South Chicago Branch",
      category: "Chicago Public Library",
      address: "9055 S Houston Ave",
      agency: "Chicago Public Library",
    });

    expect(html).toContain("Nearby place");
    expect(html).toContain("South Chicago Branch");
    expect(html).toContain("Chicago Public Library");
    expect(html).toContain("9055 S Houston Ave");
    expect(html).toContain("Select an address or parcel");
  });

  it("labels stale selections and preserves their source date", () => {
    const html = renderPanel({
      kind: "parcel",
      title: "Stale parcel example",
      pin: "16153030120000",
      freshness: {
        status: "stale",
        asOf: "December 31, 2024",
        note: "This parcel snapshot predates the latest county refresh.",
      },
    });

    expect(html).toContain("This parcel snapshot predates the latest county refresh.");
    expect(html).toContain("Records as of December 31, 2024.");
    expect(html).toContain("Verify them against the linked public source");
  });
});
