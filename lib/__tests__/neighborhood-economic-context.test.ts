import { describe, expect, it } from "vitest";
import citywideGrowthSnapshot from "@/data/exports/chicago-neighborhood-economics/neighborhood_economics_by_zip.json";
import {
  extractChicagoZipCode,
  findGrowthSignalByZip,
  growthSignalToNeighborhoodEconomics,
  mergeCommunityAnchorsIntoNeighborhoodEconomics,
  mergeCorridorMetricIntoNeighborhoodEconomics,
  mergeLiveAcsIntoNeighborhoodEconomics,
  mergeTifFinanceIntoNeighborhoodEconomics,
  type NeighborhoodGrowthSnapshot,
} from "@/lib/neighborhood-economic-context";

const citywideSnapshot = citywideGrowthSnapshot as NeighborhoodGrowthSnapshot;

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
    expect(extractChicagoZipCode("Oak Park, IL 60302")).toBeNull();
  });

  it("covers the non-606 Chicago ZIPs in the citywide artifact", () => {
    // Milestone 3 coverage explicitly includes 60707 and 60827.
    expect(extractChicagoZipCode("1234 N Harlem Ave, Chicago, IL 60707")).toBe("60707");
    expect(extractChicagoZipCode(null, "Riverdale, Chicago, Illinois, 60827")).toBe("60827");
  });

  it("resolves a Chicago ZIP even when a non-ZIP 5-digit token appears first", () => {
    // Street/parcel numbers should not block the real ZIP later in the string.
    expect(extractChicagoZipCode("12345 S Halsted St, Chicago, IL 60628")).toBe("60628");
  });

  it("matches every ZIP present in the citywide artifact", () => {
    // Drift guard: if a future export adds a ZIP the extractor can't resolve,
    // that ZIP's economic context would be silently unreachable in reports.
    for (const zip of citywideSnapshot.zips) {
      expect(extractChicagoZipCode(`Chicago, IL ${zip}`)).toBe(zip);
    }
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
    // Modeled signals derived from spending power + payroll.
    expect(context.leakage?.estimatedLeakageRate).not.toBeNull();
    expect(context.multiplier?.localOutputEstimateLow).toBeCloseTo(264217000 * 1.4);
    expect(context.multiplier?.localOutputEstimateHigh).toBeCloseTo(264217000 * 1.8);
  });

  it("maps assessed-value aggregates into the property signal", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619")!;
    const context = growthSignalToNeighborhoodEconomics(
      {
        ...signal,
        assessedValueBaseline: 1_000_000_000,
        assessedValueComparison: 1_250_000_000,
        assessedValueChangeRate: 0.25,
        assessedValueYearBaseline: 2020,
        assessedValueYearComparison: 2024,
      },
      snapshot
    );
    expect(context.property?.assessedValueComparison).toBe(1_250_000_000);
    expect(context.property?.assessedValueChangeRate).toBeCloseTo(0.25);
    expect(context.property?.assessedValueYearComparison).toBe(2024);
    expect(context.property?.sourceLabel).toContain("certified values");
  });

  it("merges curated community anchors and surfaces them as multiplier drivers", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619")!;
    const base = growthSignalToNeighborhoodEconomics(signal, snapshot);
    const context = mergeCommunityAnchorsIntoNeighborhoodEconomics(
      base,
      [
        { name: "Corner Store", totalScore: 52, impactTier: "Moderate" },
        { name: "Regional Hospital", totalScore: 88, impactTier: "High", confidence: "High", rationale: "Largest employer", sourceUrls: ["https://example.org/hospital"] },
      ],
      "Greater Grand Crossing"
    );
    expect(context?.anchors?.[0]?.name).toBe("Regional Hospital");
    expect(context?.anchors?.[0]?.totalScore).toBe(88);
    expect(context?.anchorGeography).toBe("Greater Grand Crossing");
    expect(context?.multiplier?.anchorDrivers?.[0]).toBe("Regional Hospital");
    expect(context?.limitations?.join(" ")).toContain("Anchor businesses are curated");
  });

  it("leaves context unchanged when no anchors are curated for the area", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619")!;
    const base = growthSignalToNeighborhoodEconomics(signal, snapshot);
    expect(mergeCommunityAnchorsIntoNeighborhoodEconomics(base, [])?.anchors).toBeUndefined();
    expect(mergeCommunityAnchorsIntoNeighborhoodEconomics(base, null)?.anchors).toBeUndefined();
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

  it("overrides artifact spending-power context with live ACS values", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619");
    const base = growthSignalToNeighborhoodEconomics(signal!, snapshot);

    const context = mergeLiveAcsIntoNeighborhoodEconomics(base, "60619", {
      zip: "60619",
      population: 103296,
      households: 43040,
      medianHouseholdIncome: 58508,
      employedResidents: 41111,
      residentSpendingPowerProxy: 2518184320,
      sourceLabel: "2024 ACS 5-year ZCTA API (live Census)",
    });

    expect(context?.spendingPower?.population).toBe(103296);
    expect(context?.spendingPower?.medianHouseholdIncome).toBe(58508);
    expect(context?.spendingPower?.residentSpendingPowerProxy).toBe(2518184320);
    expect(context?.spendingPower?.sourceLabel).toBe("2024 ACS 5-year ZCTA API (live Census)");
    expect(context?.limitations?.join(" ")).toContain("live Census ACS");
  });

  it("can create a minimal report context from live ACS values only", () => {
    const context = mergeLiveAcsIntoNeighborhoodEconomics(null, "60601", {
      zip: "60601",
      population: 15235,
      households: 9631,
      medianHouseholdIncome: 121458,
      employedResidents: 10081,
      residentSpendingPowerProxy: 1169761998,
      sourceLabel: "2024 ACS 5-year ZCTA API (live Census)",
    });

    expect(context?.geographyLabel).toBe("ZIP 60601");
    expect(context?.spendingPower?.population).toBe(15235);
    expect(context?.spendingPower?.sourceLabel).toBe("2024 ACS 5-year ZCTA API (live Census)");
  });

  it("merges TIF district finance context without implying availability", () => {
    const signal = findGrowthSignalByZip(snapshot, "60619");
    const base = growthSignalToNeighborhoodEconomics(signal!, snapshot);

    const context = mergeTifFinanceIntoNeighborhoodEconomics(base, {
      districtId: "T-087",
      districtName: "Fullerton/Milwaukee",
      reportYear: 2024,
      expirationYear: 2027,
      fundBalance: 63162041,
      amountDesignatedProjectCosts: 63011079,
      sourceLabel: "City of Chicago TIF Annual Report",
      sourceUrl: "https://data.cityofchicago.org/resource/qm7s-3ctt.json",
      caution: "District-level City annual report data. Not proof of funding availability.",
    });

    expect(context?.tifFinance?.districtId).toBe("T-087");
    expect(context?.tifFinance?.fundBalance).toBe(63162041);
    expect(context?.limitations?.join(" ")).toContain("do not show available funds");
  });
});
