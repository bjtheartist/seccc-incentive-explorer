#!/usr/bin/env npx tsx
/**
 * Export Owner & Operator clusters to public/data/corridor-owners.json as a
 * ZIP-keyed map served by /api/corridor/owners when the request-time
 * database has no parcel data (prod, by design — corridor-metrics doctrine).
 *
 * Run against a refresh branch that has the domain migrations plus parcel /
 * ownership-enrichment / transfer / business syncs applied:
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/export-corridor-owners.ts
 *   DATABASE_URL="..." npx tsx scripts/export-corridor-owners.ts --zips=60617,60619
 */

import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOwnerClusters, type OwnerClustersExport } from "../lib/corridor-owners";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// SE-Chicago footprint ZIPs, same default as sync-parcels.ts.
const DEFAULT_ZIPS = ["60617", "60619", "60649"];

// Export depth: the report UI requests up to 50; the API caps limit at 100.
const EXPORT_LIMIT = 100;

const zipsArg = process.argv.find((arg) => arg.startsWith("--zips="));
const zips = zipsArg
  ? zipsArg
      .slice("--zips=".length)
      .split(",")
      .map((z) => z.trim())
      .filter((z) => /^\d{5}$/.test(z))
  : DEFAULT_ZIPS;

if (zips.length === 0) {
  console.error("No valid 5-digit ZIPs given via --zips=");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  const out: OwnerClustersExport = {
    generatedAt: new Date().toISOString(),
    zips: {},
  };

  for (const zip of zips) {
    const clusters = await fetchOwnerClusters(sql, zip, EXPORT_LIMIT);
    out.zips[zip] = clusters;
    console.log(`${zip}: ${clusters.length} clusters`);
    if (clusters.length === 0) {
      console.warn(`  warning: 0 clusters for ${zip} — did the parcel/ownership syncs run on this branch?`);
    }
  }

  const outPath = join(process.cwd(), "public", "data", "corridor-owners.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
