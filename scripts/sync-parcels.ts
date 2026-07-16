#!/usr/bin/env npx tsx
/**
 * Backfill the parcels store for the three SE-Chicago ZIPs via the parcels
 * source adapter. Idempotent — safe to re-run (upserts on PIN).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-parcels.ts
 */

import { parcelsAdapter } from "../lib/ingest/parcels";
import { runIngest } from "../lib/ingest/run";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// SE-Chicago ZIPs only.
const ZIPS = (process.env.SYNC_ZIPS
  ? process.env.SYNC_ZIPS.split(",").map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z))
  : null) ?? ["60617", "60619", "60649"];

async function main() {
  console.log("=== Parcel Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}\n`);

  const result = await runIngest(parcelsAdapter, { zips: ZIPS });

  console.log("\n── Sync Summary ──");
  console.log(`Source:  ${result.sourceKey}`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`Written: ${result.written}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
