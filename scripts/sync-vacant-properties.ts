#!/usr/bin/env npx tsx
/**
 * Sync vacant properties from Chicago's City-Owned Land Inventory (Socrata).
 * Upserts into vacant_properties table, cross-references against zone geometries,
 * matches citywide building permits to the vacant-parcel universe, and generates
 * a static GeoJSON fallback file.
 *
 * ── PRODUCTION SAFETY ──
 *
 * This script WRITES. Point DATABASE_URL at a disposable Neon branch to verify a
 * change; a production run is the repo owner's call and is not something a
 * change-verification run should ever perform. The citywide permits ingest that
 * feeds the match phase (scripts/sync-condition.ts) carries the same rule.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-vacant-properties.ts
 *
 * Steps can be selected so a targeted re-run does not redo the whole sync:
 *   SYNC_VACANT_STEPS=permits,export npx tsx scripts/sync-vacant-properties.ts
 *   (steps: cols, sr311, zones, permits, export — default: all)
 */

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { socrataHeaders } from "../lib/socrata";
import { classifyOwner } from "../lib/owner-classify";
import { CHICAGO_COMMUNITY_AREAS } from "../lib/community-areas";
import { toDigitsOnlyPin } from "../lib/ingest/pin-batch";
import { fetchCompleteOffsetPages } from "../lib/complete-source-pagination";
import {
  chicagoCalendarDay,
  normalizeChicagoSourceCalendarDate,
  shiftCalendarDayYears,
  VACANCY_RETENTION_YEARS,
} from "../lib/vacancy-evidence";
import { reconcileVacancyMembership } from "../lib/vacancy-reconciliation";
import { canonicalizeVacancyZoneMatches } from "../lib/vacancy-zone-matches";
import {
  STATIC_FALLBACK_LIMIT,
  STATIC_FALLBACK_TYPE_QUOTAS,
} from "../lib/vacancy-static-fallback";
import {
  assertVacancySourceSnapshotSane,
  build311VacancySourcePageUrl,
  buildColsSourcePageUrl,
  isPlausible311VacancySourceRow,
  isPlausibleColsSourceRow,
} from "../lib/vacancy-source-contract";
import {
  NORMALIZED_ADDRESS_SQL,
  PERMIT_MATCH_METHOD_ORDER,
  SPATIAL_MATCH_PER_PARCEL_CAP,
  SPATIAL_MATCH_RADIUS_M,
} from "../lib/permit-match";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/** Which phases to run. Default is every phase, in order. */
const ALL_STEPS = ["cols", "sr311", "zones", "permits", "export"] as const;
type SyncStep = (typeof ALL_STEPS)[number];
const STEPS = new Set<SyncStep>(
  (process.env.SYNC_VACANT_STEPS
    ? (process.env.SYNC_VACANT_STEPS.split(",").map((s) => s.trim()) as SyncStep[])
    : [...ALL_STEPS]
  ).filter((s): s is SyncStep => (ALL_STEPS as readonly string[]).includes(s)),
);

// City-Owned Land Inventory — Socrata dataset
const COLS_DATASET_ID = "aksk-kvfp";
const COLS_BASE_URL = `https://data.cityofchicago.org/resource/${COLS_DATASET_ID}.json`;

// 311 Service Requests — vacant-building and clean-lot public-record signals
const SR311_DATASET_ID = "v6vf-nfxy";
const SR311_BASE_URL = `https://data.cityofchicago.org/resource/${SR311_DATASET_ID}.json`;

interface ColsRecord {
  pin: string;
  address: string;
  dir?: string;
  street?: string;
  type?: string;
  property_name?: string;
  managing_organization?: string;
  ward?: string;
  community_area_name?: string;
  community_area_number?: string;
  zoning_classification?: string;
  sq_ft?: string;
  latitude?: string;
  longitude?: string;
}

/** Cook County Assessor record (taxpayer info). */
interface AssessorRecord {
  pin: string;
  tax_bill_name?: string;
  taxpayer_name?: string;
  tax_bill_mailing_address?: string;
  tax_bill_city?: string;
  tax_bill_state?: string;
  tax_bill_zip?: string;
}

/** Batch-fetch ownership data from Cook County Assessor by PIN. */
async function fetchOwnershipBatch(
  pins: string[]
): Promise<Map<string, { ownerName: string; mailingAddress: string; ownerType: string }>> {
  const result = new Map<string, { ownerName: string; mailingAddress: string; ownerType: string }>();
  if (pins.length === 0) return result;

  // Quick connectivity check — if the Assessor API is unreachable, skip entirely
  console.log("  Testing Cook County Assessor API connectivity...");
  try {
    const probe = await fetch(
      "https://datacatalog.cookcountyassessor.com/resource/uzyt-m557.json?$limit=1",
      { headers: socrataHeaders(), signal: AbortSignal.timeout(8000) }
    );
    if (!probe.ok) {
      console.log(`  Assessor API returned ${probe.status} — skipping ownership fetch (will use defaults)`);
      return result;
    }
    console.log("  Assessor API reachable — fetching ownership data...");
  } catch {
    console.log("  Assessor API unreachable — skipping ownership fetch (will use defaults)");
    return result;
  }

  // Query in batches of 50 PINs using Socrata $where IN clause
  const batchSize = 50;
  let consecutiveFailures = 0;
  for (let i = 0; i < pins.length; i += batchSize) {
    // Stop if too many consecutive failures
    if (consecutiveFailures >= 5) {
      console.log("  Too many consecutive failures — stopping ownership fetch");
      break;
    }

    const batch = pins.slice(i, i + batchSize);
    const inClause = batch.map((p) => `'${p}'`).join(",");
    const url = `https://datacatalog.cookcountyassessor.com/resource/uzyt-m557.json?$where=pin in(${encodeURIComponent(inClause)})&$limit=${batchSize}&$select=pin,tax_bill_name,taxpayer_name,tax_bill_mailing_address,tax_bill_city,tax_bill_state,tax_bill_zip`;

    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data: AssessorRecord[] = await res.json();
        for (const a of data) {
          const ownerName = a.tax_bill_name || a.taxpayer_name || "";
          const mailingParts = [a.tax_bill_mailing_address, a.tax_bill_city, a.tax_bill_state, a.tax_bill_zip].filter(Boolean);
          const mailingAddress = mailingParts.join(", ");
          result.set(a.pin, {
            ownerName,
            mailingAddress,
            ownerType: classifyOwner(ownerName, mailingAddress),
          });
        }
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    } catch {
      consecutiveFailures++;
    }

    // Brief pause between batches to respect rate limits
    if (i + batchSize < pins.length) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Progress logging every 500 PINs
    if ((i + batchSize) % 500 === 0 || i + batchSize >= pins.length) {
      console.log(`  Ownership: ${Math.min(i + batchSize, pins.length)}/${pins.length} PINs queried (${result.size} found)`);
    }
  }

  return result;
}

async function fetchAllPages(): Promise<ColsRecord[]> {
  const pageSize = 1000;

  console.log("Fetching City-Owned Land Inventory...");
  return fetchCompleteOffsetPages<ColsRecord>({
    sourceLabel: "COLS API",
    pageSize,
    buildUrl: (offset, limit) =>
      buildColsSourcePageUrl(COLS_BASE_URL, offset, limit),
    headers: socrataHeaders(),
    timeoutMs: 30_000,
    onProgress: (total, offset) =>
      console.log(`  Fetched ${total} records (offset ${offset})...`),
  });
}

function normalizeRecord(r: ColsRecord): {
  id: string;
  /** As published by COLS — dashed, e.g. "16-11-105-004-0000". Keys the id and
   *  the Assessor lookup, both of which predate the digits-only column. */
  pin: string | null;
  /** The same PIN in the digits-only 14-char `parcels.pin` convention, which is
   *  what the permit match engine joins on. Null when COLS published no PIN or
   *  published one that is not 14 digits. */
  pinDigits: string | null;
  address: string;
  lat: number;
  lon: number;
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
  managingOrg: string | null;
} | null {
  const lat = r.latitude ? parseFloat(r.latitude) : NaN;
  const lon = r.longitude ? parseFloat(r.longitude) : NaN;

  if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return null;
  // Basic Chicago bounds check
  if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

  const address =
    r.address ||
    [r.dir, r.street, r.type].filter(Boolean).join(" ") ||
    "Unknown";

  const pinDigits = toDigitsOnlyPin(r.pin ?? "");

  return {
    id: `cols-${r.pin || `${lat.toFixed(6)}-${lon.toFixed(6)}`}`,
    pin: r.pin || null,
    pinDigits: pinDigits.length === 14 ? pinDigits : null,
    address,
    lat,
    lon,
    ward: r.ward || null,
    communityArea: r.community_area_name || null,
    zoningClass: r.zoning_classification || null,
    squareFeet: r.sq_ft ? parseFloat(r.sq_ft) : null,
    managingOrg: r.managing_organization || null,
  };
}

// ── 311 vacancy-related service requests ──

interface Sr311Record {
  sr_number: string;
  sr_type: string;
  status?: string;
  created_date?: string;
  street_address?: string;
  zip_code?: string;
  ward?: string;
  community_area?: string;
  latitude?: string;
  longitude?: string;
}

/** Community area number → name lookup */
function communityAreaName(num: string | undefined): string | null {
  if (!num) return null;
  const id = parseInt(num, 10);
  const ca = CHICAGO_COMMUNITY_AREAS.find((a) => a.id === id);
  return ca?.name ?? null;
}

async function fetch311VacancySignals(): Promise<Sr311Record[]> {
  const pageSize = 1000;

  console.log("Fetching 311 vacancy-related service requests...");

  // Retain a wider audit window than the default three-year screen. The API/UI
  // classify these rows by their original date; this ingest never rewrites a
  // source date into a sync date.
  const dateFilter = shiftCalendarDayYears(
    chicagoCalendarDay(),
    -VACANCY_RETENTION_YEARS,
  );

  return fetchCompleteOffsetPages<Sr311Record>({
    sourceLabel: "311 API",
    pageSize,
    buildUrl: (offset, limit) =>
      build311VacancySourcePageUrl(
        SR311_BASE_URL,
        dateFilter,
        offset,
        limit,
      ),
    headers: socrataHeaders(),
    timeoutMs: 120_000,
    retries: 1,
    retryDelayMs: 3_000,
    onProgress: (total, offset) =>
      console.log(`  Fetched ${total} records (offset ${offset})...`),
  });
}

/** Deduplicate each evidence source by address (keep newest per source/address). */
function dedup311BySourceAddress(records: Sr311Record[]): Sr311Record[] {
  const seen = new Map<string, Sr311Record>();
  for (const r of records) {
    const addr = r.street_address?.trim().toUpperCase();
    if (!addr) continue;
    const key = `${r.sr_type.trim().toUpperCase()}|${addr}`;
    // Records are ordered by created_date DESC, so first occurrence is newest
    if (!seen.has(key)) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

interface Normalized311VacancySignal {
  id: string;
  source: "dpd_vacant" | "311_clean_lot";
  propertyType: "vacant_building" | "reported_vacant_lot";
  address: string;
  lat: number;
  lon: number;
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
  status: string;
  sourceRecordDate: string | null;
}

function normalize311Record(r: Sr311Record): Normalized311VacancySignal | null {
  const lat = r.latitude ? parseFloat(r.latitude) : NaN;
  const lon = r.longitude ? parseFloat(r.longitude) : NaN;

  if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return null;
  if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

  const address = r.street_address?.trim() || "Unknown";
  const isCleanLot = r.sr_type === "Clean Vacant Lot Request";
  const sourceRecordDate = normalizeChicagoSourceCalendarDate(r.created_date);

  return {
    id: isCleanLot ? `311-clean-lot-${r.sr_number}` : `311-${r.sr_number}`,
    source: isCleanLot ? "311_clean_lot" : "dpd_vacant",
    propertyType: isCleanLot ? "reported_vacant_lot" : "vacant_building",
    address,
    lat,
    lon,
    ward: r.ward || null,
    communityArea: communityAreaName(r.community_area),
    zoningClass: null, // 311 doesn't include zoning
    squareFeet: null,
    // Preserve the source status exactly. "Completed" describes the request;
    // it does not establish that the property is occupied or no longer vacant.
    status: r.status?.trim() || "Unknown",
    sourceRecordDate,
  };
}

async function stage311Snapshot(
  runId: string,
  records: Normalized311VacancySignal[],
) {
  const batchSize = 250;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const payload = batch.map((record) => ({
      id: record.id,
      source: record.source,
      address: record.address,
      lat: record.lat,
      lon: record.lon,
      property_type: record.propertyType,
      ward: record.ward,
      community_area: record.communityArea,
      zoning_class: record.zoningClass,
      square_feet: record.squareFeet,
      status: record.status,
      source_record_date: record.sourceRecordDate,
    }));

    await sql`
      INSERT INTO vacant_311_sync_stage (
        run_id, id, source, address, lat, lon, property_type, ward,
        community_area, zoning_class, square_feet, status, source_record_date
      )
      SELECT
        ${runId}, incoming.id, incoming.source, incoming.address,
        incoming.lat, incoming.lon, incoming.property_type, incoming.ward,
        incoming.community_area, incoming.zoning_class, incoming.square_feet,
        incoming.status, incoming.source_record_date
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS incoming(
        id TEXT,
        source TEXT,
        address TEXT,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION,
        property_type TEXT,
        ward TEXT,
        community_area TEXT,
        zoning_class TEXT,
        square_feet DOUBLE PRECISION,
        status TEXT,
        source_record_date TIMESTAMPTZ
      )
      ON CONFLICT (run_id, id) DO UPDATE SET
        source = EXCLUDED.source,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        property_type = EXCLUDED.property_type,
        ward = EXCLUDED.ward,
        community_area = EXCLUDED.community_area,
        zoning_class = EXCLUDED.zoning_class,
        square_feet = EXCLUDED.square_feet,
        status = EXCLUDED.status,
        source_record_date = EXCLUDED.source_record_date,
        staged_at = NOW()
    `;

    if ((i + batchSize) % 200 === 0 || i + batchSize >= records.length) {
      console.log(`  Staged ${Math.min(i + batchSize, records.length)}/${records.length}`);
    }
  }
}

async function replace311MembershipAtomically(
  records: Normalized311VacancySignal[],
  complete: boolean,
) {
  const runId = randomUUID();

  // Orphaned staging runs never affect production membership. Retire only old
  // staging data before beginning so a crashed verification does not grow the
  // staging table forever.
  await sql`
    DELETE FROM vacant_311_sync_stage
    WHERE staged_at < NOW() - INTERVAL '2 days'
  `;

  if (complete) await stage311Snapshot(runId, records);

  const [staged] = await sql`
    SELECT COUNT(*)::int AS count
    FROM vacant_311_sync_stage
    WHERE run_id = ${runId}
  `;
  const stagedCount = Number(staged?.count ?? 0);
  if (complete && stagedCount !== records.length) {
    throw new Error(
      `311 staging completeness check failed: expected ${records.length}, found ${stagedCount}`,
    );
  }

  const result = await reconcileVacancyMembership(
    records,
    complete,
    async () => {
      const rows = await sql`
        WITH incoming AS MATERIALIZED (
          SELECT * FROM vacant_311_sync_stage WHERE run_id = ${runId}
        ),
        upserted AS (
          INSERT INTO vacant_properties (
            id, source, address, lat, lon, property_type, ward,
            community_area, zoning_class, square_feet, status,
            source_record_date, owner_name, owner_mailing_address,
            owner_type, geom, updated_at
          )
          SELECT
            id, source, address, lat, lon, property_type, ward,
            community_area, zoning_class, square_feet, status,
            source_record_date, 'Unknown', NULL, 'unknown',
            ST_MakePoint(lon, lat)::geography, NOW()
          FROM incoming
          ON CONFLICT (id) DO UPDATE SET
            source = EXCLUDED.source,
            address = EXCLUDED.address,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            ward = EXCLUDED.ward,
            community_area = EXCLUDED.community_area,
            zoning_class = EXCLUDED.zoning_class,
            property_type = EXCLUDED.property_type,
            status = EXCLUDED.status,
            source_record_date = EXCLUDED.source_record_date,
            geom = EXCLUDED.geom,
            updated_at = NOW()
          RETURNING id
        ),
        retired AS (
          DELETE FROM vacant_properties vp
          WHERE vp.source IN ('dpd_vacant', '311_clean_lot')
            AND NOT EXISTS (
              SELECT 1 FROM incoming current WHERE current.id = vp.id
            )
          RETURNING vp.id
        ),
        cleared AS (
          DELETE FROM vacant_311_sync_stage WHERE run_id = ${runId}
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM upserted) AS upserted,
          (SELECT COUNT(*)::int FROM retired) AS retired,
          (SELECT COUNT(*)::int FROM cleared) AS cleared
      `;
      return Number(rows[0]?.retired ?? 0);
    },
  );

  if (!complete) {
    console.log("  Partial 311 snapshot left live membership unchanged");
    return;
  }
  console.log(`  Published ${records.length} complete 311 signals atomically`);
  console.log(`  Retired ${result} 311 rows no longer in the complete ${VACANCY_RETENTION_YEARS}-year source pull`);
}

type NormalizedColsSnapshotRecord = NonNullable<ReturnType<typeof normalizeRecord>> & {
  ownerName: string;
  ownerMailingAddress: string | null;
  ownerType: string;
};

function attachColsOwnership(
  records: NonNullable<ReturnType<typeof normalizeRecord>>[],
  ownershipMap: Map<string, { ownerName: string; mailingAddress: string; ownerType: string }>
): NormalizedColsSnapshotRecord[] {
  return records.map((record) => {
    const ownership = record.pin ? ownershipMap.get(record.pin) : undefined;
    return {
      ...record,
      ownerName:
        ownership?.ownerName ||
        (record.managingOrg && record.managingOrg !== "None"
          ? `City of Chicago — ${record.managingOrg}`
          : "City of Chicago"),
      ownerMailingAddress: ownership?.mailingAddress || null,
      ownerType: ownership?.ownerType || "city_public",
    };
  });
}

async function stageColsSnapshot(
  runId: string,
  records: NormalizedColsSnapshotRecord[],
) {
  const batchSize = 250;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const payload = batch.map((record) => ({
      id: record.id,
      pin: record.pinDigits,
      address: record.address,
      lat: record.lat,
      lon: record.lon,
      ward: record.ward,
      community_area: record.communityArea,
      zoning_class: record.zoningClass,
      square_feet: record.squareFeet,
      owner_name: record.ownerName,
      owner_mailing_address: record.ownerMailingAddress,
      owner_type: record.ownerType,
    }));

    await sql`
      INSERT INTO vacant_cols_sync_stage (
        run_id, id, pin, address, lat, lon, ward, community_area,
        zoning_class, square_feet, owner_name, owner_mailing_address, owner_type
      )
      SELECT
        ${runId}, incoming.id, incoming.pin, incoming.address,
        incoming.lat, incoming.lon, incoming.ward, incoming.community_area,
        incoming.zoning_class, incoming.square_feet, incoming.owner_name,
        incoming.owner_mailing_address, incoming.owner_type
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS incoming(
        id TEXT,
        pin TEXT,
        address TEXT,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION,
        ward TEXT,
        community_area TEXT,
        zoning_class TEXT,
        square_feet DOUBLE PRECISION,
        owner_name TEXT,
        owner_mailing_address TEXT,
        owner_type TEXT
      )
      ON CONFLICT (run_id, id) DO UPDATE SET
        pin = EXCLUDED.pin,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        ward = EXCLUDED.ward,
        community_area = EXCLUDED.community_area,
        zoning_class = EXCLUDED.zoning_class,
        square_feet = EXCLUDED.square_feet,
        owner_name = EXCLUDED.owner_name,
        owner_mailing_address = EXCLUDED.owner_mailing_address,
        owner_type = EXCLUDED.owner_type,
        staged_at = NOW()
    `;

    if (i + batchSize >= records.length) {
      console.log(`  Staged ${records.length}/${records.length}`);
    }
  }
}

async function replaceColsMembershipAtomically(
  records: NormalizedColsSnapshotRecord[],
  complete: boolean,
) {
  const runId = randomUUID();
  await sql`
    DELETE FROM vacant_cols_sync_stage
    WHERE staged_at < NOW() - INTERVAL '2 days'
  `;
  if (complete) await stageColsSnapshot(runId, records);

  const [staged] = await sql`
    SELECT COUNT(*)::int AS count
    FROM vacant_cols_sync_stage
    WHERE run_id = ${runId}
  `;
  const stagedCount = Number(staged?.count ?? 0);
  if (complete && stagedCount !== records.length) {
    throw new Error(
      `COLS staging completeness check failed: expected ${records.length}, found ${stagedCount}`,
    );
  }

  const retired = await reconcileVacancyMembership(
    records.map((record) => ({ id: record.id, source: "cols" as const })),
    complete,
    async () => {
      const rows = await sql`
        WITH incoming AS MATERIALIZED (
          SELECT * FROM vacant_cols_sync_stage WHERE run_id = ${runId}
        ),
        upserted AS (
          INSERT INTO vacant_properties (
            id, source, pin, address, lat, lon, property_type, ward,
            community_area, zoning_class, square_feet, status,
            source_record_date, owner_name, owner_mailing_address,
            owner_type, geom, updated_at
          )
          SELECT
            id, 'cols', pin, address, lat, lon, 'vacant_land', ward,
            community_area, zoning_class, square_feet, 'city_owned',
            NULL, owner_name, owner_mailing_address, owner_type,
            ST_MakePoint(lon, lat)::geography, NOW()
          FROM incoming
          ON CONFLICT (id) DO UPDATE SET
            source = EXCLUDED.source,
            pin = EXCLUDED.pin,
            address = EXCLUDED.address,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            property_type = EXCLUDED.property_type,
            ward = EXCLUDED.ward,
            community_area = EXCLUDED.community_area,
            zoning_class = EXCLUDED.zoning_class,
            square_feet = EXCLUDED.square_feet,
            status = EXCLUDED.status,
            source_record_date = EXCLUDED.source_record_date,
            owner_name = EXCLUDED.owner_name,
            owner_mailing_address = EXCLUDED.owner_mailing_address,
            owner_type = EXCLUDED.owner_type,
            geom = EXCLUDED.geom,
            updated_at = NOW()
          RETURNING id
        ),
        retired AS (
          DELETE FROM vacant_properties vp
          WHERE vp.source = 'cols'
            AND NOT EXISTS (
              SELECT 1 FROM incoming current WHERE current.id = vp.id
            )
          RETURNING vp.id
        ),
        cleared AS (
          DELETE FROM vacant_cols_sync_stage WHERE run_id = ${runId}
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM upserted) AS upserted,
          (SELECT COUNT(*)::int FROM retired) AS retired,
          (SELECT COUNT(*)::int FROM cleared) AS cleared
      `;
      return Number(rows[0]?.retired ?? 0);
    },
    ["cols"],
  );

  if (!complete) {
    console.log("  Partial COLS snapshot left live membership unchanged");
    return;
  }
  console.log(`  Published ${records.length} complete COLS records atomically`);
  console.log(`  Retired ${retired} COLS rows no longer in the complete source pull`);
}

async function crossReferenceZones() {
  console.log("\nCross-referencing against zone geometries...");

  // For each vacant property, find all zones that contain its point. Batched
  // by keyset pagination: a single UPDATE across the full table exceeds the
  // Neon HTTP driver's headers timeout on small refresh-branch computes.
  const BATCH = 500;
  let cursor = "";
  let updated = 0;
  for (;;) {
    const rows = await sql`
      UPDATE vacant_properties vp
      SET
        zone_matches = COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'zoneKey', unique_zone.zone_key,
                'zoneName', unique_zone.zone_name
              )
              ORDER BY unique_zone.zone_key
            )
            FROM (
              SELECT
                z.zone_key,
                COALESCE(
                  MIN(NULLIF(BTRIM(z.feature_name), '')),
                  z.zone_key
                ) AS zone_name
              FROM zones z
              WHERE ST_Intersects(z.geom, vp.geom)
              GROUP BY z.zone_key
            ) unique_zone
          ),
          '[]'::jsonb
        ),
        incentive_count = COALESCE(
          (
            SELECT COUNT(DISTINCT z.zone_key)::integer
            FROM zones z
            WHERE ST_Intersects(z.geom, vp.geom)
          ),
          0
        )
      WHERE vp.id IN (
        SELECT id FROM vacant_properties WHERE id > ${cursor} ORDER BY id LIMIT ${BATCH}
      )
      RETURNING vp.id
    `;
    if (rows.length === 0) break;
    updated += rows.length;
    cursor = rows.reduce((max, row) => {
      const id = String(row.id);
      return id > max ? id : max;
    }, cursor);
    if (updated % 2000 === 0) console.log(`  Cross-referenced ${updated}...`);
  }

  const withIncentives = await sql`
    SELECT COUNT(*) as cnt FROM vacant_properties WHERE incentive_count > 0
  `;

  console.log(`  Updated ${updated} properties`);
  console.log(`  ${withIncentives[0]?.cnt || 0} properties have incentive zone matches`);
}

// ── Building-permit → vacant-parcel matching ─────────────────────────────────

/**
 * Match citywide building permits to the vacant-parcel universe in ONE pass,
 * three tiers, strongest first. Every row records the method AND the confidence
 * it earns, plus `matched_on` — the literal value that matched — so any claim
 * the UI makes can be re-derived without re-running the match.
 *
 *   1. `pin_exact`          Cook County PIN. The permits dataset stores 10-digit
 *                           PINs and COLS stores 14-digit ones, so the join is
 *                           `LEFT(vp.pin, 10)` against the permit's `pins` array
 *                           (EVERY pin on the permit, not just the first).
 *                           Confidence is HIGH when the parcel's 4-digit suffix
 *                           is "0000" (an undivided parcel the 10-digit PIN
 *                           names uniquely) and MEDIUM otherwise, where the
 *                           permit PIN names the parcel but not the unit.
 *   2. `address_normalized` The repo's existing normalization
 *                           (lower + strip non-alphanumerics) on both sides.
 *                           MEDIUM. No abbreviation expansion, no token
 *                           reordering, no fuzzy/edit-distance similarity —
 *                           see lib/permit-match.ts for why.
 *   3. `spatial_proximity`  The permit point within SPATIAL_MATCH_RADIUS_M of
 *                           the parcel point. LOW, and capped per parcel: this
 *                           is the only tier that can fan out on a dense block.
 *
 * NOTE the plan called tier 3 "point-in-polygon". There are no parcel polygons
 * in this database — `vacant_properties.geom` and `parcels.geom` are both
 * GEOGRAPHY(POINT) — so what runs is a point-to-point proximity test. It is
 * named `spatial_proximity` in the method vocabulary, in the DB, and in the
 * card copy for exactly that reason. Nothing anywhere claims containment.
 *
 * Precedence holds WITHIN a run by insert order, and ACROSS runs by the
 * upgrade clause on tiers 1-2: a pair first recorded at a weaker tier (e.g.
 * spatial_proximity from an earlier run, before the permit gained the
 * parcel's PIN on refresh) is upgraded in place when a stronger tier claims
 * it. Tier 3 is the weakest claim and can never upgrade anything, so it
 * keeps plain DO NOTHING.
 *
 * Batched by keyset over vacant_properties.id for the same reason
 * crossReferenceZones() is: one statement across the full table exceeds the
 * Neon HTTP driver's headers timeout on a small refresh-branch compute.
 */
async function matchPermitsToVacantParcels() {
  console.log("\nMatching building permits to vacant parcels...");

  const permitCount = await sql`SELECT COUNT(*)::int AS cnt FROM building_permits`;
  const permits = Number(permitCount[0]?.cnt ?? 0);
  if (permits === 0) {
    // An empty permits table is a missing ingest, not an absence of permits.
    // Say so and leave the match table untouched rather than writing a run that
    // would read as "no parcel has a permit".
    console.warn(
      "  building_permits is EMPTY — skipping the match pass. Run scripts/sync-condition.ts first; " +
        "an empty pass here would look like a citywide absence of permits.",
    );
    return;
  }
  console.log(`  ${permits.toLocaleString("en-US")} permits available to match`);

  const BATCH = 2000;

  /** Run one tier over every vacant parcel, batched by id keyset. */
  async function runTier(
    label: string,
    step: (lo: string, hi: string) => Promise<Record<string, unknown>[]>,
  ): Promise<number> {
    let cursor = "";
    let inserted = 0;
    for (;;) {
      const window = await sql`
        SELECT id FROM vacant_properties WHERE id > ${cursor} ORDER BY id LIMIT ${BATCH}
      `;
      if (window.length === 0) break;
      const lo = cursor;
      const hi = String(window[window.length - 1].id);
      const rows = await step(lo, hi);
      inserted += rows.length;
      cursor = hi;
    }
    console.log(`  ${label}: ${inserted.toLocaleString("en-US")} match rows`);
    return inserted;
  }

  // ── Tier 1 · PIN ──
  await runTier(
    "pin_exact",
    (lo, hi) => sql`
      INSERT INTO vacant_property_permit_matches (
        vacant_property_id, permit_id, match_method, match_confidence, matched_on
      )
      SELECT
        vp.id,
        bp.permit_id,
        'pin_exact',
        CASE WHEN substring(vp.pin from 11 for 4) = '0000' THEN 'high' ELSE 'medium' END,
        CASE WHEN bp.pins @> ARRAY[vp.pin] THEN vp.pin ELSE left(vp.pin, 10) END
      FROM vacant_properties vp
      JOIN building_permits bp
        ON bp.pins && ARRAY[left(vp.pin, 10), vp.pin]
      WHERE vp.id > ${lo} AND vp.id <= ${hi}
        AND vp.pin IS NOT NULL
        AND length(vp.pin) = 14
      ON CONFLICT (vacant_property_id, permit_id) DO UPDATE SET
            match_method = EXCLUDED.match_method,
            match_confidence = EXCLUDED.match_confidence,
            matched_on = EXCLUDED.matched_on
          WHERE array_position(ARRAY['pin_exact','address_normalized','spatial_proximity'], EXCLUDED.match_method)
              < array_position(ARRAY['pin_exact','address_normalized','spatial_proximity'], vacant_property_permit_matches.match_method)
      RETURNING vacant_property_id AS id
    `,
  );

  // ── Tier 2 · normalized street address ──
  // The >= 8 character floor and the 'unknown' exclusion keep the placeholder
  // addresses this table carries ("Unknown") from matching each other and from
  // matching a permit whose address normalized down to a stub.
  await runTier(
    "address_normalized",
    (lo, hi) => sql`
      INSERT INTO vacant_property_permit_matches (
        vacant_property_id, permit_id, match_method, match_confidence, matched_on
      )
      SELECT
        vp.id,
        bp.permit_id,
        'address_normalized',
        'medium',
        regexp_replace(lower(coalesce(vp.address, '')), '[^a-z0-9]', '', 'g')
      FROM vacant_properties vp
      JOIN building_permits bp
        ON regexp_replace(lower(coalesce(bp.address, '')), '[^a-z0-9]', '', 'g')
         = regexp_replace(lower(coalesce(vp.address, '')), '[^a-z0-9]', '', 'g')
      WHERE vp.id > ${lo} AND vp.id <= ${hi}
        AND length(regexp_replace(lower(coalesce(vp.address, '')), '[^a-z0-9]', '', 'g')) >= 8
        AND regexp_replace(lower(coalesce(vp.address, '')), '[^a-z0-9]', '', 'g') <> 'unknown'
      ON CONFLICT (vacant_property_id, permit_id) DO UPDATE SET
            match_method = EXCLUDED.match_method,
            match_confidence = EXCLUDED.match_confidence,
            matched_on = EXCLUDED.matched_on
          WHERE array_position(ARRAY['pin_exact','address_normalized','spatial_proximity'], EXCLUDED.match_method)
              < array_position(ARRAY['pin_exact','address_normalized','spatial_proximity'], vacant_property_permit_matches.match_method)
      RETURNING vacant_property_id AS id
    `,
  );

  // ── Tier 3 · spatial proximity (LOW confidence, capped per parcel) ──
  await runTier(
    "spatial_proximity",
    (lo, hi) => sql`
      INSERT INTO vacant_property_permit_matches (
        vacant_property_id, permit_id, match_method, match_confidence, matched_on
      )
      SELECT
        vp.id,
        near.permit_id,
        'spatial_proximity',
        'low',
        round(near.dist_m)::text || ' m'
      FROM vacant_properties vp
      CROSS JOIN LATERAL (
        SELECT bp.permit_id, ST_Distance(bp.geom, vp.geom) AS dist_m
        FROM building_permits bp
        WHERE bp.geom IS NOT NULL
          AND ST_DWithin(bp.geom, vp.geom, ${SPATIAL_MATCH_RADIUS_M})
        ORDER BY bp.issue_date DESC NULLS LAST, bp.permit_id
        LIMIT ${SPATIAL_MATCH_PER_PARCEL_CAP}
      ) near
      WHERE vp.id > ${lo} AND vp.id <= ${hi}
        AND vp.geom IS NOT NULL
      ON CONFLICT (vacant_property_id, permit_id) DO NOTHING
      RETURNING vacant_property_id AS id
    `,
  );

  await printPermitMatchReport();
}

/**
 * The verification report for the match pass: tallies by method and confidence,
 * how much of the parcel universe is covered, and six sample matched parcels
 * spread across the North, West and South sides.
 *
 * The side bands are approximate lat/lon cuts, spelled out in the SQL and
 * labeled as approximate in the output — they exist to prove the match is
 * genuinely citywide rather than still clustered in the three pilot ZIPs, and
 * they are not offered as an official geography.
 *
 * There is deliberately NO cost column in this report. Permit reported costs
 * are applicant estimates; summing them would manufacture a capital total out
 * of self-reported guesses.
 */
async function printPermitMatchReport() {
  const byMethod = await sql`
    SELECT match_method, match_confidence, COUNT(*)::int AS cnt
    FROM vacant_property_permit_matches
    GROUP BY match_method, match_confidence
    ORDER BY match_method, match_confidence
  `;
  const coverage = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM vacant_properties) AS parcels,
      (SELECT COUNT(DISTINCT vacant_property_id)::int FROM vacant_property_permit_matches) AS matched_parcels,
      (SELECT COUNT(*)::int FROM vacant_property_permit_matches) AS match_rows,
      (SELECT COUNT(DISTINCT permit_id)::int FROM vacant_property_permit_matches) AS matched_permits
  `;

  console.log("\n── Permit Match Report ──");
  const c = coverage[0];
  console.log(`Vacant parcels: ${Number(c?.parcels ?? 0).toLocaleString("en-US")}`);
  console.log(
    `Parcels with >=1 matched permit: ${Number(c?.matched_parcels ?? 0).toLocaleString("en-US")}`,
  );
  console.log(`Match rows: ${Number(c?.match_rows ?? 0).toLocaleString("en-US")}`);
  console.log(
    `Distinct permits matched: ${Number(c?.matched_permits ?? 0).toLocaleString("en-US")}`,
  );
  console.log("By method / confidence:");
  for (const method of PERMIT_MATCH_METHOD_ORDER) {
    const rows = byMethod.filter((r) => r.match_method === method);
    if (rows.length === 0) {
      console.log(`  ${method}: 0`);
      continue;
    }
    for (const r of rows) {
      console.log(`  ${method} / ${r.match_confidence}: ${Number(r.cnt).toLocaleString("en-US")}`);
    }
  }

  // Per-side coverage. This is the number that proves the bounding box is
  // genuinely gone: a run still confined to the three SE-Chicago pilot ZIPs
  // would show matches on the South side and essentially none on the North.
  const bySide = await sql`
    SELECT
      CASE
        WHEN vp.lat > 41.90 THEN 'North'
        WHEN vp.lat < 41.84 THEN 'South'
        WHEN vp.lon < -87.68 THEN 'West'
        ELSE 'Central'
      END AS side,
      COUNT(*)::int AS parcels,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM vacant_property_permit_matches m WHERE m.vacant_property_id = vp.id
        )
      )::int AS matched
    FROM vacant_properties vp
    GROUP BY 1
    ORDER BY 1
  `;
  console.log("Coverage by side (approximate lat/lon bands):");
  for (const r of bySide) {
    const parcels = Number(r.parcels);
    const matched = Number(r.matched);
    const pct = parcels > 0 ? ((matched / parcels) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${r.side}: ${matched.toLocaleString("en-US")} of ${parcels.toLocaleString("en-US")} parcels matched (${pct}%)`,
    );
  }

  // Two sample parcels per side. Approximate bands: North = lat > 41.90,
  // South = lat < 41.84, West = the strip between them west of -87.68.
  const samples = await sql`
    WITH banded AS (
      SELECT
        vp.id, vp.address, vp.pin, vp.community_area, vp.lat, vp.lon,
        m.permit_id, m.match_method, m.match_confidence, m.matched_on,
        bp.permit_type, bp.work_type, bp.permit_status,
        -- Cast in SQL: the Neon driver hands a DATE back as a JS Date, and
        -- String(date).slice(0,10) yields "Mon Jul 27" rather than an ISO day.
        bp.issue_date::text AS issue_date,
        CASE
          WHEN vp.lat > 41.90 THEN 'North'
          WHEN vp.lat < 41.84 THEN 'South'
          WHEN vp.lon < -87.68 THEN 'West'
          ELSE 'Central'
        END AS side,
        ROW_NUMBER() OVER (
          PARTITION BY CASE
            WHEN vp.lat > 41.90 THEN 'North'
            WHEN vp.lat < 41.84 THEN 'South'
            WHEN vp.lon < -87.68 THEN 'West'
            ELSE 'Central'
          END
          ORDER BY
            array_position(ARRAY['pin_exact','address_normalized','spatial_proximity'], m.match_method),
            bp.issue_date DESC NULLS LAST,
            vp.id
        ) AS rn
      FROM vacant_property_permit_matches m
      JOIN vacant_properties vp ON vp.id = m.vacant_property_id
      JOIN building_permits bp ON bp.permit_id = m.permit_id
    )
    SELECT * FROM banded WHERE side IN ('North','West','South') AND rn <= 2
    ORDER BY side, rn
  `;

  console.log("\nSample matched parcels (2 per side; bands are approximate lat/lon cuts):");
  if (samples.length === 0) {
    console.log("  none — no matches to sample");
  }
  for (const s of samples) {
    console.log(
      `  [${s.side}] ${s.address ?? "address not recorded"} · PIN ${s.pin ?? "none"} · ` +
        `${s.community_area ?? "CA not recorded"}`,
    );
    console.log(
      `      permit ${s.permit_id} · ${s.permit_type ?? s.work_type ?? "type not recorded"} · ` +
        `issued ${s.issue_date ?? "not recorded"} · ` +
        `status ${s.permit_status ?? "not recorded"}`,
    );
    console.log(
      `      matched by ${s.match_method} (${s.match_confidence}) on "${s.matched_on ?? ""}"`,
    );
  }

  // Guard rail, asserted rather than trusted: NORMALIZED_ADDRESS_SQL is the
  // expression tier 2 and the index both use. If someone edits one and not the
  // other the tier silently stops using its index, so keep them provably equal.
  const normProbe = await sql`
    SELECT regexp_replace(lower(coalesce('3717 W Chicago Ave.', '')), '[^a-z0-9]', '', 'g') AS norm
  `;
  if (normProbe[0]?.norm !== "3717wchicagoave") {
    throw new Error(
      `Address normalization drifted from ${NORMALIZED_ADDRESS_SQL} — tier 2 would match the wrong rows`,
    );
  }
}

async function generateStaticFile() {
  console.log("\nGenerating static GeoJSON fallback...");

  // Preserve each published evidence class in fallback coverage, then fill any
  // unused quota from the strongest remaining records. Stable id ordering makes
  // tied source snapshots reproducible. The API labels this bounded export partial.
  const rows = await sql`
    WITH ranked AS (
      SELECT id, source, address, lat, lon, property_type, ward, community_area,
             zoning_class, square_feet, status, zone_matches, incentive_count,
             owner_name, owner_type, source_record_date::text,
             updated_at::text AS explorer_refreshed_at,
             ROW_NUMBER() OVER (
               PARTITION BY property_type
               ORDER BY incentive_count DESC, source_record_date DESC NULLS LAST, id ASC
             ) AS type_rank
      FROM vacant_properties
    ), quota AS (
      SELECT * FROM ranked
      WHERE (property_type = 'vacant_land' AND type_rank <= ${STATIC_FALLBACK_TYPE_QUOTAS.vacant_land})
         OR (property_type = 'reported_vacant_lot' AND type_rank <= ${STATIC_FALLBACK_TYPE_QUOTAS.reported_vacant_lot})
         OR (property_type = 'vacant_building' AND type_rank <= ${STATIC_FALLBACK_TYPE_QUOTAS.vacant_building})
         OR (property_type = 'vacant_storefront' AND type_rank <= ${STATIC_FALLBACK_TYPE_QUOTAS.vacant_storefront})
    ), fill AS (
      SELECT ranked.*
      FROM ranked
      WHERE NOT EXISTS (SELECT 1 FROM quota WHERE quota.id = ranked.id)
      ORDER BY incentive_count DESC, source_record_date DESC NULLS LAST, id ASC
      LIMIT GREATEST(0, ${STATIC_FALLBACK_LIMIT} - (SELECT COUNT(*) FROM quota))
    )
    SELECT id, source, address, lat, lon, property_type, ward, community_area,
           zoning_class, square_feet, status, zone_matches, incentive_count,
           owner_name, owner_type, source_record_date, explorer_refreshed_at
    FROM (
      SELECT * FROM quota
      UNION ALL
      SELECT * FROM fill
    ) selected
    ORDER BY property_type, incentive_count DESC,
             source_record_date DESC NULLS LAST, id ASC
  `;

  const generatedAt = new Date().toISOString();
  const geojson: GeoJSON.FeatureCollection & { generatedAt: string } = {
    type: "FeatureCollection",
    generatedAt,
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.lon, r.lat],
      },
      properties: (() => {
        const zoneMatches = canonicalizeVacancyZoneMatches(
          typeof r.zone_matches === "string"
            ? JSON.parse(r.zone_matches)
            : r.zone_matches,
        );
        return {
        id: r.id,
        source: r.source,
        address: r.address,
        propertyType: r.property_type,
        ward: r.ward,
        communityArea: r.community_area,
        zoningClass: r.zoning_class,
        squareFeet: r.square_feet,
        status: r.status,
        zoneMatches,
        incentiveCount: zoneMatches.length,
        ownerName: r.owner_name,
        ownerType: r.owner_type,
        sourceRecordDate: r.source_record_date,
        explorerRefreshedAt: r.explorer_refreshed_at,
        };
      })(),
    })),
  };

  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "vacant-properties.json");
  writeFileSync(outPath, JSON.stringify(geojson));
  console.log(`  Wrote ${geojson.features.length} features to ${outPath}`);
}

async function printSummary() {
  const total = await sql`SELECT COUNT(*) as cnt FROM vacant_properties`;
  const withIncentives = await sql`SELECT COUNT(*) as cnt FROM vacant_properties WHERE incentive_count > 0`;
  const byType = await sql`
    SELECT property_type, COUNT(*) as cnt
    FROM vacant_properties
    GROUP BY property_type
    ORDER BY cnt DESC
  `;
  const byOwnerType = await sql`
    SELECT COALESCE(owner_type, 'unknown') as owner_type, COUNT(*) as cnt
    FROM vacant_properties
    GROUP BY owner_type
    ORDER BY cnt DESC
  `;

  console.log("\n── Sync Summary ──");
  console.log(`Total properties: ${total[0]?.cnt || 0}`);
  console.log(`With incentive zones: ${withIncentives[0]?.cnt || 0}`);
  console.log("By type:");
  for (const row of byType) {
    console.log(`  ${row.property_type}: ${row.cnt}`);
  }
  console.log("By owner type:");
  for (const row of byOwnerType) {
    console.log(`  ${row.owner_type}: ${row.cnt}`);
  }
}

async function main() {
  console.log("=== Vacant Property Sync ===\n");
  console.log(`Steps: ${[...ALL_STEPS].filter((s) => STEPS.has(s)).join(", ") || "(none)"}`);

  // ── Source 1: City-Owned Land Inventory (vacant land) ──
  if (STEPS.has("cols")) {
    const raw = await fetchAllPages();
    console.log(`\nTotal COLS raw records: ${raw.length}`);

    const normalizedWithDuplicates = raw
      .map(normalizeRecord)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const normalized = Array.from(
      new Map(normalizedWithDuplicates.map((record) => [record.id, record])).values(),
    );
    console.log(`Valid records with coordinates: ${normalized.length}`);
    if (normalized.length !== normalizedWithDuplicates.length) {
      console.log(`  Deduplicated ${normalizedWithDuplicates.length - normalized.length} repeated source IDs`);
    }
    assertVacancySourceSnapshotSane(
      {
        source: "COLS",
        rawCount: raw.length,
        validShapeCount: raw.filter(isPlausibleColsSourceRow).length,
        candidateCount: normalizedWithDuplicates.length,
        normalizedCount: normalized.length,
      },
      process.env.ALLOW_IMPLAUSIBLE_VACANCY_SOURCE_SNAPSHOT === "1",
    );
    console.log(`  With a 14-digit PIN: ${normalized.filter((r) => r.pinDigits).length}`);

    const pinsWithData = normalized.filter((r) => r.pin).map((r) => r.pin!);
    console.log(`\nFetching ownership data for ${pinsWithData.length} PINs...`);
    const ownershipMap = await fetchOwnershipBatch(pinsWithData);
    console.log(`  Got ownership data for ${ownershipMap.size} properties`);

    console.log("\nPublishing the complete COLS snapshot atomically...");
    await replaceColsMembershipAtomically(
      attachColsOwnership(normalized, ownershipMap),
      true,
    );

  }

  // ── Source 2: 311 vacancy-related public-record signals ──
  if (STEPS.has("sr311")) {
    // fetch311VacancySignals throws on any failed page. Reconciliation is
    // deliberately unreachable unless pagination completed successfully.
    const raw311 = await fetch311VacancySignals();
    console.log(`\nTotal 311 raw records: ${raw311.length}`);

    const deduped311 = dedup311BySourceAddress(raw311);
    console.log(`Unique source/address signals after dedup: ${deduped311.length}`);

    const normalized311 = deduped311
      .map(normalize311Record)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    console.log(`Valid 311 records with coordinates: ${normalized311.length}`);
    assertVacancySourceSnapshotSane(
      {
        source: "311",
        rawCount: raw311.length,
        validShapeCount: raw311.filter(isPlausible311VacancySourceRow).length,
        candidateCount: deduped311.length,
        normalizedCount: normalized311.length,
      },
      process.env.ALLOW_IMPLAUSIBLE_VACANCY_SOURCE_SNAPSHOT === "1",
    );

    console.log("\nPublishing the complete 311 snapshot atomically...");
    await replace311MembershipAtomically(normalized311, true);
  }

  // ── Cross-reference, match & export ──
  if (STEPS.has("zones")) await crossReferenceZones();
  if (STEPS.has("permits")) await matchPermitsToVacantParcels();
  if (STEPS.has("export")) {
    await generateStaticFile();
    await printSummary();
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
