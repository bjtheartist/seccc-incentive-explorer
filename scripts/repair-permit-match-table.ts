#!/usr/bin/env npx tsx
/**
 * Rebuild only the weak spatial_proximity tier in
 * vacant_property_permit_matches.
 *
 * Dry-run is the default and performs no writes. --write stages the complete
 * replacement, validates one proximity parcel per permit and no stronger-match
 * shadowing, then replaces the live proximity tier in one atomic statement.
 * Strong PIN/address rows are never deleted.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run data:repair:permit-matches
 *   DATABASE_URL="postgresql://..." npm run data:repair:permit-matches -- --write
 */

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  SPATIAL_MATCH_PER_PARCEL_CAP,
  SPATIAL_MATCH_RADIUS_M,
} from "../lib/permit-match";
import type { SQL } from "../lib/ingest/types";

type Row = Record<string, unknown>;

const BATCH = 2_000;

export interface RepairPermitMatchCliOptions {
  write: boolean;
  help: boolean;
}

export function parseRepairPermitMatchCliArgs(
  args: readonly string[],
): RepairPermitMatchCliOptions {
  let write = false;
  let help = false;
  let sawWrite = false;
  let sawDryRun = false;

  for (const arg of args) {
    if (arg === "--write") {
      write = true;
      sawWrite = true;
    } else if (arg === "--dry-run") {
      write = false;
      sawDryRun = true;
    } else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (sawWrite && sawDryRun) {
    throw new Error("Choose either --write or --dry-run, not both");
  }
  return { write, help };
}

function usage(): void {
  console.log(`Permit match table repair

Usage:
  DATABASE_URL="postgresql://..." npm run data:repair:permit-matches [--dry-run]
  DATABASE_URL="postgresql://..." npm run data:repair:permit-matches -- --write

Options:
  --dry-run  Calculate the full replacement without changing the database (default)
  --write    Stage, validate, and atomically publish the replacement proximity tier
  --help     Show this help`);
}

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value: unknown): string {
  return n(value).toLocaleString("en-US");
}

function proposedMatchSelect(loParameter: string, hiParameter: string): string {
  return `
    SELECT
      vp.id AS vacant_property_id,
      near.permit_id,
      round(near.dist_m)::text || ' m' AS matched_on
    FROM vacant_properties vp
    CROSS JOIN LATERAL (
      SELECT bp.permit_id, ST_Distance(bp.geom, vp.geom) AS dist_m
      FROM building_permits bp
      WHERE bp.geom IS NOT NULL
        AND ST_DWithin(bp.geom, vp.geom, ${SPATIAL_MATCH_RADIUS_M})
        AND NOT EXISTS (
          SELECT 1
          FROM vacant_property_permit_matches stronger
          WHERE stronger.permit_id = bp.permit_id
            AND stronger.match_method IN ('pin_exact', 'address_normalized')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM vacant_properties closer
          WHERE closer.geom IS NOT NULL
            AND closer.id <> vp.id
            AND ST_DWithin(bp.geom, closer.geom, ${SPATIAL_MATCH_RADIUS_M})
            AND (
              ST_Distance(bp.geom, closer.geom) < ST_Distance(bp.geom, vp.geom)
              OR (
                ST_Distance(bp.geom, closer.geom) = ST_Distance(bp.geom, vp.geom)
                AND closer.id < vp.id
              )
            )
        )
      ORDER BY bp.issue_date DESC NULLS LAST, bp.permit_id
      LIMIT ${SPATIAL_MATCH_PER_PARCEL_CAP}
    ) near
    WHERE vp.id > ${loParameter}
      AND vp.id <= ${hiParameter}
      AND vp.geom IS NOT NULL
  `;
}

async function auditCurrent(sql: SQL): Promise<Row> {
  const rows = (await sql.query(`
    WITH proximity_per_permit AS (
      SELECT permit_id, COUNT(DISTINCT vacant_property_id)::int AS parcel_count
      FROM vacant_property_permit_matches
      WHERE match_method = 'spatial_proximity'
      GROUP BY permit_id
    )
    SELECT
      COUNT(*) FILTER (WHERE match_method = 'spatial_proximity')::int AS proximity_rows,
      COUNT(DISTINCT permit_id) FILTER (
        WHERE match_method = 'spatial_proximity'
      )::int AS proximity_permits,
      (SELECT COUNT(*)::int FROM proximity_per_permit WHERE parcel_count > 1)
        AS multi_parcel_permits,
      COUNT(*) FILTER (
        WHERE match_method = 'spatial_proximity'
          AND EXISTS (
            SELECT 1
            FROM vacant_property_permit_matches stronger
            WHERE stronger.permit_id = vacant_property_permit_matches.permit_id
              AND stronger.match_method IN ('pin_exact', 'address_normalized')
          )
      )::int AS shadowed_rows
    FROM vacant_property_permit_matches
  `)) as Row[];
  return rows[0] ?? {};
}

async function calculateProposed(
  sql: SQL,
  onWindow?: (lo: string, hi: string, rows: number) => Promise<void>,
): Promise<number> {
  let cursor = "";
  let proposed = 0;

  for (;;) {
    const window = (await sql.query(
      `SELECT id FROM vacant_properties WHERE id > $1 ORDER BY id LIMIT ${BATCH}`,
      [cursor],
    )) as Row[];
    if (window.length === 0) break;
    const hi = String(window[window.length - 1]?.id ?? "");

    const countRows = (await sql.query(
      `SELECT COUNT(*)::int AS rows FROM (${proposedMatchSelect("$1", "$2")}) proposed`,
      [cursor, hi],
    )) as Row[];
    const rows = n(countRows[0]?.rows);
    proposed += rows;
    if (onWindow) await onWindow(cursor, hi, rows);
    cursor = hi;
  }

  return proposed;
}

async function stageProposed(
  sql: SQL,
  runId: string,
  lo: string,
  hi: string,
): Promise<number> {
  const rows = (await sql.query(
    `
      INSERT INTO permit_match_repair_stage (
        run_id, vacant_property_id, permit_id, matched_on
      )
      SELECT $1, proposed.vacant_property_id, proposed.permit_id, proposed.matched_on
      FROM (${proposedMatchSelect("$2", "$3")}) proposed
      ON CONFLICT (run_id, vacant_property_id, permit_id) DO UPDATE SET
        matched_on = EXCLUDED.matched_on,
        staged_at = NOW()
      RETURNING permit_id
    `,
    [runId, lo, hi],
  )) as Row[];
  return rows.length;
}

async function publishStaged(
  sql: SQL,
  runId: string,
): Promise<{ removed: number; inserted: number }> {
  const rows = (await sql.query(
    `
      WITH incoming AS MATERIALIZED (
        SELECT vacant_property_id, permit_id, matched_on
        FROM permit_match_repair_stage
        WHERE run_id = $1
      ), checks AS MATERIALIZED (
        SELECT
          COUNT(*)::int AS expected,
          COUNT(*) = COUNT(DISTINCT permit_id) AS one_parcel_per_permit,
          NOT EXISTS (
            SELECT 1
            FROM incoming i
            JOIN vacant_property_permit_matches stronger
              ON stronger.permit_id = i.permit_id
             AND stronger.match_method IN ('pin_exact', 'address_normalized')
          ) AS no_shadowed_permits
        FROM incoming
      ), removed AS (
        DELETE FROM vacant_property_permit_matches
        WHERE match_method = 'spatial_proximity'
          AND (SELECT one_parcel_per_permit AND no_shadowed_permits FROM checks)
        RETURNING permit_id
      ), inserted AS (
        INSERT INTO vacant_property_permit_matches (
          vacant_property_id,
          permit_id,
          match_method,
          match_confidence,
          matched_on,
          matched_at
        )
        SELECT
          i.vacant_property_id,
          i.permit_id,
          'spatial_proximity',
          'low',
          i.matched_on,
          NOW()
        FROM incoming i
        CROSS JOIN checks c
        WHERE c.one_parcel_per_permit
          AND c.no_shadowed_permits
          AND (SELECT COUNT(*) FROM removed) >= 0
        ON CONFLICT (vacant_property_id, permit_id) DO NOTHING
        RETURNING permit_id
      ), cleaned AS (
        DELETE FROM permit_match_repair_stage
        WHERE run_id = $1
          AND (SELECT COUNT(*) FROM inserted) = (SELECT expected FROM checks)
        RETURNING permit_id
      ), totals AS (
        SELECT
          (SELECT COUNT(*)::int FROM removed) AS removed,
          (SELECT COUNT(*)::int FROM inserted) AS inserted,
          (SELECT expected FROM checks) AS expected,
          (SELECT one_parcel_per_permit AND no_shadowed_permits FROM checks) AS safe
      )
      SELECT
        removed,
        inserted,
        1 / CASE WHEN safe AND inserted = expected THEN 1 ELSE 0 END AS publish_guard
      FROM totals
    `,
    [runId],
  )) as Row[];
  return {
    removed: n(rows[0]?.removed),
    inserted: n(rows[0]?.inserted),
  };
}

export async function repairPermitMatchTable(
  databaseUrl: string,
  options: RepairPermitMatchCliOptions,
): Promise<void> {
  const sql = neon(databaseUrl);
  const [permitRows, parcelRows] = await Promise.all([
    sql.query("SELECT COUNT(*)::int AS count FROM building_permits") as Promise<Row[]>,
    sql.query("SELECT COUNT(*)::int AS count FROM vacant_properties") as Promise<Row[]>,
  ]);
  if (n(permitRows[0]?.count) === 0 || n(parcelRows[0]?.count) === 0) {
    throw new Error("Permit match repair requires non-empty permit and vacant-property tables");
  }

  const before = await auditCurrent(sql);
  console.log("Permit match table repair");
  console.log(`Mode: ${options.write ? "write" : "dry-run (read-only)"}`);
  console.log(`Current proximity rows: ${format(before.proximity_rows)}`);
  console.log(`Current proximity permits: ${format(before.proximity_permits)}`);
  console.log(`Current multi-parcel proximity permits: ${format(before.multi_parcel_permits)}`);
  console.log(`Current proximity rows shadowed by stronger matches: ${format(before.shadowed_rows)}`);

  let runId: string | null = null;
  if (options.write) {
    runId = randomUUID();
    await sql.query(
      "DELETE FROM permit_match_repair_stage WHERE staged_at < NOW() - INTERVAL '2 days'",
    );
  }

  let staged = 0;
  const proposed = await calculateProposed(
    sql,
    options.write
      ? async (lo, hi) => {
          staged += await stageProposed(sql, runId!, lo, hi);
        }
      : undefined,
  );
  console.log(`Proposed safe proximity rows: ${format(proposed)}`);

  if (!options.write) {
    console.log("No database rows changed. Re-run with --write only on the intended database branch.");
    return;
  }
  if (staged !== proposed) {
    throw new Error(`Staging reconciliation failed: proposed ${proposed}, staged ${staged}`);
  }

  const stageAudit = (await sql.query(
    `
      SELECT
        COUNT(*)::int AS rows,
        COUNT(DISTINCT permit_id)::int AS permits,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM vacant_property_permit_matches stronger
            WHERE stronger.permit_id = permit_match_repair_stage.permit_id
              AND stronger.match_method IN ('pin_exact', 'address_normalized')
          )
        )::int AS shadowed
      FROM permit_match_repair_stage
      WHERE run_id = $1
    `,
    [runId],
  )) as Row[];
  const stage = stageAudit[0] ?? {};
  if (n(stage.rows) !== proposed || n(stage.permits) !== proposed || n(stage.shadowed) !== 0) {
    throw new Error(
      `Stage safety check failed: rows=${n(stage.rows)}, permits=${n(stage.permits)}, shadowed=${n(stage.shadowed)}`,
    );
  }

  const published = await publishStaged(sql, runId!);
  const after = await auditCurrent(sql);
  if (n(after.multi_parcel_permits) !== 0 || n(after.shadowed_rows) !== 0) {
    throw new Error(
      `Post-publish safety audit failed: multi=${n(after.multi_parcel_permits)}, shadowed=${n(after.shadowed_rows)}`,
    );
  }
  if (published.inserted !== proposed || n(after.proximity_rows) !== proposed) {
    throw new Error(
      `Publish reconciliation failed: proposed=${proposed}, inserted=${published.inserted}, live=${n(after.proximity_rows)}`,
    );
  }

  console.log(`Removed legacy proximity rows: ${format(published.removed)}`);
  console.log(`Published safe proximity rows: ${format(published.inserted)}`);
  console.log("Post-publish multi-parcel proximity permits: 0");
  console.log("Post-publish proximity rows shadowed by stronger matches: 0");
}

async function main(): Promise<void> {
  const options = parseRepairPermitMatchCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required");
  await repairPermitMatchTable(databaseUrl, options);
}

const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error("Permit match table repair failed:", error);
    process.exit(1);
  });
}
