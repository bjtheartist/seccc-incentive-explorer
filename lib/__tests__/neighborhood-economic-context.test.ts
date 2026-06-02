import { describe, expect, it } from "vitest";
import {
  extractChicagoZipCode,
  findGrowthSignalByZip,
  growthSignalToNeighborhoodEconomics,
  mergeCorridorMetricIntoNeighborhoodEconomics,
  type NeighborhoodGrowthSnapshot,
} from "@/lib/neighborhood-economic-context";

const snapshot: NeighborhoodGrowthSnapshot = {
  source: "socrata",
  baselineYear: 2020,
  comparisonYear: 2025,
  zips: ["60619"],
  spendingPowerSource: "ACS local join",
  businessPatternSource: "Census ZIP Business Patterns totals files",
  byZip: [
    {
      zip: "60619",
      baselineActiveBusinesses: 780,
      comparisonActiveBusinesses: 699,
      retainedBusinesses: 360,
      leftOrClosedBusinesses: 420,
      newBusinesses: 339,
      resilienceRate: 0.4615384615,
      officialBusinessPatternBaselineYear: 2020,
      officialBusinessPatternComparisonYear: 2023,
      officialEstablishmentsBaseline: 555,
      officialEstablishmentsComparison: 565,
      officialEmploymentBaseline: 4850,
      officialEmploymentComparison: 6093,
      officialEmploymentGrowthRate: 0.2562886598,
      officialAnnualPayrollBaseline: 174292000,
      officialAnnualPayrollComparison: 264217000,
      officialPayrollGrowthRate: 0.5159445069,
      population: 119334,
      households: 49723,
      medianHouseholdIncome: 57731,
      residentSpendingPowerProxy: 2870558513,
      permitCount: 510,
      permitReportedCost: 50330310,
      permitDemolitionCount: 6,
      permitWindowMonths: 24,
      parcelCount: 20332,
      vacantParcelCount: 1123,
      commercialParcelCount: 913,
      industrialParcelCount: 0,
    },
  ],
};

describe("extractChicagoZipCode", () => {
  it("extracts a Chicago ZIP from address-like values", () => {
    expect(extractChicagoZipCode("8701 S Bennett Ave, Chicago, IL 60617")).toBe("60617");
    expect(extractChicagoZipCode(null, "Mayfair, Chicago, Illinois, 60617, United States")).toBe("60617");
  });

  it("ignores non-Chicago ZIPs", () => {
    expect(extractChicagoZipCode("Evanston, IL 60201")).toBeNull();
  });
});

describe("growthSignalToNeighborhoodEconomics", () => {
  it("maps aggregate growth signals into safe report context", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619");
    expect(signal).toBeDefined();

    const context = growthSignalToNeighborhoodEconomics(signal!, snapshot);
    expect(context.geographyLabel).toBe("ZIP 60619");
    expect(context.businessContinuity?.baselineActive).toBe(780);
    expect(context.businessContinuity?.continuityRate).toBeCloseTo(0.4615);
    expect(context.jobsPayroll?.baselineEmployment).toBe(4850);
    expect(context.jobsPayroll?.comparisonAnnualPayroll).toBe(264217000);
    expect(context.spendingPower?.residentSpendingPowerProxy).toBe(2870558513);
    expect(context.reinvestment?.permitCount).toBe(510);
    expect(context.reinvestment?.reportedCost).toBe(50330310);
    expect(context.reinvestment?.windowLabel).toBe("the trailing 24 months");
    expect(context.property?.parcelCount).toBe(20332);
    expect(context.property?.vacantParcelCount).toBe(1123);
    expect(context.property?.commercialParcelCount).toBe(913);
    expect(context.limitations?.join(" ")).toContain("not be treated as a verified closure");
  });

  it("merges aggregate corridor permit and ownership metrics into report context", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619");
    const base = growthSignalToNeighborhoodEconomics(signal!, snapshot);

    const context = mergeCorridorMetricIntoNeighborhoodEconomics(base, {
      corridorType: "zip",
      corridorId: "60619",
      asOf: "2026-06-02",
      localOwnershipShare: 0.41,
      permitCount: 42,
      details: {
        windowMonths: 24,
        ownershipConcentration: {
          distinctOwners: 1200,
          totalParcels: 1800,
          topOwnerShare: 0.03,
        },
        permits: {
          permitCount: 42,
          totalReportedCost: 104700000,
          demolitionCount: 3,
        },
      },
    });

    expect(context?.reinvestment?.permitCount).toBe(42);
    expect(context?.reinvestment?.reportedCost).toBe(104700000);
    expect(context?.reinvestment?.windowLabel).toBe("the trailing 24 months");
    expect(context?.property?.distinctOwners).toBe(1200);
    expect(context?.property?.localOwnershipShare).toBe(0.41);
    expect(context?.limitations?.join(" ")).toContain("aggregate corridor metrics");
  });
});
