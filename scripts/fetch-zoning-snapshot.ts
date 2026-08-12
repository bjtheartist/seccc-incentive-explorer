#!/usr/bin/env npx tsx
/**
 * Pull the City's ArcGIS zoning boundary layer (ExternalApps/Zoning/
 * MapServer/1), clipped to the nine pilot-ZIP envelopes, into a bulk local
 * snapshot for the Site Shortlist universe export — per the gpt5.6
 * matchmaker consult (Q2): resolve zoning locally against a one-time bulk
 * pull, never one Socrata/ArcGIS request per tracked site (~19k requests
 * would risk throttling, timeouts, and mid-run source mutation).
 *
 * Nine bounded envelope queries (one per pilot ZIP bbox), paged by
 * OBJECTID/GLOBALID at the layer's 2,000-record page limit, deduped by
 * GLOBALID across overlapping ZIP pulls. FAILS THE SCRIPT (nonzero exit) if
 * the pull is incomplete (a page count mismatch) or if any feature's
 * geometry is invalid after the deterministic repair attempt
 * (lib/zoning-snapshot.ts validateAndRepairRing) — "none mapped" downstream
 * must only ever mean "genuinely 0 polygons contain this point", never
 * "the layer failed to load".
 *
 * Usage:
 *   npx tsx scripts/fetch-zoning-snapshot.ts
 *
 * Output:
 *   data/exports/zoning-snapshot/snapshot.json   (gitignored — regenerable;
 *     see data/exports/zoning-snapshot/README.md)
 *   data/exports/zoning-snapshot/manifest.json   (committed — checksum,
 *     vintage, feature count, per-ZIP counts; the export step's `sources.
 *     zoning.checksum` binds to this)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { PILOT_ZIPS } from "../lib/pilot-zips";
import {
  dedupeZoningFeatures,
  normalizeArcGisZoningFeature,
  type ZoningSnapshot,
  type ZoningSnapshotFeature,
} from "../lib/zoning-snapshot";

const CHICAGO_ZONING_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1";
const ZIP_BOUNDARIES_URL = "https://data.cityofchicago.org/resource/unjd-c2ca.json";
const PAGE_SIZE = 2000;
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRIES = 2;

const OUT_DIR = join(process.cwd(), "data", "exports", "zoning-snapshot");
const SNAPSHOT_PATH = join(OUT_DIR, "snapshot.json");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");

type Bbox = [number, number, number, number];

// ── ZIP envelope bboxes (Socrata ZIP boundaries — same source as
//    scripts/export-vacancy-index.ts's fetchZipBoundaries; duplicated per
//    this repo's standalone-script convention, not imported). Only the
//    bbox is needed here (not the full ZIP polygon), so coordinates are
//    walked recursively regardless of Polygon vs MultiPolygon nesting. ────

interface ArcGisPage {
  error?: { message?: string };
  features?: unknown[];
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Recursively walk an arbitrarily-nested GeoJSON coordinate array (Polygon
 * or MultiPolygon, any ring/hole depth) and extend a running bbox with every
 * [lon, lat] leaf pair found. */
function extendBboxWithCoords(bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }, coords: unknown): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lon, lat] = coords as [number, number];
    if (lon < bounds.minLon) bounds.minLon = lon;
    if (lon > bounds.maxLon) bounds.maxLon = lon;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
    return;
  }
  for (const child of coords) extendBboxWithCoords(bounds, child);
}

async function fetchZipEnvelopes(zips: readonly string[]): Promise<Map<string, Bbox>> {
  const qs = new URLSearchParams({ $limit: "500" });
  const res = await fetch(`${ZIP_BOUNDARIES_URL}?${qs}`, {
    headers: socrataHeaders(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ZIP boundaries fetch failed: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{
    zip?: string;
    the_geom?: { type: string; coordinates: unknown };
  }>;

  const zipSet = new Set(zips);
  const bounds = new Map<string, { minLon: number; minLat: number; maxLon: number; maxLat: number }>();
  for (const row of rows) {
    if (!row.zip || !zipSet.has(row.zip) || !row.the_geom) continue;
    const existing = bounds.get(row.zip) ?? { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    extendBboxWithCoords(existing, row.the_geom.coordinates);
    bounds.set(row.zip, existing);
  }

  const out = new Map<string, Bbox>();
  for (const [zip, b] of bounds.entries()) {
    out.set(zip, [b.minLon, b.minLat, b.maxLon, b.maxLat]);
  }
  return out;
}

const OUT_FIELDS = [
  "GLOBALID",
  "ZONE_CLASS",
  "ZONE_TYPE",
  "PD_NUM",
  "PMD_SUB_AREA",
  "UPDATE_TIMESTAMP",
  "ORDINANCE_NUM",
  "ORDINANCE_DATE",
  "CLERK_DOCNO",
].join(",");

/** Fetch every zoning polygon intersecting one ZIP's envelope, paged at the
 * layer's 2,000-record limit. Throws (fail-closed) on any page error, count
 * mismatch, or geometry that fails validation+repair. */
async function fetchZipZoningFeatures(zip: string, bbox: Bbox): Promise<ZoningSnapshotFeature[]> {
  const envelope = { xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3], spatialReference: { wkid: 4326 } };

  const countUrl = new URL(`${CHICAGO_ZONING_LAYER_URL}/query`);
  countUrl.searchParams.set("geometry", JSON.stringify(envelope));
  countUrl.searchParams.set("geometryType", "esriGeometryEnvelope");
  countUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  countUrl.searchParams.set("inSR", "4326");
  countUrl.searchParams.set("returnCountOnly", "true");
  countUrl.searchParams.set("f", "json");
  const countPayload = (await fetchJson(countUrl.toString())) as { count?: unknown; error?: { message?: string } };
  if (countPayload.error) {
    throw new Error(`ArcGIS zoning count query failed for ${zip}: ${countPayload.error.message ?? "unknown"}`);
  }
  const expectedCount = Number(countPayload?.count);
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`ArcGIS zoning layer did not publish a valid count for ${zip}`);
  }

  const out: ZoningSnapshotFeature[] = [];
  for (let offset = 0; offset < expectedCount; offset += PAGE_SIZE) {
    const url = new URL(`${CHICAGO_ZONING_LAYER_URL}/query`);
    url.searchParams.set("geometry", JSON.stringify(envelope));
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outFields", OUT_FIELDS);
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("geometryPrecision", "6");
    url.searchParams.set("orderByFields", "GLOBALID ASC");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
    url.searchParams.set("f", "json");

    const page = (await fetchJson(url.toString())) as ArcGisPage;
    if (page.error) throw new Error(`ArcGIS zoning query failed for ${zip}: ${page.error.message ?? "unknown"}`);
    if (!Array.isArray(page.features)) throw new Error(`ArcGIS zoning layer returned an invalid page for ${zip}`);

    for (const raw of page.features) {
      const feature = normalizeArcGisZoningFeature(raw);
      if (!feature) {
        throw new Error(
          `ArcGIS zoning layer returned an invalid/unrepairable geometry in ${zip} (offset ${offset}) — failing closed rather than silently dropping it`,
        );
      }
      out.push(feature);
    }
    console.log(`  ${zip}: ${Math.min(out.length, expectedCount)}/${expectedCount}`);
  }

  if (out.length !== expectedCount) {
    throw new Error(`ArcGIS zoning layer published ${expectedCount} features for ${zip} but returned ${out.length}`);
  }
  return out;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const zips = PILOT_ZIPS.map((entry) => entry.zip);
  console.log(`Fetching ZIP envelopes for ${zips.length} pilot ZIPs...`);
  const envelopes = await fetchZipEnvelopes(zips);

  const missingEnvelopes = zips.filter((z) => !envelopes.has(z));
  if (missingEnvelopes.length > 0) {
    console.error(`FATAL: no ZIP boundary envelope resolved for: ${missingEnvelopes.join(", ")}`);
    process.exit(1);
  }

  const byZipCounts: Record<string, number> = {};
  let allFeatures: ZoningSnapshotFeature[] = [];

  for (const zip of zips) {
    const bbox = envelopes.get(zip)!;
    console.log(`Fetching zoning polygons intersecting ${zip} envelope [${bbox.map((n) => n.toFixed(4)).join(", ")}]...`);
    const features = await fetchZipZoningFeatures(zip, bbox);
    byZipCounts[zip] = features.length;
    if (features.length === 0) {
      console.error(`FATAL: ${zip} returned 0 zoning polygons — envelope query likely wrong (never a valid "no zoning" pilot ZIP)`);
      process.exit(1);
    }
    allFeatures = allFeatures.concat(features);
  }

  const deduped = dedupeZoningFeatures(allFeatures);
  console.log(`Pulled ${allFeatures.length} raw feature-pulls across 9 envelopes -> ${deduped.length} unique polygons after dedupe.`);

  if (deduped.length === 0) {
    console.error("FATAL: zero unique zoning polygons after dedupe.");
    process.exit(1);
  }

  const sorted = [...deduped].sort((a, b) => a.globalId.localeCompare(b.globalId));
  const vintage = new Date().toISOString();
  const checksum = sha256(sorted);

  const snapshot: ZoningSnapshot = {
    schemaVersion: 1,
    source: { url: CHICAGO_ZONING_LAYER_URL, vintage, checksum },
    zips,
    featureCount: sorted.length,
    features: sorted,
  };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));

  const manifest = {
    schemaVersion: 1,
    source: { url: CHICAGO_ZONING_LAYER_URL, vintage, checksum },
    zips,
    featureCount: sorted.length,
    byZipRawPullCounts: byZipCounts,
    snapshotFileSizeBytes: Buffer.byteLength(JSON.stringify(snapshot)),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`Wrote ${SNAPSHOT_PATH} (${sorted.length} polygons, checksum ${checksum.slice(0, 12)}...).`);
  console.log(`Wrote ${MANIFEST_PATH}.`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
