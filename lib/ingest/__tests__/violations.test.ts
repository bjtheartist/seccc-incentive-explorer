import { describe, expect, it } from "vitest";
import { violationsAdapter, type RawViolation } from "../violations";

const base: RawViolation = {
  id: "7098395",
  violation_code: "CN061014",
  violation_description: "ARRANGE PREMISE INSPECTION",
  violation_status: "OPEN",
  violation_date: "2024-01-04T00:00:00.000",
  address: "10827 S BENSLEY AVE",
  latitude: "41.6982981787",
  longitude: "-87.5630208918",
};

describe("violationsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = violationsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.violationId).toBe("7098395");
    expect(row!.violationCode).toBe("CN061014");
    expect(row!.violationDescription).toBe("ARRANGE PREMISE INSPECTION");
    expect(row!.violationStatus).toBe("OPEN");
    expect(row!.violationDate).toBe("2024-01-04T00:00:00.000");
    expect(row!.address).toBe("10827 S BENSLEY AVE");
    expect(row!.lat).toBeCloseTo(41.6983);
    expect(row!.lon).toBeCloseTo(-87.563);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = violationsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("building_violations");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no violation id", () => {
    expect(violationsAdapter.normalize({ ...base, id: undefined })).toBeNull();
    expect(violationsAdapter.normalize({ ...base, id: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(violationsAdapter.normalize({ ...base, latitude: undefined })).toBeNull();
    expect(violationsAdapter.normalize({ ...base, latitude: "0", longitude: "0" })).toBeNull();
    expect(violationsAdapter.normalize({ ...base, longitude: "-90.0" })).toBeNull();
  });

  it("leaves optional text fields null when absent", () => {
    const row = violationsAdapter.normalize({
      id: "X1",
      latitude: "41.70",
      longitude: "-87.56",
    });
    expect(row!.violationCode).toBeNull();
    expect(row!.violationDescription).toBeNull();
    expect(row!.violationStatus).toBeNull();
    expect(row!.violationDate).toBeNull();
    expect(row!.address).toBeNull();
    expect(row!.zip).toBeNull();
  });
});
