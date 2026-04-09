#!/usr/bin/env npx tsx
/**
 * Seed EPA National Walkability Index into census_tracts.walk_score.
 *
 * Fetches block-group-level NatWalkInd (1-20 scale) from EPA ArcGIS,
 * aggregates to tract level via population-weighted average, and
 * updates the existing walk_score column.
 *
 * IMPORTANT: Run AFTER seed-census.ts — this script UPDATEs existing rows.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-epa-walkability.ts
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const EPA_BASE_URL =
  "https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query";

interface EpaRecord {
  GEOID20: string;
  NatWalkInd: number;
  TotPop: number;
}

async function fetchAllBlockGroups(): Promise<EpaRecord[]> {
  const all: EpaRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  console.log("Fetching EPA Walkability Index for Cook County (FIPS 17031)...");

  while (true) {
    const params = new URLSearchParams({
      where: "STATEFP='17' AND COUNTYFP='031'",
      outFields: "GEOID20,NatWalkInd,TotPop",
      returnGeometry: "false",
      f: "json",
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });

    const url = `${EPA_BASE_URL}?${params}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    } catch {
      console.warn(`  Timeout at offset ${offset}, retrying...`);
      await new Promise((r) => setTimeout(r, 3000));
      res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    }

    if (!res.ok) {
      console.error(`  EPA API returned ${res.status} at offset ${offset}`);
      break;
    }

    const data = await res.json();
    const features = data.features;
    if (!features || features.length === 0) break;

    for (const f of features) {
      const attrs = f.attributes;
      if (attrs.GEOID20 && attrs.NatWalkInd != null) {
        all.push({
          GEOID20: String(attrs.GEOID20),
          NatWalkInd: attrs.NatWalkInd,
          TotPop: attrs.TotPop ?? 0,
        });
      }
    }

    console.log(`  Fetched ${all.length} block groups (offset ${offset})...`);

    if (!data.exceededTransferLimit && features.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

interface TractAgg {
  totalWeightedScore: number;
  totalPop: number;
  count: number;
  sumScore: number;
}

function aggregateToTracts(
  blockGroups: EpaRecord[]
): Map<string, number> {
  const tracts = new Map<string, TractAgg>();

  for (const bg of blockGroups) {
    // Census tract = first 11 digits of block group FIPS
    const tractId = bg.GEOID20.substring(0, 11);

    let agg = tracts.get(tractId);
    if (!agg) {
      agg = { totalWeightedScore: 0, totalPop: 0, count: 0, sumScore: 0 };
      tracts.set(tractId, agg);
    }

    agg.count++;
    agg.sumScore += bg.NatWalkInd;
    if (bg.TotPop > 0) {
      agg.totalWeightedScore += bg.NatWalkInd * bg.TotPop;
      agg.totalPop += bg.TotPop;
    }
  }

  // Compute final score per tract
  const result = new Map<string, number>();
  for (const [tractId, agg] of tracts) {
    // Population-weighted average if possible, else simple average
    const score =
      agg.totalPop > 0
        ? agg.totalWeightedScore / agg.totalPop
        : agg.sumScore / agg.count;
    result.set(tractId, Math.round(score));
  }

  return result;
}

async function updateDatabase(tractScores: Map<string, number>) {
  console.log(`\nUpdating ${tractScores.size} tracts in database...`);

  let updated = 0;
  let notFound = 0;

  for (const [tractId, score] of tractScores) {
    const result = await sql`
      UPDATE census_tracts
      SET walk_score = ${score}
      WHERE tract_id = ${tractId}
    `;
    if (result.length === 0) {
      // neon returns empty array for UPDATE with no RETURNING — check via count
      notFound++;
    }
    updated++;
    if (updated % 100 === 0) {
      console.log(`  ${updated}/${tractScores.size} tracts updated...`);
    }
  }

  console.log(`  Updated ${updated} tracts`);

  // Verify
  const withScore = await sql`
    SELECT COUNT(*) as cnt FROM census_tracts WHERE walk_score IS NOT NULL
  `;
  const avgScore = await sql`
    SELECT ROUND(AVG(walk_score), 1) as avg FROM census_tracts WHERE walk_score IS NOT NULL
  `;
  console.log(`  Tracts with walk_score: ${withScore[0]?.cnt ?? 0}`);
  console.log(`  Average walk_score: ${avgScore[0]?.avg ?? "N/A"}`);
}

async function main() {
  console.log("=== EPA Walkability Index Seed ===\n");

  // 1. Fetch block groups
  const blockGroups = await fetchAllBlockGroups();
  console.log(`\nTotal block groups fetched: ${blockGroups.length}`);

  if (blockGroups.length === 0) {
    console.error("No data fetched — aborting.");
    process.exit(1);
  }

  // 2. Aggregate to tracts
  const tractScores = aggregateToTracts(blockGroups);
  console.log(`Aggregated to ${tractScores.size} tracts`);

  // Quick stats
  const scores = Array.from(tractScores.values());
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`Score range: ${min}-${max}, mean: ${avg.toFixed(1)}`);

  // 3. Update database
  await updateDatabase(tractScores);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
