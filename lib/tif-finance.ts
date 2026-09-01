import { socrataFetchResult } from "./socrata";

const TIF_ANNUAL_ANALYSIS_ENDPOINT =
  "https://data.cityofchicago.org/resource/qm7s-3ctt.json";

export const TIF_ANNUAL_ANALYSIS_SOURCE_URL =
  "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt";

export interface TifAnnualFinanceRow {
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

export interface TifFinanceContext {
  districtId: string;
  districtName: string;
  rawDistrictId?: string | null;
  reportYear?: number | null;
  expirationDate?: string | null;
  expirationYear?: number | null;
  boundaryWards?: string | null;
  fundBalance?: number | null;
  taxAllocationFundBalance?: number | null;
  propertyTaxIncrementCurrent?: number | null;
  cashExpenses?: number | null;
  totalExpenditure?: number | null;
  netIncome?: number | null;
  distributionOfSurplus?: number | null;
  amountDesignatedDebtObligations?: number | null;
  amountDesignatedProjectCosts?: number | null;
  surplusDeficit?: number | null;
  sourceLabel: string;
  sourceUrl: string;
  caution: string;
  /**
   * How this context came to be, so a renderer never presents an upstream
   * OUTAGE as an authoritative negative finding (R1 finding 4):
   *   - `matched`     — a real annual finance row was returned and mapped.
   *   - `no_row`      — the portal answered, and it holds no row for this
   *                     district. A genuine, publishable absence.
   *   - `unavailable` — the portal could not be reached (timeout, 5xx,
   *                     transport error). NOTHING is known about whether a
   *                     row exists, so the caution says exactly that.
   * Optional so existing persisted payloads keep validating; treat a missing
   * value as `matched` only when the finance figures are actually present.
   */
  dataAvailability?: TifFinanceAvailability;
}

export type TifFinanceAvailability = "matched" | "no_row" | "unavailable";

/**
 * The honest outage copy. It states what is not known; it never asserts an
 * absence, and it is deliberately not eligibility-shaped.
 */
export const TIF_FINANCE_UNAVAILABLE_CAUTION =
  "TIF finance data is temporarily unavailable for this district. The City data portal could not be reached, so no annual finance figures could be checked either way.";

/** The genuine-absence copy: the portal answered and held no matching row. */
export const TIF_FINANCE_NO_ROW_CAUTION =
  "This address is inside a TIF boundary, but no annual finance row was matched for this district.";

export function normalizeTifKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.match(/\d+/g)?.join("");
  if (!digits) return null;
  return `T-${digits.padStart(3, "0")}`;
}

export function parseTifNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed.replace(/[,$()]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function firstNumber(...values: Array<string | number | null | undefined>): number | null {
  for (const value of values) {
    const parsed = parseTifNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

export function mapTifAnnualFinanceRow(
  row: TifAnnualFinanceRow,
  boundary: {
    districtId: string;
    rawDistrictId?: string | null;
    districtName: string;
    expirationDate?: string | null;
    boundaryWards?: string | null;
  }
): TifFinanceContext {
  const expirationYear = boundary.expirationDate
    ? firstNumber(boundary.expirationDate.match(/\b(\d{4})\b/)?.[1])
    : null;

  return {
    districtId: normalizeTifKey(row.tif_number) ?? boundary.districtId,
    rawDistrictId: boundary.rawDistrictId ?? row.tif_number ?? null,
    districtName: row.tif_district || boundary.districtName,
    reportYear: firstNumber(row.report_year),
    expirationDate: boundary.expirationDate ?? null,
    expirationYear,
    boundaryWards: boundary.boundaryWards ?? null,
    fundBalance: parseTifNumber(row.fund_balance),
    taxAllocationFundBalance: parseTifNumber(row.tax_allocation_fund_balance),
    propertyTaxIncrementCurrent: parseTifNumber(row.property_tax_increment_current),
    cashExpenses: parseTifNumber(row.cash_expenses),
    totalExpenditure: parseTifNumber(row.total_expenditure),
    netIncome: parseTifNumber(row.net_income),
    distributionOfSurplus: parseTifNumber(row.distribution_of_surplus),
    amountDesignatedDebtObligations: parseTifNumber(row.amount_designated_debt_obligations),
    amountDesignatedProjectCosts: parseTifNumber(row.amount_designated_project_costs),
    surplusDeficit: parseTifNumber(row.surplus_deficit),
    sourceLabel: "City of Chicago TIF Annual Report - Analysis of Special Tax Allocation Fund",
    sourceUrl: TIF_ANNUAL_ANALYSIS_SOURCE_URL,
    caution:
      "District-level City annual report data. Not proof of funding availability, project approval, or funds reserved for this property or business.",
    dataAvailability: "matched",
  };
}

export async function fetchLatestTifFinanceContext(
  boundary: {
    districtId: string;
    rawDistrictId?: string | null;
    districtName: string;
    expirationDate?: string | null;
    boundaryWards?: string | null;
  }
): Promise<TifFinanceContext | null> {
  const tifKey = normalizeTifKey(boundary.districtId);
  if (!tifKey) return null;

  const url = new URL(TIF_ANNUAL_ANALYSIS_ENDPOINT);
  url.searchParams.set("$where", `tif_number='${tifKey}'`);
  url.searchParams.set("$order", "report_year DESC");
  url.searchParams.set("$limit", "1");

  const result = await socrataFetchResult<TifAnnualFinanceRow[]>(url.toString());

  // R1 finding 4 (honest outage rendering): a FETCH FAILURE is not evidence
  // that no finance row exists — it is evidence of nothing. Previously both
  // branches collapsed into the "no annual finance row was matched" caution,
  // which published an outage as an authoritative negative finding about the
  // district. The two cases are now reported separately.
  const rows = result.ok ? result.data : null;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) {
    const unavailable = !result.ok || !Array.isArray(rows);
    return {
      districtId: tifKey,
      rawDistrictId: boundary.rawDistrictId ?? boundary.districtId,
      districtName: boundary.districtName,
      expirationDate: boundary.expirationDate ?? null,
      expirationYear: boundary.expirationDate
        ? firstNumber(boundary.expirationDate.match(/\b(\d{4})\b/)?.[1])
        : null,
      boundaryWards: boundary.boundaryWards ?? null,
      sourceLabel: "City of Chicago TIF Annual Report - Analysis of Special Tax Allocation Fund",
      sourceUrl: TIF_ANNUAL_ANALYSIS_SOURCE_URL,
      caution: unavailable ? TIF_FINANCE_UNAVAILABLE_CAUTION : TIF_FINANCE_NO_ROW_CAUTION,
      dataAvailability: unavailable ? "unavailable" : "no_row",
    };
  }

  return mapTifAnnualFinanceRow(row, {
    ...boundary,
    districtId: tifKey,
  });
}
