#!/usr/bin/env npx tsx
/**
 * Export the TIF funding picture to public/data/tif-briefs.json — the committed
 * source for the "TIF funding picture" section on the per-ZIP vacancy web
 * report (app/vacancy/[zip]/page.tsx). Consumed by lib/tif-briefs.ts's
 * static-only loader. Reads only committed/static + public-Socrata inputs, so
 * unlike the vacancy export it needs NO database and NO Neon refresh branch.
 *
 * ── Runbook ────────────────────────────────────────────────────────────────
 *   npx tsx scripts/export-tif-briefs.ts      (or: npm run tif:briefs:export)
 *   git add public/data/tif-briefs.json && commit.
 *
 * ── Inputs (all verified live 7/23) ────────────────────────────────────────
 *   1. public/data/zones/tif-districts.geojson — 100 Active districts.
 *      TIF_Number "T- 87" (embedded space, normalized to "T-87"), District_Name,
 *      Approval_Date, Expiration_Date, SBIF "Y"/"N", Wards, Status.
 *   2. Socrata qm7s-3ctt (TIF Annual Report — Analysis of Special Tax Allocation
 *      Fund), no auth. Latest report_year row per normalized tif_number.
 *   3. public/data/vacancy-index.json — per-pilot-ZIP edition boundary rings +
 *      sitePoints, for ZIP membership and per-district vacant-site counts.
 *
 * ── Composition ────────────────────────────────────────────────────────────
 * The pure geometry/join/compose functions live in lib/tif-briefs.ts (unit
 * tested without network); this script does the IO: parse the geojson geometry,
 * fetch + parse Socrata, run the pure contiguity/membership/count functions,
 * assemble the export, and write it. The output carries no personal data.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { PILOT_ZIPS } from "../lib/pilot-zips";
import type { VacancyIndexExport } from "../lib/vacancy-index";
import {
  buildTifFundingPicture,
  compareTifNumbers,
  computeTifContiguity,
  countPointsInDistrict,
  districtIntersectsZip,
  latestFinanceByTif,
  normalizeTifNumber,
  type TifAnnualReportRow,
  type TifBriefsExport,
  type TifDistrictBrief,
  type TifPolygon,
  type TifZipBrief,
} from "../lib/tif-briefs";

// ── Paths ─────────────────────────────────────────────────────────────────

const TIF_GEOJSON_PATH = join(process.cwd(), "public", "data", "zones", "tif-districts.geojson");
const VACANCY_INDEX_PATH = join(process.cwd(), "public", "data", "vacancy-index.json");
const OUT_PATH = join(process.cwd(), "public", "data", "tif-briefs.json");
const TIF_ANNUAL_REPORT_URL = "https://data.cityofchicago.org/resource/qm7s-3ctt.json";

// ── Number parsing ──────────────────────────────────────────────────────────

/** Parse a Socrata string amount to a number, or null when blank/unparseable
 * (never coerced to 0 — an absent figure stays null through to the UI). */
function toNumOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── TIF district geojson ────────────────────────────────────────────────────

interface RawTifDistrict {
  number: string;
  name: string;
  approvalDate: string | null;
  expirationDate: string | null;
  sbif: boolean;
  wards: string;
  status: string;
  polygons: TifPolygon[];
}

interface TifFeature {
  geometry: { type?: string; coordinates?: unknown } | null;
  properties: {
    TIF_Number?: string | null;
    District_Name?: string | null;
    Approval_Date?: string | null;
    Expiration_Date?: string | null;
    SBIF?: string | null;
    Wards?: string | null;
    Status?: string | null;
  } | null;
}

/** GeoJSON geometry -> TifPolygon[] (a Polygon becomes a one-element array). */
function geometryToPolygons(geometry: TifFeature["geometry"]): TifPolygon[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return [geometry.coordinates as TifPolygon];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates as TifPolygon[];
  }
  return [];
}

function loadTifDistricts(): RawTifDistrict[] {
  const gj = JSON.parse(readFileSync(TIF_GEOJSON_PATH, "utf8")) as { features?: TifFeature[] };
  // Group by normalized number so a (rare) duplicate number merges into one
  // multipolygon rather than becoming a self-adjacent pair.
  const byNumber = new Map<string, RawTifDistrict>();
  for (const f of gj.features ?? []) {
    const p = f.properties ?? {};
    const number = normalizeTifNumber(p.TIF_Number);
    if (!number) continue;
    const polygons = geometryToPolygons(f.geometry);
    if (polygons.length === 0) continue;
    const existing = byNumber.get(number);
    if (existing) {
      existing.polygons.push(...polygons);
      continue;
    }
    byNumber.set(number, {
      number,
      name: (p.District_Name ?? "").trim() || number,
      approvalDate: p.Approval_Date ?? null,
      expirationDate: p.Expiration_Date ?? null,
      sbif: (p.SBIF ?? "").trim().toUpperCase() === "Y",
      wards: (p.Wards ?? "").trim(),
      status: (p.Status ?? "").trim(),
      polygons,
    });
  }
  return [...byNumber.values()].sort((a, b) => compareTifNumbers(a.number, b.number));
}

// ── Socrata TIF annual report ───────────────────────────────────────────────

interface SodaTifRow {
  tif_number?: string | null;
  report_year?: string | number | null;
  fund_balance?: string | null;
  tax_allocation_fund_balance?: string | null;
  property_tax_increment_current?: string | null;
  distribution_of_surplus?: string | null;
}

async function fetchTifAnnualReport(): Promise<TifAnnualReportRow[]> {
  const params = new URLSearchParams({
    $select:
      "tif_number,report_year,fund_balance,tax_allocation_fund_balance,property_tax_increment_current,distribution_of_surplus",
    $limit: "50000",
  });
  const url = `${TIF_ANNUAL_REPORT_URL}?${params.toString()}`;
  const res = await fetch(url, { headers: socrataHeaders(), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const rows = (await res.json()) as SodaTifRow[];
  const out: TifAnnualReportRow[] = [];
  for (const r of rows) {
    const reportYear = Number(r.report_year);
    if (!Number.isFinite(reportYear)) continue;
    out.push({
      tifNumber: r.tif_number ?? "",
      reportYear: Math.trunc(reportYear),
      fundBalance: toNumOrNull(r.fund_balance),
      taxAllocationFundBalance: toNumOrNull(r.tax_allocation_fund_balance),
      incrementCurrent: toNumOrNull(r.property_tax_increment_current),
      surplusDistributed: toNumOrNull(r.distribution_of_surplus),
    });
  }
  return out;
}

// ── ZIP boundaries (from the committed vacancy index) ───────────────────────

function loadZipBoundaries(): Map<string, [number, number][][]> {
  const out = new Map<string, [number, number][][]>();
  if (!existsSync(VACANCY_INDEX_PATH)) {
    console.warn(`  vacancy-index.json missing at ${VACANCY_INDEX_PATH} — ZIP membership will be empty`);
    return out;
  }
  const data = JSON.parse(readFileSync(VACANCY_INDEX_PATH, "utf8")) as VacancyIndexExport;
  for (const entry of PILOT_ZIPS) {
    const edition = data.editions?.[entry.zip];
    const rings = edition?.boundary?.rings ?? null;
    if (rings && rings.length > 0) out.set(entry.zip, rings as [number, number][][]);
    else console.warn(`  ${entry.zip}: no edition boundary in vacancy-index.json — skipped for TIF membership`);
  }
  return out;
}

function loadSitePointsByZip(): Map<string, { lat: number; lon: number }[]> {
  const out = new Map<string, { lat: number; lon: number }[]>();
  if (!existsSync(VACANCY_INDEX_PATH)) return out;
  const data = JSON.parse(readFileSync(VACANCY_INDEX_PATH, "utf8")) as VacancyIndexExport;
  for (const entry of PILOT_ZIPS) {
    const edition = data.editions?.[entry.zip];
    const pts = (edition?.sitePoints ?? []).map((p) => ({ lat: p.lat, lon: p.lon }));
    out.set(entry.zip, pts);
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TIF funding picture export ===\n");

  console.log("Loading TIF district boundaries (public/data/zones/tif-districts.geojson)...");
  const districts = loadTifDistricts();
  console.log(`  ${districts.length} districts parsed`);

  console.log("\nFetching TIF annual report (Socrata qm7s-3ctt)...");
  const annualRows = await fetchTifAnnualReport();
  const financeByTif = latestFinanceByTif(annualRows);
  console.log(`  ${annualRows.length} report rows -> ${financeByTif.size} districts with a latest-year row`);

  console.log("\nComputing contiguity graph (touching / near ≤60 m)...");
  const contiguity = computeTifContiguity(
    districts.map((d) => ({ number: d.number, polygons: d.polygons })),
  );
  let touchingEdges = 0;
  let nearEdges = 0;
  for (const list of contiguity.values()) {
    for (const n of list) {
      if (n.relation === "touching") touchingEdges += 1;
      else nearEdges += 1;
    }
  }
  console.log(
    `  ${touchingEdges / 2} touching edges, ${nearEdges / 2} near edges ` +
      `(${(touchingEdges + nearEdges) / 2} total adjacencies)`,
  );

  // District briefs (finance joined, neighbors attached).
  const districtBriefs: Record<string, TifDistrictBrief> = {};
  let withFinance = 0;
  let withoutFinance = 0;
  for (const d of districts) {
    const finance = financeByTif.get(d.number) ?? null;
    if (finance) withFinance += 1;
    else withoutFinance += 1;
    districtBriefs[d.number] = {
      number: d.number,
      name: d.name,
      approvalDate: d.approvalDate,
      expirationDate: d.expirationDate,
      sbif: d.sbif,
      wards: d.wards,
      status: d.status,
      finance,
      neighbors: contiguity.get(d.number) ?? [],
    };
  }
  console.log(`  finance rows: ${withFinance} matched, ${withoutFinance} null (render "not yet available")`);

  // ZIP membership + per-district vacant-site counts.
  console.log("\nComputing ZIP membership + vacant-site counts...");
  const zipBoundaries = loadZipBoundaries();
  const sitePointsByZip = loadSitePointsByZip();
  const zips: Record<string, TifZipBrief> = {};
  for (const entry of PILOT_ZIPS) {
    const rings = zipBoundaries.get(entry.zip);
    if (!rings) {
      zips[entry.zip] = { districtNumbers: [], vacantSiteCounts: {} };
      continue;
    }
    const points = sitePointsByZip.get(entry.zip) ?? [];
    const memberNumbers: string[] = [];
    const vacantSiteCounts: Record<string, number> = {};
    for (const d of districts) {
      if (!districtIntersectsZip(d.polygons, rings)) continue;
      memberNumbers.push(d.number);
      vacantSiteCounts[d.number] = countPointsInDistrict(points, d.polygons);
    }
    memberNumbers.sort(compareTifNumbers);
    zips[entry.zip] = { districtNumbers: memberNumbers, vacantSiteCounts };
    const topCount = Math.max(0, ...Object.values(vacantSiteCounts));
    console.log(
      `  ${entry.zip} ${entry.primaryNeighborhood}: ${memberNumbers.length} districts` +
        `${memberNumbers.length > 0 ? ` (top district holds ${topCount} vacant sites)` : ""}`,
    );
  }

  const generatedAt = new Date().toISOString();

  // Canonical key order for the districts object (deterministic serialization).
  const orderedDistricts: Record<string, TifDistrictBrief> = {};
  for (const number of Object.keys(districtBriefs).sort(compareTifNumbers)) {
    orderedDistricts[number] = districtBriefs[number];
  }

  const out: TifBriefsExport = {
    generatedAt,
    sources: {
      tifBoundaries: "Chicago TIF District boundaries (data.cityofchicago.org, Active districts)",
      tifAnnualReport:
        "Chicago TIF Annual Report — Analysis of Special Tax Allocation Fund (Socrata qm7s-3ctt), latest report year per district",
      vacancyIndex: "Explorer Vacancy Opportunity Index edition boundaries + tracked sites (public/data/vacancy-index.json)",
      asOf: generatedAt.slice(0, 10),
    },
    districts: orderedDistricts,
    zips,
  };

  const serialized = JSON.stringify(out, null, 2) + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, serialized);
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`  districts: ${Object.keys(orderedDistricts).length}, ZIPs: ${Object.keys(zips).length}`);

  // Spot-check the worked example (60617) using the same pure view builder the
  // page uses, so the export logs what the report will show.
  const example = buildTifFundingPicture("60617", out, new Date(generatedAt).getUTCFullYear());
  if (example && example.length > 0) {
    const top = example[0];
    console.log(
      `\n  60617 example: ${example.length} districts intersecting; top = ${top.number} ${top.name} ` +
        `(${top.vacantSiteCount} vacant sites, ${top.neighbors.length} neighbors)`,
    );
  } else {
    console.log("\n  60617 example: no intersecting districts (check the edition boundary)");
  }
}

main().catch((err) => {
  console.error("TIF briefs export failed:", err);
  process.exit(1);
});
