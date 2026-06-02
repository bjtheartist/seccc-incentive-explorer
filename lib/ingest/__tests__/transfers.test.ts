import { describe, expect, it } from "vitest";
import { transfersAdapter } from "../transfers";
import type { RawTransfer } from "@/lib/types/transfers";

const base: RawTransfer = {
  declaration_id: "20100201600108",
  document_number: "1426019087D",
  date_recorded: "2014-09-17T00:00:00.000",
  line_4_instrument_date: "2014-09-05T00:00:00.000",
  line_5_instrument_type: "Warranty Deed",
  line_11_full_consideration: "418000.0",
  line_13_net_consideration: "418000.0",
  line_1_primary_pin: "27-31-306-004-0000",
  line_1_county: "Cook",
  line_1_zip_code: "604671319",
  line_2_total_parcels: "1",
  full_address: "11625 HIDDEN VALLEY COVE ORLAND PARK, IL 604671319",
  line_1_street: "11625 HIDDEN VALLEY COVE",
  line_1_city: "ORLAND PARK",
  step_4_seller_name: "DOUGLAS R RICHTER",
  step_4_buyer_name: "PAVLO RABYNYUK",
};

describe("transfersAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = transfersAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.transferId).toBe("1426019087D");
    expect(row!.docNumber).toBe("1426019087D");
    expect(row!.recordedDate).toBe("2014-09-17");
    expect(row!.instrumentDate).toBe("2014-09-05");
    expect(row!.instrumentType).toBe("Warranty Deed");
    expect(row!.seller).toBe("DOUGLAS R RICHTER");
    expect(row!.buyer).toBe("PAVLO RABYNYUK");
    expect(row!.county).toBe("Cook");
    expect(row!.fullAddress).toBe(
      "11625 HIDDEN VALLEY COVE ORLAND PARK, IL 604671319"
    );
  });

  it("normalizes the dashed MyDec PIN to 14 digits", () => {
    const row = transfersAdapter.normalize(base);
    expect(row!.pin).toBe("27313060040000");
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = transfersAdapter.normalize(base);
    expect(row!.source).toBe("transfers");
    expect(row!.provenance.source).toBe("transfers");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("truncates ISO recorded/instrument dates to YYYY-MM-DD", () => {
    const row = transfersAdapter.normalize({
      ...base,
      date_recorded: "2019-06-02T00:00:00.000",
      line_4_instrument_date: "2019-05-21T00:00:00.000",
    });
    expect(row!.recordedDate).toBe("2019-06-02");
    expect(row!.instrumentDate).toBe("2019-05-21");
  });

  it("parses consideration amounts to numbers", () => {
    const row = transfersAdapter.normalize(base);
    expect(row!.considerationAmount).toBe(418000);
    expect(row!.netConsideration).toBe(418000);
  });

  it("derives is_multisale from total parcels > 1", () => {
    const single = transfersAdapter.normalize(base);
    expect(single!.isMultisale).toBe(false);
    expect(single!.numParcels).toBe(1);

    const multi = transfersAdapter.normalize({
      ...base,
      line_2_total_parcels: "3",
    });
    expect(multi!.isMultisale).toBe(true);
    expect(multi!.numParcels).toBe(3);
  });

  it("falls back to declaration_id when document_number is absent", () => {
    const row = transfersAdapter.normalize({
      ...base,
      document_number: undefined,
    });
    expect(row!.transferId).toBe("20100201600108");
    expect(row!.docNumber).toBeNull();
  });

  it("builds full_address from street + city when full_address is absent", () => {
    const row = transfersAdapter.normalize({
      ...base,
      full_address: undefined,
    });
    expect(row!.fullAddress).toBe("11625 HIDDEN VALLEY COVE, ORLAND PARK");
  });

  it("nulls missing optional fields without dropping the row", () => {
    const row = transfersAdapter.normalize({
      document_number: "ABC123",
      date_recorded: base.date_recorded,
    });
    expect(row).not.toBeNull();
    expect(row!.pin).toBeNull();
    expect(row!.instrumentType).toBeNull();
    expect(row!.considerationAmount).toBeNull();
    expect(row!.netConsideration).toBeNull();
    expect(row!.seller).toBeNull();
    expect(row!.buyer).toBeNull();
    expect(row!.numParcels).toBeNull();
    expect(row!.isMultisale).toBe(false);
  });

  it("drops a non-numeric consideration to null without dropping the row", () => {
    const row = transfersAdapter.normalize({
      ...base,
      line_11_full_consideration: "n/a",
    });
    expect(row).not.toBeNull();
    expect(row!.considerationAmount).toBeNull();
  });

  it("drops records missing both document_number and declaration_id", () => {
    expect(
      transfersAdapter.normalize({ ...base, document_number: undefined, declaration_id: undefined })
    ).toBeNull();
    expect(
      transfersAdapter.normalize({ ...base, document_number: "  ", declaration_id: "  " })
    ).toBeNull();
  });
});
