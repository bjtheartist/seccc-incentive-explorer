import { describe, expect, it } from "vitest";
import {
  ZONING_NOT_MAPPED,
  ZONING_NOT_PUBLISHED,
  DISTRICT_UNCLASSIFIED,
  candidateDistrictFilterLabel,
  candidateDistrictFilterValue,
  candidateFootprintLabel,
  candidateMatchesFilters,
  candidateRowsToCsv,
  candidateZoningFilterValue,
  epaWalkabilityCategory,
  filterAndSortCandidateRows,
  joinCandidateAvailableSpace,
  joinCandidateContext,
  normalizeSiteMatchmakerCandidates,
  parseAvailableSpacePayload,
  parseSiteMatchmakerContextPayload,
  type SiteMatchmakerCandidateFilters,
} from "../site-matchmaker-results";
import type { SiteMatchmakerContextMetric } from "../site-matchmaker-context";
import type { VacancyLandPoint, VacancySitePoint } from "../vacancy-index";

function sitePoint(overrides: Partial<VacancySitePoint> = {}): VacancySitePoint {
  const squareFeet = overrides.squareFeet === undefined ? 2_500 : overrides.squareFeet;
  return {
    lat: 41.73,
    lon: -87.55,
    ownerType: "corporate_llc",
    propertyType: "vacant_building",
    markerNumber: null,
    address: "100 E MAIN ST",
    pin: "20123456789012",
    squareFeet,
    space:
      overrides.space ??
      (squareFeet == null
        ? {}
        : {
            assessorBuildingSqft: squareFeet,
            availableSpaceSqft: squareFeet,
            availableSpaceSource: "Verified test record",
            availableSpaceVerifiedAt: "2026-08-05T00:00:00.000Z",
            availableSpaceReconfirmAfter: "2099-01-01T00:00:00.000Z",
          }),
    zoningClass: "B3-2",
    incentiveCount: 3,
    ownerConfidence: "inferred",
    clusterId: null,
    saleYear: null,
    violation: true,
    ownerStructure: "entity",
    ownerGeography: "in_state",
    pinMatch: "address_matched",
    ...overrides,
  };
}

function landPoint(overrides: Partial<VacancyLandPoint> = {}): VacancyLandPoint {
  const squareFeet = overrides.squareFeet === undefined ? 5_000 : overrides.squareFeet;
  return {
    lat: 41.74,
    lon: -87.56,
    ownerType: "local_private",
    address: "300 E PINE ST",
    pin: "20987654321098",
    squareFeet,
    space: overrides.space ?? (squareFeet == null ? {} : { lotAreaSqft: squareFeet }),
    ownerConfidence: "inferred",
    saleYear: null,
    ownerStructure: "individual",
    ownerGeography: "in_state",
    ...overrides,
  };
}

function filters(
  overrides: Partial<SiteMatchmakerCandidateFilters> = {},
): SiteMatchmakerCandidateFilters {
  return {
    search: "",
    sources: new Set(),
    propertyTypes: new Set(),
    footprintPublication: new Set(),
    ownerSectors: new Set(),
    ownerStructures: new Set(),
    districtFamilies: new Set(),
    zoning: new Set(),
    distress: new Set(),
    minimumPopulationDensity: null,
    walkabilityCategories: new Set(),
    maximumExpresswayMiles: null,
    maximumNearestAirportMiles: null,
    ...overrides,
  };
}

function context(overrides: Partial<SiteMatchmakerContextMetric> = {}): SiteMatchmakerContextMetric {
  return {
    tractId: "17031000100",
    population: 4_200,
    populationDensityPerSqMi: 8_500,
    walkabilityIndex: 12.5,
    nearestExpresswayName: "Dan Ryan Expy (I-90/94)",
    nearestExpresswayMiles: 1.2,
    midwayMiles: 7.4,
    ohareMiles: 18.8,
    ...overrides,
  };
}

describe("normalizeSiteMatchmakerCandidates", () => {
  it("preserves both source views without deduplicating the same parcel", () => {
    const shared = {
      address: "100 E MAIN ST",
      pin: "20123456789012",
    };
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint(shared)],
      [landPoint(shared)],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source)).toEqual([
      "tracked_inventory",
      "reconciled_vacant_land",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "tracked_inventory:0",
      "reconciled_vacant_land:0",
    ]);
    expect(rows[1]).toMatchObject({
      propertyType: "vacant_land",
      zoningClass: null,
      zoningAvailability: "not_mapped_in_source",
      incentiveGeographyCount: null,
      incentiveAvailability: "not_mapped_in_source",
      violation: null,
    });
    expect(rows[1]).not.toHaveProperty("ownerName");
  });

  it("keeps every row when the optional land view is absent", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint(), sitePoint({ address: null, pin: null })],
      null,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].address).toBeNull();
    expect(rows[1].pin).toBeNull();
  });

  it("joins context by the client-safe key while retaining unmatched rows", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint(), sitePoint({ address: "200 E OAK ST", pin: null, lat: 41.75 })],
      null,
    );
    const joined = joinCandidateContext(rows, new Map([[rows[0].contextKey, context()]]));

    expect(joined).toHaveLength(2);
    expect(joined[0].context).toEqual(context());
    expect(joined[1].context).toBeNull();
    expect(joined.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });
});

describe("verified available-space enrichment", () => {
  it("accepts only complete, positive public-safe measurements", () => {
    expect(
      parseAvailableSpacePayload({
        measurements: [
          {
            pin: "20-12-345-678-9012",
            availableSpaceSqft: 4_500.4,
            source: "Owner confirmation",
            verifiedAt: "2026-08-05T00:00:00.000Z",
            reconfirmAfter: "2099-01-01T00:00:00.000Z",
          },
          { pin: "bad", availableSpaceSqft: 1_000, source: "Record", verifiedAt: "now" },
          {
            pin: "20123456789012",
            availableSpaceSqft: 0,
            source: "Record",
            verifiedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        pin: "20123456789012",
        availableSpaceSqft: 4_500,
        source: "Owner confirmation",
        verifiedAt: "2026-08-05T00:00:00.000Z",
        reconfirmAfter: "2099-01-01T00:00:00.000Z",
      },
    ]);
    expect(parseAvailableSpacePayload({ measurements: "not-an-array" })).toEqual([]);
  });

  it("updates a building match area without changing row order or cardinality", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [
        sitePoint({ squareFeet: null, space: { assessorBuildingSqft: 9_000 } }),
        sitePoint({
          pin: "21111111111111",
          address: "200 E OAK ST",
          squareFeet: null,
          space: { cityGroundFootprintSqft: 3_200 },
        }),
      ],
      [landPoint({ pin: "20123456789012", squareFeet: 8_000 })],
    );
    const enriched = joinCandidateAvailableSpace(rows, [
      {
        pin: "20123456789012",
        availableSpaceSqft: 4_500,
        source: "Owner confirmation",
        verifiedAt: "2026-08-05T00:00:00.000Z",
        reconfirmAfter: "2099-01-01T00:00:00.000Z",
      },
    ]);

    expect(enriched.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(enriched).toHaveLength(rows.length);
    expect(enriched[0]).toMatchObject({
      squareFeet: 4_500,
      matchAreaKind: "verified_available_space",
      space: {
        assessorBuildingSqft: 9_000,
        availableSpaceSqft: 4_500,
        availableSpaceSource: "Owner confirmation",
      },
    });
    expect(enriched[1].squareFeet).toBeNull();
    expect(enriched[2]).toMatchObject({
      squareFeet: 8_000,
      matchAreaKind: "lot_area",
      space: { lotAreaSqft: 8_000, availableSpaceSqft: 4_500 },
    });
  });

  it("treats an empty successful live snapshot as authoritative", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [
        sitePoint({
          space: {
            assessorBuildingSqft: 9_000,
            availableSpaceSqft: 4_500,
            availableSpaceSource: "Owner confirmation",
            availableSpaceVerifiedAt: "2026-08-01T00:00:00.000Z",
            availableSpaceReconfirmAfter: "2099-01-01T00:00:00.000Z",
          },
        }),
      ],
      null,
    );

    const refreshed = joinCandidateAvailableSpace(rows, []);
    expect(refreshed[0]).toMatchObject({
      squareFeet: null,
      matchAreaKind: "verified_available_space",
      space: { assessorBuildingSqft: 9_000 },
    });
    expect(refreshed[0].space).not.toHaveProperty("availableSpaceSqft");
  });

  it("does not normalize expired static availability into display or export rows", () => {
    const [row] = normalizeSiteMatchmakerCandidates(
      [
        sitePoint({
          space: {
            assessorBuildingSqft: 9_000,
            availableSpaceSqft: 4_500,
            availableSpaceSource: "Owner confirmation",
            availableSpaceVerifiedAt: "2026-01-01T00:00:00.000Z",
            availableSpaceReconfirmAfter: "2026-02-01T00:00:00.000Z",
          },
        }),
      ],
      null,
    );

    expect(row.squareFeet).toBeNull();
    expect(row.space).toEqual({ assessorBuildingSqft: 9_000 });
    expect(candidateRowsToCsv([row])).toContain('"Not verified"');
    expect(candidateRowsToCsv([row])).not.toContain('"4500"');
  });
});

describe("site matchmaker context payload", () => {
  it("validates version and ZIP and accepts a keyed context object", () => {
    const rows = normalizeSiteMatchmakerCandidates([sitePoint()], null);
    const parsed = parseSiteMatchmakerContextPayload(
      {
        version: 1,
        generatedAt: "2026-08-05T12:00:00.000Z",
        zip: "60617",
        sources: ["U.S. Census Bureau", { label: "EPA National Walkability Index" }],
        rows: { [rows[0].contextKey]: context() },
      },
      "60617",
    );

    expect(parsed?.contextByKey.get(rows[0].contextKey)).toEqual(context());
    expect(parsed?.sourceNotes).toEqual([
      "U.S. Census Bureau",
      "EPA National Walkability Index",
    ]);
    expect(
      parseSiteMatchmakerContextPayload(
        { version: 1, generatedAt: "now", zip: "60624", sources: [], rows: {} },
        "60617",
      ),
    ).toBeNull();
  });

  it("rejects malformed metrics without rejecting the valid snapshot", () => {
    const parsed = parseSiteMatchmakerContextPayload(
      {
        version: 1,
        generatedAt: "2026-08-05T12:00:00.000Z",
        zip: "60617",
        sources: [],
        rows: {
          valid: context(),
          malformed: { ...context(), walkabilityIndex: 42 },
        },
      },
      "60617",
    );

    expect(parsed?.contextByKey.size).toBe(1);
    expect(parsed?.contextByKey.has("valid")).toBe(true);
  });
});

describe("candidate filtering", () => {
  const rows = normalizeSiteMatchmakerCandidates(
    [
      sitePoint(),
      sitePoint({
        address: "200 E OAK ST",
        pin: "21111111111111",
        propertyType: "vacant_land",
        squareFeet: null,
        ownerType: "city_public",
        ownerStructure: "government",
        zoningClass: null,
        saleYear: 2022,
        violation: false,
      }),
    ],
    [landPoint()],
  );

  it("treats empty selections as no filter", () => {
    expect(rows.filter((row) => candidateMatchesFilters(row, filters()))).toHaveLength(3);
  });

  it("searches address and formatted or digits-only PIN fragments", () => {
    expect(rows.filter((row) => candidateMatchesFilters(row, filters({ search: "oak" })))).toEqual([
      rows[1],
    ]);
    expect(
      rows.filter((row) => candidateMatchesFilters(row, filters({ search: "20-12-345" }))),
    ).toEqual([rows[0]]);
  });

  it("ANDs dimensions while ORing selected values within a dimension", () => {
    const result = rows.filter((row) =>
      candidateMatchesFilters(
        row,
        filters({
          sources: new Set(["tracked_inventory"]),
          propertyTypes: new Set(["vacant_land"]),
          footprintPublication: new Set(["not_published"]),
          ownerSectors: new Set(["public"]),
          ownerStructures: new Set(["government"]),
          zoning: new Set([ZONING_NOT_PUBLISHED]),
          distress: new Set(["tax_sale", "violation"]),
        }),
      ),
    );

    expect(result).toEqual([rows[1]]);
  });

  it("filters every source-backed dimension independently", () => {
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ sources: new Set(["reconciled_vacant_land"]) })),
      ),
    ).toEqual([rows[2]]);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ propertyTypes: new Set(["vacant_building"]) })),
      ),
    ).toEqual([rows[0]]);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ ownerStructures: new Set(["individual"]) })),
      ),
    ).toEqual([rows[2]]);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ zoning: new Set(["code:B3-2"]) })),
      ),
    ).toEqual([rows[0]]);
    expect(candidateZoningFilterValue(rows[2])).toBe(ZONING_NOT_MAPPED);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ distress: new Set(["none"]) })),
      ),
    ).toEqual([rows[2]]);
  });

  it("buckets a row by its sub-type, not its full code", () => {
    // "B3-2" -> "B3". The "-2" is bulk, not use type, so it must not
    // split Community Shopping into separate buckets per density.
    expect(candidateDistrictFilterValue(rows[0])).toBe("B3");
  });

  it("filters by sub-type and by family roll-up from one selection", () => {
    // Specific: the exact use type.
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ districtFamilies: new Set(["B3"]) })),
      ),
    ).toEqual([rows[0]]);

    // Roll-up: the same row, selected by its family.
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ districtFamilies: new Set(["commercial"]) })),
      ),
    ).toEqual([rows[0]]);

    // A sibling sub-type in the same family does not match it.
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ districtFamilies: new Set(["B1"]) })),
      ),
    ).toEqual([]);

    // A family the result set does not contain matches nothing.
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ districtFamilies: new Set(["manufacturing"]) })),
      ),
    ).toEqual([]);
  });

  it("reuses the zoning availability sentinels for missing districts", () => {
    // Same vocabulary as the code filter rather than a second one.
    expect(candidateDistrictFilterValue(rows[2])).toBe(ZONING_NOT_MAPPED);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ districtFamilies: new Set([ZONING_NOT_MAPPED]) })),
      ),
    ).toEqual([rows[2]]);
  });

  it("labels each district bucket for the dropdown", () => {
    // Sub-types carry the code and its meaning; families stay plain.
    expect(candidateDistrictFilterLabel("B3")).toBe("B3 · Community Shopping");
    expect(candidateDistrictFilterLabel("commercial")).toBe("Business/Commercial");
    expect(candidateDistrictFilterLabel("residential")).toBe("Residential");
    expect(candidateDistrictFilterLabel(DISTRICT_UNCLASSIFIED)).toBe("District not classified");
    expect(candidateDistrictFilterLabel(ZONING_NOT_PUBLISHED)).toBe("Not published");
    expect(candidateDistrictFilterLabel(ZONING_NOT_MAPPED)).toBe("Not mapped in this source");
  });
});

describe("source-backed context filtering", () => {
  const baseRows = normalizeSiteMatchmakerCandidates(
    [
      sitePoint({ address: "100 E DENSE ST" }),
      sitePoint({ address: "200 E QUIET ST", lat: 41.75, pin: "21111111111111" }),
      sitePoint({ address: "300 E UNKNOWN ST", lat: 41.76, pin: "22222222222222" }),
    ],
    null,
  );
  const rows = joinCandidateContext(
    baseRows,
    new Map([
      [
        baseRows[0].contextKey,
        context({
          populationDensityPerSqMi: 14_000,
          walkabilityIndex: 16,
          nearestExpresswayMiles: 0.8,
          midwayMiles: 6,
          ohareMiles: 20,
        }),
      ],
      [
        baseRows[1].contextKey,
        context({
          populationDensityPerSqMi: 4_000,
          walkabilityIndex: 8,
          nearestExpresswayMiles: 3.5,
          midwayMiles: 12,
          ohareMiles: 9,
        }),
      ],
    ]),
  );

  it("keeps missing context visible until a context filter is active", () => {
    expect(rows.filter((row) => candidateMatchesFilters(row, filters()))).toHaveLength(3);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ minimumPopulationDensity: 5_000 })),
      ),
    ).toEqual([rows[0]]);
  });

  it("uses the published EPA category thresholds exactly", () => {
    expect(epaWalkabilityCategory(1)).toBe("least_walkable");
    expect(epaWalkabilityCategory(5.75)).toBe("least_walkable");
    expect(epaWalkabilityCategory(5.76)).toBe("below_average");
    expect(epaWalkabilityCategory(10.5)).toBe("below_average");
    expect(epaWalkabilityCategory(10.51)).toBe("above_average");
    expect(epaWalkabilityCategory(15.25)).toBe("above_average");
    expect(epaWalkabilityCategory(15.26)).toBe("most_walkable");
    expect(epaWalkabilityCategory(20)).toBe("most_walkable");
    expect(epaWalkabilityCategory(null)).toBeNull();

    expect(
      rows.filter((row) =>
        candidateMatchesFilters(
          row,
          filters({ walkabilityCategories: new Set(["most_walkable"]) }),
        ),
      ),
    ).toEqual([rows[0]]);
  });

  it("filters straight-line expressway and nearest-airport distance", () => {
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ maximumExpresswayMiles: 1 })),
      ),
    ).toEqual([rows[0]]);
    expect(
      rows.filter((row) =>
        candidateMatchesFilters(row, filters({ maximumNearestAirportMiles: 10 })),
      ),
    ).toEqual([rows[0], rows[1]]);
  });
});

describe("candidate sorting and unknown footprints", () => {
  const rows = normalizeSiteMatchmakerCandidates(
    [
      sitePoint({ address: "200 E B ST", squareFeet: null }),
      sitePoint({ address: "100 E A ST", squareFeet: 1_000 }),
    ],
    [landPoint({ address: "300 E C ST", squareFeet: 500 })],
  );

  it("retains unpublished footprints and labels them explicitly", () => {
    const result = filterAndSortCandidateRows(rows, filters(), {
      key: "footprint",
      direction: "asc",
    });
    expect(result).toHaveLength(3);
    expect(result.map((row) => row.squareFeet)).toEqual([500, 1_000, null]);
    expect(candidateFootprintLabel(result[2])).toBe(
      "Needs size verification · Reported available space not published",
    );
  });

  it("keeps null footprints last in both sort directions", () => {
    const desc = filterAndSortCandidateRows(rows, filters(), {
      key: "footprint",
      direction: "desc",
    });
    expect(desc.map((row) => row.squareFeet)).toEqual([1_000, 500, null]);
  });

  it("sorts addresses without mutating the input", () => {
    const originalOrder = rows.map((row) => row.id);
    const sorted = filterAndSortCandidateRows(rows, filters(), {
      key: "address",
      direction: "asc",
    });
    expect(sorted.map((row) => row.address)).toEqual(["100 E A ST", "300 E C ST", "200 E B ST"]);
    expect(rows.map((row) => row.id)).toEqual(originalOrder);
  });

  it("keeps missing context last among size-confirmed rows for every context sort", () => {
    const enriched = joinCandidateContext(
      rows,
      new Map([
        [
          rows[0].contextKey,
          context({
            populationDensityPerSqMi: 9_000,
            walkabilityIndex: 14,
            nearestExpresswayMiles: 2,
            midwayMiles: 10,
            ohareMiles: 18,
          }),
        ],
        [
          rows[1].contextKey,
          context({
            populationDensityPerSqMi: 12_000,
            walkabilityIndex: 16,
            nearestExpresswayMiles: 1,
            midwayMiles: 8,
            ohareMiles: 20,
          }),
        ],
      ]),
    );

    for (const key of [
      "population_density",
      "walkability",
      "expressway_distance",
      "midway_distance",
      "ohare_distance",
    ] as const) {
      const asc = filterAndSortCandidateRows(enriched, filters(), { key, direction: "asc" });
      const desc = filterAndSortCandidateRows(enriched, filters(), { key, direction: "desc" });
      expect(asc.at(-1)?.squareFeet).toBeNull();
      expect(desc.at(-1)?.squareFeet).toBeNull();
      expect(asc.at(-2)?.context).toBeNull();
      expect(desc.at(-2)?.context).toBeNull();
    }
  });
});

describe("candidateRowsToCsv", () => {
  it("escapes cells and exports only explicit public-safe columns", () => {
    const baseRows = normalizeSiteMatchmakerCandidates(
      [
        sitePoint({
          address: '100 "A", MAIN\nST',
          squareFeet: null,
        }),
      ],
      [landPoint({ address: null, pin: "" })],
    );
    const rows = joinCandidateContext(
      baseRows,
      new Map([[baseRows[0].contextKey, context()]]),
    );
    const csv = candidateRowsToCsv(rows);
    const header = csv.slice(0, csv.indexOf("\r\n"));

    expect(header).toBe(
      '"Source view","Address","PIN","Property type","Size field used for match","Match area (sq ft)","Lot area (sq ft)","Lot area publication state","Assessor building area (sq ft)","Assessor building area publication state","Assessor building tax year","County property class","County property class state","Assessed value","Assessed value tax year","Assessed value stage","Assessment check state","Mapped building footprint on parcel (sq ft)","Mapped footprint source vintage","Reported available space (sq ft)","Available space source","Available space verified at","Available space reconfirm by","Owner classification","Owner type","Zoning","Incentive geographies","Source-backed flags","Census tract","Tract population","Population density (people/sq mi)","EPA Walkability Index (1-20)","Nearest expressway","Nearest expressway straight-line miles","Midway straight-line miles","O\'Hare straight-line miles","CookViewer parcel details","Cook County Assessor property record","Cook County Clerk recorded documents"',
    );
    expect(csv).toContain('"100 ""A"", MAIN\nST"');
    expect(csv).toContain('"Not published"');
    expect(csv).toContain('"Not mapped in this source"');
    expect(csv).toContain('"Needs verification"');
    expect(csv).toContain("https://maps.cookcountyil.gov/cookviewer/?pin14=20123456789012");
    expect(csv).toContain('"4200","8500","12.5","Dan Ryan Expy (I-90/94)"');
    expect(csv).toContain('"Not mapped for this location"');
    expect(csv).not.toMatch(/owner name|explorer score|rank|recommendation bucket|projected incentive|estimated dollars|\$/i);
  });

  it("exports checked assessment stage/status and keeps untouched rows explicitly not checked", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint({ address: "100 E MAIN ST" }), sitePoint({ address: "200 E MAIN ST" })],
      null,
    );
    const csv = candidateRowsToCsv(rows, "available", {
      [rows[0].id]: {
        status: "checked",
        sourceUnavailable: false,
        facts: {
          countyClass: "517",
          classGloss: "Commercial building",
          countyClassStatus: "available",
          lotAreaSqft: 3125,
          lotAreaStatus: "available",
          assessorBuildingSqft: 1800,
          assessorBuildingYear: "2025",
          assessorBuildingAreaStatus: "available",
          assessedValue: 6900,
          assessedYear: "2025",
          assessedStage: "board",
          assessedValueStatus: "available",
          impliedMarketValue: 27600,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
        },
      },
    });
    expect(csv).toContain(
      '"3125","Available · current County record","1800","Available · current County record","2025"',
    );
    expect(csv).toContain('"517","Available","6900","2025","board","Available"');
    expect(csv).toContain('"Not checked","Not checked","Not checked","Not checked","Not checked","Not checked"');
  });

  it("dates a County area fact this table received from the precomputed snapshot, and never calls it 'current'", () => {
    // This table's buildId is not the universe buildId TODAY, so the enrich
    // route always answers it live. That is a caller-side accident, not a
    // guarantee — if a caller ever sends the universe buildId the route will
    // answer from the snapshot, and this surface must already be honest
    // about it rather than inheriting a stale "current" claim.
    const rows = normalizeSiteMatchmakerCandidates([sitePoint({ address: "100 E MAIN ST" })], null);
    const csv = candidateRowsToCsv(rows, "available", {
      [rows[0].id]: {
        status: "checked",
        sourceUnavailable: false,
        facts: {
          countyClass: "517",
          classGloss: "Commercial building",
          countyClassStatus: "available",
          lotAreaSqft: 3125,
          lotAreaStatus: "available",
          assessorBuildingSqft: 1800,
          assessorBuildingYear: "2025",
          assessorBuildingAreaStatus: "available",
          assessedValue: 6900,
          assessedYear: "2025",
          assessedStage: "board",
          assessedValueStatus: "available",
          impliedMarketValue: 27600,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
          countyFactsSource: "precomputed_snapshot",
          countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
        },
      },
    });
    expect(csv).toContain('"Available · County record · checked Aug 15, 2026"');
    expect(csv).not.toContain("Available · current County record");
  });

  it("says which record failed to publish an area — the snapshot's, dated, not 'the current record'", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint({ address: "100 E MAIN ST", squareFeet: 4200 })],
      null,
    );
    const csv = candidateRowsToCsv(rows, "available", {
      [rows[0].id]: {
        status: "checked",
        sourceUnavailable: false,
        facts: {
          countyClass: null,
          classGloss: null,
          countyClassStatus: "not_published",
          lotAreaSqft: null,
          lotAreaStatus: "not_published",
          assessorBuildingSqft: null,
          assessorBuildingYear: null,
          assessorBuildingAreaStatus: "not_published",
          assessedValue: null,
          assessedYear: null,
          assessedStage: null,
          assessedValueStatus: "not_published",
          impliedMarketValue: null,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
          countyFactsSource: "precomputed_snapshot",
          countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
        },
      },
    });
    expect(csv).toContain("Published snapshot · County record (checked Aug 15, 2026) did not publish an area");
    expect(csv).not.toContain("current County record did not publish an area");
  });

  it("keeps the live wording byte-identical when the facts came from a live County read", () => {
    const rows = normalizeSiteMatchmakerCandidates(
      [sitePoint({ address: "100 E MAIN ST", squareFeet: 4200 })],
      null,
    );
    const csv = candidateRowsToCsv(rows, "available", {
      [rows[0].id]: {
        status: "checked",
        sourceUnavailable: false,
        facts: {
          countyClass: null,
          classGloss: null,
          countyClassStatus: "not_published",
          lotAreaSqft: null,
          lotAreaStatus: "not_published",
          assessorBuildingSqft: null,
          assessorBuildingYear: null,
          assessorBuildingAreaStatus: "not_published",
          assessedValue: null,
          assessedYear: null,
          assessedStage: null,
          assessedValueStatus: "not_published",
          impliedMarketValue: null,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
          countyFactsSource: "live_county",
          countyFactsCheckedAt: "2026-08-16T04:02:47.077Z",
        },
      },
    });
    expect(csv).toContain("Published snapshot · current County record did not publish an area");
    expect(csv).not.toContain("checked Aug");
  });

  it("keeps a partial County class failure distinct from a published assessment", () => {
    const [row] = normalizeSiteMatchmakerCandidates([sitePoint()], null);
    const csv = candidateRowsToCsv([row], "available", {
      [row.id]: {
        status: "checked",
        sourceUnavailable: true,
        facts: {
          countyClass: null,
          classGloss: null,
          countyClassStatus: "unavailable",
          lotAreaSqft: null,
          lotAreaStatus: "unavailable",
          assessorBuildingSqft: null,
          assessorBuildingYear: null,
          assessorBuildingAreaStatus: "unavailable",
          assessedValue: 6900,
          assessedYear: "2025",
          assessedStage: "board",
          assessedValueStatus: "available",
          impliedMarketValue: null,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
        },
      },
    });
    expect(csv).toContain('"Unavailable","Unavailable","6900","2025","board","Available"');
    expect(csv).toContain('"Published snapshot · current County check unavailable"');
  });

  it("keeps a partial assessment failure distinct from an available County class", () => {
    const [row] = normalizeSiteMatchmakerCandidates([sitePoint()], null);
    const csv = candidateRowsToCsv([row], "available", {
      [row.id]: {
        status: "checked",
        sourceUnavailable: true,
        facts: {
          countyClass: "517",
          classGloss: "Commercial building",
          countyClassStatus: "available",
          lotAreaSqft: 3125,
          lotAreaStatus: "available",
          assessorBuildingSqft: 1800,
          assessorBuildingYear: "2025",
          assessorBuildingAreaStatus: "available",
          assessedValue: null,
          assessedYear: null,
          assessedStage: null,
          assessedValueStatus: "unavailable",
          impliedMarketValue: null,
          activeLicenses: [],
          activeLicenseStatus: "not_requested",
        },
      },
    });
    expect(csv).toContain('"517","Available","Unavailable","Unavailable","Unavailable","Unavailable"');
  });

  it("neutralizes formula-leading externally sourced cells", () => {
    const [row] = normalizeSiteMatchmakerCandidates(
      [sitePoint({ address: "=HYPERLINK(\"https://bad.example\")" })],
      null,
    );
    expect(candidateRowsToCsv([row])).toContain("'=HYPERLINK");
  });
});
