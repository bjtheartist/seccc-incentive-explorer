#!/usr/bin/env node
/**
 * Convert the SECCC Google My Business CSV to businesses.json
 * with pre-computed zone memberships via point-in-polygon.
 *
 * Reads CSV from:
 *   1. data/raw/csv/ (staging folder — preferred)
 *   2. Legacy hardcoded path (fallback)
 *
 * Flags:
 *   --citywide   Use data/processed/zones-citywide/ for zone checking
 *   --diff       Show diff against existing businesses.json before overwriting
 *
 * Usage:
 *   node scripts/convert-businesses.mjs
 *   node scripts/convert-businesses.mjs --citywide
 *   node scripts/convert-businesses.mjs --diff
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import * as turf from "@turf/turf";

const args = process.argv.slice(2);
const useCitywide = args.includes("--citywide");
const showDiff = args.includes("--diff");

// ── Locate the CSV ───────────────────────────────────────────────────

const RAW_CSV_DIR = resolve(process.cwd(), "data/raw/csv");
const LEGACY_CSV =
  "/Users/billyndizeye/Downloads/Spreadsheets/2026/January/details-Southeast Chicago Chamber Members-20260126-143926-990b7083ab63bd2050b45aa0eeb3c599.csv";

function findCSV() {
  // Check data/raw/csv/ for any CSV file
  if (existsSync(RAW_CSV_DIR)) {
    const csvFiles = readdirSync(RAW_CSV_DIR).filter((f) => f.endsWith(".csv"));
    if (csvFiles.length > 0) {
      // Use the most recently modified CSV
      const sorted = csvFiles
        .map((f) => ({ name: f, path: join(RAW_CSV_DIR, f) }))
        .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
      return sorted[0].path;
    }
  }
  // Fall back to legacy path
  if (existsSync(LEGACY_CSV)) return LEGACY_CSV;
  console.error("No CSV found in data/raw/csv/ or at legacy path.");
  console.error("Copy your Google My Business CSV to: data/raw/csv/");
  process.exit(1);
}

const CSV_PATH = findCSV();
console.log(`Reading CSV from: ${CSV_PATH}`);

// ── CSV parser ───────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split("\n");
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => (row[h] = values[idx] || ""));
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Load zone GeoJSON files ──────────────────────────────────────────

const ZONE_DIR = useCitywide
  ? resolve(process.cwd(), "data/processed/zones-citywide")
  : resolve(process.cwd(), "public/data/zones");

// Map of zone key → filename patterns for both clipped and city-wide
const ZONE_DEFS = [
  { key: "tif", patterns: ["tif-districts.geojson", "tif-districts-citywide.geojson"], label: "TIF District" },
  { key: "federalOZ", patterns: ["federal-oz.geojson", "federal-oz-citywide.geojson"], label: "Federal Opportunity Zone" },
  { key: "illinoisOZ", patterns: ["illinois-oz.geojson", "illinois-oz-citywide.geojson"], label: "Illinois Opportunity Zone" },
  { key: "enterprise", patterns: ["enterprise-zones.geojson", "enterprise-zones-citywide.geojson"], label: "Enterprise Zone" },
  { key: "edge", patterns: ["edge-zones.geojson", "edge-zones-citywide.geojson"], label: "EDGE 100% Zone" },
  { key: "rev", patterns: ["rev-zones.geojson", "rev-zones-citywide.geojson"], label: "REV Illinois Bonus Zone" },
  { key: "micro", patterns: ["micro-zones.geojson", "micro-zones-citywide.geojson"], label: "MICRO 100% Zone" },
  { key: "dataCenter", patterns: ["data-center-zones.geojson", "data-center-zones-citywide.geojson"], label: "Data Center Bonus Zone" },
  { key: "ssa", patterns: ["special-service-areas.geojson", "special-service-areas-citywide.geojson"], label: "Special Service Area" },
  { key: "tripleBenefit", patterns: ["triple-benefit-zones.geojson", "triple-benefit-zones-citywide.geojson"], label: "Triple Benefit Zone" },
  { key: "highUnemployment", patterns: ["high-unemployment.geojson", "high-unemployment-citywide.geojson"], label: "High Unemployment Zone" },
];

console.log(`Using zone GeoJSON from: ${ZONE_DIR}`);

const zones = [];
for (const z of ZONE_DEFS) {
  let loaded = false;
  for (const pattern of z.patterns) {
    const p = join(ZONE_DIR, pattern);
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      zones.push({ ...z, features: data.features });
      loaded = true;
      break;
    }
  }
  if (!loaded) {
    console.warn(`  Warning: no GeoJSON found for ${z.label}, skipping zone`);
    zones.push({ ...z, features: [] });
  }
}

// ── Zone checker ─────────────────────────────────────────────────────

function checkZone(lat, lon, zoneFeatures) {
  const pt = turf.point([lon, lat]);
  for (const feature of zoneFeatures) {
    try {
      if (turf.booleanPointInPolygon(pt, feature)) {
        return { inZone: true, zoneName: feature.properties?.name || feature.properties?.Name || "" };
      }
    } catch {
      // Skip invalid geometries
    }
  }
  return { inZone: false, zoneName: "" };
}

// ── Parse CSV ────────────────────────────────────────────────────────

const csv = readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(csv);

console.log(`Loaded ${rows.length} businesses from CSV`);

// Zone membership stats
const zoneStats = {};
ZONE_DEFS.forEach((z) => (zoneStats[z.key] = 0));
let stackingCounts = {};

const businesses = rows.map((row, idx) => {
  const lat = parseFloat(row["Latitude"]);
  const lon = parseFloat(row["Longitude"]);
  const hasCoords = !isNaN(lat) && !isNaN(lon);

  const zoneMembership = {};
  let incentiveCount = 0;

  if (hasCoords) {
    for (const zone of zones) {
      const result = checkZone(lat, lon, zone.features);
      zoneMembership[zone.key] = result.inZone;
      if (result.inZone) {
        incentiveCount++;
        zoneStats[zone.key]++;
      }
      if (result.zoneName) {
        zoneMembership[zone.key + "Name"] = result.zoneName;
      }
    }
  }

  stackingCounts[incentiveCount] = (stackingCounts[incentiveCount] || 0) + 1;

  return {
    id: row["Store code"] || `BIZ_${idx}`,
    name: row["Business name"] || "",
    address: row["Address line 1"] || "",
    city: row["Locality"] || "Chicago",
    state: row["Administrative area"] || "IL",
    zip: row["Postal code"] || "",
    lat: hasCoords ? lat : null,
    lon: hasCoords ? lon : null,
    phone: row["Primary phone"] || "",
    website: row["Website"] || "",
    category: row["Primary category"] || "",
    incentiveCount,
    zones: zoneMembership,
  };
});

// ── Diff against existing data ───────────────────────────────────────

const outputPath = resolve(process.cwd(), "public/data/businesses.json");

if (showDiff && existsSync(outputPath)) {
  const existing = JSON.parse(readFileSync(outputPath, "utf-8"));
  const existingIds = new Set(existing.map((b) => b.id));
  const newIds = new Set(businesses.map((b) => b.id));

  const added = businesses.filter((b) => !existingIds.has(b.id));
  const removed = existing.filter((b) => !newIds.has(b.id));
  const kept = businesses.filter((b) => existingIds.has(b.id));

  console.log("\n--- DIFF vs existing businesses.json ---");
  console.log(`  Existing: ${existing.length} businesses`);
  console.log(`  New CSV:  ${businesses.length} businesses`);
  console.log(`  Added:    ${added.length}`);
  console.log(`  Removed:  ${removed.length}`);
  console.log(`  Kept:     ${kept.length}`);

  if (added.length > 0) {
    console.log("\n  New businesses:");
    for (const b of added.slice(0, 10)) {
      console.log(`    + ${b.name} (${b.address})`);
    }
    if (added.length > 10) console.log(`    ... and ${added.length - 10} more`);
  }

  if (removed.length > 0) {
    console.log("\n  Removed businesses:");
    for (const b of removed.slice(0, 10)) {
      console.log(`    - ${b.name} (${b.address})`);
    }
    if (removed.length > 10) console.log(`    ... and ${removed.length - 10} more`);
  }

  console.log("--- END DIFF ---\n");
}

// ── Write output ─────────────────────────────────────────────────────

writeFileSync(outputPath, JSON.stringify(businesses, null, 2));

console.log(`\nWrote ${businesses.length} businesses to public/data/businesses.json`);
console.log("\nZone Coverage:");
for (const zone of ZONE_DEFS) {
  const count = zoneStats[zone.key];
  const pct = ((count / businesses.length) * 100).toFixed(1);
  console.log(`  ${zone.label}: ${count}/${businesses.length} (${pct}%)`);
}

console.log("\nStacking Distribution:");
for (const [count, num] of Object.entries(stackingCounts).sort(
  (a, b) => Number(a[0]) - Number(b[0])
)) {
  console.log(`  ${count} zones: ${num} businesses`);
}
