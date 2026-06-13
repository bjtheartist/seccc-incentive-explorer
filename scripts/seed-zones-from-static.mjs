#!/usr/bin/env node
/**
 * Seed zones-table rows from static GeoJSON files so PostGIS eligibility
 * checks cover the same layers the map shows. Replaces existing rows for
 * each requested key.
 *
 * Usage: node scripts/seed-zones-from-static.mjs <key> [<key> ...]
 *   e.g. node scripts/seed-zones-from-static.mjs ccsa energyCommunities hubzone
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ZONE_FILES = {
  ccsa: "ccsa-corridors.geojson",
  energyCommunities: "energy-communities.geojson",
  hubzone: "hubzone.geojson",
  nof: "nof-corridors.geojson",
};

const keys = process.argv.slice(2).filter((k) => !k.startsWith("-"));
if (keys.length === 0 || keys.some((k) => !ZONE_FILES[k])) {
  console.error(`Usage: seed-zones-from-static.mjs <key> ... (known: ${Object.keys(ZONE_FILES).join(", ")})`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL="?([^"]+)"?$/);
      if (m) process.env.DATABASE_URL = m[1];
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

for (const key of keys) {
  const file = resolve(process.cwd(), "public/data/zones", ZONE_FILES[key]);
  const fc = JSON.parse(readFileSync(file, "utf8"));
  const features = (fc.features ?? []).filter((f) => f.geometry);

  const [{ count: before }] = await sql`SELECT count(*) FROM zones WHERE zone_key = ${key}`;
  await sql`DELETE FROM zones WHERE zone_key = ${key}`;
  for (const f of features) {
    await sql`
      INSERT INTO zones (zone_key, feature_name, feature_properties, geom)
      VALUES (${key}, ${f.properties?.name ?? null}, ${JSON.stringify(f.properties ?? {})},
              ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)})::geography)
    `;
  }
  const [{ count: after }] = await sql`SELECT count(*) FROM zones WHERE zone_key = ${key}`;
  console.log(`${key}: ${before} rows → ${after} rows (from ${ZONE_FILES[key]})`);
}
