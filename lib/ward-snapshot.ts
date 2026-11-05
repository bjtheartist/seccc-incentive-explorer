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

export const NEED_INDEX_METHOD =
  "The Need index averages each ward’s position on three measures: more vacant lots, a lower property tax base, and higher youth poverty all count toward need. Each measure is weighted equally. TIF spending is left out because it is public spending, not a sign of need. The index ranks wards against each other; it is not a score of any kind of eligibility.";

/**
 * Combined need ranking. Each component contributes a 0–1 position (1 = the
 * neediest ward on that measure); the index is their mean. Wards missing any
 * component are left unranked.
 */
export function needIndex(wards: readonly WardSnapshotWard[]): Map<number, WardRanking & { score: number }> {
  const components: { key: WardMetricKey; needWhenHigh: boolean }[] = [
    { key: "vacantLots", needWhenHigh: true },
    { key: "avPerResident", needWhenHigh: false },
    { key: "youthPovertyRate", needWhenHigh: true },
  ];
  const ranked = components.map((c) => ({ ...c, ranks: rankWards(wards, c.key) }));
  const scored: { ward: number; score: number }[] = [];
  for (const w of wards) {
    const parts = ranked.map(({ ranks, needWhenHigh }) => {
      const r = ranks.get(w.ward);
      if (!r) return null;
      const highness = r.of > 1 ? 1 - (r.rank - 1) / (r.of - 1) : 1;
      return needWhenHigh ? highness : 1 - highness;
    });
    if (parts.some((p) => p == null)) continue;
    const score = (parts as number[]).reduce((s, p) => s + p, 0) / parts.length;
    scored.push({ ward: w.ward, score: Math.round(score * 1000) / 1000 });
  }
  const ranks = rankValues(scored.map((s) => ({ ward: s.ward, value: s.score })));
  return new Map(scored.map((s) => [s.ward, { ...ranks.get(s.ward)!, score: s.score }]));
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
  return rankValues(wards.map((w) => ({ ward: w.ward, value: w.values[key] })));
}

function rankValues(entries: readonly { ward: number; value: number | null }[]): Map<number, WardRanking> {
  const valued = entries
    .filter((e): e is { ward: number; value: number } => e.value != null)
    .sort((a, b) => b.value - a.value);
  const of = valued.length;
  const out = new Map<number, WardRanking>();
  valued.forEach((e, i) => {
    const prev = i > 0 ? valued[i - 1] : null;
    const rank = prev && prev.value === e.value ? out.get(prev.ward)!.rank : i + 1;
    const tier = WARD_TIERS[Math.min(4, Math.floor(((rank - 1) / of) * 5))];
    out.set(e.ward, { rank, of, tier });
  });
  return out;
}

// ── Filtering ─────────────────────────────────────────────────────────────

export type WardRankKey = WardMetricKey | "needIndex";

/** "top" = Very High or High; "bottom" = Low or Very Low. */
export type WardTierFilter = "any" | "top" | "bottom" | WardTier;

export interface WardFilters {
  query: string;
  tiers: Partial<Record<WardRankKey, WardTierFilter>>;
}

export const EMPTY_WARD_FILTERS: WardFilters = { query: "", tiers: {} };

/** Quick views that reproduce the high-need / high-wealth split. */
export const WARD_FILTER_PRESETS: readonly { id: string; label: string; description: string; filters: WardFilters }[] = [
  {
    id: "high-need",
    label: "High-need wards",
    description: "Youth poverty High or Very High and property tax base Low or Very Low",
    filters: { query: "", tiers: { youthPovertyRate: "top", avPerResident: "bottom" } },
  },
  {
    id: "high-wealth",
    label: "High-wealth wards",
    description: "Property tax base High or Very High and youth poverty Low or Very Low",
    filters: { query: "", tiers: { avPerResident: "top", youthPovertyRate: "bottom" } },
  },
];

export function tierMatches(tier: WardTier | undefined, filter: WardTierFilter | undefined): boolean {
  if (!filter || filter === "any") return true;
  if (!tier) return false;
  if (filter === "top") return tier === "Very High" || tier === "High";
  if (filter === "bottom") return tier === "Low" || tier === "Very Low";
  return tier === filter;
}

export function filterWards(
  wards: readonly WardSnapshotWard[],
  rankings: Record<WardRankKey, Map<number, WardRanking>>,
  filters: WardFilters,
): WardSnapshotWard[] {
  const q = filters.query.trim().toLowerCase();
  return wards.filter((w) => {
    if (q) {
      const byNumber = /^\d+$/.test(q) && String(w.ward) === q;
      const byName = w.areas.some((a) => a.toLowerCase().includes(q));
      if (!byNumber && !byName) return false;
    }
    return (Object.entries(filters.tiers) as [WardRankKey, WardTierFilter][]).every(([key, f]) =>
      tierMatches(rankings[key].get(w.ward)?.tier, f),
    );
  });
}
