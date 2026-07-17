import { describe, expect, it } from "vitest";
import { annualTaxSaleAdapter, type RawAnnualTaxSaleEntry } from "../annual-tax-sale";

// Live-verified sample row (datacatalog.cookcountyil.gov 55ju-2fs9).
const base: RawAnnualTaxSaleEntry = {
  tax_sale_year: "2013",
  pin: "07-18-411-025-0000",
  classification: "241",
  township_name: "SCHAUMBURG",
  sold_at_sale: false,
  tax_amount_offered: "101.15",
  penalty_amount_offered: "24.21",
  total_tax_and_penalty_amount_offered: "125.36",
  location_1: { latitude: "42.0374226710761", longitude: "-88.1305266989017" },
};

describe("annualTaxSaleAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row, converting the PIN to digits-only", () => {
    const row = annualTaxSaleAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("07184110250000");
    expect(row!.taxSaleYear).toBe(2013);
    expect(row!.classification).toBe("241");
    expect(row!.townshipName).toBe("SCHAUMBURG");
    expect(row!.soldAtSale).toBe(false);
    expect(row!.taxAmountOffered).toBeCloseTo(101.15);
    expect(row!.penaltyAmountOffered).toBeCloseTo(24.21);
    expect(row!.totalTaxAndPenaltyAmountOffered).toBeCloseTo(125.36);
    expect(row!.lat).toBeCloseTo(42.0374);
    expect(row!.lon).toBeCloseTo(-88.1305);
  });

  it("builds the entryId from pin + year (a PIN can repeat across years)", () => {
    const row2013 = annualTaxSaleAdapter.normalize(base);
    const row2014 = annualTaxSaleAdapter.normalize({ ...base, tax_sale_year: "2014" });
    expect(row2013!.entryId).toBe("07184110250000:2013");
    expect(row2014!.entryId).toBe("07184110250000:2014");
    expect(row2013!.entryId).not.toBe(row2014!.entryId);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = annualTaxSaleAdapter.normalize(base);
    expect(row!.provenance.source).toBe("annual_tax_sale");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no PIN", () => {
    expect(annualTaxSaleAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(annualTaxSaleAdapter.normalize({ ...base, pin: "" })).toBeNull();
  });

  it("keeps a record with missing optional fields, defaulting each to null", () => {
    const row = annualTaxSaleAdapter.normalize({ pin: "07-18-411-025-0000" });
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("07184110250000");
    expect(row!.taxSaleYear).toBeNull();
    expect(row!.classification).toBeNull();
    expect(row!.townshipName).toBeNull();
    expect(row!.soldAtSale).toBeNull();
    expect(row!.taxAmountOffered).toBeNull();
    expect(row!.penaltyAmountOffered).toBeNull();
    expect(row!.totalTaxAndPenaltyAmountOffered).toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.lon).toBeNull();
    expect(row!.entryId).toBe("07184110250000:na");
  });
});

describe("annualTaxSaleAdapter.fetch", () => {
  it("returns [] without making a network call when no pins are provided", async () => {
    await expect(annualTaxSaleAdapter.fetch({ zips: ["60617"], pins: [] })).resolves.toEqual([]);
    await expect(annualTaxSaleAdapter.fetch({ zips: ["60617"] })).resolves.toEqual([]);
  });
});
