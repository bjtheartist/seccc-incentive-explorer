import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The drawn-area panel's "Community investment in this area" section is gated on
 * the SAME /api/owner-file/session probe as every other admin surface
 * (components/map/MapView.tsx passes the 204 result in as adminSessionActive).
 * It must render nothing at all for a non-admin viewer, and — when it does
 * render — must keep every kind of capital under its own noun with no combined
 * total. Mirrors map-legend-admin-investment.test.tsx's probe-driven style.
 */
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

const MapPolygonPanel = (await import("../MapPolygonPanel")).default;
const {
  buildDrawnAreaCsv,
  aggregateInvestmentPoints,
  selectInvestmentPointsInArea,
  investmentExclusionsFromLayer,
  POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION,
} = await import("@/lib/polygon-investment");

import type {
  CommunityInvestmentLayerResult,
  InvestmentPointFeature,
  InvestmentPointProps,
} from "@/lib/community-investment-layer";

/** A Loop-sized box around downtown Chicago. */
const DOWNTOWN: GeoJSON.Polygon = {
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

function investmentPoint(
  lng: number,
  lat: number,
  props: Partial<InvestmentPointProps>,
): InvestmentPointFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      id: props.id ?? `${lng},${lat}`,
      recipient: props.recipient ?? "Recipient",
      funderName: props.funderName ?? "Funder",
      funderType: props.funderType ?? "government",
      capitalClass: props.capitalClass ?? "grant",
      amountAwarded: props.amountAwarded ?? null,
      authorizedAmount: props.authorizedAmount ?? null,
      creditAmount: props.creditAmount ?? null,
      publishedBalance: props.publishedBalance ?? null,
      announcedInvestment: props.announcedInvestment ?? null,
      logLine: null,
      year: props.year ?? null,
      status: props.status ?? "awarded",
      communityArea: props.communityArea ?? "Loop",
      sourceLink: "",
      historicalRecoveryAmount: props.historicalRecoveryAmount ?? null,
      recoverySourceId: props.recoverySourceId,
    },
  };
}

const POINTS: InvestmentPointFeature[] = [
  investmentPoint(-87.63, 41.88, {
    id: "grant-1",
    recipient: "State Street Storefront Co-op",
    funderName: "City of Chicago",
    capitalClass: "grant",
    amountAwarded: 450_000,
    year: 2022,
  }),
  investmentPoint(-87.62, 41.885, {
    id: "grant-2",
    recipient: "Loop Workforce Center",
    funderName: "Chicago Community Trust",
    funderType: "philanthropic",
    capitalClass: "grant",
    amountAwarded: 125_000,
    year: 2024,
  }),
  investmentPoint(-87.61, 41.89, {
    id: "dev-1",
    recipient: "Riverline Phase II",
    funderName: "Private developer",
    funderType: "private_development",
    capitalClass: "grant",
    announcedInvestment: 1_200_000_000,
    status: "under_construction",
    year: 2025,
  }),
  investmentPoint(-87.64, 41.895, {
    id: "tif-1",
    recipient: "LaSalle Reimagined RDA",
    funderName: "City of Chicago TIF",
    capitalClass: "tif_subsidy",
    authorizedAmount: 98_000_000,
    year: 2023,
  }),
  investmentPoint(-87.605, 41.875, {
    id: "credit-1",
    recipient: "Wabash Family Housing",
    funderName: "IHDA",
    capitalClass: "tax_credit",
    creditAmount: 14_500_000,
    year: 2021,
  }),
  investmentPoint(-87.625, 41.882, {
    id: "fed-1",
    recipient: "Loop CDBG Activity",
    funderName: "City of Chicago (HUD CDBG)",
    capitalClass: "federal_program",
    authorizedAmount: 2_400_000,
    year: 2023,
  }),
  // Well outside the drawn box (South Shore) — must never be selected.
  investmentPoint(-87.57, 41.76, {
    id: "far-1",
    recipient: "South Shore Bakery",
    capitalClass: "grant",
    amountAwarded: 9_000_000,
    year: 2020,
  }),
];

const LAYER: CommunityInvestmentLayerResult = {
  status: "ready",
  pointFeatures: POINTS,
  presentFunderTypes: ["government", "philanthropic"],
  presentCapitalClasses: ["grant", "tif_subsidy", "federal_program", "tax_credit"],
  citywide: { count: 12, totalDollars: 4_000_000 },
  citywideEntries: [],
  countyReliefByZip: [
    {
      sourceId: "cook-source-2023",
      programName: "Cook County 2023 Source Grant",
      zipCode: "60601",
      awardCount: 40,
      totalDisbursed: 400_000,
      year: 2023,
      sourceLink: "",
    },
  ],
  state2020ReliefByZip: [],
  stateRecoveryByZip: [
    {
      sourceId: "illinois-b2b",
      programName: "Illinois Back to Business Grant Program",
      zipCode: "60602",
      awardCount: 60,
      totalDisbursed: 600_000,
      year: 2022,
      sourceLink: "",
    },
  ],
  stateCapitalCitywideCount: 3,
  federalRestaurantReliefCitywideCount: 2,
  state2020HospitalityCitywideCount: 1,
  citywideDevelopmentNames: [],
  funderHqs: [],
};

const VACANCY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.63, 41.88] },
      properties: {
        address: "300 S State St",
        propertyType: "vacant_land",
        ward: "4",
        communityArea: "Loop",
        ownerType: "city_public",
        zoneMatches: [{ zoneKey: "tif" }],
      },
    },
  ],
};

function baseProps() {
  return {
    results: VACANCY,
    loading: false,
    onClose: () => {},
    onClear: () => {},
    polygon: DOWNTOWN,
  };
}

describe("MapPolygonPanel — admin gating", () => {
  it("renders nothing about community investment for a non-admin viewer", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel {...baseProps()} adminSessionActive={false} investmentLayer={LAYER} />,
    );
    expect(html).not.toContain("Community investment in this area");
    expect(html).not.toContain("Awarded");
    expect(html).not.toContain("Announced");
    expect(html).not.toContain("Top recipients");
    expect(html).not.toContain("State Street Storefront Co-op");
    expect(html).not.toContain("Riverline Phase II");
    expect(html).not.toContain("Loop CDBG Activity");
    expect(html).not.toContain(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION);
    expect(html).not.toContain("Admin");
    // The pre-existing public panel is untouched.
    expect(html).toContain("300 S State St");
  });

  it("renders nothing when the admin session is active but the gated data is unauthorized", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        adminSessionActive
        investmentLayer={{ ...LAYER, status: "unauthorized", pointFeatures: [] }}
      />,
    );
    expect(html).not.toContain("Community investment in this area");
    expect(html).not.toContain("Riverline Phase II");
  });

  it("renders nothing when no polygon has been drawn yet", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        polygon={null}
        adminSessionActive
        investmentLayer={LAYER}
      />,
    );
    expect(html).not.toContain("Community investment in this area");
  });
});

describe("MapPolygonPanel — investment aggregation rendering", () => {
  const html = renderToStaticMarkup(
    <MapPolygonPanel {...baseProps()} adminSessionActive investmentLayer={LAYER} />,
  );

  it("renders the admin section with each kind of capital under its own noun", () => {
    expect(html).toContain("Community investment in this area");
    expect(html).toContain("Grants");
    expect(html).toContain("Awarded");
    expect(html).toContain("$575,000");
    expect(html).toContain("Private development");
    expect(html).toContain("Announced");
    expect(html).toContain("$1,200,000,000");
    expect(html).toContain("TIF assistance");
    expect(html).toContain("Authorized");
    expect(html).toContain("$98,000,000");
    expect(html).toContain("Tax credit");
    expect(html).toContain("Tax-credit allocation");
    expect(html).toContain("$14,500,000");
    expect(html).toContain("Federal program");
    expect(html).toContain("Federal program funding");
    expect(html).toContain("$2,400,000");
  });

  it("excludes points outside the drawn area from every figure", () => {
    expect(html).not.toContain("South Shore Bakery");
    expect(html).not.toContain("$9,575,000"); // awarded + the far-away grant
  });

  it("ranks top recipients by awarded grant dollars only", () => {
    expect(html).toContain("Top recipients by awarded grant dollars");
    expect(html).toContain("State Street Storefront Co-op");
    expect(html).toContain("Loop Workforce Center");
    // The $1.2B development is never ranked as awarded money.
    const rankingSection = html.slice(html.indexOf("Top recipients by awarded grant dollars"));
    expect(rankingSection).not.toContain("Riverline Phase II");
  });

  it("reports the record year span", () => {
    expect(html).toContain("Record years");
    expect(html).toContain("2021–2025");
  });

  it("captions the federal-program row with its count-clustering caveat", () => {
    expect(html).toContain(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION);
    // The caveat is about the COUNT, never a hedge on the dollars.
    expect(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION).toContain("dollars are real");
    // It sits under the federal-program row, not floating elsewhere in the panel.
    const fedIndex = html.indexOf("Federal program funding");
    expect(fedIndex).toBeGreaterThan(-1);
    expect(html.indexOf(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION)).toBeGreaterThan(fedIndex);
  });

  it("omits the federal-program caption when no federal records are inside the area", () => {
    const withoutFederal = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        adminSessionActive
        investmentLayer={{
          ...LAYER,
          pointFeatures: POINTS.filter((f) => f.properties.capitalClass !== "federal_program"),
        }}
      />,
    );
    expect(withoutFederal).toContain("Community investment in this area");
    expect(withoutFederal).toContain("$575,000");
    expect(withoutFederal).not.toContain("Federal program");
    expect(withoutFederal).not.toContain(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION);
  });

  it("states what a drawn area cannot select instead of implying zero", () => {
    expect(html).toContain("Not selectable by a drawn area");
    expect(html).toContain("100 ZIP-aggregate relief records not included (no point location).");
    expect(html).toContain("18 citywide records not included (no point location).");
  });

  it("renders an honest empty state when nothing is sited inside the shape", () => {
    const empty = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        polygon={{
          type: "Polygon",
          coordinates: [
            [
              [-87.9, 41.6],
              [-87.89, 41.6],
              [-87.89, 41.61],
              [-87.9, 41.61],
              [-87.9, 41.6],
            ],
          ],
        }}
        adminSessionActive
        investmentLayer={LAYER}
      />,
    );
    expect(empty).toContain("Community investment in this area");
    expect(empty).toContain("No sited community-investment records fall inside this area.");
    expect(empty).not.toContain("$1,200,000,000");
  });
});

describe("MapPolygonPanel — CSV export availability", () => {
  const NO_VACANCY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  it("offers the CSV export to an admin whose area holds only investment records", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        results={NO_VACANCY}
        adminSessionActive
        investmentLayer={LAYER}
      />,
    );
    expect(html).toContain("Export Full Report (CSV)");
    // Save/Email build a vacancy report, so they stay hidden with no vacancies.
    expect(html).not.toContain("Save Report");
    expect(html).not.toContain("Email This to Me");
    expect(html).toContain("No properties found");
  });

  it("still offers nothing to a non-admin with no vacancies (unchanged behavior)", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        results={NO_VACANCY}
        adminSessionActive={false}
        investmentLayer={LAYER}
      />,
    );
    expect(html).not.toContain("Export Full Report (CSV)");
    expect(html).not.toContain("Save Report");
  });

  it("hides the export for an admin whose area holds no investment records either", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel
        {...baseProps()}
        results={NO_VACANCY}
        adminSessionActive
        investmentLayer={{ ...LAYER, pointFeatures: [] }}
      />,
    );
    expect(html).not.toContain("Export Full Report (CSV)");
  });

  it("keeps the full action set when the area holds vacancies", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel {...baseProps()} adminSessionActive investmentLayer={LAYER} />,
    );
    expect(html).toContain("Save Report");
    expect(html).toContain("Email This to Me");
    expect(html).toContain("Export Full Report (CSV)");
  });
});

describe("MapPolygonPanel — iron-rule strings", () => {
  const html = renderToStaticMarkup(
    <MapPolygonPanel {...baseProps()} adminSessionActive investmentLayer={LAYER} />,
  );

  it("never says a recipient received, drew down, or has money available", () => {
    const section = html.slice(html.indexOf("Community investment in this area"));
    expect(section.toLowerCase()).not.toContain("received");
    expect(section.toLowerCase()).not.toContain("available funding");
    expect(section.toLowerCase()).not.toContain("remaining");
    expect(section.toLowerCase()).not.toContain("unspent");
  });

  it("carries the no-combined-total warning and shows no combined figure", () => {
    expect(html).toContain(
      "Each figure below is a different kind of capital and is never combined into one total.",
    );
    expect(html).toContain("private development figures are announced project capital, not awarded dollars");
    // 575,000 + 1,200,000,000 + 98,000,000 + 14,500,000 + 2,400,000
    expect(html).not.toContain("$1,315,475,000");
    expect(html).not.toContain("$1,313,075,000");
    expect(html).not.toContain("Total investment");
    expect(html).not.toContain("Combined");
  });

  it("labels development capital 'Announced' and never 'Awarded'", () => {
    const devIndex = html.indexOf("Private development");
    const devBlock = html.slice(devIndex, devIndex + 600);
    expect(devBlock).toContain("Announced");
    expect(devBlock).not.toContain("Awarded");
  });
});

describe("MapPolygonPanel — area label reaches the CSV", () => {
  function renderedAreaName(html: string): string {
    const match = html.match(/id="drawn-area-name"[^>]*value="([^"]*)"/);
    return match ? match[1].replace(/&#x27;|&quot;/g, "") : "";
  }

  it("seeds a dated default name and shows it in the panel header", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel {...baseProps()} adminSessionActive investmentLayer={LAYER} />,
    );
    const name = renderedAreaName(html);
    expect(name).toMatch(/^Drawn area — [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    // Header shows the name (with the em dash HTML-escaped by the renderer).
    expect(html).toContain(name.replace("—", "—"));
    expect(html).toContain("Area Name");
  });

  it("stamps that exact name on every row and header of both CSV tables", () => {
    const html = renderToStaticMarkup(
      <MapPolygonPanel {...baseProps()} adminSessionActive investmentLayer={LAYER} />,
    );
    const areaName = renderedAreaName(html);
    const selected = selectInvestmentPointsInArea(DOWNTOWN, LAYER.pointFeatures);
    const csv = buildDrawnAreaCsv({
      areaName,
      vacancyFeatures: VACANCY.features,
      investment: {
        summary: aggregateInvestmentPoints(selected, investmentExclusionsFromLayer(LAYER)),
        selected,
      },
    });

    expect(csv.split("\n")[0]).toBe(`"Area Name","${areaName}"`);
    for (const row of csv.split("\n")) {
      if (row === "" || row.startsWith('"Section"') || row.startsWith('"Area Name"')) continue;
      if (row.startsWith('"Each figure below')) continue;
      expect(row.startsWith(`"${areaName}"`)).toBe(true);
    }
    expect(csv).toContain('"300 S State St"');
    expect(csv).toContain('"State Street Storefront Co-op"');
    expect(csv).toContain("Awarded (grant, $)");
    expect(csv).toContain("Announced private capital ($)");
  });

  it("keeps investment out of the CSV entirely for a non-admin", () => {
    const csv = buildDrawnAreaCsv({
      areaName: "Loop pilot area",
      vacancyFeatures: VACANCY.features,
      investment: null,
    });
    expect(csv).toContain('"Loop pilot area","300 S State St"');
    expect(csv.toLowerCase()).not.toContain("recipient");
    expect(csv.toLowerCase()).not.toContain("awarded");
  });
});
