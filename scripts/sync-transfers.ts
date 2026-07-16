#!/usr/bin/env npx tsx
/**
 * Backfill the property_transfers store for the three SE-Chicago ZIPs via the
 * transfers source adapter (Illinois MyDec / PTAX-203, `it54-y4c6`). Idempotent
 * — safe to re-run (upserts on transfer_id).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-transfers.ts
 */

import { transfersAdapter } from "../lib/ingest/transfers";
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
  console.log("=== Transfers Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}\n`);

  const result = await runIngest(transfersAdapter, { zips: ZIPS });

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
