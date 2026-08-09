#!/usr/bin/env npx tsx
/**
 * Backfill the Property-Condition domain: building permits, building
 * violations, and 311 service requests. Runs each source adapter via the shared
 * runner. Idempotent — safe to re-run (each adapter upserts on its stable key).
 *
 * ── PRODUCTION HOLD ──
 *
 * THIS SCRIPT WRITES TO WHATEVER `DATABASE_URL` POINTS AT.
 *
 * The citywide permits ingest below has been verified only on a disposable Neon
 * branch. Running it against production is the repo owner's call, not an
 * automated step: point DATABASE_URL at a branch, read the reconciliation the
 * permits adapter prints (retrieved vs the source's own count), and only then
 * decide about prod. Nothing in this repo should run this against prod
 * unattended.
 *
 * ── Scope ──
 *
 * `permits` is now CITYWIDE: the SE-Chicago bounding box is gone and the fetch
 * is bounded only by the issue-date window (see lib/ingest/permits.ts). The
 * `violations` and `requests` adapters are UNCHANGED and still scope to ZIPS —
 * that difference is intentional and is why the ZIP list still exists here.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-condition.ts
 */

import { lastFetchAudit, permitsAdapter } from "../lib/ingest/permits";
import { violationsAdapter } from "../lib/ingest/violations";
import { serviceRequestsAdapter } from "../lib/ingest/service-requests";
import { runIngest } from "../lib/ingest/run";
import type { IngestResult } from "../lib/ingest/types";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

// Scopes the violations + 311 adapters. The permits adapter ignores it and
// fetches citywide.
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
 * Retrieved-vs-source reconciliation for the citywide permits fetch. A fetch
 * that came back short of the source's own count for the identical filter is
 * reported as a SHORTFALL and never silently accepted — a truncated ingest
 * would show up downstream as parcels that "have no permit", which is a claim
 * about the city rather than about the run.
 */
function printPermitFetchAudit() {
  if (!lastFetchAudit) return;
  const { sourceCount, retrieved, distinct, pages } = lastFetchAudit;
  console.log("  ── fetch reconciliation ──");
  console.log(`  Source count (same $where): ${sourceCount ?? "unavailable"}`);
  console.log(`  Retrieved:                  ${retrieved} across ${pages} page(s)`);
  console.log(`  Distinct permit ids:        ${distinct}`);
  if (sourceCount != null && retrieved < sourceCount) {
    console.warn(
      `  SHORTFALL: retrieved ${retrieved} of ${sourceCount} — do NOT treat this run as a complete citywide backfill.`,
    );
  } else if (sourceCount != null) {
    console.log(`  Reconciled: retrieved >= source count.`);
  }
}

async function main() {
  console.log("=== Condition Sync ===\n");
  console.log(`ZIPs (violations + 311 only): ${ZIPS.join(", ")}`);
  console.log("Permits: CITYWIDE (no bounding box)");

  // SYNC_CONDITION_ADAPTERS=violations (csv of permits,violations,requests)
  // lets targeted refreshes skip sources they don't consume — the corridor
  // owners export only reads building_violations.
  const enabled = (process.env.SYNC_CONDITION_ADAPTERS ?? "permits,violations,requests")
    .split(",").map((a) => a.trim());
  if (enabled.includes("permits")) {
    printResult(await runIngest(permitsAdapter, { zips: ZIPS }));
    printPermitFetchAudit();
  }
  if (enabled.includes("violations")) printResult(await runIngest(violationsAdapter, { zips: ZIPS }));
  if (enabled.includes("requests")) printResult(await runIngest(serviceRequestsAdapter, { zips: ZIPS }));

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
