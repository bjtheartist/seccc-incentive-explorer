import { describe, expect, it } from "vitest";
import {
  addressTenure,
  detectActivity,
  isActive,
  isClosure,
  licenseAgeYears,
} from "@/lib/business-activity";
import type { BusinessLicense } from "@/lib/types/business";

const NOW = new Date("2026-05-29T00:00:00.000Z");

function lic(overrides: Partial<BusinessLicense>): BusinessLicense {
  return {
    licenseId: "x",
    accountNumber: null,
    legalName: null,
    dbaName: null,
    address: null,
    zip: null,
    licenseCode: null,
    licenseDescription: null,
    applicationType: null,
    licenseStatus: "AAI",
    licenseStartDate: null,
    expirationDate: null,
    dateIssued: null,
    lat: null,
    lon: null,
    ...overrides,
  };
}

describe("licenseAgeYears", () => {
  it("computes whole years since start", () => {
    expect(licenseAgeYears("2020-01-01", NOW)).toBe(6);
    expect(licenseAgeYears("2026-01-01", NOW)).toBe(0);
  });
  it("clamps future starts to 0 and handles bad input", () => {
    expect(licenseAgeYears("2030-01-01", NOW)).toBe(0);
    expect(licenseAgeYears(null, NOW)).toBeNull();
    expect(licenseAgeYears("not-a-date", NOW)).toBeNull();
  });
});

describe("isActive", () => {
  it("is true for future or absent expiration", () => {
    expect(isActive("2028-01-01", NOW)).toBe(true);
    expect(isActive(null, NOW)).toBe(true);
  });
  it("is false for past expiration", () => {
    expect(isActive("2024-01-01", NOW)).toBe(false);
  });
});

describe("isClosure", () => {
  it("flags cancelled/revoked regardless of date", () => {
    expect(isClosure({ licenseStatus: "AAC", expirationDate: "2030-01-01" }, NOW)).toBe(true);
    expect(isClosure({ licenseStatus: "REV", expirationDate: null }, NOW)).toBe(true);
  });
  it("flags expired and clears active", () => {
    expect(isClosure({ licenseStatus: "AAI", expirationDate: "2024-01-01" }, NOW)).toBe(true);
    expect(isClosure({ licenseStatus: "AAI", expirationDate: "2028-01-01" }, NOW)).toBe(false);
  });
});

describe("addressTenure", () => {
  it("computes earliest start, latest expiration, and tenure per address", () => {
    const out = addressTenure(
      [
        lic({ licenseId: "a1", address: "100 E 79TH ST", licenseStartDate: "2015-01-01", expirationDate: "2017-01-01" }),
        lic({ licenseId: "a2", address: "100 e 79th st", licenseStartDate: "2017-01-01", expirationDate: "2027-01-01" }),
        lic({ licenseId: "b1", address: "200 S STATE ST", licenseStartDate: "2022-06-01", expirationDate: "2024-06-01" }),
      ],
      NOW
    );
    expect(out).toHaveLength(2);
    const a = out.find((t) => t.address === "100 E 79TH ST")!;
    expect(a.earliestStart).toBe("2015-01-01");
    expect(a.latestExpiration).toBe("2027-01-01");
    expect(a.licenseCount).toBe(2);
    expect(a.tenureYears).toBe(11);
  });

  it("ignores rows lacking address or parseable start", () => {
    const out = addressTenure(
      [
        lic({ address: null, licenseStartDate: "2015-01-01" }),
        lic({ address: "1 MAIN ST", licenseStartDate: null }),
      ],
      NOW
    );
    expect(out).toHaveLength(0);
  });
});

describe("detectActivity", () => {
  it("detects openings within the window", () => {
    const events = detectActivity(
      [lic({ licenseId: "open1", address: "5 ELM", dbaName: "NEW CO", licenseStartDate: "2026-03-01", expirationDate: "2028-03-01" })],
      NOW
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("opening");
    expect(events[0].licenseId).toBe("open1");
  });

  it("detects closures from cancellation or recent expiry", () => {
    const events = detectActivity(
      [
        lic({ licenseId: "c1", licenseStatus: "AAC", licenseStartDate: "2010-01-01", expirationDate: "2030-01-01" }),
        lic({ licenseId: "c2", licenseStatus: "AAI", licenseStartDate: "2010-01-01", expirationDate: "2026-01-01" }),
      ],
      NOW
    );
    const closures = events.filter((e) => e.kind === "closure");
    expect(closures.map((e) => e.licenseId).sort()).toEqual(["c1", "c2"]);
  });

  it("ignores old activity outside the window", () => {
    const events = detectActivity(
      [lic({ licenseId: "old", licenseStatus: "AAI", licenseStartDate: "2010-01-01", expirationDate: "2012-01-01" })],
      NOW
    );
    expect(events).toHaveLength(0);
  });
});
