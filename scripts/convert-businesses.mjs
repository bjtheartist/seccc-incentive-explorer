#!/usr/bin/env node
/**
 * Convert the SECCC Google My Business CSV to businesses.json
 * with pre-computed zone memberships via point-in-polygon.
 */
import { readFileSync, writeFileSync } from "fs";
import * as turf from "@turf/turf";

const CSV_PATH =
  "/Users/billyndizeye/Downloads/Spreadsheets/2026/January/details-Southeast Chicago Chamber Members-20260126-143926-990b7083ab63bd2050b45aa0eeb3c599.csv";

// Parse CSV (simple parser — handles quoted fields)
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

// Load zone GeoJSON files
const ZONE_FILES = [
  { key: "tif", file: "public/data/zones/tif-districts.geojson", label: "TIF District" },
  { key: "federalOZ", file: "public/data/zones/federal-oz.geojson", label: "Federal Opportunity Zone" },
  { key: "illinoisOZ", file: "public/data/zones/illinois-oz.geojson", label: "Illinois Opportunity Zone" },
  { key: "enterprise", file: "public/data/zones/enterprise-zones.geojson", label: "Enterprise Zone" },
  { key: "edge", file: "public/data/zones/edge-zones.geojson", label: "EDGE 100% Zone" },
  { key: "rev", file: "public/data/zones/rev-zones.geojson", label: "REV Illinois Bonus Zone" },
  { key: "micro", file: "public/data/zones/micro-zones.geojson", label: "MICRO 100% Zone" },
  { key: "dataCenter", file: "public/data/zones/data-center-zones.geojson", label: "Data Center Bonus Zone" },
  { key: "ssa", file: "public/data/zones/special-service-areas.geojson", label: "Special Service Area" },
  { key: "tripleBenefit", file: "public/data/zones/triple-benefit-zones.geojson", label: "Triple Benefit Zone" },
  { key: "highUnemployment", file: "public/data/zones/high-unemployment.geojson", label: "High Unemployment Zone" },
];

const zones = ZONE_FILES.map((z) => {
  const data = JSON.parse(readFileSync(z.file, "utf-8"));
  return { ...z, features: data.features };
});

// Check if a point is in any feature of a zone
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

// Parse CSV
const csv = readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(csv);

console.log(`Loaded ${rows.length} businesses from CSV`);

// Zone membership stats
const zoneStats = {};
ZONE_FILES.forEach((z) => (zoneStats[z.key] = 0));
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

writeFileSync(
  "public/data/businesses.json",
  JSON.stringify(businesses, null, 2)
);

console.log(`\nWrote ${businesses.length} businesses to public/data/businesses.json`);
console.log("\nZone Coverage:");
for (const zone of ZONE_FILES) {
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
