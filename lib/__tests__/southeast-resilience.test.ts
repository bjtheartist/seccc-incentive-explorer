import { describe, expect, it } from "vitest";
import {
  buildBusinessCohorts,
  isLicenseActiveInYear,
  normalizeBusinessAddress,
  normalizeBusinessName,
  type BusinessLicenseCohortInput,
} from "@/lib/southeast-resilience";

function lic(overrides: Partial<BusinessLicenseCohortInput>): BusinessLicenseCohortInput {
  return {
    licenseId: "license-1",
    accountNumber: null,
    legalName: null,
    dbaName: null,
    address: null,
    zip: "60617",
    licenseDescription: "Limited Business License",
    licenseStatus: "AAI",
    licenseStartDate: null,
    expirationDate: null,
    dateIssued: null,
    ...overrides,
  };
}

describe("normalizeBusinessName", () => {
  it("normalizes legal suffixes and punctuation for matching support", () => {
    expect(normalizeBusinessName("The Corner Store, LLC")).toBe("CORNER STORE");
    expect(normalizeBusinessName("A & B Foods Inc.")).toBe("A AND B FOODS");
  });
});

describe("normalizeBusinessAddress", () => {
  it("normalizes common street tokens and directionals", () => {
    expect(normalizeBusinessAddress("123 South Commercial Avenue")).toBe("123 S COMMERCIAL AVE");
    expect(normalizeBusinessAddress("8701 West 95th Street")).toBe("8701 W 95TH ST");
  });
});

describe("isLicenseActiveInYear", () => {
  it("counts a license as active when its date window overlaps the year", () => {
    expect(
      isLicenseActiveInYear(
        lic({ licenseStartDate: "2019-06-01", expirationDate: "2021-05-31" }),
        2020
      )
    ).toBe(true);
  });

  it("does not count licenses outside the year window", () => {
    expect(
      isLicenseActiveInYear(
        lic({ licenseStartDate: "2021-01-01", expirationDate: "2023-01-01" }),
        2020
      )
    ).toBe(false);
    expect(
      isLicenseActiveInYear(
        lic({ licenseStartDate: "2018-01-01", expirationDate: "2019-12-31" }),
        2020
      )
    ).toBe(false);
  });

  it("excludes revoked or cancelled records even when dates overlap", () => {
    expect(
      isLicenseActiveInYear(
        lic({ licenseStatus: "REV", licenseStartDate: "2019-01-01", expirationDate: "2025-01-01" }),
        2020
      )
    ).toBe(false);
  });
});

describe("buildBusinessCohorts", () => {
  it("classifies retained, left, and new businesses between two years", () => {
    const result = buildBusinessCohorts(
      [
        lic({
          licenseId: "retained-2020",
          accountNumber: "100",
          dbaName: "Retained Market",
          address: "100 E 79TH ST",
          licenseStartDate: "2019-01-01",
          expirationDate: "2021-01-01",
        }),
        lic({
          licenseId: "retained-2025",
          accountNumber: "100",
          dbaName: "Retained Market",
          address: "100 E 79TH ST",
          licenseStartDate: "2024-01-01",
          expirationDate: "2026-01-01",
        }),
        lic({
          licenseId: "left",
          accountNumber: "200",
          dbaName: "Gone Cafe",
          address: "200 E 79TH ST",
          licenseStartDate: "2018-01-01",
          expirationDate: "2021-01-01",
        }),
        lic({
          licenseId: "new",
          accountNumber: "300",
          dbaName: "New Shop",
          address: "300 E 79TH ST",
          licenseStartDate: "2024-01-01",
          expirationDate: "2026-01-01",
        }),
      ],
      2020,
      2025
    );

    expect(result.summary.baselineActiveCount).toBe(2);
    expect(result.summary.comparisonActiveCount).toBe(2);
    expect(result.summary.retainedCount).toBe(1);
    expect(result.summary.leftOrClosedCount).toBe(1);
    expect(result.summary.newSinceBaselineCount).toBe(1);
    expect(result.summary.resilienceRate).toBe(0.5);
    expect(result.records.find((record) => record.accountNumber === "100")?.status).toBe("retained");
    expect(result.records.find((record) => record.accountNumber === "200")?.status).toBe("left_or_closed");
    expect(result.records.find((record) => record.accountNumber === "300")?.status).toBe("new_since_baseline");
  });

  it("groups by normalized name and address when account number is missing", () => {
    const result = buildBusinessCohorts(
      [
        lic({
          licenseId: "a",
          dbaName: "The Test Store LLC",
          address: "400 South Commercial Avenue",
          licenseStartDate: "2020-01-01",
          expirationDate: "2021-01-01",
        }),
        lic({
          licenseId: "b",
          dbaName: "Test Store",
          address: "400 S Commercial Ave",
          licenseStartDate: "2025-01-01",
          expirationDate: "2026-01-01",
        }),
      ],
      2020,
      2025
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe("retained");
    expect(result.records[0].evidence[0]).toBe("grouped by normalized name/address");
  });

  it("keeps incomplete records in the review queue", () => {
    const result = buildBusinessCohorts(
      [
        lic({
          licenseId: "needs-review",
          dbaName: null,
          legalName: null,
          address: null,
          licenseStartDate: "2020-01-01",
          expirationDate: "2026-01-01",
        }),
      ],
      2020,
      2025
    );

    expect(result.summary.needsReviewCount).toBe(1);
    expect(result.records[0].status).toBe("needs_review");
    expect(result.records[0].reviewReason).toContain("Missing account number");
  });
});

