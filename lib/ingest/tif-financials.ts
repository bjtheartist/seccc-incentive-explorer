import { socrataHeaders } from "@/lib/socrata";
import { normalizeTifKey, parseTifNumber } from "@/lib/tif-finance";
import type { FetchOpts, Provenance, SourceAdapter, SQL } from "./types";

/**
 * TIF Financials adapter — City of Chicago.
 *
 * Pulls from two Socrata datasets on data.cityofchicago.org:
 *
 *   qm7s-3ctt  TIF Annual Report Analysis of Special Tax Allocation Fund
 *              Revenue, expenditures, fund balance per district per year.
 *              Fields: tif_number, tif_district, report_year, fund_balance, …
 *              https://data.cityofchicago.org/resource/qm7s-3ctt.json
 *
 *   fpsv-qjg3  TIF Projections / Expiration
 *              One row per line-item per district. Carries year_tif_ends
 *              (the expiration year as a string) and annual projected values
 *              in columns _2025 through _2034. District key: tif_district_id.
 *              https://data.cityofchicago.org/resource/fpsv-qjg3.json
 *
 * Dataset field names verified against live endpoints 2026-07-02.
 *
 * Strategy:
 *   1. Fetch all qm7s-3ctt rows (city-wide, not ZIP-filterable).
 *   2. Fetch all fpsv-qjg3 rows.
 *   3. Group qm7s-3ctt rows by tif_number; pick latest report year per district.
 *   4. Group fpsv-qjg3 rows by tif_district_id; extract year_tif_ends and sum
 *      projected year columns across all line items to approximate total
 *      net projected position per year.
 *   5. Join on normalized TIF key (T-NNN) and emit one TifFinancialsRow per
 *      district. Districts only in fpsv-qjg3 (no qm7s-3ctt history) are
 *      included — expiration year is always worth surfacing.
 *
 * FetchOpts.zips is accepted but ignored — TIF data is city-wide.
 */

const SOURCE_KEY = "tif_financials";

const TIF_ANNUAL_URL =
  "https://data.cityofchicago.org/resource/qm7s-3ctt.json";

const TIF_PROJECTION_URL =
  "https://data.cityofchicago.org/resource/fpsv-qjg3.json";

/** Projected year columns present in fpsv-qjg3. */
const PROJECTION_YEAR_COLS = [
  "_2025", "_2026", "_2027", "_2028", "_2029",
  "_2030", "_2031", "_2032", "_2033", "_2034",
] as const;

// ── Raw upstream types ────────────────────────────────────────────────────────

/** Raw row from qm7s-3ctt (annual analysis). */
export interface RawTifAnnualRow {
  tif_number?: string;
  tif_district?: string;
  report_year?: string;
  tax_allocation_fund_balance?: string;
  property_tax_increment_current?: string;
  cash_expenses?: string;
  total_expenditure?: string;
  net_income?: string;
  fund_balance?: string;
  distribution_of_surplus?: string;
  amount_designated_debt_obligations?: string;
  amount_designated_project_costs?: string;
  surplus_deficit?: string;
}

/**
 * Raw row from fpsv-qjg3 (projections/expirations).
 * One row per line-item per district. Each row carries year_tif_ends and
 * year columns _2025 through _2034 with the line-item's projected value.
 */
export interface RawTifProjectionRow {
  tif_district_id?: string;
  tif_district_name?: string;
  year_tif_ends?: string;
  category_description?: string;
  line_item_description?: string;
  fund_and_project_balances?: string;
  _2025?: string;
  _2026?: string;
  _2027?: string;
  _2028?: string;
  _2029?: string;
  _2030?: string;
  _2031?: string;
  _2032?: string;
  _2033?: string;
  _2034?: string;
  through_end_date?: string;
}

// ── Normalized output row ─────────────────────────────────────────────────────

/**
 * One summary row per TIF district. Carries the most-recent annual data plus
 * expiration/projection metadata from fpsv-qjg3.
 */
export interface TifFinancialsRow {
  /** Canonical key e.g. "T-087". */
  tifNumber: string;
  /** Human name e.g. "Fullerton/Milwaukee". */
  tifName: string | null;
  /** Most recent report year in qm7s-3ctt. */
  latestReportYear: number | null;
  /** Fund balance as of latest report year (from fund_balance field). */
  latestFundBalance: number | null;
  /** Tax allocation fund balance (may differ from fund_balance). */
  latestTaxAllocationFundBalance: number | null;
  /** Property tax increment (revenue) for the latest year. */
  latestPropertyTaxIncrement: number | null;
  /** Total expenditure for the latest year. */
  latestTotalExpenditure: number | null;
  /** Surplus or deficit for the latest year. */
  latestSurplusDeficit: number | null;
  /** Amount designated for project costs (latest year). */
  latestAmountDesignatedProjectCosts: number | null;
  /**
   * ISO date string YYYY-12-31 derived from year_tif_ends in fpsv-qjg3.
   * TIFs expire at the end of the named year (Dec 31) per Chicago convention.
   * Null when fpsv-qjg3 has no data for this district.
   */
  expirationDate: string | null;
  /** Calendar year parsed from year_tif_ends. */
  expirationYear: number | null;
  /**
   * true when the district expires within 24 months of the export date.
   * Set at normalize() time using new Date() as the reference.
   */
  expiresWithin24Months: boolean;
  /**
   * Summed projected net values by year from fpsv-qjg3, keyed by year string.
   * e.g. { "2026": 5000000, "2027": 3200000 }
   * Null when fpsv-qjg3 has no rows for the district.
   */
  projectedBalances: Record<string, number> | null;
  provenance: Provenance;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: string | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** Determine whether a TIF expiration is within 24 months of a reference date. */
export function expiresSoon(
  expirationDate: string | null,
  referenceDate: Date
): boolean {
  if (!expirationDate) return false;
  const expiry = new Date(expirationDate + "T00:00:00Z");
  if (isNaN(expiry.getTime())) return false;
  const cutoff = new Date(referenceDate);
  cutoff.setMonth(cutoff.getMonth() + 24);
  return expiry <= cutoff;
}

// ── Internal aggregate type used during fetch ─────────────────────────────────

interface TifProjectionAggregate {
  /** Normalized TIF key (T-NNN). */
  tifKey: string;
  tifName: string | null;
  /** The year the TIF ends per fpsv-qjg3. */
  yearTifEnds: number | null;
  /** Sum of each year column across all line-item rows. */
  yearSums: Record<string, number>;
  /** Raw rows for provenance. */
  rawRows: RawTifProjectionRow[];
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchAllPages<T>(
  baseUrl: string,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${baseUrl}?$limit=${pageSize}&$offset=${offset}&$order=:id`;
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) break;
    const page: T[] = await res.json();
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/**
 * Aggregate fpsv-qjg3 line-item rows into one summary per district.
 * Sums the projected year columns across all rows to get an approximate
 * net projection per year (Revenue - Expenses + Fund Balance movement).
 */
function aggregateProjectionRows(
  rows: RawTifProjectionRow[]
): Map<string, TifProjectionAggregate> {
  const byKey = new Map<string, TifProjectionAggregate>();

  for (const row of rows) {
    const rawKey = row.tif_district_id;
    const key = normalizeTifKey(rawKey);
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, {
        tifKey: key,
        tifName: str(row.tif_district_name),
        yearTifEnds: parseTifNumber(row.year_tif_ends),
        yearSums: {},
        rawRows: [],
      });
    }

    const agg = byKey.get(key)!;

    // Update name and year if currently null (first row wins for non-nulls).
    if (!agg.tifName) agg.tifName = str(row.tif_district_name);
    if (agg.yearTifEnds == null) agg.yearTifEnds = parseTifNumber(row.year_tif_ends);

    // Sum projected year columns.
    for (const col of PROJECTION_YEAR_COLS) {
      const val = parseTifNumber(row[col]);
      if (val != null) {
        const yearKey = col.replace("_", ""); // "_2025" → "2025"
        agg.yearSums[yearKey] = (agg.yearSums[yearKey] ?? 0) + val;
      }
    }

    agg.rawRows.push(row);
  }

  return byKey;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Combined raw input passed to normalize().
 * We pre-join the two datasets before calling normalize() so the adapter
 * contract receives one flat input per output row.
 */
export interface RawTifFinancialsInput {
  /** All annual rows for this district from qm7s-3ctt (may be empty). */
  annualRows: RawTifAnnualRow[];
  /** Aggregated projection data for this district (may be null). */
  projectionAggregate: TifProjectionAggregate | null;
  /** Canonical TIF number key (e.g. "T-087"). */
  tifNumber: string;
}

export const tifFinancialsAdapter: SourceAdapter<
  RawTifFinancialsInput,
  TifFinancialsRow
> = {
  sourceKey: SOURCE_KEY,
  targetTable: "tif_financials",

  /**
   * Fetch all rows from both datasets, aggregate projections per district,
   * and emit one RawTifFinancialsInput per district (union of both datasets).
   *
   * FetchOpts.zips is unused — TIF data is city-wide.
   */
  async fetch(_opts: FetchOpts): Promise<RawTifFinancialsInput[]> {
    const [annualRaw, projectionRaw] = await Promise.all([
      fetchAllPages<RawTifAnnualRow>(TIF_ANNUAL_URL),
      fetchAllPages<RawTifProjectionRow>(TIF_PROJECTION_URL),
    ]);

    // Group annual rows by normalized TIF number.
    const annualByKey = new Map<string, RawTifAnnualRow[]>();
    for (const row of annualRaw) {
      const key = normalizeTifKey(row.tif_number);
      if (!key) continue;
      if (!annualByKey.has(key)) annualByKey.set(key, []);
      annualByKey.get(key)!.push(row);
    }

    // Aggregate projection rows by district.
    const projectionByKey = aggregateProjectionRows(projectionRaw);

    // Union of all TIF numbers seen in either dataset.
    const allKeys = new Set([
      ...annualByKey.keys(),
      ...projectionByKey.keys(),
    ]);

    return Array.from(allKeys).map((tifNumber) => ({
      tifNumber,
      annualRows: annualByKey.get(tifNumber) ?? [],
      projectionAggregate: projectionByKey.get(tifNumber) ?? null,
    }));
  },

  normalize(raw: RawTifFinancialsInput): TifFinancialsRow | null {
    const { tifNumber, annualRows, projectionAggregate } = raw;
    if (!tifNumber) return null;

    // Pick the latest annual row by report_year.
    const latestAnnual =
      annualRows.length > 0
        ? annualRows.reduce((best, r) => {
            const yr = parseTifNumber(r.report_year) ?? 0;
            const bestYr = parseTifNumber(best.report_year) ?? 0;
            return yr > bestYr ? r : best;
          })
        : null;

    // Resolve district name: prefer projection aggregate (tif_district_name is
    // typically cleaner), fall back to annual row's tif_district.
    const tifName =
      (projectionAggregate?.tifName ?? null) ??
      str(latestAnnual?.tif_district) ??
      null;

    // Expiration: TIFs in Chicago expire Dec 31 of year_tif_ends.
    const expirationYear = projectionAggregate?.yearTifEnds ?? null;
    const expirationDate =
      expirationYear != null ? `${expirationYear}-12-31` : null;

    const expiresWithin24Months = expiresSoon(expirationDate, new Date());

    // Projected balances: non-zero years only from the aggregate year sums.
    let projectedBalances: Record<string, number> | null = null;
    if (projectionAggregate && Object.keys(projectionAggregate.yearSums).length > 0) {
      const nonZero = Object.fromEntries(
        Object.entries(projectionAggregate.yearSums).filter(([, v]) => v !== 0)
      );
      if (Object.keys(nonZero).length > 0) projectedBalances = nonZero;
    }

    return {
      tifNumber,
      tifName,
      latestReportYear: latestAnnual
        ? parseTifNumber(latestAnnual.report_year)
        : null,
      latestFundBalance: latestAnnual
        ? parseTifNumber(latestAnnual.fund_balance)
        : null,
      latestTaxAllocationFundBalance: latestAnnual
        ? parseTifNumber(latestAnnual.tax_allocation_fund_balance)
        : null,
      latestPropertyTaxIncrement: latestAnnual
        ? parseTifNumber(latestAnnual.property_tax_increment_current)
        : null,
      latestTotalExpenditure: latestAnnual
        ? parseTifNumber(latestAnnual.total_expenditure)
        : null,
      latestSurplusDeficit: latestAnnual
        ? parseTifNumber(latestAnnual.surplus_deficit)
        : null,
      latestAmountDesignatedProjectCosts: latestAnnual
        ? parseTifNumber(latestAnnual.amount_designated_project_costs)
        : null,
      expirationDate,
      expirationYear,
      expiresWithin24Months,
      projectedBalances,
      provenance: {
        source: SOURCE_KEY,
        raw_json: {
          annualRows,
          projectionRows: projectionAggregate?.rawRows ?? [],
        },
      },
    };
  },

  async upsert(sql: SQL, rows: TifFinancialsRow[]): Promise<number> {
    let written = 0;
    for (const r of rows) {
      await sql`
        INSERT INTO tif_financials (
          tif_number,
          tif_name,
          latest_report_year,
          latest_fund_balance,
          latest_tax_allocation_fund_balance,
          latest_property_tax_increment,
          latest_total_expenditure,
          latest_surplus_deficit,
          latest_amount_designated_project_costs,
          expiration_date,
          expiration_year,
          expires_within_24_months,
          projected_balances,
          source,
          fetched_at,
          raw_json
        )
        VALUES (
          ${r.tifNumber},
          ${r.tifName},
          ${r.latestReportYear},
          ${r.latestFundBalance},
          ${r.latestTaxAllocationFundBalance},
          ${r.latestPropertyTaxIncrement},
          ${r.latestTotalExpenditure},
          ${r.latestSurplusDeficit},
          ${r.latestAmountDesignatedProjectCosts},
          ${r.expirationDate},
          ${r.expirationYear},
          ${r.expiresWithin24Months},
          ${r.projectedBalances != null ? JSON.stringify(r.projectedBalances) : null},
          ${r.provenance.source},
          NOW(),
          ${JSON.stringify(r.provenance.raw_json)}
        )
        ON CONFLICT (tif_number) DO UPDATE SET
          tif_name                               = EXCLUDED.tif_name,
          latest_report_year                     = EXCLUDED.latest_report_year,
          latest_fund_balance                    = EXCLUDED.latest_fund_balance,
          latest_tax_allocation_fund_balance     = EXCLUDED.latest_tax_allocation_fund_balance,
          latest_property_tax_increment          = EXCLUDED.latest_property_tax_increment,
          latest_total_expenditure               = EXCLUDED.latest_total_expenditure,
          latest_surplus_deficit                 = EXCLUDED.latest_surplus_deficit,
          latest_amount_designated_project_costs = EXCLUDED.latest_amount_designated_project_costs,
          expiration_date                        = EXCLUDED.expiration_date,
          expiration_year                        = EXCLUDED.expiration_year,
          expires_within_24_months               = EXCLUDED.expires_within_24_months,
          projected_balances                     = EXCLUDED.projected_balances,
          source                                 = EXCLUDED.source,
          fetched_at                             = NOW(),
          raw_json                               = EXCLUDED.raw_json
      `;
      written++;
    }
    return written;
  },
};
