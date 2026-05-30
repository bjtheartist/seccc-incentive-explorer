#!/usr/bin/env npx tsx
/**
 * Backfill the ownership domain (sales + valuation history) for the three
 * SE-Chicago ZIPs. Scope is the PIN set already in `parcels`. Idempotent —
 * both adapters append-only via ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-ownership.ts
 */

import { runIngest } from "../lib/ingest/run";
import { salesAdapter } from "../lib/ingest/sales";
import { valuationHistoryAdapter } from "../lib/ingest/valuation-history";
import type { IngestResult } from "../lib/ingest/types";

function report(result: IngestResult) {
  console.log(`\n── ${result.sourceKey} ──`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`Written: ${result.written}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// SE-Chicago ZIPs only.
const ZIPS = ["60617", "60619", "60649"];

async function main() {
  console.log("=== Ownership Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}\n`);

  const sales = await runIngest(salesAdapter, { zips: ZIPS });
  report(sales);

  const valuations = await runIngest(valuationHistoryAdapter, { zips: ZIPS });
  report(valuations);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
