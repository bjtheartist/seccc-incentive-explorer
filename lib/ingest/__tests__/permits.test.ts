import { describe, expect, it } from "vitest";
import { permitsAdapter, type RawPermit } from "../permits";

const base: RawPermit = {
  permit_: "100912345",
  permit_type: "PERMIT - RENOVATION/ALTERATION",
  work_description: "INTERIOR REMODEL",
  issue_date: "2024-03-15T00:00:00.000",
  reported_cost: "125000",
  pin_list: "2605112042;2605112043",
  street_number: "3251",
  street_direction: "S",
  street_name: "91ST ST",
  latitude: "41.7300",
  longitude: "-87.5448",
};

describe("permitsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = permitsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.permitId).toBe("100912345");
    expect(row!.permitType).toBe("PERMIT - RENOVATION/ALTERATION");
    expect(row!.workDescription).toBe("INTERIOR REMODEL");
    expect(row!.issueDate).toBe("2024-03-15T00:00:00.000");
    expect(row!.reportedCost).toBe(125000);
    expect(row!.address).toBe("3251 S 91ST ST");
    expect(row!.lat).toBeCloseTo(41.73);
    expect(row!.lon).toBeCloseTo(-87.5448);
    expect(row!.isDemolition).toBe(false);
  });

  it("takes the first PIN from the semicolon-separated pin_list", () => {
    expect(permitsAdapter.normalize(base)!.pin).toBe("2605112042");
    expect(permitsAdapter.normalize({ ...base, pin_list: undefined })!.pin).toBeNull();
  });

  it("flags demolition permits from permit_type", () => {
    const demo = permitsAdapter.normalize({
      ...base,
      permit_type: "PERMIT - WRECKING/DEMOLITION",
    });
    expect(demo!.isDemolition).toBe(true);

    // Case-insensitive match.
    const demoLower = permitsAdapter.normalize({
      ...base,
      permit_type: "permit - demolition",
    });
    expect(demoLower!.isDemolition).toBe(true);

    // Non-demolition stays false.
    expect(permitsAdapter.normalize(base)!.isDemolition).toBe(false);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = permitsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("building_permits");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no permit id", () => {
    expect(permitsAdapter.normalize({ ...base, permit_: undefined })).toBeNull();
    expect(permitsAdapter.normalize({ ...base, permit_: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(permitsAdapter.normalize({ ...base, latitude: undefined })).toBeNull();
    expect(permitsAdapter.normalize({ ...base, latitude: "0", longitude: "0" })).toBeNull();
    expect(permitsAdapter.normalize({ ...base, latitude: "40.0" })).toBeNull();
  });

  it("leaves optional numeric/text fields null when absent", () => {
    const row = permitsAdapter.normalize({
      permit_: "X1",
      latitude: "41.73",
      longitude: "-87.54",
    });
    expect(row!.reportedCost).toBeNull();
    expect(row!.permitType).toBeNull();
    expect(row!.workDescription).toBeNull();
    expect(row!.issueDate).toBeNull();
    expect(row!.address).toBeNull();
    expect(row!.zip).toBeNull();
    expect(row!.isDemolition).toBe(false);
  });
});
