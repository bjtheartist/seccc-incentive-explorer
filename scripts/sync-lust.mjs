#!/usr/bin/env node
/**
 * Fetch Illinois EPA Leaking Underground Storage Tank (LUST) incident sites
 * for the City of Chicago and write public/data/zones/lust-sites.geojson for
 * the map's LUST layer — an environmental due-diligence flag alongside the
 * brownfields layer.
 *
 * Source: Illinois EPA geoservices, Land/LeakingUST layer 0 "LustData".
 * https://geoservices.epa.illinois.gov/arcgis/rest/services/Land/LeakingUST/MapServer/0
 *
 * A site with an NFR_NFA date has received a No Further Remediation (NFR)
 * letter and is considered closed; sites without one are still open.
 *
 * Usage: node scripts/sync-lust.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const LUST_QUERY_URL =
  "https://geoservices.epa.illinois.gov/arcgis/rest/services/Land/LeakingUST/MapServer/0/query";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const CHI_BBOX = { xmin: -88.0, ymin: 41.6, xmax: -87.4, ymax: 42.1 };

const OUT_FILE = resolve(process.cwd(), "public/data/zones/lust-sites.geojson");

function titleCase(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bUsa\b/g, "USA")
    .replace(/\bBp\b/g, "BP");
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

/** Page through all Chicago records with OBJECTID-keyed pagination. */
async function fetchLustSites() {
  const all = [];
  let lastOid = -1;
  for (;;) {
    const params = new URLSearchParams({
      where: `UPPER(CITY)='CHICAGO' AND OBJECTID>${lastOid}`,
      outFields: "OBJECTID,INCIDENT,NAME,STREET,CITY,NFR_NFA",
      orderByFields: "OBJECTID ASC",
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "2000",
      f: "json",
    });
    const res = await fetch(`${LUST_QUERY_URL}?${params}`);
    if (!res.ok) throw new Error(`Illinois EPA LUST query failed: HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`Illinois EPA LUST query error: ${JSON.stringify(data.error)}`);
    const page = data.features ?? [];
    if (page.length === 0) break;
    all.push(...page);
    lastOid = page[page.length - 1].attributes.OBJECTID;
    if (!data.exceededTransferLimit && page.length < 2000) break;
  }
  return all;
}

const rows = await fetchLustSites();

const features = rows
  .filter(
    (f) =>
      f.geometry &&
      typeof f.geometry.x === "number" &&
      typeof f.geometry.y === "number" &&
      f.geometry.x >= CHI_BBOX.xmin &&
      f.geometry.x <= CHI_BBOX.xmax &&
      f.geometry.y >= CHI_BBOX.ymin &&
      f.geometry.y <= CHI_BBOX.ymax
  )
  .map((f) => {
    const a = f.attributes;
    const closed = typeof a.NFR_NFA === "number";
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [round5(f.geometry.x), round5(f.geometry.y)],
      },
      properties: {
        name: titleCase(a.NAME) || `LUST Incident ${a.INCIDENT || ""}`.trim(),
        address: titleCase(a.STREET),
        incident: a.INCIDENT || "",
        status: closed ? "Closed (NFR letter issued)" : "Open",
        nfrDate: closed ? new Date(a.NFR_NFA).toISOString().slice(0, 10) : "",
      },
    };
  });

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
const open = features.filter((f) => f.properties.status === "Open").length;
console.log(
  `Wrote ${features.length} LUST sites (${open} open, ${features.length - open} closed) → ${OUT_FILE}`
);
