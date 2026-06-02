import { describe, expect, it } from "vitest";
import {
  computeNeighborhoodGrowthSignals,
  estimateLicenseCategory,
  type SpendingPowerInput,
} from "@/lib/neighborhood-growth";
import type { BusinessCohortRecord } from "@/lib/southeast-resilience";

function record(overrides: Partial<BusinessCohortRecord>): BusinessCohortRecord {
  return {
    entityKey: "x",
    status: "retained",
    accountNumber: null,
    businessName: "Test",
    legalName: null,
    dbaName: "Test",
    primaryAddress: "1 E 79TH ST",
    zip: "60619",
    licenseDescriptions: ["Limited Business License"],
    licenseStatuses: ["AAI"],
    licenseIds: ["1"],
    activeInBaselineYear: true,
    activeInComparisonYear: true,
    firstLicenseStart: "2020-01-01",
    latestExpiration: "2026-01-01",
    licenseCount: 1,
    evidence: [],
    reviewReason: null,
    ...overrides,
  };
}

describe("estimateLicenseCategory", () => {
  it("uses category-specific job and wage proxies", () => {
    expect(estimateLicenseCategory(["Retail Food Establishment"]).category).toBe("food_and_restaurant");
    expect(estimateLicenseCategory(["Manufacturing Establishment"]).category).toBe("production_industrial");
  });

  it("falls back to general business estimates", () => {
    expect(estimateLicenseCategory(["Unmapped Thing"]).category).toBe("general_business");
  });
});

describe("computeNeighborhoodGrowthSignals", () => {
  it("computes measured business growth and modeled job/payroll signals by ZIP", () => {
    const spending: SpendingPowerInput[] = [
      {
        zip: "60619",
        population: 50000,
        households: 20000,
        medianHouseholdIncome: 45000,
        employedResidents: 18000,
      },
    ];

    const result = computeNeighborhoodGrowthSignals(
      [
        record({
          entityKey: "retained",
          status: "retained",
          activeInBaselineYear: true,
          activeInComparisonYear: true,
          licenseDescriptions: ["Retail Food Establishment"],
        }),
        record({
          entityKey: "left",
          status: "left_or_closed",
          activeInBaselineYear: true,
          activeInComparisonYear: false,
          licenseDescriptions: ["Limited Business License"],
        }),
        record({
          entityKey: "new",
          status: "new_since_baseline",
          activeInBaselineYear: false,
          activeInComparisonYear: true,
          licenseDescriptions: ["Medical Clinic"],
        }),
      ],
      spending,
      [
        {
          zip: "60619",
          year: 2020,
          establishments: 100,
          employment: 1000,
          firstQuarterPayroll: 10000000,
          annualPayroll: 40000000,
        },
        {
          zip: "60619",
          year: 2023,
          establishments: 110,
          employment: 1250,
          firstQuarterPayroll: 15000000,
          annualPayroll: 60000000,
        },
      ]
    );

    expect(result.zips).toHaveLength(1);
    const signal = result.zips[0];
    expect(signal.baselineActiveBusinesses).toBe(2);
    expect(signal.comparisonActiveBusinesses).toBe(2);
    expect(signal.resilienceRate).toBe(0.5);
    expect(signal.businessNetGrowthRate).toBe(0);
    expect(signal.estimatedFteBaseline).toBe(8.5);
    expect(signal.estimatedFteComparison).toBe(13);
    expect(signal.residentSpendingPowerProxy).toBe(900000000);
    expect(signal.officialEmploymentGrowthRate).toBe(0.25);
    expect(signal.officialPayrollGrowthRate).toBe(0.5);
    expect(result.aggregate.zip).toBe("aggregate");
    expect(result.aggregate.officialEmploymentComparison).toBe(1250);
  });
});
