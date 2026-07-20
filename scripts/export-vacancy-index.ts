#!/usr/bin/env npx tsx
/**
 * Export the Vacancy Opportunity Index to public/data/vacancy-index.json — the
 * anonymized, committed source for the shareable per-neighborhood PDF (one
 * edition per pilot ZIP, lib/pilot-zips.ts). Consumed by lib/vacancy-index.ts's
 * static-only loader; prod holds no bulk data by design (static-export
 * doctrine), so this runs on a disposable Neon refresh branch, never prod.
 *
 * ── Refresh-branch runbook ────────────────────────────────────────────────
 *   1. Create a disposable Neon branch off main; export its DATABASE_URL.
 *   2. Migrate:  npm run db:migrate:vacant
 *                npm run db:migrate:parcels
 *                npm run db:migrate:ownership
 *      (the vacant-inventory + complete-ownership tables this export reads).
 *   3. Sync ALL NINE pilot ZIPs — the complete vacant-land ownership series
 *      (D2a) comes from `parcels`, and sync-parcels defaults to the SE-3
 *      footprint only (same footgun class as the corridor-owners clobber):
 *                npm run db:sync:vacant
 *                SYNC_ZIPS="60617,60619,60649,60624,60623,60644,60651,60621,60636" npm run db:sync:parcels
 *                ZIPS="...same nine..." npm run db:enrich:parcel-ownership   (NOTE: enrichment reads ZIPS, not SYNC_ZIPS)
 *   4. Export (default = all nine ZIPs; a subset MERGES, see below):
 *                DATABASE_URL="postgresql://..." npx tsx scripts/export-vacancy-index.ts
 *      or a single edition refresh:
 *                DATABASE_URL="..." npx tsx scripts/export-vacancy-index.ts --zips=60624
 *   5. Commit public/data/vacancy-index.json; drop the Neon branch. Prod is
 *      untouched (no new prod tables — nothing to migrate on prod).
 *
 * ── Merge, never clobber ──────────────────────────────────────────────────
 * A `--zips=` subset run reads the existing committed file, replaces ONLY the
 * requested editions, keeps every other edition as-is, and recomputes the full
 * nine-row comparison matrix over the merged set. A partial run can therefore
 * never drop an edition. A default run (all nine) rebuilds every edition.
 *
 * ── Anonymization ─────────────────────────────────────────────────────────
 * The vacant_properties SELECT names ONLY anonymized columns (owner TYPE, never
 * owner_name / owner_mailing_address), and a hard assert before write aborts
 * (exit 1) if the serialized JSON contains any owner-identifying key. The
 * committed-file test in lib/__tests__/vacancy-index.test.ts guards it forever.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { socrataHeaders } from "../lib/socrata";
import { PILOT_ZIPS } from "../lib/pilot-zips";
import { getCorridorCitywideMetric } from "../lib/corridor-citywide";
import { normalizeOwnerType, OWNER_TYPE_ORDER } from "../lib/owner-classify";
import {
  assignQuantileDots,
  computeSitePriority,
  nextStepForSite,
  rankSites,
  tallyOwnerTypeCounts,
  type OwnerTypeCount,
  type VacancyIndexEdition,
  type VacancyIndexExport,
  type VacancyMatrixRow,
  type VacancyPropertyType,
  type VacancySiteIndexRow,
  type VacancySitePoint,
} from "../lib/vacancy-index";

// ── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    [
      "Usage: npx tsx scripts/export-vacancy-index.ts [--zips=60624,60621]",
      "",
      "  DATABASE_URL   Neon refresh-branch connection string (required).",
      "  --zips=        Comma-separated subset of the nine pilot ZIPs. Default:",
      "                 all nine. A subset MERGES into the existing file and",
      "                 recomputes the matrix — it never drops other editions.",
      "",
      "See the file header for the full refresh-branch runbook.",
    ].join("\n"),
  );
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const ALL_PILOT_ZIPS = PILOT_ZIPS.map((entry) => entry.zip);

const zipsArg = argv.find((arg) => arg.startsWith("--zips="));
const requestedZips = zipsArg
  ? zipsArg
      .slice("--zips=".length)
      .split(",")
      .map((z) => z.trim())
      .filter((z) => ALL_PILOT_ZIPS.includes(z))
  : [...ALL_PILOT_ZIPS];

if (requestedZips.length === 0) {
  console.error(
    `No valid pilot ZIPs given via --zips=. Valid pilot ZIPs: ${ALL_PILOT_ZIPS.join(", ")}`,
  );
  process.exit(1);
}

// ── Tunables ─────────────────────────────────────────────────────────────────

const SITE_POINTS_CAP = 2000; // per edition, priority-ordered
const MARKER_COUNT = 12; // numbered markers on the map / site index
const SITE_INDEX_DEPTH = 15; // rendering band 10–20
const BOUNDARY_MAX_POINTS = 300; // simplified ZIP-boundary budget (D8)
const TRANSPORT_MAX_POINTS_PER_LINE = 60; // per clipped transport polyline
const TRANSPORT_NETWORK_PATH = join(process.cwd(), "public", "data", "transport-network.geojson");
const OUT_PATH = join(process.cwd(), "public", "data", "vacancy-index.json");
const ZIP_BOUNDARIES_URL = "https://data.cityofchicago.org/resource/unjd-c2ca.json";

// ── Geometry helpers (copied per the standalone convention of
//    scripts/build-ca-zip-map.ts, which itself copies from
//    compute-corridor-aggregate.ts — intentionally duplicated, not imported) ──

type Ring = Array<[number, number]>;
type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMultiPolygon(lon: number, lat: number, coords: Ring[][][]): boolean {
  for (const polygon of coords) {
    if (polygon.length === 0) continue;
    if (!pointInRing(lon, lat, polygon[0] as unknown as Ring)) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) {
      if (pointInRing(lon, lat, polygon[h] as unknown as Ring)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}
// ── end copied point-in-polygon block ──

/** Ramer–Douglas–Peucker perpendicular distance (point to segment) in degrees. */
function perpendicularDistance(pt: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = pt;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

function rdp(points: Ring, epsilon: number): Ring {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Evenly decimate a polyline to at most `maxPoints`, keeping first and last. */
function decimate(points: Ring, maxPoints: number): Ring {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 2) return [points[0], points[points.length - 1]];
  const step = (points.length - 1) / (maxPoints - 1);
  const out: Ring = [];
  for (let i = 0; i < maxPoints; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Simplify a boundary ring toward `maxPoints` (RDP with escalating epsilon,
 * then decimate as a hard fallback), keeping it closed. */
function simplifyRing(ring: Ring, maxPoints: number): Ring {
  let out = ring;
  let epsilon = 0.00005;
  while (out.length > maxPoints && epsilon < 0.05) {
    out = rdp(ring, epsilon);
    epsilon *= 2;
  }
  if (out.length > maxPoints) out = decimate(out, maxPoints);
  // Ensure the ring stays closed after simplification.
  const f = out[0];
  const l = out[out.length - 1];
  if (out.length >= 2 && (f[0] !== l[0] || f[1] !== l[1])) out = [...out, f];
  return out;
}

/** Signed-area polygon centroid of a ring; falls back to the vertex mean for a
 * degenerate (near-zero-area) ring. Returns [lon, lat]. */
function polygonCentroid(ring: Ring): [number, number] {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    area += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Liang–Barsky clip of one segment to a bbox; null if fully outside. */
function clipSegmentToBbox(
  p0: [number, number],
  p1: [number, number],
  bbox: Bbox,
): [[number, number], [number, number]] | null {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  let t0 = 0;
  let t1 = 1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const p = [-dx, dx, -dy, dy];
  const q = [p0[0] - minLon, maxLon - p0[0], p0[1] - minLat, maxLat - p0[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    [p0[0] + t0 * dx, p0[1] + t0 * dy],
    [p0[0] + t1 * dx, p0[1] + t1 * dy],
  ];
}

/** Clip a polyline to a bbox, stitching consecutive in-bbox runs into
 * sub-polylines. */
function clipLineToBbox(coords: Ring, bbox: Bbox): Ring[] {
  const lines: Ring[] = [];
  let current: Ring = [];
  const eq = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = clipSegmentToBbox(coords[i], coords[i + 1], bbox);
    if (!seg) {
      if (current.length >= 2) lines.push(current);
      current = [];
      continue;
    }
    if (current.length === 0) {
      current = [seg[0], seg[1]];
    } else if (eq(current[current.length - 1], seg[0])) {
      current.push(seg[1]);
    } else {
      if (current.length >= 2) lines.push(current);
      current = [seg[0], seg[1]];
    }
  }
  if (current.length >= 2) lines.push(current);
  return lines;
}

function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// ── Socrata ZIP boundaries (copied fetch shape from build-ca-zip-map.ts) ──

interface ZipGeometry {
  zip: string;
  coords: Ring[][][]; // MultiPolygon coordinates
  bbox: Bbox;
}

async function soda<T>(base: string, params: Record<string, string>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${base}?${qs}`;
  const res = await fetch(url, { headers: socrataHeaders(), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function fetchZipBoundaries(): Promise<Map<string, ZipGeometry>> {
  const rows = await soda<Array<{ zip?: string; the_geom?: { type: string; coordinates: unknown } }>>(
    ZIP_BOUNDARIES_URL,
    { $limit: "500" },
  );

  const merged = new Map<string, Ring[][][]>();
  for (const row of rows) {
    if (!row.zip || !row.the_geom) continue;
    const coords =
      row.the_geom.type === "Polygon"
        ? [row.the_geom.coordinates as Ring[][]]
        : (row.the_geom.coordinates as Ring[][][]);
    const existing = merged.get(row.zip);
    merged.set(row.zip, existing ? [...existing, ...coords] : coords);
  }

  const out = new Map<string, ZipGeometry>();
  for (const [zip, coords] of merged.entries()) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
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

/** Simplified boundary ring(s) + bbox for the edition, or null if no usable
 * outer ring. Holes are dropped (rare for a ZIP); the bbox is computed from the
 * full geometry so the map projection extent stays exact. */
function buildBoundary(geo: ZipGeometry): { rings: [number, number][][]; bbox: Bbox } | null {
  const outerRings = geo.coords
    .map((polygon) => polygon[0] as unknown as Ring)
    .filter((ring) => Array.isArray(ring) && ring.length >= 4);
  if (outerRings.length === 0) return null;
  const budget = Math.max(8, Math.floor(BOUNDARY_MAX_POINTS / outerRings.length));
  const rings = outerRings.map((ring) => simplifyRing(ring, budget));
  return { rings, bbox: geo.bbox };
}

/** Largest outer ring's centroid (by bbox area). */
function editionCentroid(geo: ZipGeometry): { lat: number; lon: number } {
  let best: Ring | null = null;
  let bestArea = -1;
  for (const polygon of geo.coords) {
    const ring = polygon[0] as unknown as Ring;
    if (!Array.isArray(ring) || ring.length < 4) continue;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const area = (maxLon - minLon) * (maxLat - minLat);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  if (!best) {
    const [minLon, minLat, maxLon, maxLat] = geo.bbox;
    return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  }
  const [lon, lat] = polygonCentroid(best);
  return { lat, lon };
}

// ── Transport clipping ──

interface TransportFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties: { kind?: string } | null;
}

function loadTransportFeatures(): TransportFeature[] {
  try {
    if (!existsSync(TRANSPORT_NETWORK_PATH)) {
      console.warn(`  transport-network.geojson missing at ${TRANSPORT_NETWORK_PATH} — editions ship with no transport lines`);
      return [];
    }
    const raw = readFileSync(TRANSPORT_NETWORK_PATH, "utf8");
    const parsed = JSON.parse(raw) as { features?: TransportFeature[] };
    return Array.isArray(parsed.features) ? parsed.features : [];
  } catch (err) {
    console.warn("  failed to read transport-network.geojson:", err instanceof Error ? err.message : err);
    return [];
  }
}

function clipTransportForEdition(
  features: TransportFeature[],
  bbox: Bbox,
): { kind: "expressway" | "rail"; points: [number, number][] }[] {
  const out: { kind: "expressway" | "rail"; points: [number, number][] }[] = [];
  for (const feature of features) {
    if (!feature.geometry || feature.geometry.type !== "LineString") continue;
    const kind = feature.properties?.kind === "rail" ? "rail" : "expressway";
    const coords = feature.geometry.coordinates as Ring;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    // Cheap bbox reject before the per-segment clip.
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (!bboxesOverlap([minLon, minLat, maxLon, maxLat], bbox)) continue;

    for (const line of clipLineToBbox(coords, bbox)) {
      const simplified = decimate(line, TRANSPORT_MAX_POINTS_PER_LINE);
      if (simplified.length >= 2) out.push({ kind, points: simplified });
    }
  }
  return out;
}

// ── DB: vacant inventory + complete ownership ──

interface VacantRow {
  id: string;
  source: string | null;
  address: string | null;
  lat: number | string | null;
  lon: number | string | null;
  property_type: string | null;
  ward: string | null;
  community_area: string | null;
  zoning_class: string | null;
  square_feet: number | string | null;
  status: string | null;
  owner_type: string | null;
  incentive_count: number | string | null;
}

function toNum(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPropertyType(raw: string | null): VacancyPropertyType {
  return raw === "vacant_land" ? "vacant_land" : "vacant_building";
}

/**
 * Single anonymized SELECT over vacant_properties — owner TYPE only, never
 * owner_name / owner_mailing_address (D5). Rows are bucketed to editions by
 * point-in-polygon (D1), so no ZIP filter here (vacant_properties has no ZIP
 * column and case-inconsistent community_area values).
 */
async function fetchAllVacantRows(sql: NeonQueryFunction<false, false>): Promise<VacantRow[]> {
  return (await sql`
    SELECT id, source, address, lat, lon, property_type, ward, community_area,
           zoning_class, square_feet, status, owner_type, incentive_count
    FROM vacant_properties
    WHERE lat IS NOT NULL AND lon IS NOT NULL
  `) as VacantRow[];
}

/**
 * COMPLETE vacant-land ownership distribution from `parcels` (D2a) — a
 * different universe from the tracked COLS/311 inventory. Per-ZIP try/catch:
 * degrades to `{ series: null, total: null }` (never a fabricated all-zero
 * series) when the query cannot run (parcels not migrated on this branch) OR
 * returns zero rows — a pilot ZIP with genuinely zero vacant parcels is
 * implausible and almost always means the parcels/enrichment sync did not
 * cover this ZIP (the SYNC_ZIPS footgun), which is "not yet available", not a
 * true zero.
 */
async function fetchVacantLandOwnership(
  sql: NeonQueryFunction<false, false>,
  zip: string,
): Promise<{ series: OwnerTypeCount[] | null; total: number | null }> {
  try {
    const rows = (await sql`
      SELECT COALESCE(owner_type, 'unknown') AS owner_type, COUNT(*)::int AS cnt
      FROM parcels
      WHERE zip = ${zip} AND is_vacant IS TRUE
      GROUP BY owner_type
    `) as { owner_type: string | null; cnt: number | string }[];

    if (rows.length === 0) {
      console.warn(`  ${zip}: parcels vacant-land ownership returned 0 rows — treating as unavailable (did SYNC_ZIPS cover this ZIP?)`);
      return { series: null, total: null };
    }

    const counts = new Map<string, number>();
    for (const key of OWNER_TYPE_ORDER) counts.set(key, 0);
    let total = 0;
    for (const row of rows) {
      const key = normalizeOwnerType(row.owner_type);
      const c = toNum(row.cnt);
      counts.set(key, (counts.get(key) ?? 0) + c);
      total += c;
    }
    const series = OWNER_TYPE_ORDER.map((ownerType) => ({ ownerType, count: counts.get(ownerType) ?? 0 }));
    return { series, total };
  } catch (err) {
    console.warn(
      `  ${zip}: parcels vacant-land ownership join unavailable (table likely not migrated on this branch):`,
      err instanceof Error ? err.message : err,
    );
    return { series: null, total: null };
  }
}

// ── Edition builder ──

interface ScoredSite {
  id: string;
  lat: number;
  lon: number;
  address: string;
  ownerType: ReturnType<typeof normalizeOwnerType>;
  propertyType: VacancyPropertyType;
  status: string | null;
  squareFeet: number | null;
  zoningClass: string | null;
  incentiveCount: number;
  priorityScore: number;
  priorityTier: "high" | "medium" | "low";
}

function buildEdition(
  zip: string,
  rows: VacantRow[],
  ownership: { series: OwnerTypeCount[] | null; total: number | null },
  geo: ZipGeometry | undefined,
  transport: { kind: "expressway" | "rail"; points: [number, number][] }[],
): VacancyIndexEdition {
  const entryIndex = PILOT_ZIPS.findIndex((entry) => entry.zip === zip);
  const entry = PILOT_ZIPS[entryIndex];

  const sites: ScoredSite[] = rows.map((r) => {
    const propertyType = toPropertyType(r.property_type);
    const ownerType = normalizeOwnerType(r.owner_type);
    const squareFeet = toNumOrNull(r.square_feet);
    const incentiveCount = toNum(r.incentive_count);
    const { score, tier } = computeSitePriority({
      incentiveCount,
      squareFeet,
      ownerType,
      status: r.status,
      propertyType,
    });
    return {
      id: r.id,
      lat: toNum(r.lat),
      lon: toNum(r.lon),
      address: r.address ?? "Unknown",
      ownerType,
      propertyType,
      status: r.status,
      squareFeet,
      zoningClass: r.zoning_class,
      incentiveCount,
      priorityScore: score,
      priorityTier: tier,
    };
  });

  // Headline counts — full universe, computed BEFORE any site-point cap.
  const vacantLandCount = sites.filter((s) => s.propertyType === "vacant_land").length;
  const cityOwnedCount = sites.filter((s) => s.ownerType === "city_public" || s.status === "city_owned").length;
  const inIncentiveZoneCount = sites.filter((s) => s.incentiveCount > 0).length;
  const priorityMix = { high: 0, medium: 0, low: 0 };
  for (const s of sites) priorityMix[s.priorityTier] += 1;

  const ranked = rankSites(sites);

  const sitePointsFull: VacancySitePoint[] = ranked.map((s, i) => ({
    lat: s.lat,
    lon: s.lon,
    ownerType: s.ownerType,
    propertyType: s.propertyType,
    priorityTier: s.priorityTier,
    markerNumber: i < MARKER_COUNT ? i + 1 : null,
  }));
  const sitePointsTruncated = sitePointsFull.length > SITE_POINTS_CAP;
  const sitePoints = sitePointsFull.slice(0, SITE_POINTS_CAP);

  const siteIndex: VacancySiteIndexRow[] = ranked.slice(0, SITE_INDEX_DEPTH).map((s, i) => ({
    markerNumber: i < MARKER_COUNT ? i + 1 : null,
    address: s.address,
    ownerType: s.ownerType,
    propertyType: s.propertyType,
    zoningClass: s.zoningClass,
    squareFeet: s.squareFeet,
    incentiveCount: s.incentiveCount,
    priorityScore: s.priorityScore,
    priorityTier: s.priorityTier,
    nextStep: nextStepForSite(s),
    lat: s.lat,
    lon: s.lon,
  }));

  return {
    zip,
    neighborhood: entry.primaryNeighborhood,
    secondaryAreas: entry.secondaryAreas,
    editionNumber: entryIndex + 1,
    headline: {
      vacantPropertyCount: sites.length,
      vacantLandCount,
      vacantBuildingCount: sites.length - vacantLandCount,
      cityOwnedCount,
      inIncentiveZoneCount,
      priorityMix,
    },
    ownership: {
      vacantLandParcelsByOwnerType: ownership.series,
      vacantLandParcelTotal: ownership.total,
      trackedInventoryByOwnerType: tallyOwnerTypeCounts(sites.map((s) => s.ownerType)),
    },
    sitePoints,
    sitePointsTruncated,
    siteIndex,
    boundary: geo ? buildBoundary(geo) : null,
    centroid: geo ? editionCentroid(geo) : { lat: 0, lon: 0 },
    transport,
  };
}

// ── Comparison matrix (recomputed over the merged edition set) ──

const METRIC_KEYS = [
  "trackedVacantCount",
  "vacancyRate",
  "localOwnershipShare",
  "reportedBuildingShare",
  "cityOwnedShare",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

/** Raw metric values for one edition, from its own headline + the citywide
 * corridor-metrics export (D4). `healthScore` is intentionally never read. */
function metricValuesForEdition(edition: VacancyIndexEdition): Record<MetricKey, number | null> {
  const cm = getCorridorCitywideMetric(edition.zip);
  const tracked = edition.headline.vacantPropertyCount;
  return {
    trackedVacantCount: tracked,
    vacancyRate: cm?.details?.vacancy?.vacancyRate ?? cm?.vacancyRate ?? null,
    localOwnershipShare: cm?.localOwnershipShare ?? null,
    // 311-reported vacant-building share of the tracked inventory — the
    // citywide corridor-metrics incentiveCoverage field is null everywhere,
    // so this edition-computed share replaces it (still recomputes on merge).
    reportedBuildingShare: tracked > 0 ? edition.headline.vacantBuildingCount / tracked : null,
    cityOwnedShare: tracked > 0 ? edition.headline.cityOwnedCount / tracked : null,
  };
}

function buildMatrix(editions: Record<string, VacancyIndexEdition>): VacancyMatrixRow[] {
  const presentZips = ALL_PILOT_ZIPS.filter((zip) => editions[zip]);
  const rawByZip = new Map<string, Record<MetricKey, number | null>>();
  for (const zip of presentZips) rawByZip.set(zip, metricValuesForEdition(editions[zip]));

  const dotsByMetric = new Map<MetricKey, (number | null)[]>();
  for (const key of METRIC_KEYS) {
    dotsByMetric.set(
      key,
      assignQuantileDots(presentZips.map((zip) => rawByZip.get(zip)![key])),
    );
  }

  return presentZips.map((zip, idx) => {
    const edition = editions[zip];
    const raw = rawByZip.get(zip)!;
    const cell = (key: MetricKey) => ({ value: raw[key], dots: dotsByMetric.get(key)![idx] });
    return {
      zip,
      neighborhood: edition.neighborhood,
      editionNumber: edition.editionNumber,
      trackedVacantCount: cell("trackedVacantCount"),
      vacancyRate: cell("vacancyRate"),
      localOwnershipShare: cell("localOwnershipShare"),
      reportedBuildingShare: cell("reportedBuildingShare"),
      cityOwnedShare: cell("cityOwnedShare"),
    };
  });
}

// ── Anonymization assert ──

const FORBIDDEN_SUBSTRINGS = [
  "ownerName",
  "owner_name",
  "ownerMailingAddress",
  "owner_mailing_address",
  "clusterKey",
  '"pins"',
];

function assertAnonymized(serialized: string): void {
  const found = FORBIDDEN_SUBSTRINGS.filter((needle) => serialized.includes(needle));
  if (found.length > 0) {
    console.error("\n════════════════════════════════════════════════════════════════");
    console.error("ANONYMIZATION FAILURE — refusing to write public/data/vacancy-index.json");
    console.error(`Serialized JSON contains owner-identifying key(s): ${found.join(", ")}`);
    console.error("This artifact travels beyond the admin gate. It must carry owner TYPE only.");
    console.error("════════════════════════════════════════════════════════════════\n");
    process.exit(1);
  }
}

// ── Main ──

const sql = neon(DATABASE_URL);

async function main() {
  console.log(`=== Vacancy Opportunity Index export ===`);
  console.log(`Editions requested: ${requestedZips.join(", ")}${requestedZips.length < ALL_PILOT_ZIPS.length ? " (merge into existing file)" : ""}\n`);

  // Existing file (merge-not-clobber source).
  let existing: VacancyIndexExport | null = null;
  if (existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUT_PATH, "utf8")) as VacancyIndexExport;
    } catch {
      console.warn("  existing vacancy-index.json is unparseable — starting fresh");
      existing = null;
    }
  }

  // ZIP boundaries (PIP + rings + centroid) for the requested editions only.
  console.log("Fetching Chicago ZIP boundaries (unjd-c2ca)...");
  const allBoundaries = await fetchZipBoundaries();
  const geoByZip = new Map<string, ZipGeometry>();
  for (const zip of requestedZips) {
    const geo = allBoundaries.get(zip);
    if (geo) geoByZip.set(zip, geo);
    else console.warn(`  ${zip}: no ZIP boundary found in unjd-c2ca — boundary/centroid/transport will be null/origin`);
  }
  console.log(`  ${geoByZip.size}/${requestedZips.length} requested ZIP boundaries resolved`);

  // Single anonymized vacant-inventory pull, bucketed by PIP.
  console.log("\nQuerying vacant_properties (anonymized columns only)...");
  const allRows = await fetchAllVacantRows(sql);
  console.log(`  ${allRows.length} vacant rows with coordinates`);

  const rowsByZip = new Map<string, VacantRow[]>();
  for (const zip of requestedZips) rowsByZip.set(zip, []);
  for (const row of allRows) {
    const lat = toNumOrNull(row.lat);
    const lon = toNumOrNull(row.lon);
    if (lat == null || lon == null) continue;
    for (const zip of requestedZips) {
      const geo = geoByZip.get(zip);
      if (!geo) continue;
      if (lon < geo.bbox[0] || lon > geo.bbox[2] || lat < geo.bbox[1] || lat > geo.bbox[3]) continue;
      if (pointInMultiPolygon(lon, lat, geo.coords)) {
        rowsByZip.get(zip)!.push(row);
        break; // a point belongs to at most one ZIP
      }
    }
  }

  // Transport network (clipped per edition bbox).
  const transportFeatures = loadTransportFeatures();

  // Build each requested edition.
  console.log("\nBuilding editions...");
  const builtEditions: Record<string, VacancyIndexEdition> = {};
  for (const zip of requestedZips) {
    const rows = rowsByZip.get(zip) ?? [];
    const geo = geoByZip.get(zip);
    const ownership = await fetchVacantLandOwnership(sql, zip);
    const transport = geo ? clipTransportForEdition(transportFeatures, geo.bbox) : [];
    const edition = buildEdition(zip, rows, ownership, geo, transport);
    builtEditions[zip] = edition;
    console.log(
      `  ${zip} ${edition.neighborhood}: ${edition.headline.vacantPropertyCount} tracked ` +
        `(${edition.headline.cityOwnedCount} city-owned, ${edition.headline.inIncentiveZoneCount} in incentive zones), ` +
        `${edition.sitePoints.length} site points${edition.sitePointsTruncated ? " (truncated)" : ""}, ` +
        `${transport.length} transport lines`,
    );
    if (edition.headline.vacantPropertyCount === 0) {
      console.warn(`  warning: 0 tracked vacant properties bucketed to ${zip} — did db:sync:vacant run, and does the boundary resolve?`);
    }
  }

  // Merge into the existing editions (requested ZIPs replaced; others kept).
  const editions: Record<string, VacancyIndexEdition> = { ...(existing?.editions ?? {}), ...builtEditions };

  const out: VacancyIndexExport = {
    generatedAt: new Date().toISOString(),
    sources: {
      trackedInventory:
        "Chicago City-Owned Land Inventory (aksk-kvfp) + 311 Vacant/Abandoned Building Complaints (v6vf-nfxy)",
      vacantLandOwnership: "Cook County Assessor parcels (classified owner type; complete vacant-land universe)",
      corridorMetrics: "Explorer corridor-metrics citywide export (vacancy rate, local ownership, incentive coverage)",
      zipBoundaries: "Chicago ZIP Code boundaries (unjd-c2ca)",
      transportNetwork: "Chicago transportation network (expressways + rail)",
      asOf: new Date().toISOString().slice(0, 10),
    },
    editions,
    matrix: buildMatrix(editions),
  };

  const serialized = JSON.stringify(out, null, 2) + "\n";
  assertAnonymized(serialized);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, serialized);
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`  editions in file: ${Object.keys(editions).sort().join(", ")}`);
  console.log(`  matrix rows: ${out.matrix.length}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
