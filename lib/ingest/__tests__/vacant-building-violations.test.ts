import { describe, expect, it } from "vitest";
import { vacantBuildingViolationsAdapter, type RawVacantBuildingViolation } from "../vacant-building-violations";

// Live-verified sample row (data.cityofchicago.org u7si-yh3t).
const base: RawVacantBuildingViolation = {
  id: "7509434",
  violation_code: "CN192019",
  violation_description: "NOTIFY DOB,  USE OF VACANT LND",
  violation_status: "OPEN",
  violation_date: "2026-06-24T00:00:00.000",
  address: "8801 S COTTAGE GROVE AVE",
  latitude: "41.7347817338",
  longitude: "-87.6046308919",
};

describe("vacantBuildingViolationsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = vacantBuildingViolationsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.violationId).toBe("7509434");
    expect(row!.violationCode).toBe("CN192019");
    expect(row!.violationDescription).toBe("NOTIFY DOB,  USE OF VACANT LND");
    expect(row!.violationStatus).toBe("OPEN");
    expect(row!.violationDate).toBe("2026-06-24T00:00:00.000");
    expect(row!.address).toBe("8801 S COTTAGE GROVE AVE");
    expect(row!.lat).toBeCloseTo(41.7348);
    expect(row!.lon).toBeCloseTo(-87.6046);
  });

  it("always leaves zip null (no zip column upstream)", () => {
    const row = vacantBuildingViolationsAdapter.normalize(base);
    expect(row!.zip).toBeNull();
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = vacantBuildingViolationsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("vacant_building_violations");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no violation id", () => {
    expect(vacantBuildingViolationsAdapter.normalize({ ...base, id: undefined })).toBeNull();
    expect(vacantBuildingViolationsAdapter.normalize({ ...base, id: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(vacantBuildingViolationsAdapter.normalize({ ...base, latitude: undefined })).toBeNull();
    expect(vacantBuildingViolationsAdapter.normalize({ ...base, latitude: "0", longitude: "0" })).toBeNull();
    expect(vacantBuildingViolationsAdapter.normalize({ ...base, longitude: "-90.0" })).toBeNull();
  });

  it("leaves optional text fields null when absent", () => {
    const row = vacantBuildingViolationsAdapter.normalize({
      id: "X1",
      latitude: "41.70",
      longitude: "-87.56",
    });
    expect(row!.violationCode).toBeNull();
    expect(row!.violationDescription).toBeNull();
    expect(row!.violationStatus).toBeNull();
    expect(row!.violationDate).toBeNull();
    expect(row!.address).toBeNull();
  });
});

describe("vacantBuildingViolationsAdapter identity", () => {
  it("writes to a table separate from building_violations", () => {
    expect(vacantBuildingViolationsAdapter.targetTable).toBe("vacant_building_violations");
    expect(vacantBuildingViolationsAdapter.sourceKey).toBe("vacant_building_violations");
  });
});
