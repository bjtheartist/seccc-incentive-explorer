#!/usr/bin/env npx tsx
/**
 * Export the Site Shortlist canonical universe — data/exports/shortlist-
 * universe/<zip>.json for all nine pilot ZIPs + a shared manifest.json —
 * the complete, deduped, zoning-resolved data foundation for the
 * /vacancy/[zip]/shortlist engine rewrite (PR2, not this PR).
 *
 * Fixes the defect an external audit found in the prior sitePoints-based
 * approach: a hard SITE_POINTS_CAP (2000/edition) silently truncated the
 * tracked universe (19,393 source records -> 15,015 sitePoints), and
 * PIN-only "keep the richer row" dedupe could destroy conflicting land/
 * building evidence — ZIP 60621 had 1,541 tracked buildings but ZERO
 * building sitePoints as a result. This export has no cap and aggregates
 * evidence (lib/canonical-sites.ts) instead of picking a winner.
 *
 * ── Refresh-branch runbook ────────────────────────────────────────────────
 *   1. Create a disposable Neon branch off main; export its DATABASE_URL.
 *      NEVER run this against prod (prod is read-only doctrine — no bulk
 *      data lives there by design).
 *   2. Migrate:  npm run db:migrate:vacant
 *                npm run db:migrate:parcels
 *   3. Sync ALL NINE pilot ZIPs (SYNC_ZIPS for sync scripts, ZIPS for
 *      enrich-parcel-ownership — DIFFERENT env vars, a known footgun):
 *                npm run db:sync:vacant
 *                SYNC_ZIPS="60617,60619,60621,60623,60624,60636,60644,60649,60651" npm run db:sync:parcels
 *                ZIPS="...same nine..." npm run db:enrich:parcel-ownership
 *   4. Pull the zoning snapshot ONCE (bulk, not per-point):
 *                DATABASE_URL="..." npx tsx scripts/fetch-zoning-snapshot.ts
 *   5. Export (default = all nine ZIPs):
 *                DATABASE_URL="postgresql://..." npx tsx scripts/export-shortlist-universe.ts
 *   6. In THE SAME RUN, regenerate vacancy-index.json against the same
 *      snapshot (consult Q6.3 — site-matchmaker context must not drift
 *      from the index):
 *                DATABASE_URL="..." npx tsx scripts/export-vacancy-index.ts
 *   7. Commit data/exports/shortlist-universe/*.json + manifest.json +
 *      data/exports/zoning-snapshot/manifest.json + the regenerated
 *      public/data/vacancy-index.json. Report the branch name for cleanup
 *      (do not delete it — the PR body lists it).
 *
 * ── Verify row counts after every stage ─────────────────────────────────
 * Per hard-won experience: a missing .env.local (worktrees don't inherit
 * it) makes Socrata syncs "Fetched: 0" WITH EXIT 0. This script refuses to
 * write a ZIP file with zero source records — that is always a upstream
 * sync failure, never a legitimate empty pilot ZIP.
 */

import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { PILOT_ZIPS } from "../lib/pilot-zips";
import {
  classifyOwnerStructure,
  ownerGeographyFromMailingAddress,
} from "../lib/owner-taxonomy";
import {
  aggregateCanonicalSites,
  findDuplicateCanonicalKeys,
  type RawTrackedRecord,
} from "../lib/canonical-sites";
import {
  buildZoningBboxIndex,
  resolveDistrictAtPoint,
  type ZoningSnapshot,
} from "../lib/zoning-snapshot";
import { checkStaticZoneKeys } from "../lib/zones-check";
import {
  RANKING_INPUTS_VERSION,
  SHORTLIST_UNIVERSE_SCHEMA_VERSION,
  ShortlistUniverseFileSchema,
  shortlistUniverseChecksum,
  validateEnvelopeCounts,
  type ShortlistUniverseFile,
  type ShortlistUniverseRow,
} from "../lib/shortlist-universe-schema";

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required (disposable Neon branch — never prod).");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const ALL_PILOT_ZIPS = PILOT_ZIPS.map((e) => e.zip);
const zipsArg = argv.find((a) => a.startsWith("--zips="));
const requestedZips = zipsArg
  ? zipsArg.slice("--zips=".length).split(",").map((z) => z.trim()).filter((z) => ALL_PILOT_ZIPS.includes(z))
  : [...ALL_PILOT_ZIPS];
if (requestedZips.length === 0) {
  console.error(`No valid pilot ZIPs given. Valid: ${ALL_PILOT_ZIPS.join(", ")}`);
  process.exit(1);
}

const OUT_DIR = join(process.cwd(), "data", "exports", "shortlist-universe");
const ZONING_SNAPSHOT_PATH = join(process.cwd(), "data", "exports", "zoning-snapshot", "snapshot.json");
const OVERLAY_KEYS = ["ssa", "ccsa", "tif", "nof"] as const;

// ── Geometry (ZIP boundary PIP — duplicated from scripts/export-vacancy-
//    index.ts per this repo's standalone-script convention, not imported) ──

type Ring = Array<[number, number]>;
type Bbox = [number, number, number, number];
interface ZipGeometry { zip: string; coords: Ring[][][]; bbox: Bbox }

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInMultiPolygon(lon: number, lat: number, coords: Ring[][][]): boolean {
  for (const polygon of coords) {
    if (polygon.length === 0) continue;
    if (pointInRing(lon, lat, polygon[0] as unknown as Ring)) return true;
  }
  return false;
}

const ZIP_BOUNDARIES_URL = "https://data.cityofchicago.org/resource/unjd-c2ca.json";

async function fetchZipBoundaries(): Promise<Map<string, ZipGeometry>> {
  const qs = new URLSearchParams({ $limit: "500" });
  const res = await fetch(`${ZIP_BOUNDARIES_URL}?${qs}`, { headers: socrataHeaders(), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`ZIP boundaries fetch failed: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ zip?: string; the_geom?: { type: string; coordinates: unknown } }>;

  const merged = new Map<string, Ring[][][]>();
  for (const row of rows) {
    if (!row.zip || !row.the_geom) continue;
    const coords = row.the_geom.type === "Polygon" ? [row.the_geom.coordinates as Ring[][]] : (row.the_geom.coordinates as Ring[][][]);
    const existing = merged.get(row.zip);
    merged.set(row.zip, existing ? [...existing, ...coords] : coords);
  }

  const out = new Map<string, ZipGeometry>();
  for (const [zip, coords] of merged.entries()) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const polygon of coords) {
      for (const [lon, lat] of polygon[0] as unknown as Ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    out.set(zip, { zip, coords, bbox: [minLon, minLat, maxLon, maxLat] });
  }
  return out;
}

// ── DB fetches (duplicated from export-vacancy-index.ts conventions) ───────

interface VacantRow {
  id: string;
  /** Live values observed on vacant_properties.source (constraint allows
   * 'cols' | 'dpd_vacant' | '311_clean_lot' | 'violations'; typed as string
   * here rather than that literal union so an unanticipated future source
   * degrades to the safe "311_building" default in sourceToEvidenceType
   * instead of a TypeScript-only compile error nobody sees at runtime). */
  source: string;
  pin: string | null;
  address: string | null;
  lat: number | string | null;
  lon: number | string | null;
  property_type: string;
  square_feet: number | string | null;
  status: string | null;
  owner_type: string | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
  incentive_count: number | string | null;
  zoning_class: string | null;
}

async function fetchAllVacantRows(): Promise<VacantRow[]> {
  return (await sql`
    SELECT id, source, pin, address, lat, lon, property_type, square_feet, status,
           owner_type, owner_name, owner_mailing_address, incentive_count, zoning_class
    FROM vacant_properties
    WHERE lat IS NOT NULL AND lon IS NOT NULL
  `) as VacantRow[];
}

interface ParcelVacantLandRow {
  pin: string | null;
  address: string | null;
  lat: number | string | null;
  lon: number | string | null;
  land_sqft: number | string | null;
  bldg_sqft: number | string | null;
  owner_type: string | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
}

async function fetchVacantLandParcels(zip: string): Promise<ParcelVacantLandRow[] | null> {
  try {
    const rows = (await sql`
      SELECT pin, address, lat, lon, land_sqft, bldg_sqft,
             COALESCE(owner_type, 'unknown') AS owner_type, owner_name, owner_mailing_address
      FROM parcels
      WHERE zip = ${zip} AND is_vacant IS TRUE
    `) as ParcelVacantLandRow[];
    if (rows.length === 0) {
      console.warn(`  ${zip}: parcels vacant-land returned 0 rows (SYNC_ZIPS may not have covered this ZIP) — treating as unavailable`);
      return null;
    }
    return rows;
  } catch (err) {
    console.warn(`  ${zip}: parcels table unavailable on this branch:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchSaleYearsByPin(): Promise<Map<string, number[]> | null> {
  try {
    type SaleRow = { pin: string; tax_sale_year: number | string | null };
    const scavenger = (await sql`SELECT pin, tax_sale_year FROM scavenger_sale_entries WHERE pin IS NOT NULL AND pin <> ''`) as SaleRow[];
    const annual = (await sql`SELECT pin, tax_sale_year FROM annual_tax_sale_entries WHERE pin IS NOT NULL AND pin <> ''`) as SaleRow[];
    const map = new Map<string, number[]>();
    for (const entry of [...scavenger, ...annual]) {
      const years = map.get(entry.pin) ?? [];
      if (entry.tax_sale_year != null) {
        const year = Number(entry.tax_sale_year);
        if (Number.isFinite(year)) years.push(year);
      }
      map.set(entry.pin, years);
    }
    return map;
  } catch (err) {
    console.warn("  scavenger/annual tax-sale tables unavailable — saleYear degrades to null:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchViolationAddressSet(): Promise<Set<string> | null> {
  try {
    const rows = (await sql`
      SELECT DISTINCT regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') AS norm_address
      FROM vacant_building_violations
      WHERE address IS NOT NULL AND address <> ''
    `) as { norm_address: string }[];
    const set = new Set<string>();
    for (const row of rows) if (row.norm_address) set.add(row.norm_address);
    return set;
  } catch (err) {
    console.warn("  vacant_building_violations table unavailable — violation degrades to false:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toNumOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAddressKey(address: string | null): string {
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * `vacant_properties.property_type` carries FOUR live values (confirmed
 * against the actual DB constraint, not just the migration script's
 * original CHECK): 'vacant_land' (cols), 'vacant_building' (dpd_vacant),
 * 'vacant_storefront' (rare, a building), and 'reported_vacant_lot'
 * (311_clean_lot — a LAND report). Resolve to the two-way type this export
 * (and canonical-sites.ts) works with; anything not explicitly a land type
 * defaults to building rather than silently misreading an unrecognized
 * future value as land.
 */
function toResolvedPropertyType(rawPropertyType: string): "vacant_land" | "vacant_building" {
  return rawPropertyType === "vacant_land" || rawPropertyType === "reported_vacant_lot" ? "vacant_land" : "vacant_building";
}

/** COLS City-inventory rows are `city_land`; every other source is a citizen/
 * City-condition report with no PIN, split into `311_land` vs `311_building`
 * by its RESOLVED property type (see toResolvedPropertyType) rather than by
 * the literal source string — `311_clean_lot` reports land, `dpd_vacant`
 * reports buildings, and a future source is classified the same honest way. */
function sourceToEvidenceType(
  source: string,
  resolvedPropertyType: "vacant_land" | "vacant_building",
): "city_land" | "311_building" | "311_land" {
  if (source === "cols") return "city_land";
  return resolvedPropertyType === "vacant_land" ? "311_land" : "311_building";
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Site Shortlist canonical universe export ===");
  console.log(`ZIPs requested: ${requestedZips.join(", ")}\n`);

  if (!existsSync(ZONING_SNAPSHOT_PATH)) {
    console.error(
      `FATAL: zoning snapshot missing at ${ZONING_SNAPSHOT_PATH}.\n` +
        `Run: DATABASE_URL="..." npx tsx scripts/fetch-zoning-snapshot.ts   (before this export)`,
    );
    process.exit(1);
  }
  const zoningSnapshot = JSON.parse(readFileSync(ZONING_SNAPSHOT_PATH, "utf8")) as ZoningSnapshot;
  if (!Array.isArray(zoningSnapshot.features) || zoningSnapshot.features.length === 0) {
    console.error("FATAL: zoning snapshot has zero features — refusing to export (would silently mark every site 'unresolved').");
    process.exit(1);
  }
  console.log(`Loaded zoning snapshot: ${zoningSnapshot.featureCount} polygons, checksum ${zoningSnapshot.source.checksum.slice(0, 12)}..., vintage ${zoningSnapshot.source.vintage}`);
  const zoningIndex = buildZoningBboxIndex(zoningSnapshot.features);

  console.log("\nFetching Chicago ZIP boundaries (unjd-c2ca)...");
  const allBoundaries = await fetchZipBoundaries();
  const geoByZip = new Map<string, ZipGeometry>();
  for (const zip of requestedZips) {
    const geo = allBoundaries.get(zip);
    if (!geo) {
      console.error(`FATAL: no ZIP boundary found for ${zip} — cannot bucket source records.`);
      process.exit(1);
    }
    geoByZip.set(zip, geo);
  }

  console.log("\nQuerying vacant_properties...");
  const allVacantRows = await fetchAllVacantRows();
  console.log(`  ${allVacantRows.length} rows with coordinates`);
  if (allVacantRows.length === 0) {
    console.error("FATAL: vacant_properties returned 0 rows — this is always a sync failure (missing .env.local / SOCRATA creds / SYNC_ZIPS), never a legitimate state. Aborting.");
    process.exit(1);
  }

  const vacantRowsByZip = new Map<string, VacantRow[]>();
  for (const zip of requestedZips) vacantRowsByZip.set(zip, []);
  for (const row of allVacantRows) {
    const lat = toNumOrNull(row.lat);
    const lon = toNumOrNull(row.lon);
    if (lat == null || lon == null) continue;
    for (const zip of requestedZips) {
      const geo = geoByZip.get(zip)!;
      if (lon < geo.bbox[0] || lon > geo.bbox[2] || lat < geo.bbox[1] || lat > geo.bbox[3]) continue;
      if (pointInMultiPolygon(lon, lat, geo.coords)) {
        vacantRowsByZip.get(zip)!.push(row);
        break;
      }
    }
  }
  for (const zip of requestedZips) {
    console.log(`  ${zip}: ${vacantRowsByZip.get(zip)!.length} tracked rows bucketed`);
  }

  console.log("\nLoading distress overlays (tax-sale + violations)...");
  const saleYearsByPin = await fetchSaleYearsByPin();
  const violationAddressSet = await fetchViolationAddressSet();
  console.log(`  tax-sale: ${saleYearsByPin === null ? "unavailable" : `${saleYearsByPin.size} PINs`}  ·  violations: ${violationAddressSet === null ? "unavailable" : `${violationAddressSet.size} addresses`}`);

  const buildId = `shortlist-universe-${new Date().toISOString()}`;
  const generatedAt = new Date().toISOString();
  const vacancySnapshotId = buildId; // same run -> same snapshot id (consult Q6.3)

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const manifestFiles: Record<string, { path: string; checksum: string; rowCount: number }> = {};
  const perZipSummary: Array<{ zip: string; sourceRecords: number; canonicalSites: number; buildings: number; land: number }> = [];

  for (const zip of requestedZips) {
    console.log(`\n── ${zip} ──`);
    const vacantRows = vacantRowsByZip.get(zip)!;
    const parcelRows = await fetchVacantLandParcels(zip);

    const records: RawTrackedRecord[] = [];

    for (const row of vacantRows) {
      const resolvedPropertyType = toResolvedPropertyType(row.property_type);
      records.push({
        recordId: `vacant_properties:${row.id}`,
        evidenceType: sourceToEvidenceType(row.source, resolvedPropertyType),
        pin: row.pin,
        address: row.address,
        lat: toNumOrNull(row.lat),
        lon: toNumOrNull(row.lon),
        propertyType: resolvedPropertyType,
        status: row.status,
        statusDate: null, // vacant_properties carries no per-row status date
        lotSqft: resolvedPropertyType === "vacant_land" ? toNumOrNull(row.square_feet) : null,
        buildingSqft: resolvedPropertyType === "vacant_building" ? toNumOrNull(row.square_feet) : null,
        ownerType: row.owner_type,
        ownerStructureHint: classifyOwnerStructure(row.owner_name),
        ownerGeographyHint: ownerGeographyFromMailingAddress(row.owner_mailing_address),
        incentiveCount: toNumOrNull(row.incentive_count),
        legacyZoningClass: row.zoning_class,
      });
    }

    if (parcelRows) {
      for (const row of parcelRows) {
        records.push({
          recordId: `parcels:${row.pin ?? normalizeAddressKey(row.address)}`,
          evidenceType: "assessor_vacant_land",
          pin: row.pin,
          address: row.address,
          lat: toNumOrNull(row.lat),
          lon: toNumOrNull(row.lon),
          propertyType: "vacant_land",
          status: "vacant",
          statusDate: null,
          lotSqft: toNumOrNull(row.land_sqft),
          buildingSqft: toNumOrNull(row.bldg_sqft),
          ownerType: row.owner_type,
          ownerStructureHint: classifyOwnerStructure(row.owner_name),
          ownerGeographyHint: ownerGeographyFromMailingAddress(row.owner_mailing_address),
          incentiveCount: null,
          legacyZoningClass: null,
        });
      }
    }

    if (records.length === 0) {
      console.error(`FATAL: ${zip} has zero source records after bucketing — refusing to write a false-empty universe file. Aborting.`);
      process.exit(1);
    }

    // RAW, pre-dedup tally by evidence type (Finding 6) — computed off
    // `records` BEFORE aggregateCanonicalSites collapses them, so the
    // zero-result funnel can show actual deduplication (e.g. 60621 carrying
    // far more raw 311_building reports than canonical building sites)
    // instead of the post-dedup count twice under two different labels.
    const sourceRecordsByEvidenceType = {
      city_land: 0,
      "311_building": 0,
      "311_land": 0,
      assessor_vacant_land: 0,
    };
    for (const record of records) sourceRecordsByEvidenceType[record.evidenceType] += 1;

    const { sites, stats } = aggregateCanonicalSites(records);
    const dupKeys = findDuplicateCanonicalKeys(sites);
    if (dupKeys.length > 0) {
      console.error(`FATAL: ${zip} produced duplicate canonical keys: ${dupKeys.slice(0, 5).join(", ")}${dupKeys.length > 5 ? "..." : ""}`);
      process.exit(1);
    }

    const rows: ShortlistUniverseRow[] = [];
    let withPin = 0, withMeasuredArea = 0, withZoning = 0;

    for (const site of sites) {
      if (site.pin) withPin += 1;
      if (site.lotSqft != null || site.buildingSqft != null) withMeasuredArea += 1;

      let zoningRow: ShortlistUniverseRow["zoning"] = { status: "unresolved", district: null, zoneType: null, pdNum: null, pmdSubArea: null };
      let overlays: ShortlistUniverseRow["overlays"] = {
        ssa: { present: false, name: null },
        ccsa: { present: false, name: null },
        tif: { present: false, name: null },
        nof: { present: false, name: null },
      };

      if (site.lat != null && site.lon != null) {
        const resolution = resolveDistrictAtPoint(site.lat, site.lon, zoningSnapshot.features, zoningIndex);
        if (resolution.state === "resolved" && resolution.district) {
          zoningRow = {
            status: "resolved",
            district: resolution.district.zoneClass,
            zoneType: resolution.district.zoneType,
            pdNum: resolution.district.pdNum,
            pmdSubArea: resolution.district.pmdSubArea,
          };
        } else if (resolution.state === "ambiguous") {
          zoningRow = { status: "ambiguous", district: null, zoneType: null, pdNum: null, pmdSubArea: null };
        }
        if (zoningRow.status === "resolved") withZoning += 1;

        // checkStaticZoneKeys already returns each match's feature name
        // (ZoneMatch { key, name }) — Finding 12 restores that name onto
        // the exported row instead of discarding it down to a bare boolean.
        // An unnamed source feature keeps `name: null`, never a placeholder.
        const zoneMatches = await checkStaticZoneKeys(site.lat, site.lon, OVERLAY_KEYS);
        const nameByKey = new Map(zoneMatches.map((m) => [m.key, m.name?.trim() || null]));
        overlays = {
          ssa: { present: nameByKey.has("ssa"), name: nameByKey.get("ssa") ?? null },
          ccsa: { present: nameByKey.has("ccsa"), name: nameByKey.get("ccsa") ?? null },
          tif: { present: nameByKey.has("tif"), name: nameByKey.get("tif") ?? null },
          nof: { present: nameByKey.has("nof"), name: nameByKey.get("nof") ?? null },
        };
      }

      const ownerConfidence: ShortlistUniverseRow["ownerConfidence"] = site.pin
        ? "pin_matched"
        : !site.ownerType || site.ownerType === "unknown"
          ? "needs_verification"
          : "inferred";

      const saleYear = site.pin && saleYearsByPin
        ? (saleYearsByPin.get(site.pin) ?? []).reduce<number | null>((max, y) => (max == null || y > max ? y : max), null)
        : null;
      const violation = violationAddressSet != null && normalizeAddressKey(site.address).length > 0
        ? violationAddressSet.has(normalizeAddressKey(site.address))
        : false;

      rows.push({
        canonicalKey: site.canonicalKey,
        pin: site.pin,
        address: site.address,
        lat: site.lat,
        lon: site.lon,
        evidenceTypes: site.evidenceTypes,
        hasVacantLandEvidence: site.hasVacantLandEvidence,
        hasVacantBuildingEvidence: site.hasVacantBuildingEvidence,
        conflictingPropertyTypes: site.conflictingPropertyTypes,
        propertyType: site.propertyType,
        buildingSqft: site.buildingSqft,
        buildingSqftSource: site.buildingSqftSource,
        lotSqft: site.lotSqft,
        lotSqftSource: site.lotSqftSource,
        ownerStructure: site.ownerStructure,
        ownerGeography: site.ownerGeography,
        ownerConfidence,
        saleYear,
        violation,
        zoning: zoningRow,
        overlays,
        incentiveCount: site.incentiveCount,
      });
    }

    const buildings = sites.filter((s) => s.hasVacantBuildingEvidence).length;
    const land = sites.filter((s) => s.hasVacantLandEvidence).length;

    const file: ShortlistUniverseFile = {
      schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION,
      buildId,
      generatedAt,
      zip,
      vacancySnapshotId,
      rankingInputsVersion: RANKING_INPUTS_VERSION,
      sources: {
        vacancy: { vintage: generatedAt, checksum: sha256(records.map((r) => r.recordId).sort()) },
        zoning: { vintage: zoningSnapshot.source.vintage, checksum: zoningSnapshot.source.checksum },
        overlays: { vintage: generatedAt, checksum: sha256(OVERLAY_KEYS) },
      },
      counts: {
        sourceRecords: stats.sourceRecords,
        sourceRecordsByEvidenceType,
        canonicalSites: stats.canonicalSites,
        buildings,
        land,
        withPin,
        withMeasuredArea,
        withZoning,
      },
      dedupe: {
        collapsedRecords: stats.collapsedRecords,
        conflictingPropertyTypes: stats.conflictingPropertyTypes,
        unresolvedConflicts: stats.unresolvedConflicts,
      },
      rows,
    };

    const validated = ShortlistUniverseFileSchema.safeParse(file);
    if (!validated.success) {
      console.error(`FATAL: ${zip} envelope failed its own schema validation:`, validated.error.message);
      process.exit(1);
    }
    const consistencyIssues = validateEnvelopeCounts(file);
    if (consistencyIssues.length > 0) {
      console.error(`FATAL: ${zip} envelope counts are inconsistent with its rows:\n  ${consistencyIssues.join("\n  ")}`);
      process.exit(1);
    }

    const outPath = join(OUT_DIR, `${zip}.json`);
    const serialized = JSON.stringify(file);
    writeFileSync(outPath, serialized);
    // Checksum the EXACT bytes written to disk (Finding 7) — never a
    // re-serialization of the object — so the runtime loader can recompute
    // the identical checksum from the raw bytes it reads back.
    const checksum = shortlistUniverseChecksum(serialized);
    manifestFiles[zip] = { path: `${zip}.json`, checksum, rowCount: rows.length };

    console.log(`  sourceRecords=${stats.sourceRecords} (${JSON.stringify(sourceRecordsByEvidenceType)}) canonicalSites=${stats.canonicalSites} buildings=${buildings} land=${land} withPin=${withPin} withZoning=${withZoning} collapsed=${stats.collapsedRecords} conflicts=${stats.unresolvedConflicts}`);
    perZipSummary.push({ zip, sourceRecords: stats.sourceRecords, canonicalSites: stats.canonicalSites, buildings, land });
  }

  // Manifest binds ALL NINE files (only rewritten ZIPs' entries change on a
  // --zips= subset run — merge, not clobber, mirroring export-vacancy-index.ts).
  const manifestPath = join(OUT_DIR, "manifest.json");
  let existingManifest: { zips: string[]; files: Record<string, { path: string; checksum: string; rowCount: number }> } | null = null;
  if (existsSync(manifestPath)) {
    try {
      existingManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      existingManifest = null;
    }
  }
  const mergedFiles = { ...(existingManifest?.files ?? {}), ...manifestFiles };
  const mergedZips = [...new Set([...(existingManifest?.zips ?? []), ...requestedZips])].sort();

  const manifest = {
    schemaVersion: SHORTLIST_UNIVERSE_SCHEMA_VERSION,
    buildId,
    generatedAt,
    zips: mergedZips,
    vacancyIndexBuildId: buildId,
    files: mergedFiles,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${requestedZips.length} universe file(s) + manifest.json to ${OUT_DIR}`);
  console.log("\nPer-ZIP summary:");
  for (const s of perZipSummary) {
    console.log(`  ${s.zip}: sourceRecords=${s.sourceRecords} canonicalSites=${s.canonicalSites} buildings=${s.buildings} land=${s.land}`);
  }

  if (mergedZips.length === ALL_PILOT_ZIPS.length) {
    console.log(`\nNOTE: regenerate public/data/vacancy-index.json in THIS SAME refresh run so it shares buildId ${buildId}:`);
    console.log(`  DATABASE_URL="..." npx tsx scripts/export-vacancy-index.ts`);
  } else {
    console.warn(`\nWARNING: only ${mergedZips.length}/${ALL_PILOT_ZIPS.length} ZIPs present in the manifest — not a complete universe yet.`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
