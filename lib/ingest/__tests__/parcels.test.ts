import { describe, expect, it } from "vitest";
import { parcelsAdapter, type RawParcel } from "../parcels";

const base: RawParcel = {
  pin: "25103000010000",
  address: "1234 E 79TH ST",
  class: "5-17",
  tax_code: "73105",
  township_name: "Hyde Park",
  land_square_footage: "3200",
  building_square_footage: "2400",
  age: "95",
  certified_land: "40000",
  certified_building: "120000",
  certified_total: "160000",
  property_type: "0",
  lat: "41.7510",
  lon: "-87.5800",
  zip_code: "60649",
};

describe("parcelsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("25103000010000");
    expect(row!.address).toBe("1234 E 79TH ST");
    expect(row!.zip).toBe("60649");
    expect(row!.classCode).toBe("5-17");
    expect(row!.classDescription).toBe("One-story commercial building");
    expect(row!.landSqft).toBe(3200);
    expect(row!.bldgSqft).toBe(2400);
    expect(row!.bldgAge).toBe(95);
    expect(row!.landValue).toBe(40000);
    expect(row!.totalValue).toBe(160000);
    expect(row!.isCommercial).toBe(true);
    expect(row!.isIndustrial).toBe(false);
    expect(row!.isVacant).toBe(false);
    expect(row!.lat).toBeCloseTo(41.751);
    expect(row!.lon).toBeCloseTo(-87.58);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("parcels");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("derives valuation from assessed-value enrichment without inventing ownership", () => {
    const row = parcelsAdapter.normalize({
      ...base,
      assessor: {
        pin: base.pin,
        year: "2023",
        certified_land: "40000",
        certified_bldg: "120000",
        certified_tot: "160000",
      },
    });
    expect(row!.taxYear).toBe("2023");
    expect(row!.assessedLand).toBe(40000);
    expect(row!.assessedBuilding).toBe(120000);
    expect(row!.assessedTotal).toBe(160000);
    expect(row!.ownerName).toBeNull();
    expect(row!.ownerMailingAddress).toBeNull();
    expect(row!.ownerType).toBeNull();
  });

  it("leaves ownership/valuation null when no assessor data", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row!.ownerName).toBeNull();
    expect(row!.ownerType).toBeNull();
    expect(row!.taxYear).toBeNull();
    expect(row!.assessedTotal).toBeNull();
  });

  it("drops records with no PIN", () => {
    expect(parcelsAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, pin: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(parcelsAdapter.normalize({ ...base, lat: undefined, latitude: undefined })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, lat: "0", lon: "0" })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, lat: "40.0" })).toBeNull();
  });
});
