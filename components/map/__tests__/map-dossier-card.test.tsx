import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AreaStats } from "../map-helpers";
import type { MapDossierSelection } from "@/lib/map-dossier";
import type { ProgramCheckResult } from "@/lib/types";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapDossierCard = (await import("../MapDossierCard")).default;

const BASE_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
};

const INTERNAL_PROGRAM_RESULT: ProgramCheckResult & { score: number } = {
  programId: "sbif",
  program: {
    id: "sbif",
    name: "Small Business Improvement Fund",
    level: "City",
    zoneKey: "tif",
    summary: "Published program summary.",
    whoQualifies: "Published applicant requirements.",
    benefits: [],
    howToApply: [],
    requiredDocs: [],
    contact: "SomerCor",
    url: "https://www.chicago.gov/sbif",
    sourceUrl: "https://www.chicago.gov/sbif/source",
  },
  // Deliberately adversarial payload: the retired eligibility vocabulary in
  // the label/why strings must never reach the rendered panel.
  relevance: "mapped_with_matching_answers",
  relevanceLabel: "High Match — Appears eligible",
  whyOneLine: "You qualify for this program.",
  benefitRange: "$75,000–$250,000 possible incentive dollars",
  fastestStep: "Contact the administrator",
  notVerified: [],
  matchedRules: [],
  score: 97,
};

function renderPanel(
  selection?: MapDossierSelection | null,
  areaStats: AreaStats = BASE_STATS,
  snapshotPrograms: ProgramCheckResult[] = [],
  snapshotZoneCoverageNote: string | null = null,
): string {
  const activeSelection: MapDossierSelection = selection ?? {
    kind: "address",
    title: "3022 E 91st St",
    lat: 41.73035,
    lon: -87.55024,
  };
  return renderToStaticMarkup(
    <MapDossierCard
      areaStats={areaStats}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={snapshotPrograms}
      snapshotTifFinance={null}
      snapshotZoneCoverageNote={snapshotZoneCoverageNote}
      tifFinanceLoading={false}
      zoningInfo={null}
      isGeneratingSnapshot={false}
      selection={activeSelection}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

describe("MapDossierCard", () => {
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

    expect(html).toContain("Vacant land · 12,450 sq ft lot area");
    expect(html).toContain("Reported available space");
    expect(html).toContain("8 mapped incentive geographies");
    expect(html).toContain("City/public land record and nearby vacant parcels");
    expect(html).toContain("Verify the parcel record");
    expect(html).not.toContain("Match score");
    expect(html).not.toContain("Eligibility score");
  });

  it("renders mapped programs as neutral review leads without internal determinations or dollar anchors", () => {
    const html = renderPanel(undefined, BASE_STATS, [INTERNAL_PROGRAM_RESULT]);

    expect(html).toContain("Mapped programs to review");
    expect(html).toContain("Small Business Improvement Fund");
    expect(html).toContain("Mapped boundary intersects this location.");
    expect(html).toContain("Review source");
    expect(html).toContain(
      "Boundary intersection does not confirm applicant or project eligibility, funding availability, or approval.",
    );
    expect(html).not.toMatch(/eligibility score|high match|appears eligible|you qualify/i);
    expect(html).not.toMatch(/match score[^.]*97/i);
    expect(html).not.toMatch(/\$75,000|\$250,000|possible incentive dollars|total incentive/i);
    expect(html).not.toContain("97");
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

  it("review5 S2/S3: renders a zone-coverage caveat ALONGSIDE known-positive mapped programs — never suppressed by a nonzero match count", () => {
    const html = renderPanel(
      undefined,
      BASE_STATS,
      [INTERNAL_PROGRAM_RESULT],
      "1 incentive-geography layer could not be verified for this location; results here may be incomplete.",
    );

    // The known positive is still fully present...
    expect(html).toContain("Small Business Improvement Fund");
    expect(html).toContain("Mapped programs to review");
    // ...and the coverage caveat renders too, not replaced by it.
    expect(html).toContain("could not be verified for this location");
  });

  it("review5 S2/S3: renders the zone-coverage caveat even with ZERO matched programs — a failed layer must never read as a silent, unexplained '0 mapped'", () => {
    const html = renderPanel(
      undefined,
      BASE_STATS,
      [],
      "2 incentive-geography layers could not be verified for this location; results here may be incomplete.",
    );

    expect(html).toContain("2 incentive-geography layers could not be verified");
  });

  it("omits the zone-coverage caveat entirely when every layer resolved (null note) — no phantom caveat text", () => {
    const html = renderPanel(undefined, BASE_STATS, [INTERNAL_PROGRAM_RESULT], null);
    expect(html).not.toMatch(/could not be verified/i);
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
