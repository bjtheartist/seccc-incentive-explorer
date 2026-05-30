export interface TifDistrictMatch {
  tifNumber: string;
  districtName: string;
  wards?: string | null;
  expirationDate?: string | null;
}

export interface TifAnnualReportRow {
  tif_number?: string;
  tif_district?: string;
  report_year?: string;
  property_tax_increment_current?: string;
  total_expenditure?: string;
  fund_balance?: string;
  amount_designated_debt_obligations?: string;
  amount_designated_project_costs?: string;
  surplus_deficit?: string;
}

export interface TifFinancialContext {
  districtName: string;
  tifNumber: string;
  reportYear: number | null;
  wards?: string | null;
  expirationDate?: string | null;
  fundBalance: number | null;
  currentYearIncrement: number | null;
  annualExpenditures: number | null;
  designatedDebtObligations: number | null;
  designatedProjectCosts: number | null;
  surplusDeficit: number | null;
  sourceUrl: string;
  sourceLabel: string;
  caution: string;
}

export const TIF_ANNUAL_REPORT_SOURCE_URL =
  "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt";

export function normalizeTifNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.match(/\d+/)?.[0];
  if (!digits) return null;
  return `T-${digits.padStart(3, "0")}`;
}

export function parseTifMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function buildTifFinancialContext(
  district: TifDistrictMatch,
  row: TifAnnualReportRow | null,
): TifFinancialContext {
  return {
    districtName: row?.tif_district || district.districtName,
    tifNumber: normalizeTifNumber(row?.tif_number) || district.tifNumber,
    reportYear: row?.report_year ? Number(row.report_year) : null,
    wards: district.wards,
    expirationDate: district.expirationDate,
    fundBalance: parseTifMoney(row?.fund_balance),
    currentYearIncrement: parseTifMoney(row?.property_tax_increment_current),
    annualExpenditures: parseTifMoney(row?.total_expenditure),
    designatedDebtObligations: parseTifMoney(row?.amount_designated_debt_obligations),
    designatedProjectCosts: parseTifMoney(row?.amount_designated_project_costs),
    surplusDeficit: parseTifMoney(row?.surplus_deficit),
    sourceUrl: TIF_ANNUAL_REPORT_SOURCE_URL,
    sourceLabel: "City of Chicago TIF Annual Report Analysis",
    caution:
      "TIF balances are reported at the district level and may already be restricted, obligated, or planned for public/project costs. This is context for discussion, not a guarantee of funding availability.",
  };
}
