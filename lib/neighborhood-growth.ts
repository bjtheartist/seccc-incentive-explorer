import type { BusinessCohortRecord } from "./southeast-resilience";

export interface SpendingPowerInput {
  zip: string;
  population: number | null;
  households: number | null;
  medianHouseholdIncome: number | null;
  employedResidents: number | null;
}

export interface BusinessPatternInput {
  zip: string;
  year: number;
  establishments: number | null;
  employment: number | null;
  firstQuarterPayroll: number | null;
  annualPayroll: number | null;
}

export interface LicenseCategoryEstimate {
  category: string;
  estimatedFte: number;
  annualWageProxy: number;
  localMultiplier: number;
}

export interface ZipGrowthSignal {
  zip: string;
  baselineActiveBusinesses: number;
  comparisonActiveBusinesses: number;
  retainedBusinesses: number;
  leftOrClosedBusinesses: number;
  newBusinesses: number;
  businessNetGrowthRate: number | null;
  resilienceRate: number | null;
  estimatedFteBaseline: number;
  estimatedFteComparison: number;
  estimatedFteNetChange: number;
  estimatedPayrollBaseline: number;
  estimatedPayrollComparison: number;
  estimatedPayrollNetChange: number;
  averageWageProxyComparison: number | null;
  modeledLocalImpactComparison: number;
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
  employedResidents: number | null;
  residentSpendingPowerProxy: number | null;
  measurementNotes: string[];
}

export interface NeighborhoodGrowthResult {
  zips: ZipGrowthSignal[];
  aggregate: ZipGrowthSignal;
}

const DEFAULT_ESTIMATE: LicenseCategoryEstimate = {
  category: "general_business",
  estimatedFte: 2.5,
  annualWageProxy: 43000,
  localMultiplier: 1.35,
};

const CATEGORY_ESTIMATES: Array<{
  pattern: RegExp;
  estimate: LicenseCategoryEstimate;
}> = [
  {
    pattern: /RETAIL FOOD|RESTAURANT|FOOD/,
    estimate: { category: "food_and_restaurant", estimatedFte: 6, annualWageProxy: 36000, localMultiplier: 1.45 },
  },
  {
    pattern: /DAY CARE|CHILDREN|SCHOOL|EDUCATION/,
    estimate: { category: "education_childcare", estimatedFte: 8, annualWageProxy: 41000, localMultiplier: 1.5 },
  },
  {
    pattern: /MANUFACTUR|INDUSTRIAL|WHOLESALE|WAREHOUSE/,
    estimate: { category: "production_industrial", estimatedFte: 10, annualWageProxy: 58000, localMultiplier: 1.7 },
  },
  {
    pattern: /MEDICAL|HEALTH|PHARMACY|DENTAL|CLINIC/,
    estimate: { category: "health_services", estimatedFte: 7, annualWageProxy: 62000, localMultiplier: 1.65 },
  },
  {
    pattern: /CONSTRUCTION|CONTRACTOR|HOME REPAIR/,
    estimate: { category: "construction_trades", estimatedFte: 4, annualWageProxy: 56000, localMultiplier: 1.6 },
  },
  {
    pattern: /AUTO|MOTOR|REPAIR|GARAGE|FILLING STATION|TOBACCO/,
    estimate: { category: "auto_repair_retail", estimatedFte: 4, annualWageProxy: 42000, localMultiplier: 1.45 },
  },
  {
    pattern: /SALON|BARBER|BEAUTY|NAIL|COSMETOLOGY/,
    estimate: { category: "personal_services", estimatedFte: 3, annualWageProxy: 34000, localMultiplier: 1.35 },
  },
  {
    pattern: /PROFESSIONAL|REGULATED BUSINESS|LIMITED BUSINESS/,
    estimate: { category: "professional_general_services", estimatedFte: 2.5, annualWageProxy: 46000, localMultiplier: 1.35 },
  },
];

export function estimateLicenseCategory(descriptions: string[]): LicenseCategoryEstimate {
  const text = descriptions.join(" ").toUpperCase();
  const match = CATEGORY_ESTIMATES.find((item) => item.pattern.test(text));
  return match?.estimate ?? DEFAULT_ESTIMATE;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function computeZipSignal(
  zip: string,
  records: BusinessCohortRecord[],
  spendingPower: SpendingPowerInput | undefined,
  businessPatterns: BusinessPatternInput[] = []
): ZipGrowthSignal {
  const activeBaseline = records.filter((record) => record.activeInBaselineYear);
  const activeComparison = records.filter((record) => record.activeInComparisonYear);
  const retained = records.filter((record) => record.status === "retained");
  const left = records.filter((record) => record.status === "left_or_closed");
  const newer = records.filter((record) => record.status === "new_since_baseline");

  function model(recordsForYear: BusinessCohortRecord[]) {
    let fte = 0;
    let payroll = 0;
    let impact = 0;

    for (const record of recordsForYear) {
      const estimate = estimateLicenseCategory(record.licenseDescriptions);
      fte += estimate.estimatedFte;
      const recordPayroll = estimate.estimatedFte * estimate.annualWageProxy;
      payroll += recordPayroll;
      impact += recordPayroll * estimate.localMultiplier;
    }

    return { fte, payroll, impact };
  }

  const baselineModel = model(activeBaseline);
  const comparisonModel = model(activeComparison);
  const officialBaseline = businessPatterns.toSorted((a, b) => a.year - b.year)[0];
  const officialComparison = businessPatterns.toSorted((a, b) => b.year - a.year)[0];
  const residentSpendingPowerProxy =
    spendingPower?.households != null && spendingPower.medianHouseholdIncome != null
      ? spendingPower.households * spendingPower.medianHouseholdIncome
      : null;

  return {
    zip,
    baselineActiveBusinesses: activeBaseline.length,
    comparisonActiveBusinesses: activeComparison.length,
    retainedBusinesses: retained.length,
    leftOrClosedBusinesses: left.length,
    newBusinesses: newer.length,
    businessNetGrowthRate: safeRate(activeComparison.length - activeBaseline.length, activeBaseline.length),
    resilienceRate: safeRate(retained.length, activeBaseline.length),
    estimatedFteBaseline: round(baselineModel.fte),
    estimatedFteComparison: round(comparisonModel.fte),
    estimatedFteNetChange: round(comparisonModel.fte - baselineModel.fte),
    estimatedPayrollBaseline: roundCurrency(baselineModel.payroll),
    estimatedPayrollComparison: roundCurrency(comparisonModel.payroll),
    estimatedPayrollNetChange: roundCurrency(comparisonModel.payroll - baselineModel.payroll),
    averageWageProxyComparison:
      comparisonModel.fte === 0 ? null : roundCurrency(comparisonModel.payroll / comparisonModel.fte),
    modeledLocalImpactComparison: roundCurrency(comparisonModel.impact),
    officialBusinessPatternBaselineYear: officialBaseline?.year ?? null,
    officialBusinessPatternComparisonYear: officialComparison?.year ?? null,
    officialEstablishmentsBaseline: officialBaseline?.establishments ?? null,
    officialEstablishmentsComparison: officialComparison?.establishments ?? null,
    officialEmploymentBaseline: officialBaseline?.employment ?? null,
    officialEmploymentComparison: officialComparison?.employment ?? null,
    officialEmploymentGrowthRate:
      officialBaseline?.employment == null || officialComparison?.employment == null
        ? null
        : safeRate(officialComparison.employment - officialBaseline.employment, officialBaseline.employment),
    officialAnnualPayrollBaseline: officialBaseline?.annualPayroll ?? null,
    officialAnnualPayrollComparison: officialComparison?.annualPayroll ?? null,
    officialPayrollGrowthRate:
      officialBaseline?.annualPayroll == null || officialComparison?.annualPayroll == null
        ? null
        : safeRate(
            officialComparison.annualPayroll - officialBaseline.annualPayroll,
            officialBaseline.annualPayroll
          ),
    population: spendingPower?.population ?? null,
    households: spendingPower?.households ?? null,
    medianHouseholdIncome: spendingPower?.medianHouseholdIncome ?? null,
    employedResidents: spendingPower?.employedResidents ?? null,
    residentSpendingPowerProxy,
    measurementNotes: [
      "Business counts are measured from City of Chicago business-license records.",
      "FTE, payroll, wage quality, and multiplier values are modeled estimates by license category, not verified payroll.",
      "Official employment and payroll benchmarks use Census ZIP Business Patterns when available.",
      "Resident spending power uses ACS population and income data; household counts may be estimated when only tract data is available.",
    ],
  };
}

export function computeNeighborhoodGrowthSignals(
  records: BusinessCohortRecord[],
  spendingPowerInputs: SpendingPowerInput[],
  businessPatternInputs: BusinessPatternInput[] = []
): NeighborhoodGrowthResult {
  const spendingByZip = new Map(spendingPowerInputs.map((item) => [item.zip, item]));
  const patternsByZip = groupPatternsByZip(businessPatternInputs);
  const zips = Array.from(new Set(records.map((record) => record.zip).filter(Boolean) as string[])).sort();
  const zipSignals = zips.map((zip) =>
    computeZipSignal(
      zip,
      records.filter((record) => record.zip === zip),
      spendingByZip.get(zip),
      patternsByZip.get(zip) ?? []
    )
  );

  const aggregateSpending: SpendingPowerInput = {
    zip: "aggregate",
    population: sumNullable(zipSignals.map((signal) => signal.population)),
    households: sumNullable(zipSignals.map((signal) => signal.households)),
    medianHouseholdIncome: weightedMedianIncome(zipSignals),
    employedResidents: sumNullable(zipSignals.map((signal) => signal.employedResidents)),
  };

  return {
    zips: zipSignals,
    aggregate: computeZipSignal(
      "aggregate",
      records,
      aggregateSpending,
      aggregateBusinessPatterns(zipSignals)
    ),
  };
}

function groupPatternsByZip(inputs: BusinessPatternInput[]): Map<string, BusinessPatternInput[]> {
  const groups = new Map<string, BusinessPatternInput[]>();
  for (const input of inputs) {
    const existing = groups.get(input.zip);
    if (existing) existing.push(input);
    else groups.set(input.zip, [input]);
  }
  return groups;
}

function aggregateBusinessPatterns(signals: ZipGrowthSignal[]): BusinessPatternInput[] {
  const baselineYear = firstPresent(signals.map((signal) => signal.officialBusinessPatternBaselineYear));
  const comparisonYear = firstPresent(signals.map((signal) => signal.officialBusinessPatternComparisonYear));
  const out: BusinessPatternInput[] = [];

  if (baselineYear != null) {
    out.push({
      zip: "aggregate",
      year: baselineYear,
      establishments: sumNullable(signals.map((signal) => signal.officialEstablishmentsBaseline)),
      employment: sumNullable(signals.map((signal) => signal.officialEmploymentBaseline)),
      annualPayroll: sumNullable(signals.map((signal) => signal.officialAnnualPayrollBaseline)),
      firstQuarterPayroll: null,
    });
  }

  if (comparisonYear != null && comparisonYear !== baselineYear) {
    out.push({
      zip: "aggregate",
      year: comparisonYear,
      establishments: sumNullable(signals.map((signal) => signal.officialEstablishmentsComparison)),
      employment: sumNullable(signals.map((signal) => signal.officialEmploymentComparison)),
      annualPayroll: sumNullable(signals.map((signal) => signal.officialAnnualPayrollComparison)),
      firstQuarterPayroll: null,
    });
  }

  return out;
}

function firstPresent(values: Array<number | null>): number | null {
  return values.find((value): value is number => value != null) ?? null;
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function weightedMedianIncome(signals: ZipGrowthSignal[]): number | null {
  let weightedIncome = 0;
  let totalHouseholds = 0;
  for (const signal of signals) {
    if (signal.medianHouseholdIncome == null || signal.households == null) continue;
    weightedIncome += signal.medianHouseholdIncome * signal.households;
    totalHouseholds += signal.households;
  }
  return totalHouseholds === 0 ? null : Math.round(weightedIncome / totalHouseholds);
}
