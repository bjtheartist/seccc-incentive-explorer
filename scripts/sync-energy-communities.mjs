#!/usr/bin/env node
/**
 * Fetch IRA Energy Community polygons for the Chicago area and write
 * public/data/zones/energy-communities.geojson for the map's energy
 * communities layer.
 *
 * Projects sited in an energy community earn a +10% bonus on the federal
 * clean energy Investment Tax Credit / Production Tax Credit (IRC 48/48E,
 * 45/45Y) under the Inflation Reduction Act. Two geographic categories:
 *   (a) coal closure census tracts (closed coal mine/generator, or adjoining)
 *   (b) MSAs/non-MSAs meeting the fossil fuel employment + unemployment tests
 *
 * Source: DOE National Energy Technology Laboratory (NETL), the authoritative
 * publisher of IRS Notice energy community GIS data. As of June 2026 the 2024
 * vintage remains NETL's most current published GIS release (portal items
 * last refreshed March 2026 still carry the 2024 dataset):
 *   https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_Coal_Closure_Energy_Communities/FeatureServer/0
 *   https://arcgis.netl.doe.gov/server/rest/services/Hosted/2024_MSAs_NonMSAs_that_are_Energy_Communities/FeatureServer/0
 *
 * The entire Chicago-Naperville-Elgin MSA qualifies under (b), so the MSA
 * county polygons blanket the city; everything is clipped to the Chicago
 * bbox to keep the file small.
 *
 * Usage: node scripts/sync-energy-communities.mjs
 */
import { writeFileSync } from "fs";
import { resolve } from "path";

// Chicago bounding box (matches CHI_BOUNDS in components/map/map-helpers.ts)
const BBOX = { west: -88.0, south: 41.6, east: -87.4, north: 42.1 };
const CHI_BBOX = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;

const NETL_BASE = "https://arcgis.netl.doe.gov/server/rest/services/Hosted";

const SERVICES = [
  {
    url: `${NETL_BASE}/2024_Coal_Closure_Energy_Communities/FeatureServer/0/query`,
    category: "coal_closure",
    name: "Coal Closure Energy Community",
    outFields:
      "geoid_tract_2020,county_name,state_name,mine_closure,generator_closure,adjacent_to_closure,dataset_version",
  },
  {
    url: `${NETL_BASE}/2024_MSAs_NonMSAs_that_are_Energy_Communities/FeatureServer/0/query`,
    category: "msa",
    name: "MSA Energy Community",
    outFields:
      "county_name_2020,state_name,msa_area_name,msa_qual,ec_qual_status,dataset_version",
  },
];

const OUT_FILE = resolve(process.cwd(), "public/data/zones/energy-communities.geojson");

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Sutherland-Hodgman clip of one linear ring against the (convex) bbox.
 * Returns a closed ring of [lon, lat] pairs, or null when nothing remains.
 */
function clipRing(ring) {
  const edges = [
    { inside: ([x]) => x >= BBOX.west, x: BBOX.west, axis: 0 },
    { inside: ([x]) => x <= BBOX.east, x: BBOX.east, axis: 0 },
    { inside: ([, y]) => y >= BBOX.south, x: BBOX.south, axis: 1 },
    { inside: ([, y]) => y <= BBOX.north, x: BBOX.north, axis: 1 },
  ];

  let pts = ring;
  // Drop the closing vertex while clipping; re-close at the end.
  if (pts.length > 1) {
    const [f, l] = [pts[0], pts[pts.length - 1]];
    if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
  }

  for (const edge of edges) {
    if (pts.length === 0) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const curIn = edge.inside(cur);
      const prevIn = edge.inside(prev);
      if (curIn !== prevIn) {
        // Intersection of segment prev->cur with the edge line.
        const t =
          edge.axis === 0
            ? (edge.x - prev[0]) / (cur[0] - prev[0])
            : (edge.x - prev[1]) / (cur[1] - prev[1]);
        out.push([
          prev[0] + t * (cur[0] - prev[0]),
          prev[1] + t * (cur[1] - prev[1]),
        ]);
      }
      if (curIn) out.push(cur);
    }
    pts = out;
  }

  if (pts.length < 3) return null;
  const rounded = pts.map(([x, y]) => [round5(x), round5(y)]);
  rounded.push(rounded[0]);
  return rounded;
}

/** Clip a GeoJSON Polygon/MultiPolygon to the bbox. Returns geometry or null. */
function clipGeometry(geometry) {
  const polys =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const clipped = [];
  for (const rings of polys) {
    const outer = clipRing(rings[0]);
    if (!outer) continue;
    const holes = rings.slice(1).map(clipRing).filter(Boolean);
    clipped.push([outer, ...holes]);
  }
  if (clipped.length === 0) return null;
  if (clipped.length === 1) return { type: "Polygon", coordinates: clipped[0] };
  return { type: "MultiPolygon", coordinates: clipped };
}

function coalQualification(a) {
  if (a.mine_closure === "Yes") return "Closed coal mine tract";
  if (a.generator_closure === "Yes") return "Retired coal-fired generator tract";
  if (a.adjacent_to_closure === "Yes") return "Adjoins a coal closure tract";
  return "Coal closure tract";
}

async function fetchLayer({ url, category, name, outFields }) {
  const params = new URLSearchParams({
    geometry: CHI_BBOX,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: "1=1",
    outFields,
    outSR: "4326",
    geometryPrecision: "5",
    resultRecordCount: "2000",
    f: "geojson",
  });

  const res = await fetch(`${url}?${params}`);
  if (!res.ok) throw new Error(`${name} query failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${name} query error: ${JSON.stringify(data.error)}`);

  const features = [];
  for (const f of data.features ?? []) {
    if (!f.geometry) continue;
    const geometry = clipGeometry(f.geometry);
    if (!geometry) continue;
    const a = f.properties ?? {};
    const properties =
      category === "coal_closure"
        ? {
            name,
            category,
            tractGeoid: a.geoid_tract_2020 || "",
            county: [a.county_name, a.state_name].filter(Boolean).join(", "),
            qualification: coalQualification(a),
            vintage: a.dataset_version ? String(a.dataset_version) : "2024",
          }
        : {
            name,
            category,
            county: [a.county_name_2020, a.state_name].filter(Boolean).join(", "),
            msa: a.msa_area_name || "",
            qualification:
              "MSA meets the fossil fuel employment and unemployment-rate tests (clipped to map area)",
            vintage: a.dataset_version ? String(a.dataset_version) : "2024",
          };
    features.push({ type: "Feature", geometry, properties });
  }
  return features;
}

const results = await Promise.all(SERVICES.map(fetchLayer));
const features = results.flat();

const coal = features.filter((f) => f.properties.category === "coal_closure").length;
const msa = features.length - coal;
if (coal === 0 || msa === 0) {
  throw new Error(
    `Unexpected empty category (coal_closure=${coal}, msa=${msa}) — source may have changed.`,
  );
}

const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(
  `Wrote ${features.length} energy community polygons (${coal} coal closure tracts, ${msa} MSA counties) → ${OUT_FILE}`,
);
