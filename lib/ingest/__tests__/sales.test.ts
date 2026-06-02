import { describe, expect, it } from "vitest";
import { salesAdapter, type RawSale } from "../sales";

const base: RawSale = {
  pin: "25103000010000",
  year: "2023",
  sale_date: "2023-01-18T00:00:00.000",
  sale_price: "160000",
  doc_no: "2303046131",
  deed_type: "Warranty",
  mydec_deed_type: "Warranty Deed",
  seller_name: "HENRIETTA PLAIR",
  buyer_name: "HULA HUT HOLDINGS LLC",
};

describe("salesAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = salesAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.pin).toBe("25103000010000");
    expect(row!.saleDate).toBe("2023-01-18");
    expect(row!.salePrice).toBe(160000);
    expect(row!.deedType).toBe("Warranty");
    expect(row!.seller).toBe("HENRIETTA PLAIR");
    expect(row!.buyer).toBe("HULA HUT HOLDINGS LLC");
    expect(row!.documentNumber).toBe("2303046131");
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = salesAdapter.normalize(base);
    expect(row!.source).toBe("parcel_sales");
    expect(row!.provenance.source).toBe("parcel_sales");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("truncates an ISO sale_date to a YYYY-MM-DD date", () => {
    const row = salesAdapter.normalize({ ...base, sale_date: "2019-06-02T00:00:00.000" });
    expect(row!.saleDate).toBe("2019-06-02");
  });

  it("falls back to mydec_deed_type when deed_type is absent", () => {
    const row = salesAdapter.normalize({ ...base, deed_type: undefined });
    expect(row!.deedType).toBe("Warranty Deed");
  });

  it("nulls missing optional fields", () => {
    const row = salesAdapter.normalize({
      pin: base.pin,
      sale_date: base.sale_date,
      doc_no: base.doc_no,
    });
    expect(row!.salePrice).toBeNull();
    expect(row!.deedType).toBeNull();
    expect(row!.seller).toBeNull();
    expect(row!.buyer).toBeNull();
  });

  it("drops records missing pin, sale_date, or doc_no", () => {
    expect(salesAdapter.normalize({ ...base, pin: undefined })).toBeNull();
    expect(salesAdapter.normalize({ ...base, pin: "  " })).toBeNull();
    expect(salesAdapter.normalize({ ...base, sale_date: undefined })).toBeNull();
    expect(salesAdapter.normalize({ ...base, doc_no: undefined })).toBeNull();
    expect(salesAdapter.normalize({ ...base, doc_no: "  " })).toBeNull();
  });

  it("drops a non-numeric sale_price to null without dropping the row", () => {
    const row = salesAdapter.normalize({ ...base, sale_price: "n/a" });
    expect(row).not.toBeNull();
    expect(row!.salePrice).toBeNull();
  });
});
