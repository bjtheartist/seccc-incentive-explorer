#!/usr/bin/env npx tsx
/**
 * Master pipeline — runs all conversion + seeding steps in order.
 *
 * Steps:
 *   1. Convert city-wide KMLs → GeoJSON  (if KML files exist)
 *   2. Process census data               (fetch from API or local files)
 *   3. Re-process business CSV            (if CSV exists, with --citywide zones)
 *   4. Seed everything to Neon            (zones, businesses, census, stats, assets)
 *   5. Verify row counts + spatial queries
 *   6. Print summary
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-all.ts
 *
 * Flags:
 *   --skip-convert   Skip KML conversion (use existing GeoJSON)
 *   --skip-census    Skip census data pipeline
 *   --skip-csv       Skip business CSV re-processing
 *   --skip-seed      Skip database seeding (just convert)
 */

import { execSync, ExecSyncOptions } from "child_process";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
const args = process.argv.slice(2);

const skipConvert = args.includes("--skip-convert");
const skipCensus = args.includes("--skip-census");
const skipCSV = args.includes("--skip-csv");
const skipSeed = args.includes("--skip-seed");

const ROOT = process.cwd();
const RAW_KML = resolve(ROOT, "data/raw/kml");
const RAW_CSV = resolve(ROOT, "data/raw/csv");
const PROCESSED_ZONES = resolve(ROOT, "data/processed/zones-citywide");

const execOpts: ExecSyncOptions = { stdio: "inherit", cwd: ROOT };

function banner(msg: string) {
  console.log("\n" + "=".repeat(72));
  console.log(` ${msg}`);
  console.log("=".repeat(72) + "\n");
}

function hasFiles(dir: string, ext: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(ext));
}

// ── Step 1: Convert KMLs ────────────────────────────────────────────

function step1_convertKML() {
  banner("Step 1: Convert city-wide KMLs → GeoJSON");

  if (skipConvert) {
    console.log("Skipped (--skip-convert)");
    return;
  }

  if (!hasFiles(RAW_KML, ".kml")) {
    console.log("No KML files in data/raw/kml/ — skipping conversion.");
    console.log("If you have KML files, copy them to data/raw/kml/ first.");

    // Check if city-wide GeoJSON already exists
    if (hasFiles(PROCESSED_ZONES, ".geojson")) {
      console.log("\nExisting city-wide GeoJSON found in data/processed/zones-citywide/ — will use those.");
    }
    return;
  }

  console.log("Running convert-kml-citywide.mjs...");
  execSync("node scripts/convert-kml-citywide.mjs", execOpts);

  // Also regenerate clipped versions for static site fallback
  console.log("\nRunning convert-kml.mjs (SSA #50 clipped)...");
  execSync("node scripts/convert-kml.mjs", execOpts);
}

// ── Step 2: Census data ─────────────────────────────────────────────

async function step2_census() {
  banner("Step 2: Census data pipeline");

  if (skipCensus) {
    console.log("Skipped (--skip-census)");
    return;
  }

  if (!DATABASE_URL) {
    console.log("No DATABASE_URL — skipping census seeding (needs database).");
    return;
  }

  console.log("Running seed-census.ts...");
  execSync(`DATABASE_URL="${DATABASE_URL}" npx tsx scripts/seed-census.ts`, execOpts);

  console.log("\nRunning seed-epa-walkability.ts...");
  execSync(`DATABASE_URL="${DATABASE_URL}" npx tsx scripts/seed-epa-walkability.ts`, execOpts);
}

// ── Step 3: Business CSV ────────────────────────────────────────────

function step3_businesses() {
  banner("Step 3: Process business CSV");

  if (skipCSV) {
    console.log("Skipped (--skip-csv)");
    return;
  }

  const hasCSV = hasFiles(RAW_CSV, ".csv");
  const hasCitywide = hasFiles(PROCESSED_ZONES, ".geojson");

  if (!hasCSV) {
    console.log("No CSV files in data/raw/csv/ — skipping CSV processing.");
    console.log("Existing businesses.json will be used for seeding.");
    return;
  }

  const flags = [];
  if (hasCitywide) {
    flags.push("--citywide");
    console.log("Using city-wide zone GeoJSON for zone membership checking.");
  }
  flags.push("--diff");

  console.log("Running convert-businesses.mjs...");
  execSync(`node scripts/convert-businesses.mjs ${flags.join(" ")}`, execOpts);
}

// ── Step 4: Seed database ───────────────────────────────────────────

function step4_seed() {
  banner("Step 4: Seed Neon database");

  if (skipSeed) {
    console.log("Skipped (--skip-seed)");
    return;
  }

  if (!DATABASE_URL) {
    console.log("No DATABASE_URL — skipping database seeding.");
    console.log("Set DATABASE_URL to seed the Neon database.");
    return;
  }

  const hasCitywide = hasFiles(PROCESSED_ZONES, ".geojson");
  const flags = hasCitywide ? "--citywide" : "";

  console.log(`Running seed-db.ts ${flags}...`);
  execSync(`DATABASE_URL="${DATABASE_URL}" npx tsx scripts/seed-db.ts ${flags}`, execOpts);
}

// ── Step 5: Verify ──────────────────────────────────────────────────

async function step5_verify() {
  banner("Step 5: Verify database");

  if (!DATABASE_URL || skipSeed) {
    console.log("Skipped (no DATABASE_URL or --skip-seed)");
    return;
  }

  const sql = neon(DATABASE_URL);

  console.log("Row counts:");

  const tables = ["businesses", "programs", "zones", "census_tracts", "community_assets", "stats"];
  for (const table of tables) {
    try {
      const [result] = await sql([`SELECT COUNT(*) as count FROM ${table}`] as unknown as TemplateStringsArray);
      const label = table.padEnd(18);
      console.log(`  ${label} ${result.count} rows`);
    } catch {
      console.log(`  ${table.padEnd(18)} (table missing or error)`);
    }
  }

  // Spatial query test — downtown Chicago
  console.log("\nSpatial query test (downtown Chicago: 41.8781, -87.6298):");
  try {
    const zones = await sql`
      SELECT zone_key, feature_name
      FROM zones
      WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(-87.6298, 41.8781), 4326)::geography,
        100
      )
    `;
    if (zones.length > 0) {
      console.log(`  Found ${zones.length} zones at downtown:`);
      for (const z of zones) {
        console.log(`    ${z.zone_key}: ${z.feature_name || "(unnamed)"}`);
      }
    } else {
      console.log("  No zones found at downtown (may be expected for SSA-clipped data)");
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.log(`  Spatial query failed: ${err.message}`);
  }

  // Census query test
  try {
    const census = await sql`
      SELECT tract_id, median_income, population
      FROM census_tracts
      WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(-87.577, 41.744), 4326)::geography,
        500
      )
      LIMIT 3
    `;
    if (census.length > 0) {
      console.log(`\nCensus test (SE Chicago: 41.744, -87.577):`);
      for (const c of census) {
        console.log(`    Tract ${c.tract_id}: income=$${c.median_income?.toLocaleString() || "N/A"}, pop=${c.population?.toLocaleString() || "N/A"}`);
      }
    } else {
      console.log("\n  No census tracts found (may need to run seed-census.ts)");
    }
  } catch {
    console.log("\n  Census query skipped (table may be empty)");
  }
}

// ── Step 6: Summary ─────────────────────────────────────────────────

function step6_summary() {
  banner("Summary");

  console.log("Pipeline steps completed:");
  console.log(`  1. KML conversion:    ${skipConvert ? "SKIPPED" : "DONE"}`);
  console.log(`  2. Census pipeline:   ${skipCensus ? "SKIPPED" : "DONE"}`);
  console.log(`  3. Business CSV:      ${skipCSV ? "SKIPPED" : "DONE"}`);
  console.log(`  4. Database seeding:  ${skipSeed ? "SKIPPED" : DATABASE_URL ? "DONE" : "SKIPPED (no DB)"}`);
  console.log(`  5. Verification:      ${skipSeed || !DATABASE_URL ? "SKIPPED" : "DONE"}`);

  console.log("\nNext steps:");
  console.log("  - Test: npm run build");
  console.log("  - Test: curl http://localhost:3000/api/zones/check?lat=41.88&lon=-87.63");
  console.log("  - Test: curl http://localhost:3000/api/census?lat=41.744&lon=-87.577");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  banner("SECCC Data Pipeline — Full Run");

  console.log("Configuration:");
  console.log(`  DATABASE_URL: ${DATABASE_URL ? "set" : "NOT SET"}`);
  console.log(`  KML files:    ${hasFiles(RAW_KML, ".kml") ? "found in data/raw/kml/" : "none"}`);
  console.log(`  CSV files:    ${hasFiles(RAW_CSV, ".csv") ? "found in data/raw/csv/" : "none"}`);
  console.log(`  City-wide:    ${hasFiles(PROCESSED_ZONES, ".geojson") ? "GeoJSON exists" : "not yet generated"}`);

  step1_convertKML();
  await step2_census();
  step3_businesses();
  step4_seed();
  await step5_verify();
  step6_summary();
}

main().catch((err) => {
  console.error("\nPipeline failed:", err);
  process.exit(1);
});
