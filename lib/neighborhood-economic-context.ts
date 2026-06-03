import type { NeighborhoodEconomicContext } from "./report-engine";
import type { LiveZipAcsContext } from "./census-acs";
import {
  modelNeighborhoodLeakage,
  modelLocalMultiplier,
  rankCommunityAnchors,
  type CommunityAnchor,
} from "./neighborhood-economic-models";

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
  assessedValueBaseline?: number | null;
  assessedValueComparison?: number | null;
  assessedValueChangeRate?: number | null;
  assessedValueYearBaseline?: number | null;
  assessedValueYearComparison?: number | null;
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

// Chicago ZIP coverage for neighborhood economic context. Most Chicago ZIPs are
// 606xx, but the citywide artifact (Milestone 3: "606xx, 60707, and 60827")
// also covers two non-606 Chicago ZIPs: 60707 (Galewood/Elmwood Park edge) and
// 60827 (Riverdale). Suburban ZIPs like 60201 (Evanston) are intentionally
// excluded. Keep this in sync with neighborhood_economics_by_zip.json coverage.
const NON_606_CHICAGO_ZIPS = new Set(["60707", "60827"]);

function isCoveredChicagoZip(zip: string): boolean {
  return /^606\d{2}$/.test(zip) || NON_606_CHICAGO_ZIPS.has(zip);
}

export function extractChicagoZipCode(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    for (const candidate of value.matchAll(/\b(\d{5})\b/g)) {
      if (isCoveredChicagoZip(candidate[1])) return candidate[1];
    }
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
    property: signal.parcelCount != null || signal.assessedValueComparison != null
      ? {
          parcelCount: signal.parcelCount ?? null,
          vacantParcelCount: signal.vacantParcelCount ?? null,
          commercialParcelCount: signal.commercialParcelCount ?? null,
          industrialParcelCount: signal.industrialParcelCount ?? null,
          assessedValueBaseline: signal.assessedValueBaseline ?? null,
          assessedValueComparison: signal.assessedValueComparison ?? null,
          assessedValueChangeRate: signal.assessedValueChangeRate ?? null,
          assessedValueYearBaseline: signal.assessedValueYearBaseline ?? null,
          assessedValueYearComparison: signal.assessedValueYearComparison ?? null,
          sourceLabel:
            signal.assessedValueComparison != null
              ? "Cook County Assessor certified values + Parcel Universe aggregate export"
              : "Cook County Parcel Universe aggregate export",
        }
      : undefined,
    leakage: (() => {
      const result = modelNeighborhoodLeakage({
        residentSpendingPowerProxy: signal.residentSpendingPowerProxy,
        localAnnualPayroll: signal.officialAnnualPayrollComparison,
      });
      return result
        ? {
            estimatedLeakageRate: result.estimatedLeakageRate,
            capturableDemand: result.capturableDemand,
            localCapacity: result.localCapacity,
            assumptions: result.assumptions,
            sourceLabel: "Modeled from ACS spending power and ZBP payroll",
          }
        : undefined;
    })(),
    multiplier: (() => {
      const result = modelLocalMultiplier({
        localAnnualPayroll: signal.officialAnnualPayrollComparison,
        localEmployment: signal.officialEmploymentComparison,
      });
      return result
        ? {
            localOutputEstimateLow: result.localOutputEstimateLow,
            localOutputEstimateHigh: result.localOutputEstimateHigh,
            multiplierLow: result.multiplierLow,
            multiplierHigh: result.multiplierHigh,
            assumptions: result.assumptions,
            sourceLabel: "Scenario model on ZBP payroll",
          }
        : undefined;
    })(),
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

export function mergeLiveAcsIntoNeighborhoodEconomics(
  base: NeighborhoodEconomicContext | null,
  zip: string,
  liveAcs: LiveZipAcsContext | null
): NeighborhoodEconomicContext | null {
  if (!base && !liveAcs) return null;

  const next: NeighborhoodEconomicContext = {
    ...(base ?? { geographyLabel: `ZIP ${zip}` }),
    limitations: [...(base?.limitations ?? [])],
  };

  if (liveAcs) {
    next.spendingPower = {
      residentSpendingPowerProxy: liveAcs.residentSpendingPowerProxy,
      medianHouseholdIncome: liveAcs.medianHouseholdIncome,
      population: liveAcs.population,
      sourceLabel: liveAcs.sourceLabel,
    };

    if (!next.limitations?.some((note) => note.includes("live Census ACS"))) {
      next.limitations = [
        ...(next.limitations ?? []),
        "Resident spending-power context is refreshed from live Census ACS ZIP/ZCTA data when available; it remains a purchasing-capacity proxy, not observed local sales.",
      ];
    }
  }

  return next;
}

/**
 * Merge curated, community-area-keyed anchor businesses into the report context.
 * These are human-curated, source-cited public records (employers, institutions,
 * corridors) ranked by the workbook's 6-dimension impact score — never
 * model-generated. Surfaces the top anchors as multiplier drivers. If no curated
 * anchors exist for the area, the context is returned unchanged.
 */
export function mergeCommunityAnchorsIntoNeighborhoodEconomics(
  base: NeighborhoodEconomicContext | null,
  anchors: CommunityAnchor[] | null | undefined,
  communityAreaLabel?: string | null,
  limit = 5
): NeighborhoodEconomicContext | null {
  if (!anchors || anchors.length === 0) return base ?? null;

  const ranked = rankCommunityAnchors(anchors, limit);
  if (ranked.length === 0) return base ?? null;

  // Anchors are community-area-keyed and may exist even when the ZIP economic
  // artifact does not cover this address — start from a minimal context so the
  // anchors still surface.
  const next: NeighborhoodEconomicContext = base
    ? { ...base, limitations: [...(base.limitations ?? [])] }
    : { geographyLabel: communityAreaLabel || undefined, limitations: [] };

  next.anchors = ranked.map((a) => ({
    name: a.name,
    type: a.type,
    category: a.category,
    totalScore: a.totalScore,
    impactTier: a.impactTier,
    confidence: a.confidence,
    multiplierChannels: a.multiplierChannels,
    rationale: a.rationale,
    validationNeeded: a.validationNeeded,
    leakageCaveat: a.leakageCaveat,
    sourceUrls: a.sourceUrls,
  }));
  if (communityAreaLabel) next.anchorGeography = communityAreaLabel;

  if (next.multiplier) {
    next.multiplier = {
      ...next.multiplier,
      anchorDrivers: ranked.map((a) => a.name),
    };
  }

  if (!next.limitations?.some((note) => note.includes("anchor"))) {
    next.limitations = [
      ...(next.limitations ?? []),
      "Anchor businesses are curated, source-cited public records scored on a 6-dimension local-impact screen; scores are a diligence tool, not a formal input-output model or verified headcounts.",
    ];
  }

  return next;
}
