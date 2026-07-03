#!/usr/bin/env npx tsx
/**
 * Export corridor_metrics rows to public/data/corridor-metrics.json as a
 * ZIP-keyed map consumed by the report engine's static fallback
 * (loadStaticCorridorMetrics). Run after `db:compute:corridor`.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/export-corridor-metrics.ts
 */

import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

interface Row {
  corridor_type: string;
  corridor_id: string;
  as_of: string | null;
  vacancy_rate: number | null;
  turnover_rate: number | null;
  ownership_hhi: number | null;
  local_ownership_share: number | null;
  permit_count: number | null;
  incentive_coverage: number | null;
  health_score: number | null;
  computed_at: string | null;
  details: unknown;
}

async function main() {
  const res = (await sql.query(
    `SELECT corridor_type, corridor_id, as_of, vacancy_rate, turnover_rate,
            ownership_hhi, local_ownership_share, permit_count,
            incentive_coverage, health_score, computed_at, details
     FROM corridor_metrics
     ORDER BY corridor_id`,
    [],
  )) as { rows?: Row[] } | Row[];
  const rows: Row[] = Array.isArray(res) ? res : (res.rows ?? []);
  if (rows.length === 0) {
    console.error("corridor_metrics is empty; run db:compute:corridor first");
    process.exit(1);
  }

  const map: Record<string, unknown> = {};
  for (const r of rows) {
    map[r.corridor_id] = {
      corridorType: r.corridor_type,
      corridorId: r.corridor_id,
      asOf: r.as_of,
      vacancyRate: r.vacancy_rate,
      turnoverRate: r.turnover_rate,
      ownershipHHI: r.ownership_hhi,
      localOwnershipShare: r.local_ownership_share,
      permitCount: r.permit_count,
      incentiveCoverage: r.incentive_coverage,
      healthScore: r.health_score,
      computedAt: r.computed_at,
      details: r.details ?? null,
    };
  }

  const outPath = join(__dirname, "..", "public", "data", "corridor-metrics.json");
  writeFileSync(outPath, JSON.stringify(map, null, 1));
  console.log(`Wrote ${rows.length} corridor metrics → ${outPath}`);
  for (const id of Object.keys(map)) console.log(`  ${id}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
