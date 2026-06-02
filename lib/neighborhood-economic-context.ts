import type { NeighborhoodEconomicContext } from "./report-engine";

export interface NeighborhoodGrowthSignal {
  zip: string;
  baselineActiveBusinesses: number;
  comparisonActiveBusinesses: number;
  retainedBusinesses: number;
  leftOrClosedBusinesses: number;
  newBusinesses: number;
  resilienceRate: number | null;
  officialBusinessPatternBaselineYear: number | null;
  officialBusinessPatternComparisonYear: number | null;
  officialEstablishmentsBaseline: number | null;
  officialEstablishmentsComparison: number | null;
  officialEmploymentBaseline: number | null;
  officialEmploymentComparison: number | null;
  officialEmploymentGrowthRate: number | null;
  officialAnnualPayrollBaseline: number | null;
  officialAnnualPayrollComparison: number | null;
  officialPayrollGrowthRate: number | null;
  population: number | null;
  households: number | null;
  medianHouseholdIncome: number | null;
  residentSpendingPowerProxy: number | null;
  permitCount?: number | null;
  permitReportedCost?: number | null;
  permitDemolitionCount?: number | null;
  permitWindowMonths?: number | null;
  parcelCount?: number | null;
  vacantParcelCount?: number | null;
  commercialParcelCount?: number | null;
  industrialParcelCount?: number | null;
  measurementNotes?: string[];
}

export interface NeighborhoodGrowthSnapshot {
  source?: string;
  baselineYear: number;
  comparisonYear: number;
  zips: string[];
  spendingPowerSource?: string;
  businessPatternSource?: string;
  byZip: NeighborhoodGrowthSignal[];
}

export interface NeighborhoodCorridorMetricInput {
  corridorType?: string | null;
  corridorId?: string | null;
  asOf?: string | null;
  localOwnershipShare?: number | null;
  permitCount?: number | null;
  details?: {
    windowMonths?: number | null;
    ownershipConcentration?: {
      distinctOwners?: number | null;
      totalParcels?: number | null;
      topOwnerShare?: number | null;
    } | null;
    ownershipOrigin?: {
      localCount?: number | null;
      outsideCount?: number | null;
      unknownCount?: number | null;
    } | null;
    permits?: {
      permitCount?: number | null;
      totalReportedCost?: number | null;
      demolitionCount?: number | null;
    } | null;
  } | null;
}

export function extractChicagoZipCode(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/\b(606\d{2})\b/);
    if (match) return match[1];
  }
  return null;
}

export function findGrowthSignalByZip(
  snapshot: NeighborhoodGrowthSnapshot,
  zip: string
): NeighborhoodGrowthSignal | null {
  return snapshot.byZip.find((signal) => signal.zip === zip) ?? null;
}

export function growthSignalToNeighborhoodEconomics(
  signal: NeighborhoodGrowthSignal,
  snapshot: Pick<
    NeighborhoodGrowthSnapshot,
    "baselineYear" | "comparisonYear" | "source" | "spendingPowerSource" | "businessPatternSource"
  >
): NeighborhoodEconomicContext {
  return {
    geographyLabel: `ZIP ${signal.zip}`,
    businessContinuity: {
      baselineYear: snapshot.baselineYear,
      comparisonYear: snapshot.comparisonYear,
      baselineActive: signal.baselineActiveBusinesses,
      comparisonActive: signal.comparisonActiveBusinesses,
      retained: signal.retainedBusinesses,
      newSinceBaseline: signal.newBusinesses,
      continuityRate: signal.resilienceRate,
      sourceLabel: snapshot.source === "database"
        ? "Chicago business licenses from platform database"
        : "Chicago business licenses from Socrata",
    },
    jobsPayroll: {
      baselineYear: signal.officialBusinessPatternBaselineYear,
      comparisonYear: signal.officialBusinessPatternComparisonYear,
      baselineEstablishments: signal.officialEstablishmentsBaseline,
      comparisonEstablishments: signal.officialEstablishmentsComparison,
      baselineEmployment: signal.officialEmploymentBaseline,
      comparisonEmployment: signal.officialEmploymentComparison,
      employmentGrowthRate: signal.officialEmploymentGrowthRate,
      baselineAnnualPayroll: signal.officialAnnualPayrollBaseline,
      comparisonAnnualPayroll: signal.officialAnnualPayrollComparison,
      payrollGrowthRate: signal.officialPayrollGrowthRate,
      sourceLabel: snapshot.businessPatternSource || "Census ZIP Business Patterns",
    },
    spendingPower: {
      residentSpendingPowerProxy: signal.residentSpendingPowerProxy,
      medianHouseholdIncome: signal.medianHouseholdIncome,
      population: signal.population,
      sourceLabel: snapshot.spendingPowerSource || "ACS-derived spending-power context",
    },
    reinvestment: signal.permitCount != null || signal.permitReportedCost != null
      ? {
          permitCount: signal.permitCount ?? null,
          reportedCost: signal.permitReportedCost ?? null,
          windowLabel: signal.permitWindowMonths
            ? `the trailing ${signal.permitWindowMonths} months`
            : null,
          sourceLabel: "City of Chicago Building Permits aggregate export",
        }
      : undefined,
    property: signal.parcelCount != null
      ? {
          parcelCount: signal.parcelCount,
          vacantParcelCount: signal.vacantParcelCount ?? null,
          commercialParcelCount: signal.commercialParcelCount ?? null,
          industrialParcelCount: signal.industrialParcelCount ?? null,
          sourceLabel: "Cook County Parcel Universe aggregate export",
        }
      : undefined,
    limitations: [
      "This neighborhood economic context is aggregated by ZIP for the current proof of concept.",
      "Business continuity is based on license records and should not be treated as a verified closure, relocation, or survival claim for any individual business.",
      "Jobs and payroll are ZIP-level Census Business Patterns signals, not project-specific employment or payroll.",
    ],
  };
}

export function mergeCorridorMetricIntoNeighborhoodEconomics(
  base: NeighborhoodEconomicContext | null,
  corridorMetric: NeighborhoodCorridorMetricInput | null
): NeighborhoodEconomicContext | null {
  if (!base && !corridorMetric) return null;

  const next: NeighborhoodEconomicContext = {
    ...(base ?? {}),
    limitations: [...(base?.limitations ?? [])],
  };

  if (!next.geographyLabel && corridorMetric?.corridorId) {
    next.geographyLabel =
      corridorMetric.corridorType === "zip" || /^\d{5}$/.test(corridorMetric.corridorId)
        ? `ZIP ${corridorMetric.corridorId}`
        : corridorMetric.corridorId;
  }

  const permits = corridorMetric?.details?.permits;
  const permitCount = permits?.permitCount ?? corridorMetric?.permitCount ?? null;
  if (permitCount != null || permits?.totalReportedCost != null) {
    next.reinvestment = {
      permitCount,
      reportedCost: permits?.totalReportedCost ?? null,
      windowLabel: corridorMetric?.details?.windowMonths
        ? `the trailing ${corridorMetric.details.windowMonths} months`
        : null,
      sourceLabel: "City of Chicago Building Permits / corridor metrics",
    };
  }

  const ownershipConcentration = corridorMetric?.details?.ownershipConcentration;
  const hasOwnershipSignal =
    ownershipConcentration?.distinctOwners != null ||
    corridorMetric?.localOwnershipShare != null;
  if (hasOwnershipSignal) {
    next.property = {
      distinctOwners: ownershipConcentration?.distinctOwners ?? null,
      localOwnershipShare: corridorMetric?.localOwnershipShare ?? null,
      sourceLabel: "Cook County parcel records / corridor metrics",
    };
  }

  if (corridorMetric && !next.limitations?.some((note) => note.includes("corridor metric"))) {
    next.limitations = [
      ...(next.limitations ?? []),
      "Permit and ownership context comes from aggregate corridor metrics and should be used for neighborhood interpretation, not property-level claims.",
    ];
  }

  return next;
}
