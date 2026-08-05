import { area, polygon } from "@turf/turf";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMigrationCliArgs } from "../migrate-parcel-space-measurements";
import {
  aggregateCityFootprintAreaByParcel,
  commercialBuildingMeasurementRow,
  cookViewerMeasurementRows,
  normalizeCommercialBuildingAreaRecords,
  normalizeCookViewerParcelRecord,
  normalizePin14,
  parseZipList,
  positiveNumberOrNull,
  SQUARE_METERS_TO_SQUARE_FEET,
  stableSourceRecordId,
  type CityBuildingPolygonFeature,
  type ParcelPolygonFeature,
} from "../parcel-space-enrichment";
import { parseCityFootprintSyncCliArgs } from "../sync-city-building-footprints";
import { parseCookViewerSyncCliArgs } from "../sync-cookviewer-parcel-space";

function parcel(
  pin: string,
  west: number,
  east: number,
): ParcelPolygonFeature {
  return polygon(
    [[
      [west, 41.73],
      [east, 41.73],
      [east, 41.74],
      [west, 41.74],
      [west, 41.73],
    ]],
    { pin, zip: "60617" },
  );
}

function building(
  sourceRecordId: string,
  west: number,
  east: number,
  status = "ACTIVE",
  sourceUpdatedAt: string | null = null,
): CityBuildingPolygonFeature {
  return polygon(
    [[
      [west, 41.732],
      [east, 41.732],
      [east, 41.738],
      [west, 41.738],
      [west, 41.732],
    ]],
    { sourceRecordId, status, sourceUpdatedAt, rawJson: { bldg_id: sourceRecordId } },
  );
}

describe("parcel-space source normalization", () => {
  it("normalizes formatted or leading-zero PINs without treating them as numbers", () => {
    expect(normalizePin14("21-32-211-039-0000")).toBe("21322110390000");
    expect(normalizePin14("00-00-000-000-0123")).toBe("00000000000123");
    expect(normalizePin14(123)).toBeNull();
    expect(normalizePin14("123")).toBeNull();
    expect(normalizePin14("PIN 21322110390000")).toBeNull();
    expect(normalizePin14("123456789012345")).toBeNull();
  });

  it("treats zero, negative, blank, and non-numeric square footage as unknown", () => {
    expect(positiveNumberOrNull("1,592")).toBe(1592);
    expect(positiveNumberOrNull(0)).toBeNull();
    expect(positiveNumberOrNull(-1)).toBeNull();
    expect(positiveNumberOrNull(" ")).toBeNull();
    expect(positiveNumberOrNull("unknown")).toBeNull();
  });

  it("maps current Cook County parcel fields to the two published metrics only", () => {
    const fetchedAt = "2026-08-05T12:00:00.000Z";
    const record = normalizeCookViewerParcelRecord(
      {
        PIN14: "21-32-211-039-0000",
        LANDSF: "0",
        BLDGSQFT: "1,592",
        BLDGAGE: 0,
        TAXYR: "2024",
        last_edited_date: Date.parse("2024-02-01T00:00:00.000Z"),
        GlobalID: "{record-id}",
      },
      fetchedAt,
    );

    expect(record).toMatchObject({
      pin: "21322110390000",
      landSqft: null,
      buildingSqft: 1592,
      buildingAge: null,
      taxYear: 2024,
      geometryYear: null,
      sourceUpdatedAt: "2024-02-01T00:00:00.000Z",
      fetchedAt,
    });
    const measurements = cookViewerMeasurementRows(record!);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toMatchObject({
      zip: null,
      metric: "assessor_building_area",
      sqft: 1592,
      sourceKey: "cook_county_current_parcels",
      matchMethod: "exact_pin",
      verificationStatus: "published",
    });
    expect(measurements.some((row) => row.metric === "available_space")).toBe(false);
  });

  it("retains legacy field aliases for previously captured CookViewer records", () => {
    const record = normalizeCookViewerParcelRecord({
      PIN14: "21322110390000",
      LandSqft: 4_000,
      BldgSqft: 2_500,
      BldgAge: 40,
      geom_year: 2023,
      assessor_update_date: "2024-03-01T00:00:00Z",
    });

    expect(record).toMatchObject({
      pin: "21322110390000",
      landSqft: 4_000,
      buildingSqft: 2_500,
      buildingAge: 40,
      geometryYear: 2023,
      sourceUpdatedAt: "2024-03-01T00:00:00.000Z",
    });
  });

  it("publishes one latest commercial BLDGSF and quarantines conflicting rows", () => {
    const fetchedAt = "2026-08-05T12:00:00.000Z";
    const result = normalizeCommercialBuildingAreaRecords(
      [
        { keypin: "20-11-408-060-0000", year: 2021, bldgsf: 20_000 },
        { keypin: "20-11-408-060-0000", year: 2024, bldgsf: 27_346 },
        { keypin: "20-11-408-060-0000", year: 2024, bldgsf: "27,346" },
        { keypin: "25-14-300-014-0000", year: 2024, bldgsf: 100_000 },
        { keypin: "25-14-300-014-0000", year: 2024, bldgsf: 55_765 },
        { keypin: "26-08-123-007-0000", year: 2024 },
        { keypin: "not-a-pin", year: 2024, bldgsf: 1_000 },
        { keypin: "20342310250000", year: "unknown", bldgsf: 1_000 },
      ],
      fetchedAt,
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      pin: "20114080600000",
      buildingSqft: 27_346,
      sourceYear: 2024,
      fetchedAt,
    });
    expect(result.observedPins).toEqual([
      "20114080600000",
      "25143000140000",
      "26081230070000",
    ]);
    expect(result.ambiguousPins).toEqual(["25143000140000"]);
    expect(result.unresolvedPins).toEqual(["26081230070000"]);
    expect(result.identicalRowsDeduplicated).toBe(1);
    expect(result.invalidPinRows).toBe(1);
    expect(result.invalidYearRows).toBe(1);

    expect(commercialBuildingMeasurementRow(result.records[0])).toMatchObject({
      metric: "assessor_building_area",
      sqft: 27_346,
      sourceKey: "cook_county_assessor_commercial_valuation_csik-bsws",
      sourceRecordId: "20114080600000:2024",
      matchMethod: "exact_pin",
      verificationStatus: "published",
    });
  });

  it("validates and de-duplicates explicit target ZIPs", () => {
    expect(parseZipList("60617, 60619,60617")).toEqual(["60617", "60619"]);
    expect(() => parseZipList("60617,Chicago")).toThrow(/Invalid ZIP/);
  });
});

describe("parcel-space migration contract", () => {
  it("keeps the ledger independent while validating and indexing optional ZIP context", () => {
    const migration = readFileSync(
      new URL("../migrate-parcel-space-measurements.ts", import.meta.url),
      "utf8",
    );

    expect(migration).not.toMatch(/REFERENCES\s+parcels/i);
    expect(migration).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(migration).toMatch(/zip\s+TEXT/i);
    expect(migration).toMatch(/zip IS NULL OR zip ~ '\^\[0-9\]\{5\}\$'/);
    expect(migration).toContain("idx_parcel_space_measurements_zip_metric");
    expect(migration).toContain("largest_contiguous_usable_interior_space");
    expect(migration).toContain("verified_at TIMESTAMPTZ");
    expect(migration).toContain("reconfirm_after TIMESTAMPTZ");
    expect(migration).toContain("is_active BOOLEAN");
    expect(migration).toContain("current_available_space_measurements");
    expect(migration).toMatch(/reconfirm_after > NOW\(\)/);
    expect(migration).toMatch(/verification_status = 'verified'/);
  });

  it("keeps every mutation path dry-run by default and rejects mixed modes", () => {
    expect(parseMigrationCliArgs([]).write).toBe(false);
    expect(parseCookViewerSyncCliArgs(["--zips=60617"]).write).toBe(false);
    expect(parseCityFootprintSyncCliArgs(["--zips=60617"]).write).toBe(false);
    expect(() =>
      parseCookViewerSyncCliArgs(["--zips=60617", "--write", "--dry-run"]),
    ).toThrow(/either --write or --dry-run/);
    expect(() =>
      parseCityFootprintSyncCliArgs(["--zips=60617", "--write", "--dry-run"]),
    ).toThrow(/either --write or --dry-run/);
  });
});

describe("City building-footprint overlap aggregation", () => {
  it("clips cross-parcel buildings, sums each parcel overlap, and excludes non-existing records", () => {
    const parcelOne = parcel("21322110390000", -87.61, -87.6);
    const parcelTwo = parcel("21322110400000", -87.6, -87.59);
    const insideOne = building(
      "inside-one",
      -87.608,
      -87.604,
      "ACTIVE",
      "2014-01-01T00:00:00.000Z",
    );
    const crossing = building(
      "crossing",
      -87.602,
      -87.598,
      "active",
      "2015-07-01T00:00:00.000Z",
    );
    const demolished = building("demolished", -87.596, -87.592, "DEMOLISHED");

    const result = aggregateCityFootprintAreaByParcel(
      [parcelOne, parcelTwo],
      [insideOne, crossing, crossing, demolished],
    );

    const crossingWestHalf = building("expected-west", -87.602, -87.6);
    const crossingEastHalf = building("expected-east", -87.6, -87.598);
    const expectedOneSqft =
      (area(insideOne) + area(crossingWestHalf)) * SQUARE_METERS_TO_SQUARE_FEET;
    const expectedTwoSqft = area(crossingEastHalf) * SQUARE_METERS_TO_SQUARE_FEET;

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].pin).toBe("21322110390000");
    expect(result.rows[0].sqft).toBeCloseTo(expectedOneSqft, 4);
    expect(result.rows[0].buildingIds).toEqual(["crossing", "inside-one"]);
    expect(result.rows[0].sourceUpdatedAt).toBe("2015-07-01T00:00:00.000Z");
    expect(result.rows[1].pin).toBe("21322110400000");
    expect(result.rows[1].sqft).toBeCloseTo(expectedTwoSqft, 4);
    expect(result.rows[1].buildingIds).toEqual(["crossing"]);
    expect(result.diagnostics).toMatchObject({
      inputBuildingCount: 4,
      indexedBuildingCount: 2,
      duplicateBuildingCount: 1,
      excludedStatusCount: 1,
      positiveIntersectionCount: 3,
    });
  });

  it("builds a deterministic source identity independent of record order", () => {
    expect(stableSourceRecordId("syp8-uezg-2015", ["b", "a", "a"])).toBe(
      stableSourceRecordId("syp8-uezg-2015", ["a", "b"]),
    );
  });

  it("unions overlapping clipped polygons instead of double-counting their shared area", () => {
    const targetParcel = parcel("21322110390000", -87.61, -87.59);
    const first = building("first", -87.608, -87.602);
    const second = building("second", -87.605, -87.599);
    const expectedUnion = building("expected-union", -87.608, -87.599);

    const result = aggregateCityFootprintAreaByParcel(
      [targetParcel],
      [first, second],
    );
    const summedIndividualSqft =
      (area(first) + area(second)) * SQUARE_METERS_TO_SQUARE_FEET;
    const expectedUnionSqft = area(expectedUnion) * SQUARE_METERS_TO_SQUARE_FEET;

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sqft).toBeCloseTo(expectedUnionSqft, 4);
    expect(result.rows[0].sqft).toBeLessThan(summedIndividualSqft);
    expect(result.rows[0].intersections).toHaveLength(2);
  });
});
