#!/usr/bin/env npx tsx
/**
 * Export per-parcel ownership-cluster geo points to
 * data/private/owner-clusters-geo.json — the admin-only data source for the
 * ownership-cluster map layer toggle (components/map/MapView.tsx) and the
 * admin-only report ownership panel (components/report/AdminOwnershipPanel.tsx).
 * Served only through the gated /api/owner-file/geo route; NEVER moved into
 * public/ (see data/private/README.md).
 *
 * Sibling to scripts/export-corridor-owners.ts (same clustering CTE, same
 * corridor-metrics doctrine: refreshes run on a disposable Neon branch, then
 * export, then drop the branch — prod DB holds no parcel/ownership data by
 * design). This export additionally carries per-parcel lat/lon so it can be
 * plotted directly, which is exactly why it stays private rather than public
 * like corridor-owners.json: per-parcel points resolve to real street
 * addresses at a glance.
 *
 *   DATABASE_URL="postgresql://..." npx tsx scripts/export-owner-clusters-geo.ts
 *   DATABASE_URL="..." npx tsx scripts/export-owner-clusters-geo.ts --zips=60617,60624
 */

import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOwnerClusterGeoRows, type OwnerClusterGeoRow } from "../lib/corridor-owners";
import { buildOwnerClusterGeoFeatureCollection } from "../lib/owner-cluster-geo";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// Owner Files pilot footprint (PRs #65/#67/#68; matches the 2026-07-16
// nine-ZIP public/data/corridor-owners.json export — see
// scripts/export-corridor-owners.ts's DEFAULT_ZIPS for the original 3-ZIP
// SE-Chicago default this widened from).
const DEFAULT_ZIPS = [
  "60617", "60619", "60649",
  "60624", "60623", "60644",
  "60651", "60621", "60636",
];

// Export depth: same per-ZIP cluster ceiling as export-corridor-owners.ts.
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
  const rowsByZip: Record<string, OwnerClusterGeoRow[]> = {};

  for (const zip of zips) {
    const rows = await fetchOwnerClusterGeoRows(sql, zip, EXPORT_LIMIT);
    rowsByZip[zip] = rows;
    console.log(`${zip}: ${rows.length} parcel rows`);
    if (rows.length === 0) {
      console.warn(`  warning: 0 rows for ${zip} — did the parcel/ownership syncs run on this branch?`);
    }
  }

  const out = buildOwnerClusterGeoFeatureCollection(rowsByZip, new Date().toISOString());
  if (out.meta.skippedNullLatLng > 0) {
    console.warn(`Skipped ${out.meta.skippedNullLatLng} parcel(s) with null lat/lng (counted in meta.skippedNullLatLng).`);
  }

  const outPath = join(process.cwd(), "data", "private", "owner-clusters-geo.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${outPath} (${out.features.length} features)`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
