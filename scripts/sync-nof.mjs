#!/usr/bin/env node
/**
 * Fetch the official NOF eligible/priority commercial corridors and write
 * public/data/zones/nof-corridors.geojson. If DATABASE_URL is set, also
 * replaces the `nof` rows in the zones table so PostGIS checks use them.
 *
 * Source: City of Chicago DPD's NOF eligibility map (chicago.maps.arcgis.com
 * instant app 27d32392f70945c68d2d008a2808ca5c), which renders these two
 * feature services. NOF grants require the project to sit on an eligible
 * corridor, so corridors — not the census-block backdrop — are the
 * eligibility test.
 *
 * Usage: node scripts/sync-nof.mjs [--no-db]
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

const SERVICES = [
  {
    url: "https://services7.arcgis.com/A03QrhyHnDaUmK0W/arcgis/rest/services/NOF_PriorityCorridor_20241112/FeatureServer/10/query",
    name: "NOF Priority Corridor",
    corridorType: "priority",
  },
  {
    url: "https://services7.arcgis.com/A03QrhyHnDaUmK0W/arcgis/rest/services/NOF_EligibleCorridor_20241112/FeatureServer/10/query",
    name: "NOF Eligible Corridor",
    corridorType: "eligible",
  },
];

const OUT_FILE = resolve(process.cwd(), "public/data/zones/nof-corridors.geojson");

function loadEnvLocal() {
  if (process.env.DATABASE_URL) return;
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^DATABASE_URL="?([^"]+)"?$/);
    if (m) process.env.DATABASE_URL = m[1];
  }
}

async function fetchCorridors({ url, name, corridorType }) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "FID",
    outSR: "4326",
    f: "geojson",
  });
  const res = await fetch(`${url}?${params}`);
  if (!res.ok) throw new Error(`${name} query failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${name} query error: ${JSON.stringify(data.error)}`);
  return (data.features ?? []).map((f, i) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      name: `${name} ${i + 1}`,
      corridorType,
    },
  }));
}

const results = await Promise.all(SERVICES.map(fetchCorridors));
const features = results.flat();
const fc = { type: "FeatureCollection", features };
writeFileSync(OUT_FILE, JSON.stringify(fc));
console.log(`Wrote ${features.length} NOF corridor polygons → ${OUT_FILE}`);

if (process.argv.includes("--no-db")) {
  console.log("--no-db — skipped zones table update.");
  process.exit(0);
}

loadEnvLocal();
if (!process.env.DATABASE_URL) {
  console.log("No DATABASE_URL — skipped zones table update.");
  process.exit(0);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const [{ count: before }] = await sql`SELECT count(*) FROM zones WHERE zone_key = 'nof'`;
await sql`DELETE FROM zones WHERE zone_key = 'nof'`;
for (const f of features) {
  await sql`
    INSERT INTO zones (zone_key, feature_name, feature_properties, geom)
    VALUES ('nof', ${f.properties.name}, ${JSON.stringify(f.properties)},
            ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)})::geography)
  `;
}
const [{ count: after }] = await sql`SELECT count(*) FROM zones WHERE zone_key = 'nof'`;
console.log(`zones table: replaced ${before} nof rows with ${after} corridor polygons.`);
