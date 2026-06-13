#!/usr/bin/env node
/**
 * Fetch SBA HUBZone designated areas covering Chicago and write
 * public/data/zones/hubzone.geojson for the map's HUBZone layer.
 *
 * Source: the official SBA HUBZone map (maps.certify.sba.gov/hubzone/map)
 * renders a GeoServer at maps.certify.sba.gov/geoserver, which also exposes
 * WFS. The two layers relevant to Chicago are:
 *   - hubzone:qct_e  — Qualified Census Tracts (currently qualified)
 *   - hubzone:qct_r  — Redesignated Census Tracts (formerly qualified,
 *                      still HUBZone-eligible until their expiration date)
 * (qnmc/county and indian-lands layers do not apply inside Cook County.)
 *
 * Features are clipped to the Chicago bounding box via the WFS bbox filter
 * (tracts have no city attribute, so the bbox stands in for a city filter).
 *
 * Usage: node scripts/sync-hubzone.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const WFS_URL = "https://maps.certify.sba.gov/geoserver/hubzone/ows";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts).
// WFS 2.0 with urn:ogc:def:crs:EPSG::4326 expects lat,lon axis order.
const CHI_BBOX_LATLON = "41.6,-88.0,42.1,-87.4,urn:ogc:def:crs:EPSG::4326";

const LAYERS = [
  { typeName: "hubzone:qct_e", category: "qualified", label: "Qualified" },
  { typeName: "hubzone:qct_r", category: "redesignated", label: "Redesignated" },
];

const OUT_FILE = resolve(process.cwd(), "public/data/zones/hubzone.geojson");

const PAGE_SIZE = 1000;

async function fetchLayer({ typeName, category, label }) {
  const features = [];
  for (let startIndex = 0; ; startIndex += PAGE_SIZE) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: typeName,
      outputFormat: "application/json",
      bbox: CHI_BBOX_LATLON,
      count: String(PAGE_SIZE),
      startIndex: String(startIndex),
      // GeoServer requires a stable sort for paging (no primary key on these views)
      sortBy: "tract_fips",
    });
    const res = await fetch(`${WFS_URL}?${params}`);
    if (!res.ok) throw new Error(`${typeName} query failed: HTTP ${res.status}`);
    const data = await res.json();
    const page = data.features ?? [];
    features.push(...page.map((f) => toFeature(f, category, label)));
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`Fetched ${features.length} ${category} tracts from ${typeName}`);
  return features;
}

function roundCoords(coords) {
  if (typeof coords[0] === "number") {
    return [Math.round(coords[0] * 1e5) / 1e5, Math.round(coords[1] * 1e5) / 1e5];
  }
  return coords.map(roundCoords);
}

function toFeature(f, category, label) {
  const p = f.properties ?? {};
  const tract = p.tract_fips || "";
  return {
    type: "Feature",
    geometry: {
      type: f.geometry.type,
      coordinates: roundCoords(f.geometry.coordinates),
    },
    properties: {
      name: `HUBZone ${label} Tract ${tract}`,
      category,
      tractFips: tract,
      county: p.county || "",
      state: p.state || "",
      effective: p.effective ? String(p.effective).slice(0, 10) : "",
      expires: p.expires ? String(p.expires).slice(0, 10) : "",
    },
  };
}

const results = [];
for (const layer of LAYERS) {
  results.push(await fetchLayer(layer));
}
const features = results.flat();

if (features.length === 0) throw new Error("No HUBZone features returned — source may have moved.");

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(`Wrote ${features.length} HUBZone tract polygons → ${OUT_FILE}`);
