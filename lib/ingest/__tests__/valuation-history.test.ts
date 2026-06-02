import { describe, expect, it } from "vitest";
import { valuationHistoryAdapter, type RawValuation } from "../valuation-history";

const base: RawValuation = {
  pin: "30182270240000",
  year: "2018",
  certified_land: "2050",
  certified_bldg: "7453",
  certified_tot: "9503",
};

describe("valuationHistoryAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = valuationHistoryAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("30182270240000");
    expect(row!.taxYear).toBe("2018");
    expect(row!.assessedLand).toBe(2050);
    expect(row!.assessedBuilding).toBe(7453);
    expect(row!.assessedTotal).toBe(9503);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = valuationHistoryAdapter.normalize(base);
    expect(row!.source).toBe("valuation_history");
    expect(row!.provenance.source).toBe("valuation_history");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("derives assessed_total from land + building when total is absent", () => {
    const row = valuationHistoryAdapter.normalize({
      ...base,
      certified_tot: undefined,
    });
    expect(row!.assessedTotal).toBe(9503);
  });

  it("keeps a row with only a total and null components", () => {
    const row = valuationHistoryAdapter.normalize({
      pin: base.pin,
      year: base.year,
      certified_tot: "12345",
    });
    expect(row).not.toBeNull();
    expect(row!.assessedLand).toBeNull();
    expect(row!.assessedBuilding).toBeNull();
    expect(row!.assessedTotal).toBe(12345);
  });

  it("drops records missing pin or year", () => {
    expect(valuationHistoryAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(valuationHistoryAdapter.normalize({ ...base, pin: "  " })).toBeNull();
    expect(valuationHistoryAdapter.normalize({ ...base, year: undefined })).toBeNull();
  });

  it("drops records with no assessed values at all", () => {
    const row = valuationHistoryAdapter.normalize({
      pin: base.pin,
      year: base.year,
    });
    expect(row).toBeNull();
  });
});
