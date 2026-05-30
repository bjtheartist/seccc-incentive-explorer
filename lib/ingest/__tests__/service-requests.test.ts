import { describe, expect, it } from "vitest";
import {
  serviceRequestsAdapter,
  type RawServiceRequest,
} from "../service-requests";

const base: RawServiceRequest = {
  sr_number: "SR24-00123456",
  sr_type: "Rodent Baiting/Rat Complaint",
  status: "Open",
  created_date: "2024-05-01T09:30:00.000",
  street_address: "9769 S OGLESBY AVE",
  zip_code: "60617",
  latitude: "41.71683317753641",
  longitude: "-87.56553837659989",
};

describe("serviceRequestsAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = serviceRequestsAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.srNumber).toBe("SR24-00123456");
    expect(row!.srType).toBe("Rodent Baiting/Rat Complaint");
    expect(row!.status).toBe("Open");
    expect(row!.createdDate).toBe("2024-05-01T09:30:00.000");
    expect(row!.address).toBe("9769 S OGLESBY AVE");
    expect(row!.zip).toBe("60617");
    expect(row!.lat).toBeCloseTo(41.7168);
    expect(row!.lon).toBeCloseTo(-87.5655);
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = serviceRequestsAdapter.normalize(base);
    expect(row!.provenance.source).toBe("service_requests_311");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("drops records with no sr number", () => {
    expect(serviceRequestsAdapter.normalize({ ...base, sr_number: undefined })).toBeNull();
    expect(serviceRequestsAdapter.normalize({ ...base, sr_number: "  " })).toBeNull();
  });

  it("drops records with missing or out-of-bounds coordinates", () => {
    expect(serviceRequestsAdapter.normalize({ ...base, latitude: undefined })).toBeNull();
    expect(serviceRequestsAdapter.normalize({ ...base, latitude: "0", longitude: "0" })).toBeNull();
    expect(serviceRequestsAdapter.normalize({ ...base, latitude: "43.0" })).toBeNull();
  });

  it("leaves optional text fields null when absent", () => {
    const row = serviceRequestsAdapter.normalize({
      sr_number: "SR24-X",
      latitude: "41.71",
      longitude: "-87.56",
    });
    expect(row!.srType).toBeNull();
    expect(row!.status).toBeNull();
    expect(row!.createdDate).toBeNull();
    expect(row!.address).toBeNull();
    expect(row!.zip).toBeNull();
  });
});
