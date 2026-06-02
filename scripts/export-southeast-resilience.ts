#!/usr/bin/env npx tsx
/**
 * Export Sprint 1 Southeast business-resilience cohorts from business_licenses.
 *
 * This is read-only against Neon. It writes CSV work products under
 * data/exports/southeast-resilience/ so the first pilot can be reviewed before
 * any UI/report work depends on it.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/export-southeast-resilience.ts
 *   npx tsx scripts/export-southeast-resilience.ts --baseline=2020 --comparison=2025 --zips=60617,60619,60649
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";
import * as turf from "@turf/turf";
import { businessLicensesAdapter } from "../lib/ingest/business-licenses";
import {
  computeNeighborhoodGrowthSignals,
  type BusinessPatternInput,
  type SpendingPowerInput,
  type ZipGrowthSignal,
} from "../lib/neighborhood-growth";
import {
  buildBusinessCohorts,
  type BusinessCohortRecord,
  type BusinessLicenseCohortInput,
} from "../lib/southeast-resilience";

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
  return (value ? value.split(",") : ["60617", "60619", "60649"])
    .map((zip) => zip.trim())
    .filter(Boolean);
}

function isMissingBusinessTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
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

function rowToExport(record: BusinessCohortRecord): Record<string, unknown> {
  return {
    status: record.status,
    business_name: record.businessName,
    dba_name: record.dbaName,
    legal_name: record.legalName,
    account_number: record.accountNumber,
    address: record.primaryAddress,
    zip: record.zip,
    active_in_baseline_year: record.activeInBaselineYear,
    active_in_comparison_year: record.activeInComparisonYear,
    first_license_start: record.firstLicenseStart,
    latest_expiration: record.latestExpiration,
    license_count: record.licenseCount,
    license_descriptions: record.licenseDescriptions,
    license_statuses: record.licenseStatuses,
    license_ids: record.licenseIds,
    evidence: record.evidence,
    review_reason: record.reviewReason,
    entity_key: record.entityKey,
  };
}

function growthRowToExport(signal: ZipGrowthSignal): Record<string, unknown> {
  return {
    zip: signal.zip,
    baseline_active_businesses: signal.baselineActiveBusinesses,
    comparison_active_businesses: signal.comparisonActiveBusinesses,
    retained_businesses: signal.retainedBusinesses,
    left_or_closed_businesses: signal.leftOrClosedBusinesses,
    new_businesses: signal.newBusinesses,
    business_net_growth_rate: signal.businessNetGrowthRate,
    resilience_rate: signal.resilienceRate,
    estimated_fte_baseline: signal.estimatedFteBaseline,
    estimated_fte_comparison: signal.estimatedFteComparison,
    estimated_fte_net_change: signal.estimatedFteNetChange,
    estimated_payroll_baseline: signal.estimatedPayrollBaseline,
    estimated_payroll_comparison: signal.estimatedPayrollComparison,
    estimated_payroll_net_change: signal.estimatedPayrollNetChange,
    average_wage_proxy_comparison: signal.averageWageProxyComparison,
    modeled_local_impact_comparison: signal.modeledLocalImpactComparison,
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
    employed_residents: signal.employedResidents,
    resident_spending_power_proxy: signal.residentSpendingPowerProxy,
    measurement_notes: signal.measurementNotes,
  };
}

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text || null;
}

async function fetchFromDatabase(
  databaseUrl: string,
  zips: string[],
  baselineYear: number,
  comparisonYear: number
): Promise<BusinessLicenseCohortInput[]> {
  const sql = neon(databaseUrl);
  const dbRows = (await sql`
    SELECT
      license_id,
      account_number,
      legal_name,
      dba_name,
      address,
      zip,
      license_description,
      license_status,
      license_start_date,
      expiration_date,
      date_issued,
      lat,
      lon
    FROM business_licenses
    WHERE zip = ANY(${zips})
      AND (
        license_start_date IS NULL
        OR license_start_date <= ${`${comparisonYear}-12-31`}::date
      )
      AND (
        expiration_date IS NULL
        OR expiration_date >= ${`${baselineYear}-01-01`}::date
      )
    ORDER BY zip, address, account_number, license_start_date
  `) as Array<{
    license_id: string;
    account_number: string | null;
    legal_name: string | null;
    dba_name: string | null;
    address: string | null;
    zip: string | null;
    license_description: string | null;
    license_status: string | null;
    license_start_date: unknown;
    expiration_date: unknown;
    date_issued: unknown;
    lat: number | null;
    lon: number | null;
  }>;

  return dbRows.map((row) => ({
    licenseId: row.license_id,
    accountNumber: row.account_number,
    legalName: row.legal_name,
    dbaName: row.dba_name,
    address: row.address,
    zip: row.zip,
    licenseDescription: row.license_description,
    licenseStatus: row.license_status,
    licenseStartDate: toIsoDate(row.license_start_date),
    expirationDate: toIsoDate(row.expiration_date),
    dateIssued: toIsoDate(row.date_issued),
    lat: row.lat,
    lon: row.lon,
  }));
}

async function fetchFromSocrata(zips: string[]): Promise<BusinessLicenseCohortInput[]> {
  const rawRows = await businessLicensesAdapter.fetch({ zips });
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
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`ACS spending-power fetch failed for ${zip}; status ${res.status}.`);
      results.push(emptySpendingPower(zip));
      continue;
    }
    try {
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
    } catch (err) {
      console.warn(`ACS spending-power parse failed for ${zip}; continuing without it. ${err}`);
      results.push(emptySpendingPower(zip));
    }
  }
  return { source: "2024 ACS 5-year ZCTA API", rows: results };
}

function emptySpendingPower(zip: string): SpendingPowerInput {
  return {
    zip,
    population: null,
    households: null,
    medianHouseholdIncome: null,
    employedResidents: null,
  };
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
  return {
    source: `Census ZIP Business Patterns totals files (${years.join(", ")})`,
    rows,
  };
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
    const bytes = new Uint8Array(await res.arrayBuffer());
    writeFileSync(zipPath, bytes);
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
  const cleaned = value.replace(/^"|"$/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function multiplyThousands(value: number | null): number | null {
  return value == null ? null : value * 1000;
}

async function main() {
  loadLocalEnv();

  const baselineYear = parseYear("baseline", 2020);
  const comparisonYear = parseYear("comparison", 2025);
  const cbpComparisonYear = parseYear("cbp-comparison", 2023);
  const zips = parseZips();
  const requestedSource = argValue("source") ?? "auto";
  const outDir = resolve(process.cwd(), "data/exports/southeast-resilience");
  mkdirSync(outDir, { recursive: true });

  console.log("Exporting Southeast business-resilience cohorts...");
  console.log(`ZIPs: ${zips.join(", ")}`);
  console.log(`Window: ${baselineYear} → ${comparisonYear}`);

  let source = "socrata";
  let licenseRows: BusinessLicenseCohortInput[];
  const databaseUrl = process.env.DATABASE_URL;

  if (requestedSource !== "socrata" && databaseUrl) {
    try {
      licenseRows = await fetchFromDatabase(databaseUrl, zips, baselineYear, comparisonYear);
      source = "database";
    } catch (err) {
      if (!isMissingBusinessTableError(err) || requestedSource === "database") {
        throw err;
      }
      console.warn("business_licenses table is missing; falling back to Socrata read-only fetch.");
      licenseRows = await fetchFromSocrata(zips);
      source = "socrata";
    }
  } else {
    licenseRows = await fetchFromSocrata(zips);
    source = "socrata";
  }

  const result = buildBusinessCohorts(licenseRows, baselineYear, comparisonYear);
  const exportRows = result.records.map(rowToExport);
  const spendingPower = await fetchSpendingPower(zips, licenseRows);
  const businessPatterns = await fetchZipBusinessPatterns(zips, [baselineYear, cbpComparisonYear]);
  const growth = computeNeighborhoodGrowthSignals(
    result.records,
    spendingPower.rows,
    businessPatterns.rows
  );
  const growthRows = [...growth.zips, growth.aggregate].map(growthRowToExport);

  writeFileSync(
    resolve(outDir, "business_resilience_summary.json"),
    JSON.stringify({ ...result.summary, zips, source, sourceRows: licenseRows.length }, null, 2) + "\n",
    "utf-8"
  );
  writeCsv(resolve(outDir, "business_cohort_2020_2025.csv"), exportRows);
  writeCsv(
    resolve(outDir, "business_retained.csv"),
    exportRows.filter((row) => row.status === "retained")
  );
  writeCsv(
    resolve(outDir, "business_left_or_closed.csv"),
    exportRows.filter((row) => row.status === "left_or_closed")
  );
  writeCsv(
    resolve(outDir, "business_new_since_2020.csv"),
    exportRows.filter((row) => row.status === "new_since_baseline")
  );
  writeCsv(
    resolve(outDir, "business_needs_review.csv"),
    exportRows.filter((row) => row.status === "needs_review")
  );
  writeFileSync(
    resolve(outDir, "neighborhood_growth_signal.json"),
    JSON.stringify(
      {
        source,
        baselineYear,
        comparisonYear,
        zips,
        spendingPowerSource: spendingPower.source,
        businessPatternSource: businessPatterns.source,
        modelNotes: growth.aggregate.measurementNotes,
        aggregate: growth.aggregate,
        byZip: growth.zips,
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  writeCsv(resolve(outDir, "neighborhood_growth_signal.csv"), growthRows);

  console.log("\n── Summary ──");
  console.log(`Source license rows: ${licenseRows.length}`);
  console.log(`2020 active entities: ${result.summary.baselineActiveCount}`);
  console.log(`2025 active entities: ${result.summary.comparisonActiveCount}`);
  console.log(`Retained: ${result.summary.retainedCount}`);
  console.log(`Left/closed: ${result.summary.leftOrClosedCount}`);
  console.log(`New since 2020: ${result.summary.newSinceBaselineCount}`);
  console.log(`Needs review: ${result.summary.needsReviewCount}`);
  console.log(
    `Resilience rate: ${
      result.summary.resilienceRate == null
        ? "n/a"
        : `${(result.summary.resilienceRate * 100).toFixed(1)}%`
    }`
  );
  console.log("\n── Neighborhood Growth Signal (Aggregate) ──");
  console.log(
    `Business net growth: ${
      growth.aggregate.businessNetGrowthRate == null
        ? "n/a"
        : `${(growth.aggregate.businessNetGrowthRate * 100).toFixed(1)}%`
    }`
  );
  console.log(`Estimated FTE net change: ${growth.aggregate.estimatedFteNetChange.toLocaleString()}`);
  console.log(
    `Estimated payroll net change: $${growth.aggregate.estimatedPayrollNetChange.toLocaleString()}`
  );
  console.log(
    `Resident spending-power proxy: ${
      growth.aggregate.residentSpendingPowerProxy == null
        ? "n/a"
        : `$${growth.aggregate.residentSpendingPowerProxy.toLocaleString()}`
    }`
  );
  console.log(
    `Official ZBP employment growth (${baselineYear}→${cbpComparisonYear}): ${
      growth.aggregate.officialEmploymentGrowthRate == null
        ? "n/a"
        : `${(growth.aggregate.officialEmploymentGrowthRate * 100).toFixed(1)}%`
    }`
  );
  console.log(
    `Official ZBP payroll growth (${baselineYear}→${cbpComparisonYear}): ${
      growth.aggregate.officialPayrollGrowthRate == null
        ? "n/a"
        : `${(growth.aggregate.officialPayrollGrowthRate * 100).toFixed(1)}%`
    }`
  );
  console.log(`\nWrote CSVs to ${outDir}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
