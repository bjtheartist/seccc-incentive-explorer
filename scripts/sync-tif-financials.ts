#!/usr/bin/env npx tsx
/**
 * Sync TIF financial data from the Chicago Data Portal.
 *
 * Sources:
 *   qm7s-3ctt — TIF Annual Report Analysis of Special Tax Allocation Fund
 *   fpsv-qjg3 — TIF Projection / Expiration data
 *
 * Produces TWO outputs:
 *   1. static export → public/data/tif-financials.json   (always runs)
 *   2. optional DB upsert → tif_financials table         (only when DATABASE_URL set)
 *
 * DO NOT point DATABASE_URL at production without explicit approval.
 * Use a disposable Neon branch for testing.
 *
 * Usage (static export only — safe, no DB required):
 *   npx tsx scripts/sync-tif-financials.ts
 *
 * Usage (with DB):
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-tif-financials.ts
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tifFinancialsAdapter, type TifFinancialsRow } from "../lib/ingest/tif-financials";
import { runIngest } from "../lib/ingest/run";

// ── paths ─────────────────────────────────────────────────────────────────────

// __dirname equivalent for ESM / tsx
const REPO_ROOT = join(import.meta.dirname ?? __dirname, "..");
const STATIC_OUT = join(REPO_ROOT, "public", "data", "tif-financials.json");

// ── static export helper ──────────────────────────────────────────────────────

/**
 * Public/data static export schema.
 *
 * Keyed by tif_number (e.g. "T-087") for O(1) lookups by the address-report
 * engine. Each entry strips raw_json to keep the file lean.
 */
interface TifFinancialsExportEntry {
  tifNumber: string;
  tifName: string | null;
  latestReportYear: number | null;
  latestFundBalance: number | null;
  latestTaxAllocationFundBalance: number | null;
  latestPropertyTaxIncrement: number | null;
  latestTotalExpenditure: number | null;
  latestSurplusDeficit: number | null;
  latestAmountDesignatedProjectCosts: number | null;
  expirationDate: string | null;
  expirationYear: number | null;
  expiresWithin24Months: boolean;
  projectedBalances: Record<string, number> | null;
  source: string;
  exportedAt: string;
}

interface TifFinancialsExport {
  exportedAt: string;
  sourceDatasets: { id: string; name: string; url: string }[];
  rowCount: number;
  districts: Record<string, TifFinancialsExportEntry>;
}

function toExportEntry(
  row: TifFinancialsRow,
  exportedAt: string
): TifFinancialsExportEntry {
  return {
    tifNumber: row.tifNumber,
    tifName: row.tifName,
    latestReportYear: row.latestReportYear,
    latestFundBalance: row.latestFundBalance,
    latestTaxAllocationFundBalance: row.latestTaxAllocationFundBalance,
    latestPropertyTaxIncrement: row.latestPropertyTaxIncrement,
    latestTotalExpenditure: row.latestTotalExpenditure,
    latestSurplusDeficit: row.latestSurplusDeficit,
    latestAmountDesignatedProjectCosts: row.latestAmountDesignatedProjectCosts,
    expirationDate: row.expirationDate,
    expirationYear: row.expirationYear,
    expiresWithin24Months: row.expiresWithin24Months,
    projectedBalances: row.projectedBalances,
    source: row.provenance.source,
    exportedAt,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== TIF Financials Sync ===\n");
  console.log(
    "Sources: qm7s-3ctt (annual analysis) + fpsv-qjg3 (projections)\n"
  );

  // ── 1. Fetch + normalize (no DB involved yet) ────────────────────────────
  console.log("Fetching from Chicago Data Portal...");
  let rawInputs;
  try {
    rawInputs = await tifFinancialsAdapter.fetch({ zips: [] });
  } catch (err) {
    console.error("Fetch failed:", err);
    process.exit(1);
  }
  console.log(`  Fetched ${rawInputs.length} combined district entries`);

  const rows: TifFinancialsRow[] = [];
  let skipped = 0;
  for (const raw of rawInputs) {
    const row = tifFinancialsAdapter.normalize(raw);
    if (row === null) {
      skipped++;
    } else {
      rows.push(row);
    }
  }
  console.log(
    `  Normalized: ${rows.length} districts, ${skipped} skipped (no TIF number)\n`
  );

  // ── 2. Spot-check a few SE-side districts ─────────────────────────────────
  const spotChecks = ["T-141", "T-158", "T-167", "T-135", "T-087"];
  console.log("Spot checks (SE-side + known districts):");
  for (const key of spotChecks) {
    const r = rows.find((x) => x.tifNumber === key);
    if (r) {
      console.log(
        `  ${key} — ${r.tifName ?? "(no name)"} | ` +
          `year=${r.latestReportYear ?? "–"} | ` +
          `balance=${r.latestFundBalance != null ? "$" + r.latestFundBalance.toLocaleString() : "–"} | ` +
          `expires=${r.expirationDate ?? "–"}` +
          (r.expiresWithin24Months ? " ⚑ EXPIRES SOON" : "")
      );
    } else {
      console.log(`  ${key} — not found in dataset`);
    }
  }

  // ── 3. Static JSON export ─────────────────────────────────────────────────
  const exportedAt = new Date().toISOString();
  const districts: Record<string, TifFinancialsExportEntry> = {};
  for (const row of rows) {
    districts[row.tifNumber] = toExportEntry(row, exportedAt);
  }

  const exportPayload: TifFinancialsExport = {
    exportedAt,
    sourceDatasets: [
      {
        id: "qm7s-3ctt",
        name: "TIF Annual Report Analysis of Special Tax Allocation Fund",
        url: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
      },
      {
        id: "fpsv-qjg3",
        name: "TIF Projection / Expiration data",
        url: "https://data.cityofchicago.org/d/fpsv-qjg3",
      },
    ],
    rowCount: rows.length,
    districts,
  };

  mkdirSync(join(REPO_ROOT, "public", "data"), { recursive: true });
  writeFileSync(STATIC_OUT, JSON.stringify(exportPayload, null, 2), "utf8");
  console.log(`\nStatic export written → ${STATIC_OUT}`);
  console.log(`  Districts: ${rows.length}`);

  const expiringSoon = rows.filter((r) => r.expiresWithin24Months);
  console.log(`  Expiring within 24 months: ${expiringSoon.length}`);
  if (expiringSoon.length > 0) {
    for (const r of expiringSoon.slice(0, 10)) {
      console.log(`    ${r.tifNumber} ${r.tifName ?? ""} → ${r.expirationDate}`);
    }
    if (expiringSoon.length > 10)
      console.log(`    ... and ${expiringSoon.length - 10} more`);
  }

  // ── 4. Optional DB upsert ─────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    console.log(
      "\nNo DATABASE_URL set — skipping DB upsert (static export complete)."
    );
    console.log("Done!\n");
    return;
  }

  console.log("\nDATABASE_URL detected — upserting to tif_financials...");
  const result = await runIngest(tifFinancialsAdapter, { zips: [] });

  console.log("\n── Sync Summary ──");
  console.log(`Source:  ${result.sourceKey}`);
  console.log(`Fetched: ${result.fetched}`);
  console.log(`Written: ${result.written}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }

  console.log("\nDone!\n");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
