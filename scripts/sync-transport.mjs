#!/usr/bin/env node
/**
 * Build public/data/transport-network.geojson — expressway and freight rail
 * lines used to compute logistics access (distance to highways/rail/airports)
 * in the map's Location Snapshot.
 *
 * Sources:
 * - Expressways: City of Chicago street centerlines, CLASS='1'
 *   (Kennedy, Dan Ryan, Eisenhower, Stevenson, Skyway, Lake Shore, etc.)
 * - Freight rail: FRA North American Rail Network main lines (NET='M')
 *   clipped to the Chicago bounding box
 *
 * Usage: node scripts/sync-transport.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

const OUT_FILE = resolve(process.cwd(), "public/data/transport-network.geojson");

const CENTERLINE_QUERY_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Centerline/MapServer/0/query";
const RAIL_QUERY_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const CHI_BBOX = "-88.0,41.6,-87.4,42.1";

const EXPRESSWAY_NAMES = {
  "KENNEDY": "Kennedy Expy (I-90/94)",
  "DAN RYAN": "Dan Ryan Expy (I-90/94)",
  "DAN RYAN EXPRESS": "Dan Ryan Expy (I-90/94)",
  "EISENHOWER": "Eisenhower Expy (I-290)",
  "STEVENSON": "Stevenson Expy (I-55)",
  "EDENS": "Edens Expy (I-94)",
  "BISHOP FORD": "Bishop Ford Fwy (I-94)",
  "CHICAGO SKYWAY": "Chicago Skyway (I-90)",
  "LAKE SHORE": "DuSable Lake Shore Dr",
  "KENNEDY EXPRESS": "Kennedy Expy (I-90/94)",
  "I57": "I-57",
  "I94": "I-94",
  "I190": "I-190 (O'Hare)",
  "I294": "Tri-State Tollway (I-294)",
};

const RAIL_OWNER_NAMES = {
  BNSF: "BNSF Railway",
  UP: "Union Pacific",
  CSXT: "CSX",
  NS: "Norfolk Southern",
  CN: "Canadian National",
  GTC: "Canadian National",
  IC: "Canadian National",
  WC: "Canadian National",
  EJE: "Canadian National",
  CPKC: "CPKC",
  CPRS: "CPKC",
  SOO: "CPKC",
  IHB: "Indiana Harbor Belt",
  BRC: "Belt Railway of Chicago",
  METX: "Metra",
  NIRC: "Metra",
  NICD: "South Shore Line",
  CSS: "South Shore Line",
  AMTK: "Amtrak",
  CRL: "Chicago Rail Link",
  SCIH: "South Chicago & Indiana Harbor",
  CTM: "Chicago Terminal",
  MJ: "Manufacturers' Junction",
};

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function round5(coords) {
  if (typeof coords[0] === "number") return coords.map((n) => Math.round(n * 1e5) / 1e5);
  return coords.map(round5);
}

/** Flatten MultiLineStrings into LineString features and round coordinates. */
function toLineFeatures(geojson, makeProps) {
  const out = [];
  for (const f of geojson.features ?? []) {
    const props = makeProps(f.properties || {});
    const geom = f.geometry;
    if (!geom) continue;
    const lines = geom.type === "MultiLineString" ? geom.coordinates : [geom.coordinates];
    for (const line of lines) {
      if (!line || line.length < 2) continue;
      out.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: round5(line) },
        properties: props,
      });
    }
  }
  return out;
}

async function arcgisQuery(url, params) {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
  if (!res.ok) throw new Error(`${url} failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${url} error: ${JSON.stringify(data.error)}`);
  return data;
}

async function fetchExpressways() {
  const data = await arcgisQuery(CENTERLINE_QUERY_URL, {
    where: "CLASS='1'",
    outFields: "STREET_NAME",
    outSR: "4326",
    f: "geojson",
  });
  return toLineFeatures(data, (p) => ({
    kind: "expressway",
    name: EXPRESSWAY_NAMES[p.STREET_NAME] || titleCase(p.STREET_NAME),
  }));
}

async function fetchRail() {
  const features = [];
  let offset = 0;
  for (;;) {
    const data = await arcgisQuery(RAIL_QUERY_URL, {
      geometry: CHI_BBOX,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      where: "NET='M'",
      outFields: "RROWNER1",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: "2000",
      f: "geojson",
    });
    const page = toLineFeatures(data, (p) => ({
      kind: "rail",
      name: RAIL_OWNER_NAMES[p.RROWNER1] || p.RROWNER1 || "Freight rail",
    }));
    features.push(...page);
    if (!(data.features?.length === 2000)) break;
    offset += 2000;
  }
  return features;
}

const [expressways, rail] = await Promise.all([fetchExpressways(), fetchRail()]);
const fc = { type: "FeatureCollection", features: [...expressways, ...rail] };
const json = JSON.stringify(fc);
writeFileSync(OUT_FILE, json);
console.log(
  `Wrote ${expressways.length} expressway + ${rail.length} rail segments ` +
  `(${(json.length / 1024 / 1024).toFixed(1)} MB) → ${OUT_FILE}`
);
