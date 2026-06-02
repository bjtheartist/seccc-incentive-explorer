#!/usr/bin/env npx tsx
/**
 * Export aggregate neighborhood economic context for Chicago ZIPs.
 *
 * This script writes report-safe aggregate artifacts only. It may read raw
 * public records while running, but it does not export business, owner, parcel,
 * or address-level rows.
 *
 * Usage:
 *   npx tsx scripts/export-chicago-neighborhood-economics.ts
 *   npx tsx scripts/export-chicago-neighborhood-economics.ts --zips=60617,60619
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import * as turf from "@turf/turf";
import { businessLicensesAdapter } from "../lib/ingest/business-licenses";
import { isCommercialClass, isIndustrialClass, isVacantClass } from "../lib/parcel-classes";
import { socrataHeaders } from "../lib/socrata";
import {
  computeNeighborhoodGrowthSignals,
  type BusinessPatternInput,
  type SpendingPowerInput,
  type ZipGrowthSignal,
} from "../lib/neighborhood-growth";
import {
  buildBusinessCohorts,
  type BusinessLicenseCohortInput,
} from "../lib/southeast-resilience";

const BUSINESS_LICENSES_URL = "https://data.cityofchicago.org/resource/r5kz-chrr.json";
const PERMITS_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const CHICAGO_ZIP_BOUNDARIES_URL = "https://data.cityofchicago.org/resource/unjd-c2ca.json";
const PARCEL_UNIVERSE_URL = "https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json";
const PERMIT_ZIP_REGION_FIELD = "`:@computed_region_rpca_8um6`";

const DEFAULT_CHICAGO_ZIPS = [
  "60601", "60602", "60603", "60604", "60605", "60606", "60607", "60608", "60609", "60610",
  "60611", "60612", "60613", "60614", "60615", "60616", "60617", "60618", "60619", "60620",
  "60621", "60622", "60623", "60624", "60625", "60626", "60628", "60629", "60630", "60631",
  "60632", "60633", "60634", "60636", "60637", "60638", "60639", "60640", "60641", "60642",
  "60643", "60644", "60645", "60646", "60647", "60649", "60651", "60652", "60653", "60654",
  "60655", "60656", "60657", "60659", "60660", "60661", "60666", "60707", "60827",
];

interface PermitAggregate {
  zip: string;
  permitCount: number;
  permitReportedCost: number;
  permitDemolitionCount: number;
  permitWindowMonths: number;
}

interface ParcelClassAggregate {
  zip: string;
  parcelCount: number;
  vacantParcelCount: number;
  commercialParcelCount: number;
  industrialParcelCount: number;
}

type CitywideZipEconomicSignal = ZipGrowthSignal & {
  permitCount?: number | null;
  permitReportedCost?: number | null;
  permitDemolitionCount?: number | null;
  permitWindowMonths?: number | null;
  parcelCount?: number | null;
  vacantParcelCount?: number | null;
  commercialParcelCount?: number | null;
  industrialParcelCount?: number | null;
};

interface RawPermitAggregateRow {
  ":@computed_region_rpca_8um6"?: string;
  permit_count?: string;
  reported_cost?: string;
  demolition_count?: string;
  count_permit_?: string;
}

interface RawParcelClassRow {
  zip_code?: string;
  class?: string;
  count_pin?: string;
}

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseYear(name: string, fallback: number): number {
  const value = argValue(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
    throw new Error(`Invalid --${name}; expected a four-digit year.`);
  }
  return parsed;
}

function parseZips(): string[] {
  const value = argValue("zips");
  return Array.from(
    new Set((value ? value.split(",") : DEFAULT_CHICAGO_ZIPS).map((zip) => zip.trim()).filter(Boolean))
  ).sort();
}

function parseIntSafe(value: unknown): number {
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(path: string, rows: Array<Record<string, unknown>>) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  writeFileSync(path, csv + "\n", "utf-8");
}

function monthsAgoIso(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

async function fetchLicenseRows(
  zips: string[],
  baselineYear: number,
  comparisonYear: number
): Promise<BusinessLicenseCohortInput[]> {
  const rawRows = await fetchRelevantBusinessLicenseRows(zips, baselineYear, comparisonYear);
  const normalized = rawRows
    .map((row) => businessLicensesAdapter.normalize(row))
    .filter((row): row is NonNullable<typeof row> => row != null);

  return normalized.map((row) => ({
    licenseId: row.licenseId,
    accountNumber: row.accountNumber,
    legalName: row.legalName,
    dbaName: row.dbaName,
    address: row.address,
    zip: row.zip,
    licenseDescription: row.licenseDescription,
    licenseStatus: row.licenseStatus,
    licenseStartDate: row.licenseStartDate,
    expirationDate: row.expirationDate,
    dateIssued: row.dateIssued,
    lat: row.lat,
    lon: row.lon,
  }));
}

async function fetchRelevantBusinessLicenseRows(
  zips: string[],
  baselineYear: number,
  comparisonYear: number
) {
  const all: Array<Parameters<typeof businessLicensesAdapter.normalize>[0]> = [];
  const pageSize = 2500;
  const select = [
    "id",
    "license_id",
    "account_number",
    "legal_name",
    "doing_business_as_name",
    "address",
    "zip_code",
    "license_code",
    "license_description",
    "application_type",
    "license_status",
    "license_start_date",
    "expiration_date",
    "date_issued",
    "latitude",
    "longitude",
  ].join(",");

  for (const zip of zips) {
    let zipCount = 0;
    for (let offset = 0; ; offset += pageSize) {
      const where = encodeURIComponent(
        `zip_code='${zip}' AND ` +
        `(license_start_date IS NULL OR license_start_date <= '${comparisonYear}-12-31') AND ` +
        `(expiration_date IS NULL OR expiration_date >= '${baselineYear}-01-01')`
      );
      const url = `${BUSINESS_LICENSES_URL}?$select=${select}&$where=${where}&$limit=${pageSize}&$offset=${offset}&$order=id`;
      const page = await fetchJsonWithRetry<Array<Parameters<typeof businessLicensesAdapter.normalize>[0]>>(url);
      if (!page || page.length === 0) break;
      all.push(...page);
      zipCount += page.length;
      if (page.length < pageSize) break;
    }
    console.log(`  licenses ${zip}: ${zipCount.toLocaleString()} rows`);
  }

  return all;
}

async function fetchActiveZips(): Promise<string[]> {
  const url = `${BUSINESS_LICENSES_URL}?$select=zip_code,count(license_id)&$where=zip_code is not null&$group=zip_code&$order=zip_code`;
  try {
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ zip_code?: string }>;
    return rows
      .map((row) => row.zip_code?.trim())
      .filter((zip): zip is string => Boolean(zip && /^\d{5}$/.test(zip) && (zip.startsWith("606") || zip === "60707" || zip === "60827")));
  } catch {
    return [];
  }
}

async function fetchSpendingPower(
  zips: string[],
  licenseRows: BusinessLicenseCohortInput[]
): Promise<{ source: string; rows: SpendingPowerInput[] }> {
  if (!process.env.CENSUS_API_KEY) {
    return {
      source: "2024 ACS tract GeoJSON local join using business-license coordinates",
      rows: loadSpendingPowerFromLocalTracts(zips, licenseRows),
    };
  }

  const results: SpendingPowerInput[] = [];
  for (const zip of zips) {
    const url = new URL("https://api.census.gov/data/2024/acs/acs5");
    url.searchParams.set("get", "NAME,B01003_001E,B11001_001E,B19013_001E,B23025_004E");
    url.searchParams.set("for", `zip code tabulation area:${zip}`);
    url.searchParams.set("key", process.env.CENSUS_API_KEY);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        results.push(emptySpendingPower(zip));
        continue;
      }
      const rows = (await res.json()) as string[][];
      const [header, row] = rows;
      if (!header || !row) {
        results.push(emptySpendingPower(zip));
        continue;
      }
      const idx = Object.fromEntries(header.map((key, i) => [key, i]));
      results.push({
        zip: row[idx["zip code tabulation area"]],
        population: parseCensusNumber(row[idx.B01003_001E]),
        households: parseCensusNumber(row[idx.B11001_001E]),
        medianHouseholdIncome: parseCensusNumber(row[idx.B19013_001E]),
        employedResidents: parseCensusNumber(row[idx.B23025_004E]),
      });
    } catch {
      results.push(emptySpendingPower(zip));
    }
  }
  return { source: "2024 ACS 5-year ZCTA API", rows: results };
}

function emptySpendingPower(zip: string): SpendingPowerInput {
  return { zip, population: null, households: null, medianHouseholdIncome: null, employedResidents: null };
}

interface CensusTractFeature {
  type: "Feature";
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    tractId?: string;
    medianIncome?: number | null;
    population?: number | null;
  };
}

function loadSpendingPowerFromLocalTracts(
  zips: string[],
  licenseRows: BusinessLicenseCohortInput[]
): SpendingPowerInput[] {
  const path = resolve(process.cwd(), "public/data/census-tracts-2024.geojson");
  if (!existsSync(path)) return zips.map(emptySpendingPower);

  const collection = JSON.parse(readFileSync(path, "utf-8")) as {
    features: CensusTractFeature[];
  };
  const tracts = collection.features.map((feature) => ({
    feature,
    bbox: turf.bbox(feature),
  }));

  return zips.map((zip) => {
    const tractIds = new Set<string>();
    const zipRows = licenseRows.filter(
      (row) => row.zip === zip && row.lat != null && row.lon != null
    );

    for (const row of zipRows) {
      const lon = row.lon as number;
      const lat = row.lat as number;
      const match = tracts.find(({ feature, bbox }) => {
        const [minX, minY, maxX, maxY] = bbox;
        if (lon < minX || lon > maxX || lat < minY || lat > maxY) return false;
        return turf.booleanPointInPolygon(turf.point([lon, lat]), feature);
      });
      const tractId = match?.feature.properties.tractId;
      if (tractId) tractIds.add(tractId);
    }

    const matchedTracts = tracts
      .map(({ feature }) => feature)
      .filter((feature) => feature.properties.tractId && tractIds.has(feature.properties.tractId));
    const population = sumNumbers(
      matchedTracts.map((feature) => feature.properties.population ?? null)
    );
    const medianHouseholdIncome = weightedIncome(matchedTracts);
    const households = population == null ? null : Math.round(population / 2.4);

    return {
      zip,
      population,
      households,
      medianHouseholdIncome,
      employedResidents: null,
    };
  });
}

function sumNumbers(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function weightedIncome(features: CensusTractFeature[]): number | null {
  let totalPopulation = 0;
  let weighted = 0;
  for (const feature of features) {
    const income = feature.properties.medianIncome;
    const population = feature.properties.population;
    if (income == null || population == null) continue;
    totalPopulation += population;
    weighted += income * population;
  }
  return totalPopulation === 0 ? null : Math.round(weighted / totalPopulation);
}

function parseCensusNumber(value: string | undefined): number | null {
  if (!value || value.startsWith("-")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchZipBusinessPatterns(
  zips: string[],
  years: number[]
): Promise<{ source: string; rows: BusinessPatternInput[] }> {
  const rows: BusinessPatternInput[] = [];
  for (const year of years) {
    const text = await readZbpTotalsFile(year);
    rows.push(...parseZbpTotals(text, year, zips));
  }
  return { source: `Census ZIP Business Patterns totals files (${years.join(", ")})`, rows };
}

async function readZbpTotalsFile(year: number): Promise<string> {
  const yy = String(year).slice(2);
  const dir = resolve(process.cwd(), "data/raw/cbp");
  const zipPath = resolve(dir, `zbp${yy}totals.zip`);
  mkdirSync(dir, { recursive: true });

  if (!existsSync(zipPath)) {
    const url = `https://www2.census.gov/programs-surveys/cbp/datasets/${year}/zbp${yy}totals.zip`;
    console.log(`Fetching Census ZBP totals: ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Failed to fetch ZBP ${year}: ${res.status}`);
    writeFileSync(zipPath, new Uint8Array(await res.arrayBuffer()));
  }

  return execFileSync("/usr/bin/unzip", ["-p", zipPath], {
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function parseZbpTotals(text: string, year: number, zips: string[]): BusinessPatternInput[] {
  const wanted = new Set(zips);
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine).map((header) => header.replace(/^"|"$/g, ""));
  const idx = Object.fromEntries(headers.map((header, i) => [header, i]));
  const out: BusinessPatternInput[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const zip = values[idx.zip]?.replace(/^"|"$/g, "");
    if (!wanted.has(zip)) continue;
    out.push({
      zip,
      year,
      establishments: parseInteger(values[idx.est]),
      employment: parseInteger(values[idx.emp]),
      firstQuarterPayroll: multiplyThousands(parseInteger(values[idx.qp1])),
      annualPayroll: multiplyThousands(parseInteger(values[idx.ap])),
    });
  }

  return out;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/^"|"$/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function multiplyThousands(value: number | null): number | null {
  return value == null ? null : value * 1000;
}

async function fetchPermitAggregates(zips: string[], windowMonths: number): Promise<Map<string, PermitAggregate>> {
  const since = monthsAgoIso(windowMonths);
  const zipRegionMap = await fetchZipRegionMap(zips);
  const regionIds = Array.from(zipRegionMap.keys());
  const regionList = regionIds.map((id) => `'${id}'`).join(",");

  const out = new Map<string, PermitAggregate>();
  for (const zip of zips) {
    out.set(zip, { zip, permitCount: 0, permitReportedCost: 0, permitDemolitionCount: 0, permitWindowMonths: windowMonths });
  }
  if (regionIds.length === 0) return out;

  const params = new URLSearchParams();
  params.set("$select", `${PERMIT_ZIP_REGION_FIELD},count(permit_) as permit_count,sum(reported_cost) as reported_cost`);
  params.set("$where", `${PERMIT_ZIP_REGION_FIELD} in(${regionList}) AND issue_date>'${since}'`);
  params.set("$group", PERMIT_ZIP_REGION_FIELD);
  params.set("$limit", "5000");

  const demolitionParams = new URLSearchParams(params);
  demolitionParams.set(
    "$where",
    `${PERMIT_ZIP_REGION_FIELD} in(${regionList}) AND issue_date>'${since}' AND upper(permit_type) like '%DEMOLITION%'`
  );

  const [permitRows, demoRows] = await Promise.all([
    fetchJson<RawPermitAggregateRow[]>(`${PERMITS_URL}?${params.toString()}`),
    fetchJson<RawPermitAggregateRow[]>(`${PERMITS_URL}?${demolitionParams.toString()}`),
  ]);

  for (const row of permitRows ?? []) {
    const zip = zipRegionMap.get(row[":@computed_region_rpca_8um6"]?.trim() ?? "");
    if (!zip || !out.has(zip)) continue;
    out.set(zip, {
      zip,
      permitCount: parseIntSafe(row.permit_count ?? row.count_permit_),
      permitReportedCost: parseIntSafe(row.reported_cost),
      permitDemolitionCount: 0,
      permitWindowMonths: windowMonths,
    });
  }

  for (const row of demoRows ?? []) {
    const zip = zipRegionMap.get(row[":@computed_region_rpca_8um6"]?.trim() ?? "");
    const current = zip ? out.get(zip) : null;
    if (!zip || !current) continue;
    current.permitDemolitionCount = parseIntSafe(row.permit_count ?? row.count_permit_);
  }

  return out;
}

async function fetchZipRegionMap(zips: string[]): Promise<Map<string, string>> {
  const zipList = zips.map((zip) => `'${zip}'`).join(",");
  const params = new URLSearchParams();
  params.set("$select", "objectid,zip");
  params.set("$where", `zip in(${zipList})`);
  params.set("$limit", "5000");

  const rows = await fetchJson<Array<{ objectid?: string; zip?: string }>>(
    `${CHICAGO_ZIP_BOUNDARIES_URL}?${params.toString()}`
  );
  const out = new Map<string, string>();
  for (const row of rows ?? []) {
    const objectId = row.objectid?.trim();
    const zip = row.zip?.trim();
    if (objectId && zip) out.set(objectId, zip);
  }
  return out;
}

async function fetchParcelClassAggregates(zips: string[]): Promise<Map<string, ParcelClassAggregate>> {
  const latestYear = await fetchLatestParcelYear(zips);
  const out = new Map<string, ParcelClassAggregate>();
  for (const zip of zips) {
    out.set(zip, {
      zip,
      parcelCount: 0,
      vacantParcelCount: 0,
      commercialParcelCount: 0,
      industrialParcelCount: 0,
    });
  }
  if (!latestYear) return out;

  const zipList = zips.map((zip) => `'${zip}'`).join(",");
  const where = encodeURIComponent(`zip_code in(${zipList}) AND year=${latestYear}`);
  const select = encodeURIComponent("zip_code,class,count(pin) as count_pin");
  const url = `${PARCEL_UNIVERSE_URL}?$select=${select}&$where=${where}&$group=zip_code,class&$limit=50000`;
  const rows = await fetchJson<RawParcelClassRow[]>(url);

  for (const row of rows ?? []) {
    const zip = row.zip_code?.trim();
    const classCode = row.class?.trim() || "";
    const count = parseIntSafe(row.count_pin);
    const current = zip ? out.get(zip) : null;
    if (!zip || !current) continue;
    current.parcelCount += count;
    if (isVacantClass(classCode)) current.vacantParcelCount += count;
    if (isCommercialClass(classCode)) current.commercialParcelCount += count;
    if (isIndustrialClass(classCode)) current.industrialParcelCount += count;
  }

  return out;
}

async function fetchLatestParcelYear(zips: string[]): Promise<string | null> {
  const zipList = zips.map((zip) => `'${zip}'`).join(",");
  const where = encodeURIComponent(`zip_code in(${zipList})`);
  const url = `${PARCEL_UNIVERSE_URL}?$select=max(year)&$where=${where}`;
  const rows = await fetchJson<Array<{ max_year?: string }>>(url);
  const latest = rows?.[0]?.max_year;
  return latest ? String(Math.trunc(Number(latest))) : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithRetry<T>(url: string, retries = 2): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function growthRowToExport(signal: CitywideZipEconomicSignal): Record<string, unknown> {
  return {
    zip: signal.zip,
    baseline_active_businesses: signal.baselineActiveBusinesses,
    comparison_active_businesses: signal.comparisonActiveBusinesses,
    retained_businesses: signal.retainedBusinesses,
    left_or_closed_businesses: signal.leftOrClosedBusinesses,
    new_businesses: signal.newBusinesses,
    business_net_growth_rate: signal.businessNetGrowthRate,
    resilience_rate: signal.resilienceRate,
    official_cbp_baseline_year: signal.officialBusinessPatternBaselineYear,
    official_cbp_comparison_year: signal.officialBusinessPatternComparisonYear,
    official_establishments_baseline: signal.officialEstablishmentsBaseline,
    official_establishments_comparison: signal.officialEstablishmentsComparison,
    official_employment_baseline: signal.officialEmploymentBaseline,
    official_employment_comparison: signal.officialEmploymentComparison,
    official_employment_growth_rate: signal.officialEmploymentGrowthRate,
    official_annual_payroll_baseline: signal.officialAnnualPayrollBaseline,
    official_annual_payroll_comparison: signal.officialAnnualPayrollComparison,
    official_payroll_growth_rate: signal.officialPayrollGrowthRate,
    population: signal.population,
    households: signal.households,
    median_household_income: signal.medianHouseholdIncome,
    resident_spending_power_proxy: signal.residentSpendingPowerProxy,
    permit_count: signal.permitCount ?? null,
    permit_reported_cost: signal.permitReportedCost ?? null,
    permit_demolition_count: signal.permitDemolitionCount ?? null,
    parcel_count: signal.parcelCount ?? null,
    vacant_parcel_count: signal.vacantParcelCount ?? null,
    commercial_parcel_count: signal.commercialParcelCount ?? null,
    industrial_parcel_count: signal.industrialParcelCount ?? null,
    measurement_notes: signal.measurementNotes,
  };
}

async function main() {
  loadLocalEnv();

  const baselineYear = parseYear("baseline", 2020);
  const comparisonYear = parseYear("comparison", 2025);
  const cbpComparisonYear = parseYear("cbp-comparison", 2023);
  const permitWindowMonths = Number(argValue("permit-window-months") ?? 24);
  const requestedZips = parseZips();
  const activeZips = await fetchActiveZips();
  const zips = requestedZips.filter((zip) => activeZips.length === 0 || activeZips.includes(zip));
  const outDir = resolve(process.cwd(), "data/exports/chicago-neighborhood-economics");
  mkdirSync(outDir, { recursive: true });

  console.log("Exporting Chicago neighborhood economics...");
  console.log(`ZIPs: ${zips.length} (${zips.join(", ")})`);
  console.log(`Window: ${baselineYear} → ${comparisonYear}`);

  const licenseRows = await fetchLicenseRows(zips, baselineYear, comparisonYear);
  const cohorts = buildBusinessCohorts(licenseRows, baselineYear, comparisonYear);
  const [spendingPower, businessPatterns, permitAggregates, parcelAggregates] = await Promise.all([
    fetchSpendingPower(zips, licenseRows),
    fetchZipBusinessPatterns(zips, [baselineYear, cbpComparisonYear]),
    fetchPermitAggregates(zips, permitWindowMonths),
    fetchParcelClassAggregates(zips),
  ]);
  const growth = computeNeighborhoodGrowthSignals(
    cohorts.records,
    spendingPower.rows,
    businessPatterns.rows
  );

  const byZip = growth.zips.map((signal) => {
    const permits = permitAggregates.get(signal.zip);
    const parcels = parcelAggregates.get(signal.zip);
    return {
      ...signal,
      permitCount: permits?.permitCount ?? null,
      permitReportedCost: permits?.permitReportedCost ?? null,
      permitDemolitionCount: permits?.permitDemolitionCount ?? null,
      permitWindowMonths,
      parcelCount: parcels?.parcelCount ?? null,
      vacantParcelCount: parcels?.vacantParcelCount ?? null,
      commercialParcelCount: parcels?.commercialParcelCount ?? null,
      industrialParcelCount: parcels?.industrialParcelCount ?? null,
      measurementNotes: [
        ...signal.measurementNotes,
        "Permit and parcel metrics are aggregate ZIP-level public-data signals and do not expose row-level property or owner records.",
      ],
    };
  });

  const rows = byZip.map(growthRowToExport);
  writeCsv(resolve(outDir, "neighborhood_economics_by_zip.csv"), rows);
  writeFileSync(
    resolve(outDir, "neighborhood_economics_by_zip.json"),
    JSON.stringify(
      {
        source: "citywide-public-aggregate",
        baselineYear,
        comparisonYear,
        zips,
        spendingPowerSource: spendingPower.source,
        businessPatternSource: businessPatterns.source,
        permitSource: `City of Chicago Building Permits aggregate by ZIP, trailing ${permitWindowMonths} months`,
        parcelSource: "Cook County Parcel Universe aggregate by ZIP and class",
        modelNotes: [
          ...growth.aggregate.measurementNotes,
          "Permit and parcel metrics are aggregate ZIP-level public-data signals and do not expose row-level property or owner records.",
        ],
        aggregate: growth.aggregate,
        byZip,
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );

  console.log("\n── Summary ──");
  console.log(`Source license rows: ${licenseRows.length.toLocaleString()}`);
  console.log(`ZIPs exported: ${byZip.length}`);
  console.log(`2020 active entities: ${cohorts.summary.baselineActiveCount.toLocaleString()}`);
  console.log(`2025 active entities: ${cohorts.summary.comparisonActiveCount.toLocaleString()}`);
  console.log(`Retained: ${cohorts.summary.retainedCount.toLocaleString()}`);
  console.log(
    `Resilience rate: ${
      cohorts.summary.resilienceRate == null
        ? "n/a"
        : `${(cohorts.summary.resilienceRate * 100).toFixed(1)}%`
    }`
  );
  console.log(`Wrote aggregate artifacts to ${outDir}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
