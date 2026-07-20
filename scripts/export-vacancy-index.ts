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
import { PILOT_ZIPS, type PilotZipEntry } from "../lib/pilot-zips";
import { getCorridorCitywideMetric } from "../lib/corridor-citywide";
import { normalizeOwnerType } from "../lib/owner-classify";
import { normalizeOwnerAddress } from "../lib/corridor-owners";
import { toDigitsOnlyPin } from "../lib/ingest/pin-batch";
import { CHICAGO_COMMUNITY_AREAS } from "../lib/community-areas";
import {
  addressHasViolation,
  assignQuantileDots,
  buildDirectoryRows,
  CLUSTERS_NOTE,
  clusterVacantSites,
  computeSitePriority,
  corridorRefsIntersectingBbox,
  countAddressesInSet,
  latestSaleYearForPin,
  nearestCorridorName,
  nextStepForSite,
  portfolioForSite,
  rankSites,
  reconcileOwnerTypeForPin,
  reconcileVacantLandOwnership,
  tallyOwnerTypeCounts,
  taxSaleExposureForVacantPins,
  type ClusterInputSite,
  type CorridorKind,
  type CorridorPolygon,
  type CorridorRef,
  type OwnerTypeCount,
  type VacancyAnchor,
  type VacancyCluster,
  type VacancyDirectoryFile,
  type VacancyDirectoryRow,
  type VacancyDistressSignals,
  type VacancyIndexEdition,
  type VacancyIndexExport,
  type VacancyLandPoint,
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
const CLUSTER_COUNT = 12; // top-N proximity clusters attached per edition (D2)
const SITE_INDEX_DEPTH = 15; // rendering band 10–20
const BOUNDARY_MAX_POINTS = 300; // simplified ZIP-boundary budget (D8)
const TRANSPORT_MAX_POINTS_PER_LINE = 60; // per clipped transport polyline
const TRANSPORT_NETWORK_PATH = join(process.cwd(), "public", "data", "transport-network.geojson");
const OUT_PATH = join(process.cwd(), "public", "data", "vacancy-index.json");
// Per-ZIP site directory files live here (one {zip}.json each). They lazy-load
// on the web report so the main index JSON stays lean. A subset --zips= run
// rewrites ONLY the requested ZIPs' files (merge-not-clobber, like OUT_PATH).
const DIRECTORY_DIR = join(process.cwd(), "public", "data", "vacancy-directory");
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

// ── Corridors (static geojson, D3) ──
// Three named-corridor layers, loaded once per run. bbox-overlap decides which
// corridors an edition lists; point-in-polygon / nearest-within-400m decides a
// cluster's corridorName (see lib/vacancy-index.ts spatial helpers).

const ZONES_DIR = join(process.cwd(), "public", "data", "zones");
const CORRIDOR_SOURCES: { path: string; kind: CorridorKind }[] = [
  { path: join(ZONES_DIR, "special-service-areas.geojson"), kind: "ssa" },
  { path: join(ZONES_DIR, "ccsa-corridors.geojson"), kind: "commercial" },
  { path: join(ZONES_DIR, "industrial-corridors.geojson"), kind: "industrial" },
];

function loadCorridorPolygons(): CorridorPolygon[] {
  const out: CorridorPolygon[] = [];
  for (const src of CORRIDOR_SOURCES) {
    try {
      if (!existsSync(src.path)) {
        console.warn(`  corridor layer missing at ${src.path} — skipped`);
        continue;
      }
      const gj = JSON.parse(readFileSync(src.path, "utf8")) as {
        features?: Array<{
          geometry?: { type?: string; coordinates?: unknown } | null;
          properties?: { name?: string } | null;
        }>;
      };
      let added = 0;
      for (const f of gj.features ?? []) {
        const name = f.properties?.name?.trim();
        if (!name || !f.geometry) continue;
        const rings: Ring[] = [];
        if (f.geometry.type === "Polygon") {
          const coords = f.geometry.coordinates as Ring[];
          if (Array.isArray(coords[0])) rings.push(coords[0]);
        } else if (f.geometry.type === "MultiPolygon") {
          for (const poly of f.geometry.coordinates as Ring[][]) {
            if (Array.isArray(poly[0])) rings.push(poly[0]);
          }
        } else {
          continue;
        }
        if (rings.length === 0) continue;
        let minLon = Infinity;
        let minLat = Infinity;
        let maxLon = -Infinity;
        let maxLat = -Infinity;
        for (const ring of rings) {
          for (const [lon, lat] of ring) {
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
        out.push({ name, kind: src.kind, bbox: [minLon, minLat, maxLon, maxLat], rings });
        added += 1;
      }
      console.log(`  corridors (${src.kind}): ${added} polygons`);
    } catch (err) {
      console.warn(`  failed to read ${src.path}:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ── Anchors (static json, D3) ──
// The anchor dataset is COMMUNITY-AREA-native and carries NO per-anchor
// coordinate, so each anchor is placed at its community-area CENTROID
// (lib/community-areas.ts) — an area-level locator, never an exact address.
// Only public institutional name + category travel into the export.

const ANCHORS_PATH = join(
  process.cwd(),
  "data",
  "exports",
  "chicago-neighborhood-economics",
  "neighborhood_anchors_by_community_area.json",
);

/** Normalize a community-area name for matching: drop any "(…)" gloss, trim,
 * lowercase (so pilot "South Lawndale (Little Village)" meets dataset
 * "South Lawndale"). */
function normalizeCaName(name: string): string {
  const paren = name.indexOf("(");
  return (paren >= 0 ? name.slice(0, paren) : name).trim().toLowerCase();
}

/** Map of normalized CA name -> anchors placed at that CA's centroid. Anchors
 * whose CA has no centroid in lib/community-areas.ts are dropped (can't place
 * them honestly). */
function loadAnchorsByCommunityArea(): Map<string, VacancyAnchor[]> {
  const byCa = new Map<string, VacancyAnchor[]>();
  try {
    if (!existsSync(ANCHORS_PATH)) {
      console.warn(`  anchors dataset missing at ${ANCHORS_PATH} — anchors null for every edition`);
      return byCa;
    }
    const data = JSON.parse(readFileSync(ANCHORS_PATH, "utf8")) as {
      byCommunityArea?: Record<
        string,
        { communityArea?: string; anchors?: Array<{ name?: string; category?: string; type?: string }> }
      >;
    };
    const centroidByName = new Map<string, { lat: number; lon: number }>();
    for (const ca of CHICAGO_COMMUNITY_AREAS) {
      centroidByName.set(ca.name.toLowerCase(), { lat: ca.lat, lon: ca.lon });
    }
    for (const entry of Object.values(data.byCommunityArea ?? {})) {
      const caName = entry.communityArea?.trim();
      if (!caName) continue;
      const centroid = centroidByName.get(caName.toLowerCase());
      if (!centroid) continue; // no centroid -> cannot place -> skip honestly
      const key = normalizeCaName(caName);
      const list = byCa.get(key) ?? [];
      for (const a of entry.anchors ?? []) {
        const name = (a.name ?? "").trim();
        if (!name) continue;
        const category = (a.category ?? a.type ?? "").trim() || "Community anchor";
        list.push({ name, category, lat: centroid.lat, lon: centroid.lon });
      }
      byCa.set(key, list);
    }
  } catch (err) {
    console.warn(`  failed to read ${ANCHORS_PATH}:`, err instanceof Error ? err.message : err);
  }
  return byCa;
}

/** Anchors for one edition: the union over its primary + secondary community
 * areas (deduped by CA), or `null` when none matched. */
function anchorsForEdition(
  entry: PilotZipEntry,
  byCa: Map<string, VacancyAnchor[]>,
): VacancyAnchor[] | null {
  const out: VacancyAnchor[] = [];
  const seen = new Set<string>();
  for (const raw of [entry.primaryNeighborhood, ...entry.secondaryAreas]) {
    const key = normalizeCaName(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const a of byCa.get(key) ?? []) out.push(a);
  }
  return out.length > 0 ? out : null;
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
 * COMPLETE vacant-land ownership from `parcels` (D2a), one anonymized row per
 * vacant parcel (PIN + owner TYPE only — never owner names/mailing) so the same
 * pull drives BOTH the raw taxpayer-record series (tallied) AND the reconciled
 * series (PIN-matched against the City inventory). A single fetch keeps the two
 * series' availability identical (the "reconciliation null iff raw series null"
 * contract holds by construction).
 *
 * Per-ZIP try/catch: degrades to `null` (never a fabricated all-zero series)
 * when the query cannot run (parcels not migrated on this branch) OR returns
 * zero rows — a pilot ZIP with genuinely zero vacant parcels is implausible and
 * almost always means the parcels/enrichment sync did not cover this ZIP (the
 * SYNC_ZIPS footgun), which is "not yet available", not a true zero.
 */
async function fetchVacantLandParcels(
  sql: NeonQueryFunction<false, false>,
  zip: string,
): Promise<{ pin: string; ownerType: string | null; lat: number | null; lon: number | null }[] | null> {
  try {
    // Anonymized still — pin/owner_type only, plus lat/lon for the reconciled
    // land-dot layer. NEVER owner names. Rows without coordinates stay in the
    // series/total but drop out of landPoints (excluded at build time).
    const rows = (await sql`
      SELECT pin, COALESCE(owner_type, 'unknown') AS owner_type, lat, lon
      FROM parcels
      WHERE zip = ${zip} AND is_vacant IS TRUE
    `) as { pin: string | null; owner_type: string | null; lat: number | string | null; lon: number | string | null }[];

    if (rows.length === 0) {
      console.warn(`  ${zip}: parcels vacant-land ownership returned 0 rows — treating as unavailable (did SYNC_ZIPS cover this ZIP?)`);
      return null;
    }

    return rows.map((r) => ({
      pin: r.pin ?? "",
      ownerType: r.owner_type,
      lat: toNumOrNull(r.lat),
      lon: toNumOrNull(r.lon),
    }));
  } catch (err) {
    console.warn(
      `  ${zip}: parcels vacant-land ownership join unavailable (table likely not migrated on this branch):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Once-per-run map of PIN -> tax_sale_year[] combining scavenger + annual
 * tax-sale entries (both PIN-keyed, digits-only `parcels.pin` convention after
 * their adapters' normalize()). A key exists for every PIN with ANY record
 * (even a null-year one, whose value is `[]`), so membership = exposure —
 * mirrors lib/corridor-owners.ts's saleEntriesByPin build. Returns `null` when
 * the tables are absent on this branch (42P01), so distress degrades to the
 * pending state instead of a fabricated zero.
 */
async function fetchSaleYearsByPin(
  sql: NeonQueryFunction<false, false>,
): Promise<Map<string, number[]> | null> {
  try {
    type SaleRow = { pin: string; tax_sale_year: number | string | null };
    const scavenger = (await sql`
      SELECT pin, tax_sale_year FROM scavenger_sale_entries WHERE pin IS NOT NULL AND pin <> ''
    `) as SaleRow[];
    const annual = (await sql`
      SELECT pin, tax_sale_year FROM annual_tax_sale_entries WHERE pin IS NOT NULL AND pin <> ''
    `) as SaleRow[];

    const map = new Map<string, number[]>();
    for (const entry of [...scavenger, ...annual]) {
      const years = map.get(entry.pin) ?? [];
      if (entry.tax_sale_year != null) {
        const year = Number(entry.tax_sale_year);
        if (Number.isFinite(year)) years.push(year);
      }
      map.set(entry.pin, years); // ensure the key exists even with a null year
    }
    return map;
  } catch (err) {
    console.warn(
      "  scavenger/annual tax-sale tables unavailable (not migrated on this branch) — tax-sale distress degrades to pending:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Once-per-run set of normalized vacant-building-violation addresses (u7si-yh3t)
 * using the exact SQL normalization lib/corridor-owners.ts joins by. Returns
 * `null` when the table is absent on this branch, so the violation chip
 * degrades to pending rather than a fabricated zero.
 */
async function fetchViolationAddressSet(
  sql: NeonQueryFunction<false, false>,
): Promise<Set<string> | null> {
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
    console.warn(
      "  vacant_building_violations table unavailable (not migrated on this branch) — violation distress degrades to pending:",
      err instanceof Error ? err.message : err,
    );
    return null;
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
  saleYear: number | null;
  violation: boolean;
}

function buildEdition(
  zip: string,
  rows: VacantRow[],
  parcels: { pin: string; ownerType: string | null; lat: number | null; lon: number | null }[] | null,
  geo: ZipGeometry | undefined,
  transport: { kind: "expressway" | "rail"; points: [number, number][] }[],
  saleYearsByPin: Map<string, number[]> | null,
  violationAddressSet: Set<string> | null,
  corridorPolygons: CorridorPolygon[],
  anchors: VacancyAnchor[] | null,
): { edition: VacancyIndexEdition; directoryRows: VacancyDirectoryRow[]; excludedNoAddressCount: number } {
  const entryIndex = PILOT_ZIPS.findIndex((entry) => entry.zip === zip);
  const entry = PILOT_ZIPS[entryIndex];

  // City-owned land inventory PINs within this ZIP: the COLS rows carry the PIN
  // in their id (`cols-<pin>`, sync-vacant-properties.ts). Normalize dashed/
  // digits-only to the `parcels.pin` convention (pin-batch.ts) and keep only
  // real 14-digit PINs — the lat/lon-fallback ids (`cols-<lat>-<lon>`) drop out.
  const inventoryPins = new Set<string>();
  for (const r of rows) {
    if (!r.id.startsWith("cols-")) continue;
    const pin = toDigitsOnlyPin(r.id.slice("cols-".length));
    if (pin.length === 14) inventoryPins.add(pin);
  }

  // Raw + reconciled vacant-land ownership + the land-dot layer all share the
  // parcels pull's availability (null iff parcels === null).
  let rawSeries: OwnerTypeCount[] | null = null;
  let rawTotal: number | null = null;
  let reconciledSeries: OwnerTypeCount[] | null = null;
  let reconciliation: VacancyIndexEdition["ownership"]["reconciliation"] = null;
  let landPoints: VacancyLandPoint[] | null = null;
  let landPointsTruncated = false;
  let landPointsTotal: number | null = null;
  const assessorVacantPins = new Set<string>();
  if (parcels !== null) {
    const normRows = parcels.map((p) => ({
      pin: toDigitsOnlyPin(p.pin),
      ownerType: p.ownerType,
      lat: p.lat,
      lon: p.lon,
    }));
    for (const r of normRows) if (r.pin) assessorVacantPins.add(r.pin);
    rawSeries = tallyOwnerTypeCounts(normRows.map((r) => r.ownerType));
    rawTotal = normRows.length;
    const reconciled = reconcileVacantLandOwnership(normRows, inventoryPins);
    reconciledSeries = reconciled.series;
    reconciliation = reconciled.stats;

    // Land dots: coord-bearing parcels only (rows without lat/lon stay in the
    // series/total but drop out here), reconciled owner type + per-point
    // tax-sale flag, deterministic pin-asc order, capped. Total = full universe.
    landPointsTotal = rawTotal;
    const withCoords = normRows
      .filter((r) => r.lat != null && r.lon != null)
      .sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0));
    const allLandPoints: VacancyLandPoint[] = withCoords.map((r) => ({
      lat: r.lat as number,
      lon: r.lon as number,
      ownerType: reconcileOwnerTypeForPin(r.pin, r.ownerType, inventoryPins),
      saleYear: latestSaleYearForPin(r.pin, saleYearsByPin),
    }));
    landPointsTruncated = allLandPoints.length > SITE_POINTS_CAP;
    landPoints = allLandPoints.slice(0, SITE_POINTS_CAP);
  }

  // Distress overlays — null only when NEITHER source table loaded.
  let distress: VacancyDistressSignals | null = null;
  if (saleYearsByPin !== null || violationAddressSet !== null) {
    const vacantPins = new Set<string>(inventoryPins);
    for (const p of assessorVacantPins) vacantPins.add(p);
    const taxSale = taxSaleExposureForVacantPins(vacantPins, saleYearsByPin);
    const normAddresses = rows.map((r) => normalizeOwnerAddress(r.address));
    distress = {
      taxSaleExposedCount: taxSale.taxSaleExposedCount,
      latestTaxSaleYear: taxSale.latestTaxSaleYear,
      violationMatchCount: countAddressesInSet(normAddresses, violationAddressSet),
    };
  }

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
    // Per-point distress flags. COLS rows carry their PIN in the id (`cols-<pin>`);
    // 311 rows do not, so their saleYear stays null (honest). Violation matches
    // the same normalized address the edition-level violationMatchCount counts.
    const colsPin = r.id.startsWith("cols-") ? toDigitsOnlyPin(r.id.slice("cols-".length)) : "";
    const pin = colsPin.length === 14 ? colsPin : null;
    const saleYear = latestSaleYearForPin(pin, saleYearsByPin);
    const violation = addressHasViolation(normalizeOwnerAddress(r.address), violationAddressSet);
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
      saleYear,
      violation,
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
    saleYear: s.saleYear,
    violation: s.violation,
  }));
  const sitePointsTruncated = sitePointsFull.length > SITE_POINTS_CAP;
  const sitePoints = sitePointsFull.slice(0, SITE_POINTS_CAP);

  // Full site directory (the web report's online index): EVERY tracked row with
  // a usable address, anonymized (owner TYPE only). `sites` is rows.map(...) so
  // it index-aligns with `rows` — pass the RAW nullable address so a missing one
  // is excluded + counted rather than coerced to the site-index "Unknown".
  const { rows: directoryRows, excludedNoAddressCount } = buildDirectoryRows(
    sites.map((s, i) => ({
      address: rows[i]?.address ?? null,
      ownerType: s.ownerType,
      propertyType: s.propertyType,
      priorityTier: s.priorityTier,
      priorityScore: s.priorityScore,
      saleYear: s.saleYear,
      violation: s.violation,
    })),
  );

  // ── Spatial layer (D2/D3): proximity clusters over the FULL tracked universe
  //    (`sites`, pre-cap), each carrying its portfolio + distress flags. Top 12
  //    by count; corridorName resolved per cluster centroid. Corridors listed
  //    for the edition are those whose bbox overlaps the ZIP bbox. ──
  const clusterInput: ClusterInputSite[] = sites.map((s) => ({
    lat: s.lat,
    lon: s.lon,
    ownerType: s.ownerType,
    portfolio: portfolioForSite({
      ownerType: s.ownerType,
      priorityTier: s.priorityTier,
      saleYear: s.saleYear,
      violation: s.violation,
    }),
    taxSale: s.saleYear != null,
    violation: s.violation,
    propertyType: s.propertyType,
  }));
  const clusterLinkMeters = Number(process.env.VACANCY_CLUSTER_LINK_METERS) || 150;
  const clusters: VacancyCluster[] = clusterVacantSites(clusterInput, { linkMeters: clusterLinkMeters })
    .slice(0, CLUSTER_COUNT)
    .map((cl) => ({
      ...cl,
      corridorName: nearestCorridorName(cl.centroid.lat, cl.centroid.lon, corridorPolygons, 400),
    }));
  const corridors: CorridorRef[] = geo ? corridorRefsIntersectingBbox(corridorPolygons, geo.bbox) : [];

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

  const edition: VacancyIndexEdition = {
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
      vacantLandParcelsByOwnerType: rawSeries,
      vacantLandParcelTotal: rawTotal,
      trackedInventoryByOwnerType: tallyOwnerTypeCounts(sites.map((s) => s.ownerType)),
      reconciledVacantLandByOwnerType: reconciledSeries,
      reconciliation,
    },
    distress,
    sitePoints,
    sitePointsTruncated,
    siteIndex,
    landPoints,
    landPointsTruncated,
    landPointsTotal,
    directoryCount: directoryRows.length,
    boundary: geo ? buildBoundary(geo) : null,
    centroid: geo ? editionCentroid(geo) : { lat: 0, lon: 0 },
    transport,
    clusters,
    clustersNote: CLUSTERS_NOTE,
    corridors,
    anchors,
  };

  return { edition, directoryRows, excludedNoAddressCount };
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

  // Spatial-intelligence static inputs (D3): corridor polygons + anchors,
  // loaded once for the whole run.
  console.log("\nLoading corridor polygons + anchors (static geojson/json)...");
  const corridorPolygons = loadCorridorPolygons();
  const anchorsByCa = loadAnchorsByCommunityArea();
  console.log(
    `  ${corridorPolygons.length} corridor polygons` +
      `  ·  anchors across ${anchorsByCa.size} community areas`,
  );

  // Distress overlays: built once for the whole run (both are citywide pulls,
  // filtered per-edition by PIN/address). Each degrades to null when its
  // table(s) are absent on this branch — a plain vacant+parcels branch still
  // exports, with the distress chips staying "not yet available".
  console.log("\nLoading distress overlays (tax-sale + vacant-building violations)...");
  const saleYearsByPin = await fetchSaleYearsByPin(sql);
  const violationAddressSet = await fetchViolationAddressSet(sql);
  console.log(
    `  tax-sale entries: ${saleYearsByPin === null ? "unavailable (pending)" : `${saleYearsByPin.size} PINs`}` +
      `  ·  vacant-building violations: ${violationAddressSet === null ? "unavailable (pending)" : `${violationAddressSet.size} addresses`}`,
  );

  // One timestamp for this run — shared by the main export and every per-ZIP
  // directory file written below, so they agree on generatedAt.
  const generatedAt = new Date().toISOString();

  // Build each requested edition. Each edition's full site directory is written
  // to its own file here (merge-not-clobber: only requested ZIPs are rewritten).
  console.log("\nBuilding editions...");
  mkdirSync(DIRECTORY_DIR, { recursive: true });
  const builtEditions: Record<string, VacancyIndexEdition> = {};
  for (const zip of requestedZips) {
    const rows = rowsByZip.get(zip) ?? [];
    const geo = geoByZip.get(zip);
    const parcels = await fetchVacantLandParcels(sql, zip);
    const transport = geo ? clipTransportForEdition(transportFeatures, geo.bbox) : [];
    const editionEntry = PILOT_ZIPS.find((e) => e.zip === zip);
    const anchors = editionEntry ? anchorsForEdition(editionEntry, anchorsByCa) : null;
    const { edition, directoryRows, excludedNoAddressCount } = buildEdition(
      zip,
      rows,
      parcels,
      geo,
      transport,
      saleYearsByPin,
      violationAddressSet,
      corridorPolygons,
      anchors,
    );
    builtEditions[zip] = edition;

    // Write the per-ZIP site directory file (anonymized like the main export;
    // the same hard assert runs on it before write).
    const directoryFile: VacancyDirectoryFile = {
      zip,
      neighborhood: edition.neighborhood,
      generatedAt,
      rows: directoryRows,
      excludedNoAddressCount,
    };
    const directorySerialized = JSON.stringify(directoryFile, null, 2) + "\n";
    assertAnonymized(directorySerialized);
    const directoryPath = join(DIRECTORY_DIR, `${zip}.json`);
    writeFileSync(directoryPath, directorySerialized);

    console.log(
      `  ${zip} ${edition.neighborhood}: ${edition.headline.vacantPropertyCount} tracked ` +
        `(${edition.headline.cityOwnedCount} city-owned, ${edition.headline.inIncentiveZoneCount} in incentive zones), ` +
        `${edition.sitePoints.length} site points${edition.sitePointsTruncated ? " (truncated)" : ""}, ` +
        `${edition.landPoints === null ? "no land dots" : `${edition.landPoints.length}/${edition.landPointsTotal ?? "?"} land dots${edition.landPointsTruncated ? " (truncated)" : ""}`}, ` +
        `${transport.length} transport lines`,
    );
    const rec = edition.ownership.reconciliation;
    const rawCity = edition.ownership.vacantLandParcelsByOwnerType?.find((c) => c.ownerType === "city_public")?.count ?? null;
    const recCity = edition.ownership.reconciledVacantLandByOwnerType?.find((c) => c.ownerType === "city_public")?.count ?? null;
    console.log(
      rec === null
        ? `    reconciliation: parcels series unavailable (pending)`
        : `    reconciliation: City/Public ${rawCity} raw -> ${recCity} reconciled ` +
            `(${rec.cityPinMatches} PIN matches, ${rec.reclassifiedCount} reclassified, ${rec.inventoryUnmatchedCount} inventory PINs unmatched)`,
    );
    console.log(
      edition.distress === null
        ? `    distress: all sources unavailable (pending)`
        : `    distress: tax-sale exposed ${edition.distress.taxSaleExposedCount ?? "pending"}` +
            ` (latest ${edition.distress.latestTaxSaleYear ?? "n/a"}), violations ${edition.distress.violationMatchCount ?? "pending"}`,
    );
    console.log(
      `    directory: ${directoryRows.length} addresses written to vacancy-directory/${zip}.json` +
        `${excludedNoAddressCount > 0 ? ` (${excludedNoAddressCount} rows omitted for no usable address)` : ""}`,
    );
    console.log(
      `    spatial: ${edition.clusters.length} clusters` +
        `${edition.clusters.length > 0 ? ` (largest ${edition.clusters[0].count})` : ""}, ` +
        `${edition.corridors.length} corridors, ` +
        `${edition.anchors === null ? "no anchors" : `${edition.anchors.length} anchors`}`,
    );
    if (edition.headline.vacantPropertyCount === 0) {
      console.warn(`  warning: 0 tracked vacant properties bucketed to ${zip} — did db:sync:vacant run, and does the boundary resolve?`);
    }
  }

  // Merge into the existing editions (requested ZIPs replaced; others kept).
  const editions: Record<string, VacancyIndexEdition> = { ...(existing?.editions ?? {}), ...builtEditions };

  const out: VacancyIndexExport = {
    generatedAt,
    sources: {
      trackedInventory:
        "Chicago City-Owned Land Inventory (aksk-kvfp) + 311 Vacant/Abandoned Building Complaints (v6vf-nfxy)",
      vacantLandOwnership: "Cook County Assessor parcels (classified owner type; complete vacant-land universe)",
      corridorMetrics: "Explorer corridor-metrics citywide export (vacancy rate, local ownership, incentive coverage)",
      zipBoundaries: "Chicago ZIP Code boundaries (unjd-c2ca)",
      transportNetwork: "Chicago transportation network (expressways + rail)",
      asOf: generatedAt.slice(0, 10),
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
