#!/usr/bin/env npx tsx
/**
 * Backfill the EXEMPTION ANOMALY overlay's source table (parcel_exemptions)
 * for the SYNC_ZIPS footprint. PTAXSIM is PIN-keyed with no ZIP/address column,
 * so this gathers the PIN footprint from the already-ingested branch tables:
 *   • DISTINCT parcels.pin for SYNC_ZIPS (the assessor vacant + building
 *     universe), and
 *   • COLS inventory PINs from vacant_properties (ids of the form `cols-<pin>`),
 * then runs the PTAXSIM adapter over that combined PIN set. Keeping the fetch
 * PIN-scoped keeps the branch table small (never a county-wide read).
 *
 * Requires the parcels sync (and the vacant sync) to have already run for this
 * footprint. Idempotent — the adapter upserts on (pin, tax_year).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-exemptions.ts
 *   SYNC_ZIPS="60617,60619,60649" DATABASE_URL="..." npx tsx scripts/sync-exemptions.ts
 *   PTAXSIM_DB_PATH="/path/to/ptaxsim-2024.0.0.db" DATABASE_URL="..." npx tsx scripts/sync-exemptions.ts
 */

import { neon } from "@neondatabase/serverless";
import { runIngest } from "../lib/ingest/run";
import { exemptionsAdapter } from "../lib/ingest/exemptions";
import { toDigitsOnlyPin } from "../lib/ingest/pin-batch";
import type { IngestResult } from "../lib/ingest/types";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// SE-Chicago ZIPs by default — same convention as sync-distress-overlay.ts.
const ZIPS = (process.env.SYNC_ZIPS
  ? process.env.SYNC_ZIPS.split(",").map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z))
  : null) ?? ["60617", "60619", "60649"];

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

/**
 * DISTINCT parcels.pin for the ZIP footprint (mirrors
 * scripts/sync-distress-overlay.ts). Returns [] (never throws) if `parcels`
 * isn't migrated/synced yet on this branch.
 */
async function distinctParcelPins(zips: string[]): Promise<string[]> {
  const pins = new Set<string>();
  try {
    for (const zip of zips) {
      const rows = (await sql`
        SELECT DISTINCT pin FROM parcels
        WHERE pin IS NOT NULL AND pin <> ''
          AND (zip = ${zip} OR raw_json->>'zip_code' = ${zip} OR address ILIKE ${"%" + zip + "%"})
      `) as { pin: string }[];
      for (const row of rows) pins.add(toDigitsOnlyPin(row.pin));
    }
  } catch (err) {
    console.warn(
      "distinctParcelPins: parcels lookup failed (table likely not migrated/synced on this branch):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
  return Array.from(pins);
}

/**
 * COLS City-Owned Land inventory PINs from vacant_properties, whose ids carry
 * the PIN as `cols-<pin>` (sync-vacant-properties.ts). These are the City land
 * inventory and may not all appear in `parcels`, so they are gathered
 * separately. Returns [] (never throws) if the table is absent on this branch.
 */
async function colsInventoryPins(): Promise<string[]> {
  const pins = new Set<string>();
  try {
    const rows = (await sql`
      SELECT id FROM vacant_properties WHERE id LIKE 'cols-%'
    `) as { id: string }[];
    for (const row of rows) {
      const pin = toDigitsOnlyPin(row.id.slice("cols-".length));
      if (pin.length === 14) pins.add(pin);
    }
  } catch (err) {
    console.warn(
      "colsInventoryPins: vacant_properties lookup failed (table likely not migrated/synced on this branch):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
  return Array.from(pins);
}

async function main() {
  console.log("=== Exemptions Sync (PTAXSIM) ===\n");
  console.log(`ZIPs: ${ZIPS.join(", ")}`);

  const [parcelPins, colsPins] = await Promise.all([distinctParcelPins(ZIPS), colsInventoryPins()]);
  const footprint = new Set<string>([...parcelPins, ...colsPins]);
  const pins = Array.from(footprint);
  console.log(
    `\nPIN footprint: ${pins.length} (${parcelPins.length} from parcels, ${colsPins.length} COLS inventory)`,
  );
  if (pins.length === 0) {
    console.warn("  warning: 0 pins — did the parcels/vacant sync run on this branch for these ZIPs?");
    return;
  }

  const result = await runIngest(exemptionsAdapter, { zips: ZIPS, pins });
  report(result);
  const errCount = Object.keys(result.errors ?? {}).length;
  if (errCount > 0 || result.written < result.fetched) {
    console.error(
      `Exemptions sync INCOMPLETE (written ${result.written} of ${result.fetched}, ${errCount} error(s)) — failing loudly.`,
    );
    process.exit(1);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
