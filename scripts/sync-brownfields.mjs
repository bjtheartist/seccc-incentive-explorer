#!/usr/bin/env node
/**
 * Fetch EPA ACRES brownfield sites for the City of Chicago and write
 * public/data/zones/brownfield-sites.geojson for the map's brownfields layer.
 *
 * Source: EPA Facility Registry Service (FRS) ACRES interest layer —
 * brownfield properties tracked in EPA's Assessment, Cleanup and
 * Redevelopment Exchange System.
 * https://geodata.epa.gov/arcgis/rest/services/OEI/FRS_INTERESTS/MapServer/0
 *
 * Usage: node scripts/sync-brownfields.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const ACRES_QUERY_URL =
  "https://geodata.epa.gov/arcgis/rest/services/OEI/FRS_INTERESTS/MapServer/0/query";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const CHI_BBOX = "-88.0,41.6,-87.4,42.1";

const OUT_FILE = resolve(process.cwd(), "public/data/zones/brownfield-sites.geojson");

function titleCase(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bUsa\b/g, "USA");
}

async function fetchAcresSites() {
  const params = new URLSearchParams({
    geometry: CHI_BBOX,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "UPPER(CITY_NAME)='CHICAGO'",
    outFields:
      "REGISTRY_ID,PRIMARY_NAME,LOCATION_ADDRESS,CITY_NAME,POSTAL_CODE,LATITUDE83,LONGITUDE83,PGM_SYS_ID,ACTIVE_STATUS,LAST_REPORTED_DATE,PGM_REPORT_URL,FAC_URL",
    returnGeometry: "false",
    outSR: "4326",
    resultRecordCount: "5000",
    f: "json",
  });

  const res = await fetch(`${ACRES_QUERY_URL}?${params}`);
  if (!res.ok) throw new Error(`EPA FRS query failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`EPA FRS query error: ${JSON.stringify(data.error)}`);
  return data.features ?? [];
}

/** EPA fills empty fields with placeholder text like "no data yet". */
function cleanUrl(v) {
  return v && v.startsWith("http") ? v : "";
}

const rows = await fetchAcresSites();

const features = rows
  .map((f) => f.attributes)
  .filter((a) => typeof a.LATITUDE83 === "number" && typeof a.LONGITUDE83 === "number")
  .map((a) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [a.LONGITUDE83, a.LATITUDE83],
    },
    properties: {
      name: titleCase(a.PRIMARY_NAME),
      address: titleCase(a.LOCATION_ADDRESS),
      zip: a.POSTAL_CODE || "",
      registryId: a.REGISTRY_ID || "",
      acresId: a.PGM_SYS_ID || "",
      activeStatus: a.ACTIVE_STATUS || "",
      lastReported: a.LAST_REPORTED_DATE
        ? new Date(a.LAST_REPORTED_DATE).toISOString().slice(0, 10)
        : "",
      reportUrl: cleanUrl(a.PGM_REPORT_URL) || cleanUrl(a.FAC_URL),
    },
  }));

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(`Wrote ${features.length} brownfield sites → ${OUT_FILE}`);
