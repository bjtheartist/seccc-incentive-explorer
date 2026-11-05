/**
 * lib/ward-snapshot.ts — Ward Snapshot data contract + ranking method.
 *
 * public/data/ward-snapshot.json (built by scripts/build-ward-snapshot.ts)
 * stores raw values only. Ranks and tiers are derived here so the method is
 * one reviewable function: the 50 wards are ranked highest-to-lowest on each
 * measure and split into five equal groups of 10 ("Very High" … "Very Low").
 * A tier is relative to the other 49 wards, never an absolute threshold.
 */

export type WardMetricKey = "vacantLots" | "avPerResident" | "youthPovertyRate" | "tifSpending";

export interface WardSnapshotWard {
  ward: number;
  /** Community areas holding most of the ward's homes, largest first. */
  areas: string[];
  population: number;
  values: Record<WardMetricKey, number | null>;
  detail: {
    vacantPrivate: number;
    vacantCityOwned: number;
    assessedValue: number;
    youthInPoverty: number;
    youthPopulation: number;
  };
}

export interface WardSnapshotFile {
  generatedAt: string;
  wardMap: string;
  vintages: { parcels: string; assessedValues: string; acs: string; tifReportYear: string };
  coverage: {
    parcels: number;
    parcelsWithAssessedValue: number;
    tractsAllocated: number;
    cityOwnedUnplaced: number;
    tifExpenditureTotal: number;
    tifExpenditureAllocated: number;
    tifDistrictsUnallocated: string[];
    /** Transit TIF spending left out of the ward measure (CTA rail construction). */
    tifTransitExcluded: number;
    tifTransitDistricts: string[];
    clerkTifAgenciesUnmatched: string[];
  };
  wards: WardSnapshotWard[];
}

export interface WardMetricDefinition {
  key: WardMetricKey;
  label: string;
  /** What the number is, in one line, shown under the column header. */
  unitLabel: (file: WardSnapshotFile) => string;
  format: (value: number) => string;
  source: string;
  sourceUrl: string;
  method: string;
}

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : `$${Math.round(n).toLocaleString("en-US")}`;

export const WARD_METRICS: readonly WardMetricDefinition[] = [
  {
    key: "vacantLots",
    label: "Vacant Lots",
    unitLabel: (f) => `Parcels, ${f.vintages.parcels}`,
    format: (n) => Math.round(n).toLocaleString("en-US"),
    source: "Cook County Assessor parcel universe; City of Chicago City-Owned Land Inventory",
    sourceUrl: "https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Parcel-Universe/nj4t-kc8j",
    method:
      "Privately held vacant land (Assessor class 1-00) plus parcels the City lists as “Owned by City” in its land inventory, counted once per PIN. City-owned lots are tax-exempt and do not appear as class 1-00, so both sources are needed.",
  },
  {
    key: "avPerResident",
    label: "Property Tax Base",
    unitLabel: (f) => `Assessed value per resident, ${f.vintages.assessedValues}`,
    format: usd,
    source: "Cook County Assessor assessed values",
    sourceUrl: "https://datacatalog.cookcountyil.gov/Property-Taxation/Assessor-Assessed-Values/uzyt-m557",
    method:
      "Total assessed value of every parcel in the ward (Board of Review value, else Assessor certified, else first-pass mailed) divided by ward residents. Assessed value is before the state equalizer and exemptions, so it ranks the base fairly but is not a tax bill.",
  },
  {
    key: "youthPovertyRate",
    label: "Youth Poverty",
    unitLabel: (f) => `Share of under-18s below poverty, ACS ${f.vintages.acs}`,
    format: (n) => `${n.toFixed(1)}%`,
    source: "U.S. Census Bureau, American Community Survey 5-year (table S1701)",
    sourceUrl: "https://data.census.gov/table/ACSST5Y2024.S1701",
    method:
      "Census tracts do not follow ward lines, so each tract’s children are split across wards in proportion to where its homes are (Assessor residential parcels). ACS figures are survey estimates with margins of error.",
  },
  {
    key: "tifSpending",
    label: "TIF Spending",
    unitLabel: (f) => `Total expenditures, ${f.vintages.tifReportYear} TIF reports`,
    format: usd,
    source: "City of Chicago TIF Annual Report Analysis",
    sourceUrl: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
    method:
      "Each TIF district’s reported total expenditures for the year, split across the wards it covers by each ward’s share of the district’s assessed value. Spending is booked where the district is, which is not always where the money is ultimately spent. Transit TIFs, which fund CTA rail construction, are left out.",
  },
];

export type WardTier = "Very High" | "High" | "Moderate" | "Low" | "Very Low";
export const WARD_TIERS: readonly WardTier[] = ["Very High", "High", "Moderate", "Low", "Very Low"];

export interface WardRanking {
  /** 1 = highest value of the wards that have one. */
  rank: number;
  of: number;
  tier: WardTier;
}

/**
 * Ranks every ward with a value on one measure, highest first, and assigns a
 * quintile tier. Ties share the better rank. Wards with a null value are
 * absent from the map (no rank, no tier) rather than ranked last.
 */
export function rankWards(
  wards: readonly WardSnapshotWard[],
  key: WardMetricKey,
): Map<number, WardRanking> {
  const valued = wards
    .filter((w) => w.values[key] != null)
    .sort((a, b) => (b.values[key] as number) - (a.values[key] as number));
  const of = valued.length;
  const out = new Map<number, WardRanking>();
  valued.forEach((w, i) => {
    const prev = i > 0 ? valued[i - 1] : null;
    const rank = prev && prev.values[key] === w.values[key] ? out.get(prev.ward)!.rank : i + 1;
    const tier = WARD_TIERS[Math.min(4, Math.floor(((rank - 1) / of) * 5))];
    out.set(w.ward, { rank, of, tier });
  });
  return out;
}
