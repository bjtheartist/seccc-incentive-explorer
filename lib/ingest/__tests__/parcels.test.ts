import { describe, expect, it, vi } from "vitest";
import { parcelsAdapter, type RawParcel } from "../parcels";

// Fixture matches the CURRENT Parcel Universe schema (nj4t-kc8j, verified
// 2026-07-03): longitudinal spine with lat/lon, no situs address, no sqft
// or valuation fields. Valuations and ownership come only from the
// assessor enrichment.
const base: RawParcel = {
  pin: "25103000010000",
  pin10: "2510300001",
  year: "2024",
  class: "517",
  tax_code: "73105",
  township_name: "Hyde Park",
  nbhd_code: "70130",
  zip_code: "60649",
  lat: "41.7510",
  lon: "-87.5800",
  census_tract_geoid: "17031430102",
};

describe("parcelsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("25103000010000");
    // Situs address is no longer published in the universe dataset.
    expect(row!.address).toBe("");
    expect(row!.zip).toBe("60649");
    expect(row!.classCode).toBe("517");
    expect(row!.isCommercial).toBe(true);
    expect(row!.isIndustrial).toBe(false);
    expect(row!.isVacant).toBe(false);
    expect(row!.lat).toBeCloseTo(41.751);
    expect(row!.lon).toBeCloseTo(-87.58);
    // Fields the county removed from the dataset are honestly null.
    expect(row!.landSqft).toBeNull();
    expect(row!.bldgSqft).toBeNull();
    expect(row!.parcelType).toBeNull();
  });

  it("flags vacant-class parcels", () => {
    const row = parcelsAdapter.normalize({ ...base, class: "100" });
    expect(row!.isVacant).toBe(true);
    expect(row!.isCommercial).toBe(false);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("parcels");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("derives ownership + valuation from assessor enrichment", () => {
    const row = parcelsAdapter.normalize({
      ...base,
      assessor: {
        pin: base.pin,
        tax_year: "2023",
        certified_tot_land: "40000",
        certified_tot_bldg: "120000",
        tax_bill_name: "ACME HOLDINGS LLC",
        tax_bill_mailing_address: "1 MAIN ST",
        tax_bill_city: "MIAMI",
        tax_bill_state: "FL",
        tax_bill_zip: "33101",
      },
    });
    expect(row!.taxYear).toBe("2023");
    expect(row!.assessedLand).toBe(40000);
    expect(row!.assessedBuilding).toBe(120000);
    expect(row!.assessedTotal).toBe(160000);
    // Assessor certified values also populate the parcels value columns now.
    expect(row!.landValue).toBe(40000);
    expect(row!.totalValue).toBe(160000);
    expect(row!.ownerName).toBe("ACME HOLDINGS LLC");
    expect(row!.ownerMailingAddress).toContain("FL");
    // LLC + out-of-state ZIP → out_of_state
    expect(row!.ownerType).toBe("out_of_state");
  });

  it("leaves ownership/valuation null when no assessor data", () => {
    const row = parcelsAdapter.normalize(base);
    expect(row!.ownerName).toBeNull();
    expect(row!.ownerType).toBeNull();
    expect(row!.taxYear).toBeNull();
    expect(row!.assessedTotal).toBeNull();
    expect(row!.landValue).toBeNull();
  });

  it("drops records with no PIN", () => {
    expect(parcelsAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, pin: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(parcelsAdapter.normalize({ ...base, lat: undefined })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, lat: "0", lon: "0" })).toBeNull();
    expect(parcelsAdapter.normalize({ ...base, lat: "40.0" })).toBeNull();
  });
});

describe("parcelsAdapter.upsert", () => {
  it("does not erase CookViewer dimensions during a generic parcel refresh", async () => {
    const query = vi.fn().mockResolvedValue({});
    const row = parcelsAdapter.normalize(base);
    expect(row).not.toBeNull();

    await parcelsAdapter.upsert({ query } as never, [row!]);

    const upsertSql = String(query.mock.calls[0][0]);
    const conflictClause = upsertSql.slice(upsertSql.indexOf("ON CONFLICT"));
    expect(conflictClause).not.toContain("land_sqft = EXCLUDED.land_sqft");
    expect(conflictClause).not.toContain("bldg_sqft = EXCLUDED.bldg_sqft");
  });
});
