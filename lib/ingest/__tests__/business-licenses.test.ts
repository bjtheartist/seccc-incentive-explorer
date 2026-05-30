import { describe, expect, it } from "vitest";
import {
  businessLicensesAdapter,
  type RawBusinessLicense,
} from "../business-licenses";

const base: RawBusinessLicense = {
  id: "2483008-20260716",
  license_id: "3084438",
  account_number: "351377",
  legal_name: "SACRED MEMORIES, LTD.",
  doing_business_as_name: "SACRED MEMORIES FUNERAL HOME",
  address: "2024 E 75TH ST 1",
  zip_code: "60649",
  license_code: "1010",
  license_description: "Limited Business License",
  application_type: "RENEW",
  license_status: "AAI",
  license_start_date: "2026-07-16T00:00:00.000",
  expiration_date: "2028-07-15T00:00:00.000",
  date_issued: "2026-05-28T00:00:00.000",
  latitude: "41.7589989051",
  longitude: "-87.5750594074",
};

describe("businessLicensesAdapter.normalize", () => {
  it("maps a complete record into a DB-ready row", () => {
    const row = businessLicensesAdapter.normalize(base);
    expect(row).not.toBeNull();
    expect(row!.licenseId).toBe("2483008-20260716");
    expect(row!.accountNumber).toBe("351377");
    expect(row!.legalName).toBe("SACRED MEMORIES, LTD.");
    expect(row!.dbaName).toBe("SACRED MEMORIES FUNERAL HOME");
    expect(row!.address).toBe("2024 E 75TH ST 1");
    expect(row!.zip).toBe("60649");
    expect(row!.licenseCode).toBe("1010");
    expect(row!.licenseDescription).toBe("Limited Business License");
    expect(row!.applicationType).toBe("RENEW");
    expect(row!.licenseStatus).toBe("AAI");
    expect(row!.lat).toBeCloseTo(41.759);
    expect(row!.lon).toBeCloseTo(-87.575);
  });

  it("truncates Socrata timestamps to ISO dates", () => {
    const row = businessLicensesAdapter.normalize(base);
    expect(row!.licenseStartDate).toBe("2026-07-16");
    expect(row!.expirationDate).toBe("2028-07-15");
    expect(row!.dateIssued).toBe("2026-05-28");
  });

  it("attaches provenance with the source key and raw record", () => {
    const row = businessLicensesAdapter.normalize(base);
    expect(row!.provenance.source).toBe("business_licenses");
    expect(row!.provenance.raw_json).toBe(base);
  });

  it("falls back to license_id when id is absent", () => {
    const row = businessLicensesAdapter.normalize({ ...base, id: undefined });
    expect(row!.licenseId).toBe("3084438");
  });

  it("drops records with no usable license key", () => {
    expect(
      businessLicensesAdapter.normalize({
        ...base,
        id: undefined,
        license_id: undefined,
      })
    ).toBeNull();
    expect(
      businessLicensesAdapter.normalize({ ...base, id: "  ", license_id: " " })
    ).toBeNull();
  });

  it("keeps the row but nulls geo for missing/out-of-bounds coordinates", () => {
    const noGeo = businessLicensesAdapter.normalize({
      ...base,
      latitude: undefined,
      longitude: undefined,
    });
    expect(noGeo).not.toBeNull();
    expect(noGeo!.lat).toBeNull();
    expect(noGeo!.lon).toBeNull();

    const zero = businessLicensesAdapter.normalize({
      ...base,
      latitude: "0",
      longitude: "0",
    });
    expect(zero!.lat).toBeNull();

    const oob = businessLicensesAdapter.normalize({ ...base, latitude: "40.0" });
    expect(oob!.lat).toBeNull();
  });

  it("nulls empty optional strings and dates", () => {
    const row = businessLicensesAdapter.normalize({
      ...base,
      legal_name: "",
      expiration_date: "",
    });
    expect(row!.legalName).toBeNull();
    expect(row!.expirationDate).toBeNull();
  });
});
