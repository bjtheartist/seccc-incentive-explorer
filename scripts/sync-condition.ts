#!/usr/bin/env npx tsx
/**
 * Backfill the Property-Condition domain for the three SE-Chicago ZIPs:
 * building permits, building violations, and 311 service requests. Runs each
 * source adapter via the shared runner. Idempotent — safe to re-run (each
 * adapter upserts on its stable key).
 *
 * Note: permits/violations have no ZIP column upstream, so those adapters
 * scope by a bounding box covering the three ZIPs; 311 filters by `zip_code`.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-condition.ts
 */

import { permitsAdapter } from "../lib/ingest/permits";
import { violationsAdapter } from "../lib/ingest/violations";
import { serviceRequestsAdapter } from "../lib/ingest/service-requests";
import { runIngest } from "../lib/ingest/run";
import type { IngestResult } from "../lib/ingest/types";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// SE-Chicago ZIPs only.
const ZIPS = ["60617", "60619", "60649"];

function printResult(result: IngestResult) {
  console.log(`\n── ${result.sourceKey} ──`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`Written: ${result.written}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }
}

async function main() {
  console.log("=== Condition Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}`);

  printResult(await runIngest(permitsAdapter, { zips: ZIPS }));
  printResult(await runIngest(violationsAdapter, { zips: ZIPS }));
  printResult(await runIngest(serviceRequestsAdapter, { zips: ZIPS }));

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
