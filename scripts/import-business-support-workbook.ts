/**
 * Import the curated Chicago small-business resource workbook into a compact,
 * community-area-keyed JSON artifact for report rendering.
 *
 * Usage:
 *   npm run support:import -- --input="/path/to/chicago_small_business_resource_map.xlsx"
 *   npx tsx scripts/import-business-support-workbook.ts --input="/path/to/workbook.xlsx"
 *
 * Security boundary: this is a trusted local import tool. Do not expose XLSX
 * upload/parsing through a public API route without a hardened upload pipeline
 * and security review.
 */
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyVerifiedLocalBusinessSupportOverride,
  normalizeSupportName,
  rankLocalBusinessSupport,
  type LocalBusinessSupportContext,
  type LocalBusinessSupportOrganization,
  type LocalBusinessSupportRelationship,
} from "../lib/local-business-support";

const COVERAGE_SHEET = "Community Coverage";
const PROVIDER_SHEET = "Provider Directory";
const OUT_DIR = resolve(process.cwd(), "data/exports/chicago-neighborhood-economics");
const OUT_FILE = resolve(OUT_DIR, "local_business_support_by_community_area.json");

const SSA_PROVIDER_OVERRIDES: Record<
  string,
  { coverage: string; providers: string[]; sourceUrls: string[] }
> = {
  "46": {
    coverage: "SSA #5 Commercial Ave. (Calumet Area Industrial Commission)",
    providers: ["Calumet Area Industrial Commission"],
    sourceUrls: ["https://calumetareaindustrial.com/ssa5"],
  },
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitUrls(value: unknown): string[] {
  return str(value)
    .split(/[\n;,]+|\s+(?=https?:\/\/)/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

function normalizeWebsite(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) return `https://${raw}`;
  return raw;
}

function headerMap(rows: unknown[][]): Record<string, number> {
  const header = (rows[0] ?? []).map((h) => str(h).toLowerCase());
  return Object.fromEntries(header.map((h, i) => [h, i]));
}

function column(map: Record<string, number>, label: string): number {
  return map[label.toLowerCase()] ?? -1;
}

function value(row: unknown[], index: number): string {
  return index >= 0 ? str(row[index]) : "";
}

function providerKeyVariants(name: string): string[] {
  const variants = new Set<string>();
  const seedNames = [
    name,
    name.replace(/\s*\([A-Z0-9&.\s]{2,}\)\s*/g, " "),
    name.replace(/\b(corp)\b\.?/gi, "corporation"),
    name.replace(/\b(corporation)\b/gi, "corp"),
    name.replace(/\b(nfp|inc|llc|ltd)\b\.?$/i, " "),
  ];
  for (const seed of seedNames) {
    variants.add(normalizeSupportName(seed));
    variants.add(normalizeSupportName(seed.replace(/\b(corp)\b\.?/gi, "corporation")));
    variants.add(normalizeSupportName(seed.replace(/\b(corporation)\b/gi, "corp")));
    variants.add(normalizeSupportName(seed.replace(/\b(nfp|inc|llc|ltd)\b\.?$/i, " ")));
  }
  return Array.from(variants).filter(Boolean);
}

function parseList(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSsaProviders(value: string): string[] {
  const providers: string[] = [];
  const re = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const provider = match[1]?.trim();
    if (provider) providers.push(provider);
  }
  return providers;
}

function mergeUrls(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

interface ProviderRecord extends LocalBusinessSupportOrganization {
  id: string;
  officeCommunityArea?: string;
}

function buildProviderIndex(rows: unknown[][]): Map<string, ProviderRecord> {
  const map = headerMap(rows);
  const cols = {
    id: column(map, "Provider ID"),
    name: column(map, "Provider Name"),
    primaryType: column(map, "Primary Type"),
    subtype: column(map, "Program / Subtype"),
    officeCa: column(map, "Office Community Area"),
    address: column(map, "Address"),
    phone: column(map, "Phone"),
    website: column(map, "Website"),
    supportTypes: column(map, "Support Types"),
    serviceGeography: column(map, "Service Geography"),
    citywide: column(map, "Citywide / Regional"),
    validation: column(map, "Validation Level"),
    status: column(map, "Current Status"),
    year: column(map, "Source Year"),
    urls: column(map, "Source URL"),
  };

  const index = new Map<string, ProviderRecord>();
  for (const row of rows.slice(1)) {
    const name = value(row, cols.name);
    if (!name) continue;

    const record = applyVerifiedLocalBusinessSupportOverride({
      id: value(row, cols.id) || normalizeSupportName(name),
      name,
      primaryType: value(row, cols.primaryType) || undefined,
      programSubtype: value(row, cols.subtype) || undefined,
      relationships: [],
      officeCommunityArea: value(row, cols.officeCa) || undefined,
      address: value(row, cols.address) || undefined,
      phone: value(row, cols.phone) || undefined,
      website: normalizeWebsite(value(row, cols.website)),
      supportTypes: value(row, cols.supportTypes) || undefined,
      serviceGeography: value(row, cols.serviceGeography) || undefined,
      citywideOrRegional: value(row, cols.citywide) || undefined,
      validationLevel: value(row, cols.validation) || undefined,
      currentStatus: value(row, cols.status) || undefined,
      sourceYear: value(row, cols.year) || undefined,
      sourceUrls: splitUrls(value(row, cols.urls)),
    }) as ProviderRecord;

    for (const key of providerKeyVariants(name)) {
      index.set(key, record);
    }
  }
  return index;
}

function makeOrganization(
  name: string,
  relationship: LocalBusinessSupportRelationship,
  providerIndex: Map<string, ProviderRecord>,
  fallbackSourceUrls: string[]
): LocalBusinessSupportOrganization | null {
  const variants = providerKeyVariants(name);
  if (variants.length === 0) return null;
  const provider = variants.map((variant) => providerIndex.get(variant)).find(Boolean);
  if (provider) {
    return {
      ...provider,
      relationships: [relationship],
      sourceUrls: mergeUrls(provider.sourceUrls, fallbackSourceUrls),
    };
  }
  return {
    name: name.trim(),
    relationships: [relationship],
    sourceUrls: fallbackSourceUrls,
  };
}

function addOrganization(
  orgs: Map<string, LocalBusinessSupportOrganization>,
  org: LocalBusinessSupportOrganization | null
) {
  if (!org) return;
  const key = normalizeSupportName(org.name);
  const existing = orgs.get(key);
  if (!existing) {
    orgs.set(key, org);
    return;
  }
  existing.relationships = Array.from(new Set([...existing.relationships, ...org.relationships]));
  existing.sourceUrls = mergeUrls(existing.sourceUrls, org.sourceUrls);
  existing.primaryType ||= org.primaryType;
  existing.programSubtype ||= org.programSubtype;
  existing.address ||= org.address;
  existing.phone ||= org.phone;
  existing.email ||= org.email;
  existing.website ||= org.website;
  existing.supportTypes ||= org.supportTypes;
  existing.serviceGeography ||= org.serviceGeography;
  existing.citywideOrRegional ||= org.citywideOrRegional;
  existing.validationLevel ||= org.validationLevel;
  existing.currentStatus ||= org.currentStatus;
  existing.sourceYear ||= org.sourceYear;
  existing.lastVerifiedAt ||= org.lastVerifiedAt;
}

function main() {
  const input = argValue("input");
  if (!input) {
    console.error("Missing --input=/path/to/workbook.xlsx");
    process.exit(1);
  }

  const wb = XLSX.readFile(input);
  const coverageSheet = wb.Sheets[COVERAGE_SHEET];
  const providerSheet = wb.Sheets[PROVIDER_SHEET];
  if (!coverageSheet || !providerSheet) {
    console.error(`Required sheets not found. Sheets: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const coverageRows = XLSX.utils.sheet_to_json<unknown[]>(coverageSheet, { header: 1, defval: "" });
  const providerRows = XLSX.utils.sheet_to_json<unknown[]>(providerSheet, { header: 1, defval: "" });
  const providerIndex = buildProviderIndex(providerRows);
  const map = headerMap(coverageRows);
  const cols = {
    caNumber: column(map, "CA #"),
    caName: column(map, "Community Area"),
    region: column(map, "Region"),
    primary: column(map, "Primary Access Point"),
    primaryType: column(map, "Primary Type"),
    secondary: column(map, "Secondary Access Point"),
    secondaryType: column(map, "Secondary Type"),
    nbdc: column(map, "NBDC Coverage"),
    sbdc: column(map, "SBDC Access"),
    cbc: column(map, "CBC Access"),
    capital: column(map, "Capital/Lender Access"),
    corridor: column(map, "Corridor/SSA/Chamber Access"),
    confidence: column(map, "Confidence"),
    gap: column(map, "Biggest Gap / Validation Need"),
    urls: column(map, "Source URLs"),
    nbdcOfficial: column(map, "NBDC 2025 Official Coverage"),
    cbcHub: column(map, "CBC Regional Hub (2025)"),
    ssa: column(map, "SSA(s) Serving Area (2026)"),
  };

  if (cols.caNumber < 0 || cols.caName < 0 || cols.primary < 0) {
    console.error("Required Community Coverage columns not found.");
    process.exit(1);
  }

  const byCommunityArea: Record<string, LocalBusinessSupportContext> = {};

  for (const row of coverageRows.slice(1)) {
    const caNumber = num(row[cols.caNumber]);
    const communityArea = value(row, cols.caName);
    if (caNumber == null || !communityArea) continue;

    const key = String(caNumber);
    const ssaOverride = SSA_PROVIDER_OVERRIDES[key];
    const rowSourceUrls = splitUrls(value(row, cols.urls));
    const sourceUrls = mergeUrls(rowSourceUrls, ssaOverride?.sourceUrls ?? []);
    const orgs = new Map<string, LocalBusinessSupportOrganization>();

    addOrganization(
      orgs,
      makeOrganization(value(row, cols.primary), "primary_access_point", providerIndex, sourceUrls)
    );
    addOrganization(
      orgs,
      makeOrganization(value(row, cols.secondary), "secondary_access_point", providerIndex, sourceUrls)
    );
    for (const name of parseList(value(row, cols.nbdcOfficial))) {
      addOrganization(orgs, makeOrganization(name, "nbdc_2025", providerIndex, sourceUrls));
    }
    const cbcHub = value(row, cols.cbcHub).replace(/\s*\([^)]*\)\s*$/, "");
    addOrganization(orgs, makeOrganization(cbcHub, "cbc_hub", providerIndex, sourceUrls));
    const ssaProviders = ssaOverride?.providers ?? parseSsaProviders(value(row, cols.ssa));
    for (const name of ssaProviders) {
      addOrganization(orgs, makeOrganization(name, "ssa_provider", providerIndex, sourceUrls));
    }

    byCommunityArea[key] = {
      communityAreaNumber: key,
      communityArea,
      region: value(row, cols.region) || undefined,
      confidence: value(row, cols.confidence) || undefined,
      biggestGap: value(row, cols.gap) || undefined,
      coverage: {
        nbdc: value(row, cols.nbdc) || undefined,
        sbdc: value(row, cols.sbdc) || undefined,
        cbc: value(row, cols.cbc) || undefined,
        capital: value(row, cols.capital) || undefined,
        corridor: value(row, cols.corridor) || undefined,
        nbdcOfficial: value(row, cols.nbdcOfficial) || undefined,
        cbcHub: value(row, cols.cbcHub) || undefined,
        ssa: (ssaOverride?.coverage ?? value(row, cols.ssa)) || undefined,
      },
      organizations: rankLocalBusinessSupport(Array.from(orgs.values()), 8),
      sourceLabel: "Chicago Small Business Resource Map, Phase 2 validated workbook",
      sourceUrls,
    };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        source: "chicago_small_business_resource_map_phase2_validated",
        generatedAt: new Date().toISOString(),
        communityAreaCount: Object.keys(byCommunityArea).length,
        providerCount: providerRows.length - 1,
        byCommunityArea,
      },
      null,
      2
    ) + "\n"
  );

  console.log(
    `Imported local business support for ${Object.keys(byCommunityArea).length} community areas → ${OUT_FILE}`
  );
}

main();
