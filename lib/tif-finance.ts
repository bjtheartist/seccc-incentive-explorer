import { socrataFetch } from "./socrata";

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
}

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

  const rows = await socrataFetch<TifAnnualFinanceRow[]>(url.toString());
  const row = rows?.[0];
  if (!row) {
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
      caution:
        "This address is inside a TIF boundary, but no annual finance row was matched for this district.",
    };
  }

  return mapTifAnnualFinanceRow(row, {
    ...boundary,
    districtId: tifKey,
  });
}
