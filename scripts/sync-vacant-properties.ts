#!/usr/bin/env npx tsx
/**
 * Sync vacant properties from Chicago's City-Owned Land Inventory (Socrata).
 * Upserts into vacant_properties table, cross-references against zone geometries,
 * and generates a static GeoJSON fallback file.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-vacant-properties.ts
 */

import { neon } from "@neondatabase/serverless";
import { socrataHeaders } from "../lib/socrata";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// City-Owned Land Inventory — Socrata dataset
const COLS_DATASET_ID = "aksk-kvfp";
const COLS_BASE_URL = `https://data.cityofchicago.org/resource/${COLS_DATASET_ID}.json`;

interface ColsRecord {
  pin: string;
  address: string;
  dir?: string;
  street?: string;
  type?: string;
  property_name?: string;
  managing_organization?: string;
  ward?: string;
  community_area_name?: string;
  community_area_number?: string;
  zoning_classification?: string;
  sq_ft?: string;
  latitude?: string;
  longitude?: string;
}

async function fetchAllPages(): Promise<ColsRecord[]> {
  const all: ColsRecord[] = [];
  const pageSize = 1000;
  let offset = 0;

  console.log("Fetching City-Owned Land Inventory...");

  while (true) {
    const url = `${COLS_BASE_URL}?$limit=${pageSize}&$offset=${offset}&$order=pin`;
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`Socrata returned ${res.status} at offset ${offset}`);
      break;
    }

    const page: ColsRecord[] = await res.json();
    if (page.length === 0) break;

    all.push(...page);
    console.log(`  Fetched ${all.length} records (offset ${offset})...`);
    offset += pageSize;
  }

  return all;
}

function normalizeRecord(r: ColsRecord): {
  id: string;
  address: string;
  lat: number;
  lon: number;
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
} | null {
  const lat = r.latitude ? parseFloat(r.latitude) : NaN;
  const lon = r.longitude ? parseFloat(r.longitude) : NaN;

  if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return null;
  // Basic Chicago bounds check
  if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

  const address =
    r.address ||
    [r.dir, r.street, r.type].filter(Boolean).join(" ") ||
    "Unknown";

  return {
    id: `cols-${r.pin || `${lat.toFixed(6)}-${lon.toFixed(6)}`}`,
    address,
    lat,
    lon,
    ward: r.ward || null,
    communityArea: r.community_area_name || null,
    zoningClass: r.zoning_classification || null,
    squareFeet: r.sq_ft ? parseFloat(r.sq_ft) : null,
  };
}

async function upsertBatch(
  records: NonNullable<ReturnType<typeof normalizeRecord>>[]
) {
  if (records.length === 0) return;

  // Upsert in batches of 50
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const r of batch) {
      await sql`
        INSERT INTO vacant_properties (id, source, address, lat, lon, property_type, ward, community_area, zoning_class, square_feet, status, geom, updated_at)
        VALUES (
          ${r.id},
          'cols',
          ${r.address},
          ${r.lat},
          ${r.lon},
          'vacant_land',
          ${r.ward},
          ${r.communityArea},
          ${r.zoningClass},
          ${r.squareFeet},
          'city_owned',
          ST_MakePoint(${r.lon}, ${r.lat})::geography,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          address = EXCLUDED.address,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          ward = EXCLUDED.ward,
          community_area = EXCLUDED.community_area,
          zoning_class = EXCLUDED.zoning_class,
          square_feet = EXCLUDED.square_feet,
          status = EXCLUDED.status,
          geom = EXCLUDED.geom,
          updated_at = NOW()
      `;
    }

    if ((i + batchSize) % 200 === 0 || i + batchSize >= records.length) {
      console.log(`  Upserted ${Math.min(i + batchSize, records.length)}/${records.length}`);
    }
  }
}

async function crossReferenceZones() {
  console.log("\nCross-referencing against zone geometries...");

  // For each vacant property, find all zones that contain its point
  const result = await sql`
    UPDATE vacant_properties vp
    SET
      zone_matches = COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('zoneKey', z.zone_key, 'zoneName', COALESCE(z.feature_name, z.zone_key)))
          FROM zones z
          WHERE ST_Intersects(z.geom, vp.geom)
        ),
        '[]'::jsonb
      ),
      incentive_count = COALESCE(
        (
          SELECT COUNT(*)::integer
          FROM zones z
          WHERE ST_Intersects(z.geom, vp.geom)
        ),
        0
      )
    WHERE TRUE
    RETURNING id
  `;

  const withIncentives = await sql`
    SELECT COUNT(*) as cnt FROM vacant_properties WHERE incentive_count > 0
  `;

  console.log(`  Updated ${result.length} properties`);
  console.log(`  ${withIncentives[0]?.cnt || 0} properties have incentive zone matches`);
}

async function generateStaticFile() {
  console.log("\nGenerating static GeoJSON fallback...");

  const rows = await sql`
    SELECT id, source, address, lat, lon, property_type, ward, community_area,
           zoning_class, square_feet, status, zone_matches, incentive_count
    FROM vacant_properties
    ORDER BY incentive_count DESC
    LIMIT 2000
  `;

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.lon, r.lat],
      },
      properties: {
        id: r.id,
        source: r.source,
        address: r.address,
        propertyType: r.property_type,
        ward: r.ward,
        communityArea: r.community_area,
        zoningClass: r.zoning_class,
        squareFeet: r.square_feet,
        status: r.status,
        zoneMatches: typeof r.zone_matches === "string"
          ? JSON.parse(r.zone_matches)
          : r.zone_matches,
        incentiveCount: r.incentive_count,
      },
    })),
  };

  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "vacant-properties.json");
  writeFileSync(outPath, JSON.stringify(geojson));
  console.log(`  Wrote ${geojson.features.length} features to ${outPath}`);
}

async function printSummary() {
  const total = await sql`SELECT COUNT(*) as cnt FROM vacant_properties`;
  const withIncentives = await sql`SELECT COUNT(*) as cnt FROM vacant_properties WHERE incentive_count > 0`;
  const byType = await sql`
    SELECT property_type, COUNT(*) as cnt
    FROM vacant_properties
    GROUP BY property_type
    ORDER BY cnt DESC
  `;

  console.log("\n── Sync Summary ──");
  console.log(`Total properties: ${total[0]?.cnt || 0}`);
  console.log(`With incentive zones: ${withIncentives[0]?.cnt || 0}`);
  console.log("By type:");
  for (const row of byType) {
    console.log(`  ${row.property_type}: ${row.cnt}`);
  }
}

async function main() {
  console.log("=== Vacant Property Sync ===\n");

  // 1. Fetch from Socrata
  const raw = await fetchAllPages();
  console.log(`\nTotal raw records: ${raw.length}`);

  // 2. Normalize
  const normalized = raw
    .map(normalizeRecord)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(`Valid records with coordinates: ${normalized.length}`);

  // 3. Upsert
  console.log("\nUpserting into database...");
  await upsertBatch(normalized);

  // 4. Cross-reference zones
  await crossReferenceZones();

  // 5. Generate static file
  await generateStaticFile();

  // 6. Summary
  await printSummary();

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
