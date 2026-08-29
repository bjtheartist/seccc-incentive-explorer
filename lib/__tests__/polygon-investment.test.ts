import { describe, expect, it } from "vitest";
import {
  DRAWN_AREA_INVESTMENT_COLUMNS,
  POLYGON_INVESTMENT_BUCKETS,
  POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION,
  POLYGON_INVESTMENT_NO_TOTAL_NOTE,
  aggregateInvestmentPoints,
  buildDrawnAreaCsv,
  defaultDrawnAreaName,
  drawnAreaFilenameSlug,
  drawnAreaPolygons,
  investmentAmountForBucket,
  investmentBucketForPoint,
  investmentExclusionsFromLayer,
  pointInPolygon,
  polygonInvestmentExclusionNotes,
  polygonInvestmentYearSpanLabel,
  selectInvestmentPointsInArea,
  summarizePolygonInvestment,
} from "@/lib/polygon-investment";
import type {
  InvestmentPointFeature,
  InvestmentPointProps,
} from "@/lib/community-investment-layer";

/** A 1×1 square with its lower-left corner at (0,0). */
const SQUARE: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

/** The same square with a centered hole from (0.4,0.4) to (0.6,0.6). */
const SQUARE_WITH_HOLE: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    SQUARE.coordinates[0],
    [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
    ],
  ],
};

function pointFeature(
  lng: number,
  lat: number,
  props: Partial<InvestmentPointProps> = {},
): InvestmentPointFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      id: props.id ?? `rec-${lng}-${lat}`,
      recipient: props.recipient ?? "Recipient",
      funderName: props.funderName ?? "Funder",
      funderType: props.funderType ?? "government",
      capitalClass: props.capitalClass ?? "grant",
      amountAwarded: props.amountAwarded ?? null,
      authorizedAmount: props.authorizedAmount ?? null,
      creditAmount: props.creditAmount ?? null,
      publishedBalance: props.publishedBalance ?? null,
      announcedInvestment: props.announcedInvestment ?? null,
      logLine: props.logLine ?? null,
      year: props.year ?? null,
      status: props.status ?? "awarded",
      communityArea: props.communityArea ?? "",
      sourceLink: props.sourceLink ?? "",
      historicalRecoveryAmount: props.historicalRecoveryAmount ?? null,
      recoverySourceId: props.recoverySourceId,
      source: props.source,
    },
  };
}

describe("pointInPolygon", () => {
  const square = drawnAreaPolygons(SQUARE);

  it("selects an interior point", () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(pointInPolygon([0.01, 0.99], square)).toBe(true);
  });

  it("rejects exterior points on every side", () => {
    expect(pointInPolygon([-0.5, 0.5], square)).toBe(false);
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
    expect(pointInPolygon([0.5, -0.5], square)).toBe(false);
    expect(pointInPolygon([0.5, 1.5], square)).toBe(false);
  });

  it("counts a point exactly ON the boundary as inside (documented convention)", () => {
    expect(pointInPolygon([0.5, 0], square)).toBe(true); // bottom edge
    expect(pointInPolygon([1, 0.5], square)).toBe(true); // right edge
    expect(pointInPolygon([0, 0], square)).toBe(true); // vertex
    expect(pointInPolygon([1, 1], square)).toBe(true); // opposite vertex
  });

  it("treats winding order as irrelevant", () => {
    const reversed = drawnAreaPolygons({
      type: "Polygon",
      coordinates: [[...SQUARE.coordinates[0]].reverse()],
    });
    expect(pointInPolygon([0.5, 0.5], reversed)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], reversed)).toBe(false);
  });

  it("excludes a point inside a hole but keeps the hole boundary and the ring around it", () => {
    const holed = drawnAreaPolygons(SQUARE_WITH_HOLE);
    expect(pointInPolygon([0.5, 0.5], holed)).toBe(false); // in the hole
    expect(pointInPolygon([0.1, 0.1], holed)).toBe(true); // in the ring
    expect(pointInPolygon([0.4, 0.5], holed)).toBe(true); // on the hole edge
  });

  it("handles MultiPolygon and Feature wrappers, and selects nothing for null", () => {
    const multi = drawnAreaPolygons({
      type: "MultiPolygon",
      coordinates: [
        SQUARE.coordinates,
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 6],
            [5, 5],
          ],
        ],
      ],
    });
    expect(pointInPolygon([5.5, 5.5], multi)).toBe(true);
    expect(pointInPolygon([0.5, 0.5], multi)).toBe(true);
    expect(pointInPolygon([3, 3], multi)).toBe(false);

    const wrapped = drawnAreaPolygons({ type: "Feature", properties: {}, geometry: SQUARE });
    expect(pointInPolygon([0.5, 0.5], wrapped)).toBe(true);

    expect(drawnAreaPolygons(null)).toEqual([]);
    expect(pointInPolygon([0.5, 0.5], drawnAreaPolygons(null))).toBe(false);
  });

  it("never selects a non-finite coordinate", () => {
    expect(pointInPolygon([Number.NaN, 0.5], square)).toBe(false);
    expect(pointInPolygon([0.5, Number.POSITIVE_INFINITY], square)).toBe(false);
  });
});

describe("selectInvestmentPointsInArea", () => {
  it("keeps only the features inside the drawn area, in order", () => {
    const features = [
      pointFeature(0.2, 0.2, { id: "in-a" }),
      pointFeature(9, 9, { id: "out" }),
      pointFeature(0.8, 0.8, { id: "in-b" }),
    ];
    expect(selectInvestmentPointsInArea(SQUARE, features).map((f) => f.properties.id)).toEqual([
      "in-a",
      "in-b",
    ]);
  });

  it("selects nothing when no area is drawn", () => {
    expect(selectInvestmentPointsInArea(null, [pointFeature(0.5, 0.5)])).toEqual([]);
  });
});

describe("investmentBucketForPoint — class separation", () => {
  it("routes a private development to Announced even though its capitalClass is grant", () => {
    expect(
      investmentBucketForPoint({
        funderType: "private_development",
        capitalClass: "grant",
        recoverySourceId: undefined,
      }),
    ).toBe("announcedDevelopment");
  });

  it("routes each non-grant capital class to its own bucket", () => {
    const base = { funderType: "government" as const, recoverySourceId: undefined };
    expect(investmentBucketForPoint({ ...base, capitalClass: "tif_subsidy" })).toBe("tifAuthorized");
    expect(investmentBucketForPoint({ ...base, capitalClass: "federal_program" })).toBe(
      "federalProgram",
    );
    expect(investmentBucketForPoint({ ...base, capitalClass: "tax_credit" })).toBe("taxCredit");
    expect(investmentBucketForPoint({ ...base, capitalClass: "state_appropriation" })).toBe(
      "stateAppropriation",
    );
    expect(investmentBucketForPoint({ ...base, capitalClass: "grant" })).toBe("awarded");
  });

  it("routes a closed historical-recovery record out of the awarded bucket", () => {
    expect(
      investmentBucketForPoint({
        funderType: "government",
        capitalClass: "grant",
        recoverySourceId: "sba-rrf",
      }),
    ).toBe("historicalRecovery");
  });

  it("never lets an off-enum capital class reach the awarded bucket", () => {
    expect(
      investmentBucketForPoint({
        funderType: "government",
        capitalClass: "loan_guarantee" as never,
        recoverySourceId: undefined,
      }),
    ).toBe("other");
  });

  it("reads exactly one money field per bucket", () => {
    const props = pointFeature(0, 0, {
      amountAwarded: 1,
      announcedInvestment: 2,
      authorizedAmount: 3,
      creditAmount: 4,
      publishedBalance: 5,
      historicalRecoveryAmount: 6,
    }).properties;
    expect(investmentAmountForBucket("awarded", props)).toBe(1);
    expect(investmentAmountForBucket("announcedDevelopment", props)).toBe(2);
    expect(investmentAmountForBucket("tifAuthorized", props)).toBe(3);
    expect(investmentAmountForBucket("federalProgram", props)).toBe(3);
    expect(investmentAmountForBucket("taxCredit", props)).toBe(4);
    expect(investmentAmountForBucket("stateAppropriation", props)).toBe(5);
    expect(investmentAmountForBucket("historicalRecovery", props)).toBe(6);
    expect(investmentAmountForBucket("other", props)).toBeNull();
  });
});

describe("aggregateInvestmentPoints", () => {
  const mixed = [
    pointFeature(0.1, 0.1, {
      id: "g1",
      recipient: "Grantee A",
      capitalClass: "grant",
      amountAwarded: 250_000,
      year: 2019,
    }),
    pointFeature(0.2, 0.2, {
      id: "g2",
      recipient: "Grantee B",
      capitalClass: "grant",
      amountAwarded: 100_000,
      year: 2022,
    }),
    pointFeature(0.25, 0.2, {
      id: "g3",
      recipient: "Grantee A",
      capitalClass: "grant",
      amountAwarded: 50_000,
      year: 2024,
    }),
    pointFeature(0.3, 0.3, {
      id: "g4",
      recipient: "Grantee C",
      capitalClass: "grant",
      amountAwarded: null,
      year: 2021,
    }),
    pointFeature(0.35, 0.3, {
      id: "d1",
      recipient: "Megasite",
      funderType: "private_development",
      capitalClass: "grant",
      announcedInvestment: 7_000_000_000,
      year: 2025,
    }),
    pointFeature(0.4, 0.3, {
      id: "t1",
      recipient: "RDA Project",
      capitalClass: "tif_subsidy",
      authorizedAmount: 12_000_000,
      year: 2020,
    }),
    pointFeature(0.45, 0.3, {
      id: "f1",
      recipient: "CDBG Activity",
      capitalClass: "federal_program",
      authorizedAmount: 3_000_000,
      year: 2023,
    }),
    pointFeature(0.5, 0.3, {
      id: "c1",
      recipient: "LIHTC Building",
      capitalClass: "tax_credit",
      creditAmount: 900_000,
      year: 2018,
    }),
    pointFeature(0.55, 0.3, {
      id: "s1",
      recipient: "DCEO Line",
      capitalClass: "state_appropriation",
      publishedBalance: 4_000_000,
      year: 2024,
    }),
    pointFeature(0.6, 0.3, {
      id: "h1",
      recipient: "Closed Relief Recipient",
      capitalClass: "grant",
      recoverySourceId: "sba-rrf",
      historicalRecoveryAmount: 80_000,
      year: 2021,
    }),
    pointFeature(50, 50, { id: "far-away", capitalClass: "grant", amountAwarded: 999_999_999 }),
  ];

  const summary = summarizePolygonInvestment(SQUARE, mixed);
  const bucket = (key: string) => summary.buckets.find((b) => b.key === key)!;

  it("selects only the points inside the area", () => {
    expect(summary.selectedCount).toBe(10);
  });

  it("keeps every kind of capital in its own bucket and never sums across them", () => {
    expect(bucket("awarded").total).toBe(400_000);
    expect(bucket("awarded").count).toBe(4);
    expect(bucket("awarded").undisclosedCount).toBe(1);
    expect(bucket("announcedDevelopment").total).toBe(7_000_000_000);
    expect(bucket("tifAuthorized").total).toBe(12_000_000);
    expect(bucket("federalProgram").total).toBe(3_000_000);
    expect(bucket("taxCredit").total).toBe(900_000);
    expect(bucket("stateAppropriation").total).toBe(4_000_000);
    expect(bucket("historicalRecovery").total).toBe(80_000);
    // No combined figure exists anywhere on the summary.
    expect(Object.keys(summary)).not.toContain("total");
    expect(Object.keys(summary)).not.toContain("grandTotal");
  });

  it("uses the correct money noun for each bucket and never says 'received'", () => {
    expect(bucket("awarded").noun).toBe("Awarded");
    expect(bucket("announcedDevelopment").noun).toBe("Announced");
    expect(bucket("tifAuthorized").noun).toBe("Authorized");
    expect(bucket("federalProgram").noun).toBe("Federal program funding");
    expect(bucket("taxCredit").noun).toBe("Tax-credit allocation");
    expect(bucket("stateAppropriation").noun).toBe("Published appropriation balance");
    expect(bucket("historicalRecovery").noun).toBe("Historical award");
    const allCopy = POLYGON_INVESTMENT_BUCKETS.map(
      (b) => `${b.label} ${b.noun} ${b.csvColumn} ${b.caption ?? ""}`,
    )
      .join(" ")
      .toLowerCase();
    expect(allCopy).not.toContain("received");
    expect(allCopy).not.toContain("available");
  });

  it("captions ONLY the federal-program bucket, and only about its record count", () => {
    const captioned = POLYGON_INVESTMENT_BUCKETS.filter((b) => b.caption);
    expect(captioned.map((b) => b.key)).toEqual(["federalProgram"]);
    expect(captioned[0].caption).toBe(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION);
    // One sentence, and it affirms the dollars rather than hedging them.
    expect(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION.split(". ").length).toBe(1);
    expect(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION).toContain("dollars are real");
    expect(POLYGON_INVESTMENT_FEDERAL_PROGRAM_CAPTION.toLowerCase()).not.toContain("estimate");
  });

  it("ranks top recipients by AWARDED grant dollars only, merging repeats", () => {
    expect(summary.topRecipients).toEqual([
      { recipient: "Grantee A", awarded: 300_000, count: 2 },
      { recipient: "Grantee B", awarded: 100_000, count: 1 },
    ]);
    // The $7B development never appears in an awarded ranking.
    expect(summary.topRecipients.map((r) => r.recipient)).not.toContain("Megasite");
  });

  it("caps the recipient ranking at five", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      pointFeature(0.1 + i * 0.05, 0.5, {
        id: `many-${i}`,
        recipient: `Recipient ${i}`,
        capitalClass: "grant",
        amountAwarded: (i + 1) * 1000,
      }),
    );
    const ranked = summarizePolygonInvestment(SQUARE, many).topRecipients;
    expect(ranked).toHaveLength(5);
    expect(ranked[0].recipient).toBe("Recipient 8");
  });

  it("reports the inclusive year span across selected records", () => {
    expect(summary.yearSpan).toEqual({ minYear: 2018, maxYear: 2025 });
    expect(polygonInvestmentYearSpanLabel(summary.yearSpan)).toBe("2018–2025");
    expect(polygonInvestmentYearSpanLabel({ minYear: 2021, maxYear: 2021 })).toBe("2021");
    expect(polygonInvestmentYearSpanLabel(null)).toBe("");
  });

  it("returns an all-zero summary for an empty selection", () => {
    const empty = aggregateInvestmentPoints([]);
    expect(empty.selectedCount).toBe(0);
    expect(empty.topRecipients).toEqual([]);
    expect(empty.yearSpan).toBeNull();
    expect(empty.buckets.every((b) => b.count === 0 && b.total === 0)).toBe(true);
  });
});

describe("exclusion counts", () => {
  const layer = {
    citywide: { count: 41, totalDollars: 12_000_000 },
    countyReliefByZip: [
      { awardCount: 120 },
      { awardCount: 80 },
    ] as never,
    state2020ReliefByZip: [{ awardCount: 300 }] as never,
    stateRecoveryByZip: [{ awardCount: 500 }] as never,
    stateCapitalCitywideCount: 7,
    federalRestaurantReliefCitywideCount: 3,
    state2020HospitalityCitywideCount: 2,
  };

  it("sums ZIP-aggregate award counts and citywide records without double counting", () => {
    expect(investmentExclusionsFromLayer(layer)).toEqual({
      zipAggregateReliefRecords: 1000,
      citywideRecords: 53,
    });
  });

  it("tolerates a layer result missing the optional aggregate arrays", () => {
    expect(
      investmentExclusionsFromLayer({
        citywide: { count: 0, totalDollars: 0 },
        countyReliefByZip: [],
        state2020ReliefByZip: [],
        stateRecoveryByZip: [],
        stateCapitalCitywideCount: 0,
        federalRestaurantReliefCitywideCount: 0,
        state2020HospitalityCitywideCount: 0,
      }),
    ).toEqual({ zipAggregateReliefRecords: 0, citywideRecords: 0 });
  });

  it("states each exclusion as an absence with its reason", () => {
    const notes = polygonInvestmentExclusionNotes({
      zipAggregateReliefRecords: 1000,
      citywideRecords: 53,
    });
    expect(notes[0]).toBe("1,000 ZIP-aggregate relief records not included (no point location).");
    expect(notes[1]).toBe("53 citywide records not included (no point location).");
    expect(
      polygonInvestmentExclusionNotes({ zipAggregateReliefRecords: 1, citywideRecords: 0 }),
    ).toEqual(["1 ZIP-aggregate relief record not included (no point location)."]);
    expect(
      polygonInvestmentExclusionNotes({ zipAggregateReliefRecords: 0, citywideRecords: 0 }),
    ).toEqual([]);
  });
});

describe("drawn-area label", () => {
  it("defaults to 'Drawn area — Mon DD, YYYY'", () => {
    expect(defaultDrawnAreaName(new Date(2026, 6, 29))).toBe("Drawn area — Jul 29, 2026");
    expect(defaultDrawnAreaName(new Date(2026, 0, 3))).toBe("Drawn area — Jan 3, 2026");
  });

  it("slugs a name for the export filename", () => {
    expect(drawnAreaFilenameSlug("Drawn area — Jul 29, 2026")).toBe("drawn-area-jul-29-2026");
    expect(drawnAreaFilenameSlug("63rd & Halsted")).toBe("63rd-halsted");
    expect(drawnAreaFilenameSlug("   ")).toBe("drawn-area");
  });
});

describe("buildDrawnAreaCsv", () => {
  const vacancy: GeoJSON.Feature[] = [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.63, 41.88] },
      properties: {
        address: "123 S State St",
        source: "cols",
        status: "city_owned",
        sourceRecordDate: null,
        freshnessClass: "unknown_date",
        canonicalType: "land",
        propertyType: "vacant_land",
        explorerRefreshedAt: "2026-08-14T00:00:00.000Z",
        licenseCheckState: "no_match",
        currentLicenseMatches: [],
        licenseCheckedAt: "2026-08-14T00:00:00.000Z",
        ward: "3",
        communityArea: "Loop",
        zoningClass: "DX-16",
        squareFeet: 4000,
        ownerName: "City of Chicago",
        ownerType: "city_public",
        incentiveCount: 2,
        zoneMatches: [{ zoneKey: "tif" }, "opportunity_zone"],
      },
    },
  ];

  const selected = [
    pointFeature(0.1, 0.1, {
      recipient: "Grantee A",
      funderName: "City of Chicago",
      capitalClass: "grant",
      amountAwarded: 250_000,
      year: 2019,
    }),
    pointFeature(0.2, 0.2, {
      recipient: "Megasite",
      funderName: "Private developer",
      funderType: "private_development",
      capitalClass: "grant",
      announcedInvestment: 7_000_000_000,
      year: 2025,
    }),
  ];

  const csv = buildDrawnAreaCsv({
    areaName: "63rd & Halsted",
    scopeProvenance: {
      fingerprint: "polygon-v1:test",
      selectionMethod: "point_in_saved_polygon",
      generatedAt: "2026-08-26T17:00:00.000Z",
      manifestSelectedCount: 1,
    },
    vacancyFeatures: vacancy,
    investment: {
      summary: aggregateInvestmentPoints(selected, {
        zipAggregateReliefRecords: 1000,
        citywideRecords: 53,
      }),
      selected,
    },
  });
  const rows = csv.split("\n");

  it("puts the area name on the title line and on every data row of both tables", () => {
    expect(rows[0]).toBe('"Area Name","63rd & Halsted"');
    const dataRows = rows.filter((r) => r !== "" && !r.startsWith('"Section"'));
    expect(dataRows.length).toBeGreaterThan(4);
    for (const row of dataRows) {
      if (row.startsWith(`"${POLYGON_INVESTMENT_NO_TOTAL_NOTE}"`)) continue;
      expect(row.startsWith('"63rd & Halsted"') || row.startsWith('"Area Name"')).toBe(true);
    }
  });

  it("keeps the vacancy table intact under the area-name column", () => {
    expect(csv).toContain('"Area Name","Record ID","PIN","Address","Source","Source Key","Source Dataset ID"');
    expect(csv).toContain('"63rd & Halsted","","","123 S State St","City-Owned Land Inventory","cols"');
    expect(csv).toContain('"city_owned"');
    expect(csv).toContain('"Source record date unavailable","Tracked land signal","vacant_land"');
    expect(csv).toContain('"tif; opportunity_zone"');
  });

  it("carries the exact saved-boundary provenance into the direct map export", () => {
    expect(csv).toContain('"Section","Boundary provenance"');
    expect(csv).toContain('"63rd & Halsted","Boundary fingerprint","polygon-v1:test"');
    expect(csv).toContain('"63rd & Halsted","Selection method","point_in_saved_polygon"');
    expect(csv).toContain('"63rd & Halsted","Scope generated at","2026-08-26T17:00:00.000Z"');
    expect(csv).toContain('"63rd & Halsted","Manifest selected count","1"');
  });

  it("exports program associations as context with the source eligibility flags", () => {
    const contextualCsv = buildDrawnAreaCsv({
      areaName: "79th corridor",
      vacancyFeatures: [
        {
          ...vacancy[0],
          properties: {
            ...vacancy[0].properties,
            source: "cclba",
            status: "land_bank_inventory",
            programName: "Residential/Community Developer",
            programContext: [
              {
                isIneligible: true,
                isBeforeApplicationStart: false,
                program: { name: "Residential/Community Developer" },
              },
            ],
          },
        },
      ],
      investment: null,
    });
    expect(contextualCsv).toContain("Published Source / Program Context");
    expect(contextualCsv).toContain("Published Source / Program Context Details");
    expect(contextualCsv).toContain(
      '"Residential/Community Developer [isIneligible=true; isBeforeApplicationStart=false]"',
    );
    expect(contextualCsv).toContain(
      '"Cook County Land Bank Authority public record"',
    );
    expect(contextualCsv).not.toContain(
      "Cook County Land Bank Authority Published Property Inventory",
    );
    expect(contextualCsv).not.toContain("epropertyplus-published-properties");
    expect(contextualCsv).not.toContain("https://public-cclba.epropertyplus.com/");
  });

  it("uses the official CCLBA label in direct CSV only for proved official rows", () => {
    const officialCsv = buildDrawnAreaCsv({
      areaName: "79th corridor",
      vacancyFeatures: [
        {
          ...vacancy[0],
          properties: {
            ...vacancy[0].properties,
            source: "cclba",
            sourceDatasetId: "epropertyplus-published-properties",
            sourceDatasetLabel:
              "Cook County Land Bank Authority Published Property Inventory",
            sourceUrl: "https://public-cclba.epropertyplus.com/",
          },
        },
      ],
      investment: null,
    });

    expect(officialCsv).toContain(
      '"Cook County Land Bank Authority Published Property Inventory"',
    );
    expect(officialCsv).toContain(
      '"79th corridor","","","123 S State St","Cook County Land Bank Authority Published Property Inventory","cclba","epropertyplus-published-properties"',
    );
    expect(officialCsv).toContain('"epropertyplus-published-properties"');
    expect(officialCsv).toContain('"https://public-cclba.epropertyplus.com/"');
  });

  it("writes one money column per noun and puts each amount only under its own", () => {
    expect(DRAWN_AREA_INVESTMENT_COLUMNS).toContain("Awarded (grant, $)");
    expect(DRAWN_AREA_INVESTMENT_COLUMNS).toContain("Announced private capital ($)");
    expect(DRAWN_AREA_INVESTMENT_COLUMNS).not.toContain("Total");

    const grantRow = rows.find((r) => r.includes('"Grantee A"'))!;
    const devRow = rows.find((r) => r.includes('"Megasite"'))!;
    // Column layout: Area, Recipient, Funder, Funder Type, Capital Class, Year, then money.
    expect(grantRow).toBe(
      '"63rd & Halsted","Grantee A","City of Chicago","government","grant","2019","250000","","","","","",""',
    );
    expect(devRow).toBe(
      '"63rd & Halsted","Megasite","Private developer","private_development","grant","2025","","7000000000","","","","",""',
    );
  });

  it("carries the no-combined-total warning, the per-kind totals and the exclusion notes", () => {
    expect(csv).toContain(POLYGON_INVESTMENT_NO_TOTAL_NOTE);
    expect(csv).toContain('"63rd & Halsted","Grants","Awarded","1","250000"');
    expect(csv).toContain('"63rd & Halsted","Private development","Announced","1","7000000000"');
    expect(csv).toContain(
      '"63rd & Halsted","Excluded","1,000 ZIP-aggregate relief records not included (no point location)."',
    );
    expect(csv.toLowerCase()).not.toContain("received");
  });

  it("emits nothing about investment for a non-admin export", () => {
    const publicCsv = buildDrawnAreaCsv({
      areaName: "Drawn area — Jul 29, 2026",
      vacancyFeatures: vacancy,
      investment: null,
    });
    expect(publicCsv).toContain(
      '"Drawn area — Jul 29, 2026","","","123 S State St"',
    );
    expect(publicCsv.toLowerCase()).not.toContain("investment");
    expect(publicCsv.toLowerCase()).not.toContain("awarded");
    expect(publicCsv.toLowerCase()).not.toContain("announced");
  });

  it("exports optional workstation notes, filter labels, and vacancy view counts without treating notes as evidence", () => {
    const workstationCsv = buildDrawnAreaCsv({
      areaName: "Practitioner review",
      practitionerNotes: "  =FOLLOWUP(\"Confirm title holder\")  ",
      vacancyFeatures: vacancy,
      vacancyReturnedCountBeforeFilters: 7,
      vacancyFilterLabels: ["Source: City-owned land", "  Type: land  ", ""],
      vacancyVisibleCount: 1,
      investment: null,
    });

    expect(workstationCsv).toContain('"Section","Practitioner notes"');
    expect(workstationCsv).toContain(
      '"Practitioner review","User-authored practitioner note; not source evidence","\'=FOLLOWUP(""Confirm title holder"")"',
    );
    expect(workstationCsv).toContain('"Section","Vacancy workstation view"');
    expect(workstationCsv).toContain(
      '"Practitioner review","Active workstation filters","Source: City-owned land; Type: land"',
    );
    expect(workstationCsv).toContain('"Practitioner review","Records before filters","7"');
    expect(workstationCsv).toContain('"Practitioner review","Records visible in workstation","1"');
    expect(workstationCsv).toContain('"Practitioner review","Records exported","1"');
  });

  it("omits the practitioner-note section when the note is blank", () => {
    const workstationCsv = buildDrawnAreaCsv({
      areaName: "Blank note",
      practitionerNotes: "  \n  ",
      vacancyFeatures: [],
      investment: null,
    });

    expect(workstationCsv).not.toContain('"Section","Practitioner notes"');
    expect(workstationCsv).not.toContain("User-authored practitioner note");
  });

  it("falls back to a dated default when the name is blank", () => {
    const blank = buildDrawnAreaCsv({ areaName: "   ", vacancyFeatures: [], investment: null });
    expect(blank.startsWith('"Area Name","Drawn area — ')).toBe(true);
  });
});
