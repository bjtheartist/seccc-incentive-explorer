import { describe, expect, it } from "vitest";
import { scavengerSaleAdapter, type RawScavengerSaleEntry } from "../scavenger-sale";

// Live-verified sample row (datacatalog.cookcountyil.gov ydgz-vkrp).
const base: RawScavengerSaleEntry = {
  tax_sale_year: "2007",
  pin: "17-21-321-018-0000",
  from_year: "1987",
  to_year: "2005",
  total_amount_paid: "0",
  sold_at_sale: true,
  buyer_name: "BURTLEY ANTHONY",
  location_1: { latitude: "41.855283536182", longitude: "-87.643870485053" },
};

describe("scavengerSaleAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row, converting the PIN to digits-only", () => {
    const row = scavengerSaleAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("17213210180000");
    expect(row!.taxSaleYear).toBe(2007);
    expect(row!.fromYear).toBe(1987);
    expect(row!.toYear).toBe(2005);
    expect(row!.totalAmountPaid).toBe(0);
    expect(row!.soldAtSale).toBe(true);
    expect(row!.buyerName).toBe("BURTLEY ANTHONY");
    expect(row!.lat).toBeCloseTo(41.8553);
    expect(row!.lon).toBeCloseTo(-87.6439);
  });

  it("builds a composite entryId from pin + year + delinquency window", () => {
    const row = scavengerSaleAdapter.normalize(base);
    expect(row!.entryId).toBe("17213210180000:2007:1987:2005");
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = scavengerSaleAdapter.normalize(base);
    expect(row!.provenance.source).toBe("scavenger_sale");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no PIN", () => {
    expect(scavengerSaleAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(scavengerSaleAdapter.normalize({ ...base, pin: "" })).toBeNull();
  });

  it("keeps a record with missing year/amount/geo fields, defaulting each to null", () => {
    const row = scavengerSaleAdapter.normalize({ pin: "17-21-321-018-0000" });
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("17213210180000");
    expect(row!.taxSaleYear).toBeNull();
    expect(row!.fromYear).toBeNull();
    expect(row!.toYear).toBeNull();
    expect(row!.totalAmountPaid).toBeNull();
    expect(row!.soldAtSale).toBeNull();
    expect(row!.buyerName).toBeNull();
    expect(row!.lat).toBeNull();
    expect(row!.lon).toBeNull();
    expect(row!.entryId).toBe("17213210180000:na:na:na");
  });

  it("treats a non-boolean sold_at_sale as null rather than coercing it", () => {
    const row = scavengerSaleAdapter.normalize({ ...base, sold_at_sale: undefined });
    expect(row!.soldAtSale).toBeNull();
  });
});

describe("scavengerSaleAdapter.fetch", () => {
  it("returns [] without making a network call when no pins are provided", async () => {
    await expect(scavengerSaleAdapter.fetch({ zips: ["60617"], pins: [] })).resolves.toEqual([]);
    await expect(scavengerSaleAdapter.fetch({ zips: ["60617"] })).resolves.toEqual([]);
  });
});
