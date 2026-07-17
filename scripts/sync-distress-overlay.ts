#!/usr/bin/env npx tsx
/**
 * Backfill the Phase-2 Distress Overlay domain for the SYNC_ZIPS footprint:
 * vacant-building violations (bbox-scoped, mirrors sync-condition.ts) and the
 * two Cook County Treasurer tax-sale datasets (PIN-scoped — see
 * lib/ingest/pin-batch.ts). Runs each source adapter via the shared runner.
 * Idempotent — safe to re-run (each adapter upserts on its stable key).
 *
 * Requires the parcels sync to have already run for this footprint: the two
 * tax-sale adapters are PIN-keyed with no ZIP/address column upstream, so
 * this script reads `SELECT DISTINCT pin FROM parcels` for SYNC_ZIPS and
 * passes that list as `opts.pins`.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-distress-overlay.ts
 *   SYNC_ZIPS="60617,60619,60649" DATABASE_URL="..." npx tsx scripts/sync-distress-overlay.ts
 *   SYNC_DISTRESS_ADAPTERS="scavenger,annual" DATABASE_URL="..." npx tsx scripts/sync-distress-overlay.ts
 */

import { neon } from "@neondatabase/serverless";
import { vacantBuildingViolationsAdapter } from "../lib/ingest/vacant-building-violations";
import { scavengerSaleAdapter } from "../lib/ingest/scavenger-sale";
import { annualTaxSaleAdapter } from "../lib/ingest/annual-tax-sale";
import { runIngest } from "../lib/ingest/run";
import type { IngestResult } from "../lib/ingest/types";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// SE-Chicago ZIPs by default — same convention as sync-condition.ts.
const ZIPS = (process.env.SYNC_ZIPS
  ? process.env.SYNC_ZIPS.split(",").map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z))
  : null) ?? ["60617", "60619", "60649"];

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

/**
 * DISTINCT parcels.pin for the ZIP footprint, using the same
 * zip/raw_json/address matching fetchOwnerClusters uses to cluster parcels
 * by ZIP. Returns [] (never throws) if `parcels` isn't migrated/synced yet
 * on this branch — the tax-sale adapters degrade to a 0-fetched no-op.
 */
async function distinctPinsForZips(zips: string[]): Promise<string[]> {
  const pins = new Set<string>();
  try {
    for (const zip of zips) {
      const rows = (await sql`
        SELECT DISTINCT pin FROM parcels
        WHERE pin IS NOT NULL AND pin <> ''
          AND (zip = ${zip} OR raw_json->>'zip_code' = ${zip} OR address ILIKE ${"%" + zip + "%"})
      `) as { pin: string }[];
      for (const row of rows) pins.add(row.pin);
    }
  } catch (err) {
    console.warn(
      "distinctPinsForZips: parcels lookup failed (table likely not migrated/synced on this branch):",
      err instanceof Error ? err.message : err
    );
    return [];
  }
  return Array.from(pins);
}

async function main() {
  console.log("=== Distress Overlay Sync ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}`);

  // SYNC_DISTRESS_ADAPTERS=scavenger,annual (csv of
  // vacant-violations,scavenger,annual) lets targeted refreshes skip
  // sources they don't need — mirrors SYNC_CONDITION_ADAPTERS.
  const enabled = (process.env.SYNC_DISTRESS_ADAPTERS ?? "vacant-violations,scavenger,annual")
    .split(",").map((a) => a.trim());

  if (enabled.includes("vacant-violations")) {
    printResult(await runIngest(vacantBuildingViolationsAdapter, { zips: ZIPS }));
  }

  if (enabled.includes("scavenger") || enabled.includes("annual")) {
    const pins = await distinctPinsForZips(ZIPS);
    console.log(`\nDistinct parcel PINs in footprint: ${pins.length}`);
    if (pins.length === 0) {
      console.warn("  warning: 0 pins — did the parcels sync run on this branch for these ZIPs?");
    }
    if (enabled.includes("scavenger")) {
      printResult(await runIngest(scavengerSaleAdapter, { zips: ZIPS, pins }));
    }
    if (enabled.includes("annual")) {
      printResult(await runIngest(annualTaxSaleAdapter, { zips: ZIPS, pins }));
    }
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
