#!/usr/bin/env npx tsx
/**
 * Controlled coordinate backfill for building_permits rows whose geom is NULL.
 *
 * Resolution order:
 *   1. exact normalized address reused from native City permit coordinates,
 *      only when every published point is within one 25 m cluster;
 *   2. exact permit PIN reused from native City permit coordinates under the
 *      same cluster rule;
 *   3. U.S. Census batch geocoder, accepting only Match + Exact results inside
 *      Chicago's bounds.
 *
 * Dry-run is the default and never calls an external provider. --fetch-census
 * measures the complete provider outcome without writing. --write implies the
 * provider fetch, records one auditable result per baseline permit, and applies
 * every accepted point in one guarded database statement.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes
 *   DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes -- --fetch-census
 *   DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes -- --write
 */

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SQL } from "../lib/ingest/types";
import {
  buildCensusBatchCsv,
  CENSUS_BATCH_ENDPOINT,
  CENSUS_BENCHMARK,
  evaluateCensusResult,
  parseCensusBatchResponse,
  PERMIT_GEOCODE_STRATEGY_VERSION,
  selectInternalPermitGeocode,
  uniqueCensusRequests,
  type CensusBatchRequest,
  type CensusBatchResult,
  type PermitBackfillCandidate,
  type PermitGeocodeResolutionSource,
  type PermitGeocodeResultStatus,
} from "../lib/permit-geocode-backfill";

type Row = Record<string, unknown>;

interface BackfillCliOptions {
  write: boolean;
  fetchCensus: boolean;
  help: boolean;
}

interface PersistedResult {
  runId: string;
  permitId: string;
  inputAddress: string;
  addressKey: string;
  resolutionSource: PermitGeocodeResolutionSource;
  status: PermitGeocodeResultStatus;
  matchType: string | null;
  matchedAddress: string | null;
  lat: number | null;
  lon: number | null;
  maxSourceSpreadM: number | null;
  providerResponse: Record<string, unknown>;
}

export function parsePermitGeocodeBackfillCliArgs(
  args: readonly string[],
): BackfillCliOptions {
  let write = false;
  let fetchCensus = false;
  let help = false;
  let sawWrite = false;
  let sawDryRun = false;

  for (const arg of args) {
    if (arg === "--write") {
      write = true;
      fetchCensus = true;
      sawWrite = true;
    } else if (arg === "--dry-run") {
      write = false;
      sawDryRun = true;
    } else if (arg === "--fetch-census") fetchCensus = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (sawWrite && sawDryRun) {
    throw new Error("Choose either --write or --dry-run, not both");
  }
  return { write, fetchCensus, help };
}

function usage(): void {
  console.log(`Permit coordinate backfill

Usage:
  DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes [--dry-run]
  DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes -- --fetch-census
  DATABASE_URL="postgresql://..." npm run data:backfill:permit-geocodes -- --write

Options:
  --dry-run       Profile internal reuse and Census input without external calls or writes (default)
  --fetch-census  Submit the unresolved unique addresses to Census and report outcomes; do not write
  --write         Fetch Census, record the full result ledger, and atomically apply accepted points
  --help          Show this help`);
}

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function format(value: unknown): string {
  return n(value).toLocaleString("en-US");
}

const CANDIDATE_QUERY = `
  WITH missing AS MATERIALIZED (
    SELECT
      permit_id,
      address,
      regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS address_key,
      COALESCE(pins, ARRAY[]::text[]) AS pins
    FROM building_permits
    WHERE geom IS NULL
      AND NULLIF(BTRIM(address), '') IS NOT NULL
  ), missing_addresses AS MATERIALIZED (
    SELECT DISTINCT address_key
    FROM missing
  ), address_point_counts AS MATERIALIZED (
    SELECT
      ma.address_key,
      round(k.lat::numeric, 6)::double precision AS lat,
      round(k.lon::numeric, 6)::double precision AS lon,
      COUNT(*)::int AS support
    FROM missing_addresses ma
    JOIN building_permits k
      ON k.geom IS NOT NULL
     AND k.geocode_source IS NULL
     AND regexp_replace(lower(coalesce(k.address, '')), '[^a-z0-9]', '', 'g') = ma.address_key
    GROUP BY 1, 2, 3
  ), address_ranked AS (
    SELECT
      address_point_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY address_key
        ORDER BY support DESC, lat, lon
      ) AS rank
    FROM address_point_counts
  ), address_choice AS MATERIALIZED (
    SELECT address_key, lat, lon
    FROM address_ranked
    WHERE rank = 1
  ), address_stats AS MATERIALIZED (
    SELECT
      choice.address_key,
      choice.lat,
      choice.lon,
      COUNT(*)::int AS candidate_rows,
      COUNT(DISTINCT (
        round(k.lat::numeric, 6)::text || ',' || round(k.lon::numeric, 6)::text
      ))::int AS candidate_points,
      MAX(
        ST_Distance(
          k.geom,
          ST_MakePoint(choice.lon, choice.lat)::geography
        )
      )::double precision AS max_spread_m
    FROM address_choice choice
    JOIN building_permits k
      ON k.geom IS NOT NULL
     AND k.geocode_source IS NULL
     AND regexp_replace(lower(coalesce(k.address, '')), '[^a-z0-9]', '', 'g') = choice.address_key
    GROUP BY choice.address_key, choice.lat, choice.lon
  ), pin_point_counts AS MATERIALIZED (
    SELECT
      m.permit_id,
      round(k.lat::numeric, 6)::double precision AS lat,
      round(k.lon::numeric, 6)::double precision AS lon,
      COUNT(*)::int AS support
    FROM missing m
    JOIN building_permits k
      ON k.geom IS NOT NULL
     AND k.geocode_source IS NULL
     AND cardinality(m.pins) > 0
     AND k.pins && m.pins
    GROUP BY 1, 2, 3
  ), pin_ranked AS (
    SELECT
      pin_point_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY permit_id
        ORDER BY support DESC, lat, lon
      ) AS rank
    FROM pin_point_counts
  ), pin_choice AS MATERIALIZED (
    SELECT permit_id, lat, lon
    FROM pin_ranked
    WHERE rank = 1
  ), pin_stats AS MATERIALIZED (
    SELECT
      choice.permit_id,
      choice.lat,
      choice.lon,
      COUNT(*)::int AS candidate_rows,
      COUNT(DISTINCT (
        round(k.lat::numeric, 6)::text || ',' || round(k.lon::numeric, 6)::text
      ))::int AS candidate_points,
      MAX(
        ST_Distance(
          k.geom,
          ST_MakePoint(choice.lon, choice.lat)::geography
        )
      )::double precision AS max_spread_m
    FROM pin_choice choice
    JOIN missing m ON m.permit_id = choice.permit_id
    JOIN building_permits k
      ON k.geom IS NOT NULL
     AND k.geocode_source IS NULL
     AND k.pins && m.pins
    GROUP BY choice.permit_id, choice.lat, choice.lon
  )
  SELECT
    m.permit_id,
    m.address,
    m.address_key,
    address_stats.lat AS address_candidate_lat,
    address_stats.lon AS address_candidate_lon,
    COALESCE(address_stats.candidate_points, 0)::int AS address_candidate_points,
    COALESCE(address_stats.candidate_rows, 0)::int AS address_candidate_rows,
    address_stats.max_spread_m AS address_max_spread_m,
    pin_stats.lat AS pin_candidate_lat,
    pin_stats.lon AS pin_candidate_lon,
    COALESCE(pin_stats.candidate_points, 0)::int AS pin_candidate_points,
    COALESCE(pin_stats.candidate_rows, 0)::int AS pin_candidate_rows,
    pin_stats.max_spread_m AS pin_max_spread_m
  FROM missing m
  LEFT JOIN address_stats ON address_stats.address_key = m.address_key
  LEFT JOIN pin_stats ON pin_stats.permit_id = m.permit_id
  ORDER BY m.permit_id
`;

function candidateFromRow(row: Row): PermitBackfillCandidate {
  return {
    permitId: String(row.permit_id),
    address: String(row.address),
    addressKey: String(row.address_key),
    addressCandidateLat: nullableNumber(row.address_candidate_lat),
    addressCandidateLon: nullableNumber(row.address_candidate_lon),
    addressCandidatePoints: n(row.address_candidate_points),
    addressCandidateRows: n(row.address_candidate_rows),
    addressMaxSpreadM: nullableNumber(row.address_max_spread_m),
    pinCandidateLat: nullableNumber(row.pin_candidate_lat),
    pinCandidateLon: nullableNumber(row.pin_candidate_lon),
    pinCandidatePoints: n(row.pin_candidate_points),
    pinCandidateRows: n(row.pin_candidate_rows),
    pinMaxSpreadM: nullableNumber(row.pin_max_spread_m),
  };
}

async function fetchCensus(
  requests: readonly CensusBatchRequest[],
): Promise<Map<string, CensusBatchResult>> {
  if (requests.length > 10_000) {
    throw new Error(`Census batch limit exceeded: ${requests.length} addresses`);
  }
  const csv = buildCensusBatchCsv(requests);
  if (Buffer.byteLength(csv) > 5_000_000) {
    throw new Error("Census batch file exceeds the documented 5 MB limit");
  }

  const body = new FormData();
  body.set("addressFile", new Blob([csv], { type: "text/csv" }), "permit-addresses.csv");
  body.set("benchmark", CENSUS_BENCHMARK);
  const response = await fetch(CENSUS_BATCH_ENDPOINT, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`Census batch geocoder returned ${response.status}`);
  }
  const parsed = parseCensusBatchResponse(await response.text());
  const expectedIds = new Set(requests.map((request) => request.id));
  const unknownIds = Array.from(parsed.keys()).filter((id) => !expectedIds.has(id));
  const missingIds = requests.filter((request) => !parsed.has(request.id));
  if (unknownIds.length > 0 || missingIds.length > 0 || parsed.size !== requests.length) {
    throw new Error(
      `Census response reconciliation failed: expected ${requests.length}, received ${parsed.size}, ` +
        `missing ${missingIds.length}, unknown ${unknownIds.length}`,
    );
  }
  return parsed;
}

function buildPersistedResults(
  runId: string,
  candidates: readonly PermitBackfillCandidate[],
  requestByAddress: ReadonlyMap<string, CensusBatchRequest>,
  census: ReadonlyMap<string, CensusBatchResult>,
): PersistedResult[] {
  return candidates.map((candidate) => {
    const internal = selectInternalPermitGeocode(candidate);
    if (internal) {
      return {
        runId,
        permitId: candidate.permitId,
        inputAddress: candidate.address,
        addressKey: candidate.addressKey,
        resolutionSource: internal.source,
        status: "accepted",
        matchType: internal.matchType,
        matchedAddress: candidate.address,
        lat: internal.lat,
        lon: internal.lon,
        maxSourceSpreadM: internal.maxSpreadM,
        providerResponse: {
          candidatePoints: internal.candidatePoints,
          candidateRows: internal.candidateRows,
          rule: "all native City source points within 25 m of the modal point",
        },
      };
    }

    const request = requestByAddress.get(candidate.addressKey);
    const censusResult = request ? census.get(request.id) : undefined;
    const evaluated = evaluateCensusResult(censusResult);
    return {
      runId,
      permitId: candidate.permitId,
      inputAddress: candidate.address,
      addressKey: candidate.addressKey,
      resolutionSource: "census_geocoder",
      status: evaluated.status,
      matchType: censusResult?.matchType || evaluated.reason,
      matchedAddress: censusResult?.matchedAddress ?? null,
      lat: evaluated.lat,
      lon: evaluated.lon,
      maxSourceSpreadM: null,
      providerResponse: {
        evaluationReason: evaluated.reason,
        matchIndicator: censusResult?.matchIndicator ?? null,
        tigerLineId: censusResult?.tigerLineId ?? null,
        tigerLineSide: censusResult?.tigerLineSide ?? null,
        benchmark: CENSUS_BENCHMARK,
        internalAddressMaxSpreadM: candidate.addressMaxSpreadM,
        internalPinMaxSpreadM: candidate.pinMaxSpreadM,
      },
    };
  });
}

function summarize(results: readonly PersistedResult[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const result of results) {
    const key = `${result.resolutionSource}:${result.status}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

async function persistAndApply(
  sql: SQL,
  runId: string,
  candidates: readonly PermitBackfillCandidate[],
  requests: readonly CensusBatchRequest[],
  snapshotMaxFetchedAt: string | null,
  results: readonly PersistedResult[],
): Promise<number> {
  await sql.query(
    `
      INSERT INTO permit_geocode_runs (
        run_id,
        strategy_version,
        census_benchmark,
        status,
        baseline_missing,
        unique_addresses,
        source_snapshot_max_fetched_at
      ) VALUES ($1, $2, $3, 'running', $4, $5, $6)
    `,
    [
      runId,
      PERMIT_GEOCODE_STRATEGY_VERSION,
      CENSUS_BENCHMARK,
      candidates.length,
      new Set(candidates.map((candidate) => candidate.addressKey)).size,
      snapshotMaxFetchedAt,
    ],
  );

  try {
    const batchSize = 1_000;
    let persisted = 0;
    for (let i = 0; i < results.length; i += batchSize) {
      const payload = results.slice(i, i + batchSize).map((result) => ({
        run_id: result.runId,
        permit_id: result.permitId,
        input_address: result.inputAddress,
        address_key: result.addressKey,
        resolution_source: result.resolutionSource,
        status: result.status,
        match_type: result.matchType,
        matched_address: result.matchedAddress,
        lat: result.lat,
        lon: result.lon,
        max_source_spread_m: result.maxSourceSpreadM,
        provider_response: result.providerResponse,
      }));
      const inserted = (await sql.query(
        `
          INSERT INTO permit_geocode_results (
            run_id,
            permit_id,
            input_address,
            address_key,
            resolution_source,
            status,
            match_type,
            matched_address,
            lat,
            lon,
            max_source_spread_m,
            provider_response
          )
          SELECT
            incoming.run_id,
            incoming.permit_id,
            incoming.input_address,
            incoming.address_key,
            incoming.resolution_source,
            incoming.status,
            incoming.match_type,
            incoming.matched_address,
            incoming.lat,
            incoming.lon,
            incoming.max_source_spread_m,
            incoming.provider_response
          FROM jsonb_to_recordset($1::jsonb) AS incoming(
            run_id TEXT,
            permit_id TEXT,
            input_address TEXT,
            address_key TEXT,
            resolution_source TEXT,
            status TEXT,
            match_type TEXT,
            matched_address TEXT,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            max_source_spread_m DOUBLE PRECISION,
            provider_response JSONB
          )
          ON CONFLICT (run_id, permit_id) DO NOTHING
          RETURNING permit_id
        `,
        [JSON.stringify(payload)],
      )) as Row[];
      persisted += inserted.length;
    }
    if (persisted !== candidates.length) {
      throw new Error(
        `Result ledger reconciliation failed: expected ${candidates.length}, inserted ${persisted}`,
      );
    }

    const summary = summarize(results);
    const published = (await sql.query(
      `
        WITH accepted AS MATERIALIZED (
          SELECT *
          FROM permit_geocode_results
          WHERE run_id = $1
            AND status = 'accepted'
        ), eligible AS MATERIALIZED (
          SELECT r.*
          FROM accepted r
          JOIN building_permits bp ON bp.permit_id = r.permit_id
          WHERE bp.geom IS NULL
            AND regexp_replace(lower(coalesce(bp.address, '')), '[^a-z0-9]', '', 'g') = r.address_key
            AND r.lat IS NOT NULL
            AND r.lon IS NOT NULL
        ), updated AS (
          UPDATE building_permits bp
          SET
            lat = eligible.lat,
            lon = eligible.lon,
            geom = ST_MakePoint(eligible.lon, eligible.lat)::geography,
            geocode_source = eligible.resolution_source,
            geocode_match_type = eligible.match_type,
            geocode_matched_address = eligible.matched_address,
            geocoded_at = NOW(),
            geocode_run_id = $1
          FROM eligible
          WHERE bp.permit_id = eligible.permit_id
            AND (SELECT COUNT(*) FROM accepted) = (SELECT COUNT(*) FROM eligible)
          RETURNING bp.permit_id
        ), marked AS (
          UPDATE permit_geocode_results result
          SET applied_at = NOW()
          WHERE result.run_id = $1
            AND result.status = 'accepted'
            AND result.permit_id IN (SELECT permit_id FROM updated)
          RETURNING result.permit_id
        ), completed AS (
          UPDATE permit_geocode_runs run
          SET
            status = 'completed',
            completed_at = NOW(),
            summary = $2::jsonb
          WHERE run.run_id = $1
            AND (SELECT COUNT(*) FROM updated) = (SELECT COUNT(*) FROM accepted)
            AND (SELECT COUNT(*) FROM marked) = (SELECT COUNT(*) FROM accepted)
          RETURNING run.run_id
        ), totals AS (
          SELECT
            (SELECT COUNT(*)::int FROM accepted) AS expected,
            (SELECT COUNT(*)::int FROM updated) AS updated,
            (SELECT COUNT(*)::int FROM marked) AS marked,
            (SELECT COUNT(*)::int FROM completed) AS completed
        )
        SELECT
          updated,
          1 / CASE
            WHEN expected = updated AND expected = marked AND completed = 1 THEN 1
            ELSE 0
          END AS publish_guard
        FROM totals
      `,
      [runId, JSON.stringify({ ...summary, censusUniqueAddresses: requests.length })],
    )) as Row[];
    return n(published[0]?.updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backfill failure";
    await sql.query(
      `
        UPDATE permit_geocode_runs
        SET status = 'failed', completed_at = NOW(), summary = $2::jsonb
        WHERE run_id = $1 AND status = 'running'
      `,
      [runId, JSON.stringify({ error: message.slice(0, 2_000) })],
    );
    throw error;
  }
}

export async function backfillPermitGeocodes(
  databaseUrl: string,
  options: BackfillCliOptions,
): Promise<void> {
  const sql = neon(databaseUrl);
  const [profileRows, candidateRows] = await Promise.all([
    sql.query(`
      SELECT
        COUNT(*) FILTER (WHERE geom IS NULL)::int AS missing,
        COUNT(DISTINCT regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g'))
          FILTER (WHERE geom IS NULL)::int AS unique_addresses,
        MAX(fetched_at)::text AS snapshot_max_fetched_at
      FROM building_permits
    `) as Promise<Row[]>,
    sql.query(CANDIDATE_QUERY) as Promise<Row[]>,
  ]);
  const profile = profileRows[0] ?? {};
  const candidates = candidateRows.map(candidateFromRow);
  if (n(profile.missing) !== candidates.length) {
    throw new Error(
      `Backlog grain mismatch: ${n(profile.missing)} missing rows but ${candidates.length} addressable candidates`,
    );
  }

  const internal = new Map(
    candidates.map((candidate) => [candidate.permitId, selectInternalPermitGeocode(candidate)]),
  );
  const addressReuse = Array.from(internal.values()).filter(
    (value) => value?.source === "city_permit_address_reuse",
  ).length;
  const pinReuse = Array.from(internal.values()).filter(
    (value) => value?.source === "city_permit_pin_reuse",
  ).length;
  const unresolved = candidates.filter((candidate) => !internal.get(candidate.permitId));
  const requests = uniqueCensusRequests(unresolved);

  console.log("Permit coordinate backfill");
  console.log(`Mode: ${options.write ? "write" : options.fetchCensus ? "provider dry-run" : "read-only dry-run"}`);
  console.log(`Baseline permits without geometry: ${format(candidates.length)}`);
  console.log(`Unique baseline addresses: ${format(profile.unique_addresses)}`);
  console.log(`Accepted from exact City address clusters: ${format(addressReuse)}`);
  console.log(`Accepted from exact City PIN clusters: ${format(pinReuse)}`);
  console.log(`Unique addresses requiring Census: ${format(requests.length)}`);

  if (!options.fetchCensus) {
    console.log("Census was not called and no database rows changed.");
    return;
  }

  const census = await fetchCensus(requests);
  const requestByAddress = new Map(requests.map((request) => [request.addressKey, request]));
  const runId = randomUUID();
  const results = buildPersistedResults(runId, candidates, requestByAddress, census);
  const summary = summarize(results);
  for (const [label, count] of Object.entries(summary).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${label}: ${format(count)}`);
  }

  if (!options.write) {
    console.log("Provider outcome measured; no database rows changed.");
    return;
  }

  const applied = await persistAndApply(
    sql,
    runId,
    candidates,
    requests,
    profile.snapshot_max_fetched_at == null ? null : String(profile.snapshot_max_fetched_at),
    results,
  );
  const remainingRows = (await sql.query(
    "SELECT COUNT(*)::int AS count FROM building_permits WHERE geom IS NULL",
  )) as Row[];
  console.log(`Applied coordinates atomically: ${format(applied)}`);
  console.log(`Permits still without geometry: ${format(remainingRows[0]?.count)}`);
  console.log(`Geocode run id: ${runId}`);
  console.log("Next required step: rebuild the proximity match tier from the new geometry snapshot.");
}

async function main(): Promise<void> {
  const options = parsePermitGeocodeBackfillCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required");
  await backfillPermitGeocodes(databaseUrl, options);
}

const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error("Permit coordinate backfill failed:", error);
    process.exit(1);
  });
}
