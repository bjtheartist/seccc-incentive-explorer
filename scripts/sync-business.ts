#!/usr/bin/env npx tsx
/**
 * Backfill the business_licenses store for the three SE-Chicago ZIPs via the
 * business-licenses source adapter. Idempotent — safe to re-run (upserts on
 * license_id).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-business.ts
 */

import { businessLicensesAdapter } from "../lib/ingest/business-licenses";
import { runIngest } from "../lib/ingest/run";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// SE-Chicago ZIPs only.
const ZIPS = ["60617", "60619", "60649"];

async function main() {
  console.log("=== Business License Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}\n`);

  const result = await runIngest(businessLicensesAdapter, { zips: ZIPS });

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
