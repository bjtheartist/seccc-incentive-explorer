#!/usr/bin/env npx tsx
/**
 * Sync vacant properties from Chicago's City-Owned Land Inventory (Socrata).
 * Upserts into vacant_properties table, cross-references against zone geometries,
 * and generates a static GeoJSON fallback file.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-vacant-properties.ts
 */

import { neon } from "@neondatabase/serverless";
import { socrataHeaders } from "../lib/socrata";
import { classifyOwner } from "../lib/owner-classify";
import { CHICAGO_COMMUNITY_AREAS } from "../lib/community-areas";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const args = process.argv.slice(2);
const skipCols = args.includes("--skip-cols");
const skip311Buildings = args.includes("--skip-311-buildings");
const exportOnly = args.includes("--export-only");

// City-Owned Land Inventory — Socrata dataset
const COLS_DATASET_ID = "aksk-kvfp";
const COLS_BASE_URL = `https://data.cityofchicago.org/resource/${COLS_DATASET_ID}.json`;

// 311 Service Requests — vacancy-related reports
const SR311_DATASET_ID = "v6vf-nfxy";
const SR311_BASE_URL = `https://data.cityofchicago.org/resource/${SR311_DATASET_ID}.json`;
const SR311_VACANT_BUILDING_TYPE = "Vacant/Abandoned Building Complaint";
const SR311_CLEAN_VACANT_LOT_TYPE = "Clean Vacant Lot Request";

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
  const all: ColsRecord[] = [];
  const pageSize = 1000;
  let offset = 0;

  console.log("Fetching City-Owned Land Inventory...");

  while (true) {
    const url = `${COLS_BASE_URL}?$limit=${pageSize}&$offset=${offset}&$order=pin`;
    const res = await fetch(url, {
      headers: socrataHeaders(),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`Socrata returned ${res.status} at offset ${offset}`);
      break;
    }

    const page: ColsRecord[] = await res.json();
    if (page.length === 0) break;

    all.push(...page);
    console.log(`  Fetched ${all.length} records (offset ${offset})...`);
    offset += pageSize;
  }

  return all;
}

function normalizeRecord(r: ColsRecord): {
  id: string;
  pin: string | null;
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

  return {
    id: `cols-${r.pin || `${lat.toFixed(6)}-${lon.toFixed(6)}`}`,
    pin: r.pin || null,
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

// ── 311 Vacant/Abandoned Building Complaints ──

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

const SR311_PAGE_SIZE = 1000;
const SR311_TIMEOUT_MS = 60000;
const SR311_WINDOW_MONTHS = 3;
const SR311_VACANT_BUILDING_YEARS = 3;
const SR311_CLEAN_VACANT_LOT_YEARS = 5;
const SR311_SELECT_FIELDS = [
  "sr_number",
  "sr_type",
  "status",
  "created_date",
  "street_address",
  "zip_code",
  "ward",
  "community_area",
  "latitude",
  "longitude",
].join(",");

/** Community area number → name lookup */
function communityAreaName(num: string | undefined): string | null {
  if (!num) return null;
  const id = parseInt(num, 10);
  const ca = CHICAGO_COMMUNITY_AREAS.find((a) => a.id === id);
  return ca?.name ?? null;
}

function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function buildDateWindows(start: Date, end: Date, months: number) {
  const windows: Array<{ start: Date; end: Date }> = [];
  let current = new Date(start);

  while (current < end) {
    const next = addMonths(current, months);
    windows.push({
      start: new Date(current),
      end: next < end ? next : new Date(end),
    });
    current = next;
  }

  return windows;
}

async function fetch311Page(url: string, label: string): Promise<Sr311Record[]> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(),
        signal: AbortSignal.timeout(SR311_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`Socrata returned ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) {
        throw new Error(`${label} failed after ${maxAttempts} attempts: ${message}`);
      }

      const delayMs = 1500 * attempt;
      console.warn(`  ${label} attempt ${attempt} failed (${message}); retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return [];
}

async function fetch311RecordsByType(
  srType: string,
  label: string,
  yearsBack: number
): Promise<Sr311Record[]> {
  const all: Sr311Record[] = [];

  console.log(`Fetching 311 ${label} (${yearsBack}-year window)...`);

  const start = new Date();
  start.setFullYear(start.getFullYear() - yearsBack);
  const end = new Date();
  end.setDate(end.getDate() + 1);

  const windows = buildDateWindows(start, end, SR311_WINDOW_MONTHS);

  for (const window of windows) {
    const windowStart = `${toDateOnly(window.start)}T00:00:00`;
    const windowEnd = `${toDateOnly(window.end)}T00:00:00`;
    let offset = 0;

    while (true) {
      const where = encodeURIComponent(
        `sr_type='${srType}' AND created_date>='${windowStart}' AND created_date<'${windowEnd}'`
      );
      const select = encodeURIComponent(SR311_SELECT_FIELDS);
      const url = `${SR311_BASE_URL}?$select=${select}&$where=${where}&$limit=${SR311_PAGE_SIZE}&$offset=${offset}`;
      const pageLabel = `311 ${label} ${toDateOnly(window.start)}..${toDateOnly(window.end)} offset ${offset}`;
      const page = await fetch311Page(url, pageLabel);

      if (page.length === 0) break;

      all.push(...page);
      console.log(
        `  Fetched ${all.length} records (${toDateOnly(window.start)}..${toDateOnly(window.end)}, offset ${offset})...`
      );

      if (page.length < SR311_PAGE_SIZE) break;
      offset += SR311_PAGE_SIZE;
    }
  }

  return all;
}

async function fetch311VacantBuildings(): Promise<Sr311Record[]> {
  return fetch311RecordsByType(
    SR311_VACANT_BUILDING_TYPE,
    "Vacant/Abandoned Building Complaints",
    SR311_VACANT_BUILDING_YEARS
  );
}

async function fetch311CleanVacantLots(): Promise<Sr311Record[]> {
  return fetch311RecordsByType(
    SR311_CLEAN_VACANT_LOT_TYPE,
    "Clean Vacant Lot Requests",
    SR311_CLEAN_VACANT_LOT_YEARS
  );
}

/** Deduplicate 311 records by address (keep newest per address). */
function dedup311ByAddress(records: Sr311Record[]): Sr311Record[] {
  const seen = new Map<string, Sr311Record>();
  const newestFirst = [...records].sort((a, b) =>
    String(b.created_date || "").localeCompare(String(a.created_date || ""))
  );

  for (const r of newestFirst) {
    const addr = r.street_address?.trim().toUpperCase();
    if (!addr) continue;
    // Records are ordered by created_date DESC, so first occurrence is newest
    if (!seen.has(addr)) {
      seen.set(addr, r);
    }
  }
  return Array.from(seen.values());
}

interface NormalizedVacantBuilding {
  id: string;
  address: string;
  lat: number;
  lon: number;
  ward: string | null;
  communityArea: string | null;
  zoningClass: string | null;
  squareFeet: number | null;
  status: string;
}

function normalize311Record(
  r: Sr311Record,
  idPrefix = "311",
  statusPrefix = "reported"
): NormalizedVacantBuilding | null {
  const lat = r.latitude ? parseFloat(r.latitude) : NaN;
  const lon = r.longitude ? parseFloat(r.longitude) : NaN;

  if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return null;
  if (lat < 41.6 || lat > 42.1 || lon < -88.0 || lon > -87.4) return null;

  const address = r.street_address?.trim() || "Unknown";

  return {
    id: `${idPrefix}-${r.sr_number}`,
    address,
    lat,
    lon,
    ward: r.ward || null,
    communityArea: communityAreaName(r.community_area),
    zoningClass: null, // 311 doesn't include zoning
    squareFeet: null,
    status: r.status?.toLowerCase() === "open" ? `${statusPrefix}_open` : statusPrefix,
  };
}

async function upsert311Batch(
  records: NormalizedVacantBuilding[],
  source: "dpd_vacant" | "311_clean_lot",
  propertyType: "vacant_building" | "reported_vacant_lot"
) {
  if (records.length === 0) return;

  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const r of batch) {
      await sql`
        INSERT INTO vacant_properties (id, source, address, lat, lon, property_type, ward, community_area, zoning_class, square_feet, status, owner_name, owner_mailing_address, owner_type, geom, updated_at)
        VALUES (
          ${r.id},
          ${source},
          ${r.address},
          ${r.lat},
          ${r.lon},
          ${propertyType},
          ${r.ward},
          ${r.communityArea},
          ${r.zoningClass},
          ${r.squareFeet},
          ${r.status},
          ${"Unknown"},
          ${null},
          ${"unknown"},
          ST_MakePoint(${r.lon}, ${r.lat})::geography,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          address = EXCLUDED.address,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          ward = EXCLUDED.ward,
          community_area = EXCLUDED.community_area,
          status = EXCLUDED.status,
          geom = EXCLUDED.geom,
          updated_at = NOW()
      `;
    }

    if ((i + batchSize) % 200 === 0 || i + batchSize >= records.length) {
      console.log(`  Upserted ${Math.min(i + batchSize, records.length)}/${records.length}`);
    }
  }
}

async function upsertBatch(
  records: NonNullable<ReturnType<typeof normalizeRecord>>[],
  ownershipMap: Map<string, { ownerName: string; mailingAddress: string; ownerType: string }>
) {
  if (records.length === 0) return;

  // Upsert in batches of 50
  const batchSize = 50;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const r of batch) {
      // Ownership: use assessor data if available, else default to city_public
      // All COLS records are city-owned land — the managing_organization is a city department
      const ownership = r.pin ? ownershipMap.get(r.pin) : undefined;
      const ownerName = ownership?.ownerName || (r.managingOrg && r.managingOrg !== "None" ? `City of Chicago — ${r.managingOrg}` : "City of Chicago");
      const ownerMailingAddress = ownership?.mailingAddress || null;
      // COLS = City-Owned Land, so always city_public unless assessor says otherwise
      const ownerType = ownership?.ownerType || "city_public";

      await sql`
        INSERT INTO vacant_properties (id, source, address, lat, lon, property_type, ward, community_area, zoning_class, square_feet, status, owner_name, owner_mailing_address, owner_type, geom, updated_at)
        VALUES (
          ${r.id},
          'cols',
          ${r.address},
          ${r.lat},
          ${r.lon},
          'vacant_land',
          ${r.ward},
          ${r.communityArea},
          ${r.zoningClass},
          ${r.squareFeet},
          'city_owned',
          ${ownerName},
          ${ownerMailingAddress},
          ${ownerType},
          ST_MakePoint(${r.lon}, ${r.lat})::geography,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          address = EXCLUDED.address,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          ward = EXCLUDED.ward,
          community_area = EXCLUDED.community_area,
          zoning_class = EXCLUDED.zoning_class,
          square_feet = EXCLUDED.square_feet,
          status = EXCLUDED.status,
          owner_name = EXCLUDED.owner_name,
          owner_mailing_address = EXCLUDED.owner_mailing_address,
          owner_type = EXCLUDED.owner_type,
          geom = EXCLUDED.geom,
          updated_at = NOW()
      `;
    }

    if ((i + batchSize) % 200 === 0 || i + batchSize >= records.length) {
      console.log(`  Upserted ${Math.min(i + batchSize, records.length)}/${records.length}`);
    }
  }
}

async function crossReferenceZones() {
  console.log("\nCross-referencing against zone geometries...");

  // For each vacant property, find all zones that contain its point
  const result = await sql`
    UPDATE vacant_properties vp
    SET
      zone_matches = COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('zoneKey', z.zone_key, 'zoneName', COALESCE(z.feature_name, z.zone_key)))
          FROM zones z
          WHERE ST_Intersects(z.geom, vp.geom)
        ),
        '[]'::jsonb
      ),
      incentive_count = COALESCE(
        (
          SELECT COUNT(*)::integer
          FROM zones z
          WHERE ST_Intersects(z.geom, vp.geom)
        ),
        0
      )
    WHERE TRUE
    RETURNING id
  `;

  const withIncentives = await sql`
    SELECT COUNT(*) as cnt FROM vacant_properties WHERE incentive_count > 0
  `;

  console.log(`  Updated ${result.length} properties`);
  console.log(`  ${withIncentives[0]?.cnt || 0} properties have incentive zone matches`);
}

async function generateStaticFile() {
  console.log("\nGenerating static GeoJSON fallback...");

  // Include both property types and avoid making the fallback only a
  // high-incentive South/West Side sample. The per-community building slice
  // keeps illustrative North Side test cases available when DB is unavailable.
  const rows = await sql`
    WITH selected AS (
      (
        SELECT id, source, address, lat, lon, property_type, ward, community_area,
               zoning_class, square_feet, status, zone_matches, incentive_count,
               owner_name, owner_type
        FROM vacant_properties
        WHERE property_type = 'vacant_land'
        ORDER BY incentive_count DESC
        LIMIT 1200
      )
      UNION
      (
        SELECT id, source, address, lat, lon, property_type, ward, community_area,
               zoning_class, square_feet, status, zone_matches, incentive_count,
               owner_name, owner_type
        FROM vacant_properties
        WHERE property_type IN ('vacant_building', 'vacant_storefront')
        ORDER BY incentive_count DESC
        LIMIT 800
      )
      UNION
      (
        SELECT id, source, address, lat, lon, property_type, ward, community_area,
               zoning_class, square_feet, status, zone_matches, incentive_count,
               owner_name, owner_type
        FROM vacant_properties
        WHERE property_type = 'reported_vacant_lot'
        ORDER BY incentive_count DESC
        LIMIT 800
      )
      UNION
      (
        SELECT id, source, address, lat, lon, property_type, ward, community_area,
               zoning_class, square_feet, status, zone_matches, incentive_count,
               owner_name, owner_type
        FROM (
          SELECT *,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(community_area, 'Unknown')
                   ORDER BY updated_at DESC, incentive_count DESC, address ASC
                 ) AS community_rank
          FROM vacant_properties
          WHERE property_type IN ('vacant_building', 'vacant_storefront', 'reported_vacant_lot')
        ) ranked
        WHERE community_rank <= 40
      )
    )
    (
      SELECT *
      FROM selected
      ORDER BY property_type, incentive_count DESC, community_area, address
    )
  `;

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.lon, r.lat],
      },
      properties: {
        id: r.id,
        source: r.source,
        address: r.address,
        propertyType: r.property_type,
        ward: r.ward,
        communityArea: r.community_area,
        zoningClass: r.zoning_class,
        squareFeet: r.square_feet,
        status: r.status,
        zoneMatches: typeof r.zone_matches === "string"
          ? JSON.parse(r.zone_matches)
          : r.zone_matches,
        incentiveCount: r.incentive_count,
        ownerName: r.owner_name,
        ownerType: r.owner_type,
      },
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

  if (exportOnly) {
    console.log("Export only (--export-only)");
    await generateStaticFile();
    await printSummary();
    console.log("\nDone!");
    return;
  }

  // ── Source 1: City-Owned Land Inventory (vacant land) ──
  const raw = skipCols ? [] : await fetchAllPages();
  if (skipCols) console.log("Skipping City-Owned Land Inventory (--skip-cols)");
  else console.log(`\nTotal COLS raw records: ${raw.length}`);

  const normalized = raw
    .map(normalizeRecord)
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (!skipCols) {
    console.log(`Valid records with coordinates: ${normalized.length}`);

    const pinsWithData = normalized.filter((r) => r.pin).map((r) => r.pin!);
    console.log(`\nFetching ownership data for ${pinsWithData.length} PINs...`);
    const ownershipMap = await fetchOwnershipBatch(pinsWithData);
    console.log(`  Got ownership data for ${ownershipMap.size} properties`);

    console.log("\nUpserting COLS (vacant land) into database...");
    await upsertBatch(normalized, ownershipMap);
  }

  // Remove 311 records that share an address with a COLS record (COLS is authoritative)
  const colsAddresses = new Set(
    skipCols
      ? (
          await sql`
            SELECT address
            FROM vacant_properties
            WHERE source = 'cols'
          `
        ).map((r) => String(r.address).trim().toUpperCase())
      : normalized.map((r) => r.address.trim().toUpperCase())
  );
  let filtered311: NormalizedVacantBuilding[] = [];

  if (skip311Buildings) {
    console.log("Skipping 311 vacant building sync (--skip-311-buildings)");
    filtered311 = (
      await sql`
        SELECT address, lat, lon, ward, community_area, zoning_class, square_feet, status
        FROM vacant_properties
        WHERE source = 'dpd_vacant'
      `
    ).map((r) => ({
      id: "",
      address: String(r.address),
      lat: Number(r.lat),
      lon: Number(r.lon),
      ward: r.ward ? String(r.ward) : null,
      communityArea: r.community_area ? String(r.community_area) : null,
      zoningClass: r.zoning_class ? String(r.zoning_class) : null,
      squareFeet: r.square_feet == null ? null : Number(r.square_feet),
      status: r.status ? String(r.status) : "reported",
    }));
  } else {
    // ── Source 2: 311 Vacant/Abandoned Building Complaints ──
    const raw311 = await fetch311VacantBuildings();
    console.log(`\nTotal 311 raw records: ${raw311.length}`);

    const deduped311 = dedup311ByAddress(raw311);
    console.log(`Unique addresses after dedup: ${deduped311.length}`);

    const normalized311 = deduped311
      .map((r) => normalize311Record(r))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    console.log(`Valid 311 records with coordinates: ${normalized311.length}`);

    filtered311 = normalized311.filter(
      (r) => !colsAddresses.has(r.address.trim().toUpperCase())
    );
    console.log(`After removing COLS duplicates: ${filtered311.length}`);

    console.log("\nUpserting 311 (vacant buildings) into database...");
    await upsert311Batch(filtered311, "dpd_vacant", "vacant_building");
  }

  // ── Source 3: 311 Clean Vacant Lot Requests ──
  const rawCleanLots = await fetch311CleanVacantLots();
  console.log(`\nTotal 311 clean vacant lot raw records: ${rawCleanLots.length}`);

  const dedupedCleanLots = dedup311ByAddress(rawCleanLots);
  console.log(`Unique clean vacant lot addresses after dedup: ${dedupedCleanLots.length}`);

  const normalizedCleanLots = dedupedCleanLots
    .map((r) => normalize311Record(r, "311-clean-lot", "reported_lot"))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(`Valid clean vacant lot records with coordinates: ${normalizedCleanLots.length}`);

  const confirmedVacancyAddresses = new Set([
    ...colsAddresses,
    ...filtered311.map((r) => r.address.trim().toUpperCase()),
  ]);
  const filteredCleanLots = normalizedCleanLots.filter(
    (r) => !confirmedVacancyAddresses.has(r.address.trim().toUpperCase())
  );
  console.log(`After removing confirmed vacancy duplicates: ${filteredCleanLots.length}`);

  console.log("\nUpserting 311 (clean vacant lot signals) into database...");
  await upsert311Batch(filteredCleanLots, "311_clean_lot", "reported_vacant_lot");

  // ── Cross-reference & export ──
  await crossReferenceZones();
  await generateStaticFile();
  await printSummary();

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
